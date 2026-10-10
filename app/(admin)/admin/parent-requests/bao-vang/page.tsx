import { redirect } from "next/navigation";

// Trang "Báo vắng cần xử lý" đã gộp vào /parent-requests (lọc theo loại).
// Giữ route để link cũ không vỡ → chuyển hướng sang tab Báo vắng.
export default function AbsenceQueueRedirect() {
  redirect("/parent-requests?type=ABSENCE");
}
