-- G-04 — tuỳ chọn cột danh sách, lưu theo TỪNG NGƯỜI.
--
-- Migration ADD-ONLY: đúng một bảng MỚI, không đụng cột nào của bảng đang có dữ liệu
-- (luật cứng #4). Khoá ngoại tới "User" có ON DELETE CASCADE — xoá tài khoản thì cấu
-- hình cột đi theo, không để lại rác không ai tra được.
--
-- 🔴 Bảng này CỐ Ý KHÔNG có "centerId"/"orgUnitId" (chốt tường minh: PRD G-lead §7.2,
-- A-nen-tang SL-13). Đây là sở thích cá nhân, không phải dữ liệu theo đơn vị; mọi
-- truy vấn khoá cứng "userId" lấy từ phiên đăng nhập nên không có gì để scope. Thêm
-- hai cột đó "cho đủ luật" còn phản tác dụng: injectScope chèn `centerId IN (...)`
-- trần ⇒ dòng centerId NULL tàng hình với chính chủ nhân của nó.
--
-- "columns" là JSONB: { "v": 1, "visible": [...], "hidden": [...] }. Đọc bằng
-- lib/tables/column-preference.ts — JSON hỏng KHÔNG làm chết trang, chỉ rơi về mặc định.

-- CreateTable
CREATE TABLE "UserTablePreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tableKey" TEXT NOT NULL,
    "columns" JSONB NOT NULL,
    "pageSize" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "UserTablePreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserTablePreference_userId_tableKey_key" ON "UserTablePreference"("userId", "tableKey");
CREATE INDEX "UserTablePreference_userId_idx" ON "UserTablePreference"("userId");

-- AddForeignKey
ALTER TABLE "UserTablePreference" ADD CONSTRAINT "UserTablePreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
