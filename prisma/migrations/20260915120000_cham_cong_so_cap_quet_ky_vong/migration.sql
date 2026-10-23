-- B1 — SỐ CẶP QUÉT KỲ VỌNG (`soCapQuetKyVong`), 0 / 1 / 2.
--
-- Nguồn sự thật của giá trị: docs/cham-cong/BANG-MA-CA-CHOT.md (chốt 09/09/2026).
-- `lib/cham-cong/catalog.test.ts` canh SHIFT_CATALOG ↔ bảng ấy, cả hai chiều.
--
-- ⚠️ VIẾT TAY, KHÔNG dùng `prisma migrate dev` — repo đang lệch sẵn giữa `prisma/migrations`
-- và `schema.prisma` ở 14 bảng, nên `migrate dev` sẽ tự kèm một migration "sửa kiểu cột"
-- cho những bảng đó và nó trông vô hại trong diff (CLAUDE.md, chốt 08/09/2026).
--
-- ── Vì sao DEFAULT 1 ────────────────────────────────────────────────────────────────────
-- Chiều FAIL-CLOSED. Mã ca mới quên khai thì hệ thống KIỂM THỪA (đòi một cặp quét) chứ
-- không KIỂM THIẾU. Mặc định 0 là lặng lẽ tắt mọi cờ thiếu lượt của mã đó và không gì báo.
--
-- ── Vì sao có bước UPDATE, dù đã có DEFAULT ─────────────────────────────────────────────
-- `DEFAULT 1` chỉ đúng cho đa số mã. Bảy mã KHÔNG phải 1, và nếu để chúng nhận 1 thì:
--   · `LD` `D1` `D2` `X` `P` bị đòi quét cho ngày vốn không cần chấm ⇒ cờ thiếu lượt hàng
--     loạt, đúng những mã sinh ra để KHÔNG chấm;
--   · `ST` mất vế hai cụm — người làm sáng + tối chỉ cần quét một cặp là qua.
-- `NG` GIỮ 0 ở lượt này: đảo sang 1 là việc của phần A, sau khi đo prod.
--
-- ── ShiftAssignment: ô ca ĐÃ XẾP ────────────────────────────────────────────────────────
-- Ô ca chụp lại thuộc tính mã ca lúc xếp (cùng lý do `attendanceMode`/`dayCredit`/`segments`
-- được chụp). Backfill theo `templateCode` để ngày đã xếp mang đúng giá trị của mã nó dùng,
-- KHÔNG mang mặc định 1.

ALTER TABLE "ShiftTemplate" ADD COLUMN "soCapQuetKyVong" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ShiftAssignment" ADD COLUMN "soCapQuetKyVong" INTEGER NOT NULL DEFAULT 1;

-- Bảy mã khác mặc định.
UPDATE "ShiftTemplate" SET "soCapQuetKyVong" = 0
 WHERE "code" IN ('LD', 'NG', 'D1', 'D2', 'X', 'P');
UPDATE "ShiftTemplate" SET "soCapQuetKyVong" = 2
 WHERE "code" = 'ST';

UPDATE "ShiftAssignment" SET "soCapQuetKyVong" = 0
 WHERE "templateCode" IN ('LD', 'NG', 'D1', 'D2', 'X', 'P');
UPDATE "ShiftAssignment" SET "soCapQuetKyVong" = 2
 WHERE "templateCode" = 'ST';
