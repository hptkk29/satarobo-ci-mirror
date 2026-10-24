// @vitest-environment jsdom
// Hệ affiliate dựng từ 31/07 (bảng + màn quản lý + link ?ref=) nhưng KHÔNG form nào
// gửi `ref` ⇒ `Lead.affiliateId` chưa bao giờ được gắn. Lưới này khoá phần thuần.
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  ATTRIBUTION_COOKIE,
  ATTRIBUTION_MAX_AGE_DAYS,
  captureAttribution,
  lamHieuLucAttribution,
  mergeAttribution,
  parseAttributionFromSearch,
  readAttribution,
  serializeAttribution,
  deserializeAttribution,
  deserializeAttributionDaLuu,
  readCookie,
} from "./attribution";

const NGAY = 24 * 60 * 60 * 1000;
/** Ngày TUYỆT ĐỐI (luật 19) — hàm thuần không đọc đồng hồ nên mốc nào cũng được. */
const T0 = Date.UTC(2026, 6, 1, 3, 0, 0);

describe("parseAttributionFromSearch", () => {
  it("đọc đủ ref + utm + click-id, chấp nhận cả dạng có/không dấu ?", () => {
    const q = "?ref=ANNGUYEN&utm_source=fb&utm_medium=cpc&utm_campaign=t8&fbclid=abc";
    expect(parseAttributionFromSearch(q)).toEqual({
      ref: "ANNGUYEN",
      utmSource: "fb",
      utmMedium: "cpc",
      utmCampaign: "t8",
      fbclid: "abc",
    });
    expect(parseAttributionFromSearch("ref=X123")).toEqual({ ref: "X123" });
  });

  it("bỏ qua tham số rỗng/toàn khoảng trắng (không lưu khoá rác)", () => {
    expect(parseAttributionFromSearch("?ref=&utm_source=%20")).toEqual({});
  });

  it("cắt theo trần của validator lead — ref 32, utm 100", () => {
    const long = "A".repeat(200);
    const got = parseAttributionFromSearch(`?ref=${long}&utm_source=${long}`);
    expect(got.ref).toHaveLength(32);
    expect(got.utmSource).toHaveLength(100);
  });

  it("query không liên quan → rỗng (không tạo cookie thừa)", () => {
    expect(parseAttributionFromSearch("?page=2&q=robot")).toEqual({});
  });
});

describe("[ATT-01] hằng cửa sổ: 90 ngày (trước 09/10/2026 là 30)", () => {
  it("ATTRIBUTION_MAX_AGE_DAYS = 90", () => {
    expect(ATTRIBUTION_MAX_AGE_DAYS).toBe(90);
  });
});

describe("mergeAttribution — `ref` là FIRST-TOUCH trong 90 ngày; utm/click-id vẫn last-touch", () => {
  it("[ATT-02] ref B đến sau ref A trong 90 ngày ⇒ VẪN A (và mốc claim giữ nguyên, không bị gia hạn)", () => {
    const stored = { ref: "A", refAt: T0 };
    expect(mergeAttribution(stored, { ref: "B" }, T0 + 10 * NGAY)).toEqual({ ref: "A", refAt: T0 });
    // Ghé lại bằng CHÍNH ref A cũng không gia hạn: cửa sổ tính từ lần claim ĐẦU.
    expect(mergeAttribution(stored, { ref: "A" }, T0 + 80 * NGAY)).toEqual({ ref: "A", refAt: T0 });
  });

  it("[ATT-03] sau 90 ngày ⇒ ref mới được nhận và mốc claim = bây giờ; BIÊN: 90 ngày − 1ms còn A, đúng 90 ngày thì hết", () => {
    const stored = { ref: "A", refAt: T0 };
    expect(mergeAttribution(stored, { ref: "B" }, T0 + 90 * NGAY - 1)).toEqual({ ref: "A", refAt: T0 });
    expect(mergeAttribution(stored, { ref: "B" }, T0 + 90 * NGAY)).toEqual({ ref: "B", refAt: T0 + 90 * NGAY });
    expect(mergeAttribution(stored, { ref: "B" }, T0 + 200 * NGAY)).toEqual({ ref: "B", refAt: T0 + 200 * NGAY });
  });

  it("[ATT-04] ref đã HẾT HẠN mà không có ref mới ⇒ bị bỏ (không gửi lên server một ref quá 90 ngày); khoá khác giữ nguyên", () => {
    const stored = { ref: "A", refAt: T0, utmSource: "fb" };
    expect(mergeAttribution(stored, {}, T0 + 91 * NGAY)).toEqual({ utmSource: "fb" });
  });

  it("[ATT-05] chưa có ref ⇒ nhận ref đầu tiên và đóng dấu mốc; không ref nào ⇒ không đẻ refAt", () => {
    expect(mergeAttribution({}, { ref: "A" }, T0)).toEqual({ ref: "A", refAt: T0 });
    expect(mergeAttribution({}, {}, T0)).toEqual({});
    expect(mergeAttribution({ utmSource: "fb" }, { utmMedium: "cpc" }, T0)).toEqual({ utmSource: "fb", utmMedium: "cpc" });
  });

  it("[ATT-06] cookie CŨ (đời 30 ngày: có ref, KHÔNG có refAt) ⇒ coi là còn hạn và đóng dấu bây giờ; ref mới không đè", () => {
    expect(mergeAttribution({ ref: "A" }, { ref: "B" }, T0)).toEqual({ ref: "A", refAt: T0 });
    expect(mergeAttribution({ ref: "A" }, {}, T0)).toEqual({ ref: "A", refAt: T0 });
  });

  it("[ATT-07] refAt hỏng: NaN / tương lai (đồng hồ khách chỉnh) ⇒ coi như HẾT HẠN, ref mới được nhận — không để ref cũ khoá vĩnh viễn", () => {
    expect(mergeAttribution({ ref: "A", refAt: Number.NaN }, { ref: "B" }, T0)).toEqual({ ref: "B", refAt: T0 });
    expect(mergeAttribution({ ref: "A", refAt: T0 + 365 * NGAY }, { ref: "B" }, T0)).toEqual({ ref: "B", refAt: T0 });
    expect(mergeAttribution({ ref: "A", refAt: T0 + 365 * NGAY }, {}, T0)).toEqual({});
  });

  it("[ATT-08] utm / click-id vẫn LAST-TOUCH (đó là 'đường vào chuyển đổi', không phải nguồn gốc — đảo là hỏng đo quảng cáo)", () => {
    const stored = { ref: "A", refAt: T0, utmSource: "fb", fbclid: "old" };
    expect(mergeAttribution(stored, { ref: "B", utmSource: "google", fbclid: "new" }, T0 + NGAY)).toEqual({
      ref: "A",
      refAt: T0,
      utmSource: "google",
      fbclid: "new",
    });
  });
});

describe("[ATT-09] refAt đi qua cookie, nhưng KHÔNG lọt vào payload gửi lên /api/leads", () => {
  it("bản 'đã lưu' khứ hồi giữ refAt; bản công khai (deserializeAttribution) BỎ refAt", () => {
    const raw = serializeAttribution({ ref: "A", refAt: T0, utmSource: "fb" });
    expect(deserializeAttributionDaLuu(raw)).toEqual({ ref: "A", refAt: T0, utmSource: "fb" });
    expect(deserializeAttribution(raw)).toEqual({ ref: "A", utmSource: "fb" });
  });

  it("refAt không phải số hữu hạn dương (chuỗi, âm, Infinity) ⇒ bỏ như cookie cũ — không ném", () => {
    for (const refAt of ["abc", -5, null, {}]) {
      const raw = encodeURIComponent(JSON.stringify({ ref: "A", refAt }));
      expect(deserializeAttributionDaLuu(raw)).toEqual({ ref: "A" });
    }
  });

  it("lamHieuLucAttribution: ref hết hạn bị bỏ, refAt bị bỏ — đây là thứ readAttribution() trả cho form", () => {
    expect(lamHieuLucAttribution({ ref: "A", refAt: T0, utmSource: "fb" }, T0 + NGAY)).toEqual({ ref: "A", utmSource: "fb" });
    expect(lamHieuLucAttribution({ ref: "A", refAt: T0, utmSource: "fb" }, T0 + 91 * NGAY)).toEqual({ utmSource: "fb" });
    expect(lamHieuLucAttribution({ ref: "A" }, T0)).toEqual({ ref: "A" });
  });
});

describe("cookie serialize/deserialize — luôn fail-safe", () => {
  it("khứ hồi giữ nguyên dữ liệu", () => {
    const a = { ref: "ANNGUYEN", utmCampaign: "hè 2026" };
    expect(deserializeAttribution(serializeAttribution(a))).toEqual(a);
  });

  it("cookie hỏng/không phải JSON/null → {} thay vì ném lỗi giữa lúc submit form", () => {
    expect(deserializeAttribution("khong-phai-json")).toEqual({});
    expect(deserializeAttribution(null)).toEqual({});
    expect(deserializeAttribution(encodeURIComponent('"chuỗi"'))).toEqual({});
  });

  it("bỏ khoá lạ và giá trị không phải chuỗi (cookie do người dùng sửa tay)", () => {
    const raw = encodeURIComponent(JSON.stringify({ ref: "OK", evil: "x", utmSource: 42 }));
    expect(deserializeAttribution(raw)).toEqual({ ref: "OK" });
  });
});

describe("captureAttribution — đầu-cuối trên cookie jsdom (đồng hồ giả, ngày tuyệt đối)", () => {
  const xoaCookie = () => {
    document.cookie = `${ATTRIBUTION_COOKIE}=; path=/; max-age=0`;
  };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T0));
    xoaCookie();
  });
  afterEach(() => {
    xoaCookie();
    vi.useRealTimers();
  });

  it("[ATT-10] ?ref=A rồi ?ref=B (cùng trình duyệt, 10 ngày sau) ⇒ readAttribution() trả A; 95 ngày sau ?ref=B ⇒ B", () => {
    captureAttribution("?ref=A&utm_source=fb");
    expect(readAttribution()).toEqual({ ref: "A", utmSource: "fb" });

    vi.setSystemTime(new Date(T0 + 10 * NGAY));
    captureAttribution("?ref=B&utm_source=google");
    expect(readAttribution()).toEqual({ ref: "A", utmSource: "google" }); // ref giữ A; utm last-touch

    // 95 ngày kể từ lần claim ĐẦU, nhưng cookie vừa được ghi lại ở +10 ngày (hạn jar tới +100): nên đây là hạn của refAt, không phải của jar.
    vi.setSystemTime(new Date(T0 + 95 * NGAY));
    captureAttribution("?ref=B");
    expect(readAttribution().ref).toBe("B");
  });

  /** Chạy `fn` và trả về MỌI chuỗi được gán vào `document.cookie` trong lúc đó. */
  function cookieDaGhi(fn: () => void): string[] {
    const ghi: string[] = [];
    const goc = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")!;
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => goc.get!.call(document),
      set: (v: string) => {
        ghi.push(v);
        goc.set!.call(document, v);
      },
    });
    try {
      fn();
    } finally {
      delete (document as unknown as { cookie?: string }).cookie;
    }
    return ghi;
  }

  it("[ATT-11] cookie ghi ra có max-age 90 ngày (7.776.000 giây)", () => {
    const ghi = cookieDaGhi(() => captureAttribution("?ref=A"));
    expect(ghi.some((c) => c.includes("max-age=7776000"))).toBe(true);
  });

  it("[ATT-14] đổi trang KHÔNG có tham số mới ⇒ không ghi lại cookie (kẻo làm mới max-age mỗi lần tải trang); cookie đời 30 ngày thì ghi lại ĐÚNG MỘT lần để đóng dấu refAt", () => {
    captureAttribution("?ref=A&utm_source=fb");
    expect(cookieDaGhi(() => captureAttribution(""))).toEqual([]);
    expect(cookieDaGhi(() => captureAttribution("?page=2"))).toEqual([]);

    // Cookie đời cũ: có ref, không refAt.
    document.cookie = `${ATTRIBUTION_COOKIE}=${serializeAttribution({ ref: "OLD" })}; path=/`;
    expect(cookieDaGhi(() => captureAttribution("")).length).toBe(1);
    expect(cookieDaGhi(() => captureAttribution(""))).toEqual([]);
    expect(readAttribution().ref).toBe("OLD");
  });

  it("[ATT-12] cookie HỎNG (không phải JSON) ⇒ không ném, coi như chưa có gì và nhận ref mới", () => {
    document.cookie = `${ATTRIBUTION_COOKIE}=khong-phai-json; path=/`;
    expect(() => captureAttribution("?ref=A")).not.toThrow();
    expect(readAttribution().ref).toBe("A");
  });

  it("[ATT-13] readAttribution() cũng lọc ref QUÁ HẠN dù chưa có lượt capture nào sau đó (form submit trong tab mở lâu)", () => {
    captureAttribution("?ref=A");
    // Ghi lại cookie ở +80 ngày (chỉ utm) ⇒ hạn của jar dời tới +170; ref vẫn mang mốc claim T0.
    vi.setSystemTime(new Date(T0 + 80 * NGAY));
    captureAttribution("?utm_source=x");
    vi.setSystemTime(new Date(T0 + 95 * NGAY));
    expect(readAttribution().ref).toBeUndefined();
    expect(readAttribution().utmSource).toBe("x");
  });
});

describe("readCookie", () => {
  it("lấy đúng cookie giữa nhiều cookie khác", () => {
    const c = "_fbp=fb.1.2; sr_attr=abc%3D; other=1";
    expect(readCookie(c, "sr_attr")).toBe("abc%3D");
    expect(readCookie(c, "khong-co")).toBeNull();
  });
});
