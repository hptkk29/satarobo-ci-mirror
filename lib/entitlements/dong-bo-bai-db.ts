import "server-only";
// lib/entitlements/dong-bo-bai-db.ts — ĐIỂM DANH / HỌC BÙ ⇒ SỔ CÁI QUYỀN HỌC, ĐỌC–QUYẾT–GHI TRONG TRANSACTION CỦA NGƯỜI GỌI.
//
// Nối `quyetDinhDongBoBai` (hàm thuần, hội tụ) vào đường điểm danh thật. Luật chọn quyền học / lọc cơ sở / kế hoạch ở `diem-danh-so-cai.ts`.
// Tài liệu: docs/thu-hoc-phi-pham-vi/DIEM-DANH-SO-CAI.md.
//
// ── CỜ: ĐỌC NGOÀI TRANSACTION, TẮT = KHÔNG CHẠM DB ──────────────────────────────────────────────────────────────────
//   `docSoCaiDiemDanh` chạy TRƯỚC khi người gọi mở transaction (nó dùng kết nối gốc; đọc cờ trong transaction là cách treo bể kết nối — xem đầu
//   `dich-vu.ts`). Cờ TẮT ⇒ trả `null` ⇒ `dongBoSoCaiNeuBat` trả ngay, KHÔNG một câu truy vấn nào. Cờ hỏi bằng `orgUnitId` của cơ sở và FAIL-CLOSED
//   khi cơ sở không có OrgUnit: `laThuHocPhiTheoPhamViBat(null)` rơi về giá trị TOÀN HỆ, nên cờ riêng của cơ sở bị bỏ qua mà không lỗi nào báo.
//
// ── BẰNG CHỨNG (cho bài L của một học viên trên một khoá) — phải KHỚP KHÍT `dong-bo-bai.ts` ────────────────────────────
//   · CLASS    : Attendance của học viên ở MỌI buổi chưa huỷ của MỌI lớp thuộc khoá mang số bài L (`soBuoiTheoLoTrinh`: plan.order+1, không có
//                plan thì lesson.order). Không chỉ buổi vừa lưu — lưu lại lưới ABSENT sau khi đã bù KHÔNG được làm mất bằng chứng bù.
//   · MAKEUP   : `MakeupNeed.status = COMPLETED` (nguồn ABSENCE/MANUAL/…) mà BUỔI LỠ mang số bài L. Chọn MakeupNeed chứ không MakeupCaseStudent vì mọi đường hoàn tất
//                (case dạy bù + hàm cũ) đều ghi cột này, và `Attendance.makeupStatus = MADE_UP` cũng bám theo nó.
//   · CATCH_UP : như trên nhưng `sourceType = ORDER_CONVERSION` (học vượt — không điểm danh gốc).
//   Số bài của dòng cần bù tính từ BUỔI LỠ bằng cùng hàm với điểm danh, không từ `missedLessonId`: hai cách đếm bài là cách lệch nhau.
//
// ── KHOÁ ────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   Khoá hàng quyền học (FOR UPDATE, theo `id` tăng dần) TRƯỚC khi đọc bằng chứng: hai lượt điểm danh đồng thời cho cùng học viên + bài xếp hàng ở đây,
//   lượt sau đọc được điểm danh ĐÃ COMMIT của lượt trước (READ COMMITTED) nên sổ cái luôn khớp trạng thái cuối. Gọi hàm này Ở CUỐI transaction của
//   người gọi: khoá đơn → khoá điểm danh / dòng cần bù → khoá quyền học (đúng thứ tự `dich-vu.ts`).
//
// ── LỖI ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   Mọi kết quả NGHIỆP VỤ (hết buổi, ngoài phạm vi, quyền học đang bảo lưu…) là giá trị TRẢ VỀ, không ném. Chỉ lỗi cơ sở dữ liệu / lỗi lập trình mới ném —
//   và khi đó điểm danh rollback cùng sổ cái (nhất quán, như dòng cần bù ở T05). KHÔNG bọc try/catch nuốt lỗi: sau một câu SQL lỗi, transaction của Postgres
//   đã hỏng, nuốt lỗi chỉ để lại trạng thái nửa vời.
import { Prisma } from "@prisma/client";
import type { AuditActor } from "@/lib/audit/audit-log";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { soBuoiTheoLoTrinh } from "@/lib/lms/session-order";
import { LY_DO_HUY_MAT_BANG_CHUNG, keHoachBai, locTheoCoSo, type DongSoCaiChoBai, type QuyenHocChoDongBo } from "./diem-danh-so-cai";
import { ghiNhanBaiTrongTx, huyGhiNhanBaiTrongTx, type CoPhamVi } from "./dich-vu";
import type { BangChungBai } from "./dong-bo-bai";
import { laThuHocPhiTheoPhamViBat } from "./feature";
import type { NguonSoCai } from "./tieu-thu";
import type { TrangThaiQuyenHoc } from "./trang-thai";

type Tx = Prisma.TransactionClient;

/** Mọi thứ người gọi cần giữ từ lúc đọc cờ (NGOÀI transaction) tới lúc đồng bộ (TRONG transaction). */
export interface SoCaiDiemDanh {
  /** Cờ ĐÃ ĐỌC và ĐANG BẬT cho `co.centerId`. */
  readonly co: CoPhamVi;
  readonly actor: AuditActor;
  /** Đồng hồ do người gọi truyền (luật 19) — dùng cho `usedAt` / `voidedAt`. */
  readonly now: Date;
}

/**
 * Đọc cờ cho MỘT cơ sở. GỌI TRƯỚC `db.$transaction(…)`. `null` = TẮT (hoặc không xác định được cơ sở) — người gọi truyền thẳng vào `dongBoSoCaiNeuBat`.
 */
export async function docSoCaiDiemDanh(vao: {
  centerId: string | null | undefined;
  actor: AuditActor;
  now: Date;
}): Promise<SoCaiDiemDanh | null> {
  if (!vao.centerId) return null;
  const orgUnitId = await orgUnitIdForCenter(vao.centerId);
  // Cơ sở không có OrgUnit ⇒ KHÔNG hỏi cờ với null (rơi về giá trị toàn hệ): coi là TẮT.
  if (!orgUnitId) return null;
  if (!(await laThuHocPhiTheoPhamViBat(orgUnitId))) return null;
  return { co: { centerId: vao.centerId, bat: true }, actor: vao.actor, now: vao.now };
}

/** "Bài của buổi này, của học viên này" — đơn vị đồng bộ. Buổi là buổi mang bài (buổi điểm danh, hoặc buổi LỠ của dòng cần bù). */
export interface DauVetBuoi {
  readonly studentId: string;
  readonly sessionId: string;
}

export interface MucKhongGhiDuoc {
  readonly studentId: string;
  readonly lessonOrder: number;
  /** Lý do TẦNG GHI từ chối, hoặc `NGOAI_PHAM_VI` từ bước chọn quyền học. */
  readonly lyDo: string;
}

export interface KetQuaDongBoSoCai {
  readonly daGhi: number;
  readonly daHuy: number;
  /** Quyền học khác cơ sở của cờ đã đọc — KHÔNG đụng (xem `locTheoCoSo`). */
  readonly boQuaKhacCoSo: number;
  /** Buổi không xác định được bài (lớp chưa ghim giáo trình) — không đoán. */
  readonly buoiKhongCoBai: number;
  readonly khongGhiDuoc: readonly MucKhongGhiDuoc[];
}

const KQ_RONG: KetQuaDongBoSoCai = { daGhi: 0, daHuy: 0, boQuaKhacCoSo: 0, buoiKhongCoBai: 0, khongGhiDuoc: [] };

/** Vỏ cho người gọi: `soCai = null` (cờ tắt) ⇒ trả ngay, không đụng `tx`. */
export async function dongBoSoCaiNeuBat(
  tx: Tx,
  vao: { soCai: SoCaiDiemDanh | null; dau: readonly DauVetBuoi[] },
): Promise<KetQuaDongBoSoCai> {
  if (vao.soCai === null) return KQ_RONG;
  return dongBoSoCaiTrongTx(tx, { soCai: vao.soCai, dau: vao.dau });
}

/** Điều kiện "buổi mang bài L" — cùng nghĩa `soBuoiTheoLoTrinh`: có plan thì plan.order+1, không plan thì lesson.order. */
function buoiMangBai(lessonOrder: number): Prisma.ClassSessionWhereInput[] {
  return [{ plan: { is: { order: lessonOrder - 1 } } }, { planId: null, lesson: { is: { order: lessonOrder } } }];
}

const tenKhoa = (courseId: string, lessonOrder: number) => `${courseId}\u0000${lessonOrder}`;

export async function dongBoSoCaiTrongTx(tx: Tx, vao: { soCai: SoCaiDiemDanh; dau: readonly DauVetBuoi[] }): Promise<KetQuaDongBoSoCai> {
  const { soCai } = vao;
  if (vao.dau.length === 0) return KQ_RONG;

  // 1. Mỗi buổi → (khoá, số bài). Một câu cho cả lô.
  const buoi = await tx.classSession.findMany({
    where: { id: { in: [...new Set(vao.dau.map((d) => d.sessionId))] } },
    select: { id: true, class: { select: { courseId: true } }, plan: { select: { order: true } }, lesson: { select: { order: true } } },
  });
  const baiCuaBuoi = new Map<string, { courseId: string; lessonOrder: number | null }>(
    buoi.map((b) => [b.id, { courseId: b.class.courseId, lessonOrder: soBuoiTheoLoTrinh({ planOrder: b.plan?.order ?? null, lessonOrder: b.lesson?.order ?? null }) }]),
  );

  let buoiKhongCoBai = 0;
  const nhom = new Map<string, { courseId: string; lessonOrder: number; hocVien: Set<string> }>();
  for (const d of vao.dau) {
    const b = baiCuaBuoi.get(d.sessionId);
    if (!b) continue; // buổi vừa bị xoá: không còn bằng chứng nào để đối chiếu.
    if (b.lessonOrder === null) {
      buoiKhongCoBai++;
      continue;
    }
    const k = tenKhoa(b.courseId, b.lessonOrder);
    const g = nhom.get(k) ?? { courseId: b.courseId, lessonOrder: b.lessonOrder, hocVien: new Set<string>() };
    g.hocVien.add(d.studentId);
    nhom.set(k, g);
  }
  if (nhom.size === 0) return { ...KQ_RONG, buoiKhongCoBai };

  const hocVienId = [...new Set([...nhom.values()].flatMap((g) => [...g.hocVien]))].sort();
  const khoaId = [...new Set([...nhom.values()].map((g) => g.courseId))].sort();

  // 2. KHOÁ quyền học của cơ sở này TRƯỚC khi đọc bằng chứng. Học viên không có quyền học nào ⇒ không khoá gì, không đọc gì thêm.
  await tx.$queryRaw`SELECT "id" FROM "StudyEntitlement"
    WHERE "studentId" IN (${Prisma.join(hocVienId)}) AND "courseId" IN (${Prisma.join(khoaId)})
      AND "centerId" = ${soCai.co.centerId} AND "status" <> 'VOIDED'
    ORDER BY "id" FOR UPDATE`;
  const quyenTho = await tx.studyEntitlement.findMany({
    where: {
      studentId: { in: hocVienId },
      courseId: { in: khoaId },
      status: { not: "VOIDED" },
      startLessonOrder: { not: null },
      endLessonOrder: { not: null },
    },
    select: {
      id: true,
      studentId: true,
      courseId: true,
      centerId: true,
      status: true,
      startLessonOrder: true,
      endLessonOrder: true,
      graceSessionsGranted: true,
      freeMakeupSessions: true,
      createdAt: true,
    },
  });
  if (quyenTho.length === 0) return { ...KQ_RONG, buoiKhongCoBai };

  const { dung, khac } = locTheoCoSo(quyenTho, soCai.co.centerId);
  const boQuaKhacCoSo = khac.length;
  const quyenCuaHocVien = new Map<string, Array<QuyenHocChoDongBo & { courseId: string }>>();
  for (const q of dung) {
    const bai: QuyenHocChoDongBo & { courseId: string } = {
      id: q.id,
      centerId: q.centerId,
      courseId: q.courseId,
      status: q.status as TrangThaiQuyenHoc,
      startLessonOrder: q.startLessonOrder!,
      endLessonOrder: q.endLessonOrder!,
      graceSessionsGranted: q.graceSessionsGranted,
      freeMakeupSessions: q.freeMakeupSessions,
      createdAt: q.createdAt,
    };
    const k = `${q.studentId}\u0000${q.courseId}`;
    const ds = quyenCuaHocVien.get(k) ?? [];
    ds.push(bai);
    quyenCuaHocVien.set(k, ds);
  }

  let daGhi = 0;
  let daHuy = 0;
  const khongGhiDuoc: MucKhongGhiDuoc[] = [];

  for (const g of [...nhom.values()].sort((a, b) => a.courseId.localeCompare(b.courseId) || a.lessonOrder - b.lessonOrder)) {
    const hocVienCoQuyen = [...g.hocVien].filter((id) => quyenCuaHocVien.has(`${id}\u0000${g.courseId}`)).sort();
    if (hocVienCoQuyen.length === 0) continue;
    const idQuyen = hocVienCoQuyen.flatMap((id) => quyenCuaHocVien.get(`${id}\u0000${g.courseId}`)!.map((q) => q.id));

    // 3. Đọc sổ cái + bằng chứng của bài này (một câu mỗi loại, cho cả nhóm học viên).
    const dongTho = await tx.studyEntitlementUsage.findMany({
      where: { entitlementId: { in: idQuyen }, lessonOrder: g.lessonOrder },
      select: { entitlementId: true, studentId: true, source: true, voidedAt: true },
    });
    const diemDanh = await tx.attendance.findMany({
      where: {
        studentId: { in: hocVienCoQuyen },
        session: { status: { not: "CANCELLED" }, class: { courseId: g.courseId }, OR: buoiMangBai(g.lessonOrder) },
      },
      select: { id: true, sessionId: true, studentId: true, status: true },
      orderBy: { id: "asc" },
    });
    const dongCanBu = await tx.makeupNeed.findMany({
      where: { studentId: { in: hocVienCoQuyen }, courseId: g.courseId, status: "COMPLETED" },
      select: { studentId: true, sourceType: true, missedSessionId: true },
    });
    const buoiLoMangBai = dongCanBu.length
      ? new Set(
          (
            await tx.classSession.findMany({
              where: { id: { in: [...new Set(dongCanBu.map((n) => n.missedSessionId))] }, OR: buoiMangBai(g.lessonOrder) },
              select: { id: true },
            })
          ).map((s) => s.id),
        )
      : new Set<string>();

    for (const hv of hocVienCoQuyen) {
      const quyen = quyenCuaHocVien.get(`${hv}\u0000${g.courseId}`)!;
      const dong: DongSoCaiChoBai[] = dongTho
        .filter((d) => d.studentId === hv)
        .map((d) => ({ entitlementId: d.entitlementId, source: d.source as NguonSoCai, voidedAt: d.voidedAt }));
      const cuaHv = diemDanh.filter((a) => a.studentId === hv);
      const bu = dongCanBu.filter((n) => n.studentId === hv && buoiLoMangBai.has(n.missedSessionId));
      const bangChung: BangChungBai = {
        trangThaiDiemDanh: cuaHv.map((a) => a.status),
        hocBuHoanTat: bu.some((n) => n.sourceType !== "ORDER_CONVERSION"),
        hocVuotHoanTat: bu.some((n) => n.sourceType === "ORDER_CONVERSION"),
      };
      const kh = keHoachBai({ quyen, dong, bangChung, lessonOrder: g.lessonOrder });
      for (const lyDo of kh.khongDongBo) khongGhiDuoc.push({ studentId: hv, lessonOrder: g.lessonOrder, lyDo });

      // Buổi lớp có mặt đầu tiên làm "buổi" của dòng sổ cái (truy vết); điểm danh không có (bù/vượt) thì để trống.
      const coMat = cuaHv.find((a) => a.status === "PRESENT" || a.status === "LATE");
      for (const v of kh.viec) {
        if (v.viec === "HUY") {
          const r = await huyGhiNhanBaiTrongTx(
            tx,
            { entitlementId: v.entitlementId, lessonOrder: g.lessonOrder, lyDo: LY_DO_HUY_MAT_BANG_CHUNG, actor: soCai.actor, now: soCai.now },
            soCai.co,
          );
          if (r.daHuy) daHuy++;
          continue;
        }
        // Bài học bù MIỄN PHÍ: tầng ghi chỉ ghi MỘT dòng audit BONUS_LEARN, không dòng sổ cái nào ⇒ không có gì khử trùng được ngoài chính audit.
        if (v.baiBoSung && (await daCoAuditBaiBoSung(tx, v.entitlementId, g.lessonOrder))) continue;
        const r = await ghiNhanBaiTrongTx(
          tx,
          {
            entitlementId: v.entitlementId,
            lessonOrder: g.lessonOrder,
            nguon: v.nguon,
            sessionId: v.nguon === "CLASS" ? (coMat?.sessionId ?? null) : null,
            attendanceId: v.nguon === "CLASS" ? (coMat?.id ?? null) : null,
            actor: soCai.actor,
            now: soCai.now,
          },
          soCai.co,
        );
        if (r.ghi) daGhi++;
        else if (r.lyDo !== "DA_CO" && r.lyDo !== "HOC_BO_SUNG") khongGhiDuoc.push({ studentId: hv, lessonOrder: g.lessonOrder, lyDo: r.lyDo });
      }
    }
  }
  return { daGhi, daHuy, boQuaKhacCoSo, buoiKhongCoBai, khongGhiDuoc };
}

async function daCoAuditBaiBoSung(tx: Tx, entitlementId: string, lessonOrder: number): Promise<boolean> {
  const n = await tx.auditLog.count({
    where: {
      module: "entitlements",
      entityType: "StudyEntitlement",
      entityId: entitlementId,
      action: "BONUS_LEARN",
      newValues: { path: ["lessonOrder"], equals: lessonOrder },
    },
  });
  return n > 0;
}

/** Dùng cho đường tự ghi nhận lý do khi cần log: gom kết quả thành một dòng ngắn (không PII). */
export function tomTatKetQuaDongBo(k: KetQuaDongBoSoCai): string {
  const loi = k.khongGhiDuoc.length;
  return `ghi ${k.daGhi}, huỷ ${k.daHuy}, khác cơ sở ${k.boQuaKhacCoSo}, buổi không có bài ${k.buoiKhongCoBai}, không ghi được ${loi}`;
}
