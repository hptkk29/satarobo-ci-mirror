// lib/cham-cong/nghi-bu-db.ts — đọc / điều chỉnh tay QUỸ NGHỈ BÙ cho màn quản lý (đợt 8 đơn từ).
//
// Số dư của một người là Σ MỌI dòng của họ, KHÔNG lọc theo cơ sở: bút toán mang cơ sở chịu công lúc
// phát sinh, người chuyển cơ sở thì quỹ đi theo người. Vì vậy hàm đọc nhận DANH SÁCH NGƯỜI đã được
// trang lọc theo phạm vi (người có ca ở khối đang xem) rồi mới cộng — không bao giờ liệt kê người
// ngoài phạm vi.
import "server-only";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { khoaQuyNghiBu, NGUON_QUY, soDuNghiBu } from "./nghi-bu";
import { loadCenterMap, resolveHomeCenter } from "./home-center";
import { CO_QUY_CAN_RA_SOAT } from "./recompute";

export type DongQuy = { userId: string; soDu: number; congThem: number; daDung: number };

export async function soDuQuyCuaNguoi(userIds: readonly string[]): Promise<Map<string, DongQuy>> {
  const out = new Map<string, DongQuy>();
  if (userIds.length === 0) return out;
  const rows = await db.compTimeLedger.findMany({ where: { userId: { in: [...userIds] } }, select: { userId: true, minutes: true } });
  for (const id of userIds) out.set(id, { userId: id, soDu: 0, congThem: 0, daDung: 0 });
  for (const r of rows) {
    const d = out.get(r.userId)!;
    d.soDu += r.minutes;
    if (r.minutes > 0) d.congThem += r.minutes;
    else d.daDung -= r.minutes;
  }
  return out;
}

export async function lichSuQuy(userIds: readonly string[], take = 50) {
  if (userIds.length === 0) return [];
  return db.compTimeLedger.findMany({
    where: { userId: { in: [...userIds] } },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, userId: true, minutes: true, sourceType: true, sourceId: true, workDate: true, note: true, createdAt: true },
  });
}

export type NgayCanRaSoat = { userId: string; workDate: Date; treo: { nguon: string; phut: number }[] };

/**
 * Ngày mà tính lại công muốn TRỪ quỹ nghỉ bù nhưng quỹ đã được dùng (cờ QUY_NGHI_BU_CAN_RA_SOAT) — phần
 * "treo" đọc từ `ruleSnapshot.quyNghiBuTreo` do chính lượt tính lại ghi (`recompute.ts`).
 */
export async function ngayCanRaSoat(userIds: readonly string[]): Promise<NgayCanRaSoat[]> {
  if (userIds.length === 0) return [];
  const rows = await db.staffAttendanceDay.findMany({
    where: { userId: { in: [...userIds] }, flags: { has: CO_QUY_CAN_RA_SOAT } },
    select: { userId: true, workDate: true, ruleSnapshot: true },
    orderBy: { workDate: "desc" },
    take: 100,
  });
  return rows.map((r) => {
    const t = (r.ruleSnapshot as { quyNghiBuTreo?: unknown } | null)?.quyNghiBuTreo;
    const treo = Array.isArray(t) ? (t as { nguon: string; phut: number }[]).filter((x) => typeof x?.phut === "number") : [];
    return { userId: r.userId, workDate: r.workDate, treo };
  });
}

export type KetQuaDieuChinh = { ok: true; soDuSau: number } | { ok: false; error: string };

/**
 * Điều chỉnh tay (nguồn MANUAL_ADJUSTMENT, BA 5.1). Cổng quyền + "người này thuộc khối" do ACTION kiểm
 * trước khi gọi. Ở đây: lý do bắt buộc, khoá theo người, và trừ thì quỹ không được âm.
 */
export async function dieuChinhQuy(input: {
  userId: string;
  centerId: string;
  phut: number;
  lyDo: string;
  actor: { id: string; name: string };
}): Promise<KetQuaDieuChinh> {
  const lyDo = input.lyDo.trim();
  const map = await loadCenterMap();
  const orgUnitId = Object.values(map.byCode).find((c) => c.centerId === input.centerId)?.orgUnitId ?? null;
  if (lyDo.length < 5) return { ok: false, error: "Ghi lý do điều chỉnh (tối thiểu 5 ký tự)" };
  if (!Number.isInteger(input.phut) || input.phut === 0 || Math.abs(input.phut) > 100 * 60) {
    return { ok: false, error: "Số phút điều chỉnh phải là số nguyên khác 0, tối đa 100 giờ" };
  }
  return db.$transaction(async (tx) => {
    await khoaQuyNghiBu(tx, input.userId);
    const truoc = await soDuNghiBu(tx, input.userId);
    if (truoc + input.phut < 0) {
      // Cổng TRƯỚC phép ghi đầu tiên — `return` ở đây chưa ghi gì nên không cần throw.
      return { ok: false as const, error: `Quỹ hiện còn ${truoc} phút — trừ ${-input.phut} phút sẽ làm quỹ âm` };
    }
    await tx.compTimeLedger.create({
      data: {
        userId: input.userId,
        centerId: input.centerId,
        orgUnitId,
        minutes: input.phut,
        sourceType: NGUON_QUY.DIEU_CHINH,
        note: lyDo,
        createdById: input.actor.id,
      },
    });
    await writeAudit({
      actor: input.actor,
      module: "hr_attendance",
      entityType: "CompTimeLedger",
      entityId: input.userId,
      action: "ADJUST_COMP_TIME",
      oldValues: { soDu: truoc },
      newValues: { soDu: truoc + input.phut, phut: input.phut },
      reason: lyDo,
      orgUnitId,
      tx,
    });
    return { ok: true as const, soDuSau: truoc + input.phut };
  });
}

/**
 * Người này có thuộc khối không — có ca ở khối trong 180 ngày gần đây, hoặc khối là nơi trực thuộc.
 * Action điều chỉnh hỏi hàm này để quản lý cơ sở A không sửa quỹ của người chỉ làm ở cơ sở B.
 */
export async function nguoiThuocKhoi(userId: string, centerId: string, now: Date): Promise<boolean> {
  const tu = new Date(now.getTime() - 180 * 86_400_000);
  const ca = await db.shiftAssignment.findFirst({ where: { userId, centerId, workDate: { gte: tu } }, select: { id: true } });
  if (ca) return true;
  return (await resolveHomeCenter(userId)).centerId === centerId;
}
