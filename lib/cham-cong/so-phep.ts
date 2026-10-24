// lib/cham-cong/so-phep.ts — ĐƯỜNG GHI DUY NHẤT của SỔ PHÉP NĂM (P2.1A, 11/10/2026).
//
// Khuôn `nghi-bu.ts`: mọi phép ghi đi qua `ghiButToanPhep`, TRONG giao dịch của nơi gọi, dưới khoá tư
// vấn theo người (`so-phep:<userId>`), chống ghi trùng bằng `khoa` UNIQUE — duyệt đơn bị thử lại hay
// huỷ hai lần đều KHÔNG trừ / hoàn hai lần.
//
// CÔNG TẮC: `shift.soPhepBat` (mặc định TẮT). Tắt ⇒ duyệt đơn nghỉ KHÔNG đụng sổ. Hoàn khi huỷ thì
// LUÔN chạy nếu đơn từng bị trừ (kể cả khi công tắc đã tắt sau đó) — không thì sổ lệch vĩnh viễn.
import type { Prisma, PrismaClient } from "@prisma/client";
import { getSetting } from "@/lib/settings/service";
import type { CenterMap } from "./place";
import { loiButToan, namPhep, phutTruCaNgay, type LoaiButToanPhep } from "./so-phep-thuan";

type Client = Pick<PrismaClient, "leaveLedger"> | Prisma.TransactionClient;

export async function soDuPhep(client: Client, q: { userId: string; leaveTypeId: string; year: number }): Promise<number> {
  const r = await client.leaveLedger.aggregate({ where: q, _sum: { minutes: true } });
  return r._sum.minutes ?? 0;
}

/** Khoá tư vấn theo người, trong giao dịch — hai lượt duyệt nghỉ cùng lúc không cùng đọc một số dư. */
export async function khoaSoPhep(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`so-phep:${userId}`}))`;
}

export type GhiButToanInput = {
  userId: string;
  centerId: string;
  orgUnitId: string | null;
  leaveTypeId: string;
  year: number;
  minutes: number;
  transactionType: LoaiButToanPhep;
  sourceType: string | null;
  sourceId: string | null;
  /** Khoá chống trùng. null chỉ dùng cho bút toán tay KHÔNG gắn nguồn (mỗi lần bấm là một dòng). */
  khoa: string | null;
  effectiveDate: Date;
  note: string | null;
  createdById: string | null;
  /** Chính sách ứng phép — BẮT BUỘC khai (luật 7): mặc định nguy hiểm không được ngầm định. */
  choAm: boolean;
};

export type KetQuaGhiPhep =
  | { ok: true; daCo: boolean; soDuTruoc: number; soDuSau: number }
  | { ok: false; error: string; soDu: number };

/**
 * Ghi một bút toán. `khoa` đã có ⇒ KHÔNG ghi lại, trả `daCo: true` (idempotent). Trừ mà số dư không đủ
 * và chính sách không cho ứng ⇒ `ok: false` — nơi gọi trong giao dịch duyệt đơn phải NÉM để rollback.
 */
export async function ghiButToanPhep(tx: Prisma.TransactionClient, input: GhiButToanInput): Promise<KetQuaGhiPhep> {
  const loi = loiButToan(input.transactionType, input.minutes);
  if (loi) return { ok: false, error: loi, soDu: 0 };
  await khoaSoPhep(tx, input.userId);
  if (input.khoa) {
    const co = await tx.leaveLedger.findUnique({ where: { khoa: input.khoa }, select: { balanceBefore: true, balanceAfter: true } });
    if (co) return { ok: true, daCo: true, soDuTruoc: co.balanceBefore, soDuSau: co.balanceAfter };
  }
  const truoc = await soDuPhep(tx, { userId: input.userId, leaveTypeId: input.leaveTypeId, year: input.year });
  const sau = truoc + input.minutes;
  if (input.minutes < 0 && sau < 0 && !input.choAm) {
    return { ok: false, error: `Quỹ phép năm ${input.year} còn ${truoc} phút — không đủ để trừ ${-input.minutes} phút`, soDu: truoc };
  }
  await tx.leaveLedger.create({
    data: {
      userId: input.userId,
      centerId: input.centerId,
      orgUnitId: input.orgUnitId,
      leaveTypeId: input.leaveTypeId,
      year: input.year,
      minutes: input.minutes,
      transactionType: input.transactionType,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      khoa: input.khoa,
      effectiveDate: input.effectiveDate,
      balanceBefore: truoc,
      balanceAfter: sau,
      note: input.note,
      createdById: input.createdById,
    },
  });
  return { ok: true, daCo: false, soDuTruoc: truoc, soDuSau: sau };
}

export type CauHinhSoPhep = { bat: boolean; maLoai: string; phutMotNgay: number; choAm: boolean };

/** Đọc 4 khoá `shift.soPhep*` (không theo cơ sở — chính sách phép là chính sách công ty). */
export async function docCauHinhSoPhep(): Promise<CauHinhSoPhep> {
  const [bat, maLoai, phutMotNgay, choAm] = await Promise.all([
    getSetting("shift.soPhepBat"),
    getSetting("shift.soPhepMaLoai"),
    getSetting("shift.soPhepPhutMotNgay"),
    getSetting("shift.soPhepChoAm"),
  ]);
  return { bat, maLoai, phutMotNgay, choAm };
}

/** orgUnit của một cơ sở theo bản đồ đã nạp (Hội sở không có trong bản đồ ⇒ null). */
export const orgUnitCuaCoSo = (map: CenterMap, centerId: string): string | null =>
  Object.values(map.byCode).find((c) => c.centerId === centerId)?.orgUnitId ?? null;

/**
 * Đơn nghỉ loại `maLoai` có trừ quỹ phép khi duyệt không — MỘT câu hỏi cho cả đường duyệt
 * (`truPhepKhiDuyet`) lẫn mọi câu chữ báo trước cho người nộp / người duyệt (`khiDuyetSe`).
 */
export const truQuyPhepCho = (cauHinh: Pick<CauHinhSoPhep, "bat" | "maLoai">, maLoai: string | null | undefined): boolean =>
  cauHinh.bat && !!maLoai && maLoai === cauHinh.maLoai;

export const khoaTruDon = (donId: string, year: number) => `LEAVE_USED:${donId}:${year}`;
export const khoaHoanDon = (donId: string, year: number) => `LEAVE_REFUND:${donId}:${year}`;

/** Phần sổ phép của `hieuQua` một đơn nghỉ đã duyệt — để màn đơn và lượt huỷ đọc lại. */
export type HieuQuaSoPhep = { theoNam: { year: number; phut: number }[]; soNgayChuaXepCa: number } | null;

/**
 * Trừ quỹ khi DUYỆT một đơn nghỉ. Trả null khi công tắc tắt hoặc loại nghỉ không trừ quỹ. Lỗi ⇒ NÉM qua
 * `loiNem` để giao dịch duyệt rollback cả cụm (đơn về PENDING, ô ca không đổi).
 */
export async function truPhepKhiDuyet(
  tx: Prisma.TransactionClient,
  opts: {
    cauHinh: CauHinhSoPhep;
    leaveType: { id: string; code: string } | null;
    don: { id: string; requesterId: string; fromDate: Date };
    centerId: string;
    orgUnitId: string | null;
    actorId: string;
    /** Nghỉ một phần ca: số phút trong ca. Nghỉ cả ngày: danh sách ngày + có phải ngày làm việc. */
    phan: { kieu: "MOT_PHAN"; phut: number } | { kieu: "CA_NGAY"; ngay: { ngay: Date; laNgayLamViec: boolean | null }[] };
    loiNem: (msg: string) => Error;
  },
): Promise<HieuQuaSoPhep> {
  const { cauHinh, leaveType, don } = opts;
  if (!leaveType || !truQuyPhepCho(cauHinh, leaveType.code)) return null;
  let theoNam: Map<number, number>;
  let soNgayChuaXepCa = 0;
  if (opts.phan.kieu === "MOT_PHAN") {
    theoNam = new Map([[namPhep(don.fromDate), opts.phan.phut]]);
  } else {
    soNgayChuaXepCa = opts.phan.ngay.filter((n) => n.laNgayLamViec === null).length;
    theoNam = phutTruCaNgay(
      opts.phan.ngay.map((n) => ({ ngay: n.ngay, laNgayLamViec: n.laNgayLamViec === true })),
      cauHinh.phutMotNgay,
    ).theoNam;
  }
  const out: { year: number; phut: number }[] = [];
  for (const [year, phut] of [...theoNam.entries()].sort((a, b) => a[0] - b[0])) {
    if (phut <= 0) continue;
    const r = await ghiButToanPhep(tx, {
      userId: don.requesterId,
      centerId: opts.centerId,
      orgUnitId: opts.orgUnitId,
      leaveTypeId: leaveType.id,
      year,
      minutes: -phut,
      transactionType: "LEAVE_USED",
      sourceType: "WorkRequest",
      sourceId: don.id,
      khoa: khoaTruDon(don.id, year),
      effectiveDate: don.fromDate,
      note: `Duyệt đơn nghỉ ${leaveType.code}`,
      createdById: opts.actorId,
      choAm: cauHinh.choAm,
    });
    if (!r.ok) throw opts.loiNem(r.error);
    out.push({ year, phut });
  }
  return { theoNam: out, soNgayChuaXepCa };
}

/**
 * Hoàn quỹ khi HUỶ một đơn nghỉ đã duyệt: mọi bút toán LEAVE_USED của đơn ⇒ một LEAVE_REFUND cùng năm,
 * cùng độ lớn. Không phụ thuộc công tắc (xem đầu file). Huỷ hai lần ⇒ khoá chống trùng ⇒ không hoàn đôi.
 */
export async function hoanPhepKhiHuy(
  tx: Prisma.TransactionClient,
  opts: { donId: string; actorId: string; ngayHuy: Date },
): Promise<{ year: number; phut: number }[]> {
  const tru = await tx.leaveLedger.findMany({
    where: { sourceType: "WorkRequest", sourceId: opts.donId, transactionType: "LEAVE_USED" },
    select: { userId: true, centerId: true, orgUnitId: true, leaveTypeId: true, year: true, minutes: true },
  });
  const out: { year: number; phut: number }[] = [];
  for (const t of tru) {
    const r = await ghiButToanPhep(tx, {
      userId: t.userId,
      centerId: t.centerId,
      orgUnitId: t.orgUnitId,
      leaveTypeId: t.leaveTypeId,
      year: t.year,
      minutes: -t.minutes,
      transactionType: "LEAVE_REFUND",
      sourceType: "WorkRequest",
      sourceId: opts.donId,
      khoa: khoaHoanDon(opts.donId, t.year),
      effectiveDate: opts.ngayHuy,
      note: "Hoàn quỹ — đơn nghỉ đã được huỷ",
      createdById: opts.actorId,
      choAm: true, // bút toán dương, cổng âm không liên quan
    });
    if (r.ok && !r.daCo) out.push({ year: t.year, phut: -t.minutes });
  }
  return out;
}
