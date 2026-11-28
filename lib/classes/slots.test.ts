import { describe, it, expect } from "vitest";
import {
  resolveClassSlots,
  applySlotTimeToDate,
  startTimeForWeekday,
  sessionTimeRange,
} from "./slots";
import { parseVnYmd, vnParts, vnWeekday } from "@/lib/time/vn";

// BGĐ 31/07 — giờ học riêng theo từng thứ (lớp 2 ca khác giờ).

describe("resolveClassSlots", () => {
  it("không có slot → mọi thứ dùng giờ chung (hành vi cũ)", () => {
    expect(
      resolveClassSlots({ scheduleDays: [1, 5], startTime: "17:30", endTime: "19:00" }),
    ).toEqual([
      { weekday: 1, startTime: "17:30", endTime: "19:00" },
      { weekday: 5, startTime: "17:30", endTime: "19:00" },
    ]);
  });

  it("slot ghi đè giờ CỦA ĐÚNG THỨ đó, thứ khác giữ giờ chung", () => {
    expect(
      resolveClassSlots({
        scheduleDays: [1, 5],
        startTime: "17:30",
        endTime: "19:00",
        slots: [{ weekday: 5, startTime: "08:00", endTime: "09:30" }],
      }),
    ).toEqual([
      { weekday: 1, startTime: "17:30", endTime: "19:00" },
      { weekday: 5, startTime: "08:00", endTime: "09:30" },
    ]);
  });

  it("xếp T2..T7 rồi CN (thứ tự tuần học)", () => {
    const days = resolveClassSlots({ scheduleDays: [0, 6, 1], startTime: "08:00" }).map(
      (s) => s.weekday,
    );
    expect(days).toEqual([1, 6, 0]);
  });

  it("chưa chọn thứ → suy từ slot; không có gì → []", () => {
    expect(
      resolveClassSlots({ scheduleDays: [], slots: [{ weekday: 3, startTime: "18:00" }] }),
    ).toEqual([{ weekday: 3, startTime: "18:00", endTime: null }]);
    expect(resolveClassSlots({ scheduleDays: [] })).toEqual([]);
  });

  it("bỏ thứ không hợp lệ + slot trùng thứ", () => {
    expect(
      resolveClassSlots({
        scheduleDays: [9, 1],
        startTime: "17:30",
        slots: [
          { weekday: 1, startTime: "08:00" },
          { weekday: 1, startTime: "20:00" }, // trùng → bỏ
        ],
      }),
    ).toEqual([{ weekday: 1, startTime: "08:00", endTime: null }]);
  });
});

describe("applySlotTimeToDate", () => {
  const slots = resolveClassSlots({
    scheduleDays: [1, 5],
    startTime: "17:30",
    slots: [{ weekday: 5, startTime: "08:00" }],
  });

  // ⚠️ Assert bằng `vnParts`, KHÔNG bằng `getHours()/getDay()`: hai hàm đó đọc
  // theo TZ máy chạy nên test sẽ xanh ở máy dev (+07) mà vẫn để lọt bug trên
  // Vercel (UTC) — đúng cái bug 06/08/2026.
  it("gắn giờ theo ĐÚNG thứ của ngày", () => {
    // 2026-08-03 là thứ 2, 2026-08-07 là thứ 6.
    const mon = applySlotTimeToDate(parseVnYmd("2026-08-03")!, slots);
    const fri = applySlotTimeToDate(parseVnYmd("2026-08-07")!, slots);
    expect(vnWeekday(mon)).toBe(1);
    expect(vnParts(mon)).toMatchObject({ day: 3, hour: 17, minute: 30 });
    expect(vnWeekday(fri)).toBe(5);
    expect(vnParts(fri)).toMatchObject({ day: 7, hour: 8, minute: 0 });
  });

  it("thứ không có trong lịch → 00:00 (không đủ dữ liệu, không đoán)", () => {
    const wed = applySlotTimeToDate(parseVnYmd("2026-08-05")!, slots); // thứ 4
    expect(vnParts(wed)).toMatchObject({ day: 5, hour: 0, minute: 0 });
    expect(startTimeForWeekday(slots, 3)).toBeNull();
  });
});

describe("sessionTimeRange", () => {
  // Buổi mang giờ THẬT: giờ hiển thị lấy từ chính buổi, không phải bản sao trên Class —
  // đây là lý do tồn tại của hàm (lớp có Kế hoạch lịch nhiều giai đoạn).
  it("buổi có giờ thật → lấy giờ của BUỔI, độ dài suy từ khung giờ lớp", () => {
    const d = applySlotTimeToDate(parseVnYmd("2026-08-03")!, [
      { weekday: 1, startTime: "08:00", endTime: null },
    ]);
    // Lớp vẫn đang lưu 17:30–19:30 của giai đoạn trước → phải bị bỏ qua, chỉ mượn độ dài 2h.
    expect(sessionTimeRange(d, "17:30", "19:30")).toEqual({ start: "08:00", end: "10:00" });
  });

  // 08/08 — chốt chặn dữ liệu cũ. Buổi sinh TRƯỚC đợt vá giờ buổi 06/08 nằm ở 00:00 giờ VN
  // (= 17:00Z hôm trước) và KHÔNG mang giờ thật. In thẳng ra thì phụ huynh thấy "00:00 -
  // 02:00" rồi đưa con sai giờ. Cùng luật với `rowsToSlots` (lib/lms/schedule-conflict.ts):
  // không lớp nào học lúc nửa đêm ⇒ 00:00 luôn là dữ liệu chưa backfill.
  it("buổi cũ ở 00:00 giờ VN → lùi về giờ lớp, KHÔNG in 00:00", () => {
    const cu = new Date("2026-08-02T17:00:00.000Z"); // 00:00 ngày 03/08 giờ VN
    expect(vnParts(cu)).toMatchObject({ day: 3, hour: 0, minute: 0 });
    expect(sessionTimeRange(cu, "17:30", "19:30")).toEqual({ start: "17:30", end: "19:30" });
  });

  it("buổi cũ ở 00:00 mà lớp cũng không có giờ → trả 00:00, không bịa", () => {
    const cu = new Date("2026-08-02T17:00:00.000Z");
    expect(sessionTimeRange(cu, null, null)).toEqual({ start: "00:00", end: null });
  });

  it("thiếu giờ kết thúc của lớp → chỉ trả giờ bắt đầu của buổi", () => {
    const d = applySlotTimeToDate(parseVnYmd("2026-08-03")!, [
      { weekday: 1, startTime: "08:00", endTime: null },
    ]);
    expect(sessionTimeRange(d, "08:00", null)).toEqual({ start: "08:00", end: null });
  });
});
