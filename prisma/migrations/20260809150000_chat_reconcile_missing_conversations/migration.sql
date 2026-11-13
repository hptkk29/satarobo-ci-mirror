-- === CHAT REALTIME — đếm lớp ACTIVE CHƯA có nhóm trong log đối soát ===
-- Additive thuần: thêm 1 cột NOT NULL DEFAULT 0 vào bảng log kỹ thuật
-- ConversationReconcileRun (không bảng mới ⇒ không cần ENABLE ROW LEVEL SECURITY;
-- bảng này đã bật RLS ở 20260809130000_chat_rls_lockdown dòng 33).
--
-- Vì sao: job đối soát chỉ soi lớp ĐÃ có nhóm (`if (!conversationId) continue`), nên lớp
-- ACTIVE chưa từng có nhóm — vd toàn bộ lớp đã ACTIVE TRƯỚC khi module chat ra đời, vốn
-- không kích hoạt sự kiện nào để gọi syncConversationMembership — nằm ngoài tầm nhìn của
-- job VÀ của trang /admin/hoi-thoai/doi-soat. Cột này biến điểm mù đó thành con số.
-- Job vẫn KHÔNG tự tạo nhóm (giữ luật "job không tự thêm người"); việc tạo do
-- scripts/backfill-nhom-lop-chat.ts chạy tay.
--
-- Apply qua `prisma migrate deploy` (non-interactive, theo .claude/rules/prisma-db.md).

-- AlterTable
ALTER TABLE "ConversationReconcileRun"
  ADD COLUMN "missingConversations" INTEGER NOT NULL DEFAULT 0;
