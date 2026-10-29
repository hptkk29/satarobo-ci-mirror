import "server-only";
// lib/payments/pos/go-gan-pos.ts — GỠ GẮN một giao dịch thẻ POS mà gốc ĐÃ BIẾT bị hủy/hoàn. CHẠM TIỀN.
//
// Gọi TRONG transaction của `goGanTheoCon` (`lib/finance/ghi-tien-don.ts`), NGAY SAU câu đưa giao
// dịch về UNMATCHED — đúng MỘT lời gọi; mọi hiểu biết về thẻ POS nằm ở tệp này, không nằm inline
// trong đường ghi tiền chung (lưới `[GGP-W*]`).
//
// VÌ SAO (nợ ghi ở docs/pos-the-smartpos.md, vá 30/09/2026): trước bản vá, gỡ gắn một giao dịch
// thẻ đã bị hủy toàn phần / hoàn một phần — nhất là SAU khi kế toán đã đóng cảnh báo (Q-H "cho
// đóng tự do") — để SỐ GỘP nằm UNMATCHED trong hàng chờ, gắn tay lại được đủ số, cho tới lượt
// import kế tiếp có tín hiệu. Mà file theo ngày: lượt đó có thể không bao giờ tới.
//
// HÀNH VI — cùng trạng thái cuối với thứ tự ngược lại ("gỡ rồi đóng", `dong-canh-bao-pos.ts`):
//   · HỦY TOÀN PHẦN (dòng hủy đúng số gốc, hoặc cột của gốc nói toàn phần) ⇒ giao dịch IGNORED,
//     dòng POS gốc BO_QUA — không còn đồng nào để ghi. Cờ cảnh báo KHÔNG đụng (đang mở thì kế
//     toán đóng như thường; đóng rồi thì thôi).
//   · HOÀN MỘT PHẦN (Q-G "chặn tự động") ⇒ giao dịch IGNORED, dòng POS gốc CAN_XU_LY + cảnh báo
//     MỞ (mở lại nếu đã đóng) mang lý do chặn — đúng trạng thái Q-G của "gốc chưa ghi nhận + hoàn
//     một phần". Mở lại là CỐ Ý: số ròng còn giữ vừa rời sổ (gỡ gắn đảo cả số gộp) và chưa nằm ở
//     đâu cả; cảnh báo đã đóng là lời kết cho tình huống CŨ (tiền đang trong sổ), không phải cho
//     tình huống này. Đóng lần nữa ⇒ `dongCanhBaoHuyPos` kết luận dòng gốc BO_QUA.
//   · Không tín hiệu, hoặc không phải giao dịch thẻ ⇒ không đụng gì: giao dịch về hàng chờ như cũ.
//
// Ghi chú của kế toán ("Đã gỡ gắn: <lý do>") ĐƯỢC GIỮ, lý do chặn NỐI vào sau — tầng nhập lô và
// ca `[POS-DB-23c]` đọc tiền tố đó.
import type { Prisma } from "@prisma/client";
import type { NguonTienGoGan } from "@/lib/finance/phieu-gop-go-gan";
import { PROVIDER_THE_POS } from "./kieu";
import { LY_DO_CHAN_HOAN_MOT_PHAN } from "./phan-loai-pos";
import { ghiChuGiaoDichHuyToanPhan, lyDoGocHuyToanPhan, noiLyDoPos, tinHieuHuyCuaGoc } from "./tin-hieu-huy-goc";

type Tx = Prisma.TransactionClient;

export type SauGoGanPos = {
  /** Trạng thái CUỐI của giao dịch sau lượt gỡ — `goGanTheoCon` ghi nó vào nhật ký. */
  trangThai: "UNMATCHED" | "IGNORED";
  /** Tín hiệu làm giao dịch ra khỏi hàng chờ — `null` khi giữ UNMATCHED. */
  tinHieu: "HUY_TOAN_PHAN" | "HOAN_MOT_PHAN" | null;
  /** `unmatchedNote` cuối của giao dịch. */
  ghiChu: string;
  /**
   * Nguồn tiền — Q-M (chủ dự án chốt 30/09/2026): gỡ gắn giao dịch THẺ luôn ĐÓNG phiếu gộp, kể cả khi
   * chưa có tín hiệu. Nói ra ở ĐÂY (tệp duy nhất biết thẻ POS) để đường gỡ gắn chung chỉ chuyển tiếp.
   */
  nguon: NguonTienGoGan;
};

/**
 * ⚠️ Người gọi PHẢI vừa ghi giao dịch về `UNMATCHED` trong CÙNG `tx` (dòng đang bị khoá bởi câu
 * UPDATE đó tới lúc commit). Vì thế `updateMany … status UNMATCHED` đổi 0 dòng là trạng thái
 * không thể có — NÉM để cả lượt gỡ cuộn ngược, thay vì báo "về hàng chờ" cho một giao dịch mà
 * ta không biết đang ở đâu (luật rollback: từ chối sau phép ghi = throw).
 */
export async function giaoDichPosSauGoGanTrongTx(
  tx: Tx,
  input: { bankTransactionId: string; provider: string; ghiChuGoGan: string },
): Promise<SauGoGanPos> {
  const nguon: NguonTienGoGan = input.provider === PROVIDER_THE_POS ? "THE_POS" : "CHUYEN_KHOAN";
  const giuNguyen: SauGoGanPos = { trangThai: "UNMATCHED", tinHieu: null, ghiChu: input.ghiChuGoGan, nguon };
  // Chuyển khoản (SePay/payOS) không có dòng POS — không tốn câu tra nào.
  if (input.provider !== PROVIDER_THE_POS) return giuNguyen;

  const goc = await tx.posCardTransaction.findUnique({
    where: { bankTransactionId: input.bankTransactionId },
    select: { id: true, maGiaoDich: true, soTien: true, trangThaiHoanHuy: true, matchReason: true },
  });
  if (!goc) return giuNguyen;

  const dongTroVao = await tx.posCardTransaction.findMany({
    where: { maGiaoDichGoc: goc.maGiaoDich },
    select: { maGiaoDich: true, loaiGiaoDich: true, trangThai: true, soTien: true, maGiaoDichGoc: true, trangThaiHoanHuy: true },
    orderBy: { maGiaoDich: "asc" },
  });
  const th = tinHieuHuyCuaGoc({ goc, dongTroVao });
  if (!th.toanPhan && !th.motPhan) return giuNguyen;

  // Toàn phần thắng một phần: hoàn nhiều lần cộng thành toàn phần thì không còn tiền nào để ghi.
  const lyDo = th.toanPhan ? ghiChuGiaoDichHuyToanPhan(th.toanPhan.maHuy) : LY_DO_CHAN_HOAN_MOT_PHAN;
  const ghiChu = noiLyDoPos(input.ghiChuGoGan, lyDo);
  const ra = await tx.bankTransaction.updateMany({
    where: { id: input.bankTransactionId, status: "UNMATCHED" },
    data: { status: "IGNORED", unmatchedNote: ghiChu },
  });
  if (ra.count !== 1) {
    throw new Error(`Giao dịch ${input.bankTransactionId} không ở UNMATCHED ngay sau lượt gỡ gắn — cuộn ngược`);
  }

  if (th.toanPhan) {
    await tx.posCardTransaction.update({
      where: { id: goc.id },
      data: { matchStatus: "BO_QUA", matchReason: noiLyDoPos(goc.matchReason, lyDoGocHuyToanPhan(th.toanPhan.maHuy)) },
    });
    return { trangThai: "IGNORED", tinHieu: "HUY_TOAN_PHAN", ghiChu, nguon };
  }

  await tx.posCardTransaction.update({
    where: { id: goc.id },
    data: {
      matchStatus: "CAN_XU_LY",
      matchReason: noiLyDoPos(goc.matchReason, LY_DO_CHAN_HOAN_MOT_PHAN),
      canhBaoHuy: true,
      canhBaoDaXuLyLuc: null,
      canhBaoDaXuLyBoiId: null,
      canhBaoGhiChu: null,
    },
  });
  return { trangThai: "IGNORED", tinHieu: "HOAN_MOT_PHAN", ghiChu, nguon };
}
