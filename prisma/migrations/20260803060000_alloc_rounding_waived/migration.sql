-- Phan THIEU duoc tha theo dung sai lam tron, luu tren tung dong phan bo.
--
-- Vi sao can cot nay: `deriveStatus(amountDue, allocated, waived)` dung `waived` de
-- coi phieu la PAID khi thieu vai nghin. Khong luu thi moi lan `recomputeRequestStatuses`
-- chay lai se tinh ra PARTIAL va GHI DE mat PAID ma webhook vua dat -- dung sai chi
-- co tac dung dung mot lan roi tu huy. Day cung la so ke toan can thay khi doi soat.
--
-- ADDITIVE: them cot co DEFAULT 0, khong sua kieu, khong xoa gi.
ALTER TABLE "PaymentAllocation" ADD COLUMN IF NOT EXISTS "roundingWaived" INTEGER NOT NULL DEFAULT 0;
