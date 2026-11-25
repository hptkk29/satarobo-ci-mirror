// TS-03 — GRANDFATHER no-inline-authz: file hiện trạng còn kiểm quyền inline
// (so role/centerId, hasRole, .roles.includes) hoặc action ghi mà THÂN function
// không gọi can(/assertCan(/checkPermission(/assertPermission(... — trực tiếp
// LẪN qua wrapper cục bộ MỘT CẤP cùng file (rule (b) đã nhìn xuyên wrapper từ
// đợt trả NỢ 3, 09/08 — wrapper import từ file khác vẫn KHÔNG được nhận).
//
// Đo bằng LINT THẬT 09/08/2026 (đo LẠI sau khi rule (b) học wrapper một cấp —
// bật cưỡng bức 2 rule trên TOÀN scope, KHÔNG có block off): 41 file vi phạm
// (72 msg tầng a + 46 msg tầng b) trên 114 file quét. So bản đo trước (71 file /
// 67a + 190b / 113 file): XOÁ 30 entry sạch — toàn bộ sạch nhờ wrapper cục bộ kiểu
// `ensurePermission()`/`requireRole()` giờ được rule (b) công nhận. Phân loại 41 file
// còn lại: 14 chỉ tầng (a) inline-pattern (so .role/.centerId, hasRole...), 17 chỉ
// tầng (b) (action ghi không check trực tiếp lẫn wrapper cùng file — thường gate
// session-only hoặc wrapper nằm Ở FILE KHÁC), 10 dính cả hai tầng.
//
// LUẬT: trả nợ dần → 0, CẤM thêm file MỚI vào đây — code mới kiểm quyền qua
// can(actor, permissionKey, target) từ lib/permissions/can. File dọn xong inline-authz
// thì XOÁ entry (test freshness trong inline-authz.test.ts sẽ đỏ nếu quên xoá).
// Brackets dùng glob char-class để match literal [id], [slug]... (như db-import-allowlist).
export const INLINE_AUTHZ_ALLOWLIST = [
  "app/(admin)/admin/_actions/active-role.ts",
  "app/(admin)/admin/attendance/_actions.ts",
  "app/(admin)/admin/cham-cong/checklist-co-so/_actions.ts",
  "app/(admin)/admin/classes/[[]id[]]/_actions.ts",
  "app/(admin)/admin/classes/[[]id[]]/students/_actions.ts",
  "app/(admin)/admin/classes/_actions.ts",
  "app/(admin)/admin/convert-conflicts/actions.ts",
  "app/(admin)/admin/crm/commission/actions.ts",
  "app/(admin)/admin/exams/_actions.ts",
  "app/(admin)/admin/leads/actions.ts",
  "app/(admin)/admin/news/_actions.ts",
  "app/(admin)/admin/nhan-su/actions.ts",
  // orders/_qr-core.ts đã RA khỏi allowlist 20/08: đợt gác PII cho việc xuất QR
  // đưa gate duy nhất của nó về can(actor, "orders:view-pii"), không còn so role
  // /centerId inline — test freshness bắt được.
  "app/(admin)/admin/rooms/_actions.ts",
  "app/(admin)/admin/sessions/[[]id[]]/_actions.ts",
  "app/(admin)/admin/sessions/[[]id[]]/_feedback-core.ts",
  "app/(admin)/admin/settings/actions.ts",
  "app/(admin)/admin/students/[[]id[]]/_actions.ts",
  "app/(admin)/admin/students/_actions.ts",
  "app/(admin)/admin/teachers/_actions.ts",
  // GĐ6 — "app/(admin)/admin/trial-classes/_actions.ts" ĐÃ GỠ khỏi danh sách này cùng
  // với chính file đó. Lớp action thay thế (app/(admin)/admin/lop-trial/_actions.ts)
  // CỐ Ý không xin miễn trừ: rào "giáo viên thuần chỉ lớp mình" ở đó viết lại không
  // dùng hasRole nữa. Đừng thêm nó vào đây.
  "app/(admin)/admin/users/_actions.ts",
  "app/(auth)/doi-mat-khau/_actions.ts",
  "app/(auth)/kich-hoat/_actions.ts",
  "app/(auth)/quen-mat-khau/_actions.ts",
  "app/(portal)/portal/bai-tap/actions.ts",
  "app/(portal)/portal/bai-thi/actions.ts",
  "app/(portal)/portal/danh-gia-gv/_actions.ts",
  "app/(portal)/portal/danh-gia/actions.ts",
  "app/(portal)/portal/ho-so-con/chi-tiet/actions.ts",
  "app/(portal)/portal/ho-so/actions.ts",
  "app/(portal)/portal/khao-sat/_actions.ts",
  "app/(portal)/portal/khao-sat/_eval-actions.ts",
  // portal/tin-nhan/actions.ts đã RA khỏi allowlist 11/08: bản vá "vai quan hệ"
  // (8410878e trên test) đưa toàn bộ gate của nó về can(), test freshness bắt được.
  "app/(portal)/portal/yeu-cau/actions.ts",
  "app/(teacher)/teacher/lich/_actions.ts",
];
