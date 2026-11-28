// Registry quyền — E-learning ONLINE thương mại (ADR 0005). Prefix `onl:` — KHÁC với `elearning:` của Đào tạo nội bộ: hai hệ tách bạch,
// quyền nội bộ KHÔNG mặc nhiên mở Online (V7 §12).
//
// ⚠️ Mỗi key PHẢI nằm đủ ở bốn chỗ (thiếu một chỗ là grant bị vứt im lặng hoặc parity v1↔v2 đỏ):
//   1. file này (mô tả)          2. `registry/index.ts` (ALL_MODULE_DECLS)
//   3. `lib/auth/permissions.ts` (union `Action` + matrix `PERMISSIONS` v1)   4. `prisma/seed-roles.ts` (RoleDef v2)
//
// Hợp đồng cũ viết `onl.course.view` (dấu chấm); repo dùng `resource:verb` ba đoạn bằng dấu hai chấm — ánh xạ ghi ở
// `docs/elearning/thiet-ke-lai-2611/implementation/ELEARNING-ONLINE-CONTRACTS.md` §5.
import type { ModuleDecl } from "./types";

export const elearningOnlineModule: ModuleDecl = {
  module: "elearning-online",
  permissions: [
    { key: "onl:course:view", action: "view", description: "Xem danh sách/chi tiết khoá Online (chỉ đọc)." },
    { key: "onl:course:manage", action: "manage", description: "Tạo/sửa khoá, danh mục, chương, bài, giá, thời hạn, bản nháp." },
    { key: "onl:course:release", action: "release", description: "Phát hành phiên bản khoá (chọn chính sách tiến độ, xác nhận tác động)." },
    { key: "onl:student:view", action: "view", description: "Xem học viên trong một khoá Online (quyền học, hạn, tiến độ, lịch sử)." },
    { key: "onl:student:pii", action: "pii", description: "Thấy SĐT/liên hệ phụ huynh trong bảng học viên Online." },
    { key: "onl:student:grant", action: "grant", description: "Cấp quyền học miễn phí / gia hạn cho một học viên trong một khoá." },
    { key: "onl:student:revoke", action: "revoke", description: "Thu hồi quyền học (bắt buộc lý do ≥ 10 ký tự)." },
    { key: "onl:assessment:manage", action: "manage", description: "Soạn ngân hàng câu hỏi, đề kiểm tra, bài tập, thi cuối khoá của Online." },
    { key: "onl:assessment:grade", action: "grade", description: "Chấm tay bài tập/bài thi tự luận của Online." },
    { key: "onl:certificate:issue", action: "issue", description: "Cấp/thu hồi chứng nhận hoàn thành khoá Online bằng tay." },
    { key: "onl:report:view", action: "view", description: "Xem báo cáo tổng hợp khoá Online (không kèm PII)." },
  ],
};
