// lib/hoa-hong/loai-giao-dich.ts — MASTER loại giao dịch hoa hồng + thành phần doanh thu.
//
// Nguồn thiết kế: docs/source-commission/04 §5.1 (master), 02 §8.2 + §13.4 (bảng + seed 6 dòng),
// 04 §4.3 (thành phần). THUẦN — không DB, không đọc đồng hồ.
//
// ⚠️ Bộ phân loại (`phan-loai-giao-dich.ts`) CHỈ ra được NEW | RENEWAL | MANUAL_REVIEW.
// UPSELL / CROSS_SELL / WINBACK / CHUYEN_TRUNG_TAM có dòng master nhưng `hasClassifier = false`
// và `isActive = false`: cho bật một mã mà không có bộ phân loại nào ra mã ấy là lời hứa suông
// (luật 12) — DB chặn bằng CHECK `isActive = false OR hasClassifier = true` (02 §10.2), và
// hàm `kiemMasterLoaiGiaoDich` dưới đây là bản thuần của đúng luật ấy.

/** Mã loại giao dịch — tập ĐÓNG của master (02 §13.4). */
export const MA_LOAI_GIAO_DICH = [
  "NEW",
  "RENEWAL",
  "UPSELL",
  "CROSS_SELL",
  "WINBACK",
  "CHUYEN_TRUNG_TAM",
] as const;
export type MaLoaiGiaoDich = (typeof MA_LOAI_GIAO_DICH)[number];

/** Hai loại mà bộ phân loại tự động ra được — và là hai loại duy nhất policy được đặt rule. */
export type LoaiGiaoDichPhanLoaiDuoc = "NEW" | "RENEWAL";

export type DongMasterLoaiGiaoDich = {
  readonly code: MaLoaiGiaoDich;
  readonly name: string;
  readonly hasClassifier: boolean;
  readonly isActive: boolean;
  readonly sortOrder: number;
};

/**
 * Seed master loại giao dịch (02 §13.4). Migration PR4 chèn đúng tập này; lưới ghim trong
 * `loai-giao-dich.test.ts` đọc `migration.sql` và so với hằng này — lệch là đỏ.
 */
export const MASTER_LOAI_GIAO_DICH: readonly DongMasterLoaiGiaoDich[] = [
  { code: "NEW", name: "Khách hàng mới", hasClassifier: true, isActive: true, sortOrder: 10 },
  { code: "RENEWAL", name: "Tái tục", hasClassifier: true, isActive: true, sortOrder: 20 },
  { code: "UPSELL", name: "Nâng cấp (chưa áp dụng)", hasClassifier: false, isActive: false, sortOrder: 30 },
  { code: "CROSS_SELL", name: "Bán chéo (chưa áp dụng)", hasClassifier: false, isActive: false, sortOrder: 40 },
  { code: "WINBACK", name: "Khách quay lại (chưa áp dụng)", hasClassifier: false, isActive: false, sortOrder: 50 },
  {
    code: "CHUYEN_TRUNG_TAM",
    name: "Chuyển trung tâm (SR.QD.208 PL08 Đ4, chưa áp dụng)",
    hasClassifier: false,
    isActive: false,
    sortOrder: 60,
  },
] as const;

/** Các mã được phép BẬT: có bộ phân loại ra chính mã đó. */
export function maLoaiDangBat(): readonly MaLoaiGiaoDich[] {
  return MASTER_LOAI_GIAO_DICH.filter((d) => d.isActive).map((d) => d.code);
}

/**
 * Luật 12 ở tầng thuần: một dòng master `isActive` mà `hasClassifier = false` là lời hứa suông.
 * Trả danh sách mã vi phạm (rỗng = hợp lệ).
 */
export function kiemMasterLoaiGiaoDich(
  dong: readonly Pick<DongMasterLoaiGiaoDich, "code" | "hasClassifier" | "isActive">[],
): string[] {
  return dong.filter((d) => d.isActive && !d.hasClassifier).map((d) => d.code);
}

// ── Thành phần doanh thu (04 §4.3 bước 1) ───────────────────────────────────

export type ThanhPhanDoanhThu = "TUITION" | "MATERIAL" | "EQUIPMENT" | "OTHER";

/**
 * Thành phần của MỘT dòng đơn theo loại dòng (04 §4.3, bảng đầu). Chỉ `TUITION` đi vào cơ sở tính
 * hoa hồng (D17): học cụ (`PRODUCT`) và lệ phí thi / phí học bù (`OTHER`) nằm ngoài.
 *
 * `loaiDong` nhận chuỗi `OrderItemType` (không import Prisma để giữ hàm thuần): một giá trị lạ
 * trả `null` — người gọi phải coi là "chưa biết", KHÔNG tự coi là học phí.
 */
export function thanhPhanTheoLoaiDong(loaiDong: string): ThanhPhanDoanhThu | null {
  switch (loaiDong) {
    case "COURSE_ENROLLMENT":
    case "COURSE_PACKAGE":
      return "TUITION";
    case "PRODUCT":
      return "MATERIAL";
    case "EXAM_REGISTRATION":
    case "MAKEUP_FEE":
      return "OTHER";
    default:
      return null;
  }
}
