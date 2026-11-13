/**
 * F-20 — hạn duyệt ảnh/video buổi học: tính hạn + "buổi này đã quá hạn duyệt chưa".
 *
 * ⚠️ TRỌNG TÂM CỦA BỘ TEST NÀY LÀ MÚI GIỜ. Hạn là "10h sáng GIỜ VIỆT NAM", còn mọi
 * `Date` trong hệ là mốc thời gian tuyệt đối (UTC). Lệch 7 tiếng là loại lỗi KHÔNG
 * lộ ra trên máy dev (Windows Asia/Saigon = +07 nên nhìn như đúng) mà chỉ lộ trên
 * Vercel/CI (TZ = UTC), và chỉ lộ với người trực đêm — đúng nhóm giờ 17:00–24:00 VN
 * là đã sang ngày UTC khác. Vì thế mọi kỳ vọng dưới đây đều khẳng định HAI thứ:
 * mốc UTC chính xác, VÀ chuỗi đọc bằng đồng hồ Asia/Ho_Chi_Minh.
 */
import { describe, it, expect } from "vitest";
import {
  computeReviewDeadline,
  isMediaReviewOverdue,
  type ReviewDeadlineConfig,
} from "@/lib/lms/media-review-deadline";
import { SETTINGS } from "@/lib/settings/registry";

/** Đọc một mốc thời gian bằng đồng hồ VN — độc lập TZ của tiến trình chạy test. */
function vnClock(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** Cấu hình mặc định lấy THẲNG từ registry — không chép lại số ở đây (một nguồn sự thật). */
const DEFAULT_CFG: ReviewDeadlineConfig = {
  hour: SETTINGS["media.reviewDeadlineHour"].default,
  offsetDays: SETTINGS["media.reviewDeadlineOffsetDays"].default,
};

describe("[F-20] computeReviewDeadline — hạn duyệt tính theo GIỜ VN", () => {
  it("[F-20-T01] mặc định registry = 10h sáng NGÀY HÔM SAU giờ VN", () => {
    // Buổi dạy 24/08/2026 (ngày lưu kiểu date-only: nửa đêm UTC).
    const deadline = computeReviewDeadline(
      new Date("2026-08-24T00:00:00.000Z"),
      DEFAULT_CFG,
    );
    expect(deadline.toISOString()).toBe("2026-08-25T03:00:00.000Z");
    expect(vnClock(deadline)).toBe("2026-08-25, 10:00");
  });

  it("[F-20-T02] buổi kết thúc 22h VN (đã sang ngày UTC khác) vẫn tính theo NGÀY VN", () => {
    // 2026-08-24T22:30 VN === 2026-08-24T15:30Z. Nếu code đọc ngày bằng UTC thì vẫn
    // ra 24/08 → may mắn đúng. Nên ca chốt là ca dưới (T03).
    const deadline = computeReviewDeadline(
      new Date("2026-08-24T15:30:00.000Z"),
      DEFAULT_CFG,
    );
    expect(vnClock(deadline)).toBe("2026-08-25, 10:00");
  });

  it("[F-20-T03] buổi 00:30 VN ngày 25/08 (17:30Z ngày 24/08) → hạn 26/08, KHÔNG phải 25/08", () => {
    // 🔴 Ca người-trực-đêm: đọc ngày bằng `getUTCDate()` sẽ ra 24/08 → hạn 25/08,
    // sớm hơn thực tế đúng một ngày. Đây là lỗi lệch 7 tiếng nói ở đầu file.
    const deadline = computeReviewDeadline(
      new Date("2026-08-24T17:30:00.000Z"),
      DEFAULT_CFG,
    );
    expect(deadline.toISOString()).toBe("2026-08-26T03:00:00.000Z");
    expect(vnClock(deadline)).toBe("2026-08-26, 10:00");
  });

  it("[F-20-T04] qua tháng: 31/08 → 01/09", () => {
    const deadline = computeReviewDeadline(
      new Date("2026-08-31T00:00:00.000Z"),
      DEFAULT_CFG,
    );
    expect(deadline.toISOString()).toBe("2026-09-01T03:00:00.000Z");
    expect(vnClock(deadline)).toBe("2026-09-01, 10:00");
  });

  it("[F-20-T05] qua năm: 31/12/2026 → 01/01/2027", () => {
    const deadline = computeReviewDeadline(
      new Date("2026-12-31T00:00:00.000Z"),
      DEFAULT_CFG,
    );
    expect(deadline.toISOString()).toBe("2027-01-01T03:00:00.000Z");
    expect(vnClock(deadline)).toBe("2027-01-01, 10:00");
  });

  it("[F-20-T06] qua năm nhuận: 28/02/2028 → 29/02/2028", () => {
    const deadline = computeReviewDeadline(
      new Date("2028-02-28T00:00:00.000Z"),
      DEFAULT_CFG,
    );
    expect(vnClock(deadline)).toBe("2028-02-29, 10:00");
  });

  it("[F-20-T07] offsetDays = 0 → hạn ngay trong ngày dạy", () => {
    const deadline = computeReviewDeadline(new Date("2026-08-24T00:00:00.000Z"), {
      hour: 10,
      offsetDays: 0,
    });
    expect(deadline.toISOString()).toBe("2026-08-24T03:00:00.000Z");
    expect(vnClock(deadline)).toBe("2026-08-24, 10:00");
  });

  it("[F-20-T08] hour = 0 → nửa đêm VN = 17:00Z hôm trước (biên dễ sai nhất)", () => {
    const deadline = computeReviewDeadline(new Date("2026-08-24T00:00:00.000Z"), {
      hour: 0,
      offsetDays: 1,
    });
    expect(deadline.toISOString()).toBe("2026-08-24T17:00:00.000Z");
    expect(vnClock(deadline)).toBe("2026-08-25, 00:00");
  });

  it("[F-20-T09] hour = 23 → 16:00Z cùng ngày VN", () => {
    const deadline = computeReviewDeadline(new Date("2026-08-24T00:00:00.000Z"), {
      hour: 23,
      offsetDays: 1,
    });
    expect(deadline.toISOString()).toBe("2026-08-25T16:00:00.000Z");
    expect(vnClock(deadline)).toBe("2026-08-25, 23:00");
  });

  it("[F-20-T10] giờ-phút của buổi KHÔNG rớt vào hạn — hạn luôn tròn giờ cấu hình", () => {
    const a = computeReviewDeadline(new Date("2026-08-24T02:17:43.512Z"), DEFAULT_CFG);
    const b = computeReviewDeadline(new Date("2026-08-24T09:59:00.000Z"), DEFAULT_CFG);
    expect(a.toISOString()).toBe("2026-08-25T03:00:00.000Z");
    expect(b.toISOString()).toBe(a.toISOString());
  });

  it("[F-20-T11] cấu hình sai (giờ ngoài 0..23 / offset âm) → ném, không đoán bừa", () => {
    const d = new Date("2026-08-24T00:00:00.000Z");
    expect(() => computeReviewDeadline(d, { hour: 24, offsetDays: 1 })).toThrow();
    expect(() => computeReviewDeadline(d, { hour: -1, offsetDays: 1 })).toThrow();
    expect(() => computeReviewDeadline(d, { hour: 10, offsetDays: -1 })).toThrow();
    expect(() => computeReviewDeadline(d, { hour: 9.5, offsetDays: 1 })).toThrow();
  });

  it("[F-20-T12] ngày dạy không hợp lệ → ném", () => {
    expect(() => computeReviewDeadline(new Date("khong-phai-ngay"), DEFAULT_CFG)).toThrow();
  });
});

describe("[F-20] isMediaReviewOverdue — buổi này đã quá hạn duyệt chưa", () => {
  const deadlineAt = new Date("2026-08-25T03:00:00.000Z"); // 10:00 VN 25/08

  it("[F-20-T20] chưa duyệt xong, chưa tới hạn → CHƯA quá hạn", () => {
    expect(
      isMediaReviewOverdue({
        deadlineAt,
        completedAt: null,
        now: new Date("2026-08-25T02:59:59.999Z"), // 09:59:59 VN
      }),
    ).toBe(false);
  });

  it("[F-20-T21] đúng mốc hạn mà chưa duyệt → CHƯA quá hạn (biên đóng)", () => {
    // 10:00:00.000 VN là hạn CHÓT, không phải đã trễ.
    expect(
      isMediaReviewOverdue({ deadlineAt, completedAt: null, now: deadlineAt }),
    ).toBe(false);
  });

  it("[F-20-T22] qua hạn 1ms mà chưa duyệt → QUÁ HẠN", () => {
    expect(
      isMediaReviewOverdue({
        deadlineAt,
        completedAt: null,
        now: new Date(deadlineAt.getTime() + 1),
      }),
    ).toBe(true);
  });

  it("[F-20-T23] đã duyệt xong TRƯỚC hạn → không quá hạn, dù bây giờ đã qua hạn cả tuần", () => {
    expect(
      isMediaReviewOverdue({
        deadlineAt,
        completedAt: new Date("2026-08-25T01:00:00.000Z"), // 08:00 VN 25/08
        now: new Date("2026-09-01T00:00:00.000Z"),
      }),
    ).toBe(false);
  });

  it("[F-20-T24] đã duyệt xong SAU hạn → quá hạn (F-31 'Phê duyệt trễ'), vĩnh viễn", () => {
    expect(
      isMediaReviewOverdue({
        deadlineAt,
        completedAt: new Date("2026-08-25T04:00:00.000Z"), // 11:00 VN 25/08
        now: new Date("2026-09-01T00:00:00.000Z"),
      }),
    ).toBe(true);
  });

  it("[F-20-T25] duyệt xong đúng mốc hạn → không tính trễ", () => {
    expect(
      isMediaReviewOverdue({
        deadlineAt,
        completedAt: deadlineAt,
        now: new Date("2026-09-01T00:00:00.000Z"),
      }),
    ).toBe(false);
  });

  it("[F-20-T26] bỏ trống completedAt = chưa duyệt xong (không phải 'đã xong lúc 0')", () => {
    expect(
      isMediaReviewOverdue({ deadlineAt, now: new Date("2026-08-26T00:00:00.000Z") }),
    ).toBe(true);
  });

  it("[F-20-T27] hạn ĐÓNG BĂNG: đổi cấu hình không viết lại quá khứ", () => {
    // F-20-2 — `deadlineAt` là tham số vào, hàm không tự đọc cấu hình. Cùng một
    // deadlineAt cũ thì kết quả không đổi dù cấu hình hiện tại là gì.
    const now = new Date("2026-08-25T05:00:00.000Z");
    expect(isMediaReviewOverdue({ deadlineAt, completedAt: null, now })).toBe(true);
    const hanMoi = computeReviewDeadline(new Date("2026-08-24T00:00:00.000Z"), {
      hour: 18,
      offsetDays: 1,
    });
    expect(isMediaReviewOverdue({ deadlineAt: hanMoi, completedAt: null, now })).toBe(false);
  });

  it("[F-20-T28] mốc không hợp lệ → ném, không im lặng trả false", () => {
    expect(() =>
      isMediaReviewOverdue({ deadlineAt: new Date(NaN), now: new Date() }),
    ).toThrow();
    expect(() =>
      isMediaReviewOverdue({ deadlineAt, now: new Date(NaN) }),
    ).toThrow();
  });
});
