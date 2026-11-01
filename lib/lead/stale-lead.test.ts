// C-05 — ĐỒNG HỒ "chưa tiếp cận lại" + hai ngưỡng cảnh báo lead treo.
//
// Bộ test này canh bốn thứ hỏng CÂM — hỏng mà bảng vẫn vẽ ra số đẹp và không ai nghi:
//
//  1. CHƯA TIẾP CẬN LẦN NÀO BỊ ĐỌC THÀNH "0 NGÀY". Lead vào hệ thống 40 ngày, không ai
//     gọi lần nào ⇒ `lastOutreachAt = null`. Nếu quy ước null → 0 thì đúng những phiếu
//     bị bỏ quên nhất lại hiện xanh, tức C-05 báo ngược.
//  2. NGƯỠNG BỊ RẢI TRONG JSX. Chốt 24/08/2026 là vàng ≥ 2 ngày / đỏ ≥ 7 ngày; hai số
//     này phải nằm ĐÚNG MỘT chỗ, và cấu hình theo cơ sở phải đè được (quyết định 12(a)).
//  3. SỐ NGÀY ÂM. Đồng hồ máy lệch / hoạt động ghi mốc tương lai ⇒ `now - moc < 0`.
//     Hiện "-3 ngày" là mất uy tín cả bảng; phải kẹp về 0.
//  4. NGƯỠNG CẤU HÌNH ĐẢO NGƯỢC (đỏ < vàng) LÀM RƠI CẢNH BÁO. Ai đó đặt nhầm thì phải
//     nghiêng về ĐỎ, không được rơi xuống "bình thường".
import { describe, it, expect } from "vitest";
import {
  STALE_LEAD_WARN_DAYS,
  STALE_LEAD_DANGER_DAYS,
  DEFAULT_STALE_LEAD_THRESHOLDS,
  daysSince,
  staleLevel,
  buildOutreachClock,
} from "./stale-lead";

const GIO = 3_600_000;
const NGAY = 24 * GIO;
const NOW = new Date("2026-08-26T09:00:00+07:00");
const truoc = (ms: number) => new Date(NOW.getTime() - ms);

describe("[C-05] hai ngưỡng là quyết định 24/08/2026, không phải số gõ trong JSX", () => {
  it("vàng = 2 ngày · đỏ = 7 ngày", () => {
    expect(STALE_LEAD_WARN_DAYS).toBe(2);
    expect(STALE_LEAD_DANGER_DAYS).toBe(7);
    expect(DEFAULT_STALE_LEAD_THRESHOLDS).toEqual({ warnDays: 2, dangerDays: 7 });
  });
});

describe("[C-05] daysSince — số ngày TRÒN đã trôi qua", () => {
  it("1 ngày 23 giờ vẫn là 1 ngày (không làm tròn lên)", () => {
    expect(daysSince(truoc(NGAY + 23 * GIO), NOW)).toBe(1);
  });

  it("đúng 2 ngày là 2", () => {
    expect(daysSince(truoc(2 * NGAY), NOW)).toBe(2);
  });

  it("mốc ở TƯƠNG LAI (đồng hồ lệch) kẹp về 0, không ra số âm", () => {
    expect(daysSince(new Date(NOW.getTime() + 5 * NGAY), NOW)).toBe(0);
  });

  it("cùng thời điểm = 0", () => {
    expect(daysSince(NOW, NOW)).toBe(0);
  });
});

describe("[C-05] staleLevel — biên của hai ngưỡng", () => {
  it("dưới 2 ngày: bình thường", () => {
    expect(staleLevel(0)).toBe("OK");
    expect(staleLevel(1)).toBe("OK");
  });

  it("đúng 2 ngày đã là VÀNG (ngưỡng là ≥, không phải >)", () => {
    expect(staleLevel(2)).toBe("WARN");
    expect(staleLevel(6)).toBe("WARN");
  });

  it("đúng 7 ngày đã là ĐỎ", () => {
    expect(staleLevel(7)).toBe("DANGER");
    expect(staleLevel(90)).toBe("DANGER");
  });

  it("cấu hình theo cơ sở đè được hai ngưỡng mặc định", () => {
    const chat = { warnDays: 1, dangerDays: 3 };
    expect(staleLevel(1, chat)).toBe("WARN");
    expect(staleLevel(3, chat)).toBe("DANGER");
    // Cùng con số đó với ngưỡng mặc định thì chưa tới đâu — chứng minh là ngưỡng
    // THẬT SỰ được đọc từ tham số chứ không phải hằng số nấp trong thân hàm.
    expect(staleLevel(1)).toBe("OK");
    expect(staleLevel(3)).toBe("WARN");
  });

  it("ngưỡng đặt ngược (đỏ < vàng) vẫn KHÔNG rơi cảnh báo — nghiêng về đỏ", () => {
    const nguoc = { warnDays: 7, dangerDays: 2 };
    expect(staleLevel(3, nguoc)).toBe("DANGER");
    expect(staleLevel(1, nguoc)).toBe("OK");
  });
});

describe("[C-05] buildOutreachClock — chưa tiếp cận lần nào KHÔNG được hiện 0 ngày", () => {
  it("có mốc tiếp cận: đếm từ mốc đó", () => {
    const c = buildOutreachClock({
      lastOutreachAt: truoc(3 * NGAY),
      createdAt: truoc(40 * NGAY),
      now: NOW,
    });
    expect(c.days).toBe(3);
    expect(c.fromCreatedAt).toBe(false);
    expect(c.level).toBe("WARN");
  });

  it("CHƯA tiếp cận lần nào: đếm từ lúc phiếu vào hệ thống + bật cờ để màn nói ra", () => {
    const c = buildOutreachClock({
      lastOutreachAt: null,
      createdAt: truoc(40 * NGAY),
      now: NOW,
    });
    expect(c.days).toBe(40);
    expect(c.fromCreatedAt).toBe(true);
    expect(c.level).toBe("DANGER");
    expect(c.lastOutreachAt).toBeNull();
  });

  it("phiếu vừa vào hôm nay, chưa ai gọi: 0 ngày nhưng vẫn phải khai là đếm từ ngày vào", () => {
    const c = buildOutreachClock({
      lastOutreachAt: null,
      createdAt: truoc(2 * GIO),
      now: NOW,
    });
    expect(c.days).toBe(0);
    expect(c.fromCreatedAt).toBe(true);
    expect(c.level).toBe("OK");
  });

  it("ngưỡng của cơ sở được truyền xuống tận mức cảnh báo", () => {
    const c = buildOutreachClock({
      lastOutreachAt: truoc(4 * NGAY),
      createdAt: truoc(40 * NGAY),
      now: NOW,
      thresholds: { warnDays: 1, dangerDays: 3 },
    });
    expect(c.level).toBe("DANGER");
  });
});
