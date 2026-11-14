// @vitest-environment node
/**
 * [GDT-W*] · [AFW-*] — LƯỚI GHIM MÃ NGUỒN cho dây nối của tab Affiliate (đối tác · loại · nhãn).
 *
 * Những thứ test hành vi KHÔNG chạm tới (page là Server Component kéo next-auth + Prisma; `isActive` ghi ở hai chỗ khác nhau của một tệp) nên ghim bằng văn bản mã nguồn ĐÃ BỎ CHÚ THÍCH.
 * Luật 11: neo hẹp, ĐẾM SỐ LẦN khớp, không cờ `/s`. Luật 14: mỗi ca đã được CẤY lại lỗi để thấy nó đỏ (bảng cấy trong báo cáo của đợt).
 *
 *   [GDT-W1]  `isActive` ≡ (status = ACTIVE): MỌI chỗ ghi `status` của đối tác đi qua `...cotTrangThai(` (tạo + đổi trạng thái); `suaDoiTac` KHÔNG ghi `status`/`isActive`
 *   [GDT-W2]  `cotTrangThai` trả đúng cặp cho cả 5 trạng thái (hành vi, không chỉ văn bản)
 *   [GDT-W3]  hàm ghi: khoá hàng `FOR UPDATE` + so `getTime()` (KHÔNG `updateMany where updatedAt`); `writeAudit({ tx` cùng giao dịch ở mọi hàm ghi; không có xoá cứng; ghi nhận `createdById`
 *   [GDT-W4]  mọi cổng `throw LoiGhiAffiliate` nằm TRƯỚC `tx.affiliate.create/update` đầu tiên của hàm (luật rollback: `return` KHÔNG rollback)
 *   [AFW-01]  page: quyền ghi vẽ bằng `scope.has("affiliates:manage")` ĐÚNG MỘT lần và đi vào PII bằng BIẾN (`coTheXemLienHe: coTheGhi`), không hằng
 *   [AFW-02]  page: mọi nút tạo (Sheet) nằm sau `coTheGhi`; bảng nhận `coTheGhi` bằng biến
 *   [AFW-03]  page: số lead đếm qua `docDanhSachDoiTac(actor, …)` (scopedDb) — page không tự `db`; ba chế độ đều kẹp `?trang=` (kepTrang + redirect) và đều đọc pill qua `docSoHangChoTheoTab`
 *   [AFW-04]  không tệp nào của tab import `@/lib/db` trần; component client không import mã máy chủ (ghi-*.ts không đuôi `-dau-vao`)
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { cotTrangThai } from "@/lib/affiliate/ghi-doi-tac";
import { TRANG_THAI_DOI_TAC } from "@/lib/affiliate/ghi-doi-tac-dau-vao";

const GOC = process.cwd();

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

/** Văn bản `{ … }` cân ngoặc, bắt đầu từ dấu `{` ĐẦU TIÊN sau `marker` (chịu được `{}` lồng nhau). */
function khoiSau(src: string, marker: string, tu = 0): string {
  const i = src.indexOf(marker, tu);
  if (i < 0) throw new Error(`không thấy «${marker}»`);
  const mo = src.indexOf("{", i + marker.length - 1);
  let sau = 0;
  for (let j = mo; j < src.length; j++) {
    if (src[j] === "{") sau++;
    else if (src[j] === "}" && --sau === 0) return src.slice(mo, j + 1);
  }
  throw new Error(`khối sau «${marker}» không đóng`);
}

function duyet(dir: string, ra: string[] = []): string[] {
  if (!existsSync(dir)) return ra;
  for (const ten of readdirSync(dir)) {
    const p = join(dir, ten);
    if (statSync(p).isDirectory()) duyet(p, ra);
    else if (/\.(ts|tsx)$/.test(ten) && !/\.(test|spec)\./.test(ten)) ra.push(p);
  }
  return ra;
}

const GHI_DOI_TAC = doc("lib/affiliate/ghi-doi-tac.ts");
const GHI_LOAI_NHAN = doc("lib/affiliate/ghi-loai-nhan.ts");

/** Thân MỘT hàm ghi: từ dấu `{` mở của thân hàm (sau `): Promise<…> {`), KHÔNG phải dấu `{` trong kiểu trả về. */
function thanHam(src: string, ten: string): string {
  const bat = src.indexOf(`export async function ${ten}(`);
  if (bat < 0) throw new Error(`không thấy ${ten}`);
  // kết thúc danh sách tham số = dấu `)` cân ngoặc; thân hàm là `{` đầu tiên SAU `Promise<…>` (kiểu có thể chứa `{}` nên đếm cả `<>`)
  let i = src.indexOf("(", bat);
  let sau = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") sau++;
    else if (src[i] === ")" && --sau === 0) break;
  }
  let j = src.indexOf("Promise<", i);
  let goc = 0;
  for (; j < src.length; j++) {
    if (src[j] === "<") goc++;
    else if (src[j] === ">" && src[j - 1] !== "=" && --goc === 0) break;
  }
  const mo = src.indexOf("{", j);
  let dem2 = 0;
  for (let k = mo; k < src.length; k++) {
    if (src[k] === "{") dem2++;
    else if (src[k] === "}" && --dem2 === 0) return src.slice(mo, k + 1);
  }
  throw new Error(`thân ${ten} không đóng`);
}

/** Phần trong `db.$transaction(async (tx) => { … })` của một hàm ghi — nơi luật rollback có hiệu lực. */
function thanGiaoDich(src: string, ten: string): string {
  const than = thanHam(src, ten);
  return khoiSau(than, "db.$transaction(async (tx) =>");
}

describe("[GDT-W1] isActive ≡ (status = ACTIVE) — một hàm ghi cả hai cột", () => {
  it("`...cotTrangThai(` đúng 2 lần (tạo + đổi trạng thái); không có chỗ nào khác gán `isActive:` ngoài định nghĩa của hàm", () => {
    expect(dem(GHI_DOI_TAC, /\.\.\.cotTrangThai\(/g)).toBe(2);
    // `isActive: <gì đó không phải true>` = một phép GÁN (selects dùng `isActive: true`). Duy nhất trong thân `cotTrangThai`.
    const gan = [...GHI_DOI_TAC.matchAll(/\bisActive:\s*([^,}\n]+)/g)].map((m) => m[1]!.trim()).filter((v) => v !== "true" && v !== "boolean");
    expect(gan).toEqual(["laDangHoatDong(trangThai)"]);
  });

  it("dữ liệu `tx.affiliate.create` và `tx.affiliate.update` của đổi trạng thái dùng cotTrangThai; của `suaDoiTac` KHÔNG chạm status/isActive", () => {
    const tao = khoiSau(thanHam(GHI_DOI_TAC, "taoDoiTac"), "tx.affiliate.create(");
    expect(tao).toContain("...cotTrangThai(");
    const doi = khoiSau(thanHam(GHI_DOI_TAC, "doiTrangThaiDoiTac"), "tx.affiliate.update(");
    expect(doi).toContain("...cotTrangThai(");
    const sua = khoiSau(thanHam(GHI_DOI_TAC, "suaDoiTac"), "tx.affiliate.update(");
    expect(dem(sua, /\bstatus\b/g), "suaDoiTac không được ghi status").toBe(0);
    expect(dem(sua, /\bisActive\b/g), "suaDoiTac không được ghi isActive").toBe(0);
  });

  it("không đâu trong tab ghi `isActive`/`status` của đối tác bằng đường khác (updateMany · SQL thô)", () => {
    for (const f of ["lib/affiliate/ghi-doi-tac.ts", "lib/affiliate/doc-doi-tac.ts"]) {
      const s = doc(f);
      expect(dem(s, /affiliate\.updateMany\(/g), f).toBe(0);
      expect(dem(s, /\$executeRaw`[^`]*"Affiliate"[^`]*SET/g), f).toBe(0);
    }
  });
});

describe("[GDT-W2] cotTrangThai — cả năm trạng thái", () => {
  it("isActive đúng với ACTIVE và sai với MỌI trạng thái còn lại; status giữ nguyên", () => {
    for (const t of TRANG_THAI_DOI_TAC) expect(cotTrangThai(t), t).toEqual({ status: t, isActive: t === "ACTIVE" });
  });
});

describe("[GDT-W3] hàm ghi: khoá lạc quan, audit cùng giao dịch, không xoá cứng", () => {
  it("khoá hàng FOR UPDATE; so `getTime()`; KHÔNG dùng `updateMany({ where: { updatedAt` (micro- vs mili-giây ⇒ điều kiện không bao giờ khớp)", () => {
    expect(dem(GHI_DOI_TAC, /FOR UPDATE/g)).toBe(1); // MỘT hàm khoaHang dùng chung
    expect(dem(GHI_DOI_TAC, /await khoaHang\(tx,/g)).toBe(2); // suaDoiTac + doiTrangThaiDoiTac
    expect(dem(GHI_DOI_TAC, /updatedAt\.getTime\(\)\s*!==\s*p\.updatedAtDaThay\.getTime\(\)/g)).toBe(2);
    expect(dem(GHI_LOAI_NHAN, /FOR UPDATE/g)).toBe(4); // sửa + bật/tắt × loại + nhãn
    expect(dem(GHI_LOAI_NHAN, /updatedAt\.getTime\(\)\s*!==\s*p\.updatedAtDaThay\.getTime\(\)/g)).toBe(4);
    for (const s of [GHI_DOI_TAC, GHI_LOAI_NHAN]) expect(dem(s, /updateMany\(\{[^}]*updatedAt/g)).toBe(0);
  });

  it("`writeAudit({ tx` ở MỌI hàm ghi (3 + 6) — nhật ký cùng giao dịch với phép ghi", () => {
    expect(dem(GHI_DOI_TAC, /await writeAudit\(\{\s*tx,/g)).toBe(3);
    expect(dem(GHI_LOAI_NHAN, /await writeAudit\(\{\s*tx,/g)).toBe(6);
    expect(dem(GHI_DOI_TAC, /await writeAudit\(\{(?!\s*tx,)/g)).toBe(0);
  });

  it("không có xoá cứng: 0 `.delete(` / `.deleteMany(` ở hàm ghi đối tác — ngoại lệ DUY NHẤT là gỡ dòng nối nhãn (AffiliatePartyTag) khi bỏ nhãn", () => {
    expect(dem(GHI_DOI_TAC, /\.delete\(/g)).toBe(0);
    const xoa = [...GHI_DOI_TAC.matchAll(/\bdeleteMany:/g)];
    expect(xoa).toHaveLength(1); // nằm TRONG nested `tags: { deleteMany: … }` của update đối tác
    expect(GHI_DOI_TAC.slice(Math.max(0, xoa[0]!.index! - 120), xoa[0]!.index!)).toContain("tags:");
    expect(dem(GHI_LOAI_NHAN, /\.delete(Many)?\(/g)).toBe(0);
  });

  it("tạo ghi `createdById` = người ghi; duyệt ghi `approvedById`/`approvedAt` = người + `now` (không đồng hồ ẩn)", () => {
    expect(dem(GHI_DOI_TAC, /createdById:\s*p\.nguoi\.userId/g)).toBe(1);
    expect(dem(GHI_DOI_TAC, /approvedById:\s*p\.nguoi\.userId,\s*approvedAt:\s*p\.now/g)).toBe(1);
    expect(dem(GHI_DOI_TAC, /new Date\(/g), "hàm ghi không tự đọc đồng hồ").toBe(0);
  });
});

describe("[GDT-W4] cổng đứng TRƯỚC phép ghi (luật rollback)", () => {
  const CAC_HAM: [string, string, string][] = [
    ["lib/affiliate/ghi-doi-tac.ts", "taoDoiTac", "tx.affiliate.create("],
    ["lib/affiliate/ghi-doi-tac.ts", "suaDoiTac", "tx.affiliate.update("],
    ["lib/affiliate/ghi-doi-tac.ts", "doiTrangThaiDoiTac", "tx.affiliate.update("],
    ["lib/affiliate/ghi-loai-nhan.ts", "taoLoai", "tx.affiliateType.create("],
    ["lib/affiliate/ghi-loai-nhan.ts", "suaLoai", "tx.affiliateType.update("],
    ["lib/affiliate/ghi-loai-nhan.ts", "batTatLoai", "tx.affiliateType.update("],
    ["lib/affiliate/ghi-loai-nhan.ts", "taoNhan", "tx.affiliateTag.create("],
    ["lib/affiliate/ghi-loai-nhan.ts", "suaNhan", "tx.affiliateTag.update("],
    ["lib/affiliate/ghi-loai-nhan.ts", "batTatNhan", "tx.affiliateTag.update("],
  ];
  for (const [tep, ham, ghi] of CAC_HAM) {
    it(`${ham}: mọi \`throw\` đứng trước ${ghi.replace("(", "")} đầu tiên, và KHÔNG có \`return { ok: false\` trong giao dịch`, () => {
      const than = thanGiaoDich(doc(tep), ham);
      const iGhi = than.indexOf(ghi);
      expect(iGhi, `không thấy ${ghi}`).toBeGreaterThan(0);
      const sau = than.slice(iGhi);
      // sau phép ghi đầu tiên chỉ còn audit + return dữ liệu: không còn `throw new LoiGhiAffiliate` (từ chối SAU khi đã ghi = commit rồi mới báo lỗi)
      expect(dem(sau, /throw new LoiGhiAffiliate/g), "từ chối SAU phép ghi").toBe(0);
      expect(dem(than, /return\s*\{\s*ok:\s*false/g), "return từ chối trong giao dịch không rollback").toBe(0);
      const truoc = than.slice(0, iGhi);
      expect(dem(truoc, /throw new LoiGhiAffiliate|throw khongTimThay|throw vuaDoi|await kiem[A-Z]\w*\(/g), "phải có ít nhất một cổng trước phép ghi").toBeGreaterThan(0);
    });
  }
});

// ═══ page ═══════════════════════════════════════════════════════════════════════════════════════════
const PAGE = doc("app/(admin)/admin/nguon-hoa-hong/affiliate/page.tsx");

describe("[AFW-01] quyền ghi + PII đi bằng BIẾN", () => {
  it("`scope.has(\"affiliates:manage\")` đúng 1 lần (một nguồn cho mọi nút ghi — đúng khoá mà action kiểm)", () => {
    expect(dem(PAGE, /scope\.has\(\s*"affiliates:manage"\s*\)/g)).toBe(1);
    // AFF-WEB: thêm ĐÚNG MỘT câu hỏi quyền nữa — `affiliate_links:manage`, cho nút «Link» (URL cuối mang token). Không được có câu hỏi quyền thứ ba rải trong trang.
    expect(dem(PAGE, /scope\.has\(\s*"affiliate_links:manage"\s*\)/g)).toBe(1);
    expect(dem(PAGE, /scope\.has\(/g)).toBe(2);
  });
  it("người xem đi vào đọc PII bằng `coTheXemLienHe: coTheGhi` (biến), không `true`/hằng", () => {
    expect(dem(PAGE, /coTheXemLienHe:\s*coTheGhi\b/g)).toBe(1);
    expect(dem(PAGE, /coTheXemLienHe[:=]\s*\{?\s*true\b/g)).toBe(0);
    expect(dem(PAGE, /<BoLocDoiTac[^>]*coTheXemLienHe=\{coTheGhi\}/g)).toBe(1);
  });
});

describe("[AFW-02] nút tạo và bảng", () => {
  it("cả ba Sheet tạo (Đối tác · Loại · Nhãn) chỉ được dựng khi `coTheGhi`", () => {
    for (const [the, mau] of [
      ["DoiTacSheet", /coTheGhi\s*&&\s*tuyChon\s*\?\s*\(\s*<DoiTacSheet\b/g],
      ["LoaiSheet", /coTheGhi\s*\?\s*\(\s*<LoaiSheet\b/g],
      ["NhanSheet", /coTheGhi\s*\?\s*\(\s*<NhanSheet\b/g],
    ] as const) {
      expect(dem(PAGE, new RegExp(`<${the}\\b`, "g")), `số <${the}`).toBe(1);
      expect(dem(PAGE, mau), `<${the} sau coTheGhi`).toBe(1);
    }
  });
  it("ba bảng nhận `coTheGhi={coTheGhi}` bằng biến, không hằng", () => {
    expect(dem(PAGE, /coTheGhi=\{coTheGhi\}/g)).toBe(3);
    expect(dem(PAGE, /coTheGhi=\{\s*(true|false)\s*\}/g)).toBe(0);
  });
});

describe("[AFW-03] đọc qua hàm có scope; kẹp trang; pill", () => {
  it("số lead đến từ `docDanhSachDoiTac(actor, …)` đúng 1 lần; page không import db / scopedDb", () => {
    expect(dem(PAGE, /docDanhSachDoiTac\(\s*actor\s*,/g)).toBe(1);
    expect(dem(PAGE, /from\s+["']@\/lib\/db(-scope)?["']/g)).toBe(0);
  });
  it("ba chế độ đều kẹp `?trang=` (kepTrang) và redirect về trang cuối đúng 3 lần; pill của tab đi qua docSoHangChoTheoTab đúng 3 lần (mỗi chế độ một)", () => {
    expect(dem(PAGE, /\bkepTrang\(/g)).toBe(3);
    expect(dem(PAGE, /redirect\(hrefVoi\(BASE,/g)).toBe(3);
    expect(dem(PAGE, /\bdocSoHangChoTheoTab\(/g)).toBe(3);
  });
  it("bộ lọc đối tác được CHUẨN HOÁ qua bảng trước khi vào truy vấn (trạng thái ∈ TRANG_THAI_DOI_TAC); từ khoá bị cắt 60 ký tự", () => {
    expect(dem(PAGE, /TRANG_THAI_DOI_TAC\.find\(\(t\) => t === motGiaTri\(sp\.trangthai\)\)/g)).toBe(1);
    expect(dem(PAGE, /motGiaTri\(sp\.q\)\?\.slice\(0, 60\)/g)).toBe(1);
  });
});

describe("[AFW-04] ranh giới mã", () => {
  const TEP = [
    ...duyet(resolve(GOC, "app/(admin)/admin/nguon-hoa-hong/affiliate")),
    ...duyet(resolve(GOC, "components/admin/nguon-hoa-hong/affiliate")),
  ];
  it("quét được cây (không rỗng)", () => {
    expect(TEP.length).toBeGreaterThan(10);
  });
  it("không tệp nào import `@/lib/db` trần (ESLint cổng DB đã đóng — đi qua hàm trong lib/**)", () => {
    for (const f of TEP) expect(dem(boChuThich(readFileSync(f, "utf8")), /from\s+["']@\/lib\/db["']/g), relative(GOC, f)).toBe(0);
  });
  it("component CLIENT chỉ import ghi-*-dau-vao (thuần), KHÔNG import hàm ghi (kéo Prisma vào gói trình duyệt)", () => {
    for (const f of TEP.filter((x) => x.includes(join("components", "admin")))) {
      const s = boChuThich(readFileSync(f, "utf8"));
      if (!/^\s*"use client"/.test(readFileSync(f, "utf8"))) continue;
      const vi = [...s.matchAll(/^import\s+(?!type\b)[^;]*from\s+["']@\/lib\/affiliate\/(ghi-[\w-]+|doc-doi-tac)["']/gm)].map((m) => m[1]);
      for (const t of vi) expect(t, `${relative(GOC, f)} import runtime từ ${t}`).toMatch(/-dau-vao$/);
    }
  });
});
