-- Chống trả lời trùng 1 survey cho 1 con (double-submit / TOCTOU ở portal khảo sát).
-- Dedupe trước: giữ bản ghi SỚM NHẤT của mỗi cặp (surveyId, studentId) để tạo UNIQUE
-- không fail trên dữ liệu cũ. Hàng studentId NULL không bị ảnh hưởng (NULL distinct).
DELETE FROM "SurveyResponse" a
USING "SurveyResponse" b
WHERE a."surveyId" = b."surveyId"
  AND a."studentId" IS NOT NULL
  AND b."studentId" = a."studentId"
  AND (b."createdAt" < a."createdAt" OR (b."createdAt" = a."createdAt" AND b."id" < a."id"));

-- CreateIndex
CREATE UNIQUE INDEX "SurveyResponse_surveyId_studentId_key" ON "SurveyResponse"("surveyId", "studentId");
