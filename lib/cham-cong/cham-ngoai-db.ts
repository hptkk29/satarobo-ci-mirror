// lib/cham-cong/cham-ngoai-db.ts — đọc dữ liệu cho `quyenChamNgoai` (ca hôm nay + đơn còn hiệu lực +
// dung sai) để TRANG quyết có hiện nút "Chấm công" ngoài điểm chấm không. Cùng hàm thuần với cổng
// của action (`cong-tac-action.ts`) và luật vị trí (`timelog.ts`) — nút hiện ⇔ bấm được (luật 12).
import "server-only";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings/service";
import { vnDateOnly } from "@/lib/time/vn";
import { quyenChamNgoai, type QuyenChamNgoai } from "./cham-ngoai";
import { docDonHieuLucNgay } from "./don-trong-ngay-db";
import { vnMinuteOfDay } from "./recompute";

export async function quyenChamNgoaiLucNay(userId: string, now: Date): Promise<QuyenChamNgoai | null> {
  const homNay = vnDateOnly(now);
  const [ca, don] = await Promise.all([
    db.shiftAssignment.findFirst({
      where: { userId, workDate: homNay, status: "ACTIVE" },
      select: { placeMode: true, orgUnitId: true },
    }),
    docDonHieuLucNgay(db, userId, homNay),
  ]);
  return quyenChamNgoai({
    placeMode: ca?.placeMode ?? null,
    don,
    phut: vnMinuteOfDay(now),
    dungSaiPhut: await getSetting("shift.chamNgoaiDungSaiPhut", { orgUnitId: ca?.orgUnitId ?? null }),
  });
}
