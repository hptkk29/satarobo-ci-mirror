// POST /api/public/chatbot — một lượt trả lời của chatbot website (chủ dự án chốt 06/11/2026).
//
// Không đăng nhập (trang công khai) ⇒ mọi thứ ở đây là đầu vào không tin cậy:
//  · cổng TẮT trước tiên (cờ `chatbot.batTrenWebsite`) — tắt là 404, không gọi gì;
//  · hạn mức theo IP (`chatbot.soTinMoiMay` / 10 phút) — chặn người phá làm tốn tiền API;
//  · Zod giới hạn số lượt, độ dài, thứ tự vai (`cuocTroChuyenSchema`);
//  · máy chủ KHÔNG lưu cuộc trò chuyện và KHÔNG log nội dung (có thể chứa thông tin cá nhân).
// Thông tin liên hệ KHÔNG đi qua đây: biểu mẫu của widget gửi thẳng `/api/leads` (đường chia lead hiện tại).

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getSetting } from "@/lib/settings/service";
import { rateLimit } from "@/lib/rate-limit";
import { ipChoRateLimit } from "@/lib/security/client-ip";
import { CAU_DU_PHONG, MODEL_CHATBOT, cuocTroChuyenSchema } from "@/lib/chatbot/noi-dung";
import { dungLoiDan } from "@/lib/chatbot/loi-dan";
import { layKhoaApi } from "@/lib/chatbot/khoa-api";
import { goiClaude } from "@/lib/chatbot/goi-claude";
import { dangBatChatbot } from "@/lib/chatbot/trang-thai";

export const dynamic = "force-dynamic";

const CUA_SO_MS = 10 * 60 * 1000;

const duPhong = (status: number) => NextResponse.json({ ok: false, traLoi: CAU_DU_PHONG }, { status });

/**
 * GET — trình duyệt hỏi chatbot có đang chạy không (bật + có key). Hỏi ở trình duyệt chứ KHÔNG ở layout:
 * trang tĩnh dựng lúc build (máy build không có DB) sẽ đóng băng "tắt" sau mỗi lần deploy.
 * Đệm 60 giây ở CDN/proxy — rẻ, và bật/tắt có tác dụng trong vòng một phút.
 */
export async function GET() {
  return NextResponse.json({ bat: await dangBatChatbot() }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60" } });
}

export async function POST(req: Request) {
  if (!(await getSetting("chatbot.batTrenWebsite"))) {
    return NextResponse.json({ ok: false, traLoi: CAU_DU_PHONG }, { status: 404 });
  }

  const ip = ipChoRateLimit(await headers());
  const limit = await rateLimit({ key: `chatbot:${ip}`, max: await getSetting("chatbot.soTinMoiMay"), windowMs: CUA_SO_MS });
  if (!limit.success) return duPhong(429);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return duPhong(400);
  }
  const parsed = cuocTroChuyenSchema.safeParse(body);
  if (!parsed.success) return duPhong(400);

  const apiKey = await layKhoaApi();
  if (!apiKey) return duPhong(503);

  const kq = await goiClaude({ apiKey, model: MODEL_CHATBOT, loiDan: dungLoiDan(), cuoc: parsed.data });
  if (kq.ok) return NextResponse.json({ ok: true, traLoi: kq.traLoi });
  // Chỉ log LỚP lỗi (để quản trị biết key hỏng / hết hạn mức), không log nội dung hay key.
  if (kq.ma === "KEY_SAI" || kq.ma === "HAN_MUC") console.error(`[chatbot] Anthropic: ${kq.ma}`);
  return duPhong(kq.ma === "TU_CHOI" || kq.ma === "RONG" ? 200 : 502);
}
