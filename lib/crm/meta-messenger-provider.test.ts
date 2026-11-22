// @vitest-environment node
/**
 * S-2b — ĐƯỜNG GỬI TIN THẬT RA META SEND API.
 *
 * Test này GỌI THẬT `guiTinRaMeta()` rồi SOI LỆNH ĐÃ PHÁT ĐI (url/method/header/thân),
 * không so chuỗi mã nguồn. Quy ước 21 (`docs/elearning/quy-uoc-nen.md:295`): so chuỗi
 * chứng minh CÓ VIẾT chứ không chứng minh CÓ CHẠY, và mù hoàn toàn với phép NỐI giữa
 * dữ liệu tính được và thứ thật sự nằm trong request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV_GOC = { ...process.env };

async function napProvider() {
  vi.resetModules();
  return import("./meta-messenger-provider");
}

/** Giả lập một phản hồi fetch (đủ dùng cho provider: chỉ đọc `.json()`). */
function traLoi(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  process.env.META_PAGE_ID = "PAGE-1";
  process.env.META_PAGE_ACCESS_TOKEN = "EAA-token-that";
});

afterEach(() => {
  process.env = { ...ENV_GOC };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("[S-2b] guiTinRaMeta — lệnh phát đi phải đúng hợp đồng Send API", () => {
  it("gửi POST tới graph.facebook.com/<ver>/<pageId>/messages với đúng thân tin", async () => {
    const { guiTinRaMeta, META_GRAPH_VERSION } = await napProvider();
    const fetchGia = vi.fn(async () => traLoi({ recipient_id: "PSID-9", message_id: "mid.abc" }));
    vi.stubGlobal("fetch", fetchGia);

    const kq = await guiTinRaMeta({ pageId: "PAGE-1", psid: "PSID-9", text: "Dạ em chào chị" });

    expect(fetchGia).toHaveBeenCalledTimes(1);
    const [url, init] = fetchGia.mock.calls[0] as unknown as [string, RequestInit];

    // URL: đúng host, đúng version, đúng Page, đúng edge.
    expect(url).toBe(`https://graph.facebook.com/${META_GRAPH_VERSION}/PAGE-1/messages`);
    expect(init.method).toBe("POST");

    // Token đi ở HEADER Authorization, KHÔNG nhét vào query string — query string
    // lọt vào log truy cập/Sentry breadcrumb là rò secret (luật cứng #9).
    expect(url).not.toContain("access_token");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer EAA-token-that");
    expect(headers["Content-Type"]).toBe("application/json");

    // Thân tin: đúng hình dạng Meta đòi.
    const than = JSON.parse(String(init.body)) as {
      recipient: { id: string };
      messaging_type: string;
      message: { text: string };
    };
    expect(than.recipient.id).toBe("PSID-9");
    expect(than.messaging_type).toBe("RESPONSE");
    expect(than.message.text).toBe("Dạ em chào chị");

    // Có dây thắng thời gian — nhà cung cấp treo không được treo theo.
    expect(init.signal).toBeDefined();

    expect(kq).toEqual({ ok: true, providerMessageId: "mid.abc" });
  });

  it("thiếu khoá ⇒ KHÔNG phát một lời gọi nào, trả mã META_NOT_CONFIGURED", async () => {
    delete process.env.META_PAGE_ACCESS_TOKEN;
    const { guiTinRaMeta } = await napProvider();
    const fetchGia = vi.fn(async () => traLoi({}));
    vi.stubGlobal("fetch", fetchGia);

    const kq = await guiTinRaMeta({ pageId: "PAGE-1", psid: "PSID-9", text: "x" });

    expect(fetchGia).not.toHaveBeenCalled();
    expect(kq.ok).toBe(false);
    if (kq.ok) return;
    expect(kq.ma).toBe("META_NOT_CONFIGURED");
  });

  it("Page của hội thoại KHÁC Page có token ⇒ chặn, không gửi nhầm bằng token Page khác", async () => {
    const { guiTinRaMeta } = await napProvider();
    const fetchGia = vi.fn(async () => traLoi({ message_id: "mid.x" }));
    vi.stubGlobal("fetch", fetchGia);

    const kq = await guiTinRaMeta({ pageId: "PAGE-KHAC", psid: "PSID-9", text: "x" });

    expect(fetchGia).not.toHaveBeenCalled();
    expect(kq.ok).toBe(false);
    if (kq.ok) return;
    expect(kq.ma).toBe("META_SAI_PAGE");
  });

  it("Meta từ chối vì NGOÀI CỬA SỔ 24H ⇒ mã riêng NGOAI_CUA_SO_24H + giữ mã lỗi Meta", async () => {
    const { guiTinRaMeta } = await napProvider();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        traLoi(
          {
            error: {
              message: "This message is sent outside of allowed window.",
              type: "OAuthException",
              code: 10,
              error_subcode: 2018278,
              fbtrace_id: "A1",
            },
          },
          400,
        ),
      ),
    );

    const kq = await guiTinRaMeta({ pageId: "PAGE-1", psid: "PSID-9", text: "x" });

    expect(kq.ok).toBe(false);
    if (kq.ok) return;
    expect(kq.ma).toBe("NGOAI_CUA_SO_24H");
    // Mã Meta phải giữ lại để sau còn đối soát, không nuốt mất.
    expect(kq.maLoiMeta).toBe("10/2018278");
  });

  it("lỗi Meta khác ⇒ META_TU_CHOI, vẫn giữ mã + lời của Meta", async () => {
    const { guiTinRaMeta } = await napProvider();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        traLoi({ error: { message: "Invalid OAuth access token.", code: 190 } }, 400),
      ),
    );

    const kq = await guiTinRaMeta({ pageId: "PAGE-1", psid: "PSID-9", text: "x" });

    expect(kq.ok).toBe(false);
    if (kq.ok) return;
    expect(kq.ma).toBe("META_TU_CHOI");
    expect(kq.maLoiMeta).toBe("190");
    expect(kq.loiGoc).toContain("Invalid OAuth access token");
  });

  it("fetch ném (mạng đứt / timeout) ⇒ META_KHONG_TRA_LOI, KHÔNG ném ra ngoài", async () => {
    const { guiTinRaMeta } = await napProvider();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("The operation was aborted");
      }),
    );

    const kq = await guiTinRaMeta({ pageId: "PAGE-1", psid: "PSID-9", text: "x" });

    expect(kq.ok).toBe(false);
    if (kq.ok) return;
    expect(kq.ma).toBe("META_KHONG_TRA_LOI");
  });

  it("Meta trả 200 nhưng KHÔNG có message_id ⇒ coi là thất bại, không bịa thành công", async () => {
    const { guiTinRaMeta } = await napProvider();
    vi.stubGlobal("fetch", vi.fn(async () => traLoi({ recipient_id: "PSID-9" })));

    const kq = await guiTinRaMeta({ pageId: "PAGE-1", psid: "PSID-9", text: "x" });

    expect(kq.ok).toBe(false);
    if (kq.ok) return;
    expect(kq.ma).toBe("META_TU_CHOI");
  });

  it("KHÔNG bao giờ để lộ giá trị token trong lời lỗi trả về", async () => {
    const { guiTinRaMeta } = await napProvider();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        traLoi({ error: { message: "Bad token EAA-token-that xyz", code: 190 } }, 400),
      ),
    );

    const kq = await guiTinRaMeta({ pageId: "PAGE-1", psid: "PSID-9", text: "x" });

    expect(kq.ok).toBe(false);
    if (kq.ok) return;
    expect(JSON.stringify(kq)).not.toContain("EAA-token-that");
  });
});

describe("[S-2b] messengerSendDaCauHinh — cổng đọc cấu hình", () => {
  it("đủ token + đúng Page ⇒ true", async () => {
    const { messengerSendDaCauHinh } = await napProvider();
    expect(messengerSendDaCauHinh("PAGE-1")).toBe(true);
  });

  it("thiếu token ⇒ false", async () => {
    delete process.env.META_PAGE_ACCESS_TOKEN;
    const { messengerSendDaCauHinh } = await napProvider();
    expect(messengerSendDaCauHinh("PAGE-1")).toBe(false);
  });

  it("Page lạ ⇒ false (chưa có token cho Page đó)", async () => {
    const { messengerSendDaCauHinh } = await napProvider();
    expect(messengerSendDaCauHinh("PAGE-LA")).toBe(false);
  });
});
