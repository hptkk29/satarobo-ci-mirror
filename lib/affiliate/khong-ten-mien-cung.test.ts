// @vitest-environment node
/**
 * [AFF-WEB-10] — LƯỚI GHIM MÃ NGUỒN: đường affiliate KHÔNG còn quảng bá tên miền SataRobo cứng như một LINK giới thiệu (AFF-WEB, HARDCODED_DOMAIN = NO).
 *
 * Vì sao phải ghim bằng văn bản mã: tên miền cứng không làm test hành vi nào đỏ — nó chỉ làm QR phát từ test.satarobo.vn trỏ về prod, và nút «Link» đưa ra `satarobo.vn/?ref=…` cho mọi đối tác.
 * Quy tắc đo (luật 11 của docs/luat-doc-so-va-ket-luan.md): đọc mã ĐÃ BỎ CHÚ THÍCH (chú thích giải thích bản vá chứa đúng chuỗi đang cấm), neo hẹp, ĐẾM số lần khớp, KHÔNG cờ `/s`,
 * và lưới tự kiểm chính bộ bóc chú thích + bộ đếm (nếu bộ bóc sai thì "0 lần khớp" là vô nghĩa). Loại `*.test.*` — chúng dùng `"https://satarobo.vn"` làm dữ liệu mẫu hợp lệ.
 *
 *   [AFF-WEB-10a] tự kiểm: bộ bóc chú thích bỏ chú thích nhưng GIỮ chuỗi trong mã; bộ đếm thấy chuỗi cấm khi nó nằm trong mã
 *   [AFF-WEB-10b] đường affiliate không còn chuỗi «satarobo.vn/?ref=» và không còn `GOC_LINK_CONG_KHAI` / `linkRefMau` / `PUBLIC_ORIGIN` (đếm = 0)
 *   [AFF-WEB-10c] tên miền SataRobo KHÔNG xuất hiện ở bất kỳ tệp mã nào của đường affiliate (0 lần khớp) — gốc link ngắn chỉ đến từ AFFILIATE_PUBLIC_ORIGIN, không còn mặc định
 *   [AFF-WEB-10d] đối chứng dương: gốc link ngắn/QR đi qua `gocCongKhai(` ở mọi nơi dựng địa chỉ (đếm = 1 mỗi nơi) — gỡ hẳn link ngắn đi thì lưới 10b vẫn xanh, nên PHẢI có vế này
 *   [AFF-WEB-10e] danh sách link nhận gốc qua tham số bắt buộc `gocLinkNgan` (không tự đọc env) và dựng địa chỉ ngắn từ ĐÚNG tham số đó
 *   [AFF-WEB-10f] đường tự tạo link của đối tác không có đường ghi thứ hai: đúng MỘT lời gọi `phatLink(`, không `affiliateTrackingAsset.create/update/upsert`
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = process.cwd();

/**
 * Bỏ chú thích dòng TRƯỚC (chỉ khi hai gạch chéo đứng đầu dòng hoặc sau khoảng trắng — để không cắt `https:` + hai gạch chéo), rồi chú thích JSX (khối đặt trong cặp ngoặc nhọn), rồi khối mở ở ĐẦU DÒNG.
 * Cố ý KHÔNG bóc mọi khối giữa dòng: mẫu đường dẫn kiểu "/khoa-hoc/" + dấu sao chứa dấu mở khối trong chuỗi và sẽ nuốt mã ở giữa.
 */
function boChuThich(s: string): string {
  return s
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(^|\n)[ \t]*\/\*[\s\S]*?\*\//g, "$1");
}

function duyet(thuMuc: string, ra: string[]): void {
  for (const ten of readdirSync(thuMuc)) {
    const duong = join(thuMuc, ten);
    const st = statSync(duong);
    if (st.isDirectory()) {
      if (ten === "node_modules" || ten === ".next") continue;
      duyet(duong, ra);
    } else if (/\.(ts|tsx)$/.test(ten) && !/\.(test|spec)\.(ts|tsx)$/.test(ten)) {
      ra.push(duong);
    }
  }
}

/** Mọi tệp mã (không test) của đường affiliate: lõi, giao diện admin, màn cũ, cổng đối tác, hai đường công khai. */
function tepDuongAffiliate(): string[] {
  const ra: string[] = [];
  for (const d of [
    "lib/affiliate",
    "components/admin/nguon-hoa-hong",
    "app/(admin)/admin/nguon-hoa-hong",
    "app/(admin)/admin/affiliates",
    "app/(portal)/portal/gioi-thieu",
    "app/(public)/r",
    "app/api/public/affiliate",
  ]) {
    duyet(resolve(GOC, d), ra);
  }
  for (const f of ["gioi-thieu-page.tsx", "tao-link-cua-toi.tsx", "nut-qr-link-cua-toi.tsx", "nut-sao-chep-link.tsx"]) ra.push(resolve(GOC, "components/portal", f));
  return ra;
}

const doc = (duong: string) => boChuThich(readFileSync(resolve(GOC, duong), "utf8"));
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;
const rel = (p: string) => relative(GOC, p).replace(/\\/g, "/");

const RE_REF = /satarobo\.vn\/\?ref=/g;
// Ranh giới từ ở hai đầu: biến cấu hình hợp lệ AFFILIATE_PUBLIC_ORIGIN KHÔNG bị đếm nhầm là tên cũ PUBLIC_ORIGIN.
const RE_TEN_CU = /GOC_LINK_CONG_KHAI|linkRefMau|\bPUBLIC_ORIGIN\b/g;
const RE_TEN_MIEN = /satarobo\.vn/g;

describe("[AFF-WEB-10a] tự kiểm bộ bóc chú thích và bộ đếm", () => {
  it("chuỗi cấm trong CHÚ THÍCH không được đếm; trong MÃ thì được đếm (lưới không mù cũng không báo oan)", () => {
    const mau = [
      "// satarobo.vn/?ref=ABC trong chú thích dòng",
      "/* GOC_LINK_CONG_KHAI trong chú thích khối */",
      "const j = <p>{/* linkRefMau trong chú thích JSX */}</p>;",
      'const k = "/khoa-hoc/*"; const z = "https://x.test/y";',
      "const a = 1; // linkRefMau cuối dòng",
      'const b = "https://x.test/?a=1";',
    ].join("\n");
    const sach = boChuThich(mau);
    expect(dem(sach, RE_REF)).toBe(0);
    expect(dem(sach, RE_TEN_CU)).toBe(0);
    expect(sach).toContain('"https://x.test/?a=1"'); // `//` trong chuỗi URL KHÔNG bị coi là chú thích
    expect(sach).toContain('"/khoa-hoc/*"'); // mẫu đường dẫn có dấu mở khối KHÔNG bị coi là mở chú thích khối
    expect(sach).toContain('"https://x.test/y"'); // …và mã SAU nó còn nguyên

    const trongMa = 'const l = `${GOC_LINK_CONG_KHAI}/?ref=${ma}`; const m = "https://satarobo.vn/?ref=X"; linkRefMau(ma); PUBLIC_ORIGIN;';
    expect(dem(boChuThich(trongMa), RE_REF)).toBe(1);
    expect(dem(boChuThich(trongMa), RE_TEN_CU)).toBe(3);
  });

  it("quét thấy đủ tệp của đường affiliate (nếu thư mục đổi tên, lưới không được xanh vì quét ra rỗng)", () => {
    const tep = tepDuongAffiliate().map(rel);
    expect(tep.length).toBeGreaterThan(60);
    for (const can of ["lib/affiliate/doc-link.ts", "lib/affiliate/theo-doi-cong-khai.ts", "components/admin/nguon-hoa-hong/affiliate/sao-chep-link.tsx", "app/(admin)/admin/affiliates/_components/affiliate-manager.tsx"]) {
      expect(tep, can).toContain(can);
    }
  });
});

describe("[AFF-WEB-10b] không còn link ?ref= cứng tên miền, không còn tên cũ", () => {
  it("0 lần khớp `satarobo.vn/?ref=` và 0 lần khớp GOC_LINK_CONG_KHAI · linkRefMau · PUBLIC_ORIGIN trong MỌI tệp mã của đường affiliate", () => {
    const vi_pham: string[] = [];
    for (const t of tepDuongAffiliate()) {
      const s = boChuThich(readFileSync(t, "utf8"));
      const n = dem(s, RE_REF) + dem(s, RE_TEN_CU);
      if (n > 0) vi_pham.push(`${rel(t)} (${n})`);
    }
    expect(vi_pham).toEqual([]);
  });
});

describe("[AFF-WEB-10c] không còn tên miền SataRobo nào trong mã affiliate", () => {
  it("0 lần khớp `satarobo.vn` trong MỌI tệp mã (đã bóc chú thích), kể cả `goc-cong-khai.ts` — không còn mặc định production", () => {
    const theoTep = new Map<string, number>();
    for (const t of tepDuongAffiliate()) {
      const n = dem(boChuThich(readFileSync(t, "utf8")), RE_TEN_MIEN);
      if (n > 0) theoTep.set(rel(t), n);
    }
    expect([...theoTep.entries()]).toEqual([]);
  });
  it("gốc link ngắn đọc ĐÚNG biến AFFILIATE_PUBLIC_ORIGIN và không đọc biến nào khác (NEXT_PUBLIC_APP_URL · VERCEL_ENV)", () => {
    const s = doc("lib/affiliate/goc-cong-khai.ts");
    expect(dem(s, /"AFFILIATE_PUBLIC_ORIGIN"/g)).toBe(1);
    expect(dem(s, /NEXT_PUBLIC_APP_URL|VERCEL_ENV|VERCEL_TARGET_ENV|process\.env/g)).toBe(0);
  });
});

describe("[AFF-WEB-10d] đối chứng dương: gốc link ngắn/QR do cấu hình quyết ở mọi nơi dựng địa chỉ", () => {
  it.each([
    ["lib/affiliate/theo-doi-cong-khai.ts", "trang chủ dự phòng của /r"],
    ["lib/affiliate/doc-cua-toi.ts", "gốc đưa vào danh sách link của cổng đối tác"],
    ["app/(admin)/admin/nguon-hoa-hong/link/page.tsx", "gốc đưa vào danh sách link của Admin"],
    ["app/(admin)/admin/nguon-hoa-hong/link/_actions.ts", "gốc dựng QR của Admin"],
    ["app/(portal)/portal/gioi-thieu/_actions.ts", "gốc dựng QR của cổng đối tác"],
  ])("%s gọi `gocCongKhai(process.env)` đúng 1 lần (%s)", (duong) => {
    expect(dem(doc(duong), /gocCongKhai\(\s*process\.env\s*\)/g)).toBe(1);
  });
});

describe("[AFF-WEB-10e] danh sách link: gốc là THAM SỐ bắt buộc, không tự đọc env", () => {
  it("`LocLink.gocLinkNgan` khai không `?`; `docDanhSachLink` dựng địa chỉ ngắn từ `loc.gocLinkNgan`; không đọc process.env", () => {
    const s = doc("lib/affiliate/doc-link.ts");
    expect(dem(s, /^\s*gocLinkNgan:\s*string\s*\|\s*null;/gm)).toBe(1); // bắt buộc (không `gocLinkNgan?:`)
    expect(dem(s, /dungUrlChuyenHuong\(\s*loc\.gocLinkNgan\s*,/g)).toBe(1);
    expect(dem(s, /process\.env/g)).toBe(0);
  });
});

describe("[AFF-WEB-10f] tự tạo link của đối tác: MỘT đường ghi", () => {
  it("`tu-tao-link.ts` gọi `phatLink(` đúng 1 lần và không ghi trực tiếp vào bảng link", () => {
    const s = doc("lib/affiliate/tu-tao-link.ts");
    expect(dem(s, /\bphatLink\(/g)).toBe(1);
    expect(dem(s, /affiliateTrackingAsset\.(create|update|upsert|createMany|updateMany)\b/g)).toBe(0);
  });
  it("lược đồ đầu vào `.strict()` (client không nhét được partyId / type / khoá lạ)", () => {
    const s = doc("lib/affiliate/tu-tao-link.ts");
    expect(dem(s, /\.strict\(\)/g)).toBe(1);
    expect(dem(s, /\bpartyId\s*:\s*idChuoi/g)).toBe(0);
  });
});
