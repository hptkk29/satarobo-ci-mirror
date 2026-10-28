/**
 * [AFR-W1..W6] — LƯỚI GHIM MÃ NGUỒN cho DÂY NỐI của bộ lọc campaign Affiliate ở tab Sổ và tab Kỳ (AFF-P3 H2).
 *
 * Page kéo next-auth + Prisma nên không dựng được trong vitest thuần; HÀNH VI của hàm đọc được kiểm trên Postgres thật (`tests/hoa-hong/affiliate-bao-cao.spec.ts`). Lưới này canh thứ mà ca hành vi
 * KHÔNG phân biệt được — page có NỐI bộ lọc vào hàm đọc không: một bộ lọc vẽ ra mà không truyền xuống truy vấn là ô chọn nói dối (luật 12), không lỗi biên dịch, không ca nào đỏ.
 * Neo vào BIỂU THỨC, đếm SỐ LẦN khớp, trên mã ĐÃ BỎ CHÚ THÍCH (luật 11 — chú thích giải thích bản vá chứa đúng chuỗi đang tìm).
 *
 *   [AFR-W1] Sổ: `camp` đọc bằng regex HẸP của mã danh mục và đi vào `boLoc.campaignMa`; `dt` chỉ khi có quyền hàng chờ
 *   [AFR-W2] Sổ: `camp`/`dt` có trong `giuLoc` (đổi cơ sở / chuyển trang không làm rơi bộ lọc)
 *   [AFR-W3] Sổ: `lua` (danh sách lựa chọn) đến từ `docLuaChonBoLocSo` — không có phép tra campaign riêng của trang
 *   [AFR-W4] Kỳ: `camp` qua regex hẹp, đi vào `docPhanCampaignTheoKy`, và `DaiSo`/`HanhDongKy` KHÔNG nhận số đã lọc
 *   [AFR-W5] Kỳ: mọi liên kết chuyển kỳ / cơ sở / trang mang `camp`
 *   [AFR-W6] hàm lọc theo campaign ở lõi sổ chỉ dựng ở MỘT nơi (`dungWhereSo`), và `docSoHoaHong` dùng nó
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

const so = doc("app/(admin)/admin/nguon-hoa-hong/so/page.tsx");
const ky = doc("app/(admin)/admin/nguon-hoa-hong/ky/page.tsx");
const docSo = doc("lib/hoa-hong/doc-so.ts");

describe("[AFR-W1..W3] tab Sổ", () => {
  it("[AFR-W1] `camp` qua MA_DANH_MUC_RE → `campaignMa`; `dt` chỉ khi có hàng chờ rồi mới → `doiTacHuongId`", () => {
    expect(dem(so, /camp: mot\(sp\.camp, MA_DANH_MUC_RE\) \?\? ""/g)).toBe(1);
    expect(dem(so, /\.\.\.\(gia\.camp \? \{ campaignMa: gia\.camp \} : \{\}\)/g)).toBe(1);
    expect(dem(so, /dt: coHangCho \? \(mot\(sp\.dt, MA_HOP_LE\) \?\? ""\) : ""/g)).toBe(1);
    expect(dem(so, /\.\.\.\(gia\.dt \? \{ doiTacHuongId: gia\.dt \} : \{\}\)/g)).toBe(1);
  });

  it("[AFR-W2] bộ lọc sống sót khi đổi cơ sở / chuyển trang: `giuLoc` mang `camp` và `dt`", () => {
    expect(dem(so, /const giuLoc = \{[^}]*camp: gia\.camp, dt: gia\.dt[^}]*\}/g)).toBe(1);
    // và `coLoc` được suy từ MỌI giá trị của `gia` (thêm hai khoá không làm "Bỏ lọc" biến mất)
    expect(dem(so, /const coLoc = Object\.values\(gia\)\.some\(\(v\) => v !== ""\)/g)).toBe(1);
  });

  it("[AFR-W3] danh sách lựa chọn đến từ MỘT nguồn `docLuaChonBoLocSo` (kèm cờ Affiliate); trang không tự tra campaign / đối tác", () => {
    expect(dem(so, /docLuaChonBoLocSo\(actor, \{ coAffiliate: scope\.co\.affiliate, campaignMaster: /g)).toBe(1);
    expect(dem(so, /docLuaChonBoLocSo\(/g)).toBe(1);
    expect(dem(so, /affiliateCampaign\./g)).toBe(0);
    expect(dem(so, /db\./g)).toBe(0);
  });
});

describe("[AFR-W4..W5] tab Kỳ", () => {
  it("[AFR-W4] `camp` qua regex hẹp; phần campaign đọc bằng `docPhanCampaignTheoKy`; `DaiSo` và `HanhDongKy` KHÔNG nhận số theo campaign", () => {
    expect(dem(ky, /MA_DANH_MUC_RE\.test\(campTho\)/g)).toBe(1);
    expect(dem(ky, /docPhanCampaignTheoKy\(/g)).toBe(1);
    expect(dem(ky, /scope\.co\.affiliate \? docCampaignCoTrongKy\(actor, \{ xem: scope\.has\("affiliate_campaigns:view"\), dangChon: campMa \}\) : Promise\.resolve\(\[\]\)/g)).toBe(1);
    const daiSo = ky.match(/<DaiSo\b[\s\S]*?\/>/)?.[0] ?? "";
    expect(daiSo).not.toBe("");
    expect(daiSo).not.toMatch(/phanCamp|campMa|tenCamp/);
    const hanhDong = ky.slice(ky.indexOf("const hanhDong: DuLieuHanhDong"), ky.indexOf("const hrefSoChung"));
    expect(hanhDong.length).toBeGreaterThan(200);
    expect(hanhDong.length).toBeLessThan(2500); // chốt chặn: cắt trượt (indexOf = -1) sẽ lấy cả phần cuối trang và khẳng định vô nghĩa
    expect(hanhDong).not.toMatch(/phanCamp|campMa|tenCamp/);
  });

  it("[AFR-W5] liên kết chuyển kỳ / cơ sở / trang mang `camp`: `href()` · redirect quá biên · ScopeBar · bộ lọc · BangKy", () => {
    expect(dem(ky, /const href = \(t: string\) => hrefVoi\(BASE, \{ coSo: coSoId, thang: t, camp: campMa, trangthai: trangThai \}\)/g)).toBe(1);
    expect(dem(ky, /redirect\(hrefVoi\(BASE, \{ coSo: coSoId, thang, camp: campMa, trangthai: trangThai, trang: ds\.trang \}\)\)/g)).toBe(1);
    expect(dem(ky, /giu=\{\{ thang, camp: campMa, trangthai: trangThai \}\}/g)).toBe(1);
    expect(dem(ky, /<LocCampaignKy\b[^>]*dangChon=\{campMa\}/g)).toBe(1);
    expect(dem(ky, /camp=\{campMa && tenCamp \?/g)).toBe(1);
  });
});

describe("[AFR-W6] lõi sổ", () => {
  it("điều kiện campaign / đối tác dựng ở MỘT nơi (`dungWhereSo`), `docSoHoaHong`, `gomSoTheoTrangThaiChi` và `gomSoTheoDoiTacHuong` đều dùng nó", () => {
    expect(dem(docSo, /affiliateCampaign: \{ code: boLoc\.campaignMa \}/g)).toBe(1);
    expect(dem(docSo, /beneficiaryAffiliateId: boLoc\.doiTacHuongId/g)).toBe(1);
    expect(dem(docSo, /dungWhereSo\(actor, boLoc\)/g)).toBe(3); // docSoHoaHong · gomSoTheoTrangThaiChi · gomSoTheoDoiTacHuong
  });
});
