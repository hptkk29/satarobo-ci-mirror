-- Menu gọn theo vai (28/09/2026): danh sách đường dẫn mục menu ẨN với từng vai.
-- CHỈ THÊM cột, mặc định mảng rỗng ⇒ mọi vai hiện có giữ nguyên menu cho tới khi seed vai
-- (hoặc màn Vai trò & quyền) khai danh sách. Không đổi quyền nào — xem lib/auth/menu-gon.ts.
ALTER TABLE "RoleDef" ADD COLUMN IF NOT EXISTS "anMenu" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
