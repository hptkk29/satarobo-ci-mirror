// Registry quyền — module Chat Realtime (AC4 US-01: khai báo lại quyền chat vào registry).
//
// ⚠️ KHAI TRƯỚC (pre-declare): 5 key này là key THẬT đã tồn tại trên nhánh
// feat/chat-realtime (lib/auth/permissions.ts, commit 58464fbc) nhưng nhánh nền P0
// (base main) chưa chứa chat. Registry chỉ MÔ TẢ quyền — khai trước không đổi hành vi.
// Khi chat merge: ALL_ACTIONS sẽ chứa các key này → test parity tự bắt và exception
// PRE_DECLARED_V1_KEYS trong lib/permissions/registry.test.ts PHẢI được rút gọn về rỗng.
// Quyền chat là participant-based (ConversationParticipant), không phải center-based —
// vẫn scopable (scope = hội thoại mình tham gia), xem docs/chat-realtime/permissions.md.
import type { ModuleDecl } from "./types";

export const chatModule: ModuleDecl = {
  module: "chat",
  permissions: [
    {
      key: "chat:read",
      action: "read",
      description: "Đọc hội thoại mình là participant (PH/GV/QLCS/SUPER_ADMIN).",
    },
    {
      key: "chat:send",
      action: "send",
      description: "Gửi tin trong hội thoại mình tham gia.",
    },
    {
      key: "chat:announce",
      action: "announce",
      description: "Đăng thông báo lớp (GV/QLCS/SUPER_ADMIN).",
    },
    {
      key: "chat:moderate",
      action: "moderate",
      description: "Gỡ tin nhắn trong nhóm mình quản (soft delete).",
    },
    {
      key: "chat:admin",
      action: "admin",
      description: "Khoá hội thoại / tra cứu / audit chat — chỉ SUPER_ADMIN.",
    },
  ],
};
