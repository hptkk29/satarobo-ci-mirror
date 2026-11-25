/**
 * [NHH-FE-03] · [NHH-FE-W1..W4] — LƯỚI GHIM MÃ NGUỒN cho dây nối của khung module (docs/source-commission 05 §5.4).
 *
 * Cổng mà test hành vi KHÔNG chạm tới (page là Server Component kéo next-auth + Prisma, không dựng được trong
 * vitest) nên ghim bằng văn bản mã nguồn ĐÃ BỎ CHÚ THÍCH. Luật 11: neo hẹp, ĐẾM SỐ LẦN khớp, không cờ `/s`, và
 * luật 14: mỗi ca đã được CẤY lại lỗi để thấy nó đỏ (ghi trong báo cáo của đợt).
 *
 *   [NHH-FE-03]  mỗi route của module có `loading.tsx` (+ `error.tsx` ở gốc segment)
 *   [NHH-FE-W1]  page của tab X gọi `vaoTab("X")` ĐÚNG MỘT lần và gác bằng `PAGE_GATES["/nguon-hoa-hong/X"]` —
 *                chép nhầm tab (Sổ gọi `vaoTab("nguon")`) là gác sai CỜ mà không lỗi nào báo
 *   [NHH-FE-W2]  `vaoTab` 404 theo CỜ của tab (`coCuaTab`), ĐỨNG TRƯỚC mọi câu hỏi quyền; không `redirect` thay `notFound`
 *   [NHH-FE-W3]  route gốc chọn tab bằng `chonTabGoc`, KHÔNG chuyển cứng (`redirect("/nguon-hoa-hong/ky")`)
 *   [NHH-FE-W4]  số hàng chờ một nguồn cho pill/công tắc/route gốc: không page nào tự gọi `docHangChoNguon` để đếm
 *   [NHH-FE-W5]  mọi tab hoa hồng đọc TRẦN từ setting, không viết hằng 0.09/9% trong UI của module
 *   [NHH-FE-W6]  hàng chờ rỗng không nói dối khi đang lọc theo MỘT lý do
 *   (W7–W10 — layout/cách ly/PII/cổng quyền từng page/404 — nằm ở `khung-day-noi.test.ts` cùng thư mục)
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TAB_HREF, TAB_KEYS } from "@/lib/nguon-hoa-hong/tab";

const GOC = process.cwd();
const APP = resolve(GOC, "app/(admin)/admin/nguon-hoa-hong");

/** Bỏ chú thích dòng TRƯỚC, khối SAU (chú thích dòng hay nhắc `lib/x/*` — chuỗi `/*` đó mở một "khối" giả nuốt mã thật). */
function boChuThich(s: string): string {
  return s
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}
const doc = (duong: string) => boChuThich(readFileSync(resolve(GOC, duong), "utf8"));
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

function duyet(dir: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(dir)) {
    const p = join(dir, ten);
    if (statSync(p).isDirectory()) duyet(p, ra);
    else if (/\.(ts|tsx)$/.test(ten) && !/\.(test|spec)\./.test(ten)) ra.push(p);
  }
  return ra;
}

const THU_MUC_TAB = TAB_KEYS.map((k) => ({ k, dir: TAB_HREF[k].replace("/nguon-hoa-hong/", "") }));

describe("[NHH-FE-03] mỗi route có loading.tsx; gốc segment có error.tsx", () => {
  it("lưới quét được cây (không rỗng)", () => {
    expect(duyet(APP).length).toBeGreaterThan(10);
  });

  it("năm tab + chi tiết nguồn đều có loading.tsx", () => {
    for (const { dir } of THU_MUC_TAB) {
      expect(existsSync(join(APP, dir, "loading.tsx")), `thiếu ${dir}/loading.tsx`).toBe(true);
      expect(existsSync(join(APP, dir, "page.tsx")), `thiếu ${dir}/page.tsx`).toBe(true);
    }
    expect(existsSync(join(APP, "nguon", "[maNguon]", "loading.tsx"))).toBe(true);
    expect(existsSync(join(APP, "nguon", "[maNguon]", "page.tsx"))).toBe(true);
  });

  it("error.tsx ở gốc segment (một ranh giới phủ cả module)", () => {
    expect(existsSync(join(APP, "error.tsx"))).toBe(true);
  });
});

describe("[NHH-FE-W1] page của tab X vào cổng bằng đúng tab X và gác đúng PAGE_GATES", () => {
  for (const { k, dir } of THU_MUC_TAB) {
    it(`tab "${k}": vaoTab("${k}") đúng 1 lần, PAGE_GATES["${TAB_HREF[k]}"] đúng 1 lần, không vaoTab tab khác`, () => {
      const src = doc(relative(GOC, join(APP, dir, "page.tsx")));
      expect(dem(src, new RegExp(`\\bvaoTab\\(\\s*"${k}"\\s*\\)`, "g")), `vaoTab("${k}")`).toBe(1);
      expect(dem(src, /\bvaoTab\(/g), "tổng số lời gọi vaoTab").toBe(1);
      expect(dem(src, new RegExp(`PAGE_GATES\\[\\s*"${TAB_HREF[k]}"\\s*\\]`, "g")), "gate của chính tab").toBe(1);
      // Không gác bằng gate của route khác (chép nhầm).
      const khac = [...src.matchAll(/PAGE_GATES\[\s*"([^"]+)"\s*\]/g)].map((m) => m[1]).filter((h) => h !== TAB_HREF[k]);
      expect(khac, "gate của route khác trong page này").toEqual([]);
    });
  }

  it("chi tiết nguồn đi cổng của tab Nguồn (cùng cờ, cùng quyền)", () => {
    const src = doc("app/(admin)/admin/nguon-hoa-hong/nguon/[maNguon]/page.tsx");
    expect(dem(src, /\bvaoTab\(\s*"nguon"\s*\)/g)).toBe(1);
    expect(dem(src, /PAGE_GATES\[\s*"\/nguon-hoa-hong\/nguon"\s*\]/g)).toBe(1);
  });
});

describe("[NHH-FE-W2] vaoTab: cờ tắt ⇒ 404, đứng TRƯỚC quyền", () => {
  const src = doc("app/(admin)/admin/nguon-hoa-hong/_lib/vao-tab.ts");

  it("404 theo cờ CỦA TAB (coCuaTab), dùng notFound() — không redirect, không trang trống", () => {
    expect(dem(src, /\bnotFound\(\)/g)).toBe(1);
    expect(dem(src, /!\s*scope\.co\[\s*coCuaTab\(\s*tab\s*\)\s*\]/g)).toBe(1);
    // nhánh cờ tắt không được là một `redirect`
    const nhanh = /if\s*\(\s*!\s*scope\.co\[[^\]]+\]\s*\)\s*([^;]+);/.exec(src);
    expect(nhanh?.[1]?.trim()).toBe("notFound()");
  });

  it("vaoTab KHÔNG tự hỏi quyền (page hỏi bằng PAGE_GATES) — hai chỗ hỏi là hai nguồn", () => {
    expect(dem(src, /\bscope\.(any|has)\(/g)).toBe(0);
    expect(dem(src, /checkPermission|checkAnyPermission|assertCan/g)).toBe(0);
  });
});

describe("[NHH-FE-W3] route gốc chọn tab bằng chonTabGoc, không chuyển cứng", () => {
  const src = doc("app/(admin)/admin/nguon-hoa-hong/page.tsx");

  it("dùng chonTabGoc đúng 1 lần và đích là TAB_HREF[dich]", () => {
    expect(dem(src, /\bchonTabGoc\(/g)).toBe(1);
    expect(dem(src, /redirect\(\s*TAB_HREF\[\s*dich\s*\]\s*\)/g)).toBe(1);
  });

  it("không có redirect tới chuỗi tab literal (chuyển cứng sang tab Kỳ là link chết lúc pilot nguồn)", () => {
    expect(dem(src, /redirect\(\s*["'`]\/nguon-hoa-hong\//g)).toBe(0);
  });

  it("tập rỗng ⇒ notFound() (không phải trang trống): có đủ hai chỗ 404 — gác HỢP key và không có ứng viên", () => {
    expect(dem(src, /\bnotFound\(\)/g)).toBe(2);
    expect(dem(src, /PAGE_GATES\[\s*"\/nguon-hoa-hong"\s*\]/g)).toBe(1);
  });
});

describe("[NHH-FE-W4] một nguồn cho số hàng chờ", () => {
  it("page KHÔNG đếm hàng chờ bằng độ dài mảng đã đọc (`ds.dong.length`) — số đi qua demHangChoNguon, một lời gọi", () => {
    for (const f of duyet(APP)) {
      const src = boChuThich(readFileSync(f, "utf8"));
      expect(dem(src, /\bds\.dong\.length\b/g), relative(GOC, f)).toBe(0);
    }
    const nguon = doc("app/(admin)/admin/nguon-hoa-hong/nguon/page.tsx");
    expect(dem(nguon, /\bdemHangChoNguon\(/g)).toBe(1);
    // số đó là thứ in ở công tắc (cả BA chế độ: cần xử lý · tất cả · Page mapping) — không ai tự tính số khác.
    // Neo vào quan hệ, không neo vào con số: thêm chế độ thứ tư mà quên truyền `canXuLy` là đỏ, thêm đủ thì không phải sửa test.
    const soCongTac = dem(nguon, /<QueueToggle\b/g);
    expect(soCongTac).toBeGreaterThanOrEqual(3);
    expect(dem(nguon, /soCanXuLy=\{canXuLy\}/g)).toBe(soCongTac);
  });

  it("route gốc và pill đi qua docSoHangChoTheoTab (cùng hàm)", () => {
    expect(dem(doc("app/(admin)/admin/nguon-hoa-hong/page.tsx"), /\bdocSoHangChoTheoTab\(/g)).toBe(1);
    expect(dem(doc("app/(admin)/admin/nguon-hoa-hong/nguon/page.tsx"), /\bdocSoHangChoTheoTab\(/g)).toBe(1);
  });
});

describe("[NHH-FE-W5] trần hoa hồng đọc từ setting, không hằng cứng trong UI", () => {
  it("không có hằng 0.09 / 0.08 / '9%' trong UI của module (components + app)", () => {
    const tep = [
      ...duyet(APP),
      ...duyet(resolve(GOC, "components/admin/nguon-hoa-hong")).filter((f) => !/\.test\./.test(f)),
    ];
    expect(tep.length).toBeGreaterThan(15);
    for (const f of tep) {
      const src = boChuThich(readFileSync(f, "utf8"));
      expect(dem(src, /\b0[.,]0[89]\b|["'`]\s*9\s*%/g), relative(GOC, f)).toBe(0);
    }
  });
});

describe("[NHH-FE-W6] hàng chờ rỗng không nói dối khi đang lọc theo MỘT lý do", () => {
  const src = doc("app/(admin)/admin/nguon-hoa-hong/nguon/page.tsx");

  it("câu 'đều đã đủ căn cứ nguồn' xuất hiện đúng 1 lần và CHỈ trong nhánh không lọc lý do", () => {
    expect(dem(src, /đều đã đủ căn cứ nguồn/g)).toBe(1);
    // nhánh có lọc lý do (lyDo ? …) đứng TRƯỚC câu đó và dùng câu riêng
    const iLoc = src.indexOf("lyDo ? (");
    const iCau = src.indexOf("đều đã đủ căn cứ nguồn");
    expect(iLoc).toBeGreaterThan(0);
    expect(iCau).toBeGreaterThan(iLoc);
    expect(dem(src, /không lead nào đang vướng vấn đề này/g)).toBe(1);
  });
});
