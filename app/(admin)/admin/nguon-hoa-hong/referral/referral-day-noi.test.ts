// @vitest-environment node
/**
 * [RFW-*] — LƯỚI GHIM MÃ NGUỒN cho dây nối của tab Referral (AFF-P1). Page là Server Component (kéo next-auth + Prisma) nên phần "đi qua đúng cổng" không dựng được trong vitest thuần;
 * `tests/hoa-hong/affiliate-referral.spec.ts` ([RFD-DB-10/11]) chạy page THẬT trên Postgres — lưới này canh phần mà ca đó có thể đi vòng (đổi tên biến, gọi `db` trần ở một câu mới).
 * Cùng khuôn `khung-day-noi.test.ts`: đọc mã ĐÃ BỎ CHÚ THÍCH, neo hẹp, ĐẾM SỐ LẦN khớp, không cờ `/s`. Mỗi ca đã được CẤY lại lỗi để thấy đỏ.
 *
 *   [RFW-01] page danh sách: quyền mở phiếu hỏi ĐÚNG hai khoá của trang lead, đi vào hàm đọc bằng BIẾN; hai chiều với trang lead
 *   [RFW-02] `doc-referral.ts`: MỌI lượt đọc `affiliateReferral` đi qua scopedDb; không `db.affiliateReferral` trần; không chọn quan hệ lead / evidence / SĐT / email
 *   [RFW-03] số hàng chờ của pill: cổng `affiliate_referrals:manage`, đếm VỚI actor
 *   [RFW-04] trang chi tiết: id hỏng ⇒ 404, không có/ngoài tầm ⇒ 404, hàm đọc nhận id đã giải mã + biến quyền
 *   [RFW-05] XỬ LÝ TAY (AFF-L3b): chỉ `_actions.ts` là "use server"; page vẫn thuần; panel / nút khai tay chỉ dưới đúng khoá `affiliate_referrals:manage`; không còn câu «chỉ đọc»
 *   [RFW-06] chi tiết có loading.tsx; hai page đều dùng đúng cổng của tab Referral
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

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

const THU_MUC = "app/(admin)/admin/nguon-hoa-hong/referral";
const PAGE = `${THU_MUC}/page.tsx`;
const CHI_TIET = `${THU_MUC}/[id]/page.tsx`;
const DOC = "lib/affiliate/doc-referral.ts";

function duyet(dir: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(dir)) {
    const p = join(dir, ten);
    if (statSync(p).isDirectory()) duyet(p, ra);
    else if (/\.(ts|tsx)$/.test(ten) && !/\.(test|spec)\./.test(ten)) ra.push(p);
  }
  return ra;
}

describe("[RFW-01] quyền mở phiếu khách", () => {
  const src = doc(PAGE);

  it("hỏi bằng ĐÚNG hai khoá của trang `/leads/[id]` (một lần) và đi vào hàm đọc bằng BIẾN `coTheMoLead` — không hằng", () => {
    expect(dem(src, /\bcheckAnyPermission\(\s*\[\s*"leads:view-all"\s*,\s*"leads:view-own"\s*\]\s*\)/g)).toBe(1);
    expect(dem(src, /\bconst coTheMoLead = await checkAnyPermission\(/g)).toBe(1);
    expect(dem(src, /\bdocDanhSachReferral\(\s*actor\s*,\s*\{[^}]*\bcoTheMoLead\b[^}]*\}\s*\)/g)).toBe(1);
    expect(dem(src, /\bcoTheMoLead\s*(:|=)\s*(true|false)\b/g)).toBe(0);
  });

  it("trang chi tiết cũng hỏi đúng hai khoá và truyền biến", () => {
    const ct = doc(CHI_TIET);
    expect(dem(ct, /\bcheckAnyPermission\(\s*\[\s*"leads:view-all"\s*,\s*"leads:view-own"\s*\]\s*\)/g)).toBe(1);
    expect(dem(ct, /\bdocChiTietReferral\(\s*actor\s*,\s*id\s*,\s*\{\s*coTheMoLead\s*\}\s*\)/g)).toBe(1);
  });

  it("hai chiều: trang chi tiết lead VẪN gác bằng hai khoá đó (đổi cổng ở đó mà quên ở đây ⇒ liên kết hứa suông)", () => {
    const lead = doc("app/(admin)/admin/leads/[id]/page.tsx");
    expect(dem(lead, /\bcheckPermission\(\s*"leads:view-all"\s*\)/g)).toBe(1);
    expect(dem(lead, /\bcheckPermission\(\s*"leads:view-own"\s*\)/g)).toBe(1);
  });

  it("liên kết phiếu dựng từ `/leads/` + id, KHÔNG `/admin/leads` (host admin đã là gốc)", () => {
    const bang = doc(`${THU_MUC}/_components/bang-referral.tsx`);
    expect(dem(bang, /href=\{`\/leads\/\$\{encodeURIComponent\(phieu\.leadId\)\}`\}/g)).toBe(1);
    expect(dem(bang, /\/admin\/leads/g)).toBe(0);
  });
});

describe("[RFW-02] doc-referral.ts: cách ly và PII", () => {
  const src = doc(DOC);

  it("MỌI lượt đọc model đi qua scopedDb — không có `db.affiliateReferral` trần, và mỗi `.affiliateReferral.` đứng sau `sdb.` hoặc `scopedDb(actor).`", () => {
    const tatCa = dem(src, /\.affiliateReferral\./g);
    expect(tatCa, "số lượt đọc model (danh sách: count + findMany; chip: groupBy; hàng chờ: count; chi tiết: findUnique)").toBe(5);
    expect(dem(src, /\bdb\.affiliateReferral\b/g)).toBe(0);
    expect(dem(src, /\b(sdb|scopedDb\(actor\))\.affiliateReferral\./g)).toBe(tatCa);
  });

  it("phiếu khách mở được đọc qua scopedDb.lead; không `db.lead` trần", () => {
    expect(dem(src, /\bscopedDb\(actor\)\.lead\.findMany\(/g)).toBe(1);
    expect(dem(src, /\bdb\.lead\b/g)).toBe(0);
  });

  it("câu `select` KHÔNG chạm quan hệ lead, evidence, SĐT, email, tên phụ huynh/bé", () => {
    for (const cam of [/\blead\s*:\s*\{/, /\bevidence\b/, /\bphone\b/, /\bemail\b/, /\bparentName\b/, /\bchildName\b/, /\bpublicToken\b/]) {
      expect(dem(src, new RegExp(cam.source, "g")), String(cam)).toBe(0);
    }
  });

  it("`sourceSnapshot` chỉ ra khỏi hàm đọc qua `docSnapshotReferral` (không chuyển Json thô)", () => {
    // 3 lần nhắc = 1 khai trong SELECT_DONG + 2 lần đi qua hàm narrow; bớt 1 lời gọi hàm (hoặc thêm 1 chỗ dùng thô) là lệch.
    expect(dem(src, /\bsourceSnapshot\b/g)).toBe(3);
    expect(dem(src, /\bdocSnapshotReferral\(\s*h\.sourceSnapshot\s*\)/g)).toBe(2); // danh sách (dongTuHang) + chi tiết
  });
});

describe("[RFW-03] số hàng chờ của pill", () => {
  const src = doc("lib/nguon-hoa-hong/hang-cho.ts");

  it("đếm VỚI actor của người xem, chỉ khi thấy tab ∧ có `affiliate_referrals:manage`", () => {
    expect(dem(src, /\bscope\.tabMoDuoc\("referral"\)\s*&&\s*scope\.has\("affiliate_referrals:manage"\)\s*\?\s*demReferralCanXemTay\(actor\)\s*:\s*Promise\.resolve\(null\)/g)).toBe(1);
    expect(dem(src, /\bdemReferralCanXemTay\(/g)).toBe(1);
  });
});

describe("[RFW-04] trang chi tiết", () => {
  const src = doc(CHI_TIET);

  it("id giải mã bằng `giaiMaTrenUrl` (không `decodeURIComponent` trần); hỏng ⇒ notFound; không có / ngoài tầm cơ sở ⇒ notFound", () => {
    expect(dem(src, /\bdecodeURIComponent\(/g)).toBe(0);
    expect(dem(src, /\bgiaiMaTrenUrl\(\s*idTho\s*\)/g)).toBe(1);
    expect(dem(src, /if\s*\(\s*id\s*===\s*null\s*\|\|\s*!ID_RE\.test\(id\)\s*\)\s*notFound\(\);/g)).toBe(1);
    expect(dem(src, /if\s*\(\s*!r\s*\)\s*notFound\(\);/g)).toBe(1);
  });

  it("hàm đọc nhận actor ĐÃ scope và quyền bằng biến", () => {
    expect(dem(src, /\bdocChiTietReferral\(\s*actor\s*,\s*id\s*,\s*\{\s*coTheMoLead\s*\}\s*\)/g)).toBe(1);
  });
});

describe("[RFW-05] xử lý tay: nút chỉ ở đúng nơi, đúng quyền, và không còn câu «chỉ đọc» sai sự thật (AFF-L3b)", () => {
  const tep = duyet(resolve(GOC, THU_MUC));

  it("quét được cả thư mục (page, chi tiết, bảng, _actions)", () => {
    expect(tep.length).toBeGreaterThanOrEqual(5);
  });

  it("thư mục route CHỈ có MỘT tệp \"use server\" (_actions.ts); page / chi tiết / bảng vẫn là Server Component thuần: không form, nút, onClick, useTransition", () => {
    const duocGhi = tep.filter((f) => /["']use server["']/.test(boChuThich(readFileSync(f, "utf8"))));
    expect(duocGhi.map((f) => f.slice(GOC.length + 1).replace(/\\/g, "/"))).toEqual([`${THU_MUC}/_actions.ts`]);
    for (const f of tep) {
      const src = boChuThich(readFileSync(f, "utf8"));
      for (const cam of [/<form\b/, /<button\b/, /\bonClick\b/, /\bonSubmit\b/, /\buseTransition\b/]) {
        expect(dem(src, new RegExp(cam.source, "g")), `${f.slice(GOC.length + 1)} · ${cam}`).toBe(0);
      }
    }
    expect(dem(doc("lib/affiliate/doc-referral.ts"), /\.(create|update|updateMany|delete|deleteMany|upsert)\(/g)).toBe(0);
  });

  it("câu «Màn chỉ đọc» ĐÃ GỠ ở cả hai page — còn nghĩa là nói chỉ đọc trong khi có nút", () => {
    expect(dem(readFileSync(resolve(GOC, PAGE), "utf8"), /Màn chỉ đọc/gi)).toBe(0);
    expect(dem(readFileSync(resolve(GOC, CHI_TIET), "utf8"), /Màn chỉ đọc/gi)).toBe(0);
  });

  it("trang chi tiết: panel xử lý vẽ DƯỚI đúng khoá của action (scope.has) — một lần, một panel; nhật ký đọc qua hàm riêng", () => {
    const ct = doc(CHI_TIET);
    expect(dem(ct, /\bconst coQuyenXuLy = scope\.has\(\s*"affiliate_referrals:manage"\s*\)/g)).toBe(1);
    expect(dem(ct, /\{coQuyenXuLy && \(/g)).toBe(1);
    expect(dem(ct, /<XuLyReferralPanel\b/g)).toBe(1);
    expect(dem(ct, /\bcoQuyen=\{coQuyenXuLy\}/g)).toBe(1);
    expect(dem(ct, /\bdocLichSuReferral\(\s*actor\s*,\s*id\s*\)/g)).toBe(1);
    expect(dem(ct, /<LichSuXuLy\b/g)).toBe(1);
  });

  it("trang danh sách: nút khai tay và danh sách lựa chọn của nó CHỈ khi có `affiliate_referrals:manage`", () => {
    const ds = doc(PAGE);
    expect(dem(ds, /\bconst coQuyenXuLy = scope\.has\(\s*"affiliate_referrals:manage"\s*\)/g)).toBe(1);
    expect(dem(ds, /coQuyenXuLy \? docLuaChonKhaiTay\(\) : Promise\.resolve\(\[\]\)/g)).toBe(1);
    expect(dem(ds, /actions=\{coQuyenXuLy \? <KhaiTaySheet luaChon=\{luaChon\} \/> : undefined\}/g)).toBe(1);
    expect(dem(ds, /<KhaiTaySheet\b/g)).toBe(1);
  });
});

describe("[RFW-06] loading và cổng", () => {
  it("chi tiết có loading.tsx", () => {
    expect(existsSync(resolve(GOC, THU_MUC, "[id]", "loading.tsx"))).toBe(true);
  });

  it("trang chi tiết đi cổng của tab Referral: vaoTab đúng 1 lần, PAGE_GATES của tab đúng 1 lần và khối ThieuQuyen nguyên vẹn, không điều kiện bị vô hiệu", () => {
    const src = doc(CHI_TIET);
    expect(dem(src, /\bvaoTab\(\s*"referral"\s*\)/g)).toBe(1);
    expect(dem(src, /\bvaoTab\(/g)).toBe(1);
    expect(dem(src, /PAGE_GATES\[\s*"\/nguon-hoa-hong\/referral"\s*\]/g)).toBe(1);
    expect(dem(src, /if\s*\(\s*!\s*scope\.any\(\s*PAGE_GATES\[\s*"\/nguon-hoa-hong\/referral"\s*\]\s*\)\s*\)\s*\{\s*return\s*<ThieuQuyen\s+tab="referral"/g)).toBe(1);
    expect(dem(src, /\bfalse\s*&&|\|\|\s*true\b/g)).toBe(0);
    // cổng thứ hai (campaign) CHỈ để quyết liên kết sang campaign, không phải cổng vào trang
    expect(dem(src, /\bscope\.any\(\s*PAGE_GATES\[\s*"\/nguon-hoa-hong\/campaign"\s*\]\s*\)/g)).toBe(1);
  });
});
