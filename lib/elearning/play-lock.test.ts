import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// [PL-*] Khoá phát nói THẬT về việc có khoá dùng chung hay không (26/10/2026).
// Trước: `backend` lấy từ `getRateLimitBackend()` — chỉ nhìn biến môi trường — nên báo "upstash" cả khi
// host Upstash đã chết (NXDOMAIN), và chỉ số "số lượt rơi vào fail-open" mà thiết kế muốn có luôn ra 0.

const KHOA_TRANG_THAI = Symbol.for("satarobo.rate-limit.trang-thai-upstash");
const fetchMock = vi.fn();

function loiDns(): Error {
  const e = new TypeError("fetch failed");
  (e as { cause?: unknown }).cause = Object.assign(new Error("getaddrinfo ENOTFOUND host.example.invalid"), { code: "ENOTFOUND" });
  return e;
}
const okLenh = (result: unknown) => new Response(JSON.stringify({ result }), { status: 200 });

async function nap(cauHinh: boolean) {
  vi.resetModules();
  delete (globalThis as Record<symbol, unknown>)[KHOA_TRANG_THAI];
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  if (cauHinh) {
    process.env.UPSTASH_REDIS_REST_URL = "https://host.example.invalid";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token-gia";
  } else {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  }
  const lock = await import("./play-lock");
  const hop = await import("./video-heartbeat-contract");
  return { ...lock, quyetDinhKhoaPhat: hop.quyetDinhKhoaPhat };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

describe("[PL-01..04] backend của khoá phát", () => {
  it("[PL-01] chưa cấu hình ⇒ 'memory', không gọi mạng", async () => {
    const m = await nap(false);
    expect(await m.gianhKhoaPhat({ userId: "u1", sessionId: "s1" })).toEqual({ backend: "memory", khoaThuocNguoiKhac: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("[PL-02] cấu hình nhưng host chết ⇒ 'upstash-loi' (KHÔNG phải 'upstash'), vẫn cho học", async () => {
    const m = await nap(true);
    fetchMock.mockRejectedValue(loiDns());
    const kq = await m.gianhKhoaPhat({ userId: "u1", sessionId: "s1" });
    expect(kq).toEqual({ backend: "upstash-loi", khoaThuocNguoiKhac: false });
    // Quyết định của chủ dự án 24/08: Redis chết thì VẪN CHO HỌC — và `backend` còn để đường gọi đếm.
    expect(m.quyetDinhKhoaPhat(kq)).toEqual({ cho: true, backend: "upstash-loi" });
  });

  it("[PL-03] Upstash sống, giành được khoá ⇒ 'upstash'", async () => {
    const m = await nap(true);
    fetchMock.mockResolvedValueOnce(okLenh("OK"));
    expect(await m.gianhKhoaPhat({ userId: "u1", sessionId: "s1" })).toEqual({ backend: "upstash", khoaThuocNguoiKhac: false });
  });

  it("[PL-04] khoá do phiên KHÁC giữ ⇒ báo tranh chấp (cơ chế chống xem song song còn nguyên khi Redis sống)", async () => {
    const m = await nap(true);
    fetchMock.mockResolvedValueOnce(okLenh(null)).mockResolvedValueOnce(okLenh("phien-khac"));
    const kq = await m.gianhKhoaPhat({ userId: "u1", sessionId: "s1" });
    expect(kq).toEqual({ backend: "upstash", khoaThuocNguoiKhac: true });
    expect(m.quyetDinhKhoaPhat(kq)).toEqual({ cho: false, ma: "SESSION_SUPERSEDED" });
  });
});
