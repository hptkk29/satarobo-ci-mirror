// lib/parttime/don-loi-moi.ts — DỌN LỜI MỜI CŨ khi chuyển sang gán thẳng (chủ dự án chốt 20/10/2026). THUẦN.
//
// Trước 20/10 phân công là LỜI MỜI (`WAITING_ACCEPTANCE`, giáo viên bấm nhận). Từ 20/10 phân công là GÁN THẲNG (`daGan`). Lời
// mời cũ còn treo thì chia hai, theo lời chủ dự án:
//   · buổi ĐÃ QUA (trước hôm nay, giờ VN) ⇒ HUỶ — "huỷ 11 lời mời đi" (lời mời hồi tố do nút Dựng tạo cho 15–18/10);
//   · buổi TỪ HÔM NAY ⇒ CHUYỂN THÀNH ĐÃ GÁN — chủ dự án chọn "Chuyển thành đã gán" cho 7 lời mời 21–25/10.
// Buổi đã HUỶ / đóng thì luôn HUỶ (không gán người vào một buổi không còn diễn ra). Không gửi thông báo nào: lời mời hồi tố
// giáo viên không còn thấy, lời mời tương lai đã hiện trong "Công việc của tôi" — dội chuông lần nữa chỉ là nhiễu.
export type LoiMoiCu = {
  id: string;
  userId: string;
  role: string;
  sourceType: string;
  ngay: string; // YYYY-MM-DD
  /** Trạng thái hiện tại của buổi nguồn; null = không đọc được buổi. */
  trangThaiBuoi: string | null;
};

export type BuocDon = { id: string; hanhDong: "HUY" | "GAN_THANG"; lyDo: string };

const BUOI_DONG = new Set(["CANCELLED"]);

export function keHoachDonLoiMoi(ds: readonly LoiMoiCu[], homNay: string): BuocDon[] {
  return ds.map((x) => {
    if (x.trangThaiBuoi == null || BUOI_DONG.has(x.trangThaiBuoi)) return { id: x.id, hanhDong: "HUY", lyDo: "Buổi đã huỷ / không còn — dọn lời mời cũ" };
    if (x.ngay < homNay) return { id: x.id, hanhDong: "HUY", lyDo: "Lời mời hồi tố cho buổi đã qua — huỷ theo chủ dự án 20/10/2026" };
    return { id: x.id, hanhDong: "GAN_THANG", lyDo: "Chuyển lời mời cũ thành đã gán (gán thẳng từ 20/10/2026)" };
  });
}

export function demDon(b: readonly BuocDon[]): { huy: number; ganThang: number } {
  return { huy: b.filter((x) => x.hanhDong === "HUY").length, ganThang: b.filter((x) => x.hanhDong === "GAN_THANG").length };
}
