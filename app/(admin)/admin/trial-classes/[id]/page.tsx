// app/(admin)/admin/trial-classes/[id]/page.tsx — GĐ6.
//
// Chuyển hướng GIỮ NGUYÊN id sang màn mới. Thông báo cũ trong DB trỏ thẳng tới
// "/trial-classes/{id}"; đưa về danh sách là bắt người ta tự dò lại đúng lớp.
import { redirect } from "next/navigation";

/**
 * Segment KHÔNG phải id lớp — phải dịch sang màn tương ứng chứ không ghép thẳng.
 *
 * ⚠️ Trước GĐ6a có route thật `/trial-classes/new` (trang tạo lớp). Route đó bị gỡ,
 * nên "new" nay rơi vào chính stub `[id]` này và bị ghép thành "/lop-trial/new" —
 * một URL KHÔNG tồn tại ⇒ bookmark cũ của người dùng nhận 404. Màn tạo lớp mới đặt
 * ở "/lop-trial/moi" (đường dẫn tiếng Việt), không phải "/lop-trial/new".
 *
 * Thêm segment nào vào đây? Chỉ khi thư mục cũ từng có route con cùng tên. Xem
 * `git log --diff-filter=D -- "app/(admin)/admin/trial-classes/"`: ngoài "new" thì
 * không còn cái nào.
 */
const SEGMENT_DAC_BIET: Record<string, string> = {
  new: "/lop-trial/moi",
};

export default async function TrialClassDetailRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(SEGMENT_DAC_BIET[id] ?? `/lop-trial/${id}`);
}
