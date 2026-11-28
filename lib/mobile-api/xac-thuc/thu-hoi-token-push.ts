import type { Prisma } from "@prisma/client";

import type { db } from "@/lib/db";

/**
 * Thu hồi token push của MỘT phiên — gọi từ `thuHoi` (điểm thu hồi phiên DUY NHẤT) để token chết cùng phiên.
 * Tệp riêng, không import dịch vụ nào, để `xac-thuc/dich-vu.ts` và `dich-vu/thiet-bi-push.ts` không import vòng nhau.
 */
type Client = Prisma.TransactionClient | typeof db;

export async function thuHoiTokenCuaPhien(client: Client, mobileSessionId: string, lyDo: string, now: Date): Promise<number> {
  const r = await client.mobilePushToken.updateMany({ where: { mobileSessionId, thuHoiLuc: null }, data: { thuHoiLuc: now, lyDoThuHoi: lyDo } });
  return r.count;
}
