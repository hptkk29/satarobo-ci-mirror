import { redirect } from "next/navigation";

/**
 * `/leads/new` — ĐÃ GỠ (chủ dự án chốt 03/09/2026), chuyển hẳn sang
 * `/nhap-khach-hang`.
 *
 * Vì sao gỡ: biểu mẫu này tạo lead bằng `db.lead.create` trần, KHÔNG đi qua
 * đường nhận lead chung (`ingestIntakeLead`). Hệ quả là nó thiếu đúng những thứ
 * mọi nguồn khác đều có: chống trùng SĐT, tra cơ sở, và TỰ CHIA cho sale theo
 * vòng. Lead gõ tay ở đây nằm im không ai nhận, và gõ trùng số thì đẻ phiếu thứ
 * hai — hai lỗi không báo gì cả.
 *
 * ⚠️ VÌ SAO CÒN FILE NÀY thay vì xoá cả thư mục: `/leads/[id]` là route động
 * cùng cấp, nên xoá `new/` đi thì "new" rơi vào đó và được hiểu là MỘT ID LEAD —
 * trang trả 200 với nội dung rỗng thay vì 404, và không ai biết đường cũ đã mất.
 * Giữ đúng một `redirect()` là cách duy nhất để đường cũ (bookmark, link trong
 * tài liệu, `tests/manual/*`) hạ cánh đúng chỗ.
 *
 * `LeadForm` KHÔNG xoá — màn `/leads/[id]/edit` vẫn dùng.
 */
export default function LeadNewRedirectPage() {
  redirect("/nhap-khach-hang");
}
