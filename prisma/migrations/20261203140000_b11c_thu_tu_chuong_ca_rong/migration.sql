-- B-11c: thứ tự ĐẦY ĐỦ các chương của một phiên bản (kể cả chương RỖNG, vốn không có dòng phiên bản nào để mang `moduleOrder`).
-- Cột JSONB nullable, ADD-only, không backfill: NULL = bản chưa từng được kéo lại chương (đọc như trước).
-- Dạng: { "<moduleId>": <vị trí 0..n-1> }. Không có RLS/scope mới vì không thêm bảng.
ALTER TABLE "TrnCourseVersion" ADD COLUMN IF NOT EXISTS "moduleOrderJson" JSONB;
