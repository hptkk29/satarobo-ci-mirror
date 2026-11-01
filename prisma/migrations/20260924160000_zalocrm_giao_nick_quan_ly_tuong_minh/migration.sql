-- Quản lý cơ sở thành DÒNG GIAO TƯỜNG MINH (chủ dự án ĐẢO 24/09/2026, cuối ngày).
--
-- ── VÌ SAO CÓ MIGRATION NÀY, VÀ VÌ SAO NÓ KHÔNG PHẢI "CHO CHẮC" ───────────────────────
-- Bản đang chạy cho quản lý cơ sở `admin` TỰ ĐỘNG trên mọi nick của cơ sở mình — không
-- có dòng dữ liệu nào, nhánh ấy nằm trong mã (`pham-vi-nick.ts`). Chủ dự án chốt gỡ nhánh
-- đó để phân quyền của quản lý cũng sửa được ngay trên màn.
--
-- Gỡ nhánh mã mà không làm gì thêm thì NGAY LÚC TRIỂN KHAI, mọi nick ĐANG CÓ NGƯỜI ĐƯỢC
-- GIAO sẽ rơi mất quản lý cơ sở khỏi danh sách — không ai bấm nút nào, không dòng nhật ký
-- nào, và triệu chứng là "sếp mở hộp thư ra thiếu nick". Đó đúng là lớp hỏng CÂM mà cả
-- module này sinh ra để tránh.
--
-- Chủ dự án chọn "gỡ được quản lý khỏi nick" — tức một HÀNH ĐỘNG CÓ CHỦ Ý trên màn, KHÔNG
-- phải một lượt mất quyền do triển khai. Migration này giữ nguyên quyền đang có tại thời
-- điểm cutover; từ đó trở đi việc thêm/gỡ là của người vận hành.
--
-- ⚠️ CHỈ chạm nick ĐÃ CÓ ÍT NHẤT MỘT DÒNG GIAO. Nick chưa giao ai thì không cần gì: quản
-- lý cơ sở nằm trong `VAI_DUOC_CAP_NICK` nên vẫn dùng được qua nhánh "mặc định". Thêm
-- dòng cho chúng là biến "chưa giao" thành "đã giao", tức CẮT quyền của tư vấn viên —
-- đúng chiều ngược lại của thứ đang muốn tránh.
--
-- Mức `admin`: bằng đúng mức nhánh tự động đang cấp. Không hạ xuống `chat` — đây là lượt
-- GIỮ NGUYÊN hiện trạng, không phải lượt siết quyền; siết là việc của người vận hành.
INSERT INTO "ZaloCrmNickGiao" ("id", "nickId", "sataUserId", "mucQuyen")
SELECT gen_random_uuid()::text, n."id", uor."userId", 'admin'
  FROM "ZaloCrmNick"  n
  -- `Center.code` khớp `OrgUnit.code` — cầu nối chuẩn của repo (`lib/org/center-bridge.ts`).
  -- KHÔNG suy từ tên: hai cơ sở trùng tên là chuyện có thật, trùng mã thì không.
  JOIN "Center"       c   ON c."id" = n."centerId" AND c."code" IS NOT NULL
  JOIN "OrgUnit"      ou  ON ou."code" = c."code"
  JOIN "UserOrgRole"  uor ON uor."orgUnitId" = ou."id"
  JOIN "RoleDef"      rd  ON rd."id" = uor."roleId" AND rd."code" = 'CENTER_MANAGER'
  JOIN "User"         u   ON u."id" = uor."userId"
 WHERE n."deletedAt" IS NULL
   -- Chỉ nick ĐÃ GIAO cho ai đó — xem khối chú thích trên.
   AND EXISTS (SELECT 1 FROM "ZaloCrmNickGiao" g WHERE g."nickId" = n."id")
   -- Cùng bộ lọc mà `nguoiDuocDungNick` dùng ở tầng mã. Lệch một điều kiện ở đây là cấp
   -- quyền cho người mà lượt đối soát kế tiếp sẽ gỡ ngay — một dòng rác, và một lượt
   -- `revoked` khó hiểu trong nhật ký.
   AND uor."status" = 'ACTIVE'
   AND uor."effectiveFrom" <= CURRENT_TIMESTAMP
   AND (uor."effectiveTo" IS NULL OR uor."effectiveTo" >= CURRENT_TIMESTAMP)
   AND u."isActive" = TRUE
   AND u."deletedAt" IS NULL
ON CONFLICT ("nickId", "sataUserId") DO NOTHING;
