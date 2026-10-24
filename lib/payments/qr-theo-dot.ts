// lib/payments/qr-theo-dot.ts — MỘT DÒNG ĐỢT thì nút QR của nó làm gì. THUẦN.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TỒN TẠI — chủ dự án chốt 24/09/2026
//
// Nội dung CK của QR theo đợt hôm nay là khuôn ĐỜI CŨ và nó **cụt**:
//
//     ORD260924000001D1 Anh_090
//     └──── khoá 17 ────┘ └ 7 ┘     ⇒ trần EMVCo 25 ký tự, khoá + dấu cách chiếm 18
//
// SĐT bị cắt sạch khỏi MỌI mã QR đời cũ kể từ 14/09. Khuôn đời MỚI chở đủ trong 20:
//
//     ANH 0905123456 K7M2N
//     tên   SĐT đủ   mã có checksum
//
// Nhưng mã 5 ký tự **chỉ tồn tại trên `PaymentBill`** — tầng đối khớp tra đúng một chỗ
// (`thuTheoPhieuGop`: `paymentBill.findFirst({ where: { matchKey: { in: memo.ungVien } } })`).
// Nên muốn QR theo đợt mang khuôn mới thì **cái QR đó phải đi qua một phiếu gộp**. Chủ dự án
// chọn: *"Nút Xuất QR phát phiếu gộp 1 dòng"*.
//
// ─────────────────────────────────────────────────────────────────────────────
// HỆ QUẢ PHẢI NÓI RA TRÊN MÀN, KHÔNG ĐƯỢC ĐỂ NGƯỜI DÙNG TỰ ĐOÁN
//
// `PaymentBill_orderId_open_key` là chỉ mục TỪNG PHẦN (`WHERE status = 'OPEN'`) ⇒ **mỗi đơn
// tối đa MỘT phiếu đang mở**. Nghĩa là bấm "Xuất QR" cho Đợt 2 trong khi Đợt 1 còn mở sẽ bị
// DB từ chối.
//
// Luật 12 (affordance nói thật): một cái nút chắc chắn bị từ chối là một lời hứa suông. Nên
// hàm này trả về `MOI_CUA_DOT_KHAC` kèm **nhãn của đợt đang giữ phiếu**, để màn hình nói
// "Đơn đang có mã QR mở cho Đợt 1" chứ không vẽ một cái nút rồi ăn lỗi unique.
//
// ⚠️ Cờ TẮT ⇒ `CU` — đường `QrSession` giữ NGUYÊN, không đụng gì. Đơn cũ (trước 16/09, không
// có dòng theo con) nằm ở cơ sở chưa bật cờ vẫn xuất được QR như hôm nay. Đó là lý do nhánh
// `CU` phải còn, và đừng gỡ nó khi cờ bật toàn hệ thống: `memoPhatHanh` vẫn rơi về khuôn cũ
// cho phiếu chưa có mã.

import { HAN_PHIEU_POS_MS, type TheDangMo } from "./pos/phieu-pos-luat";

/** Một dòng của phiếu gộp đang mở — chỉ cần đúng hai trường để quyết định. */
export type DongPhieuMo = {
  paymentRequestId: string;
  /** Nhãn người đọc của đợt ấy, vd "Đợt 1/3". Dùng nguyên văn trong câu từ chối. */
  nhan: string;
};

export type TrangThaiQrDot =
  /** Cờ TẮT — đi đường `QrSession` đời cũ, không đổi gì. */
  | { kieu: "CU" }
  /** Cờ BẬT, đơn chưa có phiếu nào mở ⇒ bấm là phát phiếu 1 dòng cho chính đợt này. */
  | { kieu: "MOI_CHUA_PHAT" }
  /** Cờ BẬT, phiếu đang mở CHỨA đợt này ⇒ hiện mã của phiếu ấy. */
  | { kieu: "MOI_CUA_DOT_NAY" }
  /** Cờ BẬT, phiếu đang mở là của đợt KHÁC ⇒ không vẽ nút, nói ra ai đang giữ. */
  | { kieu: "MOI_CUA_DOT_KHAC"; nhanDotDangGiu: string };

/**
 * Dòng đợt này đang ở tình trạng nào.
 *
 * @param bat        công tắc `billing.flexV1Enabled` của CƠ SỞ GIỮ ĐƠN (đã giải sẵn).
 * @param dongPhieuMo dòng của phiếu gộp ĐANG MỞ; `null` = đơn không có phiếu nào mở.
 * @param paymentRequestId đợt đang xét.
 *
 * ⚠️ `bat` là tham số BẮT BUỘC, không có mặc định (luật 7): mặc định `true` là bật tính năng
 * cho cơ sở chưa duyệt, mặc định `false` là tắt câm ở nơi đã duyệt. Cả hai đều là lỗi im lặng.
 */
export function trangThaiQrDot(input: {
  bat: boolean;
  dongPhieuMo: readonly DongPhieuMo[] | null;
  paymentRequestId: string;
}): TrangThaiQrDot {
  if (!input.bat) return { kieu: "CU" };
  const dong = input.dongPhieuMo;
  if (dong == null || dong.length === 0) return { kieu: "MOI_CHUA_PHAT" };
  if (dong.some((d) => d.paymentRequestId === input.paymentRequestId)) {
    return { kieu: "MOI_CUA_DOT_NAY" };
  }
  // Phiếu gộp NHIỀU dòng thì câu từ chối phải kể đủ, không chỉ dòng đầu — sale nhìn một câu
  // "đang mở cho Đợt 1" trong khi phiếu ôm cả Đợt 1 và Đợt 2 sẽ đi huỷ nhầm thứ.
  return { kieu: "MOI_CUA_DOT_KHAC", nhanDotDangGiu: dong.map((d) => d.nhan).join(", ") };
}

const HAN_GIO = HAN_PHIEU_POS_MS / (60 * 60_000);

/**
 * Câu nói cho người dùng khi đợt khác đang giữ phiếu. Tách ra để test được nguyên văn.
 *
 * `theDangMo` BẮT BUỘC (luật 7): phiếu đang giữ mã mà có THẺ mở thì "đóng hoặc huỷ mã đó rồi xuất lại" là lời hứa
 * suông — cổng huỷ từ chối (rà đối kháng 09/10/2026). Lối thoát THẬT của từng nhánh: `DANG_CHO` ⇒ huỷ phiếu thẻ (nút "Huỷ
 * phiếu thẻ" của Việc 4, người có `payments:pos-check`) hoặc chờ hết hạn; `CHO_KE_TOAN` / `CHUA_KET_LUAN` ⇒ chờ kế toán / bấm
 * Kiểm tra — hai nhánh này KHÔNG có nút huỷ phiếu thẻ (hộp từ chối: tiền có thể đang bay).
 * Tham số bắt buộc để `tsc` liệt kê mọi chỗ gọi: một chỗ quên truyền là chỗ vẫn chỉ vào lối thoát không tồn tại.
 *
 * ⚠️ Câu `DANG_CHO` nói "người có quyền thu thẻ POS", không "bấm nút…": câu này còn đi qua lỗi MÁY CHỦ tới cả người KHÔNG có quyền
 * ấy (luật 12 — không hứa một nút người đọc không có). Nhãn ngắn `chuDotKhacDangGiu` bị ghim NGUYÊN VĂN ở nơi khác ⇒ không đổi.
 */
export function loiDotKhacDangGiu(nhanDotDangGiu: string, theDangMo: TheDangMo | null): string {
  const dau = `Đơn đang có một mã mở cho ${nhanDotDangGiu}`;
  const quy = "Mỗi đơn chỉ được một mã sống cùng lúc";
  switch (theDangMo) {
    case null:
      return `Đơn đang có một mã QR mở cho ${nhanDotDangGiu}. ${quy} — đóng hoặc huỷ mã đó rồi xuất lại.`;
    case "DANG_CHO":
      return (
        `${dau}, đang chờ quẹt thẻ nên chưa huỷ được. ` +
        // Huỷ phiếu thẻ CHƯA đủ: phiếu gộp (mã) vẫn giữ nguyên — phải huỷ tiếp mã ở khung QR rồi mới xuất được cho đợt khác (rà ghép 10/10/2026).
        `${quy} — nếu khách chưa quẹt, nhờ người có quyền thu thẻ POS huỷ phiếu thẻ của mã đó, ` +
        `rồi huỷ mã (nút “Huỷ phiếu” ở khung QR của mã) và xuất cho đợt khác ` +
        `(hoặc chờ phiếu thẻ hết hạn sau ${HAN_GIO} giờ kể từ lúc mở).`
      );
    case "CHO_KE_TOAN":
      return (
        `${dau}, giao dịch thẻ của mã đó còn chờ kế toán xử lý nên chưa huỷ được. ` +
        `${quy} — xử lý xong rồi mới xuất cho đợt khác.`
      );
    case "CHUA_KET_LUAN":
      return (
        `${dau}, phiếu thẻ của mã đó đã quá hạn nhưng lần kiểm gần nhất chưa kết luận nên chưa huỷ được. ` +
        `${quy} — mở phiếu thẻ, bấm Kiểm tra thanh toán để chốt kết quả.`
      );
  }
}

/**
 * Nhãn NGẮN in trên dòng đợt khác ("Mã đang mở cho Đợt 1/2 (thẻ đang chờ)"). Cùng nguồn `theDangMo` với câu dài ở
 * `title` — hai nơi nói về một chuyện thì lấy từ một chỗ.
 */
export function chuDotKhacDangGiu(nhanDotDangGiu: string, theDangMo: TheDangMo | null): string {
  const goc = `Mã đang mở cho ${nhanDotDangGiu}`;
  switch (theDangMo) {
    case null:
      return goc;
    case "DANG_CHO":
      return `${goc} (thẻ đang chờ)`;
    case "CHO_KE_TOAN":
      return `${goc} (thẻ chờ kế toán)`;
    case "CHUA_KET_LUAN":
      return `${goc} (thẻ chưa rõ kết quả)`;
  }
}
