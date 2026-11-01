/**
 * Khung giờ buổi học phải NEO theo giờ lớp, không theo phần giờ trong cột `date`.
 *
 * Ca thật 06/08/2026: chủ dự án cài 2 lớp cùng cơ sở, cùng GV, cùng phòng, cùng
 * ngày 30/07 — một lớp 10:00–11:30, một lớp 18:00–19:30 — và bị chặn bằng
 * "Trùng lịch giáo viên". Nguyên nhân: sessionWindow trả `startAt: date` và chỉ
 * dùng startTime/endTime để tính ĐỘ DÀI, nên cả hai ra cùng một khung.
 */
import { describe, it, expect } from "vitest";
import { sessionWindow } from "./schedule-conflict";
import { vnDateAt } from "@/lib/time/vn";

/** 00:00 giờ VN ngày 30/07/2026 — đúng dạng cột `date` đang lưu. */
const NGAY = vnDateAt(2026, 6, 30);
const den = (a: { startAt: Date; endAt: Date }, b: { startAt: Date; endAt: Date }) =>
  a.startAt < b.endAt && b.startAt < a.endAt;

describe("sessionWindow — neo theo giờ lớp", () => {
  it("[CA THẬT 06/08] 10:00–11:30 và 18:00–19:30 cùng ngày → KHÔNG đè nhau", () => {
    const sata6 = sessionWindow(NGAY, "10:00", "11:30");
    const sata4 = sessionWindow(NGAY, "18:00", "19:30");
    expect(sata6.startAt.getTime()).not.toBe(sata4.startAt.getTime());
    expect(den(sata6, sata4)).toBe(false);
  });

  it("neo đúng giờ VN (không lệch 7 tiếng khi server chạy UTC)", () => {
    const w = sessionWindow(NGAY, "10:00", "11:30");
    expect(w.startAt.toISOString()).toBe("2026-07-30T03:00:00.000Z"); // 10:00 VN
    expect(w.endAt.toISOString()).toBe("2026-07-30T04:30:00.000Z"); // 11:30 VN
  });

  it("VẪN bắt được trùng thật: 10:00–11:30 với 11:00–12:30 → đè nhau", () => {
    expect(den(sessionWindow(NGAY, "10:00", "11:30"), sessionWindow(NGAY, "11:00", "12:30"))).toBe(true);
  });

  it("hai buổi cùng giờ y hệt → đè nhau", () => {
    expect(den(sessionWindow(NGAY, "18:00", "19:30"), sessionWindow(NGAY, "18:00", "19:30"))).toBe(true);
  });

  it("kề nhau nhưng không chồng (11:30 nối 11:30) → KHÔNG đè", () => {
    expect(den(sessionWindow(NGAY, "10:00", "11:30"), sessionWindow(NGAY, "11:30", "13:00"))).toBe(false);
  });

  it("lớp chưa cấu hình giờ → giữ mốc cũ, không đoán bừa", () => {
    const w = sessionWindow(NGAY, null, null);
    expect(w.startAt.getTime()).toBe(NGAY.getTime());
    expect(w.endAt.getTime() - w.startAt.getTime()).toBe(90 * 60_000);
  });

  it("thiếu endTime → vẫn neo đúng giờ bắt đầu, dài mặc định 90'", () => {
    const w = sessionWindow(NGAY, "18:00", null);
    expect(w.startAt.toISOString()).toBe("2026-07-30T11:00:00.000Z"); // 18:00 VN
    expect(w.endAt.getTime() - w.startAt.getTime()).toBe(90 * 60_000);
  });
});
