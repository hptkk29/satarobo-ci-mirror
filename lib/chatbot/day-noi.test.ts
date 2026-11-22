/**
 * Chatbot website — LƯỚI GHIM DÂY NỐI (chủ dự án chốt 06/11/2026).
 * Thứ test hành vi không đo được: layout có truyền dữ liệu, nút có hỏi trạng thái thật, action có cổng quyền,
 * và cấu hình mặc định TẮT (bật là tốn tiền). Đọc mã nguồn đã bóc chú thích.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SETTINGS } from "@/lib/settings/registry";
import { QUYEN_TAB } from "@/lib/settings/nhan-van-hanh";

function doc(p: string): string {
  const s = readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}
const dem = (s: string, re: RegExp) => (s.match(new RegExp(re.source, "g")) ?? []).length;

describe("[CB-W] chatbot — dây nối", () => {
  it("[CB-W1] mặc định TẮT, cấu hình toàn hệ thống; tab chỉ Quản trị tối cao", () => {
    expect(SETTINGS["chatbot.batTrenWebsite"].default).toBe(false);
    expect(SETTINGS["chatbot.batTrenWebsite"].centerOverridable).toBe(false);
    expect(QUYEN_TAB.chatbot).toBe("settings:view");
  });

  it("[CB-W2] layout public + trang 404 truyền dữ liệu chatbot cho FloatingCta", () => {
    // Luật là «thẻ FloatingCta nhận chatbot={duLieuChatbot()}», không phải «thẻ chỉ có ngần ấy prop» (10/11/2026: thêm congThongTin ở giữa
    // làm lưới cũ đỏ oan — nó ghim cả chuỗi thẻ). Neo vào prop chatbot trong ĐÚNG thẻ FloatingCta, đếm số lần.
    expect(dem(doc("app/(public)/layout.tsx"), /<FloatingCta\b[^>]*\bchatbot=\{duLieuChatbot\(\)\}[^>]*\/>/)).toBe(1);
    expect(dem(doc("app/not-found.tsx"), /chatbot=\{duLieuChatbot\(\)\}/)).toBe(1);
  });

  it("[CB-W3] nút chỉ thành chatbot khi máy chủ báo đang chạy (bật + có key)", () => {
    const s = doc("components/public/floating-cta.tsx");
    expect(dem(s, /const chatbot = useChatbotBat\(\) \? duChatbot : null;/)).toBe(1);
    expect(s).toMatch(/fetch\("\/api\/public\/chatbot"\)/);
    expect(s).toMatch(/const b = j\?\.bat === true;/);
  });

  it("[CB-W4] lưu/gỡ API key đòi settings:edit ở CẢ HAI action", () => {
    const s = doc("app/(admin)/admin/cau-hinh-van-hanh/_actions-chatbot.ts");
    expect(dem(s, /if \(!\(await checkPermission\("settings:edit"\)\)\) return \{ ok: false/)).toBe(2);
  });

  it("[CB-W5] biểu mẫu chatbot gửi qua /api/leads với nguồn chatbot + cơ sở (chia lead hiện tại)", () => {
    const s = doc("components/public/chatbot/chatbot-widget.tsx");
    expect(s).toMatch(/fetch\("\/api\/leads"/);
    expect(s).toMatch(/centerCode: coSo,/);
    expect(s).toMatch(/source: NGUON_LEAD_CHATBOT,/);
    expect(s).toMatch(/if \(!coSo\) l\.coSo = /);
  });
});
