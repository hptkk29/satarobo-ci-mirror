// [NUT-*] — nút trên từng buổi của "Phân công buổi" nói đúng việc làm được: khoá ⇒ "Xem chi tiết", mở ⇒ "Xử lý". Nhãn và bảng thao tác
// đọc CÙNG `lyDoKhoa` (nghiệm thu 20/10/2026: nút "Xử lý" mở ra "chưa bật — chỉ để xem").
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { BuoiTrongTuan } from "@/lib/parttime/bang-phan-cong";
import { khoaThaoTac, lyDoKhoa, nhanNutBuoi } from "./loc";

const buoi = (p: Partial<BuoiTrongTuan> = {}) => ({ tinhTrang: "MO", apDung: true, lyDoDong: null, ...p }) as BuoiTrongTuan;

describe("[NUT] nhãn nút buổi theo lyDoKhoa", () => {
  it("[NUT-01] công tắc TẮT ⇒ 'Xem chi tiết' + lý do nói chưa bật (đối chứng: bật + có quyền ⇒ 'Xử lý')", () => {
    const khoa = lyDoKhoa(buoi(), { bat: false, coQuyen: true });
    expect(khoa).toContain("chưa bật");
    expect(nhanNutBuoi(khoa)).toBe("Xem chi tiết");
    expect(nhanNutBuoi(lyDoKhoa(buoi(), { bat: true, coQuyen: true }))).toBe("Xử lý");
  });
  it("[NUT-02] bật nhưng chỉ có quyền XEM ⇒ 'Xem chi tiết'", () => {
    expect(nhanNutBuoi(lyDoKhoa(buoi(), { bat: true, coQuyen: false }))).toBe("Xem chi tiết");
  });
  it("[NUT-03] buổi đã chốt / chính sách cũ ⇒ 'Xem chi tiết' dù bật + có quyền", () => {
    expect(nhanNutBuoi(lyDoKhoa(buoi({ tinhTrang: "DA_CHOT" } as Partial<BuoiTrongTuan>), { bat: true, coQuyen: true }))).toBe("Xem chi tiết");
    expect(nhanNutBuoi(lyDoKhoa(buoi({ apDung: false }), { bat: true, coQuyen: true }))).toBe("Xem chi tiết");
  });
  it("[NUT-04] buổi ĐÃ QUA (suaQua): đã chốt mà sửa được ⇒ 'Xử lý'; kỳ đã chốt ⇒ 'Xem chi tiết' + lý do; tắt / không quyền vẫn khoá", () => {
    const daChot = { ...buoi({ tinhTrang: "DA_CHOT" } as Partial<BuoiTrongTuan>), suaQua: { loi: null } };
    expect(nhanNutBuoi(khoaThaoTac(daChot, { bat: true, coQuyen: true }))).toBe("Xử lý");
    expect(khoaThaoTac({ ...daChot, suaQua: { loi: "Kỳ công đã chốt" } }, { bat: true, coQuyen: true })).toBe("Kỳ công đã chốt");
    expect(khoaThaoTac(daChot, { bat: true, coQuyen: false })).toMatch(/chỉ có quyền xem/);
    expect(khoaThaoTac(daChot, { bat: false, coQuyen: true })).toMatch(/chưa bật/);
    // Buổi chưa qua: y nguyên lyDoKhoa.
    expect(khoaThaoTac({ ...buoi(), suaQua: null }, { bat: true, coQuyen: true })).toBeNull();
  });
  it("[NUT-W1] dây nối: nút trong bảng tuần vẽ ĐÚNG `nhanNutBuoi(lyDoKhoa(b, quyen))`, không còn chữ 'Xử lý' gõ cứng", () => {
    const src = readFileSync(resolve(process.cwd(), "app/(admin)/admin/cham-cong/phan-cong/_components/bang-tuan.tsx"), "utf8")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src.split("const nhanNut = nhanNutBuoi(khoaThaoTac(b, quyen));").length - 1).toBe(1);
    expect(src.split("{nhanNut}").length - 1).toBe(1);
    expect(src).not.toMatch(/>\s*Xử lý\s*</);
  });
});
