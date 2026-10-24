// @vitest-environment node
/**
 * [FX-*] — HOA HỒNG CỐ ĐỊNH `FIXED_PER_PURCHASE` (AFF-L2b, Q14 đã chốt). THUẦN — không DB, không đồng hồ.
 *
 *   [FX-T*]   `tienCoDinhTheoCoSo` — MỘT hàm quyết số tiền FIXED của một ô
 *   [FX-E*]   `tinhChinhSachChoPhan` — khoản đầu ra tiền / khoản sau KHÔNG; trần đo trên cơ sở GỐC của khoản đầu; co theo cơ sở còn lại
 *   [FX-K*]   `laKhoanDauCuaLanMua` · `laKhoanDauSauSoCai` — «khoản thu đầu của lần mua»
 *   [FX-GR*]  guardrail kích hoạt: phạm vi cho phép · cảnh báo trần theo khoản đầu
 *   [FX-UI*]  hằng nguồn cho giao diện (kiểu tính · phạm vi) và chữ giải thích
 *   [FX-VS*]  ngăn «Vì sao con số này»
 *   [FX-W*]   lưới DÂY NỐI (đọc mã nguồn, bỏ chú thích, đếm số lần khớp): cờ «khoản đầu» và cơ sở gốc đi từ đâu tới
 *
 * Mọi ca «khoản đầu» đi kèm đối chứng DƯƠNG (cùng đầu vào, khoản đầu ⇒ ra tiền) — ca chỉ khẳng định SỰ VẮNG MẶT luôn xanh khi tính năng hỏng hoàn toàn (CLAUDE.md luật 11).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { kiemKichHoat, type DauVaoKichHoat } from "./guardrail-kich-hoat";
import { KIEU_TINH_CHUA_HO_TRO } from "./guardrail-kich-hoat";
import { KIEU_TINH_HO_TRO, PHAM_VI, PHAM_VI_CHO_PHEP_FIXED, THU_TU_PHAM_VI_MAC_DINH, type PhamVi, type QuyTac } from "./chon-quy-tac";
import { laKhoanDauCuaLanMua, laKhoanDauSauSoCai } from "./khoan-dau-lan-mua";
import type { HoaHongContext } from "./kieu";
import type { KetQuaNguoiHuong } from "./nguoi-huong";
import { tienCoDinhTheoCoSo } from "./tien";
import { tinhChinhSachChoPhan, type DauVaoTinhChinhSach, type LanMuaCuaKhoan } from "./tinh-chinh-sach";
import { tinhDongChoKhoan, type DauVaoKhoan } from "./tinh-dong-cho-khoan";
import { dungViSao, type DongChoViSao } from "./vi-sao";
import { MASTER_LOAI_GIAO_DICH } from "./loai-giao-dich";
import { MASTER_VAI_HUONG } from "./vai-huong";
import { trangThaiCacKieuTinh } from "@/lib/affiliate/hoa-hong-campaign-dau-vao";

const RATE_DATE = new Date("2026-10-20T03:00:00.000Z");
let dem = 0;

function rule(roleCode: string, giaTri: number, p: Partial<QuyTac> = {}): QuyTac {
  dem += 1;
  return {
    ruleId: `r${dem}`,
    policyId: "pol-v1",
    policyCode: "SR.QD.208",
    versionId: "v1",
    version: 1,
    documentNumber: "SR.QD.208",
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
const fixedCampaign = (roleCode: string, tien: number, campaignId = "c1"): QuyTac =>
  rule(roleCode, tien, { kieuTinh: "FIXED_PER_PURCHASE", scopeType: "CAMPAIGN", scopeKey: `CAMPAIGN:${campaignId}`, scope: { campaignId } });

const VAI = MASTER_VAI_HUONG.map((v) => ({ code: v.code, resolverType: v.resolverType, resolverKey: v.resolverKey, isAcquisition: v.isAcquisition, isActive: true }));
const hh = (quyTac: QuyTac[], tran = 0.09): HoaHongContext => ({
  quyTac,
  nhomNguon: [{ id: "g1", code: "PAID_ADS", coHoaHong: true }],
  vaiHuong: VAI,
  thuTuPhamVi: [...THU_TU_PHAM_VI_MAC_DINH],
  phienBanThuTu: "v1",
  tranTongTiLe: tran,
  vatTheoNgay: [],
});
const co = (id: string): KetQuaNguoiHuong => ({ loai: "CO_NGUOI", nguoi: [{ kind: "USER", id }], biLoai: [], canCu: "test" });
const doiTac = (id: string): KetQuaNguoiHuong => ({ loai: "CO_NGUOI", nguoi: [{ kind: "AFFILIATE", id }], biLoai: [], canCu: "AFFILIATE" });
const treo: KetQuaNguoiHuong = { loai: "TREO", lyDo: "KHONG_CO_LEAD", canCu: "test" };

const dau = (quyTac: QuyTac[], lanMua: LanMuaCuaKhoan, p: Partial<DauVaoTinhChinhSach> = {}): DauVaoTinhChinhSach => ({
  hoaHong: hh(quyTac),
  loaiGiaoDich: "NEW",
  coSo: lanMua.coSoGoc,
  rateDate: RATE_DATE,
  orgUnitPath: "/ho/danang/cs1/",
  nguon: { sourceGroupId: "g1", coHoaHong: true, affiliateId: "a1", sourceId: null, campaignId: "c1", eventId: null },
  nguoiHuong: new Map<string, KetQuaNguoiHuong>([["SALE", co("u-sale")], ["AFFILIATE", doiTac("a1")]]),
  roleDefIdsTheoNguoi: new Map(),
  lanMua,
  ...p,
});
const QT = (): QuyTac[] => [rule("SALE", 0.04), fixedCampaign("AFFILIATE", 300_000)];
const DAU = (coSoGoc = 10_000_000): LanMuaCuaKhoan => ({ laKhoanDau: true, coSoGoc });
const SAU = (coSoGoc = 10_000_000): LanMuaCuaKhoan => ({ laKhoanDau: false, coSoGoc });

const ok = (r: ReturnType<typeof tinhChinhSachChoPhan>) => {
  if (r.loai !== "OK") throw new Error(`Mong OK, nhận ${r.loai}`);
  return r;
};
const vai = (r: ReturnType<typeof tinhChinhSachChoPhan>, code: string) => ok(r).cacVai.find((v) => v.roleCode === code)!;

// ═══ FX-T ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("[FX-T] tienCoDinhTheoCoSo — MỘT hàm quyết số tiền FIXED của một ô", () => {
  it("[FX-T01] cơ sở còn nguyên ⇒ ĐÚNG giá trị, không qua phép chia nào (kể cả số lẻ)", () => {
    expect(tienCoDinhTheoCoSo(300_000, 10_000_000, 10_000_000)).toBe(300_000);
    expect(tienCoDinhTheoCoSo(333_333, 7, 7)).toBe(333_333);
  });
  it("[FX-T02] ô đã hoàn một phần ⇒ co theo TỈ LỆ cơ sở còn lại, làm tròn MỘT lần (nửa lên)", () => {
    expect(tienCoDinhTheoCoSo(100_000, 6_000_000, 10_000_000)).toBe(60_000);
    expect(tienCoDinhTheoCoSo(100_001, 1, 2)).toBe(50_001); // 50.000,5 ⇒ lên
    expect(tienCoDinhTheoCoSo(100_000, 0, 10_000_000)).toBe(0); // hoàn hết ⇒ không còn gì
  });
  it("[FX-T03] cơ sở còn lại KHÔNG bao giờ làm số tiền vượt giá trị; cơ sở gốc 0 ⇒ 0; đầu vào xấu ⇒ ném (không im lặng)", () => {
    expect(tienCoDinhTheoCoSo(100_000, 12_000_000, 10_000_000)).toBe(100_000);
    expect(tienCoDinhTheoCoSo(100_000, 0, 0)).toBe(100_000); // bằng nhau ⇒ giá trị (nhánh «còn nguyên»); trần chặn đường này ở kiemTran
    expect(tienCoDinhTheoCoSo(100_000, 5, 0)).toBe(0);
    expect(() => tienCoDinhTheoCoSo(-1, 1, 1)).toThrow();
    expect(() => tienCoDinhTheoCoSo(1.5, 1, 1)).toThrow();
    expect(() => tienCoDinhTheoCoSo(1, -1, 1)).toThrow();
    expect(() => tienCoDinhTheoCoSo(1, 1, -1)).toThrow();
  });
});

// ═══ FX-E ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("[FX-E] tinhChinhSachChoPhan — khoản đầu của lần mua", () => {
  it("[FX-E01] KHOẢN ĐẦU ⇒ FIXED ra đúng giá trị (300.000) cho đối tác; Sale 4% bình thường", () => {
    const r = tinhChinhSachChoPhan(dau(QT(), DAU()));
    expect(vai(r, "AFFILIATE")).toMatchObject({ trangThai: "SINH_DONG", tienVai: 300_000 });
    expect(vai(r, "AFFILIATE").duocChi).toEqual([{ recipientId: "a1", amount: 300_000 }]);
    expect(vai(r, "SALE")).toMatchObject({ trangThai: "SINH_DONG", tienVai: 400_000 });
    expect(ok(r).tiLeTuongDuong).toBeCloseTo(0.07, 9);
  });

  it("[FX-E02] KHOẢN SAU ⇒ FIXED KHÔNG ra tiền (KHONG_TIEN, 0 phần chia, không treo, nêu lý do); Sale 4% GIỮ NGUYÊN (đối chứng dương: cùng đầu vào, khoản đầu ra 300.000)", () => {
    const r = tinhChinhSachChoPhan(dau(QT(), SAU()));
    const aff = vai(r, "AFFILIATE");
    expect(aff).toMatchObject({ trangThai: "KHONG_TIEN", tienVai: 0, duocChi: [], cacPhan: [], treoPhan: [], lyDoTreo: null });
    expect(aff.lyDo).toContain("MỘT lần cho mỗi lần mua");
    expect(vai(r, "SALE")).toMatchObject({ trangThai: "SINH_DONG", tienVai: 400_000 });
    expect(vai(tinhChinhSachChoPhan(dau(QT(), DAU())), "AFFILIATE").tienVai).toBe(300_000);
  });

  it("[FX-E03] PERCENT KHÔNG đọc cờ «khoản đầu»: khoản đầu và khoản sau cho CÙNG kết quả phần trăm (chỉ rule FIXED khác nhau)", () => {
    const chiPhanTram = [rule("SALE", 0.04), rule("AFFILIATE", 0.03, { scopeType: "CAMPAIGN", scopeKey: "CAMPAIGN:c1", scope: { campaignId: "c1" } })];
    const a = ok(tinhChinhSachChoPhan(dau(chiPhanTram, DAU())));
    const b = ok(tinhChinhSachChoPhan(dau(chiPhanTram, SAU())));
    expect(b).toEqual(a);
  });

  it("[FX-E04] FIXED KHÔNG vào trần ở khoản sau: khoản sau CHỈ 500.000đ (300.000 ÷ 500.000 = 60%) vẫn OK; khoản ĐẦU cùng cơ sở ấy ⇒ VUOT_TRAN (đối chứng dương)", () => {
    const sau = tinhChinhSachChoPhan(dau(QT(), SAU(500_000)));
    expect(sau.loai).toBe("OK");
    expect(vai(sau, "SALE").tienVai).toBe(20_000);
    const dauNho = tinhChinhSachChoPhan(dau(QT(), DAU(500_000)));
    expect(dauNho.loai).toBe("VUOT_TRAN");
    if (dauNho.loai === "VUOT_TRAN") expect(dauNho.tiLeTuongDuong).toBeCloseTo(0.04 + 0.6, 9);
  });

  it("[FX-E05] trần đo CHÍNH XÁC ở biên: Sale 4% + FIXED 500.000 ÷ 10tr = 9% ⇒ OK (≤ trần); 500.001 ⇒ VUOT_TRAN; không epsilon", () => {
    expect(tinhChinhSachChoPhan(dau([rule("SALE", 0.04), fixedCampaign("AFFILIATE", 500_000)], DAU())).loai).toBe("OK");
    expect(tinhChinhSachChoPhan(dau([rule("SALE", 0.04), fixedCampaign("AFFILIATE", 500_001)], DAU())).loai).toBe("VUOT_TRAN");
  });

  it("[FX-E06] Ô ĐÃ HOÀN MỘT PHẦN (tính lại trên cơ sở CÒN LẠI 6tr, cơ sở gốc 10tr): tiền FIXED co theo ⇒ 60.000 (không phải 100.000); trần vẫn đo trên cơ sở GỐC ⇒ KHÔNG lật sang VUOT_TRAN", () => {
    const qt = [rule("SALE", 0.04), fixedCampaign("AFFILIATE", 400_000)]; // 4% + 4% = 8% trên cơ sở gốc
    const conLai = tinhChinhSachChoPhan(dau(qt, DAU(10_000_000), { coSo: 6_000_000 }));
    expect(conLai.loai, "đo trần trên cơ sở còn lại sẽ là 400.000÷6tr + 4% = 10,67% ⇒ VUOT_TRAN").toBe("OK");
    expect(vai(conLai, "AFFILIATE").tienVai).toBe(240_000); // 400.000 × 6 ÷ 10
    expect(vai(conLai, "SALE").tienVai).toBe(240_000); // 4% × 6tr
    expect(ok(conLai).tiLeTuongDuong).toBeCloseTo(0.08, 9);
    // ĐỐI CHỨNG: nếu cơ sở gốc cũng chỉ 6tr thì 400.000÷6tr = 6,67% + 4% ⇒ vượt (chứng minh ca ở trên đo đúng cơ sở GỐC chứ không phải trần rộng)
    expect(tinhChinhSachChoPhan(dau(qt, DAU(6_000_000))).loai).toBe("VUOT_TRAN");
  });

  it("[FX-E07] người hưởng đang TREO ở khoản sau ⇒ KHÔNG treo (không có gì để treo, không hàng chờ); ở khoản ĐẦU ⇒ TREO mang tiền cố định (đối chứng dương)", () => {
    const nguoi = new Map<string, KetQuaNguoiHuong>([["SALE", co("u-sale")], ["AFFILIATE", treo]]);
    const sau = tinhChinhSachChoPhan(dau(QT(), SAU(), { nguoiHuong: nguoi }));
    expect(vai(sau, "AFFILIATE")).toMatchObject({ trangThai: "KHONG_TIEN", tienVai: 0, lyDoTreo: null });
    const dauR = tinhChinhSachChoPhan(dau(QT(), DAU(), { nguoiHuong: nguoi }));
    expect(vai(dauR, "AFFILIATE")).toMatchObject({ trangThai: "TREO", tienVai: 300_000 });
  });

  it("[FX-E08] tinhDongChoKhoan: khoản đầu ⇒ 1 dòng AFFILIATE 300.000; khoản sau ⇒ 0 dòng AFFILIATE, `vaiKhongTien` ghi KHONG_TIEN, `treo` rỗng", () => {
    const goc = (lanMua: LanMuaCuaKhoan): DauVaoKhoan => ({ ...dau(QT(), lanMua), ngoaiCuaSo: false, daTraBangEngineCu: new Set(), baoVeCampaign: false });
    const a = tinhDongChoKhoan(goc(DAU()));
    if (a.loai !== "OK") throw new Error(a.loai);
    expect(a.dong.filter((d) => d.roleCode === "AFFILIATE").map((d) => d.amount)).toEqual([300_000]);
    const b = tinhDongChoKhoan(goc(SAU()));
    if (b.loai !== "OK") throw new Error(b.loai);
    expect(b.dong.filter((d) => d.roleCode === "AFFILIATE")).toEqual([]);
    expect(b.treo).toEqual([]);
    expect(b.vaiKhongTien.find((v) => v.roleCode === "AFFILIATE")?.trangThai).toBe("KHONG_TIEN");
    expect(b.dong.find((d) => d.roleCode === "SALE")?.amount).toBe(400_000);
  });

  it("[FX-E09] FIXED ở phạm vi PERSON/AFFILIATE cũng theo cùng luật (không chỉ CAMPAIGN): khoản sau 0, khoản đầu đúng giá trị", () => {
    const qt = [rule("SALE", 0.04), rule("AFFILIATE", 200_000, { kieuTinh: "FIXED_PER_PURCHASE", scopeType: "AFFILIATE", scopeKey: "AFFILIATE:a1", scope: { affiliateId: "a1" } })];
    expect(vai(tinhChinhSachChoPhan(dau(qt, DAU())), "AFFILIATE").tienVai).toBe(200_000);
    expect(vai(tinhChinhSachChoPhan(dau(qt, SAU())), "AFFILIATE").tienVai).toBe(0);
  });
});

// ═══ FX-K ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("[FX-K] «khoản thu đầu của lần mua»", () => {
  const dong = (...ids: string[]) => ids.map((orderItemId) => ({ orderItemId, loai: "COURSE_ENROLLMENT", enrollmentId: null, studentId: "s1", enrollmentStudentId: null, phaiThu: 10_000_000 }));
  const khoan = (orderItemId: string | null, amount = 5_000_000) => ({ amount, orderItemId, enrollmentId: null, enrollmentStudentId: null });
  const chung = { adjustmentOfId: null, orderType: "COURSE", hocVienTheoLeadChild: null };

  it("[FX-K01] chưa có khoản nào trước ⇒ LÀ khoản đầu; có một khoản trước vào CÙNG dòng ⇒ KHÔNG", () => {
    expect(laKhoanDauCuaLanMua({ ...chung, orderItemId: "i1", dong: dong("i1"), khoanTruoc: [] })).toBe(true);
    expect(laKhoanDauCuaLanMua({ ...chung, orderItemId: "i1", dong: dong("i1"), khoanTruoc: [khoan("i1")] })).toBe(false);
    expect(laKhoanDauCuaLanMua({ ...chung, orderItemId: "i1", dong: dong("i1"), khoanTruoc: [khoan("i1"), khoan("i1")] })).toBe(false);
  });

  it("[FX-K02] khoản trước vào dòng KHÁC của đơn nhiều dòng ⇒ khoản này VẪN là khoản đầu của dòng của nó (lần mua là DÒNG, không là đơn)", () => {
    expect(laKhoanDauCuaLanMua({ ...chung, orderItemId: "i2", dong: dong("i1", "i2"), khoanTruoc: [khoan("i1")] })).toBe(true);
    expect(laKhoanDauCuaLanMua({ ...chung, orderItemId: "i1", dong: dong("i1", "i2"), khoanTruoc: [khoan("i1")] })).toBe(false);
  });

  it("[FX-K03] khoản trước KHÔNG gắn dòng nhưng `phanBoKhoan` quy được về dòng này (đơn một dòng) ⇒ KHÔNG phải khoản đầu; đối chứng: không có khoản trước ⇒ khoản đầu", () => {
    expect(laKhoanDauCuaLanMua({ ...chung, orderItemId: "i1", dong: dong("i1"), khoanTruoc: [khoan(null)] })).toBe(false);
    expect(laKhoanDauCuaLanMua({ ...chung, orderItemId: "i1", dong: dong("i1"), khoanTruoc: [] })).toBe(true);
  });

  it("[FX-K04] bút toán ĐIỀU CHỈNH không bao giờ là khoản đầu (sửa số của chính lần thu ấy, không phải lần thu mới)", () => {
    expect(laKhoanDauCuaLanMua({ ...chung, adjustmentOfId: "p-goc", orderItemId: "i1", dong: dong("i1"), khoanTruoc: [] })).toBe(false);
    expect(laKhoanDauCuaLanMua({ ...chung, adjustmentOfId: null, orderItemId: "i1", dong: dong("i1"), khoanTruoc: [] })).toBe(true);
  });

  it("[FX-K05] lớp sổ cái: có CHỦ trong sổ ⇒ chỉ ĐÚNG khoản chủ là khoản đầu (kể cả khi không còn là khoản sớm nhất); chưa có chủ ⇒ theo thứ tự", () => {
    expect(laKhoanDauSauSoCai(true, "p2", "p2")).toBe(true);
    expect(laKhoanDauSauSoCai(false, "p2", "p2")).toBe(true); // chủ không trôi khi có khoản đến TRỄ
    expect(laKhoanDauSauSoCai(true, "p1", "p2")).toBe(false); // khoản sớm hơn đến sau KHÔNG nhận lần hai
    expect(laKhoanDauSauSoCai(true, "p1", null)).toBe(true);
    expect(laKhoanDauSauSoCai(false, "p1", null)).toBe(false);
  });
});

// ═══ FX-GR ══════════════════════════════════════════════════════════════════════════════════════════════

describe("[FX-GR] guardrail kích hoạt cho FIXED", () => {
  const HIEU_LUC = new Date("2026-03-22T17:00:00.000Z");
  const VAI_G = new Map<string, { isActive: boolean; resolverType: "TRANSACTION_ROLE" | "ORG_UNIT_ROLE" | "DIRECT_PERSON"; resolverKey: string | null }>([
    ["SALE", { isActive: true, resolverType: "TRANSACTION_ROLE", resolverKey: null }],
    ["AFFILIATE", { isActive: true, resolverType: "DIRECT_PERSON", resolverKey: "AFFILIATE" }],
  ]);
  const pv = (scopeType: PhamVi) => ({ id: "v-moi", policyId: "pol-moi", scopeType, scopeKey: scopeType === "GLOBAL" ? "GLOBAL" : `${scopeType}:x`, effectiveFrom: HIEU_LUC, effectiveTo: null, orgUnitId: null, orgUnitPath: "/" });
  const phamViCua = (p: PhamVi): Partial<QuyTac> => {
    switch (p) {
      case "GLOBAL": return {};
      case "PERSON": return { scope: { userId: "x" } };
      case "AFFILIATE": return { scope: { affiliateId: "x" } };
      case "SOURCE": return { scope: { sourceId: "x" } };
      case "CAMPAIGN": return { scope: { campaignId: "x" } };
      case "EVENT": return { scope: { sourceId: "x" } };
      case "SOURCE_GROUP": return { scope: { sourceGroupId: "x" } };
      case "ORG_UNIT": return { scope: { orgUnitId: "x", orgUnitPath: "/" } };
      case "ROLE": return { scope: { roleDefId: "x" } };
    }
  };
  const dauG = (p: PhamVi, q: Partial<QuyTac> = {}): DauVaoKichHoat => ({
    phienBan: pv(p),
    vanBan: { documentCode: "SR.QD.999", title: "Quy định", issuedOn: "2026-02-20", publishedOn: "2026-03-02", effectiveOn: "2026-03-23", approvedByName: "Hồ Đắc Phúc", coTep: true, daThuHoi: false },
    quyTacDeXuat: [rule("AFFILIATE", 100_000, { kieuTinh: "FIXED_PER_PURCHASE", scopeType: p, scopeKey: pv(p).scopeKey, ...phamViCua(p), ...q })],
    quyTacDangHieuLuc: [],
    phienBanKhac: [],
    loaiGiaoDich: MASTER_LOAI_GIAO_DICH,
    vaiHuong: VAI_G,
    coSoThieuNguoiPhuTrach: [],
    nhomNguon: [{ id: "g1", code: "PAID_ADS", dangHoatDong: true, coHoaHong: true, ownerEmployeeId: "e1", referrerRequirement: "NONE" }],
    nghi: [],
    coSoTrongPhamVi: new Set(),
    soNgayLamViec: 15,
    tranTongTiLe: 0.09,
    thuTuPhamVi: [...THU_TU_PHAM_VI_MAC_DINH],
    now: new Date("2026-10-08T03:00:00.000Z"),
  });
  const maLoi = (d: DauVaoKichHoat) => kiemKichHoat(d).loi.map((l) => l.ma).sort();

  it("[FX-GR01] phạm vi CHO PHÉP: đúng PERSON · AFFILIATE · CAMPAIGN (hằng MỘT chỗ)", () => {
    expect([...PHAM_VI_CHO_PHEP_FIXED].sort()).toEqual(["AFFILIATE", "CAMPAIGN", "PERSON"]);
  });

  it("[FX-GR02] FIXED ở mỗi phạm vi: được phép ⇒ không FIXED_PHAM_VI_RONG; mọi phạm vi KHÁC (GLOBAL · ORG_UNIT · ROLE · SOURCE_GROUP · SOURCE · EVENT) ⇒ FIXED_PHAM_VI_RONG; không phạm vi nào dính KIEU_TINH_CHUA_HO_TRO", () => {
    for (const p of PHAM_VI) {
      const ma = maLoi(dauG(p));
      const duocPhep = PHAM_VI_CHO_PHEP_FIXED.includes(p);
      expect(ma.includes("FIXED_PHAM_VI_RONG"), `${p}: ${ma.join(",")}`).toBe(!duocPhep);
      expect(ma, p).not.toContain("KIEU_TINH_CHUA_HO_TRO");
    }
  });

  it("[FX-GR03] đối chứng: PERCENT ở phạm vi rộng KHÔNG bị mã này; TIER vẫn KIEU_TINH_CHUA_HO_TRO", () => {
    expect(maLoi(dauG("GLOBAL", { kieuTinh: "PERCENT", giaTri: 0.01, roleCode: "SALE" }))).not.toContain("FIXED_PHAM_VI_RONG");
    expect(maLoi(dauG("CAMPAIGN", { kieuTinh: "TIER_PERIOD_BONUS", giaTri: 0 }))).toContain("KIEU_TINH_CHUA_HO_TRO");
  });

  it("[FX-GR04] cảnh báo trần theo KHOẢN THU ĐẦU có mặt khi và chỉ khi đề xuất có FIXED; nêu mức cố định lớn nhất", () => {
    const co = kiemKichHoat(dauG("CAMPAIGN"));
    const w = co.canhBao.find((c) => c.ma === "FIXED_TRAN_THEO_KHOAN_DAU");
    expect(w?.thongBao).toContain("khoản thu ĐẦU");
    expect(w?.thongBao).toContain("100.000");
    const khong = kiemKichHoat(dauG("CAMPAIGN", { kieuTinh: "PERCENT", giaTri: 0.01, roleCode: "SALE" }));
    expect(khong.canhBao.map((c) => c.ma)).not.toContain("FIXED_TRAN_THEO_KHOAN_DAU");
  });

  it("[FX-GR05] FIXED tham gia lưới trần của guardrail: GLOBAL Sale 4% + CAMPAIGN FIXED 500.000 (5% trên khoản chuẩn 10tr) + GLOBAL 5% khác ⇒ VUOT_TRAN; đối chứng: FIXED nhỏ ⇒ không vượt", () => {
    const chung = [rule("SALE", 0.08, { policyId: "pol-chung", policyCode: "POL-CHUNG", versionId: "v-chung", version: 1 })];
    expect(maLoi({ ...dauG("CAMPAIGN", { giaTri: 500_000 }), quyTacDangHieuLuc: chung })).toContain("VUOT_TRAN");
    expect(maLoi({ ...dauG("CAMPAIGN", { giaTri: 50_000 }), quyTacDangHieuLuc: chung })).not.toContain("VUOT_TRAN");
  });
});

// ═══ FX-UI ══════════════════════════════════════════════════════════════════════════════════════════════

describe("[FX-UI] hằng nguồn cho giao diện", () => {
  it("[FX-UI01] KIEU_TINH_HO_TRO = PERCENT · EXCLUDE · FIXED; KIEU_TINH_CHUA_HO_TRO (suy ra từ nó) chỉ còn TIER — hai hằng KHÔNG thể lệch nhau", () => {
    expect([...KIEU_TINH_HO_TRO].sort()).toEqual(["EXCLUDE", "FIXED_PER_PURCHASE", "PERCENT"]);
    expect([...KIEU_TINH_CHUA_HO_TRO]).toEqual(["TIER_PERIOD_BONUS"]);
    for (const k of KIEU_TINH_CHUA_HO_TRO) expect(KIEU_TINH_HO_TRO).not.toContain(k);
  });

  it("[FX-UI02] mục «Cách tính» của campaign: «Cố định» dùng được và NÓI ĐÚNG cách tính (một lần cho mỗi lần mua, tại khoản thu đầu tiên, hoàn tiền theo tỉ lệ, trần theo khoản đầu); «Phần trăm» không mang câu của cố định", () => {
    const t = trangThaiCacKieuTinh();
    const fx = t.find((x) => x.kieu === "FIXED_PER_PURCHASE")!;
    const pc = t.find((x) => x.kieu === "PERCENT")!;
    expect(fx.dungDuoc).toBe(true);
    expect(fx.ghiChu).toContain("trả một lần cho mỗi lần mua, tại khoản thu đầu tiên đủ điều kiện");
    expect(fx.ghiChu).toContain("hoàn tiền thu hồi theo tỉ lệ");
    expect(fx.ghiChu).toContain("khoản thu đầu");
    expect(fx.ghiChu).not.toContain("Chưa kích hoạt");
    expect(pc.dungDuoc).toBe(true);
    expect(pc.ghiChu).not.toContain("một lần cho mỗi lần mua");
  });
});

// ═══ FX-VS ══════════════════════════════════════════════════════════════════════════════════════════════

describe("[FX-VS] ngăn «Vì sao con số này» của dòng cố định", () => {
  const dong = (p: Partial<DongChoViSao> = {}): DongChoViSao => ({
    entryKind: "ORIGINAL",
    amount: 300_000,
    grossAmount: 10_000_000,
    vatRate: 0,
    netBase: 10_000_000,
    rate: null,
    fixedAmount: 300_000,
    capRate: 0.09,
    equivalentRate: 0.07,
    sourceGroupCode: "PAID_ADS",
    transactionTypeCode: "NEW",
    roleCode: "AFFILIATE",
    splitMethod: "DONG",
    documentNumber: "SR.QD.1",
    versionNo: 1,
    calcKind: "FIXED_PER_PURCHASE",
    reason: "CAMPAIGN · SR.QD.1 · POL v1 (rule duy nhất khớp)",
    reasonCode: null,
    naturalPeriod: "2026-10",
    kyGhi: "2026-10",
    lateArrival: false,
    refEntryId: null,
    refEventType: null,
    refEventId: null,
    resolverBasis: {},
    paymentId: "p1",
    ...p,
  });
  const toanVan = (d: DongChoViSao) => JSON.stringify(dungViSao(d, true).buoc);

  it("[FX-VS01] dòng gốc: nêu số cố định · MỘT lần ở khoản thu đầu tiên · tỉ lệ hiệu dụng 3% so với cơ sở 10.000.000đ", () => {
    const t = toanVan(dong());
    expect(t).toContain("Số tiền cố định 300.000đ cho lần mua này");
    expect(t).toContain("MỘT lần cho mỗi lần mua, tại khoản thu đầu tiên đủ điều kiện");
    expect(t).toContain("Tỉ lệ hiệu dụng 3% so với cơ sở 10.000.000đ");
    expect(t).toContain("quy đổi thành tỉ lệ theo khoản thu đầu tiên");
  });

  it("[FX-VS02] dòng ĐIỀU CHỈNH mang cơ sở CÒN LẠI ⇒ KHÔNG bịa tỉ lệ hiệu dụng (luật 12); đối chứng dương: dòng gốc có", () => {
    expect(toanVan(dong({ entryKind: "SOURCE_CORRECTION", netBase: 6_000_000 }))).not.toContain("Tỉ lệ hiệu dụng");
    expect(toanVan(dong())).toContain("Tỉ lệ hiệu dụng");
  });

  it("[FX-VS03] dòng PHẦN TRĂM không mang câu của cố định", () => {
    const t = toanVan(dong({ calcKind: "PERCENT", rate: 0.04, fixedAmount: null, amount: 400_000 }));
    expect(t).not.toContain("MỘT lần cho mỗi lần mua");
    expect(t).not.toContain("quy đổi thành tỉ lệ");
  });
});

// ═══ FX-W ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Đọc tệp nguồn, BỎ CHÚ THÍCH (chú thích giải thích bản vá hay chứa đúng chuỗi đang canh — luật 11). */
function doc(duong: string): string {
  const s = readFileSync(resolve(process.cwd(), duong), "utf8");
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");
}
const dem2 = (g: string, mau: string): number => g.split(mau).length - 1;

describe("[FX-W] dây nối: cờ «khoản đầu» và cơ sở gốc đi từ đâu tới", () => {
  it("[FX-W01] lapThu gọi `laKhoanDauCuaLanMuaNay` ĐÚNG MỘT lần và truyền kết quả (không hằng); `dauVao` của kế hoạch buộc cơ sở gốc = `vat.netBase`", () => {
    const g = doc("lib/hoa-hong/quet-khoan.ts");
    expect(dem2(g, "laKhoanDauLanMua: await laKhoanDauCuaLanMuaNay(")).toBe(1);
    expect(dem2(g, "dauVao: (coSo: number) => dau.dauVao(coSo, vat.netBase)")).toBe(1);
    expect(dem2(g, "laKhoanDauLanMua: true")).toBe(0);
    expect(dem2(g, "laKhoanDauLanMua: false")).toBe(0);
    // lớp sổ cái chỉ chạy khi bộ quy tắc đang nạp có rule FIXED (không phát sinh câu tra cho người không dùng FIXED)
    expect(dem2(g, 'q.kieuTinh === "FIXED_PER_PURCHASE"')).toBeGreaterThanOrEqual(1);
    expect(dem2(g, "laKhoanDauSauSoCai(thuan, p.id, await docChuFixedTrongSo(client, orderItemId))")).toBe(1);
  });

  it("[FX-W02] «dự kiến của bạn» (doc-so): khoản sắp tới là khoản đầu CHỈ khi lần mua chưa thu đồng nào; cơ sở gốc = chính cơ sở dự kiến", () => {
    const g = doc("lib/hoa-hong/doc-so.ts");
    expect(dem2(g, "laKhoanDauLanMua: (daThu._sum.amount ?? 0) === 0")).toBe(1);
    expect(dem2(g, "dv.dauVao(netDuKien, netDuKien)")).toBe(1);
  });

  it("[FX-W03] xem trước campaign dựng `lanMua` khoản đầu với cơ sở là chính cơ sở mẫu; thử tính (`tinhHaiKichBan`) đi qua `kh.dauVao` của lapThu nên thừa hưởng cờ thật", () => {
    expect(dem2(doc("lib/affiliate/xem-truoc-hoa-hong.ts"), "lanMua: { laKhoanDau: true, coSoGoc: d.coSo }")).toBe(1);
    const mp = doc("lib/hoa-hong/mo-phong-db.ts");
    expect(dem2(mp, "kh.dauVao")).toBeGreaterThanOrEqual(1);
    expect(dem2(mp, "laKhoanDau")).toBe(0); // KHÔNG tự đặt cờ ở thử tính
  });

  it("[FX-W04] `tinhChinhSachChoPhan`: số tiền FIXED chỉ đi qua `tienCoDinhTheoCoSo` (một hàm), và phép trần đo trên `coSoGoc` khi có FIXED vào phép kiểm", () => {
    const g = doc("lib/hoa-hong/tinh-chinh-sach.ts");
    expect(dem2(g, "tienCoDinhTheoCoSo(Number(q.giaTri), d.coSo, d.lanMua.coSoGoc)")).toBe(1);
    expect(dem2(g, "coSo: coFixedTinhTran ? d.lanMua.coSoGoc : d.coSo")).toBe(1);
    expect(dem2(g, 'q.kieuTinh === "FIXED_PER_PURCHASE" && d.lanMua.laKhoanDau')).toBe(1);
    expect(dem2(g, 'q.kieuTinh === "FIXED_PER_PURCHASE" && !d.lanMua.laKhoanDau')).toBe(1);
  });

  it("[FX-W06] `dungDauVaoChinhSach` chuyển cờ khoản đầu do người gọi truyền (không hằng) và cơ sở gốc do người gọi truyền (KHÔNG có mặc định)", () => {
    const g = doc("lib/hoa-hong/dau-vao-chinh-sach.ts");
    expect(dem2(g, "lanMua: { laKhoanDau: i.laKhoanDauLanMua, coSoGoc }")).toBe(1);
    expect(dem2(g, "laKhoanDau: true")).toBe(0);
    expect(dem2(g, "laKhoanDau: false")).toBe(0);
    expect(dem2(g, "dauVao: (coSo: number, coSoGoc: number) => DauVaoKhoan")).toBe(1);
  });

  it("[FX-W05] guardrail đọc phạm vi cho phép từ MỘT hằng; không gõ lại danh sách phạm vi", () => {
    const g = doc("lib/hoa-hong/guardrail-kich-hoat.ts");
    expect(dem2(g, "PHAM_VI_CHO_PHEP_FIXED.includes(q.scopeType)")).toBe(1);
    expect(dem2(g, '"FIXED_PHAM_VI_RONG"')).toBe(1);
  });
});
