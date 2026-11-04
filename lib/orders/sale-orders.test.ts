// Test cho tầng đơn hàng của site Sale.
//
// Điều đáng khoá nhất không phải phép cộng mà là RANH GIỚI: màn Sale chỉ ghi
// nhận tiền, không xác nhận. Hai việc đó khác nhau về hệ quả — ghi nhận là "tôi
// đã cầm tiền", xác nhận là "sổ sách công nhận khoản này" — và gộp vào một nút
// là bỏ mất lớp đối soát của kế toán.
import { describe, it, expect } from "vitest";
import fs from "node:fs";


const doc = (f: string) => fs.readFileSync(f, "utf8");
const boChuThich = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("[site Sale] định dạng tiền dùng NGUỒN CHUNG", () => {
  it("không tự viết hàm định dạng tiền thứ hai", () => {
    // `lib/format/money.ts` đã có `formatVndPlain` (LIB-07 gom ~7 chỗ inline).
    // Viết thêm một hàm nữa là mở đường cho hai màn hiện tiền khác nhau.
    const src = fs.readFileSync("lib/orders/sale-orders.ts", "utf8");
    expect(src).not.toContain("toLocaleString");
  });
});

describe("[site Sale] ranh giới tiền — chốt chặn nguồn", () => {
  const FILES = [
    "lib/orders/sale-orders.ts",
    "app/(sale)/sale/chot-don/[leadId]/page.tsx",
    "app/(sale)/sale/khach-cua-toi/_components/order-panel.tsx",
  ];

  it("KHÔNG chỗ nào trên site Sale gọi xác nhận / huỷ / hoàn tiền", () => {
    // `confirmPaymentAction` thuộc `payments:manage` = Super Admin + Kế toán.
    // `changeOrderStatusAction` huỷ được đơn. Cả hai không phải việc của Sale.
    const cam = [
      "confirmPaymentAction",
      "changeOrderStatusAction",
      "adjustPaymentAction",
      "refund",
    ];
    for (const f of FILES) {
      if (!fs.existsSync(f)) continue;
      const src = boChuThich(doc(f));
      for (const t of cam) {
        expect(src, `${f} gọi ${t} — vượt ranh giới của màn Sale`).not.toContain(t);
      }
    }
  });

  it("truy vấn đơn đi qua scopedDb + mệnh đề sở hữu lead", () => {
    const src = boChuThich(doc("lib/orders/sale-orders.ts"));
    expect(src).toContain("scopedDb(actor)");
    expect(src).toContain("leadOwnershipWhere(userId)");
    expect(src).not.toMatch(/from\s+["']@\/lib\/db["']/);
  });

  it("chỉ cộng khoản ĐÃ GHI NHẬN và chưa xoá mềm — cùng bộ lọc với màn admin", () => {
    // Lệch bộ lọc là hai màn nói hai con số công nợ khác nhau cho cùng một khách,
    // và không ai biết màn nào đúng.
    // 16/09/2026 — nay đo bằng việc DÙNG HẰNG chung thay vì gõ tay hai điều kiện: cổng
    // `lib/finance/ghi-nhan.test.ts` (trục B chỉ có MỘT nhà) cấm chép lại chuỗi đó ra
    // từng file. Ý của ca này không đổi — hai màn phải cùng một bộ lọc — chỉ đổi cách đo.
    const src = boChuThich(doc("lib/orders/sale-orders.ts"));
    expect(src).toContain("KHOAN_DA_GHI_NHAN");
    expect(src).toContain("@/lib/finance/ghi-nhan");
  });

  it("số còn thiếu không bao giờ âm", () => {
    // Thu dư (trả trước, làm tròn) là chuyện có thật; hiện "còn thiếu −200.000đ"
    // thì người đọc phải tự dịch trong đầu.
    expect(boChuThich(doc("lib/orders/sale-orders.ts"))).toContain("Math.max(0,");
  });

  it("form tạo đơn KHÔNG nhận tồn kho từ máy chủ", () => {
    // `loadCreateOrderFormData` trả kèm `stockOnHand`; Sale không có quyền tồn
    // kho, nên phải cắt Ở TẦNG DỮ LIỆU chứ không chỉ không vẽ ra.
    const f = "app/(sale)/sale/chot-don/[leadId]/page.tsx";
    if (!fs.existsSync(f)) return;
    expect(boChuThich(doc(f))).not.toContain("stockOnHand");
  });
});
