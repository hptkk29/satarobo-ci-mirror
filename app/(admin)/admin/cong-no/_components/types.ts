/**
 * Kiểu dùng chung giữa trang (RSC) và bảng đối soát (client).
 *
 * ⚠️ ĐỂ RIÊNG MỘT FILE LÀ CÓ CHỦ ĐÍCH — không khai trong `bang-doi-soat.tsx` rồi cho
 * `page.tsx` import ngược. Đúng lối đó đã làm CI `Quality` đỏ ở màn /thieu-hoc-phi
 * (vòng import client ↔ trang), và `pnpm lint` KHÔNG bắt được: dependency-cruiser là cổng
 * riêng (`pnpm depcruise`).
 */
export type DongDoiSoat = {
  enrollmentId: string;
  hocVien: string | null;
  khoa: string | null;
  /** `Enrollment.finalPrice`. Vô nghĩa khi `chuaChotGia` — đừng đọc nó lúc đó. */
  hocPhi: number;
  /** TRỤC B — Σ Payment `saleStatus = RECORDED`. */
  daGhiNhan: number;
  /** TRỤC A — Σ Payment `accountantStatus = CONFIRMED`; đây là số cổng phụ huynh cộng. */
  daXacNhan: number;
  chuaChotGia: boolean;
};
