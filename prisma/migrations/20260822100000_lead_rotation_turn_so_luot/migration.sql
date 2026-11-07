-- Đợt D — SỔ LƯỢT của vòng luân phiên chia lead (chủ dự án chốt Q7, 21/08/2026).
--
-- THUẦN THÊM MỚI: một bảng chưa tồn tại, không đụng cột/bảng nào đang có dữ liệu
-- PROD (luật cứng Nền Hệ thống #4). Quay lui = DROP TABLE, không mất gì khác.
--
-- Dùng `orgUnitId` chứ không `centerId` (luật cứng #3 cho bảng mới). Cột trần,
-- không FK — giống 28 bảng của PR-A.

CREATE TABLE "LeadRotationTurn" (
    "id" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "turns" INTEGER NOT NULL DEFAULT 0,
    "lastTurnAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "LeadRotationTurn_pkey" PRIMARY KEY ("id")
);

-- Một người chỉ có MỘT dòng trong một đơn vị. Ràng buộc này là thứ giữ cho
-- upsert dưới khoá advisory không đẻ dòng trùng khi hai lead vào cùng lúc.
CREATE UNIQUE INDEX "LeadRotationTurn_orgUnitId_userId_key" ON "LeadRotationTurn"("orgUnitId", "userId");

CREATE INDEX "LeadRotationTurn_orgUnitId_idx" ON "LeadRotationTurn"("orgUnitId");
