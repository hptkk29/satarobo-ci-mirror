// Sổ lượt chia lead — MÀN ĐÃ XOÁ (30/08/2026), gộp vào /quan-ly-chia-lead.
//
// Giữ lại ĐÚNG một dòng chuyển hướng, không phải vì tiếc màn cũ mà vì hai lý do cụ thể:
//
//  1. `/leads/[id]` là route động ngay bên cạnh. Xoá hẳn thư mục này thì `/leads/so-luot`
//     rơi vào `[id]` và hệ thống đi tra một lead có id "so-luot" — người bấm dấu trang cũ
//     nhận một trang lỗi khó hiểu thay vì được dẫn tới chỗ đúng.
//  2. Link cũ còn nằm trong thông báo đã gửi, không sửa hồi tố được.
import { redirect } from "next/navigation";

export default function SoLuotRedirectPage() {
  redirect("/quan-ly-chia-lead");
}
