// lib/orders/price-guard.luoi.test.ts — LƯỚI GHIM MÃ NGUỒN (mẫu ở CLAUDE.md).
//
// Luật cần khoá: "tạo đơn phải để lại DẤU VẾT giá + một dòng AuditLog".
//
// `soatGiaDon` là hàm thuần: test nó bao nhiêu cũng xanh trong khi
// `createOrderManualAction` vẫn không gọi nó và vẫn không ghi log nào — đúng hình dạng
// con bug đang có (hạ `unitPrice` trong payload đi lọt tuyệt đối vô dấu). Nên lưới phải
// đọc chính mã nguồn của action.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ⚠️ `import.meta.url` trong cấu hình vitest của repo này KHÔNG phải URL `file://`.
const ACTION = "app/(admin)/admin/orders/_actions.ts";
const src = () => readFileSync(resolve(process.cwd(), ACTION), "utf8");

describe("[CG-LUOI] tạo đơn để lại dấu vết giá", () => {
  it("action nạp giá niêm yết THẬT từ DB, tra THEO TẬP ID CỦA ĐƠN", () => {
    // ⚠️ Neo HẸP có chủ đích, và so trên bản ĐÃ BỎ KHOẢNG TRẮNG.
    //
    // Bản đầu của lưới chỉ tìm `sdb.course.findMany` — và nó XANH cả trên mã TRƯỚC bản
    // vá, vì file này vốn đã có `sdb.course.findMany` + `sdb.product.findMany` ở action
    // NẠP DANH SÁCH CHO FORM (`where: { isActive: true, isTeachable: true }`), chẳng
    // liên quan gì đến so giá. Một lưới xanh vĩnh viễn trông y hệt một lưới đang làm
    // việc — đúng thứ bước hoàn nguyên sinh ra để bắt.
    //
    // Bản thứ hai dùng regex nhiều dấu thoát và vỡ ngay ở khâu biên dịch. Bản này bỏ
    // khoảng trắng rồi so chuỗi: đọc được, không phụ thuộc cách xuống dòng của
    // prettier, và vẫn neo đúng vào "tra theo tập id của đơn".
    const gon = src().replace(/\s+/g, "");
    expect(gon, "phải tra Course.price theo tập id của đơn").toContain(
      "sdb.course.findMany({where:{id:{in:courseIds}}",
    );
    expect(gon, "phải tra Product.salePrice theo tập id của đơn").toContain(
      "sdb.product.findMany({where:{id:{in:productIds}}",
    );
  });

  it("action gọi soatGiaDon — không tự viết lại phép so tại chỗ", () => {
    const s = src();
    expect(s).toContain('from "@/lib/orders/price-guard"');
    expect(s).toMatch(/soatGiaDon\(/);
  });

  it("action ghi AuditLog CREATE cho Order, và ghi TRONG transaction", () => {
    const s = src();
    // Mã TRƯỚC bản vá: `grep writeAudit` trên file này ra 0 dòng.
    //
    // ⚠️ TRẦN KÝ TỰ ĐÃ NỚI 1200 → 2400 [15/09/2026] → 3000 [18/09/2026], và đây là bài
    // học về chính lưới này. Đợt "giảm giá theo từng dòng" thêm `giamTungDong[]` vào thân
    // `writeAudit` ⇒ thân dài 1521 ký tự ⇒ regex KHÔNG khớp nữa ⇒ ca đỏ với thông báo
    // "không thấy lời gọi writeAudit", trong khi lời gọi vẫn còn nguyên và vẫn đúng. Một
    // lưới báo SAI nguyên nhân còn tệ hơn lưới không có: người đọc đi tìm một lời gọi bị
    // xoá mà không ai xoá cả. Lần nới thứ hai (18/09) là vì hợp nhất `main` cộng thêm
    // `leadChildId` · `shippingFee` · `customerPhone` · `ip` · `userAgent` vào cùng thân.
    //
    // Thứ THẬT SỰ chặn phạm vi là NEO ĐÓNG (đúng bốn dấu cách) cộng dấu `?` không tham.
    // Con số chỉ là lưới an toàn phòng khi ai đó xoá mất neo đóng.
    const goi = /await writeAudit\(\{[\s\S]{0,3000}?\n {4}\}\);/.exec(s);
    expect(goi, "không thấy lời gọi writeAudit trong _actions.ts").not.toBeNull();
    const than = goi![0];
    expect(than, 'phải là entityType "Order"').toMatch(/entityType:\s*"Order"/);
    expect(than, "phải ghi TRONG tx — có đơn là có log, không nửa vời").toMatch(/\btx,/);
  });

  it("dấu vết mang ĐỦ ba số để soát lại mà không phải mở lại payload", () => {
    const s = src();
    expect(s).toMatch(/giaLech:\s*soatGia\.coLech/);
    expect(s).toMatch(/giaTongLechThap:\s*soatGia\.tongLechThap/);
    expect(s).toMatch(/giaDongLech:\s*soatGia\.dongLech/);
  });

  it("KHÔNG quy phần lệch thành discountAmount — hướng đó bật cổng làm tiền mất sổ", () => {
    // Chặn đúng bản vá "hợp lý nhất" mà phản biện đã bác: cộng phần hạ giá vào
    // `discountAmount` ⇒ needsDiscountApproval true ⇒ sepay.ts trả MANUAL ⇒ webhook chỉ
    // ghi IntegrationLog ⇒ tiền vào bank, ba sổ trống.
    const s = src();
    expect(
      s,
      "không được cộng tongLechThap vào discountAmount",
    ).not.toMatch(/discountAmount\s*[+]?=\s*[^;\n]*tongLechThap/);
  });
});
