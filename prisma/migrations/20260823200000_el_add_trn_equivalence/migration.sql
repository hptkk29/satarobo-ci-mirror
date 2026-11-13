-- EL-09 — công nhận tương đương + nhật ký điểm danh buổi trực tiếp.
--
-- CHỈ ADD: 1 bảng + index, và 2 cột nullable trên `TrnLessonProgress`.
--
-- Vì sao cần `TrnEquivalence`: không có nó thì ma trận đào tạo ngày mở TÔ XÁM
-- 100% — người đã học khoá An toàn từ hai năm trước hiện ra như chưa từng học —
-- và khoá tuân thủ 12 tháng không có mốc gốc nào để tính hạn tái chứng nhận.
--
-- Bảng KHÔNG đẻ ra trạng thái thứ bảy: lượt ghi danh sinh từ đây mang
-- status = COMPLETED + source = EQUIVALENCE, và nhãn riêng suy từ CỘT source.
--
-- Hai cột trên `TrnLessonProgress` là nhật ký "ai tick đã dự" cho bài dạng
-- LIVE_SESSION. Không có chúng thì điểm danh tay không để lại dấu vết, và câu
-- hỏi "ai xác nhận người này đã dự" không trả lời được — trong khi đó chính là
-- thứ chống việc cấp chứng nhận cho người mới học phần trực tuyến (BR-004).

-- AlterTable
ALTER TABLE "TrnLessonProgress" ADD COLUMN     "attendanceMarkedAt" TIMESTAMPTZ(6),
ADD COLUMN     "attendanceMarkedByUserId" TEXT;

-- CreateTable
CREATE TABLE "TrnEquivalence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "evidenceSource" TEXT NOT NULL,
    "originalEffectiveAt" TIMESTAMPTZ(6) NOT NULL,
    "confirmedByUserId" TEXT NOT NULL,
    "note" TEXT,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrnEquivalence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrnEquivalence_courseId_idx" ON "TrnEquivalence"("courseId");

-- CreateIndex
CREATE INDEX "TrnEquivalence_originalEffectiveAt_idx" ON "TrnEquivalence"("originalEffectiveAt");

-- CreateIndex
CREATE INDEX "TrnEquivalence_centerId_idx" ON "TrnEquivalence"("centerId");

-- CreateIndex
CREATE INDEX "TrnEquivalence_orgUnitId_idx" ON "TrnEquivalence"("orgUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "TrnEquivalence_userId_courseId_key" ON "TrnEquivalence"("userId", "courseId");
