/**
 * MA TRẬN QUYỀN XEM SỔ GIA ĐÌNH DISC (doc 18, mục 8) — MỘT bảng, mọi nơi hỏi hàm `quyenXem`.
 *
 * Vai trong cổng phụ huynh:
 *   · CHU_SO          = tài khoản PARENT sở hữu sổ (DiscGiaDinh.ownerUserId = userId từ PHIÊN).
 *   · CHE_DO_TRE_EM   = màn khoá trên máy chủ sổ khi một bé đang làm/xem bài (thoát cần PIN 4 số của chủ sổ).
 *   · PH_KHAC         = phụ huynh khác cùng học viên (v1: KHÔNG tự thấy sổ của người kia).
 *   · GIAO_VIEN · SALE_QLCS = nhân viên trung tâm: KHÔNG có đường đọc nội dung DISC.
 *   · ADMIN_HE_THONG  = chỉ phần KHÔNG chứa dữ liệu người dùng: thống kê ẩn danh (≥ 20 bài/nhóm, không tên),
 *                       hiệu chỉnh câu (disc:content), thư viện hoạt động (disc:activities).
 *
 * Mọi Server Action: auth() → vai PARENT → chủ sổ của đúng familyId (`chuSoCuaGiaDinh`) → mới tới ghi/đọc.
 * Ma trận này là NGUỒN SỰ THẬT: code lệch ma trận là bug (test từng ô ở quyen.test.ts, có đối chứng dương).
 */
/** Thế quyền của một lát cắt (khớp kiểu cùng tên của engine; không import engine để file này an toàn cho client). */
export type TheQuyen = "nguoi-lon-voi-tre" | "tre-voi-nguoi-lon" | "ngang-vai";

export type NguoiXem = "CHU_SO" | "CHE_DO_TRE_EM" | "PH_KHAC" | "GIAO_VIEN" | "SALE_QLCS" | "ADMIN_HE_THONG";

export type NoiDungDisc =
  | "DANH_SACH_THANH_VIEN"
  | "BAI_LAM_MOI_THANH_VIEN"
  | "BAO_CAO_CA_NHAN_NGUOI_LON"
  | "LOI_KHUYEN_VE_TRE"
  | "LAT_CAT_CO_X"
  | "LAT_CAT_VO_CHONG"
  | "KE_HOACH_VIEC_CUA_X"
  | "KE_HOACH_VIEC_NGUOI_KHAC"
  | "CHECKIN"
  | "THONG_KE_AN_DANH"
  | "HIEU_CHINH_CAU"
  | "THU_VIEN_HOAT_DONG";

export type Quyen =
  | "KHONG"
  /** Ô «—» của ma trận: vai này không liên quan tới nội dung đó. */
  | "KHONG_AP_DUNG"
  | "XEM"
  | "XEM_VA_SUA"
  | "XEM_VA_TICK_HO"
  | "XEM_VA_TICK"
  | "NHAP_VA_XEM_TONG"
  | "NHAP_CUA_X"
  /** Chế độ trẻ em: chỉ bài CỦA X, bản trẻ em. */
  | "CHI_BAI_CUA_X_BAN_TRE_EM"
  /** Chế độ trẻ em: chỉ lát cắt thế quyền `tre-voi-nguoi-lon` / `ngang-vai`. */
  | "XEM_CHI_THE_QUYEN_TRE_HOAC_NGANG_VAI"
  | "XEM_AN_DANH_TU_20_BAI"
  | "XEM_QUYEN_DISC_CONTENT"
  | "QUAN_TRI_QUYEN_DISC_ACTIVITIES";

export const MOI_NGUOI_XEM: readonly NguoiXem[] = ["CHU_SO", "CHE_DO_TRE_EM", "PH_KHAC", "GIAO_VIEN", "SALE_QLCS", "ADMIN_HE_THONG"];
export const MOI_NOI_DUNG: readonly NoiDungDisc[] = [
  "DANH_SACH_THANH_VIEN",
  "BAI_LAM_MOI_THANH_VIEN",
  "BAO_CAO_CA_NHAN_NGUOI_LON",
  "LOI_KHUYEN_VE_TRE",
  "LAT_CAT_CO_X",
  "LAT_CAT_VO_CHONG",
  "KE_HOACH_VIEC_CUA_X",
  "KE_HOACH_VIEC_NGUOI_KHAC",
  "CHECKIN",
  "THONG_KE_AN_DANH",
  "HIEU_CHINH_CAU",
  "THU_VIEN_HOAT_DONG",
];

type Hang = Readonly<Record<NguoiXem, Quyen>>;

/** Hàng không cho ai ngoài chủ sổ. */
const chiChuSo = (chu: Quyen, treEm: Quyen = "KHONG"): Hang => ({
  CHU_SO: chu,
  CHE_DO_TRE_EM: treEm,
  PH_KHAC: "KHONG",
  GIAO_VIEN: "KHONG",
  SALE_QLCS: "KHONG",
  ADMIN_HE_THONG: "KHONG",
});

export const MA_TRAN_QUYEN: Readonly<Record<NoiDungDisc, Hang>> = {
  DANH_SACH_THANH_VIEN: chiChuSo("XEM_VA_SUA"),
  BAI_LAM_MOI_THANH_VIEN: chiChuSo("XEM", "CHI_BAI_CUA_X_BAN_TRE_EM"),
  BAO_CAO_CA_NHAN_NGUOI_LON: chiChuSo("XEM"),
  LOI_KHUYEN_VE_TRE: chiChuSo("XEM"),
  LAT_CAT_CO_X: chiChuSo("XEM", "XEM_CHI_THE_QUYEN_TRE_HOAC_NGANG_VAI"),
  LAT_CAT_VO_CHONG: chiChuSo("XEM"),
  KE_HOACH_VIEC_CUA_X: chiChuSo("XEM_VA_TICK_HO", "XEM_VA_TICK"),
  KE_HOACH_VIEC_NGUOI_KHAC: chiChuSo("XEM"),
  CHECKIN: chiChuSo("NHAP_VA_XEM_TONG", "NHAP_CUA_X"),
  THONG_KE_AN_DANH: {
    CHU_SO: "KHONG_AP_DUNG",
    CHE_DO_TRE_EM: "KHONG_AP_DUNG",
    PH_KHAC: "KHONG_AP_DUNG",
    GIAO_VIEN: "KHONG",
    SALE_QLCS: "KHONG",
    ADMIN_HE_THONG: "XEM_AN_DANH_TU_20_BAI",
  },
  HIEU_CHINH_CAU: {
    CHU_SO: "KHONG_AP_DUNG",
    CHE_DO_TRE_EM: "KHONG_AP_DUNG",
    PH_KHAC: "KHONG_AP_DUNG",
    GIAO_VIEN: "KHONG_AP_DUNG",
    SALE_QLCS: "KHONG",
    ADMIN_HE_THONG: "XEM_QUYEN_DISC_CONTENT",
  },
  THU_VIEN_HOAT_DONG: {
    CHU_SO: "KHONG_AP_DUNG",
    CHE_DO_TRE_EM: "KHONG_AP_DUNG",
    PH_KHAC: "KHONG_AP_DUNG",
    GIAO_VIEN: "KHONG_AP_DUNG",
    SALE_QLCS: "KHONG",
    ADMIN_HE_THONG: "QUAN_TRI_QUYEN_DISC_ACTIVITIES",
  },
};

export function quyenXem(nguoi: NguoiXem, noiDung: NoiDungDisc): Quyen {
  return MA_TRAN_QUYEN[noiDung][nguoi];
}

/** Có đọc được không (bất kỳ mức nào khác KHONG / KHONG_AP_DUNG). */
export function coQuyenDoc(nguoi: NguoiXem, noiDung: NoiDungDisc): boolean {
  const q = quyenXem(nguoi, noiDung);
  return q !== "KHONG" && q !== "KHONG_AP_DUNG";
}

/**
 * Chế độ trẻ em đọc một lát cắt có bé X: chỉ khi bé là người ĐỌC (bản X đọc) và thế quyền là trẻ→người lớn hoặc ngang vai.
 * Lát cắt người lớn nhìn trẻ (`nguoi-lon-voi-tre`) viết cho người lớn — bé không đọc.
 */
export function cheDoTreEmDocDuocLatCat(theQuyen: TheQuyen): boolean {
  return theQuyen === "tre-voi-nguoi-lon" || theQuyen === "ngang-vai";
}

/**
 * Chủ sổ của đúng gia đình: so `ownerUserId` của sổ với `userId` TỪ PHIÊN. Mọi thứ khác (URL, form, vai) đều không đủ.
 * `soGiaDinh` null (không tồn tại) ≡ không phải chủ — id lạ và id của người khác trả cùng một kết quả (chống IDOR).
 */
export function chuSoCuaGiaDinh(soGiaDinh: { readonly ownerUserId: string } | null, userIdTuPhien: string | null | undefined): boolean {
  if (!soGiaDinh || !userIdTuPhien) return false;
  return soGiaDinh.ownerUserId === userIdTuPhien;
}
