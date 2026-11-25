// lib/affiliate/bot-xem-truoc.ts — PHÂN BIỆT lượt bấm /r/<token> của NGƯỜI với lượt của bot xem trước / công cụ (audit XI · R7). THUẦN.
//
// Vì sao: `ReferralClick` là số liệu đánh giá đối tác. Bot xem trước link (Facebook/Telegram/Slack/Discord…), crawler và công cụ dòng lệnh bấm /r/<token> mà
// vẫn bị đếm như khách thật ⇒ click bị thổi phồng. HEAD cũng vậy: Next.js chạy GET handler cho HEAD nếu route không export HEAD.
//
// Luật: bot ⇒ vẫn ĐƯỢC chuyển tới trang đích SẠCH (xem trước vẫn ra đúng trang, khách không bị mất) nhưng KHÔNG ghi lượt bấm, KHÔNG phát cookie.
// User-Agent TRỐNG ⇒ vẫn tính là người: trình duyệt thật luôn gửi UA nên đây chỉ có thể là script, nhưng không có UA thì không có bằng chứng nào để gọi nó là bot
// (và bộ test tích hợp của repo gọi route không UA). Chỉ bắt UA/phương thức ghi rõ là máy.
//
// ⚠️ KHÔNG đưa vào danh sách những UA có thể là NGƯỜI THẬT: trình duyệt trong app Zalo / Messenger / Facebook (`FBAN`, `FB_IAB`, `Zalo`) mở link bằng người dùng — chặn chúng là mất đúng khách
// quan trọng nhất của chương trình. Chỉ bắt UA ghi rõ là bot/crawler/preview/công cụ.
const BOT_RE = new RegExp(
  [
    // Tên bot cụ thể — KHÔNG dùng chuỗi con "bot" trần: nó khớp tên máy thật (điện thoại Cubot…) và mất đúng khách người thật.
    "googlebot",
    "bingbot",
    "slackbot",
    "telegrambot",
    "discordbot",
    "linkedinbot",
    "twitterbot",
    "applebot",
    "yandexbot",
    "duckduckbot",
    "petalbot",
    "ahrefsbot",
    "semrushbot",
    "mj12bot",
    "dotbot",
    "seznambot",
    "pinterestbot",
    "facebot",
    "facebookexternalhit",
    "whatsapp", // WhatsApp/x.y — bộ xem trước link; người dùng WhatsApp mở link bằng trình duyệt hệ thống (UA khác)
    "skypeuripreview",
    "embedly",
    "slurp",
    "baiduspider",
    // Dạng chung của bot tự khai: "…bot/2.1", "…Bot-LinkExpanding", hoặc kèm URL liên hệ "(+http://…)".
    "bot/",
    "bot-",
    "\\+https?://",
    "crawl",
    "spider",
    "preview",
    "headlesschrome",
    "lighthouse",
    "pingdom",
    "uptime",
    "curl/",
    "wget/",
    "python-requests",
    "python-urllib",
    "go-http-client",
    "node-fetch",
    "axios/",
    "okhttp",
    "java/",
    "libwww",
    "httpclient",
    "postmanruntime",
  ].join("|"),
  "i",
);
export function laBotXemTruoc(userAgent: string | null | undefined, phuongThuc: string): boolean {
  if (phuongThuc.toUpperCase() === "HEAD") return true;
  const ua = (userAgent ?? "").trim();
  return ua !== "" && BOT_RE.test(ua);
}
