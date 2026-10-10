// R3 — lõi LMS thuần: scheduling, attendance, media-key, makeup. Pure.
import { describe, it, expect } from "vitest";
import { detectScheduleConflict, hasCapacity, overlaps } from "@/lib/lms/scheduling";
import { computeAttendanceRate, rateFromStatuses, needsMakeup } from "@/lib/lms/attendance-rate";
import { buildMediaObjectKey, keyContainsName, MEDIA_SIGNED_URL_TTL_SECONDS } from "@/lib/lms/media-key";
import { canMakeupForLesson, canTransitionMakeup } from "@/lib/lms/makeup";

const d = (s: string) => new Date(s);

describe("[R3-03] scheduling", () => {
  const existing = [
    { id: "s1", roomId: "R1", teacherId: "T1", startAt: d("2026-06-10T08:00:00Z"), endAt: d("2026-06-10T10:00:00Z") },
  ];
  it("[R3-03-C3.1] trùng phòng (giao giờ)", () => {
    const r = detectScheduleConflict(existing, { roomId: "R1", teacherId: "T9", startAt: d("2026-06-10T09:00:00Z"), endAt: d("2026-06-10T11:00:00Z") });
    expect(r.roomConflict).toBe(true);
    expect(r.teacherConflict).toBe(false);
  });
  it("[R3-03-C3.2] trùng GV", () => {
    const r = detectScheduleConflict(existing, { roomId: "R2", teacherId: "T1", startAt: d("2026-06-10T09:00:00Z"), endAt: d("2026-06-10T11:00:00Z") });
    expect(r.teacherConflict).toBe(true);
    expect(r.roomConflict).toBe(false);
  });
  it("không giao giờ → không trùng", () => {
    expect(overlaps({ startAt: d("2026-06-10T10:00:00Z"), endAt: d("2026-06-10T11:00:00Z") }, existing[0]!)).toBe(false);
    const r = detectScheduleConflict(existing, { roomId: "R1", teacherId: "T1", startAt: d("2026-06-10T10:00:00Z"), endAt: d("2026-06-10T12:00:00Z") });
    expect(r.roomConflict).toBe(false);
  });
  it("[R3-03-C3.4] sức chứa", () => {
    expect(hasCapacity(9, 10)).toBe(true);
    expect(hasCapacity(10, 10)).toBe(false);
    expect(hasCapacity(100, null)).toBe(true);
  });
});

describe("[R3-04] attendance", () => {
  it("[R3-04-C4.2] rate = (PRESENT+LATE)/total", () => {
    expect(computeAttendanceRate({ present: 6, late: 2, totalCompleted: 10 })).toBe(0.8);
    expect(computeAttendanceRate({ present: 0, late: 0, totalCompleted: 0 })).toBe(0); // chia-0
    expect(rateFromStatuses(["PRESENT", "LATE", "ABSENT", "EXCUSED"])).toBe(0.5); // 2/4
  });
  // 02/10/2026 — chủ dự án chốt "vắng có phép cũng cần học bù": MỌI loại vắng ⇒ cần bù.
  it("[R3-04-C4.3] mọi loại vắng (kể cả có phép) → cần học bù; có mặt / đi muộn thì không", () => {
    for (const s of ["ABSENT", "EXCUSED", "ABSENT_EXCUSED", "ABSENT_UNEXCUSED"] as const) {
      expect(needsMakeup(s), s).toBe(true);
    }
    expect(needsMakeup("PRESENT")).toBe(false);
    expect(needsMakeup("LATE")).toBe(false);
  });
});

describe("[R3-06] media key (privacy C6.5)", () => {
  it("key không chứa tên học sinh + TTL 15'", () => {
    const key = buildMediaObjectKey({ classSessionId: "sess1", mediaId: "m1", ext: "jpg" });
    expect(key).toBe("class-media/sess1/m1.jpg");
    expect(keyContainsName(key, "Nguyễn Văn A")).toBe(false);
    expect(MEDIA_SIGNED_URL_TTL_SECONDS).toBe(900);
  });
  it("phát hiện key lộ tên (defensive)", () => {
    expect(keyContainsName("class-media/nguyenvana/x.jpg", "Nguyen Van A")).toBe(true);
  });
});

describe("[R3-07] makeup", () => {
  it("[R3-07-C7.2] không học bù vượt tiến độ", () => {
    expect(canMakeupForLesson(3, 5)).toBe(true); // bài 3, lớp đến bài 5
    expect(canMakeupForLesson(6, 5)).toBe(false); // bài 6 vượt tiến độ
  });
  it("[R3-07-C7.1] lifecycle PENDING→SCHEDULED→COMPLETED", () => {
    expect(canTransitionMakeup("PENDING", "SCHEDULED")).toBe(true);
    expect(canTransitionMakeup("SCHEDULED", "COMPLETED")).toBe(true);
    expect(canTransitionMakeup("COMPLETED", "PENDING")).toBe(false);
    expect(canTransitionMakeup("PENDING", "COMPLETED")).toBe(false); // không nhảy cóc
  });
});
