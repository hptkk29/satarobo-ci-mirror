// @vitest-environment node
/**
 * [AFP-HASH-*] · [AFP-SB-*] · [AFP-W*] — phần THUẦN của nối hoa hồng theo campaign Affiliate vào engine (AFF-P2). Không DB, không đồng hồ.
 * Phần cần Postgres (rule thắng đúng bậc, sổ chụp 3 cột, đảo ngược, drift) nằm ở `tests/hoa-hong/affiliate-hoa-hong.spec.ts`.
 *
 *   [AFP-HASH]  băm đầu vào: campaign TRỐNG ⇒ băm Y HỆT trước AFF-P2 (mọi ô đã khớp không thành drift); có campaign ⇒ băm khác; đổi campaign ⇒ băm đổi
 *   [AFP-SB]    so bóng với dòng AFFILIATE theo phạm vi CAMPAIGN: ĐÃ CÓ QUYẾT ĐỊNH (AFF-L2 D-D) — EXPECTED CHỈ KHI đủ ba điều kiện, thiếu một ⇒ UNEXPECTED ⇒ chặn mốc cutover
 *   [AFP-W*]    lưới dây nối (luật 11: neo hẹp, đếm số lần khớp, bỏ chú thích) cho thứ mà test hành vi chạm DB mới thấy
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { cacChanPrecheck } from "./cutover-kiem-tra";
import { PHAM_VI, THU_TU_PHAM_VI_MAC_DINH, kiemThuTuPhamVi } from "./chon-quy-tac";
import type { BoiCanhQuet } from "./boi-canh";
import { hashCuaKetQua, type KeHoachThu } from "./quet-khoan";
import { bamDauVao } from "./khoa-so";
import { soSanhKhoan, type DongMoi, type KhoanSoBong, type VaiDuKien } from "./so-bong";
import type { KetQuaTinhKhoan } from "./tinh-dong-cho-khoan";

// ── [AFP-HASH] ───────────────────────────────────────────────────────────────────────────────────────────

/** Chỉ những trường `hashCuaKetQua` ĐỌC — phần còn lại của KeHoachThu / BoiCanhQuet không liên quan tới băm. */
function khoan(campaignId: string | null): KeHoachThu {
  return {
    vat: { grossAmount: 10_000_000, vatRate: 0, netBase: 10_000_000 },
    loaiGiaoDich: "NEW",
    studentId: "s1",
    orderItemId: "oi1",
    nguonChinhSach: { sourceGroupId: "g1", coHoaHong: true, affiliateId: "a1", sourceId: null, campaignId, eventId: null },
    nguon: { attributionId: "at1" },
    ngoaiCuaSo: false,
    daTraBangEngineCu: new Set<string>(),
  } as unknown as KeHoachThu;
}
const bc = { hoaHong: { tranTongTiLe: 0.09, phienBanThuTu: "v1" } } as unknown as BoiCanhQuet;
const OK = { loai: "OK", cacVai: [], dong: [], treo: [], tiLeTuongDuong: 0, mienCuaSoNguon: [] } as unknown as KetQuaTinhKhoan;
const VUOT = { loai: "VUOT_TRAN", tiLeTuongDuong: 0.1, tran: 0.09, quyTacThang: [] } as unknown as KetQuaTinhKhoan;

/** CÔNG THỨC CŨ (trước AFF-P2), chép NGUYÊN VĂN từ `quet-khoan.ts` — nếu hàm thật lệch khỏi nó khi không có campaign thì ô đã khớp thành drift. */
const BAM_CU = {
  gross: 10_000_000,
  vatRate: 0,
  coSo: 10_000_000,
  loai: "NEW",
  studentId: "s1",
  dong: "oi1",
  nguon: { nhom: "g1", aff: "a1", attribution: "at1" },
  tran: 0.09,
  thuTu: "v1",
  ngoaiCuaSo: false,
  daTra: [] as string[],
};

describe("[AFP-HASH] campaign trong băm đầu vào", () => {
  it("[AFP-HASH-01] campaign TRỐNG ⇒ băm BẰNG đúng băm của công thức cũ (cả nhánh OK lẫn nhánh lỗi) — mọi ô đã khớp trước AFF-P2 giữ nguyên, không drift giả", () => {
    expect(hashCuaKetQua(khoan(null), bc, 10_000_000, OK)).toBe(bamDauVao({ ...BAM_CU, vai: [] }));
    expect(hashCuaKetQua(khoan(null), bc, 10_000_000, VUOT)).toBe(bamDauVao({ ...BAM_CU, loi: "VUOT_TRAN", tiLe: 0.1 }));
  });

  it("[AFP-HASH-02] có campaign ⇒ băm KHÁC băm không-campaign; hai campaign khác nhau ⇒ hai băm khác nhau; cùng campaign ⇒ cùng băm (tất định)", () => {
    const khong = hashCuaKetQua(khoan(null), bc, 10_000_000, OK);
    const c1 = hashCuaKetQua(khoan("c1"), bc, 10_000_000, OK);
    const c2 = hashCuaKetQua(khoan("c2"), bc, 10_000_000, OK);
    expect(c1).not.toBe(khong);
    expect(c2).not.toBe(khong);
    expect(c1).not.toBe(c2);
    expect(hashCuaKetQua(khoan("c1"), bc, 10_000_000, OK)).toBe(c1);
    // nhánh lỗi cũng đổi theo campaign (VUOT_TRAN ở campaign A không được coi là «đã khớp» khi khoản chuyển sang campaign B)
    expect(hashCuaKetQua(khoan("c1"), bc, 10_000_000, VUOT)).not.toBe(hashCuaKetQua(khoan(null), bc, 10_000_000, VUOT));
  });
});

// ── [AFP-SB] ─────────────────────────────────────────────────────────────────────────────────────────────

const DU_DIEU_KIEN = { phienBanDaPhatHanh: true, campaignKhop: true, lienKetHopLe: true } as const;
const vaiAff = (scopeType: VaiDuKien["scopeType"], chinhSachCampaign: VaiDuKien["chinhSachCampaign"] = null): VaiDuKien => ({
  roleCode: "AFFILIATE",
  trangThai: "SINH_DONG",
  scopeType,
  nguonKhongRo: false,
  thuHut: true,
  resolverType: "DIRECT_PERSON",
  coDongLoaiTruNhom: false,
  chinhSachCampaign,
});
const dongAff: DongMoi = { roleCode: "AFFILIATE", kind: "AFFILIATE", nguoiId: "a1", soTien: 300_000 };
const khoanSb = (scopeType: VaiDuKien["scopeType"], chinhSachCampaign: VaiDuKien["chinhSachCampaign"] = null): KhoanSoBong => ({
  paymentId: "p1",
  ngayThu: "2026-10-12",
  soTienThu: 10_000_000,
  cu: [],
  cuLaTaiTuc: false,
  loaiMoi: "NEW",
  moi: { loai: "TINH", dong: [dongAff], vai: [vaiAff(scopeType, chinhSachCampaign)], treoCoHangCho: [] },
});

describe("[AFP-SB] so bóng với dòng AFFILIATE theo phạm vi CAMPAIGN — quyết định D-D (AFF-L2)", () => {
  it("[AFP-SB-01] dòng AFFILIATE (cũ 0 → mới > 0) theo rule CAMPAIGN với ĐỦ ba điều kiện ⇒ EXPECTED `AFFILIATE_CAMPAIGN_POLICY`; thiếu MỘT điều kiện ⇒ UNEXPECTED (đối chứng); SOURCE_GROUP vẫn EXPECTED như cũ", () => {
    const ma = (k: KhoanSoBong) => soSanhKhoan(k).dong.map((d) => `${d.loai}:${d.ma}`);
    expect(ma(khoanSb("CAMPAIGN", DU_DIEU_KIEN))).toEqual(["EXPECTED_BUSINESS_DELTA:AFFILIATE_CAMPAIGN_POLICY"]);
    expect(ma(khoanSb("SOURCE_GROUP"))).toEqual(["EXPECTED_BUSINESS_DELTA:ACQUISITION_ADDED_BY_SOURCE_POLICY"]);
    // thiếu từng điều kiện MỘT MÌNH (mỗi dòng đối chứng với dòng đủ điều kiện ở trên)
    for (const thieu of ["phienBanDaPhatHanh", "campaignKhop", "lienKetHopLe"] as const) {
      expect(ma(khoanSb("CAMPAIGN", { ...DU_DIEU_KIEN, [thieu]: false })), thieu).toEqual(["UNEXPECTED:DONG_MOI_NGOAI_DANH_SACH"]);
    }
    // rule thắng KHÔNG phải CAMPAIGN thì `chinhSachCampaign` không được dùng làm cớ
    expect(ma(khoanSb("GLOBAL", DU_DIEU_KIEN))).toEqual(["UNEXPECTED:DONG_MOI_NGOAI_DANH_SACH"]);
    // rule CAMPAIGN mà engine không khai gì về chính sách campaign ⇒ không đoán
    expect(ma(khoanSb("CAMPAIGN", null))).toEqual(["UNEXPECTED:DONG_MOI_NGOAI_DANH_SACH"]);
  });

  it("[AFP-SB-02] số UNEXPECTED còn lại CHẶN mốc cutover (CO_CHENH_BAT_NGO); khi đủ điều kiện thì số UNEXPECTED = 0 ⇒ không chặn", () => {
    const dem = (k: KhoanSoBong) => soSanhKhoan(k).dong.filter((d) => d.loai === "UNEXPECTED").length;
    const bang = (unexpectedDelta: number) => ({ invalidAttribution: 0, holdNghiemTrongDuKien: 0, unexpectedDelta, diTruChuaSanSang: false });
    const thieu = dem(khoanSb("CAMPAIGN", { ...DU_DIEU_KIEN, lienKetHopLe: false }));
    expect(thieu).toBe(1);
    expect(cacChanPrecheck(bang(thieu)).map((c) => c.ma)).toEqual(["CO_CHENH_BAT_NGO"]);
    const du = dem(khoanSb("CAMPAIGN", DU_DIEU_KIEN));
    expect(du).toBe(0);
    expect(cacChanPrecheck(bang(du))).toEqual([]);
  });
});

// ── [AFP-W*] lưới dây nối ────────────────────────────────────────────────────────────────────────────────

/** Đọc tệp nguồn, BỎ CHÚ THÍCH (chú thích giải thích bản vá hay chứa đúng chuỗi đang canh — luật 11). */
function doc(duong: string): string {
  const s = readFileSync(resolve(process.cwd(), duong), "utf8");
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");
}
const dem = (ma: string, mau: string | RegExp): number => ma.split(mau as never).length - 1;

describe("[AFP-W] dây nối campaign Affiliate", () => {
  it("[AFP-W1] `dau-vao-chinh-sach.ts`: MỘT lời gọi tra campaign, chỉ khi nguồn ĐÃ RÕ; `campaignId` của chính sách lấy từ đó; kết quả trả ra cho engine", () => {
    // Quên nối ⇒ `campaignId` mãi là `null` ⇒ rule CAMPAIGN không bao giờ khớp VÀ sổ ghi 3 cột NULL — không lỗi biên dịch, không ca hành vi thuần nào đỏ (chúng không chạm DB).
    const m = doc("lib/hoa-hong/dau-vao-chinh-sach.ts");
    expect(dem(m, "docAffiliateChoHoaHong(client,")).toBe(1);
    expect(dem(m, "const affiliate = !unknown && i.leadId")).toBe(1);
    expect(dem(m, "campaignId: affiliate?.campaignId ?? null,")).toBe(1);
    expect(dem(m, "campaignId: null")).toBe(0);
    expect(dem(m, "return { nguon, nguonChinhSach, affiliate,")).toBe(1);
    expect(dem(m, "snapshot: nguon.affiliate")).toBe(1);
  });

  it("[AFP-W2] `quet-khoan.ts`: kế hoạch mang `affiliate`; băm có `camp`; MỖI chỗ dựng dòng sổ khai ba cột (dongTuNhap · saoTuDongGoc · LEGACY) — và `DongGhi` BẮT BUỘC khai chúng", () => {
    const q = doc("lib/hoa-hong/quet-khoan.ts");
    expect(dem(q, "affiliate: dau.affiliate,")).toBe(1);
    expect(dem(q, "camp: kh.nguonChinhSach.campaignId ?? undefined")).toBe(1);
    expect(dem(q, "...cotAffiliateCuaKeHoach(kh),")).toBe(1); // dongTuNhap
    expect(dem(q, "affiliateCampaignId: g.affiliateCampaignId,")).toBe(1); // saoTuDongGoc (REVERSAL · correction · chép-từ-ô · khiếu nại)
    expect(dem(q, "affiliateMembershipId: g.affiliateMembershipId,")).toBe(1);
    expect(dem(q, "affiliateReferralId: g.affiliateReferralId,")).toBe(1);
    expect(dem(q, "affiliateCampaignId: null,")).toBe(1); // LEGACY_REVERSAL: gốc ở sổ cũ
    expect(dem(q, "affiliateMembershipId: null,")).toBe(1);
    expect(dem(q, "affiliateReferralId: null,")).toBe(1);
    const g = doc("lib/hoa-hong/ghi-so.ts");
    expect(dem(g, "export type DongGhi = Prisma.CommissionTransactionUncheckedCreateInput & CotAffiliateSo & CotNguoiHuongSo;")).toBe(1); // AFF-L2 thêm CotNguoiHuongSo (loại người hưởng) cùng khuôn
    expect(dem(g, "affiliateCampaignId: string | null;")).toBe(1); // BẮT BUỘC (không dấu `?`)
  });

  it("[AFP-W3] khiếu nại điều chỉnh dựng dòng QUA `saoTuDongGoc` (không tự dựng tay ⇒ không có chỗ thứ năm quên ba cột)", () => {
    const k = doc("lib/hoa-hong/khieu-nai-dieu-chinh.ts");
    expect(dem(k, "saoTuDongGoc(mau,")).toBe(1);
    expect(dem(k, "affiliateCampaignId")).toBe(0);
  });

  it("[AFP-W4] guardrail: CAMPAIGN không còn trong danh sách phạm vi chưa hỗ trợ; trục campaign của lưới trần lấy `scope.campaignId`", () => {
    const g = doc("lib/hoa-hong/guardrail-kich-hoat.ts");
    expect(dem(g, 'const PHAM_VI_CHUA_HO_TRO: readonly PhamVi[] = ["SOURCE", "EVENT"];')).toBe(1);
    expect(dem(g, 'pick("CAMPAIGN", (q) => q.scope.campaignId)')).toBe(1);
    expect(dem(g, 'pick("CAMPAIGN", (q) => q.scope.sourceId)')).toBe(0);
  });

  it("[AFP-W5] `chon-quy-tac.ts`: nhánh CAMPAIGN khớp theo `campaignId`, KHÔNG còn mượn `sourceId`; thứ tự mặc định vẫn đủ 9 mã (KHÔNG thêm mã thứ 10 — băm và `scopeOrderVersion` phụ thuộc nó)", () => {
    const c = doc("lib/hoa-hong/chon-quy-tac.ts");
    expect(dem(c, "q.scope.campaignId === c.campaignId")).toBe(1);
    expect(dem(c, "=== c.campaignId")).toBe(1);
    expect(PHAM_VI).toHaveLength(9);
    expect(kiemThuTuPhamVi([...THU_TU_PHAM_VI_MAC_DINH])).toHaveLength(9);
  });

  it("[AFP-W6] `quyTacTuVersion` đưa `scopeCampaignId` vào `scope.campaignId`; `cotPhamVi` ghi đúng cột (không dùng chung cột nào khác)", () => {
    const s = doc("lib/hoa-hong/chinh-sach-service.ts");
    expect(dem(s, "campaignId: v.scopeCampaignId ?? undefined,")).toBe(1);
    expect(dem(s, 'return { loai: "CAMPAIGN", campaignId: v.scopeCampaignId! };')).toBe(1);
    const d = doc("lib/hoa-hong/chinh-sach-dau-vao.ts");
    expect(dem(d, 'scopeCampaignId: p.loai === "CAMPAIGN" ? p.campaignId : null,')).toBe(1);
  });
});
