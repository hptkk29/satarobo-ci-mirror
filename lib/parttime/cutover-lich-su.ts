// lib/parttime/cutover-lich-su.ts — ĐỐI SOÁT LỊCH SỬ cho cutover: buổi ĐÃ QUA trong phạm vi (THUẦN, không DB, không đồng hồ).
//
// Chủ dự án chốt 20/10/2026 (phạm vi CS2 bắt đầu 15/10/2026, công cụ chạy 20/10):
//   · Buổi đã qua KHÔNG được mời nhận lớp hồi tố, KHÔNG sinh xác nhận nhận lớp / xác nhận thực hiện / lượt quét / đơn vị công /
//     tiền. Chúng chỉ đi vào BÁO CÁO ĐỐI SOÁT, dựa trên bằng chứng ĐANG CÓ: người thực dạy, điểm danh, nhận xét.
//   · Thiếu bằng chứng ⇒ NGOẠI LỆ cho QLCS xem — không đoán.
//   · Buổi đã huỷ: thống kê riêng, loại khỏi phân công / tính công.
//   · Buổi đã qua mà chưa chốt (còn SCHEDULED / IN_PROGRESS): danh sách QLCS cần XÁC MINH — không tự kết luận đã dạy hay chưa.
// Vì thế bộ phân loại này KHÔNG có trường "sẽ nhập": đường nhập chỉ đọc kết quả của `phanLoaiCutover` cho buổi từ hôm nay
// (`chonBuoiNhap` trong `cutover.ts`).
import type { PhanCongCo } from "./cutover";

export type LoaiLichSu = "DA_DAY" | "DA_HUY" | "CHUA_CHOT";
/** Lý do QLCS phải xem — buổi có ít nhất một lý do nằm trong danh sách ngoại lệ. */
export type NgoaiLeLichSu =
  | "CHUA_CHOT_BUOI"
  | "THIEU_NGUOI_THUC_DAY"
  | "THIEU_DIEM_DANH"
  | "THIEU_NHAN_XET"
  | "PHAN_CONG_SONG_TREN_BUOI_HUY";
/** Ghi chú KHÔNG phải ngoại lệ — để người đọc đối chiếu. */
export type GhiChuLichSu = "THUC_DAY_KHAC_GV_LOP" | "CO_PHAN_CONG_TU_TRUOC";

export type BuoiLichSu = {
  sessionId: string;
  centerCode: string | null;
  classCode: string | null;
  /** "YYYY-MM-DD" giờ VN. */
  ngay: string;
  gio: string | null;
  /** `ClassSession.status`. */
  trangThai: string;
  gvLopId: string | null;
  dayThayId: string | null;
  thucDayId: string | null;
  soDiemDanh: number;
  soNhanXet: number;
  phanCong: readonly PhanCongCo[];
};

export type KetQuaLichSu = {
  sessionId: string;
  centerCode: string | null;
  classCode: string | null;
  ngay: string;
  gio: string | null;
  trangThai: string;
  loai: LoaiLichSu;
  /** Người đứng lớp theo bằng chứng: thực dạy ?? dạy thay ?? GV lớp (cùng thứ tự `giaoVienDuocQuyCong`). Null khi chưa chốt. */
  nguoiDungLop: string | null;
  bangChung: { thucDayId: string | null; soDiemDanh: number; soNhanXet: number };
  ngoaiLe: NgoaiLeLichSu[];
  ghiChu: GhiChuLichSu[];
  /** Phân công Parttime ĐANG CÓ trên buổi (giữ nguyên, công cụ không đụng). */
  phanCongCo: { role: PhanCongCo["role"]; userId: string; status: string }[];
};

const SONG = new Set(["PROPOSED", "WAITING_ACCEPTANCE", "ACCEPTED", "ACTIVE", "COMPLETED"]);

export function phanLoaiLichSu(b: BuoiLichSu): KetQuaLichSu {
  const ngoaiLe: NgoaiLeLichSu[] = [];
  const ghiChu: GhiChuLichSu[] = [];
  const song = b.phanCong.filter((p) => SONG.has(p.status));
  let loai: LoaiLichSu;
  let nguoiDungLop: string | null = null;
  if (b.trangThai === "CANCELLED") {
    loai = "DA_HUY";
    if (song.length > 0) ngoaiLe.push("PHAN_CONG_SONG_TREN_BUOI_HUY");
  } else if (b.trangThai === "COMPLETED") {
    loai = "DA_DAY";
    nguoiDungLop = b.thucDayId ?? b.dayThayId ?? b.gvLopId;
    if (!b.thucDayId) ngoaiLe.push("THIEU_NGUOI_THUC_DAY");
    if (b.soDiemDanh === 0) ngoaiLe.push("THIEU_DIEM_DANH");
    if (b.soNhanXet === 0) ngoaiLe.push("THIEU_NHAN_XET");
    if (b.thucDayId && b.thucDayId !== (b.dayThayId ?? b.gvLopId)) ghiChu.push("THUC_DAY_KHAC_GV_LOP");
  } else {
    loai = "CHUA_CHOT";
    ngoaiLe.push("CHUA_CHOT_BUOI");
  }
  if (song.length > 0 && loai !== "DA_HUY") ghiChu.push("CO_PHAN_CONG_TU_TRUOC");
  return {
    sessionId: b.sessionId,
    centerCode: b.centerCode,
    classCode: b.classCode,
    ngay: b.ngay,
    gio: b.gio,
    trangThai: b.trangThai,
    loai,
    nguoiDungLop,
    bangChung: { thucDayId: b.thucDayId, soDiemDanh: b.soDiemDanh, soNhanXet: b.soNhanXet },
    ngoaiLe,
    ghiChu,
    phanCongCo: b.phanCong.map((p) => ({ role: p.role, userId: p.userId, status: p.status })),
  };
}

export type TongLichSu = {
  soBuoi: number;
  daDay: number;
  daDayDuBangChung: number;
  daHuy: number;
  chuaChot: number;
  /** Buổi QLCS phải xem (≥1 ngoại lệ). */
  canQlcsXem: number;
  ngoaiLe: Record<string, number>;
};

export function tongHopLichSu(ds: readonly KetQuaLichSu[]): TongLichSu {
  const ngoaiLe: Record<string, number> = {};
  for (const k of ds) for (const n of k.ngoaiLe) ngoaiLe[n] = (ngoaiLe[n] ?? 0) + 1;
  const daDay = ds.filter((k) => k.loai === "DA_DAY");
  return {
    soBuoi: ds.length,
    daDay: daDay.length,
    daDayDuBangChung: daDay.filter((k) => k.ngoaiLe.length === 0).length,
    daHuy: ds.filter((k) => k.loai === "DA_HUY").length,
    chuaChot: ds.filter((k) => k.loai === "CHUA_CHOT").length,
    canQlcsXem: ds.filter((k) => k.ngoaiLe.length > 0).length,
    ngoaiLe,
  };
}

// ── Đối chiếu phân công ĐÃ CÓ trên môi trường (bảo toàn — công cụ không sửa / huỷ dòng nào) ──────────────────────────────────

export type PhanCongHienCo = { sourceType: string; sourceId: string; role: string; status: string; userId: string; ngay: string };
/** Vị trí của buổi lớp chính khoá trong phạm vi: TUONG_LAI (đi đường nhập) · LICH_SU (đối soát) · không có ⇒ NGOAI_PHAM_VI. */
export type ViTriBuoi = "TUONG_LAI" | "LICH_SU";

export type DoiChieuPhanCong = {
  tong: number;
  /** Lớp chính khoá theo vị trí buổi, rồi theo vai. */
  lopChinhKhoa: Record<"TUONG_LAI" | "LICH_SU" | "NGOAI_PHAM_VI", Record<string, number>>;
  trial: Record<string, number>;
  hocBu: Record<string, number>;
  khac: Record<string, number>;
  theoTrangThai: Record<string, number>;
};

/**
 * Đếm phân công đang có theo NGUỒN — mỗi nguồn một ô riêng. Chỉ phần "lớp chính khoá · TUONG_LAI" giao với phạm vi nhập, và nó đã
 * nằm trong `phanCong` của từng buổi (công cụ không nhập lại vai đã có). KHÔNG lấy tổng để trừ vào phạm vi cutover.
 */
export function doiChieuPhanCongCo(ds: readonly PhanCongHienCo[], viTri: ReadonlyMap<string, ViTriBuoi>): DoiChieuPhanCong {
  const ra: DoiChieuPhanCong = { tong: ds.length, lopChinhKhoa: { TUONG_LAI: {}, LICH_SU: {}, NGOAI_PHAM_VI: {} }, trial: {}, hocBu: {}, khac: {}, theoTrangThai: {} };
  const cong = (m: Record<string, number>, k: string) => {
    m[k] = (m[k] ?? 0) + 1;
  };
  for (const p of ds) {
    cong(ra.theoTrangThai, p.status);
    if (p.sourceType === "CLASS_SESSION") cong(ra.lopChinhKhoa[viTri.get(p.sourceId) ?? "NGOAI_PHAM_VI"], p.role);
    else if (p.sourceType === "TRIAL_SESSION") cong(ra.trial, p.role);
    else if (p.sourceType === "MAKEUP_CASE") cong(ra.hocBu, p.role);
    else cong(ra.khac, `${p.sourceType}:${p.role}`);
  }
  return ra;
}
