// lib/cham-cong/ip-cham-cong-db.ts — THỐNG KÊ quan sát của luật IP (P2.4): mỗi điểm chấm, N ngày gần đây, bao
// nhiêu lượt đã được kiểm, bao nhiêu lượt SẼ BỊ CHẶN nếu siết, bao nhiêu lượt không đọc được IP. Đây là dữ liệu
// để quyết có bật ENFORCE hay không — chế độ OBSERVE sinh ra để đổ vào đây.
import "server-only";
import { db } from "@/lib/db";
import { LUAT_IP } from "./ip-cham-cong";

export type ThongKeIp = { daKiem: number; seBiChan: number; khongXacDinh: number };

/** `wlIds` phải là điểm chấm người xem ĐƯỢC THẤY (trang lọc qua scopedDb trước). */
export async function thongKeIpTheoDiem(wlIds: readonly string[], tu: Date): Promise<Map<string, ThongKeIp>> {
  const out = new Map<string, ThongKeIp>(wlIds.map((id) => [id, { daKiem: 0, seBiChan: 0, khongXacDinh: 0 }]));
  if (wlIds.length === 0) return out;
  const nhom = await db.staffTimeLog.groupBy({
    by: ["workLocationId", "ipRule"],
    where: { workLocationId: { in: [...wlIds] }, loggedAt: { gte: tu }, ipRule: { not: null } },
    _count: { _all: true },
  });
  for (const g of nhom) {
    const t = g.workLocationId ? out.get(g.workLocationId) : undefined;
    if (!t) continue;
    t.daKiem += g._count._all;
    if (g.ipRule === LUAT_IP.NGOAI_DS) t.seBiChan += g._count._all;
    if (g.ipRule === LUAT_IP.KHONG_XAC_DINH) t.khongXacDinh += g._count._all;
  }
  return out;
}
