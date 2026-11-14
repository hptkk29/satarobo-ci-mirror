/**
 * Ca [LIE-*] — nhãn legacy «Import Excel» (chủ dự án chốt 21/10/2026): KHÔNG phải nguồn khách, chỉ là phương thức nhập.
 * Đích chuẩn của DI TRÚ: nhóm UNKNOWN + xem tay `LEGACY_IMPORT_SOURCE_UNKNOWN` + KHÔNG hoa hồng tới khi xử lý tay.
 * Ngày là TUYỆT ĐỐI (luật 19). Ca đường SỐNG ([LIE-05]) khoá việc bảng 28 dòng + `anhXaNhanCu` KHÔNG đổi.
 */
import { describe, expect, it } from "vitest";
import {
  BANG_ANH_XA_0610,
  anhXaNhanCu,
  anhXaNhanDiTru,
  laNhanPhuongThucNhapLegacy,
  leadSourceTuNhanExcel,
  tomTatDiTru,
  type HangDiTru,
} from "./anh-xa-nhan-cu";
import { VAI_SANG_NGUON_MAC_DINH, NHOM_NHAN_SU_GOC } from "./danh-muc-goc";
import { dungKeHoachDiTru, kiemCongGhi, phanLoaiGhi, type NhomDiTru } from "./di-tru-ke-hoach";
import { dungDuLieuGhiDiTru } from "./di-tru-du-lieu";
import { LY_DO_XEM_TAY_HANG_CHO, NHAN_XEM_TAY } from "./nhan-hien-thi";
import { coLyDoXemTay } from "./doc-nguon-hoa-hong";

const LUC = new Date("2026-10-15T03:00:00.000Z");
const dau = (nhan: string | null) => ({ nhan, createdAt: LUC, affiliate: null, nguoiNhap: null, maNvTrongNote: null });
const diTru = (nhan: string | null) => anhXaNhanDiTru(dau(nhan), VAI_SANG_NGUON_MAC_DINH, NHOM_NHAN_SU_GOC);

const hang = (id: string, nhan: string | null): HangDiTru => ({ leadId: id, kq: diTru(nhan), nhanChuan: nhan === null ? null : nhan.trim().toLowerCase(), createdAt: LUC });
const NHOM: NhomDiTru[] = [
  { id: "g-unk", code: "UNKNOWN", ownerEmployeeId: null, attributionWindowDays: null },
  { id: "g-ads", code: "PAID_ADS", ownerEmployeeId: null, attributionWindowDays: null },
];

describe("[LIE-01] di trú: «Import Excel» → UNKNOWN + xem tay, KHÔNG INVALID, KHÔNG nguồn kinh doanh nào", () => {
  it("kết quả: loai UNKNOWN · nhóm UNKNOWN · không người · không giải trình · đúng một lý do", () => {
    const k = diTru("Import Excel");
    expect(k).toMatchObject({ loai: "UNKNOWN", nhom: "UNKNOWN", nguoi: null, vaiNguon: null, referrerMissing: false, giaiTrinh: null });
    expect(k.loai === "INVALID" ? [] : k.xemTay).toEqual(["LEGACY_IMPORT_SOURCE_UNKNOWN"]);
  });
  it("chuẩn hoá: hoa/thường, khoảng trắng thừa — cùng kết quả; KHÔNG bắt «Import Excel ĐK» (nhãn #26) hay chuỗi chứa «import excel»", () => {
    for (const v of ["import excel", "IMPORT EXCEL", "  Import   Excel  ", "Import Excel"]) expect(laNhanPhuongThucNhapLegacy(v), v).toBe(true);
    for (const v of ["Import Excel ĐK", "import excel 2", "excel", "Import", null, ""]) expect(laNhanPhuongThucNhapLegacy(v), String(v)).toBe(false);
    expect(diTru("Import Excel ĐK")).toMatchObject({ loai: "MAPPED", nhom: "EMPLOYEE_REFERRAL", stt: 26 }); // luật cũ giữ nguyên
  });
  it("không bao giờ ra một nhóm kinh doanh: với MỌI cách viết, nhóm đích chỉ là UNKNOWN", () => {
    for (const v of ["Import Excel", "import excel", "IMPORT EXCEL"]) {
      const k = diTru(v);
      expect(k.loai === "INVALID" ? "INVALID" : k.nhom, v).toBe("UNKNOWN");
    }
  });
  it("phân loại ghi = MANUAL_REVIEW (không AUTO, không UNKNOWN trần, không INVALID)", () => {
    expect(phanLoaiGhi(diTru("Import Excel"))).toBe("MANUAL_REVIEW");
  });
});

describe("[LIE-02] tóm tắt di trú: 328 dòng không còn INVALID nhưng vẫn là MANUAL_REVIEW; tổng ghi = toàn bộ lead", () => {
  const hs: HangDiTru[] = [
    ...Array.from({ length: 5 }, (_, i) => hang(`x${i}`, "Import Excel")),
    ...Array.from({ length: 3 }, (_, i) => hang(`a${i}`, "Ads")),
    hang("r", null),
  ];
  const t = tomTatDiTru(hs, new Set());
  it("invalid 0 · manualReview = số Import Excel · mapped = Ads · unknown = nhãn rỗng · total = seGhi", () => {
    expect(t).toMatchObject({ total: 9, invalid: 0, manualReview: 5, mapped: 3, unknown: 1, duplicate: 0, seGhi: 9 });
    expect(t.mapped + t.unknown + t.invalid + t.duplicate + t.manualReview).toBe(t.total);
    expect(t.xemTayTheoLyDo.LEGACY_IMPORT_SOURCE_UNKNOWN).toBe(5);
  });
  it("đích đếm: 5 dòng Import Excel nằm ở UNKNOWN (không chạm PAID_ADS / EMPLOYEE_REFERRAL / WALK_IN / CENTER_ORGANIC)", () => {
    expect(t.theoDich.UNKNOWN).toBe(6); // 5 Import Excel + 1 nhãn rỗng
    expect(t.theoDich.PAID_ADS).toBe(3);
    expect(t.theoDich.EMPLOYEE_REFERRAL + t.theoDich.WALK_IN + t.theoDich.CENTER_ORGANIC).toBe(0);
  });
  it("kế hoạch GHI: không INVALID ⇒ cổng INVALID KHÔNG còn chặn; N khớp", () => {
    const kh = dungKeHoachDiTru({ hang: hs, chiTiet: new Map(), nhom: NHOM, nhomCanChu: new Set(), cuaSoMacDinhNgay: 90 });
    expect(kh.tong).toMatchObject({ invalid: 0, review: 5, auto: 3, unknown: 1, ghi: 9 });
    expect(kiemCongGhi(kh, { soDuyet: 9, soDuyetReview: 5, sha: kh.sha, chapNhanNguonChuaCoChu: [] })).toEqual({ ok: true });
  });
});

describe("[LIE-03] dữ liệu sẽ ghi: lead vẫn ở trạng thái CẦN XEM TAY và nhìn thấy được ở hàng chờ", () => {
  // Tính TRONG ca (không ở cấp describe): nếu luật legacy hỏng thì chỉ ca này đỏ, không sập cả tệp lúc thu thập.
  const dungGhi = () => {
    const kh = dungKeHoachDiTru({ hang: [hang("x1", "Import Excel")], chiTiet: new Map(), nhom: NHOM, nhomCanChu: new Set(), cuaSoMacDinhNgay: 90 });
    return dungDuLieuGhiDiTru(kh.dong[0]!, { cuaSoNgay: 90, chuNhanVienId: null }).duLieu;
  };
  it("signals.coXemTay = true và signals.xemTay chứa lý do; nhóm UNKNOWN; phương thức UNKNOWN; KHÔNG người giới thiệu", () => {
    const ghi = dungGhi();
    const s = ghi.signals as Record<string, unknown>;
    expect(s.coXemTay).toBe(true);
    expect(s.xemTay).toEqual(["LEGACY_IMPORT_SOURCE_UNKNOWN"]);
    expect(ghi.groupId).toBe("g-unk");
    expect(ghi.identificationMethod).toBe("UNKNOWN");
    expect(ghi.referrerEmployeeId).toBeNull();
    expect(ghi.referrerKind).toBeNull();
    expect(ghi.referrerParentUserId).toBeNull();
    expect(ghi.referrerAffiliateId).toBeNull();
    expect(ghi.referrerSaleUserId).toBeNull();
  });
  it("lý do nằm trong danh sách HÀNG CHỜ (nếu không, lead cần xem tay sẽ vô hình) và có nhãn tiếng Việt", () => {
    expect((LY_DO_XEM_TAY_HANG_CHO as readonly string[]).includes("LEGACY_IMPORT_SOURCE_UNKNOWN")).toBe(true);
    expect(NHAN_XEM_TAY.LEGACY_IMPORT_SOURCE_UNKNOWN).toMatch(/Excel/);
  });
});

describe("[LIE-04] engine hoa hồng đọc lý do: coLyDoXemTay (thuần, chịu JSON lạ)", () => {
  it("true chỉ khi signals.xemTay là mảng chứa đúng lý do", () => {
    expect(coLyDoXemTay({ xemTay: ["LEGACY_IMPORT_SOURCE_UNKNOWN"] }, "LEGACY_IMPORT_SOURCE_UNKNOWN")).toBe(true);
    expect(coLyDoXemTay({ xemTay: ["THIEU_NGUOI", "LEGACY_IMPORT_SOURCE_UNKNOWN"] }, "LEGACY_IMPORT_SOURCE_UNKNOWN")).toBe(true);
  });
  it("false với lý do khác · mảng rỗng · thiếu khoá · không phải mảng · null · chuỗi · số", () => {
    for (const s of [{ xemTay: ["THIEU_NGUOI"] }, { xemTay: [] }, {}, { xemTay: "LEGACY_IMPORT_SOURCE_UNKNOWN" }, { xemTay: null }, null, undefined, "x", 5, []]) {
      expect(coLyDoXemTay(s, "LEGACY_IMPORT_SOURCE_UNKNOWN"), JSON.stringify(s)).toBe(false);
    }
  });
  it("ĐỐI CHỨNG: sau khi người xử lý tay (đổi nguồn gỡ coXemTay + xemTay khỏi signals) ⇒ false ⇒ engine tính lại bình thường", () => {
    const sau = { nguon: { chuNhanVienId: null }, nhanGoc: "import excel" };
    expect(coLyDoXemTay(sau, "LEGACY_IMPORT_SOURCE_UNKNOWN")).toBe(false);
  });
});

describe("[LIE-05] ĐƯỜNG SỐNG KHÔNG ĐỔI: bảng 28 dòng và anhXaNhanCu vẫn xếp «Import Excel» là INVALID (nhãn HỆ THỐNG mặc định của nhập Excel)", () => {
  it("anhXaNhanCu('Import Excel') = INVALID; BANG_ANH_XA_0610 vẫn đúng 28 dòng và không chứa nhãn này", () => {
    expect(anhXaNhanCu(dau("Import Excel"), VAI_SANG_NGUON_MAC_DINH, NHOM_NHAN_SU_GOC)).toMatchObject({ loai: "INVALID" });
    expect(BANG_ANH_XA_0610).toHaveLength(28);
    expect(BANG_ANH_XA_0610.some((r) => r.nhan.trim().toLowerCase() === "import excel")).toBe(false);
  });
  it("leadSourceTuNhanExcel: chữ tự do ⇒ nhãn hệ thống «Import Excel» (macDinh) — hợp đồng của đường nhập không đổi", () => {
    expect(leadSourceTuNhanExcel("chu tu do 0905123456", "Import Excel")).toBe("Import Excel");
  });
});
