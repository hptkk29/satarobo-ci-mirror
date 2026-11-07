import { redirect } from "next/navigation";
import { isCenterChecklistEnabled } from "@/lib/flags";

// 20/08/2026 — CỔNG GỠ tính năng "Checklist mở/đóng cơ sở" (cờ `isCenterChecklistEnabled`,
// mặc định OFF theo yêu cầu chủ dự án "disable chức năng này").
//
// Vì sao đặt ở layout của segment chứ không chốt trong từng page: layout bọc CẢ trang nhập
// (`/checklist-co-so`) lẫn trang ma trận (`/checklist-co-so/tong-quan`) — route con thêm sau
// này không phải nhớ gắn lại chốt. Khi cờ OFF, `children` không bao giờ vào cây React ⇒ page
// RSC bên dưới KHÔNG chạy ⇒ không tốn một truy vấn nào.
//
// Vì sao redirect chứ không notFound(): quản lý cơ sở còn bookmark/lịch sử trình duyệt trỏ
// thẳng vào đây; đẩy về bảng Chấm công thì họ vẫn tới được việc cần làm thay vì đọc 404.
// Đường dẫn KHÔNG có tiền tố `/admin` — host admin phục vụ từ gốc (xem `redirect("/dashboard")`
// ở các page cùng cụm).
//
// Code trang, `_actions.ts` và `lib/center-checklist.ts` GIỮ NGUYÊN, dữ liệu `CenterDayChecklist`
// cũng vậy: bật lại chỉ cần env `CENTER_CHECKLIST_ENABLED="true"` + redeploy, không phải revert.
export const dynamic = "force-dynamic";

export default function CenterChecklistGateLayout({ children }: { children: React.ReactNode }) {
  if (!isCenterChecklistEnabled()) redirect("/cham-cong");
  return <>{children}</>;
}
