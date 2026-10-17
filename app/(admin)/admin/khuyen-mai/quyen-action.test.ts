// @vitest-environment node
// LƯỚI GHIM MÃ NGUỒN — mọi Server Action của module Khuyến mãi kiểm `promotions:manage` NGAY
// ĐẦU thân hàm, TRƯỚC khi gọi tầng nghiệp vụ (luật cứng Nền Hệ thống #1 + `.claude/rules/admin-site.md`).
//
// Vì sao ghim bằng mã nguồn: action chạm DB + phiên đăng nhập, test hành vi phải dựng cả Next.
// Trong khi luật cần khoá chỉ là "lời gọi A đứng trước lời gọi B trong từng hàm" — và tầng nghiệp
// vụ `lib/khuyen-mai/chinh-sach.ts` CỐ Ý không kiểm quyền (xem đầu file đó), nên quên một dòng ở đây
// là mở toang ban hành/thu hồi cho mọi người đăng nhập được, không lỗi nào báo.
//
// Neo vào LỜI GỌI (có dấu mở ngoặc) trên mã đã BỎ CHÚ THÍCH, và đếm SỐ HÀM (luật 11).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const NGUON = readFileSync(resolve(process.cwd(), "app/(admin)/admin/khuyen-mai/_actions.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^\s*\/\/.*$/gm, " ");

const GOI_NGHIEP_VU = /\b(banHanhChinhSach|suaChinhSach|thuHoiChinhSach|themVoucher|batTatVoucher)\(/;

function cacHam(src: string): { ten: string; than: string }[] {
  const phan = src.split(/export async function /).slice(1);
  return phan.map((p) => ({ ten: p.slice(0, p.indexOf("(")), than: p }));
}

describe("[KM-ACT] Server Action gác promotions:manage trước khi ghi", () => {
  const ham = cacHam(NGUON);

  it("[KM-ACT-01] có đúng 5 action (ban hành · sửa · thu hồi · thêm mã · bật/tắt mã)", () => {
    expect(ham.map((h) => h.ten).sort()).toEqual(
      ["banHanhAction", "batTatVoucherAction", "suaAction", "themVoucherAction", "thuHoiAction"].sort(),
    );
  });

  for (const h of cacHam(NGUON)) {
    it(`[KM-ACT-02] ${h.ten}: assertPermission("promotions:manage") đứng TRƯỚC lời gọi nghiệp vụ`, () => {
      const viTriQuyen = h.than.indexOf('await assertPermission("promotions:manage")');
      const m = GOI_NGHIEP_VU.exec(h.than);
      expect(viTriQuyen, "thiếu kiểm quyền").toBeGreaterThan(-1);
      expect(m, "không thấy lời gọi nghiệp vụ — hàm đổi tên?").not.toBeNull();
      expect(viTriQuyen).toBeLessThan(m!.index);
    });
  }
});
