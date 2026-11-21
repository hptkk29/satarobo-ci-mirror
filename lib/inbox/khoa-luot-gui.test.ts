// components/sale/hop-thu/khoa-luot-gui.test.ts — B1: Sale phải gửi lại được cùng một câu.
//
// LỖI ĐANG SỬA: khoá giành chỗ được dựng bằng `${conversationId}:${hashNhanh(noiDung)}`,
// tức NỘI DUNG nằm trong khoá. Cột `InboxMessage.outboundKey` bị ràng
// `@@unique([conversationId, outboundKey])`, nên lần thứ hai Sale gõ đúng một câu đã gửi
// trong cùng hội thoại — "Dạ em nghe ạ", "Vâng ạ", một cái emoji — sẽ va UNIQUE và bị
// báo TRÙNG LƯỢT GỬI. Người dùng thấy "gửi hỏng" cho một tin hoàn toàn hợp lệ, và cách
// duy nhất họ đoán ra là thêm một dấu chấm vào câu.
//
// SỬA Ở CLIENT, KHÔNG ĐỘNG HỢP ĐỒNG SERVER: `@@unique` và ca `[HT-11]` (bấm hai lần
// CÙNG một khoá ⇒ một dòng) giữ nguyên — đó vẫn là lưới chống bấm đúp / hai tab. Cái đổi
// là NGUỒN của khoá: một nonce cho mỗi LƯỢT SOẠN thay vì băm nội dung.
import { describe, it, expect, vi, afterEach } from "vitest";
import { taoKhoaLuotGui, nonceLuotGui } from "@/lib/inbox/khoa-luot-gui";


afterEach(() => {
  vi.unstubAllGlobals();
});

describe("[B1] khoá giành chỗ một lượt gửi", () => {
  it("[B1-01] hai lượt soạn khác nhau ⇒ hai khoá khác nhau, dù NỘI DUNG y hệt", () => {
    // Đây là ca hỏng của bản cũ: nội dung không còn tham gia vào khoá nên nó không
    // xuất hiện ở đâu trong bài kiểm này — đúng ý.
    expect(taoKhoaLuotGui("hoi-1", "nonce-a")).not.toBe(taoKhoaLuotGui("hoi-1", "nonce-b"));
  });

  it("[B1-02] CÙNG một lượt soạn ⇒ CÙNG một khoá (lưới chống bấm đúp còn nguyên)", () => {
    expect(taoKhoaLuotGui("hoi-1", "nonce-a")).toBe(taoKhoaLuotGui("hoi-1", "nonce-a"));
  });

  it("[B1-03] khoá gắn với ĐÚNG hội thoại — hai hội thoại không dùng chung khoá", () => {
    expect(taoKhoaLuotGui("hoi-1", "n")).not.toBe(taoKhoaLuotGui("hoi-2", "n"));
    expect(taoKhoaLuotGui("hoi-1", "n")).toBe("hoi-1:n");
  });

  it("[B1-04] nonce mỗi lần một khác, không rỗng", () => {
    const bo = new Set(Array.from({ length: 200 }, () => nonceLuotGui()));
    expect(bo.size).toBe(200);
    for (const n of bo) expect(n.length).toBeGreaterThan(7);
  });

  it("[B1-05] không có crypto.randomUUID vẫn sinh được nonce (ngữ cảnh KHÔNG bảo mật)", () => {
    // Sale làm việc trên điện thoại. Mở bản dev qua LAN (`http://192.168.x.x:3000`) là
    // ngữ cảnh KHÔNG bảo mật, ở đó `crypto.randomUUID` không tồn tại. Ném ở đây thì cả
    // ô soạn trả lời chết trắng — hỏng to vì một chuyện đáng ra chỉ là "lấy một chuỗi lạ".
    vi.stubGlobal("crypto", {});
    const a = nonceLuotGui();
    const b = nonceLuotGui();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

// ⚠️ 22/09/2026 — Ô SOẠN ĐÃ GỠ, LƯỚI NÀY MẤT CHỖ BÁM.
//
// Ở đây từng có ca `[B1-06]` đọc `components/sale/hop-thu/hop-thu-workspace.tsx` và
// đòi nó dựng khoá bằng `taoKhoaLuotGui(` chứ không băm nội dung (`hashNhanh`). Lưới
// đó tồn tại vì hai hằng số sống ở hai file, không kiểu nào buộc chúng khớp: dựng lại
// cách cũ thì bộ DB `[HT-11b]` vẫn xanh (nó gọi thẳng hàm thuần), chỉ màn hình thật
// hỏng lại — lặng lẽ, theo kiểu "một câu chỉ gửi được một lần trong đời hội thoại".
//
// Màn hộp thư gỡ cùng site Sale; ĐỘNG CƠ thì còn (webhook ZaloCRM vẫn ghi qua
// `lib/inbox/send.ts`, và `@@unique([conversationId, outboundKey])` vẫn đứng đó).
// Dựng lại ô soạn ở đâu — admin hay trong khung ZaloCRM — thì DÁN LẠI ca này, trỏ vào
// file mới. Đừng bỏ qua: đây đúng là lỗi không ai báo được.
