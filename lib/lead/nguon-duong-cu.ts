// lib/lead/nguon-duong-cu.ts — nguồn nào CÒN đi đường chia lead cũ.
//
// File THUẦN (không DB, không mạng) để test được mà không dựng Postgres.
//
// ⚠️ 05/09/2026 — VÌ SAO PHẢI CÓ DANH SÁCH ĐÓNG NÀY.
//
// Trước đó `lib/lead/ingest.ts` đặt cứng `legacyWebhook: true` cho MỌI lời gọi. Mà
// `processLeadWebhook` thì gọi `ingestLead` cho mọi nguồn — nên nguồn nào thêm sau
// cũng tự động rơi vào đường cũ, im lặng, không ai khai báo gì cả. `quatang` đã dính
// đúng như vậy, và mọi landing page tạo về sau cũng sẽ dính.
//
// Rơi vào đường cũ nghĩa là thừa hưởng nguyên gói khuyết tật của nó:
//   · KHÔNG ghi `Lead.assignmentSource` lẫn `LeadAssignmentLog` ⇒ sổ chia lead khuyết,
//     không đối chiếu được lead chia cho ai (đo prod 05/09: 40% lead không có vết,
//     phải đi vòng qua SQL mới trả lời được câu "chia có đều không");
//   · KHÔNG áp ma trận `resolveAssignment` ⇒ mất vế CƠ SỞ của mã giới thiệu: người
//     CS1 phát link mà khách chọn CS2 thì lead vẫn về tay người CS1;
//   · `autoAssignLead` thiếu chốt "lead đã có chủ" nên ĐÈ luôn mã giới thiệu.
//
// Nay danh sách là ĐÓNG: tên không có ở đây ⇒ đi đường mới (`chiaChoLead`), đúng
// chuẩn ngay từ lead đầu tiên. Thêm landing page mới KHÔNG phải sửa file này.

/**
 * Bốn nguồn còn ở đường cũ.
 *
 * `facebook` · `zalo` · `google-form` là ba nguồn gốc từ Phase T1.4.
 *
 * ⚠️ `quatang` NẰM ĐÂY NHƯNG KHÔNG CÓ TÁC DỤNG — đo lại 08/09/2026.
 *
 * Chú thích cũ viết: "quatang ĐANG là nguồn chạy nhiều nhất — đổi đường chia của nó là đổi
 * hành vi thật trên prod". Câu đó SAI kể từ 16/08/2026, tức trước cả ngày file này ra đời
 * (06/09): `app/api/public/webhook/quatang/route.ts` truyền một ADAPTER riêng cho
 * `processLeadWebhook`, và nhánh `if (adapter)` trong `lib/lead/webhook.ts` RETURN SỚM —
 * không bao giờ chạm `ingestLead`, tức không bao giờ chạm `laNguonDuongCu`. Lưu lượng quatang
 * đi thẳng `ingestIntakeLead` với `legacyWebhook` KHÔNG được set, nghĩa là nó đã ở ĐƯỜNG MỚI
 * (`chiaChoLead`) từ lâu — và vì thế nó ĐÃ có chuông "Bạn có lead mới".
 *
 * Giữ tên `quatang` trong danh sách là CÓ CHỦ ĐÍCH, không phải quên dọn: nếu một ngày nào đó
 * adapter bị gỡ (hoặc một đường replay gọi `ingestLead` với `source: "quatang"`), danh sách
 * này là thứ giữ cho hành vi không đổi thầm. Nhưng ĐỪNG suy luận về đường đi thật của quatang
 * từ dòng này — đọc `app/api/public/webhook/quatang/route.ts` mới ra câu trả lời đúng.
 */
const NGUON_DUONG_CU: ReadonlySet<string> = new Set([
  "facebook",
  "zalo",
  "google-form",
  "quatang",
]);

/**
 * Nguồn này có đi đường chia cũ không.
 *
 * So sau khi `trim()` + hạ chữ thường: tên nguồn đi từ route handler, và một khoảng
 * trắng thừa mà hoá thành "nguồn lạ" thì đổi thầm đường chia của một nguồn đang chạy.
 */
export function laNguonDuongCu(source: string | null | undefined): boolean {
  if (!source) return false;
  return NGUON_DUONG_CU.has(source.trim().toLowerCase());
}
