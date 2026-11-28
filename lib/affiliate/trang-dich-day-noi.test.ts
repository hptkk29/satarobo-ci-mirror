/**
 * [AFFL6-W*] LƯỚI GHIM DÂY NỐI của đa tên miền / đa trang đích (AFF-L6). Thuần: đọc mã nguồn. Hành vi thật được khoá bằng `tests/hoa-hong/affiliate-da-landing.spec.ts` (Postgres) và
 * `lib/affiliate/*.test.ts`; lưới này chỉ khoá những chỗ MÀ BỎ ĐI THÌ KHÔNG CA HÀNH VI NÀO ĐỎ vì chúng chạm DB hoặc nằm giữa hai tầng.
 *
 *   [AFFL6-W1] MỌI nơi dựng chuỗi link (chuoiTuDong · docChuoiPhat · nhan-referral · ô chọn · checklist) giải host + thu hẹp theo campaign bằng ĐÚNG MỘT hàm `trangDichHieuLuc`
 *   [AFFL6-W2] địa chỉ ĐÍCH dựng từ tên miền đã chụp của link / của trang đích — không từ `baseUrl` (redirect luôn về website gốc là lỗi)
 *   [AFFL6-W3] tên miền đích KHÔNG nhận từ client; snapshot ghi từ kết quả cổng
 *   [AFFL6-W4] cổng «link còn hiệu lực» kiểm tên miền ∈ allowedDomains VÀ khớp trang đích CÓ ĐÚNG tên miền đó
 *   [AFFL6-W5] thu hẹp campaign: cổng xác nhận đứng TRƯỚC phép ghi; gỡ website xoá lựa chọn trang đích của nó
 *   [AFFL6-W6] ghi website/trang đích: tên miền ∈ allowedDomains kiểm ở cả thêm lẫn sửa; sửa website không gỡ tên miền đang dùng; sửa/tắt trang đích đếm link ảnh hưởng
 *   [AFFL6-W7] cổng đối tác tạo link: trang đích theo ID, đúng website, bật + bật theo dõi
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = process.cwd();

/** Bỏ chú thích dòng TRƯỚC, khối SAU (chú thích giải thích bản vá thường chứa đúng chuỗi đang cấm — luật 11). */
function boChuThich(s: string): string {
  return s
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/(^|\n)[ \t]*\/\*[\s\S]*?\*\//g, "$1");
}
const doc = (duong: string) => boChuThich(readFileSync(resolve(GOC, duong), "utf8"));
const dem = (s: string, re: RegExp) => (s.match(re) ?? []).length;
/** Thân một hàm `export (async )?function ten(` đến hàm export kế tiếp (đủ cho phép đếm). */
function than(s: string, ten: string): string {
  const i = s.search(new RegExp(`export (async )?function ${ten}\\b`));
  expect(i, ten).toBeGreaterThanOrEqual(0);
  const j = s.slice(i + 10).search(/\nexport (async )?function /);
  return j === -1 ? s.slice(i) : s.slice(i, i + 10 + j);
}

const DOC_LINK = doc("lib/affiliate/doc-link.ts");
const GHI_LINK = doc("lib/affiliate/ghi-link.ts");
const NHAN_REF = doc("lib/affiliate/nhan-referral.ts");
const HO_SO = doc("lib/affiliate/doc-ho-so-doi-tac.ts");
const DAU_VAO = doc("lib/affiliate/ghi-link-dau-vao.ts");
const DUNG_URL = doc("lib/affiliate/dung-url-theo-doi.ts");
const GHI_CAMP = doc("lib/affiliate/ghi-campaign.ts");
const GHI_WEB = doc("lib/affiliate/ghi-website.ts");
const TU_TAO = doc("lib/affiliate/tu-tao-link.ts");
const CAMP_ACTIONS = doc("app/(admin)/admin/nguon-hoa-hong/campaign/_actions.ts");

describe("[AFFL6-W1] một hàm giải host + thu hẹp theo campaign cho mọi nơi dựng chuỗi", () => {
  it("chuoiTuDong · docChuoiPhat · nhan-referral · ô chọn · checklist đều gọi trangDichHieuLuc( và đọc ràng buộc campaign bằng rangBuocCuaCampaign(", () => {
    expect(dem(than(DOC_LINK, "chuoiTuDong"), /\btrangDichHieuLuc\(/g)).toBe(1);
    expect(dem(DOC_LINK, /\btrangDichHieuLuc\(/g)).toBe(2); // chuoiTuDong + ô chọn «Phát link»
    expect(dem(DOC_LINK, /\brangBuocCuaCampaign\(/g)).toBe(2);
    expect(dem(GHI_LINK, /\btrangDichHieuLuc\(/g)).toBe(1);
    expect(dem(GHI_LINK, /\brangBuocCuaCampaign\(/g)).toBe(1);
    expect(dem(NHAN_REF, /\btrangDichHieuLuc\(/g)).toBe(1);
    expect(dem(NHAN_REF, /\brangBuocCuaCampaign\(/g)).toBe(1);
    expect(dem(HO_SO, /\btrangDichHieuLuc\(/g)).toBe(1);
    expect(dem(HO_SO, /\brangBuocCuaCampaign\(/g)).toBe(1);
  });
  it("mọi nơi đọc campaign để dựng chuỗi cũng SELECT ràng buộc (landings: CHON_RANG_BUOC_CAMPAIGN) — thiếu là chuỗi không thấy thu hẹp", () => {
    expect(dem(DOC_LINK, /landings: CHON_RANG_BUOC_CAMPAIGN/g)).toBeGreaterThanOrEqual(4); // CHON_CHUOI · danh sách · ô chọn · link đang dùng
    expect(dem(GHI_LINK, /landings: CHON_RANG_BUOC_CAMPAIGN/g)).toBe(1);
    expect(dem(NHAN_REF, /landings: CHON_RANG_BUOC_CAMPAIGN/g)).toBe(1);
    expect(dem(HO_SO, /landings: CHON_RANG_BUOC_CAMPAIGN/g)).toBe(1);
  });
});

describe("[AFFL6-W2] địa chỉ đích dựng từ tên miền ĐÃ CHỤP, không từ baseUrl", () => {
  it("dungUrlTrangDich ghép `https://${p.landingHost}` đúng 1 lần; dung-url-theo-doi không còn dùng baseUrl để dựng đích", () => {
    expect(dem(DUNG_URL, /`https:\/\/\$\{p\.landingHost\}\$\{p\.landingPath\}`/g)).toBe(1);
    expect(dem(DUNG_URL, /\.baseUrl\b/g)).toBe(0);
  });
  it("kiemPhatLink dựng URL từ tên miền của TRANG ĐÍCH đã chọn (hoặc của website khi không chọn) — một chỗ", () => {
    expect(dem(DAU_VAO, /`https:\/\/\$\{host\}\$\{p\.duongDan\}`/g)).toBe(1);
    expect(dem(DAU_VAO, /hostCuaBaseUrl\(p\.chuoi\.site\.baseUrl\)/g)).toBe(1);
  });
  it("/r và danh sách truyền tên miền đã chụp của link (chuoi.taiSan.landingHost) vào dungUrlDich / dungUrlTrangDich", () => {
    const TDC = doc("lib/affiliate/theo-doi-cong-khai.ts");
    // 3 chỗ dựng URL từ link đã tải: bấm link khi bật (đích kèm aff) · khi tắt (đích sạch, R5) · link không hợp lệ (đích sạch). Mỗi chỗ PHẢI truyền tên miền đã chụp.
    expect(dem(TDC, /landingHost: link\.chuoi\.taiSan\.landingHost/g)).toBe(3);
    expect(dem(DOC_LINK, /landingHost: chuoi\.taiSan\.landingHost/g)).toBeGreaterThanOrEqual(3);
  });
});

describe("[AFFL6-W3] tên miền đích không nhận từ client", () => {
  it("phatLinkSchema chỉ nhận landingPageId; ghi-link snapshot lấy từ KẾT QUẢ CỔNG (kiem.*), không từ đầu vào (v.*)", () => {
    const sch = DAU_VAO.slice(DAU_VAO.indexOf("export const phatLinkSchema"), DAU_VAO.indexOf("export type DauVaoPhatLink"));
    expect(dem(sch, /landingPageId:/g)).toBe(1);
    expect(dem(sch, /landingHost|\bhost:/g)).toBe(0);
    expect(dem(sch, /\.strict\(\)/g)).toBe(1);
    expect(dem(GHI_LINK, /landingHost: kiem\.landingHost/g)).toBe(2); // phát + xoay
    expect(dem(GHI_LINK, /landingPageId: kiem\.landingPageId/g)).toBe(2);
    expect(dem(GHI_LINK, /\bv\.landingHost\b/g)).toBe(0);
  });
});

describe("[AFFL6-W4] cổng link còn hiệu lực kiểm tên miền", () => {
  it("trangDichConHieuLuc = tên miền ∈ allowedDomains ∧ trangDichKhopLink(đúng tên miền) — định nghĩa MỘT lần", () => {
    expect(dem(DAU_VAO, /trangDichConHieuLuc: hostTrongDanhSach\(c\.site\.allowedDomains, c\.taiSan\.landingHost\) && trangDichKhopLink\(c\.trangDich, c\.taiSan\.landingHost, c\.taiSan\.landingPath\)/g)).toBe(1);
    const HOP_LE = doc("lib/affiliate/website-hop-le.ts");
    // phép khớp trang đích SO TÊN MIỀN (t.host !== host ⇒ bỏ qua) và tôn trọng tắt theo dõi riêng
    expect(dem(HOP_LE, /!t\.isActive \|\| !t\.trackingEnabled \|\| t\.host !== host \|\| !khopDuongDan\(t\.pathPattern, path\)/g)).toBe(1);
  });
});

describe("[AFFL6-W5] thu hẹp campaign: cổng xác nhận trước phép ghi; gỡ website xoá lựa chọn", () => {
  it("datTrangDichCampaign: throw CanXacNhan đứng TRƯỚC deleteMany/createMany; xác nhận lấy từ đầu vào bắt buộc", () => {
    const t = than(GHI_CAMP, "datTrangDichCampaign");
    const iCong = t.indexOf("throw new CanXacNhan(");
    const iXoa = t.indexOf("affiliateCampaignLanding.deleteMany(");
    const iTao = t.indexOf("affiliateCampaignLanding.createMany(");
    expect(iCong).toBeGreaterThan(0);
    expect(iXoa).toBeGreaterThan(iCong);
    expect(iTao).toBeGreaterThan(iXoa);
    expect(dem(t, /demLinkMatHieuLuc\(/g)).toBe(1);
    expect(dem(t, /!p\.xacNhan/g)).toBe(1);
    expect(dem(t, /khoaCampaignTrongTx\(tx,/g)).toBe(1);
  });
  it("goWebsite xoá lựa chọn trang đích của website TRƯỚC khi gỡ website", () => {
    const t = than(GHI_CAMP, "goWebsite");
    const iXoaChon = t.indexOf("affiliateCampaignLanding.deleteMany(");
    const iGo = t.indexOf("affiliateCampaignSite.delete(");
    expect(iXoaChon).toBeGreaterThan(0);
    expect(iGo).toBeGreaterThan(iXoaChon);
  });
  it("action bắt `xacNhan` kiểu boolean (không mặc định) và gác bằng affiliate_campaigns:manage", () => {
    expect(dem(CAMP_ACTIONS, /xacNhan: z\.boolean\(\)/g)).toBe(1);
    const a = CAMP_ACTIONS.slice(CAMP_ACTIONS.indexOf("export async function datTrangDichCampaignAction"));
    expect(a.indexOf('checkPermission("affiliate_campaigns:manage")')).toBeGreaterThan(0);
    expect(a.indexOf("checkPermission(")).toBeLessThan(a.indexOf("datTrangDichCampaign({"));
  });
});

describe("[AFFL6-W6] ghi website / trang đích", () => {
  it("thêm + sửa trang đích đều chuẩn hoá host qua chuanHoaHostTrangDich; sửa website kiểm kiemSuaWebsiteVoiTrangDich", () => {
    expect(dem(than(GHI_WEB, "themTrangDich"), /chuanHoaHostTrangDich\(/g)).toBe(1);
    expect(dem(than(GHI_WEB, "suaTrangDich"), /chuanHoaHostTrangDich\(/g)).toBe(1);
    expect(dem(than(GHI_WEB, "suaWebsite"), /kiemSuaWebsiteVoiTrangDich\(/g)).toBe(1);
  });
  it("sửa / tắt trang đích đếm link bị ảnh hưởng TRƯỚC phép ghi và ghi con số vào audit", () => {
    const sua = than(GHI_WEB, "suaTrangDich");
    expect(sua.indexOf("demLinkAnhHuong(")).toBeGreaterThan(0);
    expect(sua.indexOf("demLinkAnhHuong(")).toBeLessThan(sua.indexOf("affiliateLandingPage.update("));
    const tat = than(GHI_WEB, "batTatTrangDich");
    expect(tat.indexOf("demLinkAnhHuong(")).toBeGreaterThan(0);
    expect(tat.indexOf("demLinkAnhHuong(")).toBeLessThan(tat.indexOf("affiliateLandingPage.update("));
    expect(dem(sua, /soLinkAnhHuong/g)).toBeGreaterThanOrEqual(3);
  });
  it("khoá duy nhất theo (website, hostKey, đường dẫn) — không còn tra theo (website, đường dẫn)", () => {
    expect(dem(GHI_WEB, /siteId_pathPattern/g)).toBe(0);
    expect(dem(GHI_WEB, /siteId_hostKey_pathPattern/g)).toBe(2);
  });
});

describe("[AFFL6-W7] cổng đối tác tạo link", () => {
  it("trang đích tra theo ID (khi có) đúng website, đang bật + bật theo dõi; truyền landingPageId của DÒNG DB cho phatLink", () => {
    expect(dem(TU_TAO, /id: v\.landingPageId/g)).toBe(1);
    expect(dem(TU_TAO, /isActive: true, trackingEnabled: true/g)).toBe(1);
    expect(dem(TU_TAO, /landingPageId: trang\.id/g)).toBe(1);
    expect(dem(TU_TAO, /landingHost/g)).toBe(0);
  });
});
