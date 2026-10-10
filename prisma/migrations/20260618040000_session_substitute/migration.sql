-- P5/T11 — dạy thay / đổi phòng cấp buổi: persist thay vì chỉ ghi audit.
ALTER TABLE "ClassSession" ADD COLUMN "substituteTeacherId" TEXT;
ALTER TABLE "ClassSession" ADD COLUMN "substituteRoomId" TEXT;
