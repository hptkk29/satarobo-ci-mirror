// lib/cham-cong/so-phep-db.ts — đọc / điều chỉnh tay / đối soát SỔ PHÉP NĂM cho màn quản lý (P2.1A).
//
// Khuôn `nghi-bu-db.ts`: số dư là Σ MỌI dòng của người đó trong (loại nghỉ × năm), KHÔNG lọc theo cơ sở
// (người chuyển cơ sở thì quỹ đi theo người). Hàm đọc nhận DANH SÁCH NGƯỜI trang đã lọc theo phạm vi.
// Mọi phép GHI đi qua `ghiButToanPhep` — một đường ghi, một khoá, một cổng âm.
import "server-only";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { loadCenterMap } from "./home-center";
import { ghiButToanPhep, orgUnitCuaCoSo } from "./so-phep";
import { doiSoatChuoi, type LechSo } from "./so-phep-thuan";

/** Loại nghỉ mà sổ phép đang trừ (tham số `shift.soPhepMaLoai`). null ⇒ mã cấu hình không tồn tại. */
export async function loaiNghiSoPhep(maLoai: string) {
  return db.leaveType.findUnique({ where: { code: maLoai }, select: { id: true, code: true, name: true } });
}

export type DongSoPhep = { userId: string; soDu: number; daCap: number; daDung: number };

export async function soDuPhepCuaNguoi(
  userIds: readonly string[],
  q: { leaveTypeId: string; year: number },
): Promise<Map<string, DongSoPhep>> {
  const out = new Map<string, DongSoPhep>();
  for (const id of userIds) out.set(id, { userId: id, soDu: 0, daCap: 0, daDung: 0 });
  if (userIds.length === 0) return out;
  const rows = await db.leaveLedger.findMany({
    where: { userId: { in: [...userIds] }, leaveTypeId: q.leaveTypeId, year: q.year },
    select: { userId: true, minutes: true },
  });
  for (const r of rows) {
    const d = out.get(r.userId)!;
    d.soDu += r.minutes;
    if (r.minutes > 0) d.daCap += r.minutes;
    else d.daDung -= r.minutes;
  }
  return out;
}

export async function lichSuPhep(userIds: readonly string[], q: { leaveTypeId: string; year: number }, take = 50) {
  if (userIds.length === 0) return [];
  return db.leaveLedger.findMany({
    where: { userId: { in: [...userIds] }, leaveTypeId: q.leaveTypeId, year: q.year },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, userId: true, minutes: true, transactionType: true, sourceType: true, sourceId: true, note: true, createdAt: true },
  });
}

/** Đối soát chuỗi số dư của những người này — CHỈ BÁO, không sửa. */
export async function doiSoatSoPhep(
  userIds: readonly string[],
  q: { leaveTypeId: string; year: number; choAm: boolean },
): Promise<LechSo[]> {
  if (userIds.length === 0) return [];
  const rows = await db.leaveLedger.findMany({
    where: { userId: { in: [...userIds] }, leaveTypeId: q.leaveTypeId, year: q.year },
    select: { id: true, userId: true, leaveTypeId: true, year: true, minutes: true, balanceBefore: true, balanceAfter: true, createdAt: true },
  });
  return doiSoatChuoi(rows, q.choAm);
}

export type LoaiDieuChinhPhep = "OPENING" | "MANUAL_ADJUSTMENT";
export type KetQuaDieuChinhPhep = { ok: true; soDuSau: number } | { ok: false; error: string };

/**
 * Bút toán tay: cấp quỹ đầu kỳ (OPENING, chỉ dương) hoặc điều chỉnh (hai chiều). Cổng quyền + "người
 * thuộc khối" do ACTION kiểm. Ở đây: lý do ≥ 5 ký tự, giới hạn độ lớn, cổng âm theo chính sách
 * `choAm` (truyền vào, không ngầm định), audit TRONG cùng giao dịch.
 */
export async function dieuChinhSoPhep(input: {
  userId: string;
  centerId: string;
  leaveTypeId: string;
  year: number;
  loai: LoaiDieuChinhPhep;
  phut: number;
  lyDo: string;
  choAm: boolean;
  ngayHieuLuc: Date;
  actor: { id: string; name: string };
}): Promise<KetQuaDieuChinhPhep> {
  const lyDo = input.lyDo.trim();
  if (lyDo.length < 5) return { ok: false, error: "Ghi lý do (tối thiểu 5 ký tự)" };
  if (!Number.isInteger(input.phut) || input.phut === 0 || Math.abs(input.phut) > 60 * 480) {
    return { ok: false, error: "Số phút phải là số nguyên khác 0, tối đa 60 ngày công" };
  }
  if (input.loai === "OPENING" && input.phut < 0) return { ok: false, error: "Cấp quỹ đầu kỳ phải là số dương" };
  const orgUnitId = orgUnitCuaCoSo(await loadCenterMap(), input.centerId);
  return db.$transaction(async (tx) => {
    const r = await ghiButToanPhep(tx, {
      userId: input.userId,
      centerId: input.centerId,
      orgUnitId,
      leaveTypeId: input.leaveTypeId,
      year: input.year,
      minutes: input.phut,
      transactionType: input.loai,
      sourceType: null,
      sourceId: null,
      khoa: null,
      effectiveDate: input.ngayHieuLuc,
      note: lyDo,
      createdById: input.actor.id,
      choAm: input.choAm,
    });
    // Từ chối trước phép ghi đầu tiên (`ghiButToanPhep` chưa ghi gì khi trả ok:false) ⇒ return an toàn.
    if (!r.ok) return { ok: false as const, error: r.error };
    await writeAudit({
      actor: input.actor,
      module: "hr_attendance",
      entityType: "LeaveLedger",
      entityId: input.userId,
      action: input.loai === "OPENING" ? "OPEN_LEAVE_BALANCE" : "ADJUST_LEAVE_BALANCE",
      oldValues: { soDu: r.soDuTruoc, nam: input.year },
      newValues: { soDu: r.soDuSau, phut: input.phut, nam: input.year },
      reason: lyDo,
      orgUnitId,
      tx,
    });
    return { ok: true as const, soDuSau: r.soDuSau };
  });
}
