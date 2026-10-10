/**
 * Ca [NHH-FRD-*] — `phatHienGianLan` (03 §4). THUẦN. Mọi ca kèm đối chứng dương (luật: ca chỉ khẳng định SỰ VẮNG MẶT
 * luôn ĐẠT khi tính năng hỏng hoàn toàn).
 *
 * 09/10/2026 (res3-1/2): TU_CLAIM không còn đòi "actor = chủ assignedToId ∧ nguồn cũ ≠ UNKNOWN ∧ người nhận là nhân sự" — gian lận = hai tập
 * DANH TÍNH giao nhau (chủ lead × người sẽ hưởng), so ở cả hai không gian id.
 *
 * 09/10/2026 (chủ dự án chốt, SAU đợt củng cố): hàm này CHỈ chạy ở đường ĐỔI nguồn của lead đã có (`doiNguonLead`). Đường TẠO lead không soi nữa — người gõ phiếu
 * có phiên đăng nhập được GHI làm người giới thiệu (D12). Lưới ghim: [DYN-CC-W2] (`phanTuNhan` không còn, `quy-nguon.ts` không gọi `phatHienGianLan`).
 */
import { describe, expect, it } from "vitest";
import { DANH_TINH_TRONG, danhTinhNguoiNhan, danhTinhTu, giaoNhauDanhTinh, phatHienGianLan } from "./gian-lan";

const NV = new Map<string, string>([["84905111222", "E_NV"]]);

/** Chủ lead: user U1 (nhân sự E1). Người nhận mặc định: chính E1 làm người giới thiệu. */
const goc = {
  chuLead: danhTinhTu({ userIds: ["U1"], employeeIds: ["E1"] }),
  nguoiNhan: danhTinhNguoiNhan({ referrerEmployeeId: "E1", referrerSaleUserId: null, chuNguonEmployeeId: null }),
  sdtKhach: "0988000111",
  sdtNhanVien: NV,
  sdtNguoiGioiThieu: null,
};

describe("[NHH-FRD-01] TU_CLAIM — người SẼ HƯỞNG trùng một CHỦ CỦA LEAD ⇒ BLOCK", () => {
  it("nhân sự giới thiệu = chính chủ lead ⇒ BLOCK", () => {
    expect(phatHienGianLan(goc)).toEqual([{ ma: "TU_CLAIM", muc: "BLOCK" }]);
  });
  it("đối chứng: người giới thiệu là NGƯỜI KHÁC ⇒ không chặn", () => {
    expect(phatHienGianLan({ ...goc, nguoiNhan: danhTinhNguoiNhan({ referrerEmployeeId: "E_KHAC", referrerSaleUserId: null, chuNguonEmployeeId: null }) })).toEqual([]);
  });
  it("đối chứng: không có người nhận nào (nguồn không cần người) ⇒ không chặn", () => {
    expect(phatHienGianLan({ ...goc, nguoiNhan: DANH_TINH_TRONG })).toEqual([]);
  });
  it("đối chứng: lead chưa có chủ nào (danh tính rỗng) ⇒ không 'trùng' với ai", () => {
    expect(phatHienGianLan({ ...goc, chuLead: DANH_TINH_TRONG })).toEqual([]);
  });
  it("KHÔNG còn điều kiện nguồn cũ: hàm không nhận 'nguồn cũ là UNKNOWN' nên lead UNKNOWN cũng bị (res3-1: lead UNKNOWN từng lọt)", () => {
    expect("nguonCuLaUnknown" in goc).toBe(false);
    expect(phatHienGianLan(goc).map((c) => c.ma)).toContain("TU_CLAIM");
  });
  it("KHÔNG còn điều kiện 'actor = assignedToId': chủ lead là người CHỐT ĐƠN (convertedById) hay SALE ADMIN cũng đủ (engine trả tiền Sale theo hai cột đó)", () => {
    // chủ lead = {assignedTo: U2, convertedBy: U1, admin: U3}; người nhận là nhân sự của U3 (E3) ⇒ trùng ở không gian employeeId.
    const chu = danhTinhTu({ userIds: ["U2", "U1", "U3"], employeeIds: ["E2", "E1", "E3"] });
    expect(phatHienGianLan({ ...goc, chuLead: chu, nguoiNhan: danhTinhNguoiNhan({ referrerEmployeeId: "E3", referrerSaleUserId: null, chuNguonEmployeeId: null }) }).map((c) => c.ma)).toEqual(["TU_CLAIM"]);
    expect(phatHienGianLan({ ...goc, chuLead: chu, nguoiNhan: danhTinhNguoiNhan({ referrerEmployeeId: "E9", referrerSaleUserId: null, chuNguonEmployeeId: null }) })).toEqual([]);
  });
  it("Sale phụ trách phụ huynh (User.id) trùng chủ lead ⇒ BLOCK; Sale khác ⇒ không (đối chứng dương)", () => {
    expect(phatHienGianLan({ ...goc, nguoiNhan: danhTinhNguoiNhan({ referrerEmployeeId: null, referrerSaleUserId: "U1", chuNguonEmployeeId: null }) }).map((c) => c.ma)).toEqual(["TU_CLAIM"]);
    expect(phatHienGianLan({ ...goc, nguoiNhan: danhTinhNguoiNhan({ referrerEmployeeId: null, referrerSaleUserId: "U_KHAC", chuNguonEmployeeId: null }) })).toEqual([]);
  });
  it("người PHỤ TRÁCH NGUỒN (Employee.id) trùng chủ lead ⇒ BLOCK; chủ nguồn khác ⇒ không (đối chứng dương)", () => {
    expect(phatHienGianLan({ ...goc, nguoiNhan: danhTinhNguoiNhan({ referrerEmployeeId: null, referrerSaleUserId: null, chuNguonEmployeeId: "E1" }) }).map((c) => c.ma)).toEqual(["TU_CLAIM"]);
    expect(phatHienGianLan({ ...goc, nguoiNhan: danhTinhNguoiNhan({ referrerEmployeeId: null, referrerSaleUserId: null, chuNguonEmployeeId: "E_KHAC" }) })).toEqual([]);
  });
  it("hai không gian id KHÔNG lẫn nhau: User.id 'E1' không bị coi là Employee.id 'E1'", () => {
    const chuChiCoUser = danhTinhTu({ userIds: ["X1"], employeeIds: [] });
    expect(giaoNhauDanhTinh(chuChiCoUser, danhTinhTu({ employeeIds: ["X1"] }))).toBe(false);
    expect(giaoNhauDanhTinh(chuChiCoUser, danhTinhTu({ userIds: ["X1"] }))).toBe(true);
  });
});

describe("[NHH-FRD-01b] đường ĐỔI nguồn là nơi DUY NHẤT chặn tự nhận — vẫn đủ cả ba kiểu người hưởng", () => {
  it("[FIX-F1b] chủ nguồn đích = chủ lead ⇒ TU_CLAIM BLOCK (lead có sẵn chuyển sang nguồn của chính mình); chủ nguồn khác ⇒ qua (đối chứng dương)", () => {
    const nguoiNhan = danhTinhNguoiNhan({ referrerEmployeeId: null, referrerSaleUserId: null, chuNguonEmployeeId: "E1" });
    expect(phatHienGianLan({ ...goc, nguoiNhan }).map((c) => c.ma)).toEqual(["TU_CLAIM"]);
    expect(phatHienGianLan({ ...goc, nguoiNhan: danhTinhNguoiNhan({ referrerEmployeeId: null, referrerSaleUserId: null, chuNguonEmployeeId: "E_KHAC" }) })).toEqual([]);
  });
  it("[FIX-F1d] nguồn đích KHÔNG có người hưởng nào (vd chuyển sang Quảng cáo không chủ) ⇒ chủ lead không bị phạt vì một thao tác không liên quan", () => {
    expect(phatHienGianLan({ ...goc, nguoiNhan: danhTinhNguoiNhan({ referrerEmployeeId: null, referrerSaleUserId: null, chuNguonEmployeeId: null }) })).toEqual([]);
  });
});

describe("[NHH-FRD-02] SDT_NHAN_VIEN / NGUOI_GT_LA_KHACH — CẢNH BÁO, không chặn", () => {
  const khongTu = { ...goc, chuLead: DANH_TINH_TRONG };
  it("SĐT khách trùng SĐT nhân viên (so canonical: 0905… ≡ 84905…) ⇒ WARNING", () => {
    expect(phatHienGianLan({ ...khongTu, sdtKhach: "0905 111 222" }).map((c) => [c.ma, c.muc])).toEqual([["SDT_NHAN_VIEN", "WARNING"]]);
  });
  it("đối chứng: SĐT khách không trùng ai ⇒ rỗng", () => {
    expect(phatHienGianLan(khongTu)).toEqual([]);
  });
  it("khách không có SĐT (null/rỗng) không khớp bất kỳ nhân viên nào", () => {
    expect(phatHienGianLan({ ...khongTu, sdtKhach: null })).toEqual([]);
    expect(phatHienGianLan({ ...khongTu, sdtKhach: "" })).toEqual([]);
  });
  it("người giới thiệu trùng SĐT khách ⇒ NGUOI_GT_LA_KHACH WARNING; khác SĐT ⇒ không", () => {
    expect(phatHienGianLan({ ...khongTu, sdtNguoiGioiThieu: "84988000111" }).map((c) => c.ma)).toEqual(["NGUOI_GT_LA_KHACH"]);
    expect(phatHienGianLan({ ...khongTu, sdtNguoiGioiThieu: "0977000999" })).toEqual([]);
  });
  it("hai cờ có thể cùng xuất hiện; TU_CLAIM đứng trước", () => {
    const r = phatHienGianLan({ ...goc, sdtKhach: "0905111222", sdtNguoiGioiThieu: "0905111222" });
    expect(r.map((c) => c.ma)).toEqual(["TU_CLAIM", "SDT_NHAN_VIEN", "NGUOI_GT_LA_KHACH"]);
  });
});
