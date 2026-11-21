// @vitest-environment node
/**
 * GỌI NGƯỢC sang ZaloCRM. Chưa dùng thật (GĐ3) — nhưng đúng vì thế mà phải test
 * ngay: một client mạng không có hạn giờ chỉ lộ ra khi tunnel đứt trên prod.
 *
 * Hai tính chất đáng canh:
 *  · **KHÔNG BAO GIỜ NÉM** — chỗ gọi là cron/đồng bộ; một lượt hỏng không được giết
 *    cả job và bỏ lại 99 lượt còn lại;
 *  · **LUÔN CÓ HẠN GIỜ** — `fetch` của Node không có timeout mặc định, và mỗi request
 *    treo giữ một function invocation của Vercel cho tới khi hạ tầng cắt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { docKhoaApi, goiZalocrm, guiTinZalocrm, ZALOCRM_TIMEOUT_MS } from "./client";

const ENV_KEYS = process.env.ZALOCRM_API_KEYS;
const ENV_BASE = process.env.ZALOCRM_BASE_URL;

beforeEach(() => {
  process.env.ZALOCRM_API_KEYS = JSON.stringify({ cs1: "key-cs1" });
  process.env.ZALOCRM_BASE_URL = "https://zalo-api.satarobo.vn";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (ENV_KEYS === undefined) delete process.env.ZALOCRM_API_KEYS;
  else process.env.ZALOCRM_API_KEYS = ENV_KEYS;
  if (ENV_BASE === undefined) delete process.env.ZALOCRM_BASE_URL;
  else process.env.ZALOCRM_BASE_URL = ENV_BASE;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("docKhoaApi", () => {
  it("đọc khoá theo org", () => {
    expect(docKhoaApi("cs1")).toBe("key-cs1");
    expect(docKhoaApi("cs2")).toBeNull();
  });

  it("env vắng / JSON hỏng ⇒ null, và KHÔNG log giá trị", () => {
    delete process.env.ZALOCRM_API_KEYS;
    expect(docKhoaApi("cs1")).toBeNull();
    process.env.ZALOCRM_API_KEYS = "{hong";
    expect(docKhoaApi("cs1")).toBeNull();
    const daLog = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .flat()
      .map(String)
      .join(" ");
    // Một khoá là TOÀN QUYỀN trên một org (`public_api_key` không scope theo tài
    // nguyên) — nó không bao giờ được vào log (luật cứng #9).
    expect(daLog).not.toContain("key-cs1");
  });
});

describe("goiZalocrm", () => {
  it("thiếu cấu hình ⇒ CHUA_CAU_HINH, KHÔNG gọi mạng", async () => {
    const fetchGia = vi.fn();
    vi.stubGlobal("fetch", fetchGia);
    delete process.env.ZALOCRM_BASE_URL;

    const kq = await goiZalocrm({ orgCode: "cs1", duongDan: "/api/public/conversations" });
    expect(kq).toMatchObject({ ok: false, ma: "CHUA_CAU_HINH" });
    expect(fetchGia).not.toHaveBeenCalled();
  });

  it("gửi khoá qua header `x-api-key`, không nhét vào URL", async () => {
    // Query string đi vào access log của Cloudflare Tunnel, của fork, và của mọi proxy
    // ở giữa. Header thì không.
    const fetchGia = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchGia);

    const kq = await goiZalocrm({ orgCode: "cs1", duongDan: "/api/public/conversations?limit=10" });
    expect(kq).toMatchObject({ ok: true });
    const [url, init] = (fetchGia.mock.calls[0] as unknown as [string, RequestInit]);
    expect(url).toBe("https://zalo-api.satarobo.vn/api/public/conversations?limit=10");
    expect(url).not.toContain("key-cs1");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("key-cs1");
    expect(init.cache).toBe("no-store");
  });

  it("mã lỗi HTTP ⇒ LOI_HTTP kèm status, thông điệp KHÔNG mang thân phản hồi", async () => {
    // Thân lỗi của bên kia có thể kèm dữ liệu khách; nó sẽ chảy thẳng vào
    // `IntegrationLog.errorMessage`, nơi mọi cơ sở đọc được.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ phone: "0912345678" }), { status: 422 })),
    );
    const kq = await goiZalocrm({ orgCode: "cs1", duongDan: "/x" });
    expect(kq).toMatchObject({ ok: false, ma: "LOI_HTTP", httpStatus: 422 });
    if (kq.ok) throw new Error("phải hỏng");
    expect(kq.thongDiep).not.toContain("0912345678");
  });

  it("2xx nhưng thân không phải JSON ⇒ THAN_KHONG_DOC_DUOC, không ném", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>502</html>", { status: 200 })));
    await expect(goiZalocrm({ orgCode: "cs1", duongDan: "/x" })).resolves.toMatchObject({
      ok: false,
      ma: "THAN_KHONG_DOC_DUOC",
    });
  });

  it("quá hạn giờ ⇒ HET_GIO (AbortController thật sự được nối vào fetch)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_u: string, init: RequestInit) =>
          new Promise((_res, rej) => {
            init.signal?.addEventListener("abort", () => {
              const e = new Error("aborted");
              e.name = "AbortError";
              rej(e);
            });
          }),
      ),
    );
    const kq = await goiZalocrm({ orgCode: "cs1", duongDan: "/x", timeoutMs: 10 });
    expect(kq).toMatchObject({ ok: false, ma: "HET_GIO" });
  });

  it("hạn giờ mặc định 10 giây — đủ rộng cho tunnel chậm, đủ hẹp để không giữ invocation", () => {
    expect(ZALOCRM_TIMEOUT_MS).toBe(10_000);
  });

  it("mạng đứt ⇒ KHONG_KET_NOI, không ném", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(goiZalocrm({ orgCode: "cs1", duongDan: "/x" })).resolves.toMatchObject({
      ok: false,
      ma: "KHONG_KET_NOI",
    });
  });

  it("`guiTinZalocrm` POST đúng đường dẫn và gửi thân JSON", async () => {
    const fetchGia = vi.fn(
      async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchGia);
    await guiTinZalocrm("cs1", {
      zaloAccountId: "acc-1",
      threadId: "t-1",
      content: "chào chị",
    });
    const [url, init] = (fetchGia.mock.calls[0] as unknown as [string, RequestInit]);
    expect(url).toContain("/api/public/messages/send");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({ threadId: "t-1" });
  });
});
