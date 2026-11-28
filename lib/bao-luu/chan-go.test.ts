// lib/bao-luu/chan-go.test.ts — GỠ PAUSED ngoài hồ sơ: phép quyết định (thuần) + dây nối vào bốn đường. PHIÊN 2.
//
// Nửa còn lại của `chan-duong-tat.test.ts` (đặt PAUSED). Lưới dây nối đếm trên mã ĐÃ BỎ CHÚ THÍCH và khớp
// ĐỦ ba thứ — đúng đường, đúng `truoc`/`sau`/`coHoSoMo`, VÀ có câu `return` ngay sau: bài học Phiên 1, bản
// lưới chỉ đếm tên đường thì cấy `truoc: "PAUSED"` (vô hiệu hoá cổng) vẫn xanh.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chanGoBaoLuuNgoaiHoSo, type DuongDatBaoLuu } from "./chan-duong-tat";

const DUONG: DuongDatBaoLuu[] = ["DOI_TRANG_THAI_GHI_DANH", "FORM_GHI_DANH", "FORM_HOC_VIEN", "IMPORT_EXCEL"];

describe("[BL2-GO] chanGoBaoLuuNgoaiHoSo — GỠ PAUSED khi hồ sơ còn hiệu lực", () => {
  it("[BL2-GO-01] PAUSED → trạng thái khác KHI CÓ hồ sơ còn hiệu lực ⇒ bị chặn trên MỌI đường, chỉ về nút Học lại", () => {
    for (const duong of DUONG) {
      for (const sau of ["ACTIVE", "STUDYING", "WITHDREW", "GRADUATED"]) {
        expect(chanGoBaoLuuNgoaiHoSo({ duong, truoc: "PAUSED", sau, coHoSoMo: true }), `${duong} → ${sau}`).not.toBeNull();
      }
    }
    expect(chanGoBaoLuuNgoaiHoSo({ duong: "FORM_HOC_VIEN", truoc: "PAUSED", sau: "ACTIVE", coHoSoMo: true })).toMatch(/Học lại/);
  });

  it("[BL2-GO-02] ĐƯỜNG THOÁT: PAUSED MỒ CÔI (không hồ sơ nào phủ) ⇒ KHÔNG chặn — không thì họ kẹt vĩnh viễn", () => {
    for (const duong of DUONG) {
      expect(chanGoBaoLuuNgoaiHoSo({ duong, truoc: "PAUSED", sau: "ACTIVE", coHoSoMo: false }), duong).toBeNull();
    }
  });

  it("[BL2-GO-03] không phải gỡ PAUSED ⇒ không chặn: giữ nguyên PAUSED, không chạm trạng thái, hoặc đang KHÔNG PAUSED", () => {
    expect(chanGoBaoLuuNgoaiHoSo({ duong: "FORM_HOC_VIEN", truoc: "PAUSED", sau: "PAUSED", coHoSoMo: true })).toBeNull();
    expect(chanGoBaoLuuNgoaiHoSo({ duong: "FORM_HOC_VIEN", truoc: "PAUSED", sau: undefined, coHoSoMo: true })).toBeNull();
    expect(chanGoBaoLuuNgoaiHoSo({ duong: "FORM_HOC_VIEN", truoc: "PAUSED", sau: null, coHoSoMo: true })).toBeNull();
    expect(chanGoBaoLuuNgoaiHoSo({ duong: "FORM_HOC_VIEN", truoc: "ACTIVE", sau: "GRADUATED", coHoSoMo: true })).toBeNull();
    expect(chanGoBaoLuuNgoaiHoSo({ duong: "FORM_HOC_VIEN", truoc: null, sau: "ACTIVE", coHoSoMo: true })).toBeNull();
  });

  it("[BL2-GO-04] mỗi đường có thông điệp riêng; import chỉ cách giữ nguyên cột status", () => {
    const m = (duong: DuongDatBaoLuu) => chanGoBaoLuuNgoaiHoSo({ duong, truoc: "PAUSED", sau: "ACTIVE", coHoSoMo: true })!;
    expect(new Set(DUONG.map(m)).size).toBe(DUONG.length);
    expect(m("IMPORT_EXCEL")).toMatch(/Để trống|giữ nguyên/);
  });
});

/** Mã THẬT — đã bỏ chú thích (luật 11). */
function maThat(duongDan: string): string {
  const src = readFileSync(resolve(process.cwd(), duongDan), "utf8");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((d) => !d.trimStart().startsWith("//"))
    .join("\n");
}
const dem = (ma: string, re: RegExp) => ma.match(re)?.length ?? 0;

describe("[BL2-GO-W] dây nối: mọi đường gỡ PAUSED hỏi hồ sơ còn hiệu lực TRƯỚC khi cho đổi", () => {
  const GHI_DANH = maThat("app/(admin)/admin/enrollments/_actions.ts");
  const HOC_VIEN = maThat("app/(admin)/admin/students/_actions.ts");
  const IMPORT = maThat("app/api/admin/import/students/route.ts");

  it("[BL2-GO-W1] hộp đổi trạng thái: trạng thái hiện có → đích; coHoSoMo từ dangBaoLuu theo ghi danh; và trả lỗi", () => {
    const re =
      /chanGoBaoLuuNgoaiHoSo\(\{\s*duong: "DOI_TRANG_THAI_GHI_DANH",\s*truoc: enrollment\.status,\s*sau: data\.newStatus,\s*coHoSoMo: enrollment\.status === "PAUSED" && \(await dangBaoLuu\(data\.enrollmentId, new Date\(\)\)\),\s*\}\);\s*if \(loiGo\) return \{ ok: false, error: loiGo \};/g;
    expect(dem(GHI_DANH, re)).toBe(1);
  });

  it("[BL2-GO-W2] form ghi danh cũ (sửa): ĐÚNG 1 lời gọi, hỏi dangBaoLuu theo ghi danh đang sửa", () => {
    const re =
      /chanGoBaoLuuNgoaiHoSo\(\{\s*duong: "FORM_GHI_DANH",\s*truoc: existing\.status,\s*sau: e\.status,\s*coHoSoMo: existing\.status === "PAUSED" && \(await dangBaoLuu\(id, new Date\(\)\)\),\s*\}\);\s*if \(loiGo\) return \{ error: loiGo \};/g;
    expect(dem(GHI_DANH, re)).toBe(1);
  });

  it("[BL2-GO-W3] form học viên (sửa): hỏi coHoSoMoChoHocVien theo học viên đang sửa", () => {
    const re =
      /chanGoBaoLuuNgoaiHoSo\(\{\s*duong: "FORM_HOC_VIEN",\s*truoc: before\.status,\s*sau: data\.status,\s*coHoSoMo: before\.status === "PAUSED" && \(await coHoSoMoChoHocVien\(id, new Date\(\)\)\),\s*\}\);\s*if \(loiGo\) return \{ error: loiGo \};/g;
    expect(dem(HOC_VIEN, re)).toBe(1);
  });

  it("[BL2-GO-W4] import Excel: tra hồ sơ THEO LÔ, dòng có khai status khác bị từ chối (đẩy lỗi + bỏ dòng), dòng để trống GIỮ PAUSED", () => {
    expect(dem(IMPORT, /locHocVienCoHoSoMo\(/g)).toBe(1);
    expect(
      dem(
        IMPORT,
        /chanGoBaoLuuNgoaiHoSo\(\{\s*duong: "IMPORT_EXCEL",\s*truoc: "PAUSED",\s*sau: entry\.data\.status,\s*coHoSoMo: true,\s*\}\)/g,
      ),
    ).toBe(1);
    expect(IMPORT).toMatch(/errors\.push\(\{ row: i \+ 2, error: loiGo \}\);\s*continue;/);
    expect(IMPORT).toMatch(/status: r\.giuBaoLuu \? "PAUSED" : r\.data\.status,/);
  });
});
