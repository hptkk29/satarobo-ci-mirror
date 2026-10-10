-- 25/09/2026 — liên kết Học viên ↔ Lead nguồn + 3 ô thông tin phụ huynh trên hồ sơ HV.
--
-- Migration ADD-ONLY trên bảng có dữ liệu PROD: đúng 5 cột NULLABLE + 2 index + 2 khoá
-- ngoại. Không sửa, không bỏ, không đổi kiểu cột nào đang có (luật cứng #4). Không
-- DEFAULT, không backfill trong migration.
--
-- Ý nghĩa NULL của `leadId`: **chưa nối**, KHÔNG phải "học viên không đến từ lead".
-- Nối HV cũ là việc của `scripts/noi-hoc-vien-voi-lead.ts` — DRY-RUN mặc định, người
-- vận hành xem báo cáo rồi mới chạy `--ghi`. Không suy trong migration vì có ca một HV
-- dính nhiều lead, phải người xem.
--
-- ⛔ Không "nối" bằng `Enrollment.leadChildId`: cột đó là tín hiệu "đã chốt" của báo
-- cáo chuyển đổi (lib/lead/tuong-tac/ghi.ts:130-134).

-- AlterTable
ALTER TABLE "Student" ADD COLUMN "parentGender" "Gender";
ALTER TABLE "Student" ADD COLUMN "parentDob" DATE;
ALTER TABLE "Student" ADD COLUMN "parentFacebookUrl" TEXT;
ALTER TABLE "Student" ADD COLUMN "leadId" TEXT;
ALTER TABLE "Student" ADD COLUMN "leadChildId" TEXT;

-- CreateIndex
CREATE INDEX "Student_leadId_idx" ON "Student"("leadId");
CREATE INDEX "Student_leadChildId_idx" ON "Student"("leadChildId");

-- AddForeignKey
-- ON DELETE SET NULL: xoá lead / xoá con trong phiếu không được kéo theo hồ sơ học viên.
ALTER TABLE "Student" ADD CONSTRAINT "Student_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Student" ADD CONSTRAINT "Student_leadChildId_fkey" FOREIGN KEY ("leadChildId") REFERENCES "LeadChild"("id") ON DELETE SET NULL ON UPDATE CASCADE;
