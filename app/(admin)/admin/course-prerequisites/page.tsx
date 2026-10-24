import { redirect } from "next/navigation";

// 01/10/2026 — chủ dự án gộp "Khoá tiên quyết" vào màn Chương trình học (tab Thiết lập của
// từng giáo trình: cấu hình cho KHOÁ của giáo trình đó). Route giữ làm stub chuyển hướng để
// link đã lưu không 404; server action ở `_actions.ts` vẫn là đường ghi duy nhất.
export default function CoursePrerequisitesPage() {
  redirect("/curriculums");
}
