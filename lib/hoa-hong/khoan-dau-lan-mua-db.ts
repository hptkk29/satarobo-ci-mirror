// lib/hoa-hong/khoan-dau-lan-mua-db.ts — NẠP «chủ» của tiền cố định trong SỔ CÁI (AFF-L2b). CHỈ ĐỌC. Hàm quyết định: `khoan-dau-lan-mua.ts`.
import { WHERE_THUC_THU } from "@/lib/finance/thuc-thu";

import type { Khach } from "./nap-khoan";

/**
 * Khoản thu đang GIỮ dòng `FIXED_PER_PURCHASE` của một lần mua, hoặc `null` nếu sổ chưa có «chủ» nào cho lần mua ấy.
 * Chỉ gọi khi bộ quy tắc đang nạp CÓ rule FIXED — khoản thu của người không dùng FIXED không phát sinh thêm câu tra nào (kết quả cũ KHÔNG đổi).
 * Không lọc theo vai: «đã trả tiền cố định cho lần mua này chưa» là câu hỏi của LẦN MUA, không của vai.
 *
 * Ứng viên = khoản có dòng gốc (ORIGINAL / LATE_ARRIVAL) mang calcKind cố định, theo thứ tự ghi sổ. Một ứng viên CÒN LÀM CHỦ khi:
 *   · khoản ấy còn là THỰC THU (hoàn một phần / hoàn hết vẫn là thực thu: số cố định đã chia theo tỉ lệ hoàn, KHÔNG trả lại ở khoản sau), HOẶC
 *   · ròng các dòng cố định trong ô của nó ≠ 0 (khoản bị từ chối nhưng người duyệt chọn «giữ nguyên» ⇒ tiền vẫn nằm ở đó ⇒ không trả lần hai; còn đang chờ quyết ở hàng chờ `PAYMENT_WITHDRAWN` cũng vậy).
 * Khoản bị TỪ CHỐI / xoá mà số cố định đã được ĐẢO sạch (ròng 0) KHÔNG còn là chủ — không thì số cố định của lần mua mất vĩnh viễn: khoản bị từ chối không phải «khoản thu đủ điều kiện» (Q14a).
 * Đọc ô qua `calcSlot.paymentId`, không qua `paymentId` của dòng: dòng đảo / điều chỉnh mang id của khoản HOÀN / điều chỉnh, không phải khoản gốc.
 */
export async function docChuFixedTrongSo(client: Khach, orderItemId: string): Promise<string | null> {
  const dong = await client.commissionTransaction.findMany({
    where: { orderItemId, calcKind: "FIXED_PER_PURCHASE", calcSlotId: { not: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { entryKind: true, amount: true, calcSlot: { select: { paymentId: true } } },
  });
  const rong = new Map<string, number>();
  const ungVien: string[] = [];
  for (const d of dong) {
    const khoan = d.calcSlot?.paymentId;
    if (!khoan) continue;
    rong.set(khoan, (rong.get(khoan) ?? 0) + d.amount);
    if ((d.entryKind === "ORIGINAL" || d.entryKind === "LATE_ARRIVAL") && !ungVien.includes(khoan)) ungVien.push(khoan);
  }
  if (ungVien.length === 0) return null;
  const conThucThu = new Set((await client.payment.findMany({ where: { ...WHERE_THUC_THU, id: { in: ungVien } }, select: { id: true } })).map((x) => x.id));
  return ungVien.find((id) => conThucThu.has(id) || (rong.get(id) ?? 0) !== 0) ?? null;
}
