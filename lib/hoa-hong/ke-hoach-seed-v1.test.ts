// @vitest-environment node
/**
 * [NHH-SEED-*] — kế hoạch seed chính sách v1 = SR.QD.208 (04 §6.7). THUẦN + kiểm tĩnh script chạy tay.
 */
import { describe, it, expect } from "vitest";

import { DANH_MUC_GOC } from "@/lib/nguon/danh-muc-goc";
import { kiemRuleDauVao } from "./chinh-sach-dau-vao";
import { THU_TU_PHAM_VI_MAC_DINH, type QuyTac } from "./chon-quy-tac";
import { kiemKichHoat, type DauVaoKichHoat } from "./guardrail-kich-hoat";
import { MASTER_LOAI_GIAO_DICH } from "./loai-giao-dich";
import { tinhChinhSachChoPhan } from "./tinh-chinh-sach";
import type { HoaHongContext } from "./kieu";
import type { KetQuaNguoiHuong } from "./nguoi-huong";
import { HIEU_LUC_MAC_DINH_SR208, MA_VAN_BAN_SR208, NGAY_BAN_HANH_SR208, lapKeHoachSeedV1 } from "./ke-hoach-seed-v1";
import { kiemTran } from "./tien";
import { kiemHieuLucSauCongBo } from "./ngay-lam-viec";
import { MA_VAI_HUONG_GOC, MASTER_VAI_HUONG } from "./vai-huong";

const kh = lapKeHoachSeedV1();

describe("[NHH-SEED] kế hoạch seed v1", () => {
  it("[NHH-SEED-01] HV_MOI: NEW × 5 vai GLOBAL, Σ 9% = trần; đây là ứng viên kích hoạt duy nhất", () => {
    const hv = kh.chinhSach.find((c) => c.maCu === "HV_MOI")!;
    expect(hv.policyCode).toBe("SR.QD.208/HV_MOI");
    expect(hv.rules.map((r) => [r.roleCode, r.rate])).toEqual([
      ["SALE", 0.04],
      ["SALE_ADMIN", 0.01],
      ["CENTER_MANAGER", 0.02],
      ["MARKETING", 0.01],
      ["TRIAL_TEACHER", 0.01],
    ]);
    expect(hv.rules.every((r) => r.transactionTypeCode === "NEW" && r.calcKind === "PERCENT" && r.revenueComponent === "TUITION")).toBe(true);
    const k = kiemTran({
      coSo: 10_000_000,
      quyTacTheoVai: hv.rules.map((r) => ({ roleCode: r.roleCode, kieuTinh: "PERCENT" as const, rate: r.rate! })),
      tranTongTiLe: 0.09,
    });
    expect(k.ok).toBe(true);
    // Chính sách CHUNG kích hoạt được chỉ có HV_MOI; chính sách theo NGUỒN (tất cả NHÁP) xét ở [DYN-SEED] bên dưới.
    expect(kh.chinhSach.filter((c) => c.kichHoat && c.maNhom === null).map((c) => c.maCu)).toEqual(["HV_MOI"]);
    expect(hv.chuaCoVanBan).toBe(false); // HV_MOI thuộc văn bản SR.QD.208
  });

  it("[NHH-SEED-02] RENEWAL (TAI_TUC) và hai bảng THƯỞNG BẬC chỉ là DRAFT kèm lý do; không rule RENEWAL nào ACTIVE (D16)", () => {
    const draft = kh.chinhSach.filter((c) => !c.kichHoat && c.maNhom === null);
    expect(draft.map((c) => c.maCu).sort()).toEqual(["TAI_TUC", "THUONG_DANH_HIEU_QUAN_LY", "THUONG_DANH_HIEU_TVV"]);
    expect(draft.every((c) => !!c.lyDoDraft)).toBe(true);
    expect(kh.chinhSach.filter((c) => c.kichHoat).flatMap((c) => c.rules).some((r) => r.transactionTypeCode === "RENEWAL")).toBe(false);
  });

  it("[NHH-SEED-03] bảng bậc: tierTable đóng dần theo ngưỡng (den = ngưỡng kế, bậc cuối null), tăng dần; vai TVV→SALE, quản lý→CENTER_MANAGER", () => {
    const tvv = kh.chinhSach.find((c) => c.maCu === "THUONG_DANH_HIEU_TVV")!.rules[0]!;
    expect(tvv.roleCode).toBe("SALE");
    const bac = tvv.tierTable as { tu: number; den: number | null; tien: number; danhHieu: string }[];
    expect(bac.map((b) => b.tu)).toEqual([110_000_000, 150_000_000, 200_000_000, 250_000_000, 300_000_000]);
    expect(bac.map((b) => b.den)).toEqual([150_000_000, 200_000_000, 250_000_000, 300_000_000, null]);
    expect(bac[0]).toEqual({ tu: 110_000_000, den: 150_000_000, tien: 1_000_000, danhHieu: "SILVER" });
    const ql = kh.chinhSach.find((c) => c.maCu === "THUONG_DANH_HIEU_QUAN_LY")!.rules[0]!;
    expect(ql.roleCode).toBe("CENTER_MANAGER");
    expect((ql.tierTable as { tu: number }[])[0]!.tu).toBe(220_000_000);
  });

  it("[NHH-SEED-04] mọi rule hợp lệ theo bộ kiểm đầu vào; mọi vai nằm trong master; chỉ NEW/RENEWAL", () => {
    for (const c of kh.chinhSach) {
      expect(kiemRuleDauVao(c.rules), c.policyCode).toEqual([]);
      for (const r of c.rules) {
        expect(MA_VAI_HUONG_GOC, `${c.policyCode}/${r.roleCode}`).toContain(r.roleCode);
        expect(["NEW", "RENEWAL"]).toContain(r.transactionTypeCode);
      }
    }
  });

  it("[NHH-SEED-05] chính sách KHÔNG chuyển được nằm trong `khongChuyen` kèm lý do — không bịa vai", () => {
    expect(kh.khongChuyen.map((k) => k.maCu).sort()).toEqual(["BAN_THIET_BI", "CHUYEN_TRUNG_TAM"]);
    expect(kh.khongChuyen.every((k) => k.lyDo.length > 20)).toBe(true);
    // mỗi chính sách cũ đi đúng một nơi: chuyển HOẶC không chuyển
    const maCu = [...kh.chinhSach.filter((c) => c.maNhom === null).map((c) => c.maCu), ...kh.khongChuyen.map((k) => k.maCu)].sort();
    expect(new Set(maCu).size).toBe(maCu.length);
    expect(maCu).toHaveLength(6);
  });

  it("[NHH-SEED-06] văn bản SR.QD.208 + hiệu lực mặc định qua cổng 15 ngày làm việc (đo bằng chính hàm guardrail)", () => {
    expect(kh.vanBan.documentCode).toBe(MA_VAN_BAN_SR208);
    expect(kh.vanBan.issuedOn).toBe(NGAY_BAN_HANH_SR208);
    const r = kiemHieuLucSauCongBo({
      congBo: kh.vanBan.publishedOn,
      hieuLuc: HIEU_LUC_MAC_DINH_SR208,
      soNgayLamViec: 15,
      nghi: [],
      coSoTrongPhamVi: new Set(),
    });
    expect(r.ok).toBe(true);
    // sớm một ngày ⇒ chặn: mốc mặc định là ĐÚNG ngày thứ 15, không dư
    expect(kiemHieuLucSauCongBo({ congBo: kh.vanBan.publishedOn, hieuLuc: new Date(HIEU_LUC_MAC_DINH_SR208.getTime() - 86_400_000), soNgayLamViec: 15, nghi: [], coSoTrongPhamVi: new Set() }).ok).toBe(false);
  });
});

describe("[DYN-SEED] chính sách mặc định THEO NGUỒN — TÁM nháp (chủ dự án xác nhận 09/10/2026: Marketing 1% CHỈ trả cho nguồn quảng cáo) — tỉ lệ 2%/1% chỉ sống ở đây, không ở lõi", () => {
  const theoNguon = (ma: string) => kh.chinhSach.find((c) => c.maNhom === ma)!;
  const HIEU_LUC = new Date("2026-03-19T17:00:00.000Z");
  const NGUON_MAC_DINH = DANH_MUC_GOC.filter((d) => d.code !== "UNKNOWN").map((d) => d.code as string);
  const KHONG_THU_HUT = ["CENTER_ORGANIC", "WALK_IN", "EVENT", "PARTNER", "OTHER"];
  const dongThuHut = (ma: string) => theoNguon(ma).rules.filter((r) => r.calcKind === "PERCENT").map((r) => [r.roleCode, r.rate]);

  it("[DYN-SEED-01] đúng TÁM chính sách theo nguồn = tám nguồn mặc định (KHÔNG có UNKNOWN); tất cả NHÁP; mỗi cái mang đúng MỘT dòng EXCLUDE MARKETING (NEW·TUITION)", () => {
    const maNhom = kh.chinhSach.filter((c) => c.maNhom !== null).map((c) => c.maNhom as string).sort();
    expect(maNhom).toEqual([...NGUON_MAC_DINH].sort());
    expect(maNhom).toHaveLength(8);
    expect(maNhom).not.toContain("UNKNOWN"); // UNKNOWN = mức thấp nhất giữa các nhóm, tính động (D7) — gắn chính sách cho nó là cho nó một mức CỐ ĐỊNH
    for (const ma of NGUON_MAC_DINH) {
      const c = theoNguon(ma);
      expect(c.kichHoat, ma).toBe(false);
      expect(c.chuaCoVanBan, ma).toBe(true);
      expect(c.lyDoDraft?.length ?? 0, ma).toBeGreaterThan(20);
      expect(c.policyCode, ma).toBe("SR.QD.208/NGUON_" + ma);
      expect(kiemRuleDauVao(c.rules), c.policyCode).toEqual([]);
      const loaiTru = c.rules.filter((r) => r.calcKind === "EXCLUDE");
      expect(loaiTru.map((r) => [r.transactionTypeCode, r.roleCode, r.revenueComponent, r.rate]), ma).toEqual([["NEW", "MARKETING", "TUITION", null]]);
    }
    // MỌI chính sách kích hoạt được trong kế hoạch = HV_MOI chung; không nháp theo nguồn nào là ứng viên
    expect(kh.chinhSach.filter((c) => c.kichHoat).map((c) => c.maCu)).toEqual(["HV_MOI"]);
  });

  it("[DYN-SEED-02] dòng thu hút: PAID_ADS→SOURCE_OWNER 1% (Marketing đi tới CHỦ NGUỒN, không còn MARKETING PERCENT) · PARENT_REFERRAL→REFERRER_PARENT_SALE 2% · EMPLOYEE_REFERRAL→REFERRER_EMPLOYEE 2% · năm nguồn còn lại KHÔNG có dòng thu hút", () => {
    expect(dongThuHut("PAID_ADS")).toEqual([["SOURCE_OWNER", 0.01]]);
    expect(dongThuHut("PARENT_REFERRAL")).toEqual([["REFERRER_PARENT_SALE", 0.02]]);
    expect(dongThuHut("EMPLOYEE_REFERRAL")).toEqual([["REFERRER_EMPLOYEE", 0.02]]);
    for (const ma of KHONG_THU_HUT) {
      expect(dongThuHut(ma), ma).toEqual([]);
      expect(theoNguon(ma).rules, ma).toHaveLength(1);
    }
    // Lý do nháp KHÔNG gõ tổng tỉ lệ cứng (số đo nằm ở thử tính/guardrail — văn bản này sẽ cũ khi admin đổi trần hay tỉ lệ)
    for (const c of kh.chinhSach.filter((x) => x.maNhom !== null)) expect(c.lyDoDraft, c.policyCode).not.toMatch(/\d\s*%/);
    // và nháp PAID_ADS nói đúng điều kiện kích hoạt: phải khai chủ nguồn
    expect(theoNguon("PAID_ADS").lyDoDraft).toContain("NGUON_CHUA_CO_NGUOI_PHU_TRACH");
  });

  // ── dựng ngữ cảnh guardrail từ CHÍNH kế hoạch seed ──
  const ID = (ma: string) => "g-" + ma;
  const quyTacCua = (c: (typeof kh.chinhSach)[number], idNhom: string | null): QuyTac[] =>
    c.rules.map((r, i) => ({
      ruleId: c.policyCode + "#" + i,
      policyId: c.policyCode,
      policyCode: c.policyCode,
      versionId: "v-" + c.policyCode,
      version: 1,
      documentNumber: "SR.QD.208",
      scopeType: idNhom ? "SOURCE_GROUP" : "GLOBAL",
      scopeKey: idNhom ? "SOURCE_GROUP:" + idNhom : "GLOBAL",
      scope: idNhom ? { sourceGroupId: idNhom } : {},
      orgUnitId: null,
      orgUnitPath: "/",
      orgUnitDepth: -1,
      transactionType: r.transactionTypeCode as "NEW" | "RENEWAL",
      roleCode: r.roleCode,
      revenueComponent: "TUITION",
      kieuTinh: r.calcKind as QuyTac["kieuTinh"],
      giaTri: r.calcKind === "EXCLUDE" ? 0 : r.rate!,
      effectiveFrom: HIEU_LUC,
      effectiveTo: null,
      trangThai: "ACTIVE",
    }));
  const hvMoi = kh.chinhSach.find((c) => c.maCu === "HV_MOI")!;
  const vaiHuong = new Map(MASTER_VAI_HUONG.map((v) => [v.code, { isActive: true, resolverType: v.resolverType, resolverKey: v.resolverKey }]));
  /** Nhóm nguồn lấy NGUYÊN từ danh mục gốc — cờ commissionEnabled THẬT của từng nguồn (không gõ tay "true" cho tất cả: nhánh miễn EXCLUDE chỉ chạy khi có nguồn cờ tắt). */
  const nhomNguonThat = (chu: Record<string, string> = {}) =>
    DANH_MUC_GOC.filter((d) => d.code !== "UNKNOWN").map((d) => ({
      id: ID(d.code),
      code: d.code as string,
      dangHoatDong: true,
      coHoaHong: d.commissionEnabled,
      ownerEmployeeId: chu[d.code] ?? null,
      referrerRequirement: d.referrerRequirement as string,
    }));
  const dau = (de: (typeof kh.chinhSach)[number], p: Partial<DauVaoKichHoat> = {}): DauVaoKichHoat => {
    const idNhom = de.maNhom ? ID(de.maNhom) : null;
    return {
      phienBan: {
        id: "v-" + de.policyCode,
        policyId: de.policyCode,
        scopeType: idNhom ? "SOURCE_GROUP" : "GLOBAL",
        scopeKey: idNhom ? "SOURCE_GROUP:" + idNhom : "GLOBAL",
        effectiveFrom: HIEU_LUC,
        effectiveTo: null,
        orgUnitId: null,
        orgUnitPath: "/",
      },
      vanBan: { documentCode: "SR.QD.208", title: "Quy định hoa hồng", issuedOn: "2026-03-01", publishedOn: "2026-03-01", effectiveOn: "2026-03-20", approvedByName: "Hồ Đắc Phúc", coTep: true, daThuHoi: false },
      quyTacDeXuat: quyTacCua(de, idNhom),
      quyTacDangHieuLuc: quyTacCua(hvMoi, null), // HV_MOI chung ĐANG ACTIVE (9%)
      phienBanKhac: [],
      loaiGiaoDich: MASTER_LOAI_GIAO_DICH,
      vaiHuong,
      coSoThieuNguoiPhuTrach: [],
      nhomNguon: nhomNguonThat(),
      nghi: [],
      coSoTrongPhamVi: new Set(["cs1"]),
      soNgayLamViec: 15,
      tranTongTiLe: 0.09,
      thuTuPhamVi: [...THU_TU_PHAM_VI_MAC_DINH],
      now: new Date("2026-03-02T03:00:00.000Z"),
      ...p,
    };
  };
  const maLoi = (r: ReturnType<typeof kiemKichHoat>) => r.loi.map((l) => l.ma).sort();

  // ── thử tính: ngữ cảnh tính tiền dựng từ cùng kế hoạch (HV_MOI + CẢ TÁM nháp coi như ACTIVE) ──
  const ctx = (tran: number, ...cs: (typeof kh.chinhSach)[number][]): HoaHongContext => ({
    quyTac: cs.flatMap((c) => quyTacCua(c, c.maNhom ? ID(c.maNhom) : null)),
    nhomNguon: DANH_MUC_GOC.filter((d) => d.code !== "UNKNOWN").map((d) => ({ id: ID(d.code), code: d.code as string, coHoaHong: d.commissionEnabled })),
    vaiHuong: MASTER_VAI_HUONG.map((v) => ({ code: v.code, resolverType: v.resolverType, resolverKey: v.resolverKey, isAcquisition: v.isAcquisition, isActive: true })),
    thuTuPhamVi: [...THU_TU_PHAM_VI_MAC_DINH],
    phienBanThuTu: "v1",
    tranTongTiLe: tran,
    vatTheoNgay: [],
  });
  const nguoi = new Map<string, KetQuaNguoiHuong>(
    MASTER_VAI_HUONG.map((v) => [v.code, { loai: "CO_NGUOI", nguoi: [{ kind: "USER", id: "u-" + v.code }], biLoai: [], canCu: v.code }]),
  );
  const tatCaNhap = kh.chinhSach.filter((c) => c.maNhom !== null);
  /** Tính 10.000.000 đ NEW cho khoản thuộc nguồn `ma` (null = UNKNOWN; "MOI" = nguồn do admin tạo, chưa có chính sách riêng). */
  const tinh = (hh: HoaHongContext, ma: string | null) =>
    tinhChinhSachChoPhan({
      hoaHong: hh,
      loaiGiaoDich: "NEW",
      coSo: 10_000_000,
      rateDate: new Date("2026-10-20T03:00:00.000Z"),
      orgUnitPath: "/ho/danang/cs1/",
      nguon: {
        sourceGroupId: ma === null ? null : ma === "MOI" ? "g-moi" : ID(ma),
        coHoaHong: ma === null || ma === "MOI" ? false : DANH_MUC_GOC.find((d) => d.code === ma)!.commissionEnabled,
        affiliateId: null,
        sourceId: null,
        campaignId: null,
        eventId: null,
      },
      nguoiHuong: nguoi,
      roleDefIdsTheoNguoi: new Map(),
    });
  const sinhDong = (r: ReturnType<typeof tinh>) => (r.loai === "OK" ? r.cacVai.filter((v) => v.trangThai === "SINH_DONG").map((v) => v.roleCode).sort() : []);

  it("[DYN-SEED-03] KÍCH HOẠT cùng HV_MOI đang chạy: năm nguồn «không trả Marketing» (cờ commissionEnabled TẮT) QUA (dòng EXCLUDE không đòi nguồn tham gia hoa hồng); PAID_ADS qua CHỈ KHI đã khai chủ nguồn; hai nguồn referral bị chặn đúng MỘT mã VUOT_TRAN, chỉ đường", () => {
    for (const ma of KHONG_THU_HUT) {
      expect(DANH_MUC_GOC.find((d) => d.code === ma)!.commissionEnabled, ma + " phải là nguồn cờ TẮT, không thì ca này không đo gì").toBe(false);
      expect(maLoi(kiemKichHoat(dau(theoNguon(ma)))), ma).toEqual([]);
    }
    // PAID_ADS: SOURCE_OWNER 1% cần người hưởng — chưa khai chủ nguồn thì chặn; khai rồi thì qua (đối chứng dương: chính "chủ nguồn" là thứ chặn)
    expect(maLoi(kiemKichHoat(dau(theoNguon("PAID_ADS"))))).toEqual(["NGUON_CHUA_CO_NGUOI_PHU_TRACH"]);
    expect(maLoi(kiemKichHoat(dau(theoNguon("PAID_ADS"), { nhomNguon: nhomNguonThat({ PAID_ADS: "emp-chu" }) })))).toEqual([]);
    // referral: tổng cao nhất đo bằng ENGINE (lưới trần), không gõ trong seed
    for (const ma of ["PARENT_REFERRAL", "EMPLOYEE_REFERRAL"]) {
      const chan = kiemKichHoat(dau(theoNguon(ma)));
      expect(maLoi(chan), ma).toEqual(["VUOT_TRAN"]);
      expect(chan.loi[0]!.huongXuLy, ma).toMatchObject({ tongPhanTram: "10", tranPhanTram: "9", chenhLechPhanTram: "1" });
      // nâng trần đúng bằng tổng (thao tác của admin ở Cấu hình vận hành) ⇒ qua: chứng minh chính TRẦN là thứ chặn
      expect(maLoi(kiemKichHoat(dau(theoNguon(ma), { tranTongTiLe: 0.1 }))), ma).toEqual([]);
    }
  });

  it("[DYN-SEED-04] THỬ TÍNH 10.000.000 đ NEW khi tám nháp ACTIVE: nguồn không phải quảng cáo = 8% (Marketing EXCLUDE) · PAID_ADS = 9% (1% về CHỦ NGUỒN) · nguồn do admin tạo (chưa có chính sách) vẫn 9% kèm Marketing · UNKNOWN: Marketing = 0", () => {
    const hh = ctx(0.09, hvMoi, ...tatCaNhap);
    const mkt = (r: ReturnType<typeof tinh>) => (r.loai === "OK" ? r.cacVai.find((v) => v.roleCode === "MARKETING") : undefined);
    const co4Vai = ["CENTER_MANAGER", "SALE", "SALE_ADMIN", "TRIAL_TEACHER"];
    for (const ma of KHONG_THU_HUT) {
      const r = tinh(hh, ma);
      expect(r.loai, ma).toBe("OK");
      if (r.loai === "OK") expect(r.tiLeTuongDuong, ma).toBeCloseTo(0.08, 9);
      expect(sinhDong(r), ma).toEqual(co4Vai); // không MARKETING
      expect(mkt(r)?.trangThai, ma).toBe("EXCLUDE");
    }
    const ads = tinh(hh, "PAID_ADS");
    expect(ads.loai).toBe("OK");
    if (ads.loai === "OK") expect(ads.tiLeTuongDuong).toBeCloseTo(0.09, 9);
    expect(sinhDong(ads)).toEqual([...co4Vai, "SOURCE_OWNER"].sort());
    expect(mkt(ads)?.trangThai).toBe("EXCLUDE"); // người phụ trách Marketing của cơ sở KHÔNG được trả: 1% đã chuyển cho chủ nguồn
    expect(ads.loai === "OK" && ads.cacVai.find((v) => v.roleCode === "SOURCE_OWNER")?.tienVai).toBe(100_000);

    // nguồn do admin tạo, chưa có chính sách: Marketing vẫn theo mức chung (muốn nguồn đó không trả Marketing: admin thêm dòng EXCLUDE — dữ liệu, không sửa mã)
    const moi = tinh(hh, "MOI");
    expect(moi.loai).toBe("OK");
    if (moi.loai === "OK") expect(moi.tiLeTuongDuong).toBeCloseTo(0.09, 9);
    expect(sinhDong(moi)).toContain("MARKETING");

    // UNKNOWN = mức thấp nhất giữa các nhóm: có nhóm không trả Marketing ⇒ Marketing của UNKNOWN = 0 (không có dòng), bốn vai kia nguyên vẹn
    const khongRo = tinh(hh, null);
    expect(khongRo.loai).toBe("OK");
    expect(sinhDong(khongRo)).toEqual(co4Vai);
    expect(khongRo.loai === "OK" && khongRo.cacVai.find((v) => v.roleCode === "MARKETING")?.trangThai).toBe("KHONG_RULE");
  });

  it("[DYN-SEED-05] THỬ TÍNH nguồn referral khi kích hoạt đủ: trần hiện hành ⇒ VUOT_TRAN (không dòng nào, không tự cắt); nâng trần đúng bằng tổng ⇒ OK, người giới thiệu nhận 2% và Marketing vẫn EXCLUDE", () => {
    for (const [ma, vai] of [["PARENT_REFERRAL", "REFERRER_PARENT_SALE"], ["EMPLOYEE_REFERRAL", "REFERRER_EMPLOYEE"]] as const) {
      const vuot = tinh(ctx(0.09, hvMoi, ...tatCaNhap), ma);
      expect(vuot.loai, ma).toBe("VUOT_TRAN");
      if (vuot.loai === "VUOT_TRAN") expect(vuot.tiLeTuongDuong, ma).toBeCloseTo(0.1, 9);
      const nang = tinh(ctx(0.1, hvMoi, ...tatCaNhap), ma);
      expect(nang.loai, ma).toBe("OK");
      if (nang.loai === "OK") {
        expect(nang.tiLeTuongDuong, ma).toBeCloseTo(0.1, 9);
        expect(nang.cacVai.find((v) => v.roleCode === vai)?.tienVai, ma).toBe(200_000);
        expect(nang.cacVai.find((v) => v.roleCode === "MARKETING")?.trangThai, ma).toBe("EXCLUDE");
      }
    }
  });

  it("[DYN-SEED-06] mẫu đối chứng: CHỈ HV_MOI (không nháp nào) ⇒ mọi nguồn 9% có Marketing — tức hành vi cũ chỉ đổi khi nháp được KÍCH HOẠT", () => {
    const hh = ctx(0.09, hvMoi);
    for (const ma of [...NGUON_MAC_DINH, null]) {
      const r = tinh(hh, ma);
      expect(r.loai, String(ma)).toBe("OK");
      if (r.loai === "OK") expect(r.tiLeTuongDuong, String(ma)).toBeCloseTo(0.09, 9);
      expect(sinhDong(r), String(ma)).toContain("MARKETING");
    }
  });
});
