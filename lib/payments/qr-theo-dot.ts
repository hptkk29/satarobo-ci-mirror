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

/** Câu nói cho người dùng khi đợt khác đang giữ phiếu. Tách ra để test được nguyên văn. */
export function loiDotKhacDangGiu(nhanDotDangGiu: string): string {
  return (
    `Đơn đang có một mã QR mở cho ${nhanDotDangGiu}. ` +
    `Mỗi đơn chỉ được một mã sống cùng lúc — đóng hoặc huỷ mã đó rồi xuất lại.`
  );
}
