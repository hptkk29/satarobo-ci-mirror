import "server-only";
// lib/chatbot/goi-claude.ts — MỘT chỗ gọi Claude cho chatbot website.
//
// Claude Haiku 5.5 (chủ dự án chốt 06/11/2026): thinking bật mặc định và TÍNH vào `max_tokens`
// ⇒ trần 1024 + effort `low` cho câu trả lời 2–3 câu; đọc khối nội dung theo `type`, không theo vị trí;
// không gửi temperature/top_p (400 trên model này). Model có thể TỪ CHỐI (`stop_reason: "refusal"`,
// không có model dự phòng phía server) ⇒ trả `null`, người gọi in câu dự phòng.

import Anthropic from "@anthropic-ai/sdk";
import { TOKEN_TRA_LOI_TOI_DA, type CuocTroChuyen } from "./noi-dung";

export type KetQuaGoi =
  | { ok: true; traLoi: string }
  | { ok: false; ma: "TU_CHOI" | "RONG" | "KEY_SAI" | "HAN_MUC" | "LOI_API" | "MANG" };

export async function goiClaude(args: {
  apiKey: string;
  model: string;
  loiDan: string;
  cuoc: CuocTroChuyen;
}): Promise<KetQuaGoi> {
  // Chatbot phải trả lời trong vài giây; thử lại 1 lần cho lỗi mạng/429/5xx (SDK tự lo).
  const client = new Anthropic({ apiKey: args.apiKey, maxRetries: 1, timeout: 25_000 });
  try {
    const res = await client.messages.create({
      model: args.model,
      max_tokens: TOKEN_TRA_LOI_TOI_DA,
      output_config: { effort: "low" },
      system: args.loiDan,
      messages: args.cuoc.messages.map((m) => ({ role: m.role, content: m.content })),
    });
    if (res.stop_reason === "refusal") return { ok: false, ma: "TU_CHOI" };
    const traLoi = res.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim();
    return traLoi ? { ok: true, traLoi } : { ok: false, ma: "RONG" };
  } catch (e) {
    // Không log nội dung trò chuyện hay key — chỉ lớp lỗi.
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { ok: false, ma: "KEY_SAI" };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, ma: "HAN_MUC" };
    if (e instanceof Anthropic.APIConnectionError) return { ok: false, ma: "MANG" };
    return { ok: false, ma: "LOI_API" };
  }
}
