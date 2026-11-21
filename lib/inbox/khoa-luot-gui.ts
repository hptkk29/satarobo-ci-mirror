// lib/inbox/khoa-luot-gui.ts — dựng khoá GIÀNH CHỖ cho một lượt gửi.
//
// DỜI VỀ ĐÂY 22/09/2026 khi gỡ site Sale. Trước ở `components/sale/hop-thu/` vì
// ô soạn của Hộp thư sống ở đó; màn hình ấy đã gỡ, còn LUẬT KHOÁ thì không —
// nó là hợp đồng với `sendInboxReply` (`lib/inbox/send.ts`) chứ không phải với
// một cái nút. Đây là THUẦN (không state, không DOM) nên nó thuộc về `lib/inbox/`
// cùng phần động cơ, và bộ test tầng DB (`tests/inbox/hop-thu.spec.ts`) vẫn kiểm
// được BẰNG CHÍNH hàm mà đường gửi dùng, chứ không bằng một bản chép lại trong
// test (bản chép lại luôn xanh, kể cả khi đường thật hỏng).
//
// ── HỢP ĐỒNG VỚI SERVER (không đổi) ─────────────────────────────────────────
// `InboxMessage` có `@@unique([conversationId, outboundKey])` và `sendInboxReply`
// ném `TrungLuotGuiError` khi va. Đó là lưới chống BẤM ĐÚP / hai tab cùng gửi, và
// nó vẫn nguyên: cùng một lượt soạn thì cùng một khoá.
//
// ── VÌ SAO NONCE, KHÔNG PHẢI BĂM NỘI DUNG ───────────────────────────────────
// Bản đầu dựng khoá bằng `${conversationId}:${băm(nội dung)}`. Hệ quả không ai lường
// lúc viết: khoá trở thành "một câu chỉ được gửi MỘT LẦN trong đời hội thoại này".
// Sale trả lời khách bằng những câu ngắn lặp đi lặp lại — "Dạ em nghe ạ", "Vâng ạ",
// một emoji — nên lần thứ hai gõ đúng câu đó bị báo trùng lượt gửi cho một tin hoàn
// toàn hợp lệ, và cách duy nhất người dùng đoán ra là thêm một dấu chấm.
// Nonce tách hai khái niệm đang bị gộp: "cùng một lần bấm" (phải chặn) khác hẳn
// "cùng một câu chữ" (không việc gì phải chặn).

/**
 * Khoá của MỘT lượt soạn. Nội dung tin CỐ Ý không tham gia — xem khối trên.
 *
 * Chữ ký chỉ nhận hai tham số là một phần của luật: không có chỗ nào để "tiện tay"
 * đưa nội dung vào lại.
 */
export function taoKhoaLuotGui(conversationId: string, nonce: string): string {
  return `${conversationId}:${nonce}`;
}

/**
 * Một chuỗi lạ cho mỗi lượt soạn.
 *
 * ⚠️ `crypto.randomUUID` CHỈ tồn tại trong ngữ cảnh bảo mật (https, hoặc
 * http://localhost). Sale làm việc trên điện thoại và bản dev hay được mở qua LAN
 * (`http://192.168.x.x:3000`) — ở đó nó là `undefined`. Gọi thẳng sẽ ném và giết
 * cả ô soạn trả lời, hỏng to vì một chuyện đáng ra chỉ là "lấy một chuỗi lạ".
 * Đường lùi không cần chất lượng mật mã: khoá này chỉ cần duy nhất trong phạm vi
 * một hội thoại, không phải bí mật.
 */
export function nonceLuotGui(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
