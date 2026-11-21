import { describe, expect, it } from "vitest";

import {
  MOI_NGUOI_XEM,
  MOI_NOI_DUNG,
  MA_TRAN_QUYEN,
  chuSoCuaGiaDinh,
  cheDoTreEmDocDuocLatCat,
  coQuyenDoc,
  quyenXem,
  type NguoiXem,
  type NoiDungDisc,
  type Quyen,
} from "./quyen";

/**
 * BẢNG KỲ VỌNG chép TỪNG Ô từ doc 18 mục 8 — viết tay, KHÔNG sinh từ MA_TRAN_QUYEN
 * (nếu sinh từ chính nó thì test chỉ chứng minh nó bằng nó).
 * Thứ tự cột: CHU_SO · CHE_DO_TRE_EM · PH_KHAC · GIAO_VIEN · SALE_QLCS · ADMIN_HE_THONG
 */
const K: Quyen = "KHONG";
const NA: Quyen = "KHONG_AP_DUNG";
const BANG: Record<NoiDungDisc, [Quyen, Quyen, Quyen, Quyen, Quyen, Quyen]> = {
  DANH_SACH_THANH_VIEN: ["XEM_VA_SUA", K, K, K, K, K],
  BAI_LAM_MOI_THANH_VIEN: ["XEM", "CHI_BAI_CUA_X_BAN_TRE_EM", K, K, K, K],
  BAO_CAO_CA_NHAN_NGUOI_LON: ["XEM", K, K, K, K, K],
  LOI_KHUYEN_VE_TRE: ["XEM", K, K, K, K, K],
  LAT_CAT_CO_X: ["XEM", "XEM_CHI_THE_QUYEN_TRE_HOAC_NGANG_VAI", K, K, K, K],
  LAT_CAT_VO_CHONG: ["XEM", K, K, K, K, K],
  KE_HOACH_VIEC_CUA_X: ["XEM_VA_TICK_HO", "XEM_VA_TICK", K, K, K, K],
  KE_HOACH_VIEC_NGUOI_KHAC: ["XEM", K, K, K, K, K],
  CHECKIN: ["NHAP_VA_XEM_TONG", "NHAP_CUA_X", K, K, K, K],
  THONG_KE_AN_DANH: [NA, NA, NA, K, K, "XEM_AN_DANH_TU_20_BAI"],
  HIEU_CHINH_CAU: [NA, NA, NA, NA, K, "XEM_QUYEN_DISC_CONTENT"],
  THU_VIEN_HOAT_DONG: [NA, NA, NA, NA, K, "QUAN_TRI_QUYEN_DISC_ACTIVITIES"],
};

describe("ma trận quyền xem — test TỪNG Ô (doc 18, mục 8)", () => {
  it("[SG-QX-00] bảng kỳ vọng phủ đủ 12 hàng × 6 cột = 72 ô", () => {
    expect(Object.keys(BANG).sort()).toEqual([...MOI_NOI_DUNG].sort());
    expect(MOI_NGUOI_XEM).toHaveLength(6);
    expect(Object.keys(MA_TRAN_QUYEN)).toHaveLength(12);
  });

  for (const noiDung of MOI_NOI_DUNG) {
    MOI_NGUOI_XEM.forEach((nguoi: NguoiXem, cot) => {
      it(`[SG-QX-ô] ${noiDung} × ${nguoi} ⇒ ${BANG[noiDung][cot]}`, () => {
        expect(quyenXem(nguoi, noiDung)).toBe(BANG[noiDung][cot]);
      });
    });
  }

  it("[SG-QX-01] ĐỐI CHỨNG DƯƠNG: chủ sổ ĐỌC được mọi nội dung có dữ liệu người dùng", () => {
    for (const nd of MOI_NOI_DUNG.filter((x) => !["THONG_KE_AN_DANH", "HIEU_CHINH_CAU", "THU_VIEN_HOAT_DONG"].includes(x))) {
      expect(coQuyenDoc("CHU_SO", nd)).toBe(true);
    }
  });

  it("[SG-QX-02] giáo viên · Sale/QLCS · phụ huynh khác KHÔNG đọc được bất kỳ nội dung nào của sổ", () => {
    const co = MOI_NOI_DUNG.filter((x) => !["THONG_KE_AN_DANH", "HIEU_CHINH_CAU", "THU_VIEN_HOAT_DONG"].includes(x));
    for (const nguoi of ["GIAO_VIEN", "SALE_QLCS", "PH_KHAC"] as const) {
      for (const nd of co) expect(coQuyenDoc(nguoi, nd)).toBe(false);
    }
  });

  it("[SG-QX-03] admin hệ thống: KHÔNG có đường đọc nội dung DISC của gia đình, chỉ phần không chứa dữ liệu người dùng", () => {
    const duLieuNguoiDung = MOI_NOI_DUNG.filter((x) => !["THONG_KE_AN_DANH", "HIEU_CHINH_CAU", "THU_VIEN_HOAT_DONG"].includes(x));
    for (const nd of duLieuNguoiDung) expect(coQuyenDoc("ADMIN_HE_THONG", nd)).toBe(false);
    expect(coQuyenDoc("ADMIN_HE_THONG", "THONG_KE_AN_DANH")).toBe(true);
  });

  it("[SG-QX-04] chế độ trẻ em: chỉ lát cắt bé là người ĐỌC (trẻ→người lớn, ngang vai); người lớn nhìn trẻ thì không", () => {
    expect(cheDoTreEmDocDuocLatCat("tre-voi-nguoi-lon")).toBe(true);
    expect(cheDoTreEmDocDuocLatCat("ngang-vai")).toBe(true);
    expect(cheDoTreEmDocDuocLatCat("nguoi-lon-voi-tre")).toBe(false);
  });

  it("[SG-QX-05] chủ sổ = ownerUserId khớp userId TỪ PHIÊN; id lạ ≡ sổ người khác ≡ không đăng nhập (chống IDOR)", () => {
    expect(chuSoCuaGiaDinh({ ownerUserId: "u1" }, "u1")).toBe(true);
    expect(chuSoCuaGiaDinh({ ownerUserId: "u1" }, "u2")).toBe(false);
    expect(chuSoCuaGiaDinh(null, "u1")).toBe(false);
    expect(chuSoCuaGiaDinh({ ownerUserId: "u1" }, null)).toBe(false);
    expect(chuSoCuaGiaDinh({ ownerUserId: "u1" }, "")).toBe(false);
    expect(chuSoCuaGiaDinh({ ownerUserId: "" }, "")).toBe(false);
  });
});
