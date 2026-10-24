// lib/parttime/sua-buoi-da-qua-db.ts — ĐỌC của "Sửa buổi đã qua": nhật ký theo buổi (QLCS) / theo người (Công tháng của tôi) + kỳ
// công đã chốt. Đường GHI `suaBuoiDaQua` nằm ở cửa ghi duy nhất `phan-cong-db.ts` (lưới [PT3-W-DG2]) — re-export ở đây.
import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
export { suaBuoiDaQua, type YeuCauSuaBuoi, type KetQuaSuaBuoi } from "./phan-cong-db";
import { ENTITY_SUA_QUA, HANH_DONG_SUA_QUA, type TruongSua } from "./sua-buoi-da-qua";

type Tx = Prisma.TransactionClient;

// ─── Đọc nhật ký (QLCS trên dòng buổi · giáo viên ở "Công tháng của tôi") ──────────────────────────
// /admin/audit-log chỉ Quản trị tối cao mở được ⇒ nhật ký đọc NGAY nơi người cần đối soát đứng (tiền lệ "log của đơn đọc trên
// trang đơn"). Hai câu tra, không phụ thuộc số buổi.

export type DongNhatKySua = {
  id: string;
  luc: string; // ISO
  nguoiSua: string;
  sourceId: string;
  buoi: string;
  ngay: string;
  truong: TruongSua;
  tu: string | null;
  den: string | null;
  lyDo: string | null;
};

const TRUONG_HOP_LE = new Set<string>(["MAIN_TEACHER", "TEACHING_ASSISTANT", "THUC_DAY"]);

function sangDong(a: { id: string; createdAt: Date; actorName: string | null; entityId: string; oldValues: Prisma.JsonValue; newValues: Prisma.JsonValue; reason: string | null }): DongNhatKySua | null {
  const o = (a.oldValues ?? {}) as Record<string, unknown>;
  const n = (a.newValues ?? {}) as Record<string, unknown>;
  const truong = String(n.truong ?? "");
  if (!TRUONG_HOP_LE.has(truong)) return null;
  return {
    id: a.id,
    luc: a.createdAt.toISOString(),
    nguoiSua: a.actorName ?? "Hệ thống",
    sourceId: a.entityId,
    buoi: typeof n.buoi === "string" ? n.buoi : "",
    ngay: typeof n.ngay === "string" ? n.ngay : "",
    truong: truong as TruongSua,
    tu: typeof o.ten === "string" ? o.ten : null,
    den: typeof n.ten === "string" ? n.ten : null,
    lyDo: a.reason,
  };
}

const CHON = { id: true, createdAt: true, actorName: true, entityId: true, oldValues: true, newValues: true, reason: true } as const;

/** Nhật ký sửa của các buổi đang hiện trên màn tuần — mới nhất trước, theo sourceId. */
export async function docNhatKySuaTheoBuoi(sourceIds: readonly string[]): Promise<Map<string, DongNhatKySua[]>> {
  const ra = new Map<string, DongNhatKySua[]>();
  if (sourceIds.length === 0) return ra;
  const rows = await db.auditLog.findMany({
    where: { entityType: ENTITY_SUA_QUA, action: HANH_DONG_SUA_QUA, entityId: { in: [...sourceIds] } },
    orderBy: { createdAt: "desc" },
    select: CHON,
  });
  for (const r of rows) {
    const d = sangDong(r);
    if (d) ra.set(d.sourceId, [...(ra.get(d.sourceId) ?? []), d]);
  }
  return ra;
}

/** Nhật ký sửa buổi đã qua LIÊN QUAN tới `userId` (là người cũ hoặc người mới), buổi trong [tu, den]. */
export async function docNhatKySuaCuaToi(p: { userId: string; tu: string; den: string }): Promise<DongNhatKySua[]> {
  const rows = await db.auditLog.findMany({
    where: { entityType: ENTITY_SUA_QUA, action: HANH_DONG_SUA_QUA, newValues: { path: ["nguoiLienQuan"], array_contains: [p.userId] } },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: CHON,
  });
  return rows.map(sangDong).filter((d): d is DongNhatKySua => d != null && d.ngay >= p.tu && d.ngay <= p.den);
}

/** Các kỳ công (YYYY-MM) ĐÃ CHỐT của cơ sở trong tập `keys` — màn dùng để không vẽ nút sẽ ăn từ chối (luật 12). */
export async function docKyDaChot(centerId: string, keys: readonly string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await db.attendancePeriod.findMany({ where: { centerId, periodKey: { in: [...keys] }, status: "LOCKED" }, select: { periodKey: true } });
  return new Set(rows.map((r) => r.periodKey));
}
