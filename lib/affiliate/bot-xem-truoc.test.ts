// @vitest-environment node
/** [BXT-*] laBotXemTruoc — thuần. Hai chiều: bắt bot, và KHÔNG bắt người thật (trình duyệt trong app Zalo/Facebook là khách quan trọng nhất của chương trình). */
import { describe, expect, it } from "vitest";

import { laBotXemTruoc } from "./bot-xem-truoc";

const BOT = [
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  "Facebot",
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  "TelegramBot (like TwitterBot)",
  "Slackbot-LinkExpanding 1.0",
  "Mozilla/5.0 (compatible; Discordbot/2.0)",
  "LinkedInBot/1.0",
  "WhatsApp/2.23.20.0",
  "curl/8.4.0",
  "Wget/1.21",
  "python-requests/2.31.0",
  "Go-http-client/2.0",
  "node-fetch/1.0",
  "axios/1.6.0",
  "okhttp/4.12.0",
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (compatible; UptimeRobot/2.0)",
  "Chrome-Lighthouse",
  "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
  "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)",
  "Pinterest/0.2 (+http://www.pinterest.com/bot.html)",
];

const NGUOI = [
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
  // Trình duyệt TRONG app: người dùng thật bấm link bạn bè gửi — tuyệt đối không được loại.
  "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 Zalo/24.05.1",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/460.0;FBBV/1]",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0",
  // Tên máy chứa chuỗi "bot" (điện thoại Cubot) và app Pinterest — NGƯỜI THẬT, không được loại (review độc lập 26/10).
  "Mozilla/5.0 (Linux; Android 11; CUBOT P40) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 13; CUBOT_KINGKONG_AX) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 Pinterest/Android",
];

describe("[BXT] laBotXemTruoc", () => {
  it("[BXT-01] bot / crawler / công cụ ⇒ true", () => {
    for (const ua of BOT) expect(laBotXemTruoc(ua, "GET"), ua).toBe(true);
  });
  it("[BXT-02] NGƯỜI THẬT (kể cả trình duyệt trong app Zalo / Facebook / Instagram) ⇒ false", () => {
    for (const ua of NGUOI) expect(laBotXemTruoc(ua, "GET"), ua).toBe(false);
  });
  it("[BXT-03] HEAD luôn là bot dù UA trông như người", () => {
    expect(laBotXemTruoc(NGUOI[0], "HEAD")).toBe(true);
    expect(laBotXemTruoc(NGUOI[0], "head")).toBe(true);
  });
  it("[BXT-04] UA trống / thiếu ⇒ KHÔNG coi là bot (không có bằng chứng; bộ test tích hợp gọi route không UA)", () => {
    expect(laBotXemTruoc(null, "GET")).toBe(false);
    expect(laBotXemTruoc(undefined, "GET")).toBe(false);
    expect(laBotXemTruoc("   ", "GET")).toBe(false);
  });
});
