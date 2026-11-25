-- 07/08/2026 — KẾ HOẠCH LỊCH HỌC NHIỀU GIAI ĐOẠN.
--
-- `ClassScheduleSlot` có UNIQUE(classId, weekday) và không mang chiều thời gian ⇒ 1 lớp
-- chỉ biểu diễn được đúng MỘT lịch cho cả vòng đời. Hai bảng dưới cho phép lớp đổi nhịp
-- giữa khoá (tháng 7: 2 buổi/tuần → tháng 8: 1 buổi/tuần) và đổi giờ theo giai đoạn.
--
-- ADDITIVE hoàn toàn: KHÔNG đụng ClassScheduleSlot / Class. Lớp chưa có giai đoạn nào
-- chạy y hệt trước đây (2-phase). Backfill lớp cũ chạy riêng bằng script, không nhét vào
-- migration để không khoá bảng Class trên prod.

CREATE TABLE "ClassSchedulePhase" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    -- 00:00 GIỜ VN (= 17:00Z hôm trước). Đừng ghi bằng z.coerce.date("YYYY-MM-DD"),
    -- nó cho nửa đêm UTC = 07:00 VN và ăn mất buổi sáng của đúng ngày áp dụng.
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL,
    -- Tính CẢ ngày này. NULL = giai đoạn mở (chỉ giai đoạn cuối được NULL).
    "effectiveTo" TIMESTAMPTZ(6),
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ClassSchedulePhase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClassSchedulePhase_classId_effectiveFrom_idx"
    ON "ClassSchedulePhase"("classId", "effectiveFrom");

ALTER TABLE "ClassSchedulePhase" ADD CONSTRAINT "ClassSchedulePhase_classId_fkey"
    FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ClassSchedulePhaseSlot" (
    "id" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT,

    CONSTRAINT "ClassSchedulePhaseSlot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClassSchedulePhaseSlot_phaseId_weekday_key"
    ON "ClassSchedulePhaseSlot"("phaseId", "weekday");
CREATE INDEX "ClassSchedulePhaseSlot_phaseId_idx" ON "ClassSchedulePhaseSlot"("phaseId");

ALTER TABLE "ClassSchedulePhaseSlot" ADD CONSTRAINT "ClassSchedulePhaseSlot_phaseId_fkey"
    FOREIGN KEY ("phaseId") REFERENCES "ClassSchedulePhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
