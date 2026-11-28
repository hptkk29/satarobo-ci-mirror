// [CB-R] Route chatbot công khai: mọi cổng (tắt · hạn mức · dữ liệu xấu · thiếu key) phải chặn TRƯỚC lời gọi
// Claude — lời gọi tốn tiền thật. Giả lập cấu hình / hạn mức / key / Claude; không DB, không mạng.
import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  bat: true,
  soTin: 20,
  rlOk: true,
  key: "sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxx" as string | null,
  goi: vi.fn(),
  rl: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "1.2.3.4" }) }));
vi.mock("@/lib/security/client-ip", () => ({ ipChoRateLimit: () => "1.2.3.4" }));
vi.mock("@/lib/settings/service", () => ({
  getSetting: async (k: string) => (k === "chatbot.batTrenWebsite" ? st.bat : k === "chatbot.soTinMoiMay" ? st.soTin : undefined),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: async (a: unknown) => {
    st.rl(a);
    return { success: st.rlOk, remaining: 0, resetAt: Date.now() };
  },
}));
vi.mock("@/lib/chatbot/khoa-api", () => ({ layKhoaApi: async () => st.key }));
vi.mock("@/lib/chatbot/trang-thai", () => ({ dangBatChatbot: async () => st.bat && st.key !== null }));
vi.mock("@/lib/chatbot/goi-claude", () => ({ goiClaude: (a: unknown) => st.goi(a) }));

import { GET, POST } from "./route";
import { CAU_DU_PHONG, MODEL_CHATBOT } from "@/lib/chatbot/noi-dung";

const req = (body: unknown) => new Request("http://x/api/public/chatbot", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const HOP_LE = { messages: [{ role: "user", content: "Con lớp 3 học khoá nào?" }] };

beforeEach(() => {
  st.bat = true;
  st.rlOk = true;
  st.key = "sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxx";
  st.goi.mockReset().mockResolvedValue({ ok: true, traLoi: "Bé lớp 3 hợp với Sata4 ạ." });
  st.rl.mockReset();
});

describe("[CB-R] POST /api/public/chatbot", () => {
  it("[CB-R1] chạy: trả câu của Claude, gọi đúng model + lời dặn", async () => {
    const r = await POST(req(HOP_LE));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, traLoi: "Bé lớp 3 hợp với Sata4 ạ." });
    expect(st.goi).toHaveBeenCalledTimes(1);
    const a = st.goi.mock.calls[0][0] as { model: string; loiDan: string; apiKey: string };
    expect(a.model).toBe(MODEL_CHATBOT);
    expect(a.loiDan).toMatch(/Sata Robo/);
    expect(st.rl).toHaveBeenCalledWith(expect.objectContaining({ key: "chatbot:1.2.3.4", max: 20, windowMs: 600_000 }));
  });

  it("[CB-R2] TẮT ở cấu hình ⇒ 404, không đếm hạn mức, không gọi Claude", async () => {
    st.bat = false;
    const r = await POST(req(HOP_LE));
    expect(r.status).toBe(404);
    expect(st.rl).not.toHaveBeenCalled();
    expect(st.goi).not.toHaveBeenCalled();
  });

  it("[CB-R3] vượt hạn mức ⇒ 429 + câu dự phòng, không gọi Claude", async () => {
    st.rlOk = false;
    const r = await POST(req(HOP_LE));
    expect(r.status).toBe(429);
    expect((await r.json()).traLoi).toBe(CAU_DU_PHONG);
    expect(st.goi).not.toHaveBeenCalled();
  });

  it("[CB-R4] dữ liệu xấu (không phải JSON / sai thứ tự vai) ⇒ 400, không gọi Claude", async () => {
    expect((await POST(req("{khong-phai-json"))).status).toBe(400);
    expect((await POST(req({ messages: [{ role: "assistant", content: "x" }] }))).status).toBe(400);
    expect(st.goi).not.toHaveBeenCalled();
  });

  it("[CB-R5] chưa khai key ⇒ 503, không gọi Claude", async () => {
    st.key = null;
    const r = await POST(req(HOP_LE));
    expect(r.status).toBe(503);
    expect(st.goi).not.toHaveBeenCalled();
  });

  it("[CB-R6] Claude từ chối / key sai ⇒ câu dự phòng (không lộ lỗi nội bộ)", async () => {
    st.goi.mockResolvedValue({ ok: false, ma: "TU_CHOI" });
    expect(await (await POST(req(HOP_LE))).json()).toEqual({ ok: false, traLoi: CAU_DU_PHONG });
    st.goi.mockResolvedValue({ ok: false, ma: "KEY_SAI" });
    const r = await POST(req(HOP_LE));
    expect(r.status).toBe(502);
    expect((await r.json()).traLoi).toBe(CAU_DU_PHONG);
  });
});

describe("[CB-R7] GET trạng thái", () => {
  it("bật + có key ⇒ bat:true; thiếu một trong hai ⇒ bat:false", async () => {
    expect(await (await GET()).json()).toEqual({ bat: true });
    st.key = null;
    expect(await (await GET()).json()).toEqual({ bat: false });
    st.key = "k";
    st.bat = false;
    expect(await (await GET()).json()).toEqual({ bat: false });
  });
});
