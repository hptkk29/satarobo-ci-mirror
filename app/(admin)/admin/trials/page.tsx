// app/(admin)/admin/trials/page.tsx — GĐ6.
//
// Màn "Học thử" cũ đã gộp vào "Lớp Trial". Giữ lại route dưới dạng CHUYỂN HƯỚNG chứ
// không xoá thư mục, vì hai lý do:
//   1. Thông báo đã gửi đi trong quá khứ mang href "/trials" và KHÔNG sửa hồi tố được.
//   2. Gỡ segment khỏi ADMIN_ROUTE_SEGMENTS thì admin host bật link cũ về public rồi
//      404 — người dùng nhận trang lỗi thay vì được đưa tới đúng chỗ.
//
// Gỡ hẳn khi nào? Khi không còn thông báo cũ nào trong DB trỏ tới đây. Đừng gỡ theo
// lịch, hãy gỡ theo số đo.
import { redirect } from "next/navigation";

export default function TrialsRedirectPage() {
  // 28/08 — tab "Lịch hẹn học thử" đã gỡ khỏi hệ thống; đích còn lại là danh sách lớp.
  redirect("/lop-trial");
}
