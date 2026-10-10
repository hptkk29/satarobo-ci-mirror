import { redirect } from "next/navigation";

// 01/10/2026 — chủ dự án gỡ mục "Đề xuất sửa giáo án": đề xuất nay xem trong tab Đề xuất của
// từng chương trình học, và danh sách /curriculums hiện số đề xuất đang mở ở từng dòng (bấm
// vào tới thẳng tab đó). Route giữ làm stub chuyển hướng để link đã lưu không 404.
export default function LessonChangeInboxPage() {
  redirect("/curriculums");
}
