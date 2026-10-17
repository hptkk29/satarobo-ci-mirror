import { redirect } from "next/navigation";

// 01/10/2026 — chủ dự án gộp "Sắp hết khoá" vào màn Đăng ký học thành tab thứ hai. Route giữ
// làm stub chuyển hướng: thông báo tái tục CŨ trong DB mang href này và không sửa hồi tố được.
export default function NearingEndPage() {
  redirect("/enrollments?tab=sap-het-khoa");
}
