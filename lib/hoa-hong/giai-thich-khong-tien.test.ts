// @vitest-environment node
/**
 * [GTK-01..09] — GIẢI THÍCH vì sao một vai KHÔNG phát sinh tiền (Hướng G). THUẦN: không DB, không đồng hồ thật (ngày TUYỆT ĐỐI — luật 19).
 *
 * Yêu cầu chủ dự án: sau cửa sổ ghi công, Source VẪN là nguồn cũ nhưng hoa hồng thu hút = không đủ điều kiện. Màn phải nói đủ:
 * Nguồn · Chính sách và tỉ lệ · Điều kiện «Không đủ điều kiện» · Lý do (mã máy ATTRIBUTION_WINDOW_EXPIRED) · Hoa hồng 0đ — «không để user chỉ thấy tổng giảm 1% mà không biết lý do».
 */
import { describe, it, expect } from "vitest";

import { conTrongCuaSoGhiCong } from "@/lib/nguon/cua-so-ghi-cong";

import { THU_TU_PHAM_VI_MAC_DINH, type QuyTac } from "./chon-quy-tac";
import {
  chiTietCuaSo,
  dungGiaiThich,
  dungNhanGiaiThich,
  laMaGiaiThich,
  MA_LY_DO_GIAI_THICH,
  MA_THEO_LY_DO_TREO,
  maGiaiThichCua,
  type DongGiaiThichDoc,
} from "./giai-thich-khong-tien";
import type { HoaHongContext } from "./kieu";
import type { KetQuaNguoiHuong, LyDoTreo } from "./nguoi-huong";
import { hashCuaKetQua, type KeHoachThu } from "./quet-khoan";
import { tinhDongChoKhoan, type DauVaoKhoan, type TreoNhap } from "./tinh-dong-cho-khoan";
import { MASTER_VAI_HUONG } from "./vai-huong";

const RATE_DATE = new Date("2026-12-20T03:00:00.000Z");
let dem = 0;

function rule(roleCode: string, rate: number, p: Partial<QuyTac> = {}): QuyTac {
  dem += 1;
  return {
    ruleId: `r${dem}`,
    policyId: "pol-1",
    policyCode: "SR.QD.208/NGUON_X",
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
    giaTri: rate,
    effectiveFrom: new Date("2026-03-01T00:00:00.000Z"),
    effectiveTo: null,
    trangThai: "ACTIVE",
    ...p,
  };
}

const VAI = MASTER_VAI_HUONG.map((v) => ({ code: v.code, resolverType: v.resolverType, resolverKey: v.resolverKey, isAcquisition: v.isAcquisition, isActive: true }));
const hh = (quyTac: QuyTac[]): HoaHongContext => ({
  quyTac,
  nhomNguon: [{ id: "g1", code: "NGUON_BAT_KY", coHoaHong: true }],
  vaiHuong: VAI,
  thuTuPhamVi: [...THU_TU_PHAM_VI_MAC_DINH],
  phienBanThuTu: "v1",
  tranTongTiLe: 0.09,
  vatTheoNgay: [],
});
const co = (...ids: string[]): KetQuaNguoiHuong => ({ loai: "CO_NGUOI", nguoi: ids.map((id) => ({ kind: "USER" as const, id })), biLoai: [], canCu: "test" });

/** Vai `isAcquisition` (REFERRER_PARENT 2%) + vai giao dịch (SALE 4%): ngoài cửa sổ thì chỉ vai đầu bị loại. */
function dau(ngoaiCuaSo: boolean, nguoi: Record<string, KetQuaNguoiHuong> = { SALE: co("u-sale"), REFERRER_PARENT: co("u-ph") }, coSo = 10_000_000): DauVaoKhoan {
  return {
    hoaHong: hh([rule("SALE", 0.04), rule("REFERRER_PARENT", 0.02)]),
    loaiGiaoDich: "NEW",
    coSo,
    rateDate: RATE_DATE,
    orgUnitPath: "/ho/danang/cs1/",
    nguon: { sourceGroupId: "g1", coHoaHong: true, affiliateId: null, sourceId: null, campaignId: null, eventId: null },
    nguoiHuong: new Map(Object.entries(nguoi)),
    roleDefIdsTheoNguoi: new Map(),
    ngoaiCuaSo,
    daTraBangEngineCu: new Set(),
    baoVeCampaign: false,
    lanMua: { laKhoanDau: true, coSoGoc: coSo },
  };
}
const ok = (r: ReturnType<typeof tinhDongChoKhoan>) => {
  if (r.loai !== "OK") throw new Error(`Mong OK, nhận ${r.loai}`);
  return r;
};

// Lead quy nguồn 12/09/2026 (giờ VN); cửa sổ 90 ngày ⇒ hạn ghi công = 11/12/2026 (ngày thứ 90, GỒM).
const QUY_NGUON = new Date("2026-09-12T03:00:00.000Z");
const NGAY_THU_DAU_TRE = new Date("2026-12-20T03:00:00.000Z"); // 20/12: sau hạn 9 ngày

describe("[GTK-01] ngoài cửa sổ ⇒ MỘT dòng giải thích cho vai thu hút; trong cửa sổ ⇒ không dòng nào (đối chứng dương)", () => {
  it("ngoài cửa sổ: dòng REFERRER_PARENT · ATTRIBUTION_WINDOW_EXPIRED · lẽ ra = 2% × cơ sở; Sale vẫn nhận tiền thật", () => {
    const kq = ok(tinhDongChoKhoan(dau(true)));
    expect(kq.dong.map((d) => d.roleCode)).toEqual(["SALE"]); // chỉ Sale có dòng sổ
    const gt = dungGiaiThich({ treo: kq.treo, cuaSo: { attributedAt: QUY_NGUON, ngayThuDau: NGAY_THU_DAU_TRE, cuaSoNgay: 90 } });
    expect(gt).toHaveLength(1);
    expect(gt[0]).toMatchObject({
      roleCode: "REFERRER_PARENT",
      reasonCode: "ATTRIBUTION_WINDOW_EXPIRED",
      beneficiaryKey: "USER:u-ph",
      beneficiaryKind: "USER",
      beneficiaryId: "u-ph",
      wouldBeAmount: 200_000,
      tienVai: 200_000,
    });
    expect(gt[0]!.quyTac).toMatchObject({ roleCode: "REFERRER_PARENT", kieuTinh: "PERCENT", giaTri: 0.02, documentNumber: "SR.QD.208", version: 1 });
  });

  it("đối chứng dương: TRONG cửa sổ ⇒ người giới thiệu có dòng sổ, không treo ⇒ 0 dòng giải thích", () => {
    const kq = ok(tinhDongChoKhoan(dau(false)));
    expect(kq.dong.map((d) => d.roleCode).sort()).toEqual(["REFERRER_PARENT", "SALE"]);
    expect(dungGiaiThich({ treo: kq.treo, cuaSo: { attributedAt: QUY_NGUON, ngayThuDau: new Date("2026-12-01T03:00:00.000Z"), cuaSoNgay: 90 } })).toEqual([]);
  });

  it("nhiều người cùng vai: mỗi người một dòng, Σ lẽ ra = tiền cả vai (chia bằng chính chiaTienChoVai)", () => {
    const kq = ok(tinhDongChoKhoan(dau(true, { SALE: co("u-sale"), REFERRER_PARENT: co("u-a", "u-b", "u-c") }, 10_000_001)));
    const gt = dungGiaiThich({ treo: kq.treo, cuaSo: { attributedAt: QUY_NGUON, ngayThuDau: NGAY_THU_DAU_TRE, cuaSoNgay: 90 } });
    expect(gt.map((g) => g.beneficiaryKey)).toEqual(["USER:u-a", "USER:u-b", "USER:u-c"]);
    expect(gt.reduce((s, g) => s + g.wouldBeAmount, 0)).toBe(gt[0]!.tienVai);
  });
});

describe("[GTK-02] biên cửa sổ: ngày thứ 90 (gồm) KHÔNG giải thích · ngày thứ 91 CÓ — cùng một phép đo với engine", () => {
  const khoan = (ngayThu: string) => {
    const ngayThuDau = new Date(`${ngayThu}T03:00:00.000Z`);
    // Đúng phép của `dungDauVaoChinhSach`: ngoaiCuaSo = !conTrongCuaSoGhiCong(attributedAt, ngayThuDau, cuaSoNgay).
    const ngoai = !conTrongCuaSoGhiCong(QUY_NGUON, ngayThuDau, 90);
    const kq = ok(tinhDongChoKhoan(dau(ngoai)));
    return { ngoai, gt: dungGiaiThich({ treo: kq.treo, cuaSo: { attributedAt: QUY_NGUON, ngayThuDau, cuaSoNgay: 90 } }), chiTiet: chiTietCuaSo({ attributedAt: QUY_NGUON, ngayThuDau, cuaSoNgay: 90 }) };
  };
  it("ngày 90 = 11/12/2026: còn trong cửa sổ ⇒ 0 dòng; soNgayTre = 0", () => {
    const k = khoan("2026-12-11");
    expect(k.ngoai).toBe(false);
    expect(k.gt).toEqual([]);
    expect(k.chiTiet.soNgayTre).toBe(0);
    expect(k.chiTiet.hanGhiCong).toBe("2026-12-11");
  });
  it("ngày 91 = 12/12/2026: ngoài cửa sổ ⇒ 1 dòng; soNgayTre = 1", () => {
    const k = khoan("2026-12-12");
    expect(k.ngoai).toBe(true);
    expect(k.gt).toHaveLength(1);
    expect(k.gt[0]!.chiTiet).toMatchObject({ hanGhiCong: "2026-12-11", soNgayTre: 1, cuaSoNgay: 90 });
  });
  it("bất biến: soNgayTre > 0 ⇔ engine coi là ngoài cửa sổ, với mọi ngày thu từ ngày 80 đến 100", () => {
    for (let n = 80; n <= 100; n++) {
      const ngayThuDau = new Date(QUY_NGUON.getTime() + n * 86_400_000);
      expect(chiTietCuaSo({ attributedAt: QUY_NGUON, ngayThuDau, cuaSoNgay: 90 }).soNgayTre > 0).toBe(!conTrongCuaSoGhiCong(QUY_NGUON, ngayThuDau, 90));
    }
  });
});

describe("[GTK-03] chữ cho người đọc: Nguồn · Chính sách · «Không đủ điều kiện» · lý do + mã máy · Hoa hồng 0đ · «Lẽ ra»", () => {
  const doc = (p: Partial<DongGiaiThichDoc> = {}): DongGiaiThichDoc => ({
    id: "g1",
    reasonCode: "ATTRIBUTION_WINDOW_EXPIRED",
    roleCode: "SOURCE_OWNER",
    tenVai: "Người phụ trách nguồn",
    tenNhom: "Quảng cáo",
    tenChinhSach: "Marketing",
    documentNumber: "SR.QD.208",
    versionNo: 1,
    calcKind: "PERCENT",
    rate: 0.01,
    fixedAmount: null,
    wouldBeAmount: 440_000,
    chiTiet: chiTietCuaSo({ attributedAt: new Date("2026-12-04T03:00:00.000Z"), ngayThuDau: new Date("2026-12-20T03:00:00.000Z"), cuaSoNgay: 90 }),
    daCoTien: false,
    ...p,
  });
  it("ví dụ của chủ dự án: nguồn Quảng cáo · Marketing 1% · không đủ điều kiện · ATTRIBUTION_WINDOW_EXPIRED · 0đ · lẽ ra 440.000đ", () => {
    const n = dungNhanGiaiThich(doc({ chiTiet: chiTietCuaSo({ attributedAt: new Date("2026-09-12T03:00:00.000Z"), ngayThuDau: new Date("2026-12-20T03:00:00.000Z"), cuaSoNgay: 90 }) }));
    expect(n.nguon).toBe("Quảng cáo");
    expect(n.chinhSach).toContain("Marketing");
    expect(n.chinhSach).toContain("1%");
    expect(n.dieuKien).toBe("Không đủ điều kiện");
    expect(n.lyDoMa).toBe("ATTRIBUTION_WINDOW_EXPIRED");
    expect(n.lyDo).toBe("Khoản thu đầu tiên 20/12/2026 sau hạn ghi công 11/12/2026 (trễ 9 ngày; cửa sổ 90 ngày kể từ 12/09/2026).");
    expect(n.hoaHong).toBe("0đ");
    expect(n.leRa).toBe("Lẽ ra: 440.000đ");
    expect(n.thayThe).toBeNull();
  });
  it("tiền cố định theo lần mua: chữ nói mức cố định, không in «%»", () => {
    const n = dungNhanGiaiThich(doc({ calcKind: "FIXED_PER_PURCHASE", rate: null, fixedAmount: 300_000 }));
    expect(n.chinhSach).toContain("300.000đ / lần mua");
    expect(n.chinhSach).not.toContain("%");
  });
  it("đã có dòng sổ thật cho vai này ⇒ nói «đã được thay thế» (D8)", () => {
    expect(dungNhanGiaiThich(doc({ daCoTien: true })).thayThe).toContain("Đã được thay thế");
  });
  it("mã lạ ⇒ in chính mã, không bịa câu", () => {
    expect(dungNhanGiaiThich(doc({ reasonCode: "MA_LA_CHUA_BIET" })).lyDo).toBe("MA_LA_CHUA_BIET");
  });
});

describe("[GTK-04] giải thích KHÔNG phải đầu vào của hash: thêm/đổi nó không đổi `hashCuaKetQua` (tránh INPUT_DRIFT giả ở mọi ô cũ)", () => {
  // Chỉ những trường mà `hashCuaKetQua` đọc — ép kiểu có chủ đích trong test để khỏi dựng cả KeHoachThu (cần Payment).
  const kh = (them: object = {}): KeHoachThu =>
    ({
      vat: { grossAmount: 10_000_000, vatRate: 0, netBase: 10_000_000 },
      loaiGiaoDich: "NEW",
      studentId: "s1",
      orderItemId: "oi1",
      nguonChinhSach: { sourceGroupId: "g1", coHoaHong: true, affiliateId: null, sourceId: null, campaignId: null, eventId: null },
      nguon: { attributionId: "a1" },
      ngoaiCuaSo: true,
      daTraBangEngineCu: new Set<string>(),
      ...them,
    }) as unknown as KeHoachThu;
  const bc = { hoaHong: hh([]) } as unknown as Parameters<typeof hashCuaKetQua>[1];

  it("cùng kết quả tính, `cuaSo` khác nhau ⇒ cùng hash; `nguoiDuKien` khác nhau ⇒ cùng hash", () => {
    const kq = tinhDongChoKhoan(dau(true));
    const goc = hashCuaKetQua(kh(), bc, 10_000_000, kq);
    const cuaSoA = { cuaSo: { attributedAt: QUY_NGUON, ngayThuDau: NGAY_THU_DAU_TRE, cuaSoNgay: 90 } };
    const cuaSoB = { cuaSo: { attributedAt: new Date("2026-01-01T03:00:00.000Z"), ngayThuDau: new Date("2026-12-31T03:00:00.000Z"), cuaSoNgay: 30 } };
    expect(hashCuaKetQua(kh(cuaSoA), bc, 10_000_000, kq)).toBe(goc);
    expect(hashCuaKetQua(kh(cuaSoB), bc, 10_000_000, kq)).toBe(goc);
    if (kq.loai !== "OK") throw new Error("OK");
    const kqKhac = { ...kq, treo: kq.treo.map((t) => ({ ...t, nguoiDuKien: [{ kind: "USER" as const, id: "nguoi-khac" }] })) };
    expect(hashCuaKetQua(kh(), bc, 10_000_000, kqKhac)).toBe(goc);
  });
  it("đối chứng dương: đổi `ngoaiCuaSo` (đầu vào THẬT) thì hash ĐỔI — phép đo có răng", () => {
    const kq = tinhDongChoKhoan(dau(true));
    expect(hashCuaKetQua(kh({ ngoaiCuaSo: false }), bc, 10_000_000, kq)).not.toBe(hashCuaKetQua(kh(), bc, 10_000_000, kq));
  });
});

describe("[GTK-05] mã lý do ngoài tập hỗ trợ ⇒ KHÔNG sinh dòng; thiết kế chứa được mã khác mà không đổi cấu trúc", () => {
  const treoMau = (lyDo: LyDoTreo): TreoNhap => {
    const kq = ok(tinhDongChoKhoan(dau(true)));
    return { ...kq.treo[0]!, lyDo };
  };
  const cuaSo = { attributedAt: QUY_NGUON, ngayThuDau: NGAY_THU_DAU_TRE, cuaSoNgay: 90 };
  it("chỉ NGOAI_CUA_SO có mã; mọi LyDoTreo khác ⇒ null và 0 dòng", () => {
    const moi: LyDoTreo[] = [
      "KHONG_CO_LEAD", "LEAD_THIEU_NGUOI", "CHUA_KHAI_NGUOI_PHU_TRACH", "KHONG_QUY_VE_CO_SO", "KHONG_CO_GV_TRIAL", "THIEU_NGUOI_GIOI_THIEU", "THIEU_SALE_PHU_HUYNH",
      "NGUON_CHUA_CO_NGUOI_PHU_TRACH", "NGUOI_HUONG_NGHI", "RESOLVER_CHUA_HO_TRO", "RESOLVER_KHONG_BIET", "LEGACY_DA_TRA",
    ];
    for (const ly of moi) {
      expect(maGiaiThichCua(ly)).toBeNull();
      expect(dungGiaiThich({ treo: [treoMau(ly)], cuaSo })).toEqual([]);
    }
    expect(maGiaiThichCua("NGOAI_CUA_SO")).toBe("ATTRIBUTION_WINDOW_EXPIRED");
    expect(Object.keys(MA_THEO_LY_DO_TREO)).toEqual(["NGOAI_CUA_SO"]);
  });
  it("mã đọc từ DB: chỉ mã trong danh sách mới hợp lệ", () => {
    expect(MA_LY_DO_GIAI_THICH.every(laMaGiaiThich)).toBe(true);
    expect(laMaGiaiThich("MA_LA")).toBe(false);
    expect(laMaGiaiThich(null)).toBe(false);
  });
  it("không có cửa sổ ⇒ không bịa số ngày: 0 dòng; tienVai = 0 ⇒ 0 dòng (không có gì bị mất)", () => {
    const kq = ok(tinhDongChoKhoan(dau(true)));
    expect(dungGiaiThich({ treo: kq.treo, cuaSo: null })).toEqual([]);
    expect(dungGiaiThich({ treo: kq.treo.map((t) => ({ ...t, tienVai: 0 })), cuaSo })).toEqual([]);
  });
  it("không biết người (nguoiDuKien rỗng): MỘT dòng khoá «-», lẽ ra = tiền cả vai", () => {
    const kq = ok(tinhDongChoKhoan(dau(true)));
    const gt = dungGiaiThich({ treo: kq.treo.map((t) => ({ ...t, nguoiDuKien: [] })), cuaSo });
    expect(gt).toHaveLength(1);
    expect(gt[0]).toMatchObject({ beneficiaryKey: "-", beneficiaryKind: null, beneficiaryId: null, wouldBeAmount: 200_000 });
  });
});

describe("[GTK-06] nguồn của `nguoiDuKien`: lấy từ kết quả người hưởng THÔ — không rỗng như `VaiKetQua.nguoi` của vai bị treo", () => {
  it("vai thu hút ngoài cửa sổ mang đúng những người lẽ ra được hưởng; phần người nghỉ việc mang chính người đó", () => {
    const ngoai = ok(tinhDongChoKhoan(dau(true)));
    expect(ngoai.treo).toHaveLength(1);
    expect(ngoai.treo[0]!.nguoiDuKien).toEqual([{ kind: "USER", id: "u-ph" }]);
    expect(ngoai.cacVai.find((v) => v.roleCode === "REFERRER_PARENT")!.nguoi).toEqual([]); // đây là lý do phải lấy từ nguồn thô

    const nghi = ok(
      tinhDongChoKhoan(
        dau(false, {
          SALE: co("u-sale"),
          REFERRER_PARENT: { loai: "CO_NGUOI", nguoi: [{ kind: "USER", id: "u-a" }, { kind: "USER", id: "u-b" }], biLoai: [{ nguoi: { kind: "USER", id: "u-b" }, lyDo: "NGUOI_HUONG_NGHI" }], canCu: "t" },
        }),
      ),
    );
    expect(nghi.treo).toEqual([expect.objectContaining({ lyDo: "NGUOI_HUONG_NGHI", nguoiDuKien: [{ kind: "USER", id: "u-b" }] })]);
  });
});
