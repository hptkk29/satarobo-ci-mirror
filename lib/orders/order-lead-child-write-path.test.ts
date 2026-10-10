// lib/orders/order-lead-child-write-path.test.ts — [OLC] NỢ-13.
//
// 🔴 VÌ SAO CÓ TỆP NÀY — lớp lỗi "cột có người ĐỌC mà không còn ai GHI".
//
// Hợp nhất `main` → `test` (18/09/2026) gỡ ô "Học sinh của đơn" ở đầu biểu mẫu tạo đơn,
// vì `main` chuyển sang gắn con theo TỪNG DÒNG và chủ dự án chốt theo `main`:
// *"một phụ huynh đăng ký cho hai con trong cùng một đơn là chuyện thường ở đây"*.
//
// Đường GHI `Order.leadChildId` vẫn còn nguyên trong `_actions.ts`, nhưng nó đọc
// `data.leadChildId` — trường mà biểu mẫu **không còn gửi**. Hệ quả: hàm vẫn chạy, không
// lỗi, không test nào đỏ, và cột lặng lẽ rơi về nhánh "suy từ phiếu" ⇒ phiếu hai con ra
// `null` ⇒ doanh thu của cả hai em rơi vào ô "chưa quy được về con".
//
// ⚠️ ĐÂY LÀ HÌNH DẠNG NGUY HIỂM NHẤT: tổng doanh thu vẫn khớp, nên bảng số trông vẫn
// đúng. Chỉ phần bổ dọc theo học sinh là rỗng dần, và không ai nhìn tổng mà thấy được.
//
// Lưới này canh đúng một điều: **còn nơi ĐỌC `Order.leadChildId` thì phải còn đường GHI
// nuôi nó, và đường ghi ấy phải lấy nguồn từ CÁC DÒNG.**
//
// ⚠️ Luật 11 — neo hẹp, đếm số lần khớp, không cờ `/s`, và BỎ CHÚ THÍCH trước khi soi
// (chính khối chú thích bạn đang đọc có chứa nguyên văn những chuỗi đang canh).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { conDonTuCacDong } from "@/lib/orders/lead-child-link";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const boChuThich = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*/g, "$1");

const ACTIONS = "app/(admin)/admin/orders/_actions.ts";
const CHINH_SACH = "lib/orders/lead-child-link.ts";

/**
 * Mọi nơi ĐỌC cột `Order.leadChildId` mà ta biết. Thêm nơi đọc mới thì thêm vào đây —
 * và nếu lúc ấy không còn đường ghi, ca `[OLC-03]` sẽ đỏ thay vì để cột rỗng âm thầm.
 */
const NOI_DOC = [
  // Báo cáo doanh thu quy về từng con: `order: { select: { leadChildId } }` + ô
  // `unassigned` tính bằng `order: { leadChildId: null }`.
  "lib/reports/revenue-by-child.ts",
  // Script rà đơn cũ (`--apply` ghi phần suy được). Chỉ chạy tay.
  "scripts/n02-ra-soat-order-lead-child.ts",
];

describe("[OLC] Order.leadChildId — có người đọc thì phải có đường ghi", () => {
  it("[OLC-01] `conDonTuCacDong` chỉ quy được khi MỌI dòng trỏ CÙNG một con", () => {
    // Hành vi trước, văn bản mã sau — luật 11.
    expect(conDonTuCacDong([{ leadChildId: "c1" }, { leadChildId: "c1" }])).toBe("c1");
    // Dòng không khai con (mua sản phẩm, hoặc học viên đã có hồ sơ) KHÔNG phá phép suy.
    expect(conDonTuCacDong([{ leadChildId: "c1" }, { leadChildId: null }])).toBe("c1");
    expect(conDonTuCacDong([{ leadChildId: "c1" }, {}])).toBe("c1");
    // Khoảng trắng không đẻ ra một "con" thứ hai.
    expect(conDonTuCacDong([{ leadChildId: "c1" }, { leadChildId: "  " }])).toBe("c1");

    // 🔴 HAI CON ⇒ `null`, và đây nay là ca THƯỜNG. Đoán một đứa là chuyển doanh thu của
    // đứa này sang đứa kia — tổng vẫn khớp nên không ai phát hiện.
    expect(conDonTuCacDong([{ leadChildId: "c1" }, { leadChildId: "c2" }])).toBeNull();
    expect(conDonTuCacDong([])).toBeNull();
    expect(conDonTuCacDong([{ leadChildId: null }])).toBeNull();
  });

  it("[OLC-02] đường ghi lấy nguồn từ CÁC DÒNG, không từ ô chọn cấp đơn đã gỡ", () => {
    const ma = boChuThich(doc(ACTIONS));

    // Bản TRƯỚC bản vá: `requestedLeadChildId: data.leadChildId` — trường mà biểu mẫu
    // không còn gửi. Neo vào chính đối số đó.
    expect(
      (ma.match(/requestedLeadChildId: conDonTuCacDong\(data\.items\)/g) ?? []).length,
      `${ACTIONS}: nguồn của \`Order.leadChildId\` phải là CÁC DÒNG`,
    ).toBe(1);
    expect(
      ma,
      `${ACTIONS}: \`data.leadChildId\` là ô chọn cấp đơn ĐÃ GỠ — dùng lại là ghi rỗng`,
    ).not.toMatch(/requestedLeadChildId: data\.leadChildId/);

    // Và giá trị ấy phải thật sự đi vào `order.create`, không dừng ở một biến trung gian.
    expect((ma.match(/^\s+leadChildId,$/gm) ?? []).length).toBeGreaterThan(0);
  });

  it("[OLC-03] còn nơi ĐỌC thì đường ghi phải còn — không để cột rỗng âm thầm", () => {
    const coNguoiDoc = NOI_DOC.filter((f) => /leadChildId/.test(boChuThich(doc(f))));
    expect(
      coNguoiDoc.length,
      "danh sách NOI_DOC rỗng ⇒ lưới này thành cổng rỗng, không phải 'đã dọn xong'",
    ).toBeGreaterThan(0);

    // Đường ghi DUY NHẤT của cột: `createOrderManualAction`. Còn người đọc mà lời gọi
    // chính sách biến mất ⇒ đỏ ngay, thay vì để báo cáo bổ dọc rỗng dần.
    const ma = boChuThich(doc(ACTIONS));
    expect(
      (ma.match(/resolveOrderLeadChildId\(/g) ?? []).length,
      `còn ${coNguoiDoc.length} nơi đọc \`Order.leadChildId\` nhưng ${ACTIONS} không còn ` +
        "gọi `resolveOrderLeadChildId(` — cột sẽ rỗng dần mà tổng doanh thu vẫn khớp",
    ).toBe(1);
  });

  it("[OLC-04] luật suy nằm ở MỘT tệp chính sách, action không chép lại", () => {
    // Chép lại phép "gom distinct rồi lấy nếu đúng một" vào action là đẻ bản sao thứ hai
    // của luật — và bản trôi đi sẽ không báo lỗi ở đâu.
    expect(boChuThich(doc(CHINH_SACH))).toMatch(/export function conDonTuCacDong\(/);
    const ma = boChuThich(doc(ACTIONS));
    expect(
      ma,
      `${ACTIONS}: đừng tự dựng lại phép suy — gọi \`conDonTuCacDong\` ở ${CHINH_SACH}`,
    ).not.toMatch(/ids\.length === 1 \? ids\[0\]/);
  });
});
