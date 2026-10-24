// components/admin/nguon-hoa-hong/khung-rong.ts — KHUNG NỘI DUNG của module «Nguồn Lead & Hoa hồng»: căn GIỮA vùng nội dung và rộng dần theo màn hình.
//
// Trước đây mọi trang của module dùng `max-w-6xl` (1152px) mà KHÔNG `mx-auto` ⇒ từ ~1400px trở lên nội dung dính mép trái, nửa bên phải trống («lệch một bên» ở màn 2K — phản ánh 13/10/2026).
// Nay: mặc định 1152px; mở rộng ở 1536 / 1920 / 2560 / 3840px và luôn nằm GIỮA; dưới 1152px thì `w-full` lấp đầy (không đổi so với trước ở màn nhỏ — 375px phải không tràn ngang).
// MỘT hằng cho cả khung thật, khung tải (skeleton) và khung lỗi — để ba thứ này luôn trùng bề ngang (khung tải lệch khung thật là một kiểu nhấp nháy bố cục).
export const KHUNG_NOI_DUNG = "mx-auto w-full max-w-6xl min-[1536px]:max-w-7xl min-[1920px]:max-w-[1500px] min-[2560px]:max-w-[1800px] min-[3840px]:max-w-[2400px]";
