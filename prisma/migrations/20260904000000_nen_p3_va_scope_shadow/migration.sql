-- Nền Hệ thống P3 · US-12 — VÁ bảng `ScopeShadowDiff` cho khớp `schema.prisma`.
--
-- ── VÌ SAO ───────────────────────────────────────────────────────────────────
-- Job "Nền P3 — báo cáo shadow resolver dataScope" đỏ mỗi đêm từ 28/08/2026 với
-- `P2022: ScopeShadowDiff.nguon`. Truy ra thì job đỏ chỉ là TRIỆU CHỨNG NHÌN THẤY
-- ĐƯỢC; hỏng thật nằm ở đường GHI, và nó hỏng CÂM.
--
-- Hai chỗ lệch, ĐỘC LẬP nhau — vá một cái vẫn hỏng:
--
--   1. `nguon`     — `schema.prisma` khai BẮT BUỘC, nhưng KHÔNG migration nào tạo.
--                    Prisma gọi tên cột không tồn tại ⇒ P2022.
--   2. `dataScope` — migration gốc tạo `TEXT NOT NULL` KHÔNG mặc định, nhưng cột
--                    này ĐÃ BỊ GỠ khỏi `schema.prisma`. Prisma không bao giờ
--                    truyền nó ⇒ vi phạm not-null, ngay cả sau khi vá (1).
--
-- Đường ghi (`lib/permissions/scope-shadow-report.ts`) bọc `catch {}` với chú
-- thích "quan sát viên không được phép làm hỏng thứ nó quan sát" — đúng nguyên
-- tắc, nhưng nó nuốt luôn hai lỗi trên. Kết quả: bảng RỖNG ở mọi môi trường
-- (đo local: 0 dòng), và không một dòng log nào.
--
-- ⚠️ VÌ SAO ĐÁNG VÁ CHỨ KHÔNG PHẢI "MỘT JOB ĐỎ": cổng cutover đọc chính bảng này
-- để lấy "7 ngày sạch". Bảng rỗng đọc ra `LỆCH = 0` — trông y hệt "sạch, chuyển
-- được". Chú thích trong workflow đã cảnh báo "sạch trên mẫu rỗng", nhưng ở đây
-- còn tệ hơn: mọi số bằng 0 vì KHÔNG GHI ĐƯỢC DÒNG NÀO, không phải vì bộ máy mới
-- đúng.
--
-- ── AN TOÀN ──────────────────────────────────────────────────────────────────
-- Thuần CỘNG THÊM / NỚI LỎNG, không xoá cột, không đụng dữ liệu:
--   · `nguon` thêm kèm DEFAULT rồi bỏ DEFAULT ⇒ chạy được cả khi bảng CÓ dòng,
--     và kết thúc đúng hình dạng `schema.prisma` khai (NOT NULL, không mặc định).
--   · `dataScope` chỉ NỚI thành nullable. KHÔNG DROP: luật cứng #4 cấm tự ý bỏ
--     cột trên bảng prod, và giữ lại thì dữ liệu cũ (nếu có) không mất gì. Muốn
--     dọn hẳn thì để một đợt riêng, sau khi xác nhận bảng đã ghi được bình thường.
-- `IF NOT EXISTS` để chạy lại nhiều lần vô hại (môi trường nào lỡ `db push` rồi).

ALTER TABLE "ScopeShadowDiff"
  ADD COLUMN IF NOT EXISTS "nguon" TEXT NOT NULL DEFAULT 'perm';

ALTER TABLE "ScopeShadowDiff"
  ALTER COLUMN "nguon" DROP DEFAULT;

ALTER TABLE "ScopeShadowDiff"
  ALTER COLUMN "dataScope" DROP NOT NULL;
