// lib/orders/xoa-don-huy.ts — "đơn ĐÃ HUỶ này có xoá được không".
//
// THUẦN: không DB, không mạng. Nơi gọi đếm số rồi truyền vào; hàm này chỉ quyết định.
//
// ── CHỦ DỰ ÁN CHỐT 02/10/2026 ────────────────────────────────────────────────────────
// *"các đơn bị huỷ thì thêm nút xoá để xoá chứ"*, và chọn phương án **XOÁ CỨNG, chỉ khi
// đơn SẠCH** (trong ba phương án: xoá cứng khi sạch · chỉ ẩn khỏi danh sách · xoá mềm
// đầy đủ).
//
// ⚠️ VÌ SAO KHÔNG XOÁ MỀM, dù `Order.deletedAt` đã có sẵn trong schema: đo 02/10 — repo
// có **84 nơi đọc bảng `Order`, chỉ 25 nơi lọc `deletedAt`**. Ghi `deletedAt` rồi dừng là
// đơn biến khỏi danh sách đơn hàng mà **vẫn hiện ở công nợ, dashboard kế toán, biến động
// số dư, media, báo cáo doanh thu** — đúng lớp lỗi câm mà repo này phạt nặng nhất. Nối đủ
// 59 chỗ còn lại là một đợt riêng, chạm thẳng đường tiền.
//
// ── "SẠCH" NGHĨA LÀ GÌ — VÀ VÌ SAO LÀ ĐÚNG NHỮNG Ô NÀY ───────────────────────────────
// Xoá cứng chỉ an toàn khi đơn **chưa từng chạm tiền hay chứng từ**. Mỗi ô dưới đây là
// một dấu vết KHÔNG dựng lại được sau khi xoá:
//
//   · `soKhoanThu`      — `Payment` của đơn, KỂ CẢ dòng đã soft-delete: một khoản đã xoá
//                         mềm vẫn là lịch sử tiền, và xoá cứng đơn là xoá luôn nó.
//   · `soPhanBo`        — `PaymentAllocation` rót vào phiếu thu của đơn. Tiền có thể vào
//                         qua Ledger-B mà KHÔNG sinh `Payment`, nên đếm riêng; chỉ nhìn
//                         `Payment` là bỏ sót đúng đường webhook.
//   · `soMaQrConSong`   — `QrSession` còn `ACTIVE` trên phiếu thu của đơn. Mã còn sống là
//                         mã tiền VẪN CÓ THỂ về; xoá đơn khi ấy là bỏ rơi nó.
//   · `soPhieuGopConSong` — `PaymentBill` KHÁC `VOID` (mã 5 ký tự), cùng lý do.
//
// ⚠️ **CHỈ ĐẾM MÃ CÒN SỐNG — đây là bản sửa 02/10/2026 sau phản hồi của chủ dự án.**
// Bản đầu đếm MỌI `QrSession` và MỌI `PaymentBill`, nên một đơn tạo sai → huỷ → vẫn
// không xoá được, kèm câu *"còn 1 phiếu gộp"*. Chủ dự án: *"xoá vì đơn tạo sai yêu cầu
// khách hàng, rồi bây giờ tự gộp vào đơn được tạo đúng luôn hả?"* — phản hồi đúng.
//
// Đo ra bản đầu SAI, không phải chặt quá tay một cách tuỳ ý:
//  · `quyetPhieuMo` (`lib/finance/soat-phieu-gop.ts`) chỉ trả `VOID` khi **`daNhan === 0`**
//    ("chưa nhận đồng nào"); có tiền thì nó trả `CLOSED`. ⇒ **phiếu VOID không thể mang
//    tiền, theo cấu trúc.** Và enum tự khai: *"Mã QR của phiếu VOID không được đối khớp
//    nữa"*.
//  · Huỷ đơn ĐÃ tự dọn: `voidTienKhiHuyDonTrongTx` VOID các `PaymentRequest`, hạ mọi
//    `QrSession` ACTIVE xuống `EXPIRED`, rồi `soatPhieuGopMoTrongTx` quyết phiếu gộp mở.
//    Nên một đơn huỷ ĐÚNG QUY TRÌNH gần như luôn chỉ còn mã chết — và mã chết thì không
//    phải "dấu vết tiền", nó là bản nháp đã đóng.
//
// ⚠️ **Vế tiền KHÔNG hề nới**: `soKhoanThu` và `soPhanBo` vẫn đếm TẤT CẢ. Nếu từng có một
// đồng nào về, hai ô đó chặn — bất kể mã ở trạng thái gì. Đó là khoá độc lập thứ hai, và
// nó là lý do nới vế "mã" ở trên là an toàn.
//   · `soHoaDon`        — `HoaDonDienTu`. Hoá đơn là chứng từ thuế, không được biến mất.
//   · `soXuatKho`       — `ProductMovement`. Hàng đã rời kho là sự thật vật lý.
//   · `soSoDuTinDung`   — `CreditBalance`. Đơn đang giữ số dư của khách.
//
// ⚠️ **KHÔNG kiểm "có ghi danh không"** — `Enrollment` KHÔNG có khoá ngoại tới `Order`
// (đo schema 02/10), nên điều kiện ấy không đo được ở đây. Đó là điều kiện tôi tự nghĩ ra
// lúc đề xuất và đã bỏ sau khi đo. Ghi lại để người sau đừng thêm lại một vế không có dữ
// liệu đứng sau.
//
// ⚠️ **Postgres đã tự gác một lớp**: 8/10 bảng con khai `onDelete: Restrict`, nên xoá đơn
// còn con là DB NÉM. Hàm này KHÔNG thay lớp đó — nó đứng trước để câu từ chối nói được
// *vì sao*, thay vì ném một lỗi khoá ngoại mà người dùng không đọc được.

/** Số đếm các dấu vết của một đơn. Nơi gọi tự đếm từ DB rồi truyền vào. */
export type DauVetDon = {
  /** `Order.status` thô. */
  status: string;
  /** `Payment` của đơn — ĐẾM CẢ dòng `deletedAt != null`. */
  soKhoanThu: number;
  /** `PaymentAllocation` rót vào mọi phiếu thu của đơn. */
  soPhanBo: number;
  /** `QrSession` còn `ACTIVE` trên phiếu thu của đơn — mã CÒN SỐNG, tiền vẫn có thể về. */
  soMaQrConSong: number;
  /** `PaymentBill` KHÁC `VOID` của đơn — phiếu VOID không đối khớp được nữa. */
  soPhieuGopConSong: number;
  /** `HoaDonDienTu` của đơn. */
  soHoaDon: number;
  /** `ProductMovement` gắn đơn. */
  soXuatKho: number;
  /** `CreditBalance` gắn đơn. */
  soSoDuTinDung: number;
};

/**
 * Lý do KHÔNG xoá được, hoặc `null` khi xoá được.
 *
 * Trả về CHUỖI chứ không phải boolean: người bấm cần biết vì sao, và một nút tắt không
 * kèm lời giải thích là đúng thứ luật 12 cấm.
 *
 * ⚠️ Thứ tự nhánh có nghĩa: trạng thái đơn hỏi TRƯỚC. Một đơn chưa huỷ thì mọi câu về
 * tiền đều lạc đề — người dùng cần nghe "đơn này chưa huỷ", không phải "đơn này có 2
 * khoản thu".
 */
export function lyDoKhongXoaDuoc(d: DauVetDon): string | null {
  if (d.status !== "CANCELLED") {
    return "Chỉ xoá được đơn ĐÃ HUỶ — huỷ đơn trước nếu thật sự muốn bỏ.";
  }

  // Gom mọi vế tiền/chứng từ thành MỘT câu liệt kê, thay vì trả lý do đầu tiên gặp:
  // người vận hành cần biết ĐỦ thứ đang chặn để quyết một lần, không phải bấm lại ba lần
  // mới biết hết. Cùng tinh thần câu lỗi của cổng tạo đợt (`kiemTaoDot`).
  const vuong: string[] = [];
  if (d.soKhoanThu > 0) vuong.push(`${d.soKhoanThu} khoản thu`);
  if (d.soPhanBo > 0) vuong.push(`${d.soPhanBo} lượt tiền đã rót vào phiếu`);
  if (d.soMaQrConSong > 0) vuong.push(`${d.soMaQrConSong} mã QR còn sống`);
  if (d.soPhieuGopConSong > 0) vuong.push(`${d.soPhieuGopConSong} phiếu gộp còn sống`);
  if (d.soHoaDon > 0) vuong.push(`${d.soHoaDon} hoá đơn điện tử`);
  if (d.soXuatKho > 0) vuong.push(`${d.soXuatKho} lượt xuất kho`);
  if (d.soSoDuTinDung > 0) vuong.push(`${d.soSoDuTinDung} dòng số dư`);

  if (vuong.length === 0) return null;
  return `Đơn này còn ${vuong.join(" · ")} — xoá là mất dấu vết tiền, không xoá được. Giữ nguyên trạng thái "Đã huỷ".`;
}
