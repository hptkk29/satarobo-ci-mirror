// @vitest-environment node
/**
 * WEBHOOK ZALOCRM — bảy bước, và MÃ TRẢ VỀ.
 *
 * Bộ này canh hai quyết định cố ý KHÁC với webhook OmiCall mà file kia được chép từ:
 *
 *  🔴 (1) KHÔNG có nhánh fail-open. `lib/calls/webhook.ts:79` (OmiCall — đã gỡ 06/10/2026) có
 *         `if (!secret) return { ok: true }` — chép sang đây là mở toang cửa cho bất
 *         kỳ ai POST vào hộp thư và dòng thời gian lead. Chữ ký RỖNG hay SAI đều 401.
 *
 *  🔴 (2) KHÔNG luôn trả 200. OmiCall trả 200 cho mọi thứ (kể cả lỗi xử lý) để tránh
 *         retry bão. Ở đây tách: lỗi NGHIỆP VỤ (payload lạ, org lạ) ⇒ 200 + FAILED
 *         (retry cũng ra đúng kết quả đó); lỗi HẠ TẦNG (DB ngã) ⇒ 5xx để outbox của
 *         fork retry. Luôn 200 nghĩa là tin MẤT VĨNH VIỄN mà bên gửi tưởng đã giao.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

import type { KetQuaCauHinhOrg } from "./config";

const BI_MAT = "bi-mat-cs1";

const state: {
  cauHinh: KetQuaCauHinhOrg;
  choQua: boolean;
  nap: unknown;
  napNem: Error | null;
  logNem: Error | null;
  delivery: { source: string; externalId: string | null; payload: unknown } | null;
  mark: { id: string; status: string; loi?: string | null }[];
  nhatKy: { orgCode: string; action: string; status: string }[];
} = {
  cauHinh: {
    ok: true,
    cauHinh: { orgCode: "cs1", secret: BI_MAT, centerId: "center-cs1", orgUnitId: "ou-cs1" },
  },
  choQua: true,
  nap: { ok: true, trung: false, conversationId: "conv-1" },
  napNem: null,
  logNem: null,
  delivery: null,
  mark: [],
  nhatKy: [],
};

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ success: state.choQua, remaining: 0, resetAt: 0 })),
}));

vi.mock("./config", () => ({
  traCauHinhOrg: vi.fn(async () => state.cauHinh),
}));

vi.mock("./nap-su-kien", () => ({
  napSuKienZalocrm: vi.fn(async () => {
    if (state.napNem) throw state.napNem;
    return state.nap;
  }),
}));

vi.mock("./log", () => ({
  ghiNhatKyZalocrm: vi.fn(async (i: { orgCode: string; action: string; status: string }) => {
    state.nhatKy.push(i);
    return "log-1";
  }),
}));

vi.mock("@/lib/lead/webhook", () => ({
  logWebhookDelivery: vi.fn(
    async (i: { source: string; externalId: string | null; payload: unknown }) => {
      if (state.logNem) throw state.logNem;
      state.delivery = i;
      return "wd-1";
    },
  ),
  markWebhookDelivery: vi.fn(async (id: string, status: string, loi?: string | null) => {
    state.mark.push({ id, status, loi });
  }),
}));

import { xuLyWebhookZalocrm } from "./webhook";

const THAN = JSON.stringify({
  event: "message.received",
  data: {
    messageId: "zc-msg-1001",
    conversationId: "zc-conv-77",
    zaloAccountId: "zc-acc-01",
    threadId: "1234567890123456789",
    threadType: "user",
    senderUid: "1234567890123456789",
    contact: { id: "zc-ct-9", phone: "0912345678" },
    content: "cho hỏi học phí",
    contentType: "text",
    sentAt: "2026-09-06T02:00:00.000Z",
  },
});

const ky = (than: string, secret = BI_MAT) =>
  createHmac("sha256", secret).update(than, "utf8").digest("hex");

function req(opts?: {
  than?: string;
  chuKy?: string | null;
  headers?: Record<string, string>;
}): Request {
  const than = opts?.than ?? THAN;
  const h: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": "1.2.3.4",
    ...(opts?.headers ?? {}),
  };
  const chuKy = opts?.chuKy === undefined ? ky(than) : opts.chuKy;
  if (chuKy !== null) h["x-webhook-signature"] = chuKy;
  return new Request("https://admin.satarobo.vn/api/webhooks/zalocrm/cs1", {
    method: "POST",
    headers: h,
    body: than,
  });
}

beforeEach(() => {
  state.cauHinh = {
    ok: true,
    cauHinh: { orgCode: "cs1", secret: BI_MAT, centerId: "center-cs1", orgUnitId: "ou-cs1" },
  };
  state.choQua = true;
  state.nap = { ok: true, trung: false, conversationId: "conv-1" };
  state.napNem = null;
  state.logNem = null;
  state.delivery = null;
  state.mark = [];
  state.nhatKy = [];
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("mã trả về", () => {
  it("[ZC-WH-01] thiếu bí mật ⇒ 503 và KHÔNG tạo WebhookDelivery", async () => {
    // (Chuyện "env vắng ⇒ THIEU_BI_MAT" đã kiểm ở `config.test.ts`; ở đây kiểm phản
    // ứng của webhook trước mã đó.)
    state.cauHinh = { ok: false, ma: "THIEU_BI_MAT", thongDiep: "chưa cấu hình" };
    const kq = await xuLyWebhookZalocrm(req(), "cs1");
    expect(kq.httpStatus).toBe(503);
    // Lỗi CẤU HÌNH CỦA MÌNH: không để lại một dòng vô nghĩa trong bảng vết, và 503
    // để bên gửi retry sau khi ta khai xong env.
    expect(state.delivery).toBeNull();
  });

  it("[ZC-WH-01b] fail-closed ở MỌI môi trường — kể cả không phải production", async () => {
    // 🔴 Đây là chỗ ĐẢO OmiCall: `kiemBiMatWebhook` cho qua ở dev/test ("chế độ stub").
    // "dev" chính là môi trường người ta quên bật lại, và cùng đường mã sẽ lên prod.
    const cu = process.env.NODE_ENV;
    vi.stubEnv("NODE_ENV", "development");
    state.cauHinh = { ok: false, ma: "THIEU_BI_MAT", thongDiep: "chưa cấu hình" };
    const kq = await xuLyWebhookZalocrm(req(), "cs1");
    expect(kq.httpStatus).toBe(503);
    vi.unstubAllEnvs();
    expect(process.env.NODE_ENV).toBe(cu);
  });

  it("[ZC-WH-02] chữ ký RỖNG (thiếu header) ⇒ 401 — KHÔNG cho qua", async () => {
    const kq = await xuLyWebhookZalocrm(req({ chuKy: null }), "cs1");
    expect(kq.httpStatus).toBe(401);
    expect(state.delivery).toBeNull();
  });

  it("[ZC-WH-02b] header có nhưng là chuỗi rỗng ⇒ 401", async () => {
    expect((await xuLyWebhookZalocrm(req({ chuKy: "" }), "cs1")).httpStatus).toBe(401);
    expect((await xuLyWebhookZalocrm(req({ chuKy: "   " }), "cs1")).httpStatus).toBe(401);
  });

  it("[ZC-WH-03] chữ ký SAI ⇒ 401 (ký bằng khoá của org khác cũng sai)", async () => {
    expect((await xuLyWebhookZalocrm(req({ chuKy: "deadbeef" }), "cs1")).httpStatus).toBe(401);
    const kyOrgKhac = ky(THAN, "bi-mat-cs2");
    expect((await xuLyWebhookZalocrm(req({ chuKy: kyOrgKhac }), "cs1")).httpStatus).toBe(401);
  });

  it("chữ ký có tiền tố `sha256=` vẫn được chấp nhận", async () => {
    const kq = await xuLyWebhookZalocrm(req({ chuKy: `sha256=${ky(THAN)}` }), "cs1");
    expect(kq.httpStatus).toBe(200);
  });

  it("[ZC-WH-04] org lạ ⇒ 404 + console.warn + IntegrationLog FAILED", async () => {
    // Triệu chứng của "gõ sai một ký tự trong webhook_url" là HỘP THƯ TRỐNG. Không có
    // dòng nhật ký thì không ai truy được vì sao.
    state.cauHinh = { ok: false, ma: "ORG_KHONG_KHAI", thongDiep: "Không tìm thấy tổ chức." };
    const kq = await xuLyWebhookZalocrm(req(), "cs9");
    expect(kq.httpStatus).toBe(404);
    expect(console.warn).toHaveBeenCalled();
    expect(state.nhatKy.some((n) => n.status === "FAILED")).toBe(true);
    expect(state.delivery).toBeNull();
  });

  it("org đang TẮT ở màn Tích hợp ⇒ 404 (không lộ ra rằng địa chỉ này có thật)", async () => {
    state.cauHinh = { ok: false, ma: "ORG_TAT", thongDiep: "Tổ chức đang tắt." };
    expect((await xuLyWebhookZalocrm(req(), "cs1")).httpStatus).toBe(404);
  });

  it("org sai KHUÔN ⇒ 404 và KHÔNG ghi IntegrationLog (chống bơm dòng vô hạn)", async () => {
    state.cauHinh = { ok: false, ma: "ORG_KHONG_HOP_LE", thongDiep: "sai khuôn" };
    const kq = await xuLyWebhookZalocrm(req(), "../../etc");
    expect(kq.httpStatus).toBe(404);
    // Chuỗi tự do của người lạ KHÔNG được thành `IntegrationLog.provider`.
    expect(state.nhatKy.length).toBe(0);
  });

  it("[ZC-WH-05] quá tần suất ⇒ 429", async () => {
    state.choQua = false;
    expect((await xuLyWebhookZalocrm(req(), "cs1")).httpStatus).toBe(429);
  });

  it("[ZC-WH-06] content-length > 100_000 ⇒ 413, chặn TRƯỚC khi đọc thân", async () => {
    const kq = await xuLyWebhookZalocrm(
      req({ headers: { "content-length": "200000" } }),
      "cs1",
    );
    expect(kq.httpStatus).toBe(413);
  });

  it("[ZC-WH-07] ingest báo TRÙNG ⇒ markWebhookDelivery DUPLICATE, HTTP 200", async () => {
    state.nap = { ok: true, trung: true, conversationId: "conv-1" };
    const kq = await xuLyWebhookZalocrm(req(), "cs1");
    expect(kq.httpStatus).toBe(200);
    expect(kq.body.duplicate).toBe(true);
    expect(state.mark).toEqual([{ id: "wd-1", status: "DUPLICATE", loi: undefined }]);
  });

  it("[ZC-WH-08] lỗi HẠ TẦNG (Prisma ném) ⇒ 5xx để outbox của fork retry", async () => {
    // Ngược hẳn OmiCall (luôn 200). App sống nhưng Prisma ngã (pool cạn, Supabase
    // nghẽn) mà trả 200 là tin biến mất và bên gửi tưởng đã giao.
    state.napNem = new Error("Prisma ngã");
    const kq = await xuLyWebhookZalocrm(req(), "cs1");
    expect(kq.httpStatus).toBeGreaterThanOrEqual(500);
    expect(state.mark.some((m) => m.status === "FAILED")).toBe(true);
  });

  it("lỗi hạ tầng NGAY ở bước ghi vết ⇒ vẫn 5xx, không nuốt", async () => {
    state.logNem = new Error("Prisma ngã");
    const kq = await xuLyWebhookZalocrm(req(), "cs1");
    expect(kq.httpStatus).toBeGreaterThanOrEqual(500);
  });

  it("payload LẠ (dịch hỏng) ⇒ 200 + FAILED, KHÔNG 5xx", async () => {
    // Lỗi nghiệp vụ: bên gửi retry cũng ra đúng kết quả đó. Bắt họ retry chỉ tốn
    // băng thông của cả hai và làm nhiễu bảng vết.
    const than = JSON.stringify({ event: "message.received", data: { content: "x" } });
    const kq = await xuLyWebhookZalocrm(req({ than, chuKy: ky(than) }), "cs1");
    expect(kq.httpStatus).toBe(200);
    expect(kq.body.ok).toBe(false);
    expect(state.mark[0]?.status).toBe("FAILED");
    expect(state.mark[0]?.loi).toBe("THIEU_MESSAGE_ID");
  });

  it("JSON hỏng ⇒ 200 + FAILED, vẫn ghi được một dòng vết", async () => {
    const than = "{khong-phai-json";
    const kq = await xuLyWebhookZalocrm(req({ than, chuKy: ky(than) }), "cs1");
    expect(kq.httpStatus).toBe(200);
    expect(state.delivery).not.toBeNull();
    expect(state.mark[0]?.status).toBe("FAILED");
  });

  it("sự kiện không cần xử lý (`webhook.test`) ⇒ 200 + PROCESSED", async () => {
    const than = JSON.stringify({ event: "webhook.test", data: {} });
    const kq = await xuLyWebhookZalocrm(req({ than, chuKy: ky(than) }), "cs1");
    expect(kq.httpStatus).toBe(200);
    expect(state.mark[0]?.status).toBe("PROCESSED");
  });
});

describe("hình dạng bản ghi vết", () => {
  it("`source` là `zalocrm:<org>` — KHÔNG phải 'zalo' (đã bị Zalo OA chiếm)", async () => {
    await xuLyWebhookZalocrm(req(), "cs1");
    expect(state.delivery?.source).toBe("zalocrm:cs1");
    // `WebhookDelivery` không có cột org; đây là cách DUY NHẤT tách được cơ sở trong
    // báo cáo và màn Replay. Và `"zalo"` là nguồn của webhook Zalo OA đang chạy trên
    // prod — trộn vào là replay/báo cáo đọc nhầm nguồn.
    expect(state.delivery?.source).not.toBe("zalo");
  });

  it("`externalId` là mã tin — để index [source, externalId] có tác dụng đối soát", async () => {
    await xuLyWebhookZalocrm(req(), "cs1");
    expect(state.delivery?.externalId).toBe("zc-msg-1001");
  });

  it("payload ghi xuống ĐÃ ĐỤC — không còn nội dung tin lẫn SĐT", async () => {
    await xuLyWebhookZalocrm(req(), "cs1");
    const ghi = JSON.stringify(state.delivery?.payload);
    expect(ghi).not.toContain("cho hỏi học phí");
    expect(ghi).not.toContain("0912345678");
    expect(ghi).toContain("zc-msg-1001"); // mã máy móc thì giữ để đối soát
  });

  it("thông điệp lỗi trả ra KHÔNG mang mẩu payload", async () => {
    // Màn "Webhook lỗi — Replay" hiện `errorMessage` cho bất kỳ ai có `settings:edit`,
    // không cách ly cơ sở. Nhét mẩu payload vào đó là lộ ngay.
    const than = JSON.stringify({
      event: "message.received",
      data: { content: "SỐ CỦA TÔI LÀ 0912345678" },
    });
    await xuLyWebhookZalocrm(req({ than, chuKy: ky(than) }), "cs1");
    const loi = String(state.mark[0]?.loi ?? "");
    expect(loi).not.toContain("0912345678");
    expect(loi).not.toContain("SỐ CỦA TÔI");
  });
});

describe("giới hạn tần suất", () => {
  it("khoá rate-limit KÈM org — ba cơ sở đi chung một Cloudflare Tunnel", async () => {
    const { rateLimit } = await import("@/lib/rate-limit");
    await xuLyWebhookZalocrm(req(), "cs2");
    expect(rateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: expect.stringContaining("cs2"), max: 600 }),
    );
    // Chỉ theo IP thì CS1 bận là làm nghẹt CS2, và 429 KHÔNG để lại dòng
    // `WebhookDelivery` nào ⇒ mất tin không có vết.
    const goi = (rateLimit as unknown as { mock: { calls: [{ key: string }][] } }).mock.calls;
    expect(goi[0][0].key).toContain("1.2.3.4");
  });

  it("[ZC-WH-IP-01] sau Caddy (VPS): khoá theo phần tử CUỐI của XFF — đổi phần tử đầu mỗi lượt KHÔNG đổi khoá", async () => {
    // 28/09/2026 — bản cũ lấy `split(",")[0]`, tức phần tử KHÁCH viết ⇒ mỗi lượt một khoá ⇒
    // trần 600/phút không bao giờ chạm. Caddy đặt IP thật ở CUỐI.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("CI", "");
    try {
      const { rateLimit } = await import("@/lib/rate-limit");
      for (let i = 1; i <= 5; i += 1) {
        await xuLyWebhookZalocrm(
          req({ headers: { "x-forwarded-for": `10.0.0.${i}, 203.0.113.9`, "x-real-ip": `10.1.0.${i}` } }),
          "cs1",
        );
      }
      const khoa = new Set(
        (rateLimit as unknown as { mock: { calls: [{ key: string }][] } }).mock.calls.map((c) => c[0].key),
      );
      expect([...khoa]).toEqual(["webhook:zalocrm:cs1:203.0.113.9"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
