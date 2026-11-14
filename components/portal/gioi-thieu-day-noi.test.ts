/**
 * [AFR-PW1..PW6] — LƯỚI GHIM MÃ NGUỒN cho DÂY NỐI của trang `/portal/gioi-thieu` (AFF-P3 H3).
 *
 * Page / layout kéo next-auth + Prisma nên không dựng được trong vitest thuần; HÀNH VI của hàm đọc (cô lập đối tác, không PII, cờ) được kiểm trên Postgres thật
 * (`tests/hoa-hong/affiliate-portal.spec.ts`). Lưới này canh những thứ ca hành vi KHÔNG phân biệt được:
 *   · prop `coGioiThieu` có BẮT BUỘC và có được truyền ở CẢ HAI shell không (luật 11 — prop cờ mặc định `false` mà không ai truyền = mục menu biến mất, không lỗi nào báo, test nào cũng xanh);
 *   · định danh của người xem đến từ PHIÊN, không từ URL/form; mọi truy vấn neo vào tập `Affiliate` của người đó.
 * Mã ĐÃ BỎ CHÚ THÍCH (luật 11), neo hẹp, ĐẾM số lần khớp.
 *
 *   [AFR-PW1] layout: tính `coGioiThieu` ở cả hai nhánh và truyền cho cả `PortalV2Shell` lẫn `PortalNav`
 *   [AFR-PW2] cả hai shell: prop BẮT BUỘC (không `?`, không mặc định) và có lọc theo nó
 *   [AFR-PW3] sidebar v2: href literal đúng một lần (lưới `v2-nav-day-du` quét literal)
 *   [AFR-PW4] page: PARENT-only, danh tính từ phiên, KHÔNG đọc params/searchParams, null ⇒ notFound
 *   [AFR-PW5] hàm đọc: một điểm vào duy nhất theo `userId`; mọi truy vấn khác neo `IN ids`; không scopedDb/portalDb; không trường PII
 *   [AFR-PW6] menu và trang dùng CÙNG một phép «cờ ∧ là đối tác», kiểm cờ trước khi chạm DB
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

const layout = doc("app/(portal)/portal/layout.tsx");
const nav = doc("app/(portal)/portal/_components/portal-nav.tsx");
const shell = doc("components/portal/v2-shell.tsx");
const page = doc("app/(portal)/portal/gioi-thieu/page.tsx");
const docCuaToi = doc("lib/affiliate/doc-cua-toi.ts");

describe("[AFR-PW1..PW3] menu", () => {
  it("[AFR-PW1] layout tính cờ ở CẢ HAI nhánh và truyền cho CẢ HAI shell", () => {
    expect(dem(layout, /coGioiThieuChoNguoiDung\(session\.user\.id\)\.catch\(\(\) => false\)/g)).toBe(2);
    expect(dem(layout, /coGioiThieu=\{coGioiThieu\}/g)).toBe(1); // nhánh v1 (PortalNav nằm trong nhánh có con)
    // nhánh v2 vẽ sidebar CẢ khi chưa có con (thân bị thay bằng thông báo) ⇒ mục chỉ hiện khi có con
    expect(dem(layout, /coGioiThieu=\{coGioiThieu && children_\.length > 0\}/g)).toBe(1);
    expect(dem(layout, /<PortalV2Shell\b[\s\S]*?coGioiThieu=\{coGioiThieu && children_\.length > 0\}[\s\S]*?>/g)).toBeGreaterThanOrEqual(1);
    expect(dem(layout, /<PortalNav\b[\s\S]*?coGioiThieu=\{coGioiThieu\}[\s\S]*?\/>/g)).toBeGreaterThanOrEqual(1);
  });

  it("[AFR-PW2] prop BẮT BUỘC ở cả hai shell (không `?`, không mặc định) và có LỌC theo nó", () => {
    for (const [ten, src] of [["portal-nav", nav], ["v2-shell", shell]] as const) {
      expect(dem(src, /\bcoGioiThieu: boolean;/g), `${ten}: kiểu bắt buộc`).toBe(1);
      expect(dem(src, /\bcoGioiThieu\?:/g), `${ten}: không tuỳ chọn`).toBe(0);
      expect(dem(src, /\bcoGioiThieu\s*=\s*(false|true)/g), `${ten}: không mặc định`).toBe(0);
    }
    expect(dem(nav, /\(it\.flag === "gioi-thieu" && coGioiThieu\)/g)).toBe(1);
    expect(dem(shell, /\.\.\.\(coGioiThieu \? \[parentNavGioiThieu\] : \[\]\)/g)).toBe(1);
  });

  it("[AFR-PW3] sidebar v2 khai href literal `/portal/gioi-thieu` đúng một lần; v1 cũng đúng một lần", () => {
    expect(dem(shell, /href: "\/portal\/gioi-thieu"/g)).toBe(1);
    expect(dem(nav, /href: "\/portal\/gioi-thieu"/g)).toBe(1);
  });
});

describe("[AFR-PW4] page", () => {
  it("PARENT-only; danh tính từ PHIÊN; không đọc params / searchParams; null ⇒ notFound", () => {
    expect(dem(page, /session\.user\.role !== "PARENT"/g)).toBe(1);
    expect(dem(page, /docGioiThieuCuaToi\(session\.user\.id, new Date\(\)\)/g)).toBe(1);
    expect(dem(page, /\b(searchParams|params)\b/g)).toBe(0);
    expect(dem(page, /if \(data === null\) notFound\(\);/g)).toBe(1);
    expect(dem(page, /@\/lib\/db\b/g)).toBe(0); // cổng DB: không import trần ở app/(portal)
  });
});

describe("[AFR-PW5..PW7] hàm đọc", () => {
  it("[AFR-PW5] MỘT điểm vào theo userId (`partyIdsVaoDuoc`, bảng nối L3a); mọi truy vấn khác neo `IN ids`; không scopedDb / portalDb; không chọn trường PII", () => {
    // L3a: điểm vào KHÔNG còn là `db.affiliate.findMany({ where: { userId } })` — nó đi qua hàm dùng chung đọc bảng nối (và đường lùi legacy có kiểm tra). Đọc cột `Affiliate.userId` tại chỗ là
    // hoàn tác tạm ngừng / gỡ liên kết (cột legacy vẫn còn giá trị).
    expect(dem(docCuaToi, /\bpartyIdsVaoDuoc\(userId\)/g)).toBe(2); // menu + trang — cùng một câu hỏi
    expect(dem(docCuaToi, /\baffiliate\.(findMany|count|findFirst|findUnique)\(\{\s*where:\s*\{\s*userId\b/g)).toBe(0);
    expect(dem(docCuaToi, /\buserId:\s*\{?\s*(?:equals|in)\b/g)).toBe(0);
    expect(dem(docCuaToi, /where: \{ id: \{ in: ids \} \}/g)).toBe(1); // hồ sơ đối tác — neo `IN ids`
    expect(dem(docCuaToi, /partyId: \{ in: ids \}/g)).toBe(5); // lượt bấm · đếm TỔNG referral (R10 · D1: không còn tách theo mốc che kết quả) · đếm đã đăng ký · referral gần đây · thành viên (đối tác × campaign)
    expect(dem(docCuaToi, /beneficiaryAffiliateId: \{ in: ids \}/g)).toBe(1); // câu ĐẾM cặp (đối tác × campaign) — chưa lấy số tiền
    // không có truy vấn nào neo vào một partyId KHÁC (tham số ngoài)
    // chỉ xét điều kiện LỌC (`where: { … partyId: … }`); `partyId: string` của kiểu / `partyId: true` của select không phải điều kiện
    expect(dem(docCuaToi, /where: \{[^}]*\bpartyId: (?!\{ in: ids \})/g)).toBe(0);
    expect(dem(docCuaToi, /\b(scopedDb|portalDb)\b/g)).toBe(0);
    expect(dem(docCuaToi, /\b(phone|email|parentName|fullName|sourceSnapshot|evidence|resolutionReason)\b/g)).toBe(0);
    // chữ ký: chỉ nhận userId + đồng hồ — không có chỗ để hỏi dữ liệu của người khác
    expect(dem(docCuaToi, /export async function docGioiThieuCuaToi\(userId: string, now: Date\)/g)).toBe(1);
    // không rò lead/đơn/học viên của dòng sổ
    expect(dem(docCuaToi, /\b(orderId|studentId|paymentId)\b/g)).toBe(0);
  });

  it("[AFR-PW6] menu và trang cùng phép «cờ ∧ là đối tác»; cờ kiểm TRƯỚC khi chạm DB", () => {
    const menu = docCuaToi.slice(docCuaToi.indexOf("export async function coGioiThieuChoNguoiDung"), docCuaToi.indexOf("type Cap ="));
    expect(menu.indexOf("affiliateBat()")).toBeGreaterThan(-1);
    expect(menu.indexOf("affiliateBat()")).toBeLessThan(menu.indexOf("partyIdsVaoDuoc("));
    const trang = docCuaToi.slice(docCuaToi.indexOf("export async function docGioiThieuCuaToi"));
    expect(trang.indexOf("affiliateBat()")).toBeGreaterThan(-1);
    expect(trang.indexOf("affiliateBat()")).toBeLessThan(trang.indexOf("partyIdsVaoDuoc("));
    expect(dem(docCuaToi, /hopCoAffiliate\(\{ nguon, affiliate \}\)/g)).toBe(1);
  });

  it("[AFR-PW7] SỐ TIỀN: quyết định theo cấu hình TRƯỚC, truy vấn tiền CHỈ cho cặp được phép — không cộng rồi giấu", () => {
    // đúng MỘT chỗ phân giải (`quyenXemTien`) và nó chạy trên từng cặp (đối tác × campaign)
    expect(dem(docCuaToi, /\bquyenXemTien\(/g)).toBe(1);
    // ba truy vấn sổ: đếm cặp (không lấy số tiền) + tổng + dòng gần đây — hai truy vấn SAU dùng `where` dựng từ cặp được phép
    expect(dem(docCuaToi, /\bdb\.commissionTransaction\./g)).toBe(3);
    expect(dem(docCuaToi, /OR: duocXem\.map\(\(c\) => \(\{ beneficiaryAffiliateId: c\.partyId, affiliateCampaignId: c\.campaignId \}\)\)/g)).toBe(1);
    // không cặp nào được phép ⇒ không truy vấn tiền, và `hoaHong` là null khi không cần hiện
    expect(dem(docCuaToi, /if \(duocXem\.length === 0\) return hoaHongRong\(\);/g)).toBe(1);
    expect(dem(docCuaToi, /const hoaHong = hienKhoiTien \? await docHoaHong\(xemTien\.duocXem\) : null;/g)).toBe(1);
    // cột tiền chỉ được chọn (`amount`) trong hàm docHoaHong, SAU cổng — không ở câu đếm cặp
    const cap = docCuaToi.slice(docCuaToi.indexOf("async function quyetDinhXemTien"), docCuaToi.indexOf("const hoaHongRong"));
    expect(dem(cap, /\bamount\b/g)).toBe(0);
  });
});
