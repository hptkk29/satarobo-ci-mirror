// @vitest-environment node
/**
 * [AFL1-XT-*] — XEM TRƯỚC hoa hồng dự kiến của campaign (AFF-L1). Phần tính chạy CHÍNH `tinhChinhSachChoPhan`; ở đây đo cách nối đầu vào và cách nói thật.
 *
 *   [AFL1-XT-01] quy tắc CAMPAIGN thắng mức nền: đối tác nhận đúng 3% × cơ sở; vai khác không ra tiền nhưng VẪN vào trần
 *   [AFL1-XT-02] vượt trần ⇒ VUOT_TRAN (không ra tiền), nói trần và tổng
 *   [AFL1-XT-03] không có quy tắc CAMPAIGN ⇒ rơi về mức nền (đối chứng: cùng đầu vào, bỏ quy tắc campaign thì số đổi)
 *   [AFL1-XT-04] kiểu cố định ra số tiền cố định; EXCLUDE ra 0 và được ghi chú
 *   [AFL1-XT-05] campaign khác không dính quy tắc (đối chứng âm của việc khớp theo campaignId)
 */
import { describe, expect, it } from "vitest";
import { THU_TU_PHAM_VI_MAC_DINH, type QuyTac } from "@/lib/hoa-hong/chon-quy-tac";
import type { HoaHongContext } from "@/lib/hoa-hong/kieu";
import { MASTER_VAI_HUONG } from "@/lib/hoa-hong/vai-huong";
import { tinhXemTruocHoaHong } from "./xem-truoc-hoa-hong";

const NOW = new Date("2026-10-20T03:00:00.000Z");
let dem = 0;
function rule(roleCode: string, giaTri: number, p: Partial<QuyTac> = {}): QuyTac {
  dem += 1;
  return {
    ruleId: `r${dem}`,
    policyId: "pol-1",
    policyCode: "SR.QD.1",
    versionId: "v1",
    version: 1,
    documentNumber: "SR.QD.1",
    scopeType: "GLOBAL",
    scopeKey: "GLOBAL",
    scope: {},
    orgUnitId: null,
    orgUnitPath: "/",
    orgUnitDepth: -1,
    transactionType: "NEW",
    roleCode,
    revenueComponent: "TUITION",
    kieuTinh: "PERCENT",
    giaTri,
    effectiveFrom: new Date("2026-03-01T00:00:00.000Z"),
    effectiveTo: null,
    trangThai: "ACTIVE",
    ...p,
  };
}
const campaignRule = (roleCode: string, giaTri: number, p: Partial<QuyTac> = {}) =>
  rule(roleCode, giaTri, { policyId: "pol-camp", policyCode: "AFF-X", versionId: "vc", scopeType: "CAMPAIGN", scopeKey: "CAMPAIGN:c1", scope: { campaignId: "c1" }, ...p });

const VAI = MASTER_VAI_HUONG.map((v) => ({ code: v.code, resolverType: v.resolverType, resolverKey: v.resolverKey, isAcquisition: v.isAcquisition, isActive: true }));
const hh = (quyTac: QuyTac[], tran = 0.09): HoaHongContext => ({
  quyTac,
  nhomNguon: [{ id: "g1", code: "PARTNER", coHoaHong: true }],
  vaiHuong: VAI,
  thuTuPhamVi: [...THU_TU_PHAM_VI_MAC_DINH],
  phienBanThuTu: "v1",
  tranTongTiLe: tran,
  vatTheoNgay: [],
});
const dauVao = (quyTac: QuyTac[], p: { tran?: number; campaignId?: string } = {}) => ({
  hoaHong: hh(quyTac, p.tran),
  campaign: { id: p.campaignId ?? "c1", ten: "Tết 2027" },
  nguon: { sourceGroupId: "g1", ten: "Đối tác giới thiệu", coHoaHong: true },
  doiTac: { id: "a1", ten: "Cô Lan" },
  chinhSach: { policyCode: "AFF-X", versionNo: 1, trangThai: "DRAFT" as const },
  loaiGd: "NEW" as const,
  coSo: 10_000_000,
  rateDate: NOW,
});
const GLOBAL = () => [rule("SALE", 0.04), rule("AFFILIATE", 0.01)];

describe("[AFL1-XT-01] quy tắc CAMPAIGN thắng", () => {
  it("đối tác nhận 3% × 10.000.000 = 300.000; Sale (không người) không ra tiền nhưng vẫn vào trần (Σ = 4% + 3% = 7%)", () => {
    const r = tinhXemTruocHoaHong(dauVao([...GLOBAL(), campaignRule("AFFILIATE", 0.03)]));
    expect(r.loai).toBe("OK");
    if (r.loai !== "OK") return;
    expect(r.campaign).toBe("Tết 2027");
    expect(r.nguon).toBe("Đối tác giới thiệu");
    expect(r.doiTac).toBe("Cô Lan");
    expect(r.suKien).toContain("khách hàng mới");
    expect(r.coSo).toBe(10_000_000);
    const aff = r.vai.find((v) => v.roleCode === "AFFILIATE")!;
    expect(aff).toMatchObject({ quyTac: "3%", soTien: 300_000 });
    const sale = r.vai.find((v) => v.roleCode === "SALE")!;
    expect(sale.soTien).toBeNull();
    expect(sale.ghiChu).toContain("chỉ tính vào trần");
    expect(r.tiLeTuongDuong).toBeCloseTo(0.07, 6);
    expect(r.tran).toBe(0.09);
  });
});

describe("[AFL1-XT-02] vượt trần", () => {
  it("Σ 4% + 6% = 10% > 9% ⇒ VUOT_TRAN kèm số, không có dòng tiền nào", () => {
    const r = tinhXemTruocHoaHong(dauVao([...GLOBAL(), campaignRule("AFFILIATE", 0.06)]));
    expect(r.loai).toBe("VUOT_TRAN");
    if (r.loai === "VUOT_TRAN") {
      expect(r.tiLe).toBeCloseTo(0.1, 6);
      expect(r.tran).toBe(0.09);
    }
  });
  it("đối chứng dương: đúng trần (4% + 5% = 9%) vẫn tính được", () => {
    expect(tinhXemTruocHoaHong(dauVao([...GLOBAL(), campaignRule("AFFILIATE", 0.05)])).loai).toBe("OK");
  });
});

describe("[AFL1-XT-03] không có quy tắc campaign ⇒ rơi về mức nền", () => {
  it("cùng đầu vào, thiếu quy tắc campaign ⇒ đối tác chỉ nhận 1% = 100.000", () => {
    const r = tinhXemTruocHoaHong(dauVao(GLOBAL()));
    expect(r.loai === "OK" && r.vai.find((v) => v.roleCode === "AFFILIATE")!.soTien).toBe(100_000);
  });
});

describe("[AFL1-XT-04] cố định và loại trừ", () => {
  it("FIXED_PER_PURCHASE ra đúng số tiền cố định, nói «mỗi lần mua»", () => {
    const r = tinhXemTruocHoaHong(dauVao([...GLOBAL(), campaignRule("AFFILIATE", 500_000, { kieuTinh: "FIXED_PER_PURCHASE" })]));
    expect(r.loai).toBe("OK");
    if (r.loai !== "OK") return;
    const aff = r.vai.find((v) => v.roleCode === "AFFILIATE")!;
    expect(aff.soTien).toBe(500_000);
    expect(aff.quyTac).toContain("mỗi lần mua");
    expect(aff.quyTac).toContain("trả một lần, ở khoản thu đầu");
    expect(r.suKien, "ví dụ có số cố định phải nói nó là khoản thu ĐẦU").toContain("khoản thu ĐẦU của lần mua");
  });
  it("[FX-XT] ĐỐI CHỨNG: chỉ có phần trăm ⇒ KHÔNG mang câu «khoản thu ĐẦU» (câu ấy chỉ thật với số cố định)", () => {
    const r = tinhXemTruocHoaHong(dauVao([...GLOBAL(), campaignRule("AFFILIATE", 0.03)]));
    expect(r.loai === "OK" && r.suKien).not.toContain("khoản thu ĐẦU");
  });
  it("EXCLUDE ở campaign ⇒ đối tác không nhận, có ghi chú «Loại trừ rõ ràng» (khác «không có quy tắc»)", () => {
    const r = tinhXemTruocHoaHong(dauVao([...GLOBAL(), campaignRule("AFFILIATE", 0, { kieuTinh: "EXCLUDE" })]));
    expect(r.loai).toBe("OK");
    if (r.loai !== "OK") return;
    const aff = r.vai.find((v) => v.roleCode === "AFFILIATE")!;
    expect(aff.soTien).toBeNull();
    expect(aff.ghiChu).toBe("Loại trừ rõ ràng");
    expect(aff.quyTac).toBe("không trả");
  });
});

describe("[AFL1-XT-05] khớp theo campaignId", () => {
  it("quy tắc của campaign KHÁC không áp: đối tác rơi về 1%", () => {
    const r = tinhXemTruocHoaHong(dauVao([...GLOBAL(), campaignRule("AFFILIATE", 0.03, { scope: { campaignId: "c-khac" }, scopeKey: "CAMPAIGN:c-khac" })]));
    expect(r.loai === "OK" && r.vai.find((v) => v.roleCode === "AFFILIATE")!.soTien).toBe(100_000);
  });
});
