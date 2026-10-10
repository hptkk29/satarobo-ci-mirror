import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { scopedDb } from "@/lib/db-scope";
import { getSetting } from "@/lib/settings/service";
import { syncConversationMembership } from "@/lib/chat/sync-membership";
import { laBaoLuuBat } from "@/lib/bao-luu/feature";
import { taoPolicySnapshot } from "@/lib/bao-luu/hoso";
import { dungAnhChupKhiBatDau } from "@/lib/bao-luu/anh-chup-db";
import { docCaCuChuaCoHoSo } from "@/lib/bao-luu/ca-cu-db";
import { datPausedKhiBatDau, ghiHoSoNhapLegacy } from "@/lib/bao-luu/chuyen-trang-thai";
import { coHoSoMoChoGhiDanh, demLanDaDung, docChinhSach } from "@/lib/bao-luu/ngu-canh-db";
import { dich, LoiNhieu, PHU_THUOC_MAC_DINH, type KetQua, type NguoiLam, type PhuThuoc } from "@/lib/bao-luu/dich-vu";
import { kiemLo, lapKeHoachCa, ngayThat, type CaNhap, type KetQuaCa, type NhomLegacy, type SuThat } from "@/lib/bao-luu/legacy-nhap";

// lib/bao-luu/legacy-nhap-db.ts — NHẬP CA LEGACY: đọc ứng viên 3 nhóm · XEM TRƯỚC (không ghi) · GHI (một giao dịch, tất cả hoặc không). PHIÊN 8, K14.
//
// Luật phán xử nằm ở `legacy-nhap.ts` (thuần); file này chỉ nạp sự thật và ghi. Xem trước và ghi dùng CHUNG `lapKeHoachCa` trên sự thật nạp tại lúc gọi:
// hàm ghi KHÔNG tin bản xem trước mà trình duyệt đang cầm — nó tính lại từ đầu, nên ca đổi trạng thái giữa hai lần bấm sẽ bị chặn.
// Mọi việc nạp/ghi dùng `db` TRẦN (không scope): cổng cơ sở nằm ở action (học viên phải nằm trong tầm nhìn `scopedDb`), vì ghi danh/học viên có thể ở cơ sở khác.

type Sdb = ReturnType<typeof scopedDb>;
const TX = { timeout: 120_000, maxWait: 10_000 } as const;
const VANG = ["ABSENT", "EXCUSED", "ABSENT_EXCUSED", "ABSENT_UNEXCUSED"] as const;

// ─────────────────────────────────────────────────────────────────────────────
// ỨNG VIÊN (cho màn hình) — đọc qua `scopedDb` của người xem
// ─────────────────────────────────────────────────────────────────────────────

export type UngVienA = {
  reserveId: string;
  studentId: string;
  tenHocVien: string;
  maHocVien: string | null;
  enrollmentId: string | null;
  batDauGhiNhan: Date;
  /** Ghi danh của học viên có thể gắn (khi dòng cũ là cả-học-viên). */
  ghiDanhChon: { id: string; ten: string }[];
};
export type UngVienBC = { studentId: string; tenHocVien: string; enrollmentId: string; ten: string; moc: Date | null; mocLa: "NHAT_KY" | "CAP_NHAT" | "BUOI_VANG_CUOI" };
export type UngVienLegacy = { A: UngVienA[]; B: UngVienBC[]; C: UngVienBC[]; catNgang: boolean };

const TRAN_UNG_VIEN = 300;

export async function docUngVienLegacy(sdb: Sdb, now: Date): Promise<UngVienLegacy> {
  // A — dòng cũ còn mở, chưa xử lý theo quy chế.
  const a = await sdb.studentReserve.findMany({
    where: { isActive: true, endedAt: null, approvedAt: null },
    orderBy: { startedAt: "asc" },
    take: TRAN_UNG_VIEN,
    select: {
      id: true, studentId: true, enrollmentId: true, startedAt: true,
      student: { select: { name: true, studentCode: true } },
    },
  });
  const sv = [...new Set(a.map((r) => r.studentId))];
  const gd = sv.length
    ? await sdb.enrollment.findMany({
        where: { studentId: { in: sv }, deletedAt: null, status: { in: ["PAUSED", "ACTIVE", "STUDYING"] } },
        select: { id: true, studentId: true, course: { select: { name: true } }, class: { select: { name: true } } },
      })
    : [];
  const A: UngVienA[] = a.map((r) => ({
    reserveId: r.id,
    studentId: r.studentId,
    tenHocVien: r.student.name,
    maHocVien: r.student.studentCode ?? null,
    enrollmentId: r.enrollmentId,
    batDauGhiNhan: r.startedAt,
    ghiDanhChon: gd.filter((g) => g.studentId === r.studentId).map((g) => ({ id: g.id, ten: `${g.course.name} — ${g.class.name}` })),
  }));

  // B — ghi danh PAUSED không hồ sơ (dùng lại báo cáo chỉ-đọc của Phiên 7).
  const b = await docCaCuChuaCoHoSo(sdb as unknown as Parameters<typeof docCaCuChuaCoHoSo>[0], { maxMonths: 6, now });
  const B: UngVienBC[] = b.slice(0, TRAN_UNG_VIEN).map((x) => ({
    studentId: x.studentId, tenHocVien: x.studentName, enrollmentId: x.enrollmentId, ten: `${x.tenKhoa} — ${x.tenLop}`,
    moc: x.tuNgay, mocLa: x.nguonNgay === "NHAT_KY" ? "NHAT_KY" : "CAP_NHAT",
  }));

  // C — đang học, 4 buổi gần nhất của lớp đều có điểm danh và đều vắng, chưa hồ sơ phủ (định nghĩa của `legacy-3-nhom.sql`).
  const ds = await sdb.enrollment.findMany({
    where: {
      status: { in: ["ACTIVE", "STUDYING", "CONFIRMED"] },
      deletedAt: null,
      student: { deletedAt: null, reserves: { none: { isActive: true, endedAt: null, enrollmentId: null } } },
      class: { deletedAt: null, status: { notIn: ["CANCELLED", "COMPLETED"] } },
      reserves: { none: { isActive: true, endedAt: null } },
    },
    take: TRAN_UNG_VIEN * 2,
    orderBy: { id: "asc" },
    select: {
      id: true, studentId: true, classId: true,
      student: { select: { name: true } }, course: { select: { name: true } }, class: { select: { name: true } },
    },
  });
  const lop = [...new Set(ds.map((e) => e.classId))];
  const buoiCuaLop = new Map<string, { id: string; date: Date }[]>();
  await Promise.all(
    lop.map(async (classId) => {
      const bs = await db.classSession.findMany({
        where: { classId, status: { not: "CANCELLED" }, date: { lte: now } },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        take: 4,
        select: { id: true, date: true },
      });
      buoiCuaLop.set(classId, bs);
    }),
  );
  const tatCaBuoi = [...buoiCuaLop.values()].flat().map((x) => x.id);
  const dd = tatCaBuoi.length
    ? await db.attendance.findMany({
        where: { sessionId: { in: tatCaBuoi }, studentId: { in: ds.map((e) => e.studentId) } },
        select: { sessionId: true, studentId: true, status: true },
      })
    : [];
  const dk = new Map(dd.map((x) => [`${x.sessionId}:${x.studentId}`, x.status as string]));
  const C: UngVienBC[] = [];
  for (const e of ds) {
    const bs = buoiCuaLop.get(e.classId) ?? [];
    if (bs.length < 4) continue;
    if (!bs.every((x) => (VANG as readonly string[]).includes(dk.get(`${x.id}:${e.studentId}`) ?? ""))) continue;
    C.push({
      studentId: e.studentId, tenHocVien: e.student.name, enrollmentId: e.id, ten: `${e.course.name} — ${e.class.name}`,
      moc: bs[bs.length - 1]!.date, mocLa: "BUOI_VANG_CUOI",
    });
    if (C.length >= TRAN_UNG_VIEN) break;
  }
  return { A, B, C, catNgang: a.length >= TRAN_UNG_VIEN || b.length > TRAN_UNG_VIEN || ds.length >= TRAN_UNG_VIEN * 2 };
}

// ─────────────────────────────────────────────────────────────────────────────
// XEM TRƯỚC + GHI
// ─────────────────────────────────────────────────────────────────────────────

type DbLike = Pick<Prisma.TransactionClient, "student" | "enrollment" | "studentReserve">;

type CaDaNap = {
  ca: CaNhap;
  ket: KetQuaCa;
  hocVien: { ten: string; centerId: string | null; orgUnitId: string | null } | null;
  khoa: string | null;
  classId: string | null;
  enrollmentTruoc: string | null;
};

async function napCa(c: DbLike, ca: CaNhap, now: Date, effectiveDate: string): Promise<CaDaNap> {
  const hv = await c.student.findFirst({ where: { id: ca.studentId, deletedAt: null }, select: { id: true, name: true, centerId: true, orgUnitId: true } });
  const reserve =
    ca.nhom === "A" && ca.reserveId
      ? await c.studentReserve.findUnique({
          where: { id: ca.reserveId },
          select: { id: true, studentId: true, enrollmentId: true, isActive: true, endedAt: true, approvedAt: true },
        })
      : null;
  const enrollmentId = ca.enrollmentId ?? reserve?.enrollmentId ?? null;
  const gd = enrollmentId
    ? await c.enrollment.findUnique({
        where: { id: enrollmentId },
        select: { id: true, studentId: true, status: true, deletedAt: true, classId: true, course: { select: { name: true, allowPause: true } } },
      })
    : null;
  const donVi = hv?.orgUnitId ?? null;
  const cs = await docChinhSach(donVi);
  const flagBat = hv ? await laBaoLuuBat(donVi) : false;

  let daCoHoSoMoPhu = false;
  let soLanDaDung = 0;
  if (gd && enrollmentId) {
    if (ca.nhom === "A") {
      daCoHoSoMoPhu =
        (await c.studentReserve.count({
          where: { enrollmentId, id: { not: ca.reserveId ?? "" }, status: { notIn: ["ENDED", "TERMINATED", "REJECTED", "CANCELLED"] } },
        })) > 0;
    } else {
      daCoHoSoMoPhu = await coHoSoMoChoGhiDanh(c as never, { enrollmentId, studentId: ca.studentId, now });
    }
    soLanDaDung = await demLanDaDung(c as never, enrollmentId);
    // Dòng cũ của chính ca nhóm A đã gắn ghi danh thì đã nằm trong số lần dùng — đừng đếm hai lần.
    if (ca.nhom === "A" && reserve?.enrollmentId === enrollmentId && soLanDaDung > 0) soLanDaDung -= 1;
  }

  const st: SuThat = {
    flagBat,
    reserve,
    enrollment: gd ? { id: gd.id, studentId: gd.studentId, status: gd.status, deletedAt: gd.deletedAt, khoaChoPhepBaoLuu: gd.course.allowPause } : null,
    daCoHoSoMoPhu,
    soLanDaDung,
    maxPerEnrollment: cs.maxPerEnrollment,
  };
  const ket = hv
    ? lapKeHoachCa({ ...ca, enrollmentId }, st, { effectiveDate, maxMonths: cs.maxMonths, now })
    : { loi: ["Không tìm thấy học viên."], canhBao: [], ke: null };
  if (hv && !hv.centerId && ket.loi.length === 0) ket.loi.push("Học viên chưa thuộc cơ sở nào — gán cơ sở trước.");
  return {
    ca: { ...ca, enrollmentId },
    ket,
    hocVien: hv ? { ten: hv.name, centerId: hv.centerId, orgUnitId: hv.orgUnitId } : null,
    khoa: gd ? gd.course.name : null,
    classId: gd?.classId ?? null,
    enrollmentTruoc: gd?.status ?? null,
  };
}

export type XemTruocCa = { ca: CaNhap; tenHocVien: string | null; khoa: string | null; enrollmentTruoc: string | null; loi: string[]; canhBao: string[]; ke: KetQuaCa["ke"] };
export type XemTruoc = { ok: boolean; loLoi: string[]; cac: XemTruocCa[] };

async function tinh(cas: readonly CaNhap[], now: Date): Promise<{ loLoi: string[]; dsNap: CaDaNap[] }> {
  const loLoi = kiemLo(cas);
  if (cas.length === 0 || cas.length > 50) return { loLoi, dsNap: [] };
  const effectiveDate = await getSetting("pause.effectiveDate");
  const dsNap: CaDaNap[] = [];
  for (const ca of cas) dsNap.push(await napCa(db, ca, now, effectiveDate));
  return { loLoi, dsNap };
}

const tomTat = (n: CaDaNap): XemTruocCa => ({
  ca: n.ca, tenHocVien: n.hocVien?.ten ?? null, khoa: n.khoa, enrollmentTruoc: n.enrollmentTruoc, loi: n.ket.loi, canhBao: n.ket.canhBao, ke: n.ket.ke,
});

/** CHỈ ĐỌC. Không ghi gì, không đụng kho tệp. */
export async function xemTruocLegacy(cas: readonly CaNhap[], now: Date): Promise<XemTruoc> {
  const { loLoi, dsNap } = await tinh(cas, now);
  const cac = dsNap.map(tomTat);
  return { ok: loLoi.length === 0 && cac.length > 0 && cac.every((x) => x.loi.length === 0), loLoi, cac };
}

export type KetQuaNhap = { soCa: number; reserveIds: string[]; classIds: string[] };

/**
 * GHI một lượt, TẤT CẢ HOẶC KHÔNG: tính lại kế hoạch từ DB; bất kỳ ca nào còn lỗi ⇒ không ghi gì. Tệp đơn được xác minh TRƯỚC giao dịch (I/O chậm).
 * Trong giao dịch: ghi hồ sơ → (nhóm C / A đang học) chuyển ghi danh sang PAUSED → thu hồi nhu cầu bù PENDING của các buổi từ ngày bắt đầu → đồng bộ chat
 * lớp (phụ huynh bé rời nhóm). Một ca hỏng ở bất kỳ bước nào ⇒ NÉM ⇒ cuộn ngược cả lượt.
 */
export async function nhapLegacy(cas: readonly CaNhap[], nguoi: NguoiLam, now: Date, deps: PhuThuoc = PHU_THUOC_MAC_DINH): Promise<KetQua<KetQuaNhap>> {
  const { loLoi, dsNap } = await tinh(cas, now);
  const loi = [...loLoi];
  dsNap.forEach((n, i) => {
    for (const l of n.ket.loi) loi.push(`Ca ${i + 1}${n.hocVien ? ` (${n.hocVien.ten})` : ""}: ${l}`);
  });
  if (loi.length > 0 || dsNap.length === 0) return { ok: false, loi: loi.length ? loi : ["Chưa chọn ca nào."] };

  const khoa = dsNap.map((n) => n.ca.applicationFileKey!).filter(Boolean);
  if (new Set(khoa).size !== khoa.length) return { ok: false, loi: ["Một tệp đơn bị đính kèm cho hai ca — mỗi ca một đơn."] };
  if (!deps.khoDaCauHinh()) return { ok: false, loi: ["Kho tệp bảo lưu chưa cấu hình — báo người vận hành."] };
  for (const k of khoa) {
    const r = await deps.xacMinhTep(k);
    if (!r.ok) return { ok: false, loi: [r.thongDiep] };
  }

  const effectiveDate = await getSetting("pause.effectiveDate");
  try {
    return await db.$transaction(async (tx) => {
      const reserveIds: string[] = [];
      const classIds = new Set<string>();
      for (const n0 of dsNap) {
        // Tính LẠI trong giao dịch, trên chính `tx`: giữa lúc xem trước và lúc ghi, ca có thể đã bị người khác xử lý.
        const n = await napCa(tx, n0.ca, now, effectiveDate);
        if (n.ket.loi.length > 0 || !n.ket.ke || !n.hocVien?.centerId) {
          throw new LoiNhieu([`${n.hocVien?.ten ?? "Ca"}: ${n.ket.loi.join(" ") || "đã thay đổi — tải lại trang"}`]);
        }
        const ke = n.ket.ke;
        const hoSoPhanChieu = { id: n.ca.reserveId ?? "", studentId: n.ca.studentId, enrollmentId: ke.enrollmentId, centerId: n.hocVien.centerId, orgUnitId: n.hocVien.orgUnitId };
        // Nhóm C (và A đang học): chuyển ghi danh sang PAUSED TRƯỚC khi ghi hồ sơ (cùng hàm duy nhất đặt PAUSED).
        if (ke.chuyenGhiDanhSangPaused) {
          await datPausedKhiBatDau(tx, { hoSo: hoSoPhanChieu, actor: nguoi, now, lyDo: "Nhập ca bảo lưu cũ (LEGACY)" });
        }
        const anhChup = await dungAnhChupKhiBatDau(tx, { enrollmentId: ke.enrollmentId, studentId: n.ca.studentId, startedAt: ke.startedAt });
        const cs = await docChinhSach(n.hocVien.orgUnitId);
        const { id } = await ghiHoSoNhapLegacy(tx, {
          reserveId: n.ca.nhom === "A" ? n.ca.reserveId : null,
          nhom: n.ca.nhom,
          data: {
            studentId: n.ca.studentId,
            enrollmentId: ke.enrollmentId,
            centerId: n.hocVien.centerId,
            orgUnitId: n.hocVien.orgUnitId,
            startedAt: ke.startedAt,
            standardEndDate: ke.han,
            applicationFileKey: n.ca.applicationFileKey!,
            policySnapshot: taoPolicySnapshot(cs, now, n.hocVien.orgUnitId) as Prisma.InputJsonValue,
            anhChup,
            hieuLucQuyChe: effectiveDate,
          },
          actor: nguoi,
          now,
        });
        reserveIds.push(id);

        // BR-09 (như duyệt lùi ngày): buổi từ ngày bắt đầu "không tính vắng, không trừ hạn mức bù" ⇒ thu hồi nhu cầu bù PENDING đã sinh cho chúng.
        if (n.classId) {
          classIds.add(n.classId);
          const buoi = await tx.classSession.findMany({ where: { classId: n.classId, date: { gte: ke.startedAt, lte: now } }, select: { id: true } });
          if (buoi.length > 0) {
            await tx.makeupNeed.updateMany({
              where: { studentId: n.ca.studentId, missedSessionId: { in: buoi.map((b) => b.id) }, status: "PENDING" },
              data: { status: "CANCELLED" },
            });
          }
        }
      }
      // Chat (luật 5): đổi roster ⇒ đồng bộ nhóm lớp TRONG CÙNG giao dịch.
      for (const classId of classIds) await syncConversationMembership(tx, classId);
      return { ok: true as const, data: { soCa: reserveIds.length, reserveIds, classIds: [...classIds] } };
    }, TX);
  } catch (err) {
    return dich(err);
  }
}

export { ngayThat };
export type { CaNhap, NhomLegacy };
