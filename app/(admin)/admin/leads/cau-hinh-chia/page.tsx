// Cấu hình chia lead — MÀN ĐÃ XOÁ (30/08/2026). Ô chọn chế độ nay nằm ngay trên
// tab "Cấu hình pool" của /quan-ly-chia-lead, cạnh danh sách người nhận lead.
//
// Giữ dòng chuyển hướng vì `/leads/[id]` là route động bên cạnh — xoá hẳn thì
// `/leads/cau-hinh-chia` rơi vào `[id]` và đi tra một lead không tồn tại.
import { redirect } from "next/navigation";

export default function CauHinhChiaRedirectPage() {
  redirect("/quan-ly-chia-lead");
}
