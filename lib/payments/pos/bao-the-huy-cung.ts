import "server-only";
// lib/payments/pos/bao-the-huy-cung.ts — BÁO NGƯỜI TẠO PHIẾU THẺ khi phiếu của họ bị HUỶ KÈM bởi "Dừng học" / "Đổi khoá" (Việc 6 · chốt, rà đối kháng 10/10/2026).
//
// Vì sao: mục 3 huỷ phiếu thẻ MỞ cùng transaction với phiếu gộp. Người bấm Dừng học thấy hộp xác nhận + toast, nhưng người ĐANG GIỮ phiếu thẻ (sale ở quầy, khách đứng cạnh máy) không thấy
// gì — hộp của họ đóng ở lần làm mới kế tiếp. Khách quẹt theo mã cũ thì tiền vào hàng chờ gắn tay (đúng như chủ dự án chốt: không ghi đôi), nhưng sale đã kịp phát mã mới cho phần còn nợ ⇒ quẹt
// lần hai. Thông báo là tín hiệu duy nhất đến ĐÚNG người (màn đơn của họ chỉ báo khi giao dịch đã về — `chonPhieuPosHienThi` bước ba).
//
// Luật: SAU commit (`notifyStaff` không nhận `tx`) · KHÔNG BAO GIỜ làm hỏng việc đã commit · không báo chính người bấm · MỘT thông báo cho MỘT phiếu (dedupe theo phiếu) · nội dung chỉ có mã phiếu
// (không số tiền / tên khách / SĐT — như `pos.sai-ma:`).
import { notifyStaff } from "@/lib/notifications/notify";
import type { TheDaHuyCungPhieuGop } from "./huy-the-cung-phieu-gop";

const VIEC = { DUNG_HOC: "dừng học", DOI_KHOA: "đổi khoá" } as const;

export async function baoNguoiTaoTheDaHuy(x: {
  orderId: string;
  /** Đường nào huỷ — nói đúng việc đã làm (hai đường dùng chung thân `dungHocTrongTx`). */
  nguon: keyof typeof VIEC;
  /** Người bấm — không báo chính họ. BẮT BUỘC (luật 7). */
  actorId: string;
  daHuy: readonly TheDaHuyCungPhieuGop[];
}): Promise<void> {
  for (const the of x.daHuy) {
    if (the.nguoiTaoId === x.actorId) continue;
    try {
      await notifyStaff({
        userIds: [the.nguoiTaoId],
        dedupeKey: `pos.the-huy-cung:${the.intentId}`,
        title: "Phiếu thu thẻ POS của bạn vừa bị huỷ",
        body:
          `Phiếu thẻ mã ${the.ma} đã bị huỷ vì ${VIEC[x.nguon]} một bé cùng mã. ` +
          "ĐỪNG cho khách quẹt theo mã này — nếu khách đã quẹt, khoản đó vào hàng chờ gắn tay của kế toán, không tự ghi vào đơn.",
        href: `/orders/${x.orderId}`,
        entityId: x.orderId,
      });
    } catch (err) {
      console.error(`[pos] báo người tạo phiếu thẻ ${the.intentId} bị huỷ kèm lỗi:`, err);
    }
  }
}
