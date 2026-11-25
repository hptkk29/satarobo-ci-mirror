// T3.4 — quy ước tên lớp `tênkhoá.giờ-thứ.phòng`. Thuần, không DB (lane test:unit).
import { describe, it, expect } from "vitest";
import {
  buildClassDisplayName,
  classCourseToken,
  formatClassTimeToken,
} from "./naming";

describe("formatClassTimeToken", () => {
  it("[T3.4-1] có phút → 17h30; tròn giờ → 08h", () => {
    expect(formatClassTimeToken("17:30")).toBe("17h30");
    expect(formatClassTimeToken("08:00")).toBe("08h");
    expect(formatClassTimeToken("8:00")).toBe("08h"); // 1 chữ số vẫn pad
  });

  it("[T3.4-2] rỗng/sai định dạng → null (không chèn rác vào tên)", () => {
    expect(formatClassTimeToken(null)).toBeNull();
    expect(formatClassTimeToken("")).toBeNull();
    expect(formatClassTimeToken("17h30")).toBeNull();
  });
});

describe("classCourseToken", () => {
  it("[T3.4-3] thường hoá + bỏ ký tự lạ, lùi về slug khi chưa có code", () => {
    expect(classCourseToken("SATA_4")).toBe("sata4");
    expect(classCourseToken(null, "luyenthirobosim")).toBe("luyenthirobosim");
    expect(classCourseToken(null, null)).toBe("");
  });
});

describe("buildClassDisplayName", () => {
  it("[T3.4-4] đủ dữ liệu → tênkhoá.giờ-thứ.phòng", () => {
    expect(
      buildClassDisplayName({
        courseCode: "SATA4",
        scheduleDays: [1, 5],
        startTime: "17:30",
        roomCode: "P302",
      }),
    ).toBe("sata4.17h30-T2&17h30-T6.P302");
  });

  it("[T3.4-5] CN xếp cuối tuần (T2..T7 rồi CN), khử trùng thứ", () => {
    expect(
      buildClassDisplayName({
        courseCode: "SATA4",
        scheduleDays: [0, 6, 6],
        startTime: "08:00",
        roomCode: "P101",
      }),
    ).toBe("sata4.08h-T7&08h-CN.P101");
  });

  it("[T3.4-6] thiếu phòng / thiếu giờ → bỏ đoạn đó, không để dấu chấm thừa", () => {
    expect(
      buildClassDisplayName({ courseCode: "SATA4", scheduleDays: [3], startTime: "17:30" }),
    ).toBe("sata4.17h30-T4");
    expect(
      buildClassDisplayName({ courseCode: "SATA4", scheduleDays: [3], roomCode: "P302" }),
    ).toBe("sata4.T4.P302");
  });

  it("[T3.4-7] chưa chọn gì → chuỗi rỗng (form giữ tên người dùng tự nhập)", () => {
    expect(buildClassDisplayName({ scheduleDays: [] })).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BGĐ 31/07 — lớp có GIỜ RIÊNG THEO THỨ (2 ca khác giờ). Trước đây model chỉ 1
// giờ chung nên ví dụ của BGĐ (`17h30-T2&08h-T6`) không biểu diễn được.
// ═══════════════════════════════════════════════════════════════════════════

describe("buildClassDisplayName — giờ riêng theo thứ (BGĐ 31/07)", () => {
  it("đúng ví dụ BGĐ: sata4.17h30-T2&08h-T6.P302", () => {
    expect(
      buildClassDisplayName({
        courseCode: "SATA_4",
        scheduleDays: [1, 5],
        startTime: "17:30",
        slots: [
          { weekday: 1, startTime: "17:30" },
          { weekday: 5, startTime: "08:00" },
        ],
        roomCode: "P302",
      }),
    ).toBe("sata4.17h30-T2&08h-T6.P302");
  });

  it("slot THẮNG giờ chung ở thứ tương ứng; thứ còn lại giữ giờ chung", () => {
    expect(
      buildClassDisplayName({
        courseCode: "SATA4",
        scheduleDays: [1, 3, 5],
        startTime: "19:00",
        slots: [
          { weekday: 5, startTime: "08:00" },
          { weekday: 1, startTime: "17:30" },
        ],
      }),
    ).toBe("sata4.17h30-T2&19h-T4&08h-T6");
  });

  it("thứ nào KHÔNG có slot thì rơi về giờ chung (không mất thứ)", () => {
    expect(
      buildClassDisplayName({
        courseCode: "SATA4",
        scheduleDays: [1, 5],
        startTime: "17:30",
        slots: [{ weekday: 5, startTime: "08:00" }],
      }),
    ).toBe("sata4.17h30-T2&08h-T6");
  });

  it("không có slot → giữ nguyên hành vi cũ (1 giờ chung cho mọi thứ)", () => {
    expect(
      buildClassDisplayName({
        courseCode: "SATA4",
        scheduleDays: [1, 5],
        startTime: "17:30",
        slots: [],
        roomCode: "P302",
      }),
    ).toBe("sata4.17h30-T2&17h30-T6.P302");
  });
});
