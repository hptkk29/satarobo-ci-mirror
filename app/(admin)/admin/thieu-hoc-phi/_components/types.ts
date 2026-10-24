import type { TrangThaiHocPhi } from "@/lib/finance/thieu-hoc-phi";

/**
 * Hình dạng một dòng trên màn Thiếu học phí.
 *
 * ⚠️ Ở FILE RIÊNG có lý do: kiểu này trước đây khai trong `thieu-hoc-phi-client.tsx`, mà
 * `ghi-hoc-phi-dialog.tsx` lại import nó — trong khi client cũng import dialog. Thành
 * vòng `client → dialog → client`, và cổng `no-circular` của dependency-cruiser chặn CI.
 *
 * `pnpm lint` ở máy KHÔNG chạy dependency-cruiser (`pnpm depcruise` mới chạy), nên vòng
 * này lọt hết mọi lượt kiểm ở local và chỉ nổ khi lên CI. Đừng gộp kiểu này trở lại vào
 * một trong hai component.
 */
export type DongThieu = {
  leadId: string;
  parentName: string;
  phone: string;
  centerName: string;
  studentNames: string[];
  trangThai: TrangThaiHocPhi;
  soDon: number;
  tongPhaiThu: number;
  tongDaThu: number;
  conThieu: number;
  goiYTenKhoa: string | null;
  /**
   * Có đơn ĐÃ CÓ đang còn thiếu ⇒ lượt ghi tới là GHI THÊM vào đơn đó (không tạo đơn
   * thứ hai). `null` = chưa có đơn nào còn thiếu ⇒ tạo đơn mới.
   */
  ghiThem: { orderId: string; toiDa: number; maDon: string } | null;
};
