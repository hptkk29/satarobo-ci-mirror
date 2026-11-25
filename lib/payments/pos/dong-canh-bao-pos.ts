import "server-only";
// lib/payments/pos/dong-canh-bao-pos.ts — ĐÓNG cảnh báo "hủy sau khi đã ghi nhận" của một giao
// dịch thẻ gốc. KHÔNG đụng tiền (kế toán đã gỡ gắn / hoàn bằng luồng hiện có trước khi đóng).
//
// Người gọi (`dongCanhBaoHuyPosAction`) đã kiểm quyền + phạm vi trên CHÍNH bản ghi gốc.
//
// Đóng cảnh báo trên GỐC và KẾT LUẬN luôn các dòng hủy/hoàn đang chờ trỏ vào nó, trong CÙNG một
// transaction. Trước bản vá dòng hủy (không giao dịch, `canhBaoHuy = false`) không có lối đóng
// nào: kế toán xử lý xong nó vẫn nằm mãi ở "Giao dịch thẻ POS cần xử lý", mỗi lần import lại cộng
// vào bộ đếm ⇒ hàng chờ không bao giờ về 0 và dòng MỚI chìm giữa dòng cũ (ca `[POS-DB-16]`).
//
// Gốc bị hủy TOÀN PHẦN mà kế toán đã GỠ GẮN (giao dịch về UNMATCHED) ⇒ lượt đóng đưa giao dịch
// gốc ra khỏi hàng chờ (IGNORED) — đúng luật 6 "gốc chưa ghi nhận + hủy toàn phần". Trước bản vá
// khoản ngân hàng đã trả lại thẻ nằm lại hàng chờ đủ số và GẮN TAY LẠI ĐƯỢC (ca `[POS-DB-23]`):
// sau khi đóng, không còn đường nào đưa nó sang IGNORED (dòng hủy đã BO_QUA, file chia theo ngày).
// Giao dịch còn MATCHED (kế toán hoàn bằng đường khác) ⇒ không đụng — và KHÔNG chặn đóng: chủ dự
// án chốt Q-H 30/09/2026 "cho đóng tự do", ghi chú bắt buộc + audit là đủ.
//
// Hoàn / hủy MỘT PHẦN (Q-G 30/09/2026): gốc có tín hiệu một phần (dòng hủy/hoàn lệch số gốc hoặc
// cột ghi "một phần", hoặc gốc vốn đã bị chặn) mà giao dịch còn UNMATCHED (vd kế toán gỡ gắn một
// giao dịch bị hoàn sau khi ghi nhận) ⇒ cũng IGNORED: số của giao dịch là số GỘP, để nó trong
// hàng chờ là mời gắn tay lại đúng số sai (ca `[POS-DB-23c]`). Gốc vốn đã bị chặn (IGNORED, dòng
// POS CAN_XU_LY) ⇒ lượt đóng kết luận dòng gốc BO_QUA.
//
// "Toàn phần hay một phần" hỏi `tinHieuHuyCuaGoc` (`tin-hieu-huy-goc.ts`) — CÙNG hàm lượt GỠ GẮN
// hỏi (`go-gan-pos.ts`, 30/09/2026), để "gỡ rồi đóng" và "đóng rồi gỡ" ra cùng trạng thái cuối.
// Hệ quả: cột `Trạng thái Hoàn/Hủy` của GỐC nói toàn phần (chưa thấy dòng hủy nào) nay cũng là
// hủy toàn phần ở đây (luật 3) — bản trước bỏ qua, giao dịch đã gỡ ở lại hàng chờ (ca `[PNS-14]`).
//
// Lý do ghi vào DÒNG HỦY KHÔNG chép ghi chú của kế toán: dòng hủy mang cơ sở của MÁY (NULL khi
// máy chưa khai ⇒ mọi cơ sở đọc được), còn ghi chú hay chứa mã đơn / tên phụ huynh. Ghi chú nằm
// ở `canhBaoGhiChu` của GỐC (gốc theo cơ sở của đơn — `dongBoCoSo`) + audit của action.
import { db } from "@/lib/db";
import { LY_DO_CHAN_HOAN_MOT_PHAN } from "./phan-loai-pos";
import {
  ghiChuGiaoDichHuyToanPhan,
  lyDoGocHuyToanPhan,
  noiLyDoPos as noi,
  tinHieuHuyCuaGoc,
  type TinHieuHuyGoc,
} from "./tin-hieu-huy-goc";

/** Trả số dòng hủy/hoàn vừa được kết luận, hoặc `null` nếu cảnh báo đã được đóng trước đó. */
export async function dongCanhBaoHuyPos(input: {
  id: string;
  maGiaoDich: string;
  nguoiDongId: string;
  ghiChu: string;
  luc: Date;
}): Promise<number | null> {
  return db.$transaction(async (tx) => {
    // Có điều kiện: hai người cùng bấm thì người sau đổi 0 dòng — CHƯA ghi gì, trả sớm vô hại.
    const doi = await tx.posCardTransaction.updateMany({
      where: { id: input.id, canhBaoHuy: true, canhBaoDaXuLyLuc: null },
      data: { canhBaoDaXuLyLuc: input.luc, canhBaoDaXuLyBoiId: input.nguoiDongId, canhBaoGhiChu: input.ghiChu },
    });
    if (doi.count === 0) return null;

    // ── Gốc đã gỡ gắn + bị hủy TOÀN PHẦN ⇒ giao dịch gốc IGNORED. Phân loại LẠI từng dòng hủy
    // bằng `phanLoaiDongPos` (luật 1: chỉ dòng "Thành công" mới là hủy) — không đọc cột kết luận.
    const goc = await tx.posCardTransaction.findUnique({
      where: { id: input.id },
      select: {
        matchStatus: true,
        matchReason: true,
        soTien: true,
        trangThaiHoanHuy: true,
        bankTransaction: { select: { id: true, status: true, unmatchedNote: true } },
      },
    });
    const dongTroVao = await tx.posCardTransaction.findMany({
      where: { maGiaoDichGoc: input.maGiaoDich },
      select: { maGiaoDich: true, loaiGiaoDich: true, trangThai: true, soTien: true, maGiaoDichGoc: true, trangThaiHoanHuy: true },
      orderBy: { maGiaoDich: "asc" },
    });
    // Toàn phần phải ĐÚNG SỐ gốc — "Hủy" lệch số là một phần. Luật ở `tinHieuHuyCuaGoc`, dùng chung
    // với lượt gỡ gắn; tệp này chỉ quyết đóng-thì-làm-gì.
    const th: TinHieuHuyGoc = goc ? tinHieuHuyCuaGoc({ goc, dongTroVao }) : { toanPhan: null, motPhan: false };
    const btGoc = goc?.bankTransaction ?? null;
    if (!th.toanPhan && th.motPhan && btGoc?.status === "UNMATCHED") {
      const ra = await tx.bankTransaction.updateMany({
        where: { id: btGoc.id, status: "UNMATCHED" },
        data: { status: "IGNORED", unmatchedNote: noi(btGoc.unmatchedNote, LY_DO_CHAN_HOAN_MOT_PHAN) },
      });
      if (ra.count > 0) {
        await tx.posCardTransaction.update({
          where: { id: input.id },
          data: { matchStatus: "BO_QUA", matchReason: noi(goc?.matchReason ?? null, LY_DO_CHAN_HOAN_MOT_PHAN) },
        });
      }
    } else if (th.motPhan && btGoc?.status === "IGNORED" && goc?.matchStatus === "CAN_XU_LY") {
      // Gốc vốn đã bị chặn — kế toán đã điều chỉnh số ròng: kết luận dòng gốc.
      await tx.posCardTransaction.update({
        where: { id: input.id },
        data: { matchStatus: "BO_QUA", matchReason: noi(goc.matchReason, "Đã đóng cảnh báo") },
      });
    }
    if (th.toanPhan && btGoc?.status === "UNMATCHED") {
      // Có điều kiện trạng thái: vừa có người gắn tay lại ⇒ đổi 0 dòng, không đụng.
      const ra = await tx.bankTransaction.updateMany({
        where: { id: btGoc.id, status: "UNMATCHED" },
        data: { status: "IGNORED", unmatchedNote: noi(btGoc.unmatchedNote, ghiChuGiaoDichHuyToanPhan(th.toanPhan.maHuy)) },
      });
      if (ra.count > 0) {
        await tx.posCardTransaction.update({
          where: { id: input.id },
          data: { matchStatus: "BO_QUA", matchReason: noi(goc?.matchReason ?? null, lyDoGocHuyToanPhan(th.toanPhan.maHuy)) },
        });
      }
    }

    const huy = await tx.posCardTransaction.updateMany({
      where: { maGiaoDichGoc: input.maGiaoDich, matchStatus: "CAN_XU_LY", bankTransactionId: null },
      data: {
        matchStatus: "BO_QUA",
        // KHÔNG chép `input.ghiChu` — xem đầu tệp (ca `[POS-DB-24]`).
        matchReason: `Đã xử lý cùng cảnh báo của ${input.maGiaoDich}`,
      },
    });
    return huy.count;
  });
}
