"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { xoaCuaChuStore } from "@/lib/disc/store-prisma";
import { xoaKetQuaCuaToi } from "@/lib/disc/vong-doi";

import { docPhienDisc } from "./_lib/phien-disc";

/**
 * Xoá kết quả DISC của CHÍNH người đăng nhập. Thứ tự cố định (luật 5): phiên → zod → ownership trong store.
 * `userId` chỉ lấy từ PHIÊN (cờ tắt / chưa đăng nhập / không phải PARENT ⇒ từ chối, không đọc gì từ input).
 * Bước xác nhận thứ hai (`xacNhan = "XOA"`) kiểm ở SERVER — không chỉ ở nút giao diện.
 * Không có `assertCan`: quyền ở đây là QUYỀN SỞ HỮU (`claimedUserId = userId`), như phần đọc ở `lib/disc/portal-doc.ts`.
 */
export type KetQuaXoaDisc = { ok: true; soBai: number } | { ok: false; error: string };

const inputSchema = z.object({ id: z.string().min(1).max(64).optional(), xacNhan: z.string().max(16) });

export async function xoaKetQuaDiscAction(input: unknown): Promise<KetQuaXoaDisc> {
  const phien = await docPhienDisc();
  if (!phien.ok) return { ok: false, error: phien.loai === "CO_TAT" ? "Tính năng chưa mở." : "Bạn cần đăng nhập để thực hiện." };
  const p = inputSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ." };
  const r = await xoaKetQuaCuaToi({ userId: phien.userId, id: p.data.id, xacNhan: p.data.xacNhan, store: xoaCuaChuStore, now: new Date() });
  if (!r.ok) {
    if (r.loi === "CHUA_XAC_NHAN") return { ok: false, error: "Vui lòng xác nhận xoá ở bước cuối." };
    // Id lạ / của người khác / đã xoá: cùng một thông điệp (không oracle).
    return { ok: false, error: "Không còn kết quả nào để xoá." };
  }
  revalidatePath("/portal/disc");
  return { ok: true, soBai: r.soBai };
}
