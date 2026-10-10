// [OTK-*] — Màn Thanh toán phải có đường tới khoản thu CŨ HƠN 30 dòng gần nhất.
//
// ── LỖ CÓ SẴN, đo 02/10/2026 ─────────────────────────────────────────────────────────
// `page.tsx` gọi `queryPayments({})` — bộ lọc LUÔN RỖNG — và máy chủ `take: PAGE_SIZE`
// với `PAGE_SIZE = 30`. Giao diện không có ô tìm, không có nút tải thêm (`PhanTrangBang`
// chỉ phân trang đúng 30 dòng ấy). ⇒ Màn này chỉ bao giờ hiện **30 khoản gần nhất**.
//
// Hệ quả thật: đợt nhập học phí từ file Excel có **119 khoản** chờ kế toán ⇒ **89 khoản
// không có đường nào tới được**. Chủ dự án đi tìm `ORD-260910-000002` để gỡ một khoản
// nhập trùng; `Ctrl+F` của trình duyệt trả `0/0` vì dòng đó chưa bao giờ được tải về.
//
// ⚠️ Khả năng lọc VỐN ĐÃ CÓ ở máy chủ từ lâu (`filters.search` → `order.code` HOẶC
// `order.customerName`) mà **chưa từng được nối vào giao diện nào**. Đây đúng họ "tính
// năng câm": mã tồn tại, không ai gọi, không ca nào đỏ, và không ai biết nó có.
//
// ⚠️ Lưới ghim mã nguồn: thứ cần khoá là "ô nhập CÓ được nối vào bộ lọc máy chủ không".
// Test hành vi phải dựng cả trang + Server Action + phân quyền, và sẽ đỏ vì mọi lý do
// khác trước. Luật 11: bỏ chú thích trước khi quét, neo vào biểu thức, đếm số lần khớp.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const F_CLIENT = "app/(admin)/admin/payments/_components/payments-client.tsx";
const F_ACTION = "app/(admin)/admin/payments/_actions.ts";

function boChuThich(s: string): string {
  // ⚠️ THỨ TỰ CÓ NGHĨA, đừng đảo [02/10/2026]. Bản đầu bỏ khối `/* */` TRƯỚC, và một dấu
  // `/*` nằm bên trong một chú thích `//` của `payments/_actions.ts` đã mở ra một khối
  // GIẢ nuốt **4.771 ký tự mã thật** — gồm cả dòng `const PAGE_SIZE = 30;`. Lưới khi đó
  // không "đỏ oan": nó lặng lẽ soi một bản mã THIẾU, tức YẾU ĐI mà vẫn xanh.
  // Bỏ chú thích DÒNG trước (neo `^` nên `https://` giữa dòng không hề hấn), rồi mới khối.
  return s.replace(/^[ \t]*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

const CLIENT = boChuThich(readFileSync(resolve(process.cwd(), F_CLIENT), "utf8"));
const ACTION = boChuThich(readFileSync(resolve(process.cwd(), F_ACTION), "utf8"));

describe("[OTK] ô tìm khoản thu", () => {
  it("[OTK-01] client GỌI queryPayments với từ khoá — không phải bộ lọc rỗng", () => {
    expect(CLIENT, "chưa nối `queryPayments` vào giao diện").toContain("queryPayments");
    expect(CLIENT).toMatch(/queryPayments\(\{\s*search:/);
  });

  it("[OTK-02] có ô nhập nối vào trạng thái từ khoá", () => {
    expect(CLIENT).toContain("setTuKhoa");
    // Ô nhập phải ĐƯỢC ĐIỀU KHIỂN bởi `tuKhoa`; thiếu `value` thì gõ xong bấm Tìm sẽ
    // gửi chuỗi rỗng và màn im lặng trả lại 30 dòng cũ.
    expect(CLIENT).toMatch(/value=\{tuKhoa\}/);
  });

  it("[OTK-03] máy chủ lọc theo MÃ ĐƠN và TÊN KHÁCH — cả hai", () => {
    // Bỏ một vế là mất đúng đường người dùng hay gõ. Neo vào biểu thức where.
    expect(ACTION).toMatch(/order:\s*\{\s*code:\s*\{\s*contains:/);
    expect(ACTION).toMatch(/order:\s*\{\s*customerName:\s*\{\s*contains:/);
  });

  it("[OTK-04] màn NÓI THẬT về giới hạn 30 dòng", () => {
    // Luật 12 — affordance phải nói thật. Không có câu này thì người dùng tưởng 30 dòng
    // là TẤT CẢ, và đó đúng là hiểu nhầm đã xảy ra.
    expect(CLIENT).toContain("tối đa 30 mỗi lượt");
  });

  it("[OTK-05] PAGE_SIZE vẫn là 30 — đổi thì phải đổi cả câu nói với người dùng", () => {
    // Ghim cặp đôi: con số trong câu thông báo phải khớp con số thật. Lệch nhau là màn
    // nói dối bằng một con số cụ thể, tệ hơn không nói gì.
    const m = ACTION.match(/const PAGE_SIZE = (\d+)/);
    expect(m, "không còn `PAGE_SIZE` — đọc lại lưới này").not.toBeNull();
    expect(CLIENT).toContain(`tối đa ${m![1]} mỗi lượt`);
  });
});
