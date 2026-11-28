import { getSetting } from "@/lib/settings/service";

import { PHUT_GIU_TOI_DA, PHUT_GIU_TOI_THIEU } from "./giu-kho";

/** Số phút giữ kho cho đơn Online (cấu hình Admin `inventory.onlineReservationMinutes`; mặc định đề xuất 15). Giá trị hỏng ⇒ rơi về 15, không bao giờ ra ngoài [1, 1440]. */
export async function docPhutGiuKho(): Promise<number> {
  const v = await getSetting("inventory.onlineReservationMinutes");
  return typeof v === "number" && Number.isInteger(v) && v >= PHUT_GIU_TOI_THIEU && v <= PHUT_GIU_TOI_DA ? v : 15;
}
