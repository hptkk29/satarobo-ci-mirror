-- Lớp trải nghiệm: ghi lại NGƯỜI TẠO lớp.
--
-- Chủ dự án 18/09/2026: bảng lớp trial "thêm cột của sale nào". Không cột nào trên
-- `TrialClassV2` trả lời được câu đó — lớp chỉ có `centerId`, `teacherId`, `assistantId`.
--
-- ADDITIVE, cột NULLABLE: lớp đã tạo trước hôm nay để NULL, và màn danh sách rơi về suy
-- từ Sale phụ trách lead của các con đang xếp trong lớp (xem `layDanhSachLop`). Không
-- backfill: không có nguồn nào đáng tin để đoán ai đã tạo 25 lớp cũ, và đoán sai thì con
-- số "lớp của tôi" của từng Sale sẽ sai mà không ai biết.
--
-- KHÔNG ràng FK cứng sang "User": giữ đúng nếp của `teacherId`/`assistantId` trên chính
-- bảng này (cũng không ràng), để xoá một tài khoản cũ không kéo sập bản ghi lớp.
ALTER TABLE "TrialClassV2" ADD COLUMN IF NOT EXISTS "createdById" TEXT;

CREATE INDEX IF NOT EXISTS "TrialClassV2_createdById_idx" ON "TrialClassV2"("createdById");
