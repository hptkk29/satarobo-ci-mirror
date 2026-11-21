/**
 * [AFR-W7..W10] — LƯỚI GHIM MÃ NGUỒN cho DÂY NỐI của khối «Hiệu quả» ở trang chi tiết campaign (AFF-P3 H1).
 *
 * Page kéo next-auth + Prisma nên không dựng được trong vitest thuần; HÀNH VI của hàm đọc được kiểm trên Postgres thật (`tests/hoa-hong/affiliate-bao-cao.spec.ts`). Lưới này canh những thứ ca hành vi KHÔNG
 * phân biệt được: khoá quyền mà page truyền cho hàm đọc có ĐÚNG là khoá của tab tương ứng không (luật 12), khối có chen thêm một bậc `await` tuần tự không, và hàm đọc có giữ cổng cách ly / không-PII không.
 * Mã ĐÃ BỎ CHÚ THÍCH (luật 11), neo hẹp, ĐẾM số lần khớp.
 *
 *   [AFR-W7]  quyền của khối đi qua MỘT hàm `quyenBaoCaoTuScope` (page không tự rải `scope.has` / PAGE_GATES của tab khác); hàm ấy dùng khoá tab Link · tab Referral · xem sổ cơ sở ∧ engine bật
 *   [AFR-W8]  khối đọc nằm TRONG lượt `Promise.all` thứ hai (cùng `docMembership`) — trang vẫn đúng HAI `await Promise.all`, không thêm bậc tuần tự
 *   [AFR-W9]  hàm đọc: referral CHỈ qua `scopedDb`; không bao giờ chọn trường PII; lượt bấm lọc theo campaign
 *   [AFR-W10] liên kết Sổ chỉ khi người xem mở được tab Sổ; thành phần hiển thị không chạm DB
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function boChuThich(s: string): string {
  return s
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}
const doc = (duong: string) => boChuThich(readFileSync(resolve(process.cwd(), duong), "utf8"));
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

const page = doc("app/(admin)/admin/nguon-hoa-hong/campaign/[maCampaign]/page.tsx");
const docBc = doc("lib/affiliate/doc-bao-cao.ts");
const khoi = doc("components/admin/nguon-hoa-hong/campaign/khoi-hieu-qua.tsx");

describe("[AFR-W7..W8] page", () => {
  it("[AFR-W7] page lấy quyền của khối từ MỘT hàm; hàm đó dùng đúng khoá của tab sở hữu dữ liệu", () => {
    expect(dem(page, /const quyenBaoCao = quyenBaoCaoTuScope\(scope\);/g)).toBe(1);
    expect(dem(page, /quyen: quyenBaoCao/g)).toBe(1);
    expect(dem(page, /PAGE_GATES\[/g)).toBe(1); // chỉ gate của CHÍNH tab campaign (lưới [AFC-W1])
    const q = doc("lib/affiliate/quyen-bao-cao.ts");
    expect(dem(q, /luotBam: scope\.any\(PAGE_GATES\["\/nguon-hoa-hong\/link"\]\)/g)).toBe(1);
    expect(dem(q, /referral: scope\.any\(PAGE_GATES\["\/nguon-hoa-hong\/referral"\]\)/g)).toBe(1);
    expect(dem(q, /hoaHong: scope\.has\("commission:view-center"\) && scope\.co\.engine/g)).toBe(1);
  });

  it("[AFR-W8] `docBaoCaoHieuQua` gọi ĐÚNG MỘT lần, trong lượt Promise.all cùng `docMembership`; trang vẫn BA `await Promise.all` (như trước AFF-P3)", () => {
    expect(dem(page, /docBaoCaoHieuQua\(/g)).toBe(1);
    expect(dem(page, /await Promise\.all\(/g)).toBe(3);
    const luot2 = page.slice(page.indexOf("const [thanhVien, doiTac, xemTruoc, hieuQua,"));
    expect(luot2.indexOf("docBaoCaoHieuQua(")).toBeGreaterThan(luot2.indexOf("docMembership("));
    expect(luot2.indexOf("docBaoCaoHieuQua(")).toBeLessThan(luot2.indexOf("]);"));
    // khoảng ngày giải bằng hàm thuần với đồng hồ truyền vào (luật 19)
    expect(dem(page, /giaiKhoangNgay\(\{ tu: motGiaTri\(sp\.tu\), den: motGiaTri\(sp\.den\), now \}\)/g)).toBe(1);
  });
});

describe("[AFR-W9] hàm đọc", () => {
  it("referral CHỈ qua scopedDb (2 câu), không `db.affiliateReferral`; lượt bấm lọc theo campaign + khoảng; không chọn trường PII", () => {
    expect(dem(docBc, /sdb\.affiliateReferral\.groupBy\(/g)).toBe(2);
    expect(dem(docBc, /\bdb\.affiliateReferral\b/g)).toBe(0);
    expect(dem(docBc, /const sdb = scopedDb\(actor\)/g)).toBe(1);
    expect(dem(docBc, /db\.referralClick\.groupBy\(\{ by: \["partyId", "outcome"\], where: \{ campaignId, occurredAt: khungGio \}/g)).toBe(1);
    // PII: không bao giờ nhắc tới cột tên/SĐT/email khách hay quan hệ lead ngoài bộ lọc đếm
    expect(dem(docBc, /\b(phone|email|parentName|fullName|sourceSnapshot|evidence|publicToken)\b/g)).toBe(0);
    expect(dem(docBc, /select: \{ id: true, name: true, code: true \}/g)).toBe(1);
  });

  it("mỗi khối chỉ truy vấn khi có khoá của nó (cổng nằm TRONG hàm đọc, không chỉ ở giao diện)", () => {
    expect(dem(docBc, /quyen\.luotBam\s*\?/g)).toBeGreaterThanOrEqual(2);
    expect(dem(docBc, /quyen\.referral\s*\?/g)).toBe(2); // câu referral theo (đối tác × trạng thái) và câu «đã đăng ký»
    expect(dem(docBc, /if \(quyen\.hoaHong\) \{/g)).toBe(1);
    expect(dem(docBc, /if \(!\(e instanceof PermissionError\)\) throw e;/g)).toBe(1);
  });

  it("tiền đi qua CHÍNH hàm lõi của màn Sổ (cùng `dungWhereSo`), lọc theo mã campaign", () => {
    expect(dem(docBc, /gomSoTheoTrangThaiChi\(db, actor, \{ campaignMa \}\)/g)).toBe(1);
    expect(dem(docBc, /gomSoTheoDoiTacHuong\(db, actor, \{ campaignMa \}\)/g)).toBe(1);
  });
});

describe("[AFR-W10] giao diện", () => {
  it("liên kết Sổ chỉ khi mở được tab Sổ và mang đúng camp; thành phần hiển thị không import DB, không await", () => {
    expect(dem(page, /hrefSo=\{scope\.tabMoDuoc\("so"\) \? hrefVoi\(TAB_HREF\.so, \{ xem: "tat-ca", camp: campaign\.code \}\) : null\}/g)).toBe(1);
    expect(dem(khoi, /@\/lib\/db\b/g)).toBe(0);
    expect(dem(khoi, /\bawait\b/g)).toBe(0);
    expect(dem(khoi, /dangerouslySetInnerHTML/g)).toBe(0);
  });
});
