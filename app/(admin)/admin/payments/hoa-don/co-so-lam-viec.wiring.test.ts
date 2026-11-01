// [HDCS-W*] Lưới ghim DÂY NỐI của luật "hoá đơn luôn làm trong MỘT cơ sở" (23/10/2026).
//
// Hàm thuần `chonCoSoLamViec` có test hành vi ([LHC-10]); thứ test hành vi KHÔNG chạm tới là trang RSC:
// quên gọi nó, hoặc gọi mà vẫn nạp hàng chờ khi chưa chọn cơ sở, thì mọi ca [LHC-10] vẫn xanh và kế toán Hội
// sở lại thấy "tất cả cơ sở" (lỗi CÂM). Ghim: (1) trang dùng kết quả để rẽ nhánh, (2) lời gọi nạp hàng chờ
// chỉ nằm ở nhánh "đã chọn cơ sở", đúng MỘT lần, (3) bộ lọc đưa xuống loader mang cơ sở ĐÃ CHỌN.
// Neo vào BIỂU THỨC ĐIỀU KIỆN + số lần khớp, không neo vào chỗ đặt `await` (xem CLAUDE.md luật 11).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function docMaKhongChuThich(): string {
  const raw = readFileSync(resolve(process.cwd(), "app/(admin)/admin/payments/hoa-don/page.tsx"), "utf8");
  // Bỏ chú thích trước khi đếm: khối giải thích bản vá hay chứa đúng chuỗi đang canh.
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("[HDCS-W1] trang Hoá đơn: chưa chọn cơ sở ⇒ KHÔNG nạp hàng chờ", () => {
  const ma = docMaKhongChuThich();

  it("cơ sở làm việc đến từ chonCoSoLamViec (đúng 1 lời gọi), không tự suy tại chỗ", () => {
    expect(ma.match(/chonCoSoLamViec\(/g)?.length).toBe(1);
    expect(ma).toMatch(/const chuaChonCoSo = coSoLamViec === null;/);
  });

  it("napHangChoHoaDon(…) chỉ gọi MỘT lần và nằm ở nhánh sau `chuaChonCoSo ? … :`", () => {
    expect(ma.match(/napHangChoHoaDon\(/g)?.length).toBe(1);
    const m = /chuaChonCoSo\s*\?\s*\{[^}]*dong:\s*\[\][^}]*\}\s*:\s*await napHangChoHoaDon\(/.exec(ma);
    expect(m).not.toBeNull();
  });

  it("bộ lọc đưa xuống loader mang cơ sở ĐÃ CHỌN (không phải giá trị thô từ URL)", () => {
    expect(ma).toMatch(/const boLoc = \{ \.\.\.boLocTho, coSo: coSoLamViec \};/);
  });
});
