// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc config/thuong-hieu.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * Bộ nhận diện SATA ROBO — NGUỒN DUY NHẤT của mọi mã màu dùng trong mã nguồn.
 *
 * 🔴 Brand DNA: cấm đổi màu logo, kể cả sang màu gần giống. Cấm nền tối nặng.
 *
 * ⚠️ `app/globals.css` có một bản sao của các màu này dưới dạng token Tailwind
 * (`@theme`). Tailwind v4 đọc CSS, không đọc TypeScript, nên không tránh được hai
 * nơi. Sửa ở đây thì sửa cả bên kia — hai bản lệch nhau thì tấm ảnh PNG chia sẻ
 * (GĐ4) sẽ khác màu so với thứ đang hiện trên màn hình.
 */

export const MAU_LOGO = {
  sata: "#FF6F00",
  robo: "#800080",
} as const;

export const MAU = {
  timCongNghe: "#610B8A",
  timCongNghePhu: "#6B21A8",
  camNangLuong: "#FF8F2D",
  /**
   * 🔴 Cam năng lượng `#FF8F2D` trên nền trắng chỉ đạt tương phản 2,28:1 — dưới cả ngưỡng
   * chữ to (3:1) lẫn chữ thường (4,5:1). Dùng nó làm MÀU CHỮ là chữ mờ với người mắt kém,
   * người già, và bất kỳ ai đọc ngoài nắng.
   * Sắc đậm này (≈6,9:1) dành RIÊNG cho chữ. Viền và mảng màu vẫn dùng cam thương hiệu.
   */
  camDamChoChu: "#8A4B00",
  /**
   * 🔴 ĐỎ CẢNH BÁO — dành RIÊNG cho hành động XOÁ KHÔNG HOÀN TÁC.
   * Đo được **6,54:1** trên nền trắng, qua ngưỡng chữ thường 4,5:1.
   * (`#D32F2F` chỉ 4,98 — sát ngưỡng quá, một lần chỉnh nhẹ là rơi.)
   *
   * KHÔNG dùng làm nền mảng: Brand DNA cấm nền tối nặng, và một nút nền đỏ đặc đọc lên
   * như một lời đe doạ chứ không phải một lựa chọn. Viền đỏ nói *"cẩn thận"*; nền đỏ đặc
   * nói *"bấm tôi"* — mà đây là nút xoá sạch cả nhà, không lấy lại được.
   */
  doCanhBao: "#B3261E",
  /**
   * 🔴 MẢNG NHẤN TỐI (GĐ27, chốt 30/10/2026) — NGOẠI LỆ HẸP của luật "cấm nền tối nặng".
   * Chỉ dùng cho khối `data-nhan-toi` (đầu màn, thẻ kết quả); thân trang và mọi bản in vẫn
   * nền sáng. Hai màu chữ bên dưới CHỈ được đặt lên `nenToi`, đo ≥ 4,5:1 trong
   * `tests/nen-toi.test.ts`. Khớp `@theme` của `app/globals.css`.
   */
  nenToi: "#1A0630",
  chuTrenToi: "#F5EDFF",
  chuMoTrenToi: "#CDB8E3",
  /** Nền của mục đang mở trên thanh bên (DISC_BA.md §5.1). */
  timRatNhat: "rgba(97, 11, 138, 0.09)",
  muc: "#171717",
  mucNhat: "#6B7280",
  vienMo: "#E5E5E5",
} as const;

/** Tỷ lệ màu toàn trang (DISC_BA.md §5.3): trắng 55–65% · tím 20–30% · cam 10–15%. */
export const TY_LE_MAU = { trang: [55, 65], tim: [20, 30], cam: [10, 15] } as const;
