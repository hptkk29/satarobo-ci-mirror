/**
 * [W4-L*] — LƯỚI GHIM MÃ NGUỒN của đợt vá giao diện (gt1 R2, W4). Đọc mã ĐÃ BỎ CHÚ THÍCH, neo hẹp, ĐẾM số lần khớp, không cờ `/s` (luật 11). Mỗi ca đã được cấy lại lỗi (báo cáo W4).
 *
 *   [W4-L1] nút nhỏ (`h-8`) trong module đều dùng hằng NUT_NHO (h-11 md:h-8) — không còn `cn(BTN_*, "h-8 …")` gõ tay
 *   [W4-L2] số «10 ký tự» của lý do/giải trình lấy từ hằng của lõi, không gõ cứng ở biểu mẫu / chi tiết
 *   [W4-L3] trang tạo/sửa nguồn KHÔNG còn nhánh «Quản lý nguồn chưa được bật» (vaoTab đã 404 khi cờ tắt — nhánh không bao giờ chạy)
 *   [W4-L4] mã chết đã gỡ (TabHoaHongKhung · ChuaCoNoiDung)
 *   [W4-L5] bộ lọc trạng thái ở danh sách nguồn đi từ bảng gốc, không gõ tay
 *   [W4-L6] link composer tới trang nguồn gác theo cờ nguồn (`scope.co.nguon`)
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = process.cwd();
function boChuThich(s: string): string {
  return s
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}
const doc = (duong: string) => boChuThich(readFileSync(resolve(GOC, duong), "utf8"));
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;
function duyet(thuMuc: string): string[] {
  return readdirSync(thuMuc).flatMap((t) => {
    const f = join(thuMuc, t);
    return statSync(f).isDirectory() ? duyet(f) : [f];
  });
}
const COMP = resolve(GOC, "components/admin/nguon-hoa-hong");
const APP = resolve(GOC, "app/(admin)/admin/nguon-hoa-hong");
const khongTest = (f: string) => /\.(tsx|ts)$/.test(f) && !/\.test\./.test(f);

describe("[W4-L1] nút nhỏ có vùng chạm", () => {
  it('không còn `cn(BTN_OUTLINE|BTN_PRIMARY, "h-8 …")` gõ tay; hằng NUT_NHO = h-11 md:h-8', () => {
    const tep = [...duyet(COMP), ...duyet(APP)].filter(khongTest);
    expect(tep.length).toBeGreaterThan(40);
    for (const f of tep) {
      const s = boChuThich(readFileSync(f, "utf8"));
      expect(dem(s, /cn\(\s*BTN_(?:OUTLINE|PRIMARY)\s*,\s*"[^"]*\bh-8\b/g), f).toBe(0);
    }
    const c = doc("components/admin/nguon-hoa-hong/classes.ts");
    expect(dem(c, /export const NUT_NHO\s*=\s*"h-11 px-3 md:h-8"/g)).toBe(1);
  });
});

describe("[W4-L1b] nút ở chân hộp thoại / Sheet có vùng chạm (không để h-9 trần)", () => {
  // Hộp thoại/Sheet do W2–W3 dựng: footer dùng `cn(BTN_*, NUT_CHAN)` (h-11 sm:h-9). `className={BTN_OUTLINE}` trần = 36px ở 375px (ảnh chụp vòng 2).
  // Các hộp thoại CŨ chưa vá (nợ biết trước, KHÔNG thuộc đợt này): chinh-sach/_components/buoc-kich-hoat · ky/_components/hanh-dong-ky · so/_components/nut-doi-ky-sau.
  const DA_VA = [
    "components/admin/nguon-hoa-hong/hop-thoai-doi-nguon-page.tsx",
    "components/admin/nguon-hoa-hong/doi-trang-thai-nguon.tsx",
    "components/admin/nguon-hoa-hong/gan-nguon-sheet.tsx",
    "components/admin/nguon-hoa-hong/bo-sung-sale-sheet.tsx",
    "components/admin/nguon-hoa-hong/chup-lai-chu-nguon.tsx",
  ];
  it('hằng NUT_CHAN = "h-11 sm:h-9"; năm tệp không còn `className={BTN_OUTLINE|BTN_PRIMARY}` trần và đều dùng NUT_CHAN', () => {
    // Cấy: trả một nút footer về `className={BTN_PRIMARY}` ⇒ đỏ (tệp đó); đổi hằng thành "h-9" ⇒ đỏ (dòng hằng).
    const c = doc("components/admin/nguon-hoa-hong/classes.ts");
    expect(dem(c, /export const NUT_CHAN\s*=\s*"h-11 sm:h-9"/g)).toBe(1);
    for (const f of DA_VA) {
      const s = doc(f);
      expect(dem(s, /className=\{BTN_(?:OUTLINE|PRIMARY)\}/g), `${f}: nút trần`).toBe(0);
      expect(dem(s, /cn\(BTN_(?:OUTLINE|PRIMARY),\s*NUT_CHAN\)/g), `${f}: thiếu NUT_CHAN`).toBeGreaterThanOrEqual(1);
    }
  });
  it("[tự kiểm] bộ dò THẤY một nút trần", () => {
    expect(dem(boChuThich('<button className={BTN_PRIMARY}>x</button>'), /className=\{BTN_(?:OUTLINE|PRIMARY)\}/g)).toBe(1);
    expect(dem(boChuThich('<button className={cn(BTN_PRIMARY, NUT_CHAN)}>x</button>'), /className=\{BTN_(?:OUTLINE|PRIMARY)\}/g)).toBe(0);
  });
});

describe("[W4-L2] số ký tự tối thiểu từ hằng của lõi", () => {
  it("biểu mẫu + mục thông tin không gõ «10 ký tự»; biểu mẫu dùng cả hai hằng", () => {
    const form = doc("components/admin/nguon-hoa-hong/nguon-form.tsx");
    const muc = doc("components/admin/nguon-hoa-hong/chi-tiet-nguon/muc-thong-tin.tsx");
    expect(dem(form, /\b10 ký tự/g)).toBe(0);
    expect(dem(muc, /\b10 ký tự/g)).toBe(0);
    expect(dem(form, /\bDO_DAI_GIAI_TRINH_TOI_THIEU\b/g)).toBeGreaterThanOrEqual(2); // import + dùng
    expect(dem(form, /\bLY_DO_TOI_THIEU_NGUON\b/g)).toBeGreaterThanOrEqual(2);
    expect(dem(muc, /\bDO_DAI_GIAI_TRINH_TOI_THIEU\b/g)).toBeGreaterThanOrEqual(2);
  });
});

describe("[W4-L3] không nhánh chết «Quản lý nguồn chưa được bật»", () => {
  for (const f of ["app/(admin)/admin/nguon-hoa-hong/nguon/tao/page.tsx", "app/(admin)/admin/nguon-hoa-hong/nguon/[maNguon]/sua/page.tsx"]) {
    it(`${f}: gác cờ chỉ bằng vaoTab("nguon") (1 lần); không gọi laQuanLyNguonBat, không câu «chưa được bật»`, () => {
      const s = doc(f);
      expect(dem(s, /\bvaoTab\(\s*"nguon"\s*\)/g)).toBe(1);
      expect(dem(s, /\blaQuanLyNguonBat\b/g)).toBe(0);
      expect(dem(s, /chưa được bật/g)).toBe(0);
    });
  }
});

describe("[W4-L4] mã chết đã gỡ", () => {
  it("TabHoaHongKhung và ChuaCoNoiDung không còn tồn tại", () => {
    expect(existsSync(resolve(APP, "_lib/tab-hoa-hong.tsx"))).toBe(false);
    expect(dem(doc("components/admin/nguon-hoa-hong/khung-module.tsx"), /\bChuaCoNoiDung\b/g)).toBe(0);
  });
});

describe("[W4-L5] bộ lọc trạng thái nguồn", () => {
  it("nguon/page.tsx dựng chip từ DANH_SACH_TRANG_THAI_NGUON + nhanTrangThaiNguon; không còn danh sách gõ tay", () => {
    const s = doc("app/(admin)/admin/nguon-hoa-hong/nguon/page.tsx");
    expect(dem(s, /\bDANH_SACH_TRANG_THAI_NGUON\b/g)).toBeGreaterThanOrEqual(2);
    expect(dem(s, /gia:\s*"(?:DRAFT|ACTIVE|INACTIVE|ARCHIVED)"/g)).toBe(0);
  });
});

describe("[W4-L6] link composer gác theo cờ nguồn", () => {
  for (const f of ["app/(admin)/admin/nguon-hoa-hong/chinh-sach/moi/page.tsx", "app/(admin)/admin/nguon-hoa-hong/chinh-sach/[policyId]/soan/page.tsx"]) {
    it(`${f}: coQuyenQuanLyNguon = sources:manage ∧ scope.co.nguon`, () => {
      const s = doc(f);
      expect(dem(s, /coQuyenQuanLyNguon=\{scope\.has\("sources:manage"\) && scope\.co\.nguon\}/g)).toBe(1);
    });
  }
});
