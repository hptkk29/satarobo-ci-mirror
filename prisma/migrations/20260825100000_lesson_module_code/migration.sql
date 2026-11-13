-- Mockup giáo trình 5 năm (25/08) — HỌC PHẦN của bài học.
--
-- Giáo trình Sata3–Sata7 chia 4 học phần × 12 buổi; nhãn buổi trên site giáo viên in
-- "Buổi 1 - HP1 - Bàn Tay Ma Thuật". Khoá luyện thi (Sata1/2/8) không chia học phần ⇒
-- để NULL, nhãn tự rút còn "Buổi 1 - <tên bài>".
--
-- ADDITIVE thuần: 2 cột nullable, không đụng dữ liệu cũ, rollback = DROP COLUMN.
-- Nguồn nạp: prisma/seed-curriculum-sata.ts.
ALTER TABLE "Lesson" ADD COLUMN "moduleCode" TEXT;
ALTER TABLE "Lesson" ADD COLUMN "moduleName" TEXT;
