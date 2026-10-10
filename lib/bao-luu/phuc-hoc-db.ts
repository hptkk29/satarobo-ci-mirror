import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { publishEvent } from "@/lib/events/publish";
import { writeAudit } from "@/lib/audit/audit-log";
import { getSetting } from "@/lib/settings/service";
import { soBuoiTheoLoTrinh } from "@/lib/lms/session-order";
import { vnStartOfDay } from "@/lib/time/vn";
import { laBaoLuuBat, LOI_BAO_LUU_TAT } from "@/lib/bao-luu/feature";
import { chanDuyetVeNo } from "@/lib/bao-luu/hoso";
import { NGUON_PHUC_HOC } from "@/lib/bao-luu/hang-so";
import { xepLopPhucHoc, type LopPhucHoc, type LopUngVien } from "@/lib/bao-luu/phuc-hoc";
import { chuyenTrangThai, ghiSuKien, goPausedKhiKetThuc, type NguoiThucHien } from "@/lib/bao-luu/chuyen-trang-thai";
import { docKhoanDenHan } from "@/lib/bao-luu/ngu-canh-db";
import { dich, LoiNhieu, type KetQua, type NguoiLam } from "@/lib/bao-luu/dich-vu";
import { syncConversationMembership } from "@/lib/chat/sync-membership";

// lib/bao-luu/phuc-hoc-db.ts — PHỤC HỌC (BR-21, BR-22, BR-24). PHIÊN 6.
//   · `goiYLopPhucHoc` — chỉ ĐỌC: lớp nào cùng khoá/cơ sở, lệch bài ≤ dung sai, kèm hướng (học lại / sinh bù) — dùng cho hộp chọn lớp.
//   · `baoPhucHoc`     — phụ huynh báo muốn học lại: ACTIVE|OVERDUE|NOTICE_SENT → RESUME_PENDING (đồng hồ chấm dứt dừng vì rời nhánh quá hạn).
//   · `phucHoc`        — THỰC HIỆN trong MỘT giao dịch: kiểm nợ → chuyển ghi danh sang lớp mới (nếu khác) → gỡ PAUSED → sinh buổi bù PHUC_HOC
//                        (nếu lớp đi trước) → đóng hồ sơ (ENDED, kind RESUME). Hỏng ở bất kỳ bước nào ⇒ cuộn ngược TRỌN.
//   · `chuyenSangTrungTam` — BR-24: không có lớp phù hợp thì hồ sơ PARENT chuyển loại CENTER (Trung tâm nợ bé một lớp).
//
// Nghĩa vụ tiền: KHÔNG ghi dòng tiền nào. Buổi bù PHUC_HOC không trừ hạn mức và không đòi phí (`lib/hoc-bu/danh-sach-db.ts` coi `nguon = PHUC_HOC` là miễn phí).

type Tx = Prisma.TransactionClient;
const nguoiThucHien = (n: NguoiLam | null): NguoiThucHien => (n ? { id: n.id, name: n.name } : null);
const TX = { timeout: 30_000, maxWait: 10_000 } as const;

const TRANG_THAI_CO_THE_PHUC_HOC = ["ACTIVE", "RESUME_PENDING", "OVERDUE", "NOTICE_SENT"] as const;
const TRANG_THAI_TINH_SI_SO = ["PENDING", "CONFIRMED", "STUDYING", "ACTIVE"] as const;

type Client = Tx | typeof db;

/** Các lớp CÙNG KHOÁ, CÙNG CƠ SỞ, đang chạy — kèm bài của buổi SẮP TỚI và sĩ số. Không lọc theo dung sai (việc của `xepLopPhucHoc`). */
async function layUngVienLop(c: Client, p: { courseId: string; centerId: string | null; now: Date }): Promise<LopUngVien[]> {
  const lop = await c.class.findMany({
    where: { courseId: p.courseId, deletedAt: null, status: "ACTIVE", ...(p.centerId ? { centerId: p.centerId } : {}) },
    select: {
      id: true,
      name: true,
      maxStudents: true,
      sessions: {
        where: { status: { not: "CANCELLED" }, date: { gte: vnStartOfDay(p.now) } },
        orderBy: { date: "asc" },
        take: 1,
        select: { plan: { select: { order: true } }, lesson: { select: { order: true } } },
      },
      _count: { select: { enrollments: { where: { deletedAt: null, status: { in: [...TRANG_THAI_TINH_SI_SO] } } } } },
    },
  });
  return lop.map((l) => {
    const s = l.sessions[0];
    return {
      classId: l.id,
      ten: l.name,
      baiHienTai: s ? soBuoiTheoLoTrinh({ planOrder: s.plan?.order ?? null, lessonOrder: s.lesson?.order ?? null }) : null,
      siSo: l._count.enrollments,
      toiDa: l.maxStudents,
    };
  });
}

export type GoiYPhucHoc = { dungOBai: number; dungSai: number; lop: LopPhucHoc[] };

export async function goiYLopPhucHoc(reserveId: string, now: Date): Promise<KetQua<GoiYPhucHoc>> {
  const hs = await db.studentReserve.findUnique({
    where: { id: reserveId },
    select: { status: true, orgUnitId: true, snapStoppedAtLessonOrder: true, enrollment: { select: { courseId: true, class: { select: { centerId: true } } } } },
  });
  if (!hs || !hs.enrollment) return { ok: false, loi: ["Không tìm thấy hồ sơ bảo lưu."] };
  if (!(TRANG_THAI_CO_THE_PHUC_HOC as readonly string[]).includes(hs.status)) return { ok: false, loi: ["Hồ sơ không ở trạng thái phục học được."] };
  const dungSai = await getSetting("pause.resumeLessonTolerance", { orgUnitId: hs.orgUnitId });
  const dungOBai = hs.snapStoppedAtLessonOrder ?? 0;
  const ungVien = await layUngVienLop(db, { courseId: hs.enrollment.courseId, centerId: hs.enrollment.class.centerId, now });
  return { ok: true, data: { dungOBai, dungSai, lop: xepLopPhucHoc({ dungOBai, dungSai, lop: ungVien }) } };
}

async function napHoSo(tx: Tx, id: string) {
  const hs = await tx.studentReserve.findUnique({
    where: { id },
    select: {
      id: true, status: true, type: true, studentId: true, enrollmentId: true, centerId: true, orgUnitId: true, snapStoppedAtLessonOrder: true, createdByUserId: true,
    },
  });
  if (!hs) throw new LoiNhieu(["Không tìm thấy hồ sơ bảo lưu."]);
  if (!(await laBaoLuuBat(hs.orgUnitId))) throw new LoiNhieu([LOI_BAO_LUU_TAT]);
  return hs;
}

// ─────────────────────────────────────────────────────────────────────────────
// BÁO PHỤC HỌC
// ─────────────────────────────────────────────────────────────────────────────

export async function baoPhucHoc(input: { reserveId: string; ghiChu: string }, nguoi: NguoiLam, now: Date): Promise<KetQua<{ reserveId: string }>> {
  const ghiChu = input.ghiChu.trim();
  if (ghiChu.length < 5) return { ok: false, loi: ["Ghi nội dung phụ huynh báo (ít nhất 5 ký tự)."] };
  try {
    return await db.$transaction(async (tx) => {
      const hs = await napHoSo(tx, input.reserveId);
      if (hs.status === "RESUME_PENDING") throw new LoiNhieu(["Hồ sơ đã ở trạng thái chờ phục học."]);
      if (!(TRANG_THAI_CO_THE_PHUC_HOC as readonly string[]).includes(hs.status)) throw new LoiNhieu(["Chỉ báo phục học cho hồ sơ đang bảo lưu."]);
      await chuyenTrangThai(tx, {
        reserveId: hs.id, den: "RESUME_PENDING", actor: nguoiThucHien(nguoi), now, kind: "RESUME_REQUEST", note: ghiChu,
        patch: { lastContactAt: now },
      });
      return { ok: true as const, data: { reserveId: hs.id } };
    }, TX);
  } catch (err) {
    return dich(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHỤC HỌC
// ─────────────────────────────────────────────────────────────────────────────

export type KetQuaPhucHoc = { reserveId: string; classId: string; huong: LopPhucHoc["huong"]; soBuoiBuDaSinh: number; thieuBuoiBu: number };

export async function phucHoc(input: { reserveId: string; lopMoiId: string; ghiChu?: string | null }, nguoi: NguoiLam, now: Date): Promise<KetQua<KetQuaPhucHoc>> {
  try {
    return await db.$transaction(async (tx) => {
      const hs = await napHoSo(tx, input.reserveId);
      if (!(TRANG_THAI_CO_THE_PHUC_HOC as readonly string[]).includes(hs.status)) throw new LoiNhieu(["Hồ sơ không ở trạng thái phục học được."]);
      if (!hs.enrollmentId) throw new LoiNhieu(["Hồ sơ không gắn ghi danh — xử lý ở màn hồ sơ cũ."]);

      // BR-21: không còn nợ quá hạn (ngưỡng 0 ngày — khác BR-06 là ngưỡng khi DUYỆT).
      const no = chanDuyetVeNo(await docKhoanDenHan(tx, { enrollmentId: hs.enrollmentId, studentId: hs.studentId }), 0, now);
      if (no) throw new LoiNhieu([`${no} Thu đủ khoản quá hạn rồi mới phục học.`]);

      const gd = await tx.enrollment.findUnique({
        where: { id: hs.enrollmentId },
        select: { id: true, status: true, studentId: true, courseId: true, classId: true, class: { select: { centerId: true } } },
      });
      if (!gd) throw new LoiNhieu(["Ghi danh của hồ sơ không còn."]);
      if (gd.status !== "PAUSED") throw new LoiNhieu(["Ghi danh không còn ở trạng thái bảo lưu."]);

      const dungSai = await getSetting("pause.resumeLessonTolerance", { orgUnitId: hs.orgUnitId });
      const dungOBai = hs.snapStoppedAtLessonOrder ?? 0;
      const ungVien = await layUngVienLop(tx, { courseId: gd.courseId, centerId: gd.class.centerId, now });
      const chon = xepLopPhucHoc({ dungOBai, dungSai, lop: ungVien }).find((l) => l.classId === input.lopMoiId);
      if (!chon) throw new LoiNhieu([`Lớp này không phù hợp: bài hiện tại lệch quá ${dungSai} bài so với chỗ bé dừng (bài ${dungOBai}) hoặc không cùng khoá/cơ sở.`]);

      // Truy vết "học viên trước đó ở trạng thái ghi danh nào" để gỡ PAUSED về ĐÚNG (ACTIVE vs STUDYING).
      const sk = await tx.studentReserveEvent.findFirst({ where: { reserveId: hs.id, kind: "START" }, orderBy: { at: "desc" }, select: { after: true } });
      const truoc = (sk?.after as { enrollmentStatusTruoc?: string | null } | null)?.enrollmentStatusTruoc ?? null;

      const doiLop = chon.classId !== gd.classId;
      if (doiLop) {
        const trung = await tx.enrollment.findFirst({ where: { studentId: gd.studentId, classId: chon.classId, deletedAt: null }, select: { id: true } });
        if (trung) throw new LoiNhieu(["Học viên đã có ghi danh trong lớp này."]);
        await tx.enrollment.update({ where: { id: gd.id }, data: { classId: chon.classId } });
        await writeAudit({
          tx, actor: nguoi, module: "students", entityType: "Enrollment", entityId: gd.id, action: "BAO_LUU_PHUC_HOC_DOI_LOP",
          oldValues: { classId: gd.classId }, newValues: { classId: chon.classId, huong: chon.huong }, reason: "Phục học sau bảo lưu",
          orgUnitId: hs.orgUnitId ?? hs.centerId,
        });
        await syncConversationMembership(tx, gd.classId); // lớp cũ: không còn học viên này
      }

      await goPausedKhiKetThuc(tx, {
        hoSo: { id: hs.id, studentId: hs.studentId, enrollmentId: hs.enrollmentId, centerId: hs.centerId, orgUnitId: hs.orgUnitId },
        actor: nguoiThucHien(nguoi), now, lyDo: "Phục học sau bảo lưu", truoc,
      });

      // BR-22 lớp đi trước: sinh buổi bù PHUC_HOC cho các bài bé chưa học, KHÔNG trừ hạn mức, KHÔNG đòi phí.
      let daSinh = 0;
      let thieu = 0;
      if (chon.huong === "BU") {
        const buoi = await tx.classSession.findMany({
          where: { classId: chon.classId, status: { not: "CANCELLED" }, date: { lt: vnStartOfDay(now) } },
          select: { id: true, lessonId: true, plan: { select: { order: true } }, lesson: { select: { order: true } } },
        });
        const can = buoi.filter((b) => {
          const so = soBuoiTheoLoTrinh({ planOrder: b.plan?.order ?? null, lessonOrder: b.lesson?.order ?? null });
          return so !== null && so > dungOBai && so < (chon.baiHienTai ?? 0);
        });
        const cs = await tx.class.findUnique({ where: { id: chon.classId }, select: { centerId: true } });
        if (can.length > 0) {
          const r = await tx.makeupNeed.createMany({
            data: can.map((b) => ({
              studentId: hs.studentId, classId: chon.classId, centerId: cs?.centerId ?? null, missedSessionId: b.id, missedLessonId: b.lessonId,
              status: "PENDING" as const, nguon: NGUON_PHUC_HOC, createdById: nguoi.id, note: "Bù bài chưa học khi phục học vào lớp đi trước",
            })),
            skipDuplicates: true,
          });
          daSinh = r.count;
        }
        thieu = Math.max(0, chon.soBuoiBu - can.length);
      }

      // Đóng hồ sơ: ACTIVE → ENDED trực tiếp (Q4: phục học sớm không cần duyệt riêng); OVERDUE/NOTICE_SENT đi qua RESUME_PENDING.
      if (hs.status === "OVERDUE" || hs.status === "NOTICE_SENT") {
        await chuyenTrangThai(tx, { reserveId: hs.id, den: "RESUME_PENDING", actor: nguoiThucHien(nguoi), now, kind: "RESUME_REQUEST", note: input.ghiChu ?? null });
      }
      await chuyenTrangThai(tx, {
        reserveId: hs.id, den: "ENDED", actor: nguoiThucHien(nguoi), now, kind: "RESUME", note: input.ghiChu ?? null,
        patch: { endKind: "RESUMED", resumeClassId: chon.classId, endReason: input.ghiChu?.trim() || "Phục học" },
        sauThem: { classId: chon.classId, doiLop, huong: chon.huong, lech: chon.lech, soBuoiBuDaSinh: daSinh, thieuBuoiBu: thieu, hocLaiTu: chon.hocLaiTu, hocLaiDen: chon.hocLaiDen },
      });
      // ĐIỂM MÓC ZNS "đã xếp phục học" (spec §G) — mẫu chờ Zalo duyệt, chưa ai nghe. Cùng giao dịch với việc đóng hồ sơ.
      await publishEvent(
        "bao-luu.phuc-hoc",
        { reserveId: hs.id, studentId: hs.studentId, enrollmentId: hs.enrollmentId, centerId: hs.centerId, classId: chon.classId, huong: chon.huong, soBuoiBuDaSinh: daSinh },
        { tx, dedupeKey: `bao-luu.resume:${hs.id}` },
      );
      return { ok: true as const, data: { reserveId: hs.id, classId: chon.classId, huong: chon.huong, soBuoiBuDaSinh: daSinh, thieuBuoiBu: thieu } };
    }, TX);
  } catch (err) {
    return dich(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BR-24 — KHÔNG CÓ LỚP PHÙ HỢP ⇒ CHUYỂN LOẠI CENTER
// ─────────────────────────────────────────────────────────────────────────────

/** PARENT đã báo phục học (RESUME_PENDING) mà Trung tâm không xếp được lớp phù hợp ⇒ loại CENTER (Trung tâm nợ bé một lớp). Ghi sự kiện CONVERT_CENTER. */
export async function chuyenSangTrungTam(input: { reserveId: string; lyDo: string }, nguoi: NguoiLam, now: Date): Promise<KetQua<{ reserveId: string }>> {
  const lyDo = input.lyDo.trim();
  if (lyDo.length < 5) return { ok: false, loi: ["Ghi lý do (ít nhất 5 ký tự)."] };
  try {
    return await db.$transaction(async (tx) => {
      const hs = await napHoSo(tx, input.reserveId);
      if (hs.type === "CENTER") throw new LoiNhieu(["Hồ sơ đã thuộc loại Trung tâm."]);
      if (hs.status !== "RESUME_PENDING") throw new LoiNhieu(["Chỉ chuyển sang Trung tâm khi phụ huynh đã báo phục học và đang chờ xếp lớp."]);
      // Cổng thật: còn lớp phù hợp thì KHÔNG chuyển (chuyển vì lười xếp lớp là đổi nghĩa vụ từ phụ huynh sang Trung tâm).
      const g = await goiYLopPhucHocTrongTx(tx, hs.id, now);
      if (g.lop.length > 0) throw new LoiNhieu([`Còn ${g.lop.length} lớp phù hợp — hãy xếp lớp phục học thay vì chuyển sang Trung tâm.`]);
      const upd = await tx.studentReserve.updateMany({ where: { id: hs.id, status: "RESUME_PENDING", type: hs.type }, data: { type: "CENTER" } });
      if (upd.count !== 1) throw new LoiNhieu(["Hồ sơ vừa được người khác xử lý — tải lại trang rồi thử lại."]);
      await ghiSuKien(tx, { hoSo: hs, kind: "CONVERT_CENTER", actor: nguoiThucHien(nguoi), at: now, before: { type: hs.type }, after: { type: "CENTER" }, note: lyDo });
      await writeAudit({
        tx, actor: nguoi, module: "students", entityType: "StudentReserve", entityId: hs.id, action: "BAO_LUU_CONVERT_CENTER",
        oldValues: { type: hs.type }, newValues: { type: "CENTER" }, reason: lyDo, orgUnitId: hs.orgUnitId ?? hs.centerId,
      });
      return { ok: true as const, data: { reserveId: hs.id } };
    }, TX);
  } catch (err) {
    return dich(err);
  }
}

async function goiYLopPhucHocTrongTx(tx: Tx, reserveId: string, now: Date): Promise<GoiYPhucHoc> {
  const hs = await tx.studentReserve.findUniqueOrThrow({
    where: { id: reserveId },
    select: { orgUnitId: true, snapStoppedAtLessonOrder: true, enrollment: { select: { courseId: true, class: { select: { centerId: true } } } } },
  });
  if (!hs.enrollment) return { dungOBai: 0, dungSai: 0, lop: [] };
  const dungSai = await getSetting("pause.resumeLessonTolerance", { orgUnitId: hs.orgUnitId });
  const dungOBai = hs.snapStoppedAtLessonOrder ?? 0;
  const ungVien = await layUngVienLop(tx, { courseId: hs.enrollment.courseId, centerId: hs.enrollment.class.centerId, now });
  return { dungOBai, dungSai, lop: xepLopPhucHoc({ dungOBai, dungSai, lop: ungVien }) };
}
