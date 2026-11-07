// Test tra cứu danh mục của site Sale.
//
// Cái đáng khoá ở màn CHỈ ĐỌC không phải phép tính mà là NHỮNG GÌ KHÔNG ĐƯỢC RỜI
// MÁY CHỦ: giá vốn và tồn kho của học cụ. Sale không có quyền kho, và "không vẽ
// ra trên giao diện" là chưa đủ — payload RSC vẫn mang con số xuống trình duyệt.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { conTrong, TRANG_THAI_LOP_MO } from "./sale-catalog";

const doc = (f: string) => fs.readFileSync(f, "utf8");
const boChuThich = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("[tra cứu] conTrong — chỗ còn lại của lớp", () => {
  it("trừ bình thường", () => {
    expect(conTrong(12, 20)).toBe(8);
  });

  it("lớp đầy → 0", () => {
    expect(conTrong(20, 20)).toBe(0);
  });

  it("lớp VƯỢT sức chứa → 0, không trả số âm", () => {
    // Vượt sức chứa có thật (xếp tay, chuyển lớp). Hiện "còn −2 chỗ" là bắt người
    // tư vấn dịch trong đầu giữa lúc đang nói chuyện với khách.
    expect(conTrong(22, 20)).toBe(0);
  });
});

describe("[tra cứu] TRANG_THAI_LOP_MO", () => {
  it("đúng ba trạng thái còn nhận học viên", () => {
    expect([...TRANG_THAI_LOP_MO]).toEqual(["PLANNED", "RECRUITING", "ACTIVE"]);
  });

  it("KHÔNG gồm lớp đã xong / đã huỷ / đang chờ duyệt", () => {
    // `PENDING_APPROVAL` là lớp sale đã gán đủ học sinh, đang chờ quản lý duyệt —
    // chưa phải chỗ để tư vấn thêm người mới.
    for (const x of ["COMPLETED", "CANCELLED", "PENDING_APPROVAL"]) {
      expect(TRANG_THAI_LOP_MO as readonly string[]).not.toContain(x);
    }
  });
});

describe("[tra cứu] chốt chặn nguồn — cái gì KHÔNG được rời máy chủ", () => {
  const src = () => boChuThich(doc("lib/catalog/sale-catalog.ts"));

  it("KHÔNG chọn costPrice / stockOnHand của học cụ", () => {
    const s = src();
    expect(s, "trả giá vốn xuống client").not.toContain("costPrice");
    expect(s, "trả tồn kho xuống client").not.toContain("stockOnHand");
  });

  it("trang tra cứu cũng không nhắc tới hai trường đó", () => {
    const f = "app/(sale)/sale/tra-cuu/page.tsx";
    if (!fs.existsSync(f)) return;
    const s = boChuThich(doc(f));
    expect(s).not.toContain("costPrice");
    expect(s).not.toContain("stockOnHand");
  });

  it("đi scopedDb, không `db` trần", () => {
    const s = src();
    expect(s).toContain("scopedDb(actor)");
    expect(s).not.toMatch(/from\s+["']@\/lib\/db["']/);
  });

  it("bộ nạp DANH MỤC không tự tra voucher — mã khuyến mãi có màn riêng", () => {
    // 🔴 DÂY BẪY NÀY ĐÃ NỔ ĐÚNG MỘT LẦN, 28/09/2026 — và nó làm đúng việc của nó.
    //
    // Bản cũ có thêm một khẳng định: `lib/validators/order.ts` KHÔNG được chứa chữ
    // "voucher", kèm câu *"tạo đơn tay đã có voucher trở lại — xem lại phạm vi màn
    // này"*. Đó là một dây bẫy có chủ đích, không phải một lệnh cấm: lý lẽ của nó là
    // *"cho Sale tra mã là cho họ xem thứ không áp được vào đâu"* (đúng vào 03/08, khi
    // hệ voucher vừa bị gỡ khỏi đơn).
    //
    // Ngày 28/09 chủ dự án đưa mã khuyến mãi TRỞ LẠI form tạo đơn
    // (`KhaiGiam.voucherId`), nên dây bẫy nổ. Đi kiểm đúng thứ nó bảo kiểm, và câu trả
    // lời là **đã được giải quyết từ trước**: `/admin/tra-cuu` bày chính sách + mã
    // voucher từ 26/09 qua `docDanhSachChinhSach`. Tức tiền đề của dây bẫy ("Sale không
    // có chỗ nào tra mã") không còn đúng, và vế kiểm `order.ts` không còn canh gì.
    //
    // ⚠️ Vế GIỮ LẠI mới là vế có luật: `sale-catalog.ts` là bộ nạp DANH MỤC (khoá, lớp,
    // học cụ). Mã khuyến mãi không phải danh mục bán hàng và có màn riêng với quyền
    // riêng (`promotions:view`); tra nó ở đây là dựng bản thứ hai của một màn đã có, và
    // bản thứ hai sẽ đi qua một cổng quyền khác.
    expect(src().toLowerCase()).not.toContain("sdb.voucher");
    expect(src().toLowerCase()).not.toContain("promotionpolicy");
  });

  it("chỉ lấy khoá DẠY THẬT (isTeachable) — cùng bộ lọc với form tạo đơn", () => {
    // Hai bản ghi "Lập trình Robot" / "Luyện thi RoboSim" là danh mục marketing,
    // không bán được. Lọt vào đây là sale báo giá một thứ không tồn tại.
    expect(src()).toContain("isTeachable: true");
  });

  it("ba khối nạp theo quyền — không có quyền thì KHÔNG truy vấn", () => {
    // Nạp hết rồi mới giấu là tốn truy vấn cho khối chắc chắn không hiện.
    const s = src();
    expect(s).toContain("quyen.xemHocCu");
    expect(s).toContain("quyen.xemLop");
    expect(s).toContain("quyen.xemKhoaHoc");
    expect(s).toContain("Promise.resolve([])");
  });
});
