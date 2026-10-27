import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Gia cố rate-limit khi Upstash chết (26/10/2026). Mã ca [RL-*].
//
// Nguyên tắc xuyên suốt của PR: mọi lỗi Upstash vẫn rơi về BỘ NHỚ, không limiter nào thành fail-closed;
// PR chỉ bớt cái giá của việc rơi về đó (hạn chờ, ngắt mạch, log gộp) và nói thật trạng thái.
// Test dùng ngày TUYỆT ĐỐI + đồng hồ đóng băng (luật 19) — không đọc `new Date()` thật.

const KHOA_TRANG_THAI = Symbol.for("satarobo.rate-limit.trang-thai-upstash");
const HOST = "bi-mat-host.example.invalid";
const URL_GIA = `https://${HOST}`;
const TOKEN_GIA = "TOKEN_BI_MAT_KHONG_DUOC_LOT_RA_LOG";
const T0 = new Date("2026-10-26T00:00:00.000Z");

type Mod = typeof import("./rate-limit");

const fetchMock = vi.fn();
type Spy = { mock: { calls: unknown[][] } };
let console_: Spy[] = [];

function duLieuConsole(): string {
  return console_
    .flatMap((s) => s.mock.calls)
    .map((c) => c.map((x) => String(x)).join(" "))
    .join("\n");
}

function dongConsole(muc: "error" | "warn"): string[] {
  const s = console_[muc === "error" ? 0 : 1];
  return s.mock.calls.map((c) => c.map((x) => String(x)).join(" "));
}

async function nap(opts: { cauHinh: boolean } = { cauHinh: true }): Promise<Mod> {
  vi.resetModules();
  delete (globalThis as Record<symbol, unknown>)[KHOA_TRANG_THAI];
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  if (opts.cauHinh) {
    process.env.UPSTASH_REDIS_REST_URL = URL_GIA;
    process.env.UPSTASH_REDIS_REST_TOKEN = TOKEN_GIA;
  } else {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  }
  return await import("./rate-limit");
}

function loiDns(): Error {
  // Hình dạng thật của lỗi `fetch` Node khi host không phân giải — và nó MANG host trong thông điệp.
  const e = new TypeError("fetch failed");
  (e as { cause?: unknown }).cause = Object.assign(new Error(`getaddrinfo ENOTFOUND ${HOST}`), { code: "ENOTFOUND" });
  return e;
}

const okPipeline = (count: number) => new Response(JSON.stringify([{ result: count }, { result: 1 }]), { status: 200 });
const okLenh = (result: unknown) => new Response(JSON.stringify({ result }), { status: 200 });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  console_ = [
    vi.spyOn(console, "error").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
    vi.spyOn(console, "info").mockImplementation(() => {}),
    vi.spyOn(console, "log").mockImplementation(() => {}),
  ];
  delete process.env.RATE_LIMIT_UPSTASH_TIMEOUT_MS;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.RATE_LIMIT_UPSTASH_TIMEOUT_MS;
});

describe("[RL-01..03] hành vi giới hạn không đổi", () => {
  it("[RL-01] chưa cấu hình ⇒ bộ nhớ, đếm đúng trần", async () => {
    const m = await nap({ cauHinh: false });
    const a = { key: "rl01", max: 2, windowMs: 60_000 };
    expect((await m.rateLimit(a)).success).toBe(true);
    expect((await m.rateLimit(a)).success).toBe(true);
    expect((await m.rateLimit(a)).success).toBe(false);
    expect(m.getRateLimitStatus()).toBe("memory");
    expect(m.getRateLimitBackend()).toBe("memory");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("[RL-02] Upstash sống ⇒ đếm theo Redis, vượt trần thì chặn", async () => {
    const m = await nap();
    fetchMock.mockResolvedValueOnce(okPipeline(1)).mockResolvedValueOnce(okPipeline(6));
    const a = { key: "rl02", max: 5, windowMs: 60_000 };
    const r1 = await m.rateLimit(a);
    expect(r1).toMatchObject({ success: true, remaining: 4 });
    const r2 = await m.rateLimit(a);
    expect(r2).toMatchObject({ success: false, remaining: 0 });
    expect(m.getRateLimitStatus()).toBe("upstash");
  });

  it("[RL-03] Upstash luôn lỗi ⇒ vẫn CHO qua rồi chặn đúng trần bằng bộ nhớ (không fail-closed, không fail-open vô hạn)", async () => {
    const m = await nap();
    fetchMock.mockRejectedValue(loiDns());
    const a = { key: "rl03", max: 2, windowMs: 60_000 };
    expect((await m.rateLimit(a)).success).toBe(true);
    expect((await m.rateLimit(a)).success).toBe(true);
    expect((await m.rateLimit(a)).success).toBe(false); // ngắt mạch đã mở ở lượt này; trần vẫn do bộ nhớ giữ
    expect((await m.rateLimit({ key: "rl03-khac", max: 1, windowMs: 60_000 })).success).toBe(true);
  });
});

describe("[RL-04] hạn chờ", () => {
  it("[RL-04] mỗi lượt gọi Upstash mang AbortSignal; host treo ⇒ rơi về bộ nhớ trong thời gian hữu hạn", async () => {
    vi.useRealTimers(); // AbortSignal.timeout dùng timer THẬT; ca này cần đồng hồ thật
    process.env.RATE_LIMIT_UPSTASH_TIMEOUT_MS = "200";
    const m = await nap();
    fetchMock.mockImplementation(
      (_u: string, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          const sig = init?.signal as AbortSignal;
          if (sig.aborted) rej(sig.reason);
          else sig.addEventListener("abort", () => rej(sig.reason));
        }),
    );
    const t0 = performance.now();
    const r = await m.rateLimit({ key: "rl04", max: 3, windowMs: 60_000 });
    const ms = performance.now() - t0;
    expect(r.success).toBe(true);
    expect(ms).toBeLessThan(1400);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
    expect(m.getRateLimitHealth().loiCuoiLyDo).toBe("timeout");
    expect(m.getRateLimitStatus()).toBe("upstash-loi");
  }, 5000);

  it("[RL-04b] upstashCommand cũng có hạn chờ (cùng đường fetch)", async () => {
    const m = await nap();
    fetchMock.mockResolvedValue(okLenh("OK"));
    await m.upstashCommand(["PING"]);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});

describe("[RL-05..06] ngắt mạch", () => {
  it("[RL-05] sau UPSTASH_NGUONG_LOI lỗi liên tiếp, các lượt sau KHÔNG gọi Upstash nữa", async () => {
    const m = await nap();
    fetchMock.mockRejectedValue(loiDns());
    for (let i = 0; i < 10; i++) {
      const r = await m.rateLimit({ key: `rl05:${i}`, max: 5, windowMs: 60_000 });
      expect(r.success).toBe(true);
    }
    expect(fetchMock).toHaveBeenCalledTimes(m.UPSTASH_NGUONG_LOI);
    const h = m.getRateLimitHealth();
    expect(h.ngatMachMo).toBe(true);
    expect(h.tongBoQua).toBe(10 - m.UPSTASH_NGUONG_LOI);
  });

  it("[RL-06] hết hạn ngắt mạch ⇒ đúng MỘT lượt thăm dò, các lượt đồng thời khác vẫn bỏ qua; thành công ⇒ đóng mạch", async () => {
    const m = await nap();
    fetchMock.mockRejectedValue(loiDns());
    for (let i = 0; i < 4; i++) await m.rateLimit({ key: `rl06:${i}`, max: 5, windowMs: 60_000 });
    expect(fetchMock).toHaveBeenCalledTimes(m.UPSTASH_NGUONG_LOI);

    vi.setSystemTime(new Date(T0.getTime() + m.UPSTASH_NGAT_MACH_MS + 1));
    fetchMock.mockReset();
    let tra!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((res) => (tra = res)));
    const ps = [0, 1, 2].map((i) => m.rateLimit({ key: `rl06b:${i}`, max: 5, windowMs: 60_000 }));
    expect(fetchMock).toHaveBeenCalledTimes(1); // MỘT lượt thăm dò, hai lượt kia đi bộ nhớ
    tra(okPipeline(1));
    const kq = await Promise.all(ps);
    expect(kq.every((r) => r.success)).toBe(true);
    expect(m.getRateLimitStatus()).toBe("upstash");
    expect(m.getRateLimitHealth().ngatMachMo).toBe(false);

    fetchMock.mockResolvedValue(okPipeline(1));
    await m.rateLimit({ key: "rl06c", max: 5, windowMs: 60_000 });
    expect(fetchMock).toHaveBeenCalledTimes(2); // mạch đã đóng ⇒ lại gọi Upstash bình thường
  });

  it("[RL-06b] lượt thăm dò lỗi ⇒ mở lại ngay, không để lọt cả loạt", async () => {
    const m = await nap();
    fetchMock.mockRejectedValue(loiDns());
    for (let i = 0; i < 3; i++) await m.rateLimit({ key: `rl06b:${i}`, max: 5, windowMs: 60_000 });
    vi.setSystemTime(new Date(T0.getTime() + m.UPSTASH_NGAT_MACH_MS + 1));
    fetchMock.mockClear();
    await m.rateLimit({ key: "rl06b:probe", max: 5, windowMs: 60_000 }); // thăm dò, lỗi
    await m.rateLimit({ key: "rl06b:sau-1", max: 5, windowMs: 60_000 });
    await m.rateLimit({ key: "rl06b:sau-2", max: 5, windowMs: 60_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("[RL-06c] upstashCommand tôn trọng ngắt mạch: mở ⇒ trả null mà không gọi mạng", async () => {
    const m = await nap();
    fetchMock.mockRejectedValue(loiDns());
    for (let i = 0; i < 3; i++) await m.upstashCommand(["GET", `k${i}`]);
    fetchMock.mockClear();
    expect(await m.upstashCommand(["GET", "k"])).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("[RL-07..08] log", () => {
  it("[RL-07] gom log: lỗi đầu in ngay, lỗi tiếp trong 60 s im lặng, lúc mạch mở in ngay kèm số lượt gộp", async () => {
    const m = await nap();
    fetchMock.mockRejectedValue(loiDns());
    await m.rateLimit({ key: "rl07:1", max: 5, windowMs: 60_000 });
    await m.rateLimit({ key: "rl07:2", max: 5, windowMs: 60_000 });
    expect(dongConsole("error")).toHaveLength(1);

    vi.setSystemTime(new Date(T0.getTime() + 5_000)); // vẫn trong 60 s kể từ dòng log đầu
    await m.rateLimit({ key: "rl07:3", max: 5, windowMs: 60_000 }); // lỗi thứ 3 ⇒ mạch vừa mở
    const dong = dongConsole("error");
    expect(dong).toHaveLength(2);
    expect(dong[1]).toContain("2 errors since last log");
    expect(dong[1]).toContain("circuit open");

    // Mạch mở ⇒ các lượt sau không gọi, không log.
    for (let i = 0; i < 20; i++) await m.rateLimit({ key: `rl07:x${i}`, max: 5, windowMs: 60_000 });
    expect(dongConsole("error")).toHaveLength(2);
  });

  it("[RL-07b] thăm dò thất bại sau khi mạch mở ⇒ tối đa 1 dòng mỗi phút", async () => {
    const m = await nap();
    fetchMock.mockRejectedValue(loiDns());
    for (let i = 0; i < 3; i++) await m.rateLimit({ key: `rl07b:${i}`, max: 5, windowMs: 60_000 });
    const truoc = dongConsole("error").length;
    vi.setSystemTime(new Date(T0.getTime() + m.UPSTASH_NGAT_MACH_MS + 1));
    await m.rateLimit({ key: "rl07b:probe", max: 5, windowMs: 60_000 });
    expect(dongConsole("error").length).toBe(truoc + 1);
  });

  it("[RL-08] log CHỈ có nhãn đã phân loại: không khoá đếm, không host, không token, không thông điệp lỗi thô", async () => {
    const m = await nap();
    const key = "login:id:nguoi.dung@example.com";
    fetchMock.mockRejectedValueOnce(loiDns());
    await m.rateLimit({ key, max: 5, windowMs: 60_000 });
    fetchMock.mockRejectedValueOnce(new Error(`boom ${key} ${TOKEN_GIA} ${HOST}`));
    await m.rateLimit({ key, max: 5, windowMs: 60_000 });
    fetchMock.mockResolvedValueOnce(new Response(`${TOKEN_GIA} ${key}`, { status: 500 }));
    await m.upstashCommand(["SET", "play-lock:USERID123", "sess"]);
    // Lượt cuối thành công để in dòng "recovered" (cũng phải sạch).
    fetchMock.mockResolvedValueOnce(okLenh("OK"));
    await m.upstashCommand(["SET", "play-lock:USERID123", "sess"]);

    const text = duLieuConsole();
    expect(text).toContain("[rate-limit] Upstash error, falling back to memory: ENOTFOUND");
    for (const cam of [key, "nguoi.dung@example.com", HOST, TOKEN_GIA, "USERID123", "boom"]) {
      expect(text).not.toContain(cam);
    }
    expect(m.getRateLimitHealth().loiCuoiLyDo).toMatch(/^(ENOTFOUND|loi-khac|HTTP \d{3})$/);
  });

  it("[RL-08b] phục hồi in đúng MỘT dòng và đóng mạch", async () => {
    const m = await nap();
    fetchMock.mockRejectedValueOnce(loiDns());
    await m.rateLimit({ key: "rl08b:1", max: 5, windowMs: 60_000 });
    fetchMock.mockResolvedValueOnce(okPipeline(1));
    await m.rateLimit({ key: "rl08b:2", max: 5, windowMs: 60_000 });
    expect(dongConsole("warn")).toEqual(["[rate-limit] Upstash recovered after 1 consecutive errors"]);
    expect(m.getRateLimitStatus()).toBe("upstash");
  });
});

describe("[RL-09] dọn khoá hết hạn của bộ đếm bộ nhớ", () => {
  it("[RL-09] khoá hết hạn bị dọn dần; khoá còn hạn giữ nguyên bộ đếm", async () => {
    const m = await nap({ cauHinh: false });
    for (let i = 0; i < 200; i++) await m.rateLimit({ key: `het-han:${i}`, max: 5, windowMs: 1_000 });
    for (let i = 0; i < 3; i++) await m.rateLimit({ key: `song:${i}`, max: 1, windowMs: 3_600_000 });
    expect(m.demKhoaBoNho()).toBe(203);

    vi.setSystemTime(new Date(T0.getTime() + 2_000)); // 200 khoá đầu đã hết hạn, 3 khoá `song` còn
    for (let i = 0; i < 20; i++) await m.rateLimit({ key: `moi:${i}`, max: 5, windowMs: 3_600_000 });
    expect(m.demKhoaBoNho()).toBe(3 + 20);

    // Khoá còn hạn KHÔNG bị dọn nhầm: lượt thứ hai (max 1) vẫn bị chặn.
    expect((await m.rateLimit({ key: "song:0", max: 1, windowMs: 3_600_000 })).success).toBe(false);
  });

  it("[RL-09b] mỗi lượt chỉ rà một số mục bị chặn trên — không quét một phát cả bộ đếm", async () => {
    const m = await nap({ cauHinh: false });
    for (let i = 0; i < 400; i++) await m.rateLimit({ key: `het-han:${i}`, max: 5, windowMs: 1_000 });
    vi.setSystemTime(new Date(T0.getTime() + 2_000));
    await m.rateLimit({ key: "mot-luot", max: 5, windowMs: 3_600_000 });
    // Một lượt rà tối đa 50 mục ⇒ còn ≥ 350 khoá hết hạn chưa dọn (không phải 0).
    expect(m.demKhoaBoNho()).toBeGreaterThanOrEqual(400 - 50);
  });
});

describe("[RL-10..13] trạng thái trung thực", () => {
  it("[RL-10] getRateLimitBackend chỉ nhìn cấu hình (vẫn 'upstash' khi host chết); getRateLimitStatus nói thật", async () => {
    const m = await nap();
    fetchMock.mockRejectedValue(loiDns());
    await m.rateLimit({ key: "rl10", max: 5, windowMs: 60_000 });
    expect(m.getRateLimitBackend()).toBe("upstash");
    expect(m.getRateLimitStatus()).toBe("upstash-loi");
    const h = m.getRateLimitHealth();
    expect(h).toMatchObject({ trangThai: "upstash-loi", loiLienTiep: 1, loiCuoiLyDo: "ENOTFOUND", tongLoi: 1 });
  });

  it("[RL-11] kiemTraUpstash: PONG ⇒ upstash; DNS chết ⇒ upstash-loi kèm nhãn; chưa cấu hình ⇒ memory", async () => {
    const m = await nap();
    fetchMock.mockResolvedValueOnce(okLenh("PONG"));
    expect(await m.kiemTraUpstash()).toMatchObject({ trangThai: "upstash" });
    fetchMock.mockRejectedValueOnce(loiDns());
    expect(await m.kiemTraUpstash()).toMatchObject({ trangThai: "upstash-loi", lyDo: "ENOTFOUND" });
    fetchMock.mockResolvedValueOnce(okLenh("khong-phai-pong"));
    expect(await m.kiemTraUpstash()).toMatchObject({ trangThai: "upstash-loi", lyDo: "phan-hoi-la" });
    const k = await nap({ cauHinh: false });
    expect(await k.kiemTraUpstash()).toEqual({ trangThai: "memory" });
  });

  it("[RL-11b] kiemTraUpstash BỎ QUA ngắt mạch (người vận hành vừa sửa env muốn thấy ngay) và đóng mạch khi thành công", async () => {
    const m = await nap();
    fetchMock.mockRejectedValue(loiDns());
    for (let i = 0; i < 3; i++) await m.rateLimit({ key: `rl11b:${i}`, max: 5, windowMs: 60_000 });
    expect(m.getRateLimitHealth().ngatMachMo).toBe(true);
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(okLenh("PONG"));
    expect(await m.kiemTraUpstash()).toMatchObject({ trangThai: "upstash" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(m.getRateLimitHealth().ngatMachMo).toBe(false);
  });

  it("[RL-12] upstashCommand: thành công trả result; HTTP lỗi ⇒ null + nhãn HTTP; lỗi mạng ⇒ null", async () => {
    const m = await nap();
    fetchMock.mockResolvedValueOnce(okLenh("OK"));
    expect(await m.upstashCommand(["SET", "a", "b"])).toBe("OK");
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    expect(await m.upstashCommand(["GET", "a"])).toBeNull();
    expect(m.getRateLimitHealth().loiCuoiLyDo).toBe("HTTP 401");
    fetchMock.mockRejectedValueOnce(loiDns());
    expect(await m.upstashCommand(["GET", "a"])).toBeNull();
  });

  it("[RL-13] trạng thái ngắt mạch/log là CẤP TIẾN TRÌNH: hai bản module nạp riêng vẫn dùng chung", async () => {
    const a = await nap();
    vi.resetModules();
    const b = await import("./rate-limit");
    expect(b.rateLimit).not.toBe(a.rateLimit); // đúng là hai bản module riêng
    fetchMock.mockRejectedValue(loiDns());
    for (let i = 0; i < 2; i++) await a.rateLimit({ key: `rl13a:${i}`, max: 5, windowMs: 60_000 });
    await b.rateLimit({ key: "rl13b", max: 5, windowMs: 60_000 }); // lỗi thứ 3 tính CHUNG ⇒ mạch mở
    expect(a.getRateLimitHealth().ngatMachMo).toBe(true);
    expect(b.getRateLimitHealth().tongLoi).toBe(3);
    fetchMock.mockClear();
    await a.rateLimit({ key: "rl13c", max: 5, windowMs: 60_000 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("[RL-W1] dây nối màn quản trị", () => {
  it("[RL-W1] /admin/tich-hop hiển thị kết quả PING thật, không còn nhìn mỗi biến môi trường", () => {
    const src = readFileSync(resolve(process.cwd(), "app/(admin)/admin/tich-hop/page.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(src.match(/kiemTraUpstash\(/g)?.length).toBe(1);
    expect(src).not.toContain("getRateLimitBackend");
  });
});
