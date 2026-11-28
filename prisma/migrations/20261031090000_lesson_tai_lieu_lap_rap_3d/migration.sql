-- Tài liệu lắp ráp 3D (ZMROBO) gắn theo BÀI HỌC của giáo trình.
--
-- Đào tạo tự dán đường dẫn mô hình của zmrobo.net vào từng bài (Giáo án & bài tập); giáo viên
-- thấy nút "Lắp ráp 3D" cạnh "Bài giảng SCORM" / "Mở trình chiếu". Mỗi bài tối đa MỘT đường dẫn.
--   assemblyManualUrl        — dữ liệu chính (đã kiểm host/đường dẫn ở server: lib/lms/assembly-manual.ts)
--   assemblyManualSetName    — tên bộ ("Alpha Set A"), chỉ để đối chiếu
--   assemblyManualModelName  — tên mô hình ("03.Catapult Car"), chỉ để đối chiếu
--
-- ADDITIVE thuần: 3 cột nullable, không DEFAULT, không backfill, không đụng hàng nào đang có.
-- Chạy lại được (IF NOT EXISTS, lưới [MIG-01]). Code cũ chạy tiếp bình thường trên schema mới. Rollback schema = DROP COLUMN (CHỈ khi chưa cột nào
-- có dữ liệu thật — không tự drop cột đã có dữ liệu); rollback ứng dụng = deploy lại bản cũ.
-- Bảng "Lesson" đã tồn tại ⇒ không cần ENABLE ROW LEVEL SECURITY; Lesson dùng chung toàn hệ
-- thống (không centerId/orgUnitId) ⇒ không khai SCOPED_MODELS / BACKFILL_SPECS.
ALTER TABLE "Lesson" ADD COLUMN IF NOT EXISTS "assemblyManualUrl" TEXT;
ALTER TABLE "Lesson" ADD COLUMN IF NOT EXISTS "assemblyManualSetName" TEXT;
ALTER TABLE "Lesson" ADD COLUMN IF NOT EXISTS "assemblyManualModelName" TEXT;
