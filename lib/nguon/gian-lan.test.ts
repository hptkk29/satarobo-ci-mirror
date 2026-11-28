/**
 * Ca [NHH-FRD-*] — `phatHienGianLan` (03 §4). THUẦN. Mọi ca kèm đối chứng dương (luật: ca chỉ khẳng định SỰ VẮNG MẶT
 * luôn ĐẠT khi tính năng hỏng hoàn toàn).
 *
 * 09/10/2026 (res3-1/2): gian lận = hai tập DANH TÍNH giao nhau, so ở cả hai không gian id (`User.id` · `Employee.id`).
 * 09/10/2026 (chủ dự án chốt): hàm này CHỈ chạy ở đường ĐỔI nguồn của lead đã có (`doiNguonLead`). Đường TẠO lead không soi — người gõ phiếu
 * có phiên đăng nhập được GHI làm người giới thiệu (D12). Lưới ghim: [DYN-CC-W2].
 * 06/11/2026: chủ lead (không phải người bấm) trùng người hưởng ⇒ từ BLOCK hạ xuống CẢNH BÁO.
 * 20/11/2026 (chủ dự án: «lead do sale đó kiếm về … vẫn tính như bình thường thôi»): ca đó KHÔNG còn cờ nào. Chỉ còn «người BẤM = người hưởng» ⇒ BLOCK.
 */
import { describe, expect, it } from "vitest";
import { DANH_TINH_TRONG, danhTinhNguoiNhan, danhTinhTu, giaoNhauDanhTinh, phatHienGianLan } from "./gian-lan";

const NV = new Map<string, string>([["84905111222", "E_NV"]]);

const nhanSu = (e: string) => danhTinhNguoiNhan({ referrerEmployeeId: e, referrerSaleUserId: null, chuNguonEmployeeId: null, referrerAffiliateIdentity: DANH_TINH_TRONG });

/** Người BẤM mặc định là một QUẢN LÝ (U_QL / E_QL). Người nhận mặc định: nhân sự E1 (Sale U1 đang chăm lead) làm người giới thiệu. */
const goc = {
  nguoiBam: danhTinhTu({ userIds: ["U_QL"], employeeIds: ["E_QL"] }),
  nguoiNhan: nhanSu("E1"),
  sdtKhach: "0988000111",
  sdtNhanVien: NV,
  sdtNguoiGioiThieu: null,
};

describe("[NHH-FRD-01] TU_CLAIM — chỉ «người BẤM tự ghi công cho chính mình» bị chặn (20/11/2026)", () => {
  it("quản lý ghi Sale đang chăm lead làm người giới thiệu («Sale tự kiếm») ⇒ KHÔNG cờ nào — tính bình thường", () => {
    expect(phatHienGianLan(goc)).toEqual([]);
  });
  it("người bấm CHÍNH LÀ người sẽ hưởng ⇒ BLOCK — ở cả hai không gian id", () => {
    expect(phatHienGianLan({ ...goc, nguoiBam: danhTinhTu({ userIds: ["U1"], employeeIds: ["E1"] }) })).toEqual([{ ma: "TU_CLAIM", muc: "BLOCK" }]);
    expect(phatHienGianLan({ ...goc, nguoiBam: danhTinhTu({ employeeIds: ["E1"] }) })).toEqual([{ ma: "TU_CLAIM", muc: "BLOCK" }]); // chỉ khớp Employee.id
    const saleUser = danhTinhNguoiNhan({ referrerEmployeeId: null, referrerSaleUserId: "U1", chuNguonEmployeeId: null, referrerAffiliateIdentity: DANH_TINH_TRONG });
    expect(phatHienGianLan({ ...goc, nguoiNhan: saleUser, nguoiBam: danhTinhTu({ userIds: ["U1"] }) })).toEqual([{ ma: "TU_CLAIM", muc: "BLOCK" }]); // chỉ khớp User.id
    // Đối chứng dương: người bấm khác ⇒ không BLOCK với CÙNG người nhận.
    expect(phatHienGianLan({ ...goc, nguoiNhan: saleUser })).toEqual([]);
  });
  it("mọi kiểu người hưởng (nhân sự giới thiệu · Sale phụ trách PH · chủ nguồn · đối tác) trùng NGƯỜI BẤM ⇒ BLOCK; người bấm là bên thứ ba ⇒ rỗng", () => {
    const tuBam = danhTinhTu({ userIds: ["U1"], employeeIds: ["E1"] });
    const nguoiNhan = [
      nhanSu("E1"),
      danhTinhNguoiNhan({ referrerEmployeeId: null, referrerSaleUserId: "U1", chuNguonEmployeeId: null, referrerAffiliateIdentity: DANH_TINH_TRONG }),
      danhTinhNguoiNhan({ referrerEmployeeId: null, referrerSaleUserId: null, chuNguonEmployeeId: "E1", referrerAffiliateIdentity: DANH_TINH_TRONG }),
      danhTinhNguoiNhan({ referrerEmployeeId: null, referrerSaleUserId: null, chuNguonEmployeeId: null, referrerAffiliateIdentity: danhTinhTu({ employeeIds: ["E1"] }) }),
      danhTinhNguoiNhan({ referrerEmployeeId: null, referrerSaleUserId: null, chuNguonEmployeeId: null, referrerAffiliateIdentity: danhTinhTu({ userIds: ["U1"] }) }),
    ];
    for (const n of nguoiNhan) {
      expect(phatHienGianLan({ ...goc, nguoiBam: tuBam, nguoiNhan: n })).toEqual([{ ma: "TU_CLAIM", muc: "BLOCK" }]);
      expect(phatHienGianLan({ ...goc, nguoiNhan: n })).toEqual([]);
    }
  });
  it("danh tính đối tác CỘNG vào các kiểu người hưởng khác chứ không thay (nhân sự E1 + đối tác khác, người bấm là E1 ⇒ BLOCK)", () => {
    const n = danhTinhNguoiNhan({ referrerEmployeeId: "E1", referrerSaleUserId: null, chuNguonEmployeeId: null, referrerAffiliateIdentity: danhTinhTu({ employeeIds: ["E_KHAC"] }) });
    expect(phatHienGianLan({ ...goc, nguoiBam: danhTinhTu({ employeeIds: ["E1"] }), nguoiNhan: n }).map((c) => c.ma)).toEqual(["TU_CLAIM"]);
  });
  it("đối chứng: không có người nhận nào (nguồn không cần người) ⇒ không chặn kể cả khi người bấm có danh tính", () => {
    expect(phatHienGianLan({ ...goc, nguoiBam: danhTinhTu({ userIds: ["U1"], employeeIds: ["E1"] }), nguoiNhan: DANH_TINH_TRONG })).toEqual([]);
  });
  it("hai không gian id KHÔNG lẫn nhau: User.id 'E1' không bị coi là Employee.id 'E1'", () => {
    const chiCoUser = danhTinhTu({ userIds: ["X1"], employeeIds: [] });
    expect(giaoNhauDanhTinh(chiCoUser, danhTinhTu({ employeeIds: ["X1"] }))).toBe(false);
    expect(giaoNhauDanhTinh(chiCoUser, danhTinhTu({ userIds: ["X1"] }))).toBe(true);
  });
  it("hàm KHÔNG còn nhận «chủ lead»: không có đường nào để ca «Sale tự kiếm» bị gắn cờ trở lại", () => {
    expect("chuLead" in goc).toBe(false);
  });
});

describe("[NHH-FRD-02] SDT_NHAN_VIEN / NGUOI_GT_LA_KHACH — CẢNH BÁO, không chặn", () => {
  const khongNguoi = { ...goc, nguoiNhan: DANH_TINH_TRONG };
  it("SĐT khách trùng SĐT nhân viên (so canonical: 0905… ≡ 84905…) ⇒ WARNING", () => {
    expect(phatHienGianLan({ ...khongNguoi, sdtKhach: "0905 111 222" }).map((c) => [c.ma, c.muc])).toEqual([["SDT_NHAN_VIEN", "WARNING"]]);
  });
  it("đối chứng: SĐT khách không trùng ai ⇒ rỗng", () => {
    expect(phatHienGianLan(khongNguoi)).toEqual([]);
  });
  it("khách không có SĐT (null/rỗng) không khớp bất kỳ nhân viên nào", () => {
    expect(phatHienGianLan({ ...khongNguoi, sdtKhach: null })).toEqual([]);
    expect(phatHienGianLan({ ...khongNguoi, sdtKhach: "" })).toEqual([]);
  });
  it("người giới thiệu trùng SĐT khách ⇒ NGUOI_GT_LA_KHACH WARNING; khác SĐT ⇒ không", () => {
    expect(phatHienGianLan({ ...khongNguoi, sdtNguoiGioiThieu: "84988000111" }).map((c) => c.ma)).toEqual(["NGUOI_GT_LA_KHACH"]);
    expect(phatHienGianLan({ ...khongNguoi, sdtNguoiGioiThieu: "0977000999" })).toEqual([]);
  });
  it("ba cờ có thể cùng xuất hiện; TU_CLAIM đứng trước", () => {
    const r = phatHienGianLan({ ...goc, nguoiBam: danhTinhTu({ employeeIds: ["E1"] }), sdtKhach: "0905111222", sdtNguoiGioiThieu: "0905111222" });
    expect(r.map((c) => c.ma)).toEqual(["TU_CLAIM", "SDT_NHAN_VIEN", "NGUOI_GT_LA_KHACH"]);
  });
});
