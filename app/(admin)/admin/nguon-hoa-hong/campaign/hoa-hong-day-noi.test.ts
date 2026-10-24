// @vitest-environment node
/**
 * [AFL1-W*] — LƯỚI GHIM MÃ NGUỒN cho dây nối của mục «Hoa hồng» của campaign Affiliate (AFF-L1).
 *
 * Cổng mà test hành vi không chạm được (page là Server Component; hàm ghi chạm DB nên test thuần không thấy thứ tự khoá) ⇒ ghim bằng văn bản mã ĐÃ BỎ CHÚ THÍCH.
 * Luật 11: neo hẹp + ĐẾM SỐ LẦN, không cờ `/s`. Luật 14: mỗi ca đã được CẤY LẠI lỗi để thấy đỏ (bảng phép cấy ở `docs/source-commission/closeout/l1-chinh-sach-campaign.md`).
 *
 *   [AFL1-W1] trang chi tiết: mục Hoa hồng vẽ ĐÚNG MỘT lần, nút bằng ĐÚNG khoá của action; chính sách chỉ TRUY VẤN khi có `commission_policies:view`
 *   [AFL1-W2] action đổi lựa chọn thưởng: auth → checkPermission(manage) → zod → cờ → hàm ghi (đúng thứ tự)
 *   [AFL1-W3] cổng «thưởng» ở chính sách: kiểm TRƯỚC (hàng rào), kiểm lại dưới khoá campaign `FOR SHARE` TRƯỚC phép ghi kích hoạt
 *   [AFL1-W4] `AffiliateCampaignRule.policyId`: KHÔNG đường ghi nào đặt giá trị khác null; không ô chọn chính sách ở UI quy tắc
 *   [AFL1-W5] cổng kích hoạt campaign đọc dữ liệu bằng MỘT hàm cho cả hai nơi hỏi
 *   [AFL1-W6] bộ lọc Sổ / Kỳ: cả hai trang truyền `campaignMaster` bằng quyền xem campaign + mã đang lọc; không còn gọi hai hàm với chữ ký cũ
 *   [AFL1-W7] kiểu tính: MỘT hằng của guardrail; không còn điều kiện gõ cứng FIXED/TIER trong guardrail
 *   [AFL1-W8] trình soạn: phạm vi CAMPAIGN có đường vào từ mục Hoa hồng và id campaign KHÔNG lấy từ URL
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = process.cwd();
const APP = "app/(admin)/admin/nguon-hoa-hong";

function boChuThich(s: string): string {
  return s
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}
const doc = (duong: string) => boChuThich(readFileSync(resolve(GOC, duong), "utf8"));
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

function than(src: string, ten: string): string {
  const i = src.indexOf(`export async function ${ten}(`);
  expect(i, `không thấy hàm ${ten}`).toBeGreaterThanOrEqual(0);
  const j = src.indexOf("\n}\n", i);
  return src.slice(i, j < 0 ? undefined : j);
}

describe("[AFL1-W1] trang chi tiết campaign", () => {
  const trang = doc(`${APP}/campaign/[maCampaign]/page.tsx`);
  it("mục Hoa hồng vẽ đúng 1 lần, nối quyền bằng BIẾN/khoá chuẩn", () => {
    expect(dem(trang, /<KhoiHoaHong\b/g)).toBe(1);
    expect(dem(trang, /<Muc id="hoa-hong"/g)).toBe(1);
    expect(dem(trang, /doiCheDo: coTheSoan\b/g), "đổi lựa chọn = affiliate_campaigns:manage").toBe(1);
    expect(dem(trang, /const coTheSoan = scope\.has\("affiliate_campaigns:manage"\);/g)).toBe(1);
    expect(dem(trang, /soanChinhSach: scope\.has\("commission_policies:manage"\) && scope\.co\.engine/g), "soạn = manage ∧ engine bật (tab Chính sách 404 khi engine tắt)").toBe(1);
    expect(dem(trang, /const xemChinhSach = scope\.has\("commission_policies:view"\);/g)).toBe(1);
  });
  it("phiên bản chính sách chỉ được TRUY VẤN khi có quyền xem; thiếu quyền ⇒ null (không phải mảng rỗng)", () => {
    expect(dem(trang, /xemChinhSach \? docPhienBanChinhSachCuaCampaign\(actor, campaign\.id, now\) : Promise\.resolve\(null\)/g)).toBe(1);
    expect(dem(trang, /\bdocPhienBanChinhSachCuaCampaign\(/g)).toBe(1);
  });
  it("điều kiện chặn kích hoạt trên trang LIỆT KÊ TẤT CẢ và mỗi cái có đường sửa dựng bằng `hrefMucSua` (không chuỗi gõ tay)", () => {
    expect(dem(trang, /campaign\.chanKichHoat\.map\(/g)).toBe(1);
    expect(dem(trang, /\bhrefMucSua\(goc, c\.muc\)/g)).toBe(1);
    expect(dem(trang, /chanKichHoat=\{campaign\.chanKichHoat\} goc=\{goc\}/g), "nút kích hoạt nhận cả điều kiện lẫn gốc đường").toBe(1);
  });
});

describe("[AFL1-W2] action đổi lựa chọn thưởng", () => {
  const act = doc(`${APP}/campaign/_actions.ts`);
  it("auth → checkPermission(manage) → zod → cờ → hàm ghi; đúng khoá; hàm ghi gọi đúng 1 lần", () => {
    const t = than(act, "datCheDoThuongAction");
    const iAuth = t.indexOf("await auth()");
    const iQuyen = t.indexOf('checkPermission("affiliate_campaigns:manage")');
    const iZod = t.indexOf("cheDoThuongSchema.safeParse(");
    const iCo = t.indexOf("await moduleBat()");
    const iGhi = t.indexOf("await datCheDoThuong(");
    expect(iAuth).toBeGreaterThanOrEqual(0);
    expect(iQuyen).toBeGreaterThan(iAuth);
    expect(iZod).toBeGreaterThan(iQuyen);
    expect(iCo).toBeGreaterThan(iZod);
    expect(iGhi).toBeGreaterThan(iCo);
    expect(dem(t, /\bdatCheDoThuong\(/g)).toBe(1);
    expect(dem(t, /affiliate_campaigns:activate/g), "đổi lựa chọn KHÔNG phải kích hoạt").toBe(0);
  });
  it("hàm ghi: khoá campaign trước, cổng trước phép ghi, ghi + audit CÙNG transaction", () => {
    const camp = doc("lib/affiliate/ghi-campaign.ts");
    const t = than(camp, "datCheDoThuong");
    expect(t.indexOf("khoaCampaignTrongTx(tx,")).toBeGreaterThan(t.indexOf("$transaction"));
    expect(t.indexOf("kiemDoiCheDoThuong(")).toBeGreaterThan(t.indexOf("khoaCampaignTrongTx(tx,"));
    expect(t.indexOf("tx.affiliateCampaign.update(")).toBeGreaterThan(t.indexOf("kiemDoiCheDoThuong("));
    expect(dem(t, /\bwriteAudit\(\{\s*tx,/g)).toBe(1);
    expect(dem(t, /return\s*\{\s*ok:\s*false/g), "từ chối trong transaction là throw").toBe(0);
  });
});

describe("[AFL1-W3] kích hoạt chính sách CAMPAIGN không được trái với «không có mức riêng»", () => {
  const sv = doc("lib/hoa-hong/chinh-sach-service.ts");
  it("kiểm ở BA nơi: hàng rào xem trước · kiểm trước khi ghi · dưới khoá campaign FOR SHARE", () => {
    expect(dem(sv, /\blyDoCampaignKhongThuong\(/g)).toBe(4); // 1 định nghĩa + 3 lời gọi
    const kh = than(sv, "kichHoat");
    expect(dem(kh, /\blyDoCampaignKhongThuong\(/g)).toBe(2);
    const iKhoa = kh.indexOf('FROM "AffiliateCampaign" WHERE "id" = ${v.scopeCampaignId} FOR SHARE');
    const iDoc = kh.indexOf("lyDoCampaignKhongThuong(tx, v)");
    const iGhi = kh.indexOf('data: { status: "ACTIVE"');
    expect(iKhoa).toBeGreaterThan(kh.indexOf("$transaction"));
    expect(iDoc, "đọc lựa chọn SAU khi khoá").toBeGreaterThan(iKhoa);
    expect(iGhi, "cổng đứng TRƯỚC phép ghi kích hoạt").toBeGreaterThan(iDoc);
    expect(dem(than(sv, "kiemTruocKichHoat"), /\blyDoCampaignKhongThuong\(/g)).toBe(1);
  });
  it("chỉ chặn đúng NONE (rewardMode khác NONE ⇒ qua)", () => {
    expect(dem(sv, /c\?\.rewardMode !== "NONE"\) return null/g)).toBe(1);
  });
});

describe("[AFL1-W4] `AffiliateCampaignRule.policyId` đã thu gọn", () => {
  it("hàm ghi quy tắc chỉ đặt policyId: null; không đường nào khác ghi cột này", () => {
    const camp = doc("lib/affiliate/ghi-campaign.ts");
    expect(dem(camp, /\bpolicyId:/g)).toBe(1);
    expect(dem(camp, /policyId: null/g)).toBe(1);
    expect(dem(camp, /affiliateCampaignRule\.(update|updateMany|upsert)\(/g)).toBe(0);
    const dauVao = doc("lib/affiliate/ghi-campaign-dau-vao.ts");
    // schema tạo quy tắc là .strict() và KHÔNG khai policyId ⇒ client không gửi lên được
    expect(dem(dauVao, /taoQuyTacSchema = z[\s\S]{0,400}\.strict\(\)/g)).toBe(1);
    expect(dem(dauVao.slice(dauVao.indexOf("taoQuyTacSchema"), dauVao.indexOf("export type DauVaoTaoQuyTac")), /\bpolicyId\b/g)).toBe(0);
  });
  it("UI quy tắc không có ô/đọc policyId", () => {
    expect(dem(doc("components/admin/nguon-hoa-hong/campaign/khoi-quy-tac.tsx"), /\bpolicyId\b/g)).toBe(0);
    expect(dem(doc("lib/affiliate/doc-campaign.ts"), /\bpolicyId\b/g)).toBe(0);
  });
});

describe("[AFL1-W5] cổng kích hoạt đọc dữ liệu bằng MỘT hàm", () => {
  it("hàm ghi và hàm đọc chi tiết cùng gọi `docDuLieuCongKichHoat` đúng 1 lần mỗi nơi; hàm đọc campaign (đủ ba nơi: kích hoạt · đổi lựa chọn · chi tiết)", () => {
    expect(dem(than(doc("lib/affiliate/ghi-campaign.ts"), "doiTrangThaiCampaign"), /\bdocDuLieuCongKichHoat\(/g)).toBe(1);
    expect(dem(than(doc("lib/affiliate/ghi-campaign.ts"), "datCheDoThuong"), /\bdocDuLieuCongKichHoat\(/g)).toBe(1);
    expect(dem(doc("lib/affiliate/doc-campaign.ts"), /\bdocDuLieuCongKichHoat\(/g)).toBe(1);
  });
  it("loader đọc KHÔNG scope (client truyền vào) và không lọc theo trạng thái trừ CANCELLED", () => {
    const l = doc("lib/affiliate/cong-kich-hoat-doc.ts");
    expect(dem(l, /scopedDb/g)).toBe(0);
    expect(dem(l, /status: \{ not: "CANCELLED" \}/g)).toBe(1);
  });
});

describe("[AFL1-W6] bộ lọc Sổ / Kỳ lấy campaign từ master theo quyền xem campaign", () => {
  it("cả hai trang truyền `campaignMaster` với `affiliate_campaigns:view` và mã đang lọc", () => {
    const so = doc(`${APP}/so/page.tsx`);
    const ky = doc(`${APP}/ky/page.tsx`);
    expect(dem(so, /campaignMaster: \{ xem: scope\.has\("affiliate_campaigns:view"\), dangChon: gia\.camp === "" \? null : gia\.camp \}/g)).toBe(1);
    expect(dem(ky, /docCampaignCoTrongKy\(actor, \{ xem: scope\.has\("affiliate_campaigns:view"\), dangChon: campMa \}\)/g)).toBe(1);
  });
  it("tham số BẮT BUỘC (không dấu ?) ở cả hai hàm đọc — quên truyền là lỗi biên dịch, không phải danh sách lặng lẽ thiếu", () => {
    expect(dem(doc("lib/hoa-hong/doc-so-giao-dien.ts"), /tuyChon: \{ coAffiliate: boolean; campaignMaster: CachLayCampaign \}/g)).toBe(1);
    expect(dem(doc("lib/hoa-hong/ky-doc.ts"), /docCampaignCoTrongKy\(actor: Actor, campaignMaster: CachLayCampaign\)/g)).toBe(1);
  });
  it("master chỉ dùng khi người xem CÓ quyền: nhánh sổ chỉ chạy khi `!xem`, nhánh master khi `xem`", () => {
    const g = doc("lib/hoa-hong/doc-so-giao-dien.ts");
    expect(dem(g, /tuyChon\.coAffiliate && !tuyChon\.campaignMaster\.xem/g)).toBe(1);
    expect(dem(g, /tuyChon\.coAffiliate && tuyChon\.campaignMaster\.xem \? docCampaignMaster\(/g)).toBe(1);
    expect(dem(doc("lib/hoa-hong/ky-doc.ts"), /if \(campaignMaster\.xem\) return docCampaignMaster\(campaignMaster\.dangChon\);/g)).toBe(1);
  });
});

describe("[AFL1-W7] kiểu tính: một hằng", () => {
  it("guardrail định nghĩa MỘT hằng và dùng nó; không còn điều kiện gõ cứng FIXED || TIER", () => {
    const g = doc("lib/hoa-hong/guardrail-kich-hoat.ts");
    // Sau AFF-L2: MỘT hằng NGUỒN là `KIEU_TINH_HO_TRO` (chon-quy-tac.ts); `KIEU_TINH_CHUA_HO_TRO` được SUY từ nó (giao diện đọc), và cổng kiểm đọc chính hằng nguồn.
    expect(dem(g, /export const KIEU_TINH_CHUA_HO_TRO\b/g)).toBe(1);
    expect(dem(g, /\.filter\(\(k\) => !KIEU_TINH_HO_TRO\.includes\(k\)\)/g)).toBe(1);
    expect(dem(g, /!KIEU_TINH_HO_TRO\.includes\(q\.kieuTinh\)/g)).toBe(1);
    expect(dem(g, /q\.kieuTinh === "FIXED_PER_PURCHASE" \|\|/g)).toBe(0);
  });
  it("giao diện soạn đọc hằng đó (qua `kieuODungDuoc` / `trangThaiCacKieuTinh`), không so tên kiểu để khoá", () => {
    expect(dem(doc("lib/hoa-hong/chinh-sach-form.ts"), /KIEU_TINH_CHUA_HO_TRO as readonly string\[\]\)\.includes\(kieu\)/g)).toBe(1);
    expect(dem(doc("lib/affiliate/hoa-hong-campaign-dau-vao.ts"), /KIEU_TINH_CHUA_HO_TRO as readonly string\[\];/g)).toBe(1);
    const cb = doc(`${APP}/chinh-sach/_components/cac-buoc.tsx`);
    expect(dem(cb, /kieuODungDuoc\("FIXED_PER_PURCHASE"\)/g)).toBe(2);
  });
});

describe("[AFL1-W8] trình soạn: phạm vi CAMPAIGN", () => {
  it("`?campaign=` chỉ mang MÃ; id lấy từ danh sách máy chủ nạp và campaign đã kết thúc bị bỏ", () => {
    const moi = doc(`${APP}/chinh-sach/moi/page.tsx`);
    expect(dem(moi, /dl\.campaign\.find\(\(c\) => c\.code === maCampaign && c\.status !== "ENDED"\)/g)).toBe(1);
    expect(dem(moi, /\bformChoCampaign\(/g)).toBe(1);
    expect(dem(moi, /sp\.campaign/g)).toBe(1);
  });
  it("danh sách campaign của trình soạn: quyền xem campaign kiểm ở lib (`can`), cờ Affiliate kiểm ở CẢ HAI trang soạn — module tắt ⇒ không mời chọn phạm vi campaign", () => {
    expect(dem(doc("lib/hoa-hong/chinh-sach-doc.ts"), /can\(actor, KEY_XEM_CAMPAIGN\)\s*\?\s*db\.affiliateCampaign\.findMany\(/g)).toBe(1);
    expect(dem(doc("lib/hoa-hong/chinh-sach-doc.ts"), /const KEY_XEM_CAMPAIGN = "affiliate_campaigns:view";/g)).toBe(1);
    for (const f of [`${APP}/chinh-sach/moi/page.tsx`, `${APP}/chinh-sach/[policyId]/soan/page.tsx`]) {
      expect(dem(doc(f), /const dl = scope\.co\.affiliate \? dlTho : \{ \.\.\.dlTho, campaign: \[\] \};/g), f).toBe(1);
    }
  });

  it("mục Hoa hồng trỏ vào trình soạn bằng MÃ campaign (`hrefSoanChinhSachCampaign`), không bằng id", () => {
    const kh = doc("components/admin/nguon-hoa-hong/campaign/khoi-hoa-hong.tsx");
    expect(dem(kh, /hrefSoanChinhSachCampaign\(maCampaign\)/g)).toBe(1);
    expect(dem(kh, /campaignId=/g)).toBe(0);
  });
});
