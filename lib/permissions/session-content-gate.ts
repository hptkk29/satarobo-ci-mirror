// lib/permissions/session-content-gate.ts — Nền Hệ thống P0 · US-04: HỢP ĐỒNG chuỗi
// 4 điều kiện chương trình dạy (BA §3.2, chốt 27/07) — PIN TRƯỚC hiện thực.
//
// Đây KHÔNG phải resolver — là SKELETON hợp đồng (user duyệt tạo code sản phẩm 09/08):
// US-16 (P5) hiện thực ĐÚNG hàm này, giữ nguyên chữ ký + type. Mọi Server Action trả
// NỘI DUNG buổi học BẮT BUỘC đi qua `canViewSessionContent` ở tầng server — không có
// ngoại lệ cho môi trường dev (luật cứng #7 CLAUDE.md). Đây là hạng mục IDOR/BOLA rủi
// ro cao nhất toàn hệ (TS-18 / R3 pre-mortem).
//
// Chuỗi 4 điều kiện (BA §3.2):
//   role cho phép ∧ được phân công vào lớp ∧ lớp liên kết chương trình đó ∧ buổi đang
//   trong cửa sổ mở  →  thiếu BẤT KỲ một điều kiện = DENIED.
// Luật kèm theo:
//   - Quản lý (MANAGER) chỉ thấy DANH SÁCH chương trình, KHÔNG xem nội dung → LIST_ONLY.
//   - GV cơ sở nhượng quyền tỉnh khác, FC ACTIVE, đủ 4 điều kiện → vẫn xem nội dung
//     (chốt 27/07; TS-16/TS-18 — FC TERMINATED sẽ cắt ở resolver US-14/US-16).
//
// Tripwire trong session-content-gate.test.ts ép quy trình: khi US-16 hiện thực hàm
// này, tripwire đỏ → PHẢI gỡ toàn bộ `.fails` của các case [US-04→P5] TRONG CÙNG COMMIT.

/** Ném ra khi hợp đồng chưa được hiện thực — US-16 (P5) sẽ thay bằng logic thật. */
export class NotImplementedYetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotImplementedYetError";
  }
}

/** Đầu vào đã được caller RESOLVE SẴN từ DB (gate pure — không tự query). */
export type SessionGateInput = {
  /** Điều kiện 1: role của actor cho phép view chương trình (BA §3.2). */
  roleAllowsView: boolean;
  /** Điều kiện 2: actor được phân công vào lớp đang hỏi. */
  assignedToClass: boolean;
  /** Điều kiện 3: lớp có liên kết đúng chương trình chứa buổi này. */
  classLinkedToCurriculum: boolean;
  /** Điều kiện 4: buổi đang trong cửa sổ mở (khoá mở theo từng buổi — chống tuồn tài liệu). */
  sessionWindowOpen: boolean;
  /** TEACHER = xin nội dung buổi; MANAGER = quản lý (chỉ được danh sách — BA §3.2). */
  viewer: "TEACHER" | "MANAGER";
  /** Trạng thái FranchiseContract của cơ sở actor; null = cơ sở OWNED (không có FC). */
  franchiseContractStatus: "ACTIVE" | "SUSPENDED" | "TERMINATED" | "GRACE" | null;
};

/** CONTENT = nội dung buổi · LIST_ONLY = chỉ danh sách tên chương trình · DENIED = 403. */
export type SessionGateResult = "CONTENT" | "LIST_ONLY" | "DENIED";

/**
 * Cổng duy nhất quyết định trả nội dung buổi học (luật cứng #7).
 * CHƯA HIỆN THỰC — US-16 (P5). Chân trị kỳ vọng đã đóng băng trong
 * session-content-gate.test.ts ([US-04-TS18-*][US-04→P5]).
 */
export function canViewSessionContent(_input: SessionGateInput): SessionGateResult {
  throw new NotImplementedYetError("US-16/P5");
}
