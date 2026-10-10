// @vitest-environment node
/**
 * [NHH-POL-10*] — THỬ TÍNH chính sách (04 §14, 05 PR10): phần THUẦN của `mo-phong.ts`.
 *
 * Thử tính gọi ĐÚNG `tinhDongChoKhoan` của engine thật. Ca ở đây khẳng định: (1) hai bộ quy tắc được dựng đúng luật "thay version cùng
 * policy"; (2) đề xuất = hiện hành ⇒ chênh 0 ở MỌI chiều; (3) chênh đúng số học khi đổi tỉ lệ; (4) vượt trần được báo chứ không bị cắt;
 * (5) khoản không tính được được ĐẾM RIÊNG, không thành số 0 giả; (6) Σ mọi chiều phân rã = tổng.
 */
import { describe, it, expect } from "vitest";

import { THU_TU_PHAM_VI_MAC_DINH, type QuyTac } from "./chon-quy-tac";
import type { HoaHongContext } from "./kieu";
import {
  dangHieuLucTai,
  dungKichBan,
  haiBoCauHinh,
  khoangMacDinh,
  khoangThoiDiem,
  kiemKhoang,
  nhanChuaTinh,
  SO_NGAY_TOI_DA,
  TOI_DA_LIET_KE_TRAN,
  tinhHaiKichBan,
  tongHopMoPhong,
  type KhoanChuaTinh,
  type KhoanMoPhong,
  type TenHienThi,
} from "./mo-phong";
import type { KetQuaNguoiHuong } from "./nguoi-huong";
import type { DauVaoKhoan } from "./tinh-dong-cho-khoan";
import { MASTER_VAI_HUONG } from "./vai-huong";

const NOW = new Date("2026-10-08T03:00:00.000Z");
const RATE_DATE = new Date("2026-09-15T03:00:00.000Z");
const CS1 = "/ho/cs1/";
let dem = 0;

function rule(roleCode: string, rate: number, p: Partial<QuyTac> = {}): QuyTac {
  dem += 1;
  return {
    ruleId: `r${dem}`,
    policyId: "pol-a",
    policyCode: "SR.QD.A",
    versionId: "va1",
    version: 1,
    documentNumber: "SR.QD.A",
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
    giaTri: rate,
    effectiveFrom: new Date("2026-03-01T00:00:00.000Z"),
    effectiveTo: null,
    trangThai: "ACTIVE",
    ...p,
  };
}

const SEED_V1 = (): QuyTac[] => [rule("SALE", 0.04), rule("SALE_ADMIN", 0.01), rule("CENTER_MANAGER", 0.02), rule("MARKETING", 0.01), rule("TRIAL_TEACHER", 0.01)];

const VAI = MASTER_VAI_HUONG.map((v) => ({ code: v.code, resolverType: v.resolverType, resolverKey: v.resolverKey, isAcquisition: v.isAcquisition, isActive: true }));

function hh(quyTac: readonly QuyTac[], tran = 0.09): HoaHongContext {
  return {
    quyTac,
    nhomNguon: [{ id: "g1", code: "PARENT_REFERRAL", coHoaHong: true }, { id: "g2", code: "PAID_ADS", coHoaHong: true }],
    vaiHuong: VAI,
    thuTuPhamVi: [...THU_TU_PHAM_VI_MAC_DINH],
    phienBanThuTu: "v1",
    tranTongTiLe: tran,
    vatTheoNgay: [],
  };
}

const co = (id: string): KetQuaNguoiHuong => ({ loai: "CO_NGUOI", nguoi: [{ kind: "USER", id }], biLoai: [], canCu: "test" });
const NGUOI_DU = (): Map<string, KetQuaNguoiHuong> =>
  new Map<string, KetQuaNguoiHuong>([["SALE", co("u-sale")], ["SALE_ADMIN", co("u-admin")], ["CENTER_MANAGER", co("u-ql")], ["MARKETING", co("u-qc")], ["TRIAL_TEACHER", co("u-gv")]]);

function dauVaoCua(nguoi: Map<string, KetQuaNguoiHuong> = NGUOI_DU(), p: Partial<DauVaoKhoan> = {}): (coSo: number) => DauVaoKhoan {
  return (coSo) => ({
    hoaHong: hh([]),
    loaiGiaoDich: "NEW",
    coSo,
    rateDate: RATE_DATE,
    orgUnitPath: CS1,
    nguon: { sourceGroupId: "g1", coHoaHong: true, affiliateId: null, sourceId: null, campaignId: null, eventId: null },
    nguoiHuong: nguoi,
    roleDefIdsTheoNguoi: new Map(),
    ngoaiCuaSo: false,
    daTraBangEngineCu: new Set<string>(),
    ...p,
  });
}

const TEN: TenHienThi = {
  vai: new Map(VAI.map((v) => [v.code, `Tên ${v.code}`])),
  nhom: new Map([["PARENT_REFERRAL", "PH giới thiệu"], ["PAID_ADS", "Quảng cáo"]]),
  donVi: new Map([["c1", "Cơ sở 1"], ["c2", "Cơ sở 2"]]),
};

/** Một khoản thu mô phỏng: chạy lõi thật hai lần với hai bộ quy tắc. */
function khoan(id: string, coSo: number, hienTai: readonly QuyTac[], deXuat: readonly QuyTac[], p: { centerId?: string; loai?: "NEW" | "RENEWAL"; nhom?: string; nguoi?: Map<string, KetQuaNguoiHuong>; tran?: number } = {}): KhoanMoPhong {
  const loai = p.loai ?? "NEW";
  const nhom = p.nhom ?? "PARENT_REFERRAL";
  const cfg = { hienTai: hh(hienTai, p.tran ?? 0.09), deXuat: hh(deXuat, p.tran ?? 0.09) };
  const kq = tinhHaiKichBan(dauVaoCua(p.nguoi, { loaiGiaoDich: loai, nguon: { sourceGroupId: nhom === "UNKNOWN" ? null : nhom === "PARENT_REFERRAL" ? "g1" : "g2", coHoaHong: true, affiliateId: null, sourceId: null, campaignId: null, eventId: null } }), coSo, cfg);
  return { paymentId: id, ngayThu: "2026-09-15", centerId: p.centerId ?? "c1", loai, nhomNguon: nhom, coSo, ...kq };
}

const tongHop = (khoanList: KhoanMoPhong[], chuaTinh: KhoanChuaTinh[] = [], tran = 0.09) => tongHopMoPhong({ khoan: khoanList, chuaTinh, ten: TEN, tran });

describe("[NHH-POL-10] dựng hai bộ quy tắc", () => {
  it("[NHH-POL-10a] hiệu lực biên MỞ: from ≤ at < to; DRAFT/CANCELLED không bao giờ tham gia; SUPERSEDED/EXPIRED theo NGÀY (như chonQuyTac)", () => {
    const at = NOW;
    expect(dangHieuLucTai(rule("SALE", 0.04, { effectiveFrom: at }), at)).toBe(true);
    expect(dangHieuLucTai(rule("SALE", 0.04, { effectiveTo: at }), at)).toBe(false);
    expect(dangHieuLucTai(rule("SALE", 0.04, { effectiveFrom: new Date(at.getTime() + 1) }), at)).toBe(false);
    // theo NGÀY: bản đã được thay nhưng hẹn đóng vào tương lai VẪN đang chạy hôm nay; bản hết hạn trong quá khứ thì không
    expect(dangHieuLucTai(rule("SALE", 0.04, { trangThai: "SUPERSEDED", effectiveTo: new Date("2027-01-01T00:00:00.000Z") }), at)).toBe(true);
    expect(dangHieuLucTai(rule("SALE", 0.04, { trangThai: "EXPIRED", effectiveTo: new Date("2026-06-01T00:00:00.000Z") }), at)).toBe(false);
    // DRAFT / CANCELLED không tham gia DÙ ngày nằm trong khoảng
    expect(dangHieuLucTai(rule("SALE", 0.04, { trangThai: "DRAFT" }), at)).toBe(false);
    expect(dangHieuLucTai(rule("SALE", 0.04, { trangThai: "CANCELLED" }), at)).toBe(false);
  });

  it("[NHH-POL-10b] 'hiện tại' = bộ ĐANG hiệu lực hôm nay, dời hiệu lực về đầu thời gian; bản hết hạn / hẹn tương lai bị loại", () => {
    const dangChay = rule("SALE", 0.04);
    const hetHan = rule("SALE", 0.1, { policyId: "pol-cu", trangThai: "EXPIRED", effectiveTo: new Date("2026-06-01T00:00:00.000Z") });
    const henGio = rule("MARKETING", 0.05, { policyId: "pol-moi", effectiveFrom: new Date("2026-12-01T00:00:00.000Z") });
    const nhap = rule("CENTER_MANAGER", 0.05, { policyId: "pol-nhap", trangThai: "DRAFT" });
    const kb = dungKichBan({ quyTacDaNap: [dangChay, hetHan, henGio, nhap], quyTacDeXuat: [], policyIdDeXuat: "pol-khong-co", now: NOW });
    expect(kb.hienTai.map((q) => q.ruleId)).toEqual([dangChay.ruleId]);
    expect(kb.hienTai[0]!.effectiveFrom.getTime()).toBe(0);
    expect(kb.hienTai[0]!.effectiveTo).toBeNull();
  });

  it("[NHH-POL-10c] 'đề xuất' THAY toàn bộ quy tắc của chính sách đang soạn; chính sách khác giữ nguyên", () => {
    const a1 = rule("SALE", 0.04, { policyId: "pol-a" });
    const a2 = rule("MARKETING", 0.01, { policyId: "pol-a" });
    const b1 = rule("CENTER_MANAGER", 0.02, { policyId: "pol-b", policyCode: "SR.QD.B" });
    const moi = rule("SALE", 0.05, { policyId: "pol-a", versionId: "va2", version: 2, trangThai: "DRAFT", effectiveFrom: new Date("2026-12-01T00:00:00.000Z") });
    const kb = dungKichBan({ quyTacDaNap: [a1, a2, b1], quyTacDeXuat: [moi], policyIdDeXuat: "pol-a", now: NOW });
    expect(kb.deXuat.map((q) => q.ruleId).sort()).toEqual([b1.ruleId, moi.ruleId].sort());
    // bản nháp hiệu lực từ tương lai nhưng VẪN áp cho khoảng quá khứ: hiệu lực dời về đầu thời gian, trạng thái ACTIVE
    const trongDeXuat = kb.deXuat.find((q) => q.ruleId === moi.ruleId)!;
    expect(trongDeXuat.effectiveFrom.getTime()).toBe(0);
    expect(trongDeXuat.trangThai).toBe("ACTIVE");
    // 'hiện tại' không bị đụng
    expect(kb.hienTai.map((q) => q.ruleId).sort()).toEqual([a1.ruleId, a2.ruleId, b1.ruleId].sort());
  });

  it("[NHH-POL-10d] chính sách MỚI (không thay ai) được cộng thêm vào bộ hiện hành; 'hop' bao cả hai bộ để nạp người hưởng", () => {
    const a1 = rule("SALE", 0.04, { policyId: "pol-a" });
    const moi = rule("MARKETING", 0.01, { policyId: "pol-moi", trangThai: "DRAFT" });
    const kb = dungKichBan({ quyTacDaNap: [a1], quyTacDeXuat: [moi], policyIdDeXuat: "pol-moi", now: NOW });
    expect(kb.hienTai.map((q) => q.roleCode)).toEqual(["SALE"]);
    expect(kb.deXuat.map((q) => q.roleCode).sort()).toEqual(["MARKETING", "SALE"]);
    expect(new Set(kb.hop.map((q) => q.roleCode))).toEqual(new Set(["SALE", "MARKETING"]));
  });
});

describe("[NHH-POL-10] hai kịch bản trên CÙNG lõi tính", () => {
  it("[NHH-POL-10r] hai bộ cấu hình CHỈ khác quy tắc: trần · VAT · thứ tự phạm vi · danh mục là CHUNG (một số liệu cấu hình, hai kết quả)", () => {
    const goc = hh([], 0.1);
    const kb = dungKichBan({ quyTacDaNap: [rule("SALE", 0.04)], quyTacDeXuat: [rule("MARKETING", 0.01, { policyId: "pol-moi", trangThai: "DRAFT" })], policyIdDeXuat: "pol-moi", now: NOW });
    const c = haiBoCauHinh(goc, kb);
    expect(c.hienTai.quyTac.map((q) => q.roleCode)).toEqual(["SALE"]);
    expect(c.deXuat.quyTac.map((q) => q.roleCode).sort()).toEqual(["MARKETING", "SALE"]);
    for (const k of ["hienTai", "deXuat"] as const) expect({ ...c[k], quyTac: null }).toEqual({ ...goc, quyTac: null });
    expect(c.hienTai.tranTongTiLe).toBe(0.1);
  });

  const hienHanh = SEED_V1();

  it("[NHH-POL-10e] đề xuất = hiện hành ⇒ kết quả từng khoản GIỐNG HỆT và chênh 0 ở MỌI chiều", () => {
    const kb = dungKichBan({ quyTacDaNap: hienHanh, quyTacDeXuat: hienHanh.map((q) => ({ ...q, ruleId: `${q.ruleId}-dx`, trangThai: "DRAFT" as const })), policyIdDeXuat: "pol-a", now: NOW });
    const ds = [
      khoan("p1", 10_000_000, kb.hienTai, kb.deXuat),
      khoan("p2", 7_654_321, kb.hienTai, kb.deXuat, { centerId: "c2", loai: "RENEWAL", nhom: "PAID_ADS" }),
      khoan("p3", 1_234_550, kb.hienTai, kb.deXuat, { nhom: "UNKNOWN" }),
    ];
    const t = tongHop(ds);
    expect(t.hoaHong.chenh).toBe(0);
    expect(t.hoaHong.hienTai).toBe(t.hoaHong.deXuat);
    for (const chieu of [t.phanRa.vai, t.phanRa.nguon, t.phanRa.donVi, t.phanRa.loai]) for (const d of chieu) expect(d.chenh, d.khoa).toBe(0);
    expect(t.soNguoiAnhHuong).toBe(0);
    expect(t.tran.deXuat.soKhoan).toBe(0);
    // khoản NEW 10tr, seed v1 Σ 9% ⇒ 900.000 (đối chứng dương: tổng KHÔNG phải 0)
    expect(t.hoaHong.hienTai).toBeGreaterThan(0);
  });

  it("[NHH-POL-10f] Sale 4% → 3,5% (Σ vẫn dưới trần): chênh = −0,5% × cơ sở; chỉ hàng Sale đổi; đúng số học trên 2 khoản", () => {
    const sale35 = rule("SALE", 0.035, { policyId: "pol-a", trangThai: "DRAFT", versionId: "va2", version: 2 });
    const khac = hienHanh.filter((q) => q.roleCode !== "SALE");
    const kb = dungKichBan({ quyTacDaNap: [...khac, rule("SALE", 0.04)], quyTacDeXuat: [sale35, ...khac.map((q) => ({ ...q, trangThai: "DRAFT" as const }))], policyIdDeXuat: "pol-a", now: NOW });
    const t = tongHop([khoan("p1", 10_000_000, kb.hienTai, kb.deXuat), khoan("p2", 2_000_000, kb.hienTai, kb.deXuat)]);
    expect(t.coSo).toBe(12_000_000);
    expect(t.hoaHong.hienTai).toBe(1_080_000); // 9% × 12tr
    expect(t.hoaHong.deXuat).toBe(1_020_000); // 8,5% × 12tr
    expect(t.hoaHong.chenh).toBe(-60_000);
    const sale = t.phanRa.vai.find((d) => d.khoa === "SALE")!;
    expect([sale.hienTai, sale.deXuat, sale.chenh]).toEqual([480_000, 420_000, -60_000]);
    for (const d of t.phanRa.vai.filter((x) => x.khoa !== "SALE")) expect(d.chenh, d.khoa).toBe(0);
    expect(t.tiLeHieuDung.hienTai).toBeCloseTo(0.09, 9);
    expect(t.tiLeHieuDung.deXuat).toBeCloseTo(0.085, 9);
    expect(t.soNguoiAnhHuong).toBe(1); // chỉ u-sale đổi
  });

  it("[NHH-POL-10g] đề xuất làm Σ vượt trần ⇒ khoản bị CỜ (khoản · vai · tỉ lệ · trần); KHÔNG tự cắt; khoản đó đóng góp 0 ở kịch bản đề xuất (như engine thật)", () => {
    const sale5 = rule("SALE", 0.05, { policyId: "pol-a", trangThai: "DRAFT", versionId: "va2", version: 2 });
    const khac = hienHanh.filter((q) => q.roleCode !== "SALE");
    const kb = dungKichBan({ quyTacDaNap: [...khac, rule("SALE", 0.04)], quyTacDeXuat: [sale5, ...khac.map((q) => ({ ...q, trangThai: "DRAFT" as const }))], policyIdDeXuat: "pol-a", now: NOW }); // Σ = 10% > 9%
    const t = tongHop([khoan("p1", 10_000_000, kb.hienTai, kb.deXuat)]);
    expect(t.tran.gioiHan).toBe(0.09);
    expect(t.tran.hienTai.soKhoan).toBe(0);
    expect(t.tran.deXuat.soKhoan).toBe(1);
    const c = t.tran.deXuat.danhSach[0]!;
    expect(c).toMatchObject({ kichBan: "deXuat", paymentId: "p1", donVi: "Cơ sở 1", loai: "NEW", coSo: 10_000_000, tran: 0.09 });
    expect(c.tiLe).toBeCloseTo(0.1, 9);
    expect(c.vai.map((v) => v.roleCode).sort()).toEqual(["CENTER_MANAGER", "MARKETING", "SALE", "SALE_ADMIN", "TRIAL_TEACHER"]);
    expect(c.vai.find((v) => v.roleCode === "SALE")).toMatchObject({ vai: "Tên SALE", kieuTinh: "PERCENT" });
    expect(Number(c.vai.find((v) => v.roleCode === "SALE")!.giaTri)).toBeCloseTo(0.05, 9);
    expect(t.hoaHong.hienTai).toBe(900_000);
    expect(t.hoaHong.deXuat).toBe(0); // 0 dòng: engine không tự cắt vai nào
    expect(t.tran.biCat).toBe(false);
  });

  it("[NHH-POL-10h] trần đọc từ cấu hình: 10% ⇒ cùng đề xuất không bị cờ", () => {
    const sale5 = rule("SALE", 0.05, { policyId: "pol-a", trangThai: "DRAFT" });
    const khac = hienHanh.filter((q) => q.roleCode !== "SALE");
    const kb = dungKichBan({ quyTacDaNap: [...khac, rule("SALE", 0.04)], quyTacDeXuat: [sale5, ...khac.map((q) => ({ ...q, trangThai: "DRAFT" as const }))], policyIdDeXuat: "pol-a", now: NOW });
    const t = tongHop([khoan("p1", 10_000_000, kb.hienTai, kb.deXuat, { tran: 0.1 })], [], 0.1);
    expect(t.tran.deXuat.soKhoan).toBe(0);
    expect(t.hoaHong.deXuat).toBe(1_000_000);
  });

  it("[NHH-POL-10i] danh sách khoản vượt trần có TRẦN số liệt kê, phần còn lại chỉ ĐẾM và biCat=true", () => {
    const sale5 = rule("SALE", 0.05, { policyId: "pol-a", trangThai: "DRAFT" });
    const khac = hienHanh.filter((q) => q.roleCode !== "SALE");
    const kb = dungKichBan({ quyTacDaNap: [...khac, rule("SALE", 0.04)], quyTacDeXuat: [sale5, ...khac.map((q) => ({ ...q, trangThai: "DRAFT" as const }))], policyIdDeXuat: "pol-a", now: NOW });
    const n = TOI_DA_LIET_KE_TRAN + 7;
    const t = tongHop(Array.from({ length: n }, (_, i) => khoan(`p${i}`, 1_000_000, kb.hienTai, kb.deXuat)));
    expect(t.tran.deXuat.soKhoan).toBe(n);
    expect(t.tran.deXuat.danhSach).toHaveLength(TOI_DA_LIET_KE_TRAN);
    expect(t.tran.biCat).toBe(true);
  });

  it("[NHH-POL-10j] vai CHỈ có ở bản đề xuất (chưa có rule hiện tại): hiện 0, đề xuất > 0, chênh dương — và người hưởng lấy từ 'hop'", () => {
    const hien = [rule("SALE", 0.04)];
    const moi = rule("MARKETING", 0.01, { policyId: "pol-moi", trangThai: "DRAFT" });
    const kb = dungKichBan({ quyTacDaNap: hien, quyTacDeXuat: [moi], policyIdDeXuat: "pol-moi", now: NOW });
    const t = tongHop([khoan("p1", 10_000_000, kb.hienTai, kb.deXuat)]);
    const mkt = t.phanRa.vai.find((d) => d.khoa === "MARKETING")!;
    expect([mkt.hienTai, mkt.deXuat, mkt.chenh]).toEqual([0, 100_000, 100_000]);
    expect(t.hoaHong.chenh).toBe(100_000);
  });
});

describe("[NHH-POL-10] khoản KHÔNG tính được — đếm riêng, không số 0 giả", () => {
  it("[NHH-POL-10k] đơn không có lead ⇒ vai Sale TREO: không vào tổng, vào 'thiếu người hưởng' kèm lý do + tiền tiềm năng; các vai khác vẫn tính", () => {
    const seed = SEED_V1();
    const nguoi = NGUOI_DU();
    nguoi.set("SALE", { loai: "TREO", lyDo: "KHONG_CO_LEAD", canCu: "LEAD_CONVERTED_BY: đơn không có lead" });
    const t = tongHop([khoan("p1", 10_000_000, seed, seed, { nguoi })]);
    expect(t.hoaHong.hienTai).toBe(500_000); // 9% − Sale 4% (vì Sale treo)
    const th = t.thieuNguoi.hienTai.find((x) => x.ma === "KHONG_CO_LEAD")!;
    expect(th).toMatchObject({ soKhoan: 1, soTien: 400_000 });
    expect(th.nhan).toMatch(/không có lead/i);
    expect(t.phanRa.vai.find((d) => d.khoa === "SALE")).toBeUndefined(); // không có hàng Sale 0đ giả
  });

  it("[NHH-POL-10l] treo 'bình thường' (không có GV trial) KHÔNG bị tính là thiếu dữ liệu", () => {
    const seed = SEED_V1();
    const nguoi = NGUOI_DU();
    nguoi.set("TRIAL_TEACHER", { loai: "TREO", lyDo: "KHONG_CO_GV_TRIAL", canCu: "TRIAL_TEACHER: chưa có buổi trial" });
    const t = tongHop([khoan("p1", 10_000_000, seed, seed, { nguoi })]);
    expect(t.thieuNguoi.hienTai).toEqual([]);
    expect(t.hoaHong.hienTai).toBe(800_000);
  });

  it("[NHH-POL-10m] khoản chưa tính được (hàng chờ) gom theo lý do và KHÔNG góp vào cơ sở / hoa hồng", () => {
    const seed = SEED_V1();
    const t = tongHop(
      [khoan("p1", 10_000_000, seed, seed)],
      [{ paymentId: "x1", ma: "CHUA_GAN_CON", soTien: 4_000_000 }, { paymentId: "x2", ma: "CHUA_GAN_CON", soTien: 1_000_000 }, { paymentId: "x3", ma: "PENDING_REGULATION", soTien: 2_000_000 }],
    );
    expect(t.coSo).toBe(10_000_000);
    expect(t.soKhoanTinhDuoc).toBe(1);
    expect(t.chuaTinh.soKhoan).toBe(3);
    expect(t.chuaTinh.theoLyDo.find((x) => x.ma === "CHUA_GAN_CON")).toMatchObject({ soKhoan: 2, soTien: 5_000_000, nhan: nhanChuaTinh("CHUA_GAN_CON") });
    expect(nhanChuaTinh("MA_LA")).toBe("MA_LA"); // mã lạ hiện nguyên mã, không bị nuốt
  });
});

describe("[NHH-POL-10] phân rã", () => {
  it("[NHH-POL-10n] Σ mỗi chiều (vai · nguồn · cơ sở · loại) = tổng, ở CẢ hai kịch bản; cơ sở tính cũng khớp", () => {
    const hien = SEED_V1();
    const moi = [rule("SALE", 0.03, { policyId: "pol-a", trangThai: "DRAFT" }), rule("CENTER_MANAGER", 0.02, { policyId: "pol-a", trangThai: "DRAFT" })];
    const kb = dungKichBan({ quyTacDaNap: hien, quyTacDeXuat: moi, policyIdDeXuat: "pol-a", now: NOW });
    const ds = [
      khoan("a", 10_000_000, kb.hienTai, kb.deXuat),
      khoan("b", 7_654_321, kb.hienTai, kb.deXuat, { centerId: "c2", loai: "RENEWAL", nhom: "PAID_ADS" }),
      khoan("c", 1_234_550, kb.hienTai, kb.deXuat, { nhom: "UNKNOWN", centerId: "c2" }),
    ];
    const t = tongHop(ds);
    for (const [ten, chieu] of Object.entries(t.phanRa)) {
      const tong = (f: "hienTai" | "deXuat") => chieu.reduce((s, d) => s + d[f], 0);
      expect(tong("hienTai"), `${ten}/hienTai`).toBe(t.hoaHong.hienTai);
      expect(tong("deXuat"), `${ten}/deXuat`).toBe(t.hoaHong.deXuat);
      for (const d of chieu) expect(d.chenh, `${ten}/${d.khoa}`).toBe(d.deXuat - d.hienTai);
    }
    for (const ten of ["nguon", "donVi", "loai"] as const) {
      expect(t.phanRa[ten].reduce((s, d) => s + d.coSo, 0), ten).toBe(t.coSo);
      expect(t.phanRa[ten].reduce((s, d) => s + d.soKhoan, 0), ten).toBe(3);
    }
    // nhãn người đọc được
    expect(t.phanRa.nguon.map((d) => d.nhan).sort()).toEqual(["Không rõ nguồn", "PH giới thiệu", "Quảng cáo"]);
    expect(t.phanRa.donVi.map((d) => d.nhan).sort()).toEqual(["Cơ sở 1", "Cơ sở 2"]);
    expect(t.phanRa.loai.map((d) => d.nhan).sort()).toEqual(["Học viên mới", "Tái tục"]);
    // hàng vai theo thứ tự master
    const thuTu = [...TEN.vai.keys()];
    const idx = t.phanRa.vai.map((d) => thuTu.indexOf(d.khoa));
    expect(idx).toEqual([...idx].sort((x, y) => x - y));
  });
});

describe("[NHH-POL-10] khoảng thời gian", () => {
  it("[NHH-POL-10o] mặc định = 3 tháng TRỌN VẸN trước tháng hiện tại (giờ VN)", () => {
    expect(khoangMacDinh(new Date("2026-10-08T03:00:00.000Z"))).toEqual({ tuNgay: "2026-07-01", denNgay: "2026-09-30" });
    expect(khoangMacDinh(new Date("2026-01-02T03:00:00.000Z"))).toEqual({ tuNgay: "2025-10-01", denNgay: "2025-12-31" });
    // 17:30 UTC ngày 30/09 đã là 00:30 ngày 01/10 giờ VN ⇒ "tháng hiện tại" là THÁNG 10
    expect(khoangMacDinh(new Date("2026-09-30T17:30:00.000Z"))).toEqual({ tuNgay: "2026-07-01", denNgay: "2026-09-30" });
  });

  it("[NHH-POL-10p] kiểm khoảng: sai dạng · đảo đầu cuối · quá dài; ranh 186 ngày", () => {
    expect(kiemKhoang("2026-07-01", "2026-09-30")).toBeNull();
    expect(kiemKhoang("2026-07-01", "2026-07-01")).toBeNull();
    expect(kiemKhoang("2026-7-1", "2026-09-30")).toMatch(/bắt đầu/);
    expect(kiemKhoang("2026-07-01", "30/09/2026")).toMatch(/kết thúc/);
    expect(kiemKhoang("2026-09-30", "2026-07-01")).toMatch(/từ ngày bắt đầu/);
    expect(SO_NGAY_TOI_DA).toBe(186);
    expect(kiemKhoang("2026-01-01", "2026-07-05")).toBeNull(); // đúng 186 ngày
    expect(kiemKhoang("2026-01-01", "2026-07-06")).toMatch(/tối đa 186/);
    expect(kiemKhoang("2026-02-30", "2026-03-01")).toMatch(/bắt đầu/); // ngày không có thật
  });

  it("[NHH-POL-10q] [tu, den) biên MỞ: khoản đúng 00:00 VN của ngày sau ngày cuối KHÔNG vào; 23:59:59 ngày cuối thì vào", () => {
    const { tu, den } = khoangThoiDiem("2026-09-01", "2026-09-30");
    expect(tu.toISOString()).toBe("2026-08-31T17:00:00.000Z");
    expect(den.toISOString()).toBe("2026-09-30T17:00:00.000Z");
  });
});
