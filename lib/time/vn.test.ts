import { describe, it, expect } from "vitest";
import {
  parseVnDateTimeLocal,
  parseVnYmd,
  vnAddDays,
  vnDateAt,
  vnDateOnly,
  vnEndOfDay,
  vnParts,
  vnStartOfDay,
  vnWeekday,
  vnYmd,
} from "./vn";

describe("vnDateAt", () => {
  it("dựng đúng thời điểm UTC cho đồng hồ VN", () => {
    // 17h30 T7 20/06/2026 ở VN = 10:30Z cùng ngày.
    expect(vnDateAt(2026, 5, 20, 17, 30).toISOString()).toBe("2026-06-20T10:30:00.000Z");
    // Nửa đêm VN = 17:00Z hôm trước.
    expect(vnDateAt(2026, 5, 20).toISOString()).toBe("2026-06-19T17:00:00.000Z");
  });
});

describe("vnParts / vnWeekday / vnYmd", () => {
  it("đọc theo lịch VN, không theo TZ máy chạy", () => {
    // 2026-06-20T18:00:00Z = 01:00 CN 21/06 ở VN.
    const d = new Date("2026-06-20T18:00:00.000Z");
    expect(vnYmd(d)).toBe("2026-06-21");
    expect(vnWeekday(d)).toBe(0); // CN
    expect(vnParts(d)).toMatchObject({ year: 2026, month: 5, day: 21, hour: 1, minute: 0 });
  });

  it("round-trip: dựng rồi đọc lại ra đúng thứ + giờ", () => {
    const sat = vnDateAt(2026, 5, 20, 17, 30);
    expect(vnWeekday(sat)).toBe(6); // T7
    expect(vnYmd(sat)).toBe("2026-06-20");
    expect(vnParts(sat)).toMatchObject({ hour: 17, minute: 30 });
  });
});

describe("vnStartOfDay / vnEndOfDay / vnAddDays", () => {
  it("mốc đầu & cuối ngày VN bao trọn ngày đó", () => {
    const noon = vnDateAt(2026, 5, 20, 12, 0);
    expect(vnYmd(vnStartOfDay(noon))).toBe("2026-06-20");
    expect(vnYmd(vnEndOfDay(noon))).toBe("2026-06-20");
    expect(vnEndOfDay(noon).getTime() - vnStartOfDay(noon).getTime()).toBe(86_400_000 - 1);
  });

  it("cộng ngày giữ nguyên giờ VN và trả object MỚI", () => {
    const src = vnDateAt(2026, 5, 20, 17, 30);
    const next = vnAddDays(src, 7);
    expect(vnYmd(next)).toBe("2026-06-27");
    expect(vnParts(next)).toMatchObject({ hour: 17, minute: 30 });
    expect(src.toISOString()).toBe("2026-06-20T10:30:00.000Z"); // không bị mutate
  });
});

describe("vnDateOnly / parseVnYmd", () => {
  it("vnDateOnly trùng quy ước z.coerce.date('YYYY-MM-DD')", () => {
    const evening = vnDateAt(2026, 5, 20, 19, 0); // 19h T7 ở VN
    expect(vnDateOnly(evening).toISOString()).toBe("2026-06-20T00:00:00.000Z");
    expect(vnDateOnly(evening).getTime()).toBe(new Date("2026-06-20").getTime());
  });

  it("parseVnYmd đọc ô <input type=date> thành nửa đêm VN", () => {
    expect(parseVnYmd("2026-06-20")!.toISOString()).toBe("2026-06-19T17:00:00.000Z");
    expect(vnYmd(parseVnYmd("2026-06-20")!)).toBe("2026-06-20");
    expect(parseVnYmd("20/06/2026")).toBeNull();
    expect(parseVnYmd("")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("parseVnDateTimeLocal — chuỗi <input type=\"datetime-local\">", () => {
  it("chuỗi trần được hiểu là GIỜ VN, không phải giờ tiến trình", () => {
    // 17:30 giờ VN = 10:30 UTC. Bản cũ (`new Date(value)`) chạy trên Vercel (UTC) ra
    // 17:30Z = 00:30 hôm sau giờ VN — lệch đúng 7 tiếng và nhảy sang ngày kế.
    expect(parseVnDateTimeLocal("2026-09-12T17:30")?.toISOString()).toBe(
      "2026-09-12T10:30:00.000Z",
    );
  });

  it("hạn nộp 23:59 KHÔNG được trôi sang ngày hôm sau", () => {
    expect(parseVnDateTimeLocal("2026-09-12T23:59")?.toISOString()).toBe(
      "2026-09-12T16:59:00.000Z",
    );
  });

  it("nhận cả dạng có giây", () => {
    expect(parseVnDateTimeLocal("2026-09-12T17:30:45")?.toISOString()).toBe(
      "2026-09-12T10:30:45.000Z",
    );
  });

  it("chuỗi ĐÃ có múi giờ giữ nguyên, không cộng thêm lần nữa", () => {
    expect(parseVnDateTimeLocal("2026-09-12T10:30:00Z")?.toISOString()).toBe(
      "2026-09-12T10:30:00.000Z",
    );
    expect(parseVnDateTimeLocal("2026-09-12T17:30:00+07:00")?.toISOString()).toBe(
      "2026-09-12T10:30:00.000Z",
    );
  });

  it("rỗng / null / rác → null (không ném, không ra Invalid Date)", () => {
    expect(parseVnDateTimeLocal("")).toBeNull();
    expect(parseVnDateTimeLocal("   ")).toBeNull();
    expect(parseVnDateTimeLocal(null)).toBeNull();
    expect(parseVnDateTimeLocal(undefined)).toBeNull();
    expect(parseVnDateTimeLocal("không phải ngày")).toBeNull();
  });

  it("lưu rồi nạp lại KHÔNG trôi thêm lần nữa (idempotent qua vòng chỉnh sửa)", () => {
    // Kịch bản thật: giáo vụ mở buổi ra sửa rồi bấm lưu mà không đổi giờ. Bản cũ cộng
    // thêm 7 tiếng MỖI LẦN lưu, nên buổi trôi dần mỗi lượt chỉnh.
    const lan1 = parseVnDateTimeLocal("2026-09-12T17:30")!;
    const p = vnParts(lan1);
    const chuoiLai = `${p.year}-${String(p.month + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
    expect(parseVnDateTimeLocal(chuoiLai)?.toISOString()).toBe(lan1.toISOString());
  });
});
