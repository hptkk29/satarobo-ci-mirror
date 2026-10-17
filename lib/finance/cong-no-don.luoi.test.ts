// lib/finance/cong-no-don.luoi.test.ts — LƯỚI GHIM MÃ NGUỒN (mẫu ở CLAUDE.md).
//
// Luật cần khoá: "trang chi tiết đơn phải HIỆN số còn thiếu".
//
// Test thuần không chứng minh được luật này. `congNoDon` có thể xanh 100% trong khi
// trang vẫn không in con số nào — đó CHÍNH LÀ con bug được báo: `orders/[id]/page.tsx`
// đã tính `paidSoFar` từ trước, dùng cho mã QR, rồi bỏ đi; client chỉ in
// `order.totalAmount`. Không có lời gọi nào sai, không có giá trị nào lệch — chỉ là
// một con số được tính rồi không đi đâu cả.
//
// Vì thế lưới đọc chính mã nguồn. Ba mắt, mỗi mắt chặn một cách bug quay lại:
//   1. page tính `congNoDon(...)` bằng `paidSoFar` — không phải bằng 0 hay `totalAmount`
//   2. page TRUYỀN `congNo` xuống client — tính mà không truyền là đúng bug cũ
//   3. client RENDER `<OrderDebtSummary` — truyền mà không vẽ cũng là đúng bug cũ
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ⚠️ `import.meta.url` trong cấu hình vitest của repo này KHÔNG phải URL `file://`
// (fileURLToPath ném) — dùng `process.cwd()`. Xem CLAUDE.md mục "LƯỚI GHIM MÃ NGUỒN".
const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const PAGE = "app/(admin)/admin/orders/[id]/page.tsx";
const CLIENT = "app/(admin)/admin/orders/_components/order-detail-client.tsx";

describe("[CND-LUOI] trang chi tiết đơn phải hiện số còn thiếu", () => {
  it("page gọi congNoDon với ĐÚNG hai trục, trục B lấy từ paidSoFar", () => {
    const src = doc(PAGE);
    expect(src, "page.tsx phải import congNoDon").toContain(
      'from "@/lib/finance/cong-no-don"',
    );
    // Mã TRƯỚC bản vá: không có lời gọi này ở đâu cả — `paidSoFar` chỉ vào `computeDueNow`.
    const goi = /congNoDon\(\{[\s\S]{0,400}?\}\)/.exec(src);
    expect(goi, "không thấy lời gọi congNoDon({...}) trong page.tsx").not.toBeNull();
    const than = goi![0];
    expect(than, "daGhiNhan phải lấy từ paidSoFar (cùng số với mã QR)").toMatch(
      /daGhiNhan:\s*paidSoFar\._sum\.amount/,
    );
    expect(than, "daXacNhan phải lọc bằng laKhoanDaXacNhan (trục A dùng chung)").toMatch(
      /daXacNhan:[\s\S]*laKhoanDaXacNhan/,
    );
  });

  it("page TRUYỀN congNo xuống OrderDetailClient", () => {
    // Tính rồi giữ trong biến là đúng hình dạng bug cũ.
    expect(doc(PAGE)).toMatch(/congNo=\{congNo\}/);
  });

  it("client RENDER khối OrderDebtSummary", () => {
    // Nhận prop rồi không vẽ cũng là đúng hình dạng bug cũ.
    const src = doc(CLIENT);
    expect(src, "client phải import khối công nợ").toContain('from "./order-debt-summary"');
    expect(src, "client phải render <OrderDebtSummary").toMatch(/<OrderDebtSummary\b/);
  });

  it("khối công nợ KHÔNG lấy trục A làm 'đã thu' (nếu lấy, đơn vừa nhập báo thiếu toàn bộ)", () => {
    // Mắt này không đọc page mà đọc chính khối vẽ: nó phải in `daThu` của congNoDon,
    // chứ không phải `accounting.confirmed`.
    const src = doc("app/(admin)/admin/orders/_components/order-debt-summary.tsx");
    expect(src).toMatch(/daThu/);
    expect(src, "khối công nợ không được dùng accounting.confirmed làm số đã thu").not.toMatch(
      /accounting\.confirmed/,
    );
  });
});
