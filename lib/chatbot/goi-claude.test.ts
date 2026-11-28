// [CB-G] Lớp gọi Claude: đọc khối theo `type` (Haiku 5.5 trả khối `thinking` trước câu trả lời), từ chối ⇒ mã
// riêng, lỗi SDK ⇒ mã lớp lỗi.
import { beforeEach, describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { goiClaude } from "./goi-claude";

// Hàm giả TỰ VIẾT (không phải vi.fn): với vi.fn, vitest 4 báo đỏ mọi ca mà phần giả lập ném lỗi, dù hàm được
// test bắt lỗi và trả đúng mã (đã đo bằng try/catch quanh lời gọi).
const gia = vi.hoisted(() => {
  const st: { impl: () => Promise<unknown>; calls: unknown[] } = { impl: async () => ({}), calls: [] };
  return { st, create: (tham: unknown) => (st.calls.push(tham), st.impl()) };
});
const { create } = gia;
// Lớp con của SDK THẬT: giữ nguyên các lớp lỗi (AuthenticationError…), chỉ thay `messages.create`.
vi.mock("@anthropic-ai/sdk", async (goc) => {
  const that = (await goc()) as { default: typeof Anthropic };
  class Gia extends that.default {
    constructor(...a: ConstructorParameters<typeof Anthropic>) {
      super(...a);
      Object.defineProperty(this, "messages", { value: { create } });
    }
  }
  return { ...that, default: Gia };
});
beforeEach(() => {
  gia.st.impl = async () => ({});
  gia.st.calls = [];
});

const tra = (v: unknown) => (gia.st.impl = async () => v);
const cuoc = { messages: [{ role: "user" as const, content: "Học thử thế nào?" }] };
const goi = () => goiClaude({ apiKey: "sk-ant-x", model: "claude-haiku-5-5", loiDan: "dặn", cuoc });

describe("[CB-G] goiClaude", () => {
  it("[CB-G1] bỏ khối thinking, nối các khối text; gửi effort low + trần token, không temperature", async () => {
    tra({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: "Học thử " }, { type: "text", text: "miễn phí ạ." }] });
    expect(await goi()).toEqual({ ok: true, traLoi: "Học thử miễn phí ạ." });
    const tham = gia.st.calls[0] as Record<string, unknown>;
    expect(tham).toMatchObject({ model: "claude-haiku-5-5", max_tokens: 1024, output_config: { effort: "low" }, system: "dặn" });
    expect("temperature" in tham).toBe(false);
  });

  it("[CB-G2] model từ chối ⇒ TU_CHOI (không đọc nội dung); chỉ có thinking ⇒ RONG", async () => {
    tra({ stop_reason: "refusal", content: [{ type: "text", text: "nửa câu" }] });
    expect(await goi()).toEqual({ ok: false, ma: "TU_CHOI" });
    tra({ stop_reason: "max_tokens", content: [{ type: "thinking", thinking: "", signature: "s" }] });
    expect(await goi()).toEqual({ ok: false, ma: "RONG" });
  });

  const nem = (e: Error) =>
    (gia.st.impl = async () => {
      throw e;
    });
  it("[CB-G3a] key sai / bị thu hồi ⇒ KEY_SAI", async () => {
    nem(new Anthropic.AuthenticationError(401, undefined, "bad key", new Headers()));
    expect(await goi()).toEqual({ ok: false, ma: "KEY_SAI" });
  });
  it("[CB-G3b] hết hạn mức Anthropic ⇒ HAN_MUC", async () => {
    nem(new Anthropic.RateLimitError(429, undefined, "slow down", new Headers()));
    expect(await goi()).toEqual({ ok: false, ma: "HAN_MUC" });
  });
  it("[CB-G3c] lỗi khác ⇒ LOI_API, không ném ra ngoài", async () => {
    nem(new Anthropic.InternalServerError(500, undefined, "boom", new Headers()));
    expect(await goi()).toEqual({ ok: false, ma: "LOI_API" });
  });
});
