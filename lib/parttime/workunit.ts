// lib/parttime/workunit.ts — P5a · từ BẰNG CHỨNG P4 ra ỨNG VIÊN đơn vị công việc (WorkUnit), ảnh chụp đơn giá, và luật
// "đơn vị đã xác nhận còn là căn cứ không". THUẦN — không `@/lib/db`, không đồng hồ (nhận `now` / đầu vào).
//
// MỘT hàm xếp loại (`xetUngVien`) cho mọi nơi: màn đối soát, xác nhận lẻ, xác nhận hàng loạt (luật 12b). Ba lớp:
//   TU_DONG  — sạch: QLCS xác nhận được hàng loạt.
//   XEM_TAY  — đã có mặt nhưng có ngoại lệ (muộn / sớm / thiếu ra / cảnh báo thiết bị / học bù vắng mặt): QLCS xem từng
//              dòng, BẮT BUỘC lý do. Muộn > 30' (ứng viên "bỏ ca") nằm ở đây — quyết định thuộc QLCS, KHÔNG tự động.
//   CHAN     — không được tạo đơn vị (P5-07/08, thời lượng không chuẩn — Q1 còn mở, chưa nhận, ...).
// Cộng hai lớp "chưa tới lượt": KHONG_AP_DUNG (LEGACY / trial / buổi huỷ) và CHUA_XONG (buổi chưa chốt / chưa hết giờ).
//
// WorkUnit là SỰ THẬT ("đã dạy 1 tiết"), KHÔNG phải tiền cuối: phạt / trừ là bảng riêng (P5c) và không bao giờ đổi
// `quantity`. Tiết chuẩn = `tiet.chuanPhut` (10' chuẩn bị + 90' dạy = 100'); KHÔNG suy số tiết từ thời lượng (Q1).
import type { WorkRole, WorkUnitType } from "@prisma/client";
import type { BangChungPhanCong } from "./bang-chung-cong";
import { donGiaMain, type ThamSoChinhSach } from "./chinh-sach";
import { BANG_NHAP_BLD } from "./dieu-chinh";

export type LopUngVien = "TU_DONG" | "XEM_TAY" | "CHAN" | "KHONG_AP_DUNG" | "CHUA_XONG";

export type LyDoUngVien =
  // KHONG_AP_DUNG
  | "LEGACY"
  | "TRIAL_TACH_RIENG"
  | "VAI_KHONG_PHAI_DAY"
  | "BUOI_DA_HUY"
  // CHUA_XONG
  | "BUOI_CHUA_CHOT"
  | "CHUA_HET_GIO"
  // CHAN
  | "CHUA_NHAN"
  | "KHONG_BANG_CHUNG"
  | "SAI_NGUOI_DUNG_LOP"
  | "KHONG_RO_NGUOI_DUNG_LOP"
  | "THOI_LUONG_KHONG_CHUAN"
  // XEM_TAY
  | "DI_MUON"
  | "TRE_QUA_30"
  | "RA_SOM"
  | "THIEU_RA"
  | "CANH_BAO_THIET_BI"
  | "HOC_BU_VANG_MAT";

const LOP_CUA: Record<LyDoUngVien, LopUngVien> = {
  LEGACY: "KHONG_AP_DUNG",
  TRIAL_TACH_RIENG: "KHONG_AP_DUNG",
  VAI_KHONG_PHAI_DAY: "KHONG_AP_DUNG",
  BUOI_DA_HUY: "KHONG_AP_DUNG",
  BUOI_CHUA_CHOT: "CHUA_XONG",
  CHUA_HET_GIO: "CHUA_XONG",
  CHUA_NHAN: "CHAN",
  KHONG_BANG_CHUNG: "CHAN",
  SAI_NGUOI_DUNG_LOP: "CHAN",
  KHONG_RO_NGUOI_DUNG_LOP: "CHAN",
  THOI_LUONG_KHONG_CHUAN: "CHAN",
  DI_MUON: "XEM_TAY",
  TRE_QUA_30: "XEM_TAY",
  RA_SOM: "XEM_TAY",
  THIEU_RA: "XEM_TAY",
  CANH_BAO_THIET_BI: "XEM_TAY",
  HOC_BU_VANG_MAT: "XEM_TAY",
};
const THU_TU: LopUngVien[] = ["KHONG_AP_DUNG", "CHUA_XONG", "CHAN", "XEM_TAY"];

/**
 * Ngưỡng "ứng viên bỏ ca" (lời BLĐ: muộn quá 30' coi như bỏ ca). CHỈ đẩy sang xem tay — hậu quả tiền là Q10/Q11. LẤY TỪ bảng nháp
 * điều chỉnh (một nguồn): chốt lại Q10/Q11 mà chỉ sửa một nơi thì xếp loại và tiền không thể lệch nhau.
 */
export const TRE_UNG_VIEN_BO_CA_PHUT: number = BANG_NHAP_BLD.diMuon.find((k) => k.maLuat === "LATE_OVER_30_ABANDON")!.tuPhutLonHon;

export type UngVienWorkUnit = {
  lop: LopUngVien;
  lyDo: LyDoUngVien[];
  loai: WorkUnitType | null;
  /** Thời lượng DẠY của buổi theo ảnh chụp phân công (phút) — null khi LEGACY. */
  thoiLuongDayPhut: number | null;
};

export function loaiDonViCuaVai(role: WorkRole): WorkUnitType | null {
  return role === "MAIN_TEACHER" ? "MAIN_TEACHING" : role === "TEACHING_ASSISTANT" ? "ASSISTANT_TEACHING" : null;
}

/**
 * Xếp một phân công (đã qua P4) vào một lớp ứng viên. `thamSo` = chính sách TẠI NGÀY buổi (null = không bản nào phủ).
 * `hocBuVangMat` = nguồn là học bù có trạng thái NO_SHOW (P4 coi là "đã chạy" để đo có mặt; trả công hay không chưa chốt).
 */
export function xetUngVien(bc: BangChungPhanCong, ctx: { thamSo: ThamSoChinhSach | null; hocBuVangMat: boolean; now: Date }): UngVienWorkUnit {
  const loai = loaiDonViCuaVai(bc.role);
  const ts = ctx.thamSo && ctx.thamSo.loai === "SR_QD_238" ? ctx.thamSo : null;
  const thoiLuongDayPhut =
    ts && bc.requiredFrom && bc.requiredTo ? Math.round((bc.requiredTo.getTime() - bc.requiredFrom.getTime()) / 60_000) - ts.tiet.chuanBiPhut : null;
  const ly: LyDoUngVien[] = [];

  if (!ts || bc.trangThai === "KHONG_AP_DUNG") ly.push("LEGACY");
  if (bc.activity === "TRIAL") ly.push("TRIAL_TACH_RIENG");
  if (!loai) ly.push("VAI_KHONG_PHAI_DAY");
  if (bc.dongDoi.tinhTrangBuoi === "DA_DONG" || bc.trangThai === "BUOI_DA_HUY") ly.push("BUOI_DA_HUY");
  if (!ly.length) {
    if (bc.dongDoi.tinhTrangBuoi !== "DA_CHOT") ly.push("BUOI_CHUA_CHOT");
    if (bc.requiredTo && ctx.now.getTime() < bc.requiredTo.getTime()) ly.push("CHUA_HET_GIO");
  }
  if (!ly.length) {
    if (!bc.daNhan) ly.push("CHUA_NHAN");
    if (bc.coMat === "KHONG") ly.push("KHONG_BANG_CHUNG");
    if (bc.role === "MAIN_TEACHER") {
      if (bc.khopNguoiDay === "LECH") ly.push("SAI_NGUOI_DUNG_LOP");
      else if (bc.khopNguoiDay !== "KHOP") ly.push("KHONG_RO_NGUOI_DUNG_LOP");
    }
    // Q1 còn mở: buổi 60' / 120' quy bao nhiêu tiết chưa chốt ⇒ KHÔNG tạo đơn vị, kể cả xác nhận tay (xác nhận tay mà ghi
    // quantity 1 là âm thầm quyết Q1).
    if (ts && thoiLuongDayPhut !== ts.tiet.dayPhut) ly.push("THOI_LUONG_KHONG_CHUAN");
    if (bc.diMuon) ly.push(bc.treVaoPhut != null && bc.treVaoPhut > TRE_UNG_VIEN_BO_CA_PHUT ? "TRE_QUA_30" : "DI_MUON");
    if (bc.raSom) ly.push("RA_SOM");
    if (bc.coMat === "THIEU_RA") ly.push("THIEU_RA");
    if (bc.canhBaoLuot.length) ly.push("CANH_BAO_THIET_BI");
    if (ctx.hocBuVangMat) ly.push("HOC_BU_VANG_MAT");
  }
  const lop = THU_TU.find((l) => ly.some((x) => LOP_CUA[x] === l)) ?? "TU_DONG";
  // Chỉ giữ lý do của lớp quyết định + lớp xem tay (để màn hình nói đủ vì sao một dòng bị chặn cũng muộn).
  const lyDo = ly.filter((x) => LOP_CUA[x] === lop || (lop === "CHAN" && LOP_CUA[x] === "XEM_TAY"));
  return { lop, lyDo, loai: lop === "KHONG_AP_DUNG" ? null : loai, thoiLuongDayPhut };
}

// ─── Ảnh chụp đơn vị ─────────────────────────────────────────────────────────────────────────

export type AnhChupDonVi = { loai: WorkUnitType; quantity: "1"; standardMinutes: number; rateSnapshot: number; rankSnapshot: number | null };

/** Đơn vị 1 tiết chuẩn + đơn giá tại ngày làm. MAIN theo Rank (rank = `rankTaiNgay`, nơi gọi tính); TA một giá. */
export function anhChupDonVi(loai: WorkUnitType, thamSo: ThamSoChinhSach, rank: number | null): AnhChupDonVi {
  if (thamSo.loai !== "SR_QD_238") throw new Error("Không chụp đơn vị cho ngày LEGACY");
  if (loai === "MAIN_TEACHING") {
    if (rank == null) throw new Error("Tiết đứng chính phải có Rank tại ngày làm");
    return { loai, quantity: "1", standardMinutes: thamSo.tiet.chuanPhut, rateSnapshot: donGiaMain(thamSo, rank), rankSnapshot: rank };
  }
  if (loai === "ASSISTANT_TEACHING") return { loai, quantity: "1", standardMinutes: thamSo.tiet.chuanPhut, rateSnapshot: thamSo.donGia.troGiang, rankSnapshot: null };
  throw new Error(`Đơn vị ${loai} không sinh từ phân công buổi`);
}

// ─── Còn là căn cứ không ─────────────────────────────────────────────────────────────────────

export type DonViDaLuu = { status: "CONFIRMED" | "STALE" | "VOIDED"; assignmentVersion: number | null; evidenceFingerprint: string };
export type HienTaiCuaPhanCong = { assignmentVersion: number; dauVan: string } | null;
export type LyDoCu = "PHAN_CONG_KHONG_CON_SONG" | "PHIEN_BAN_DOI" | "BANG_CHUNG_DOI";

/**
 * MỘT luật cho mọi nơi đọc (đối soát, báo cáo, bảng lương sau này): đơn vị CONFIRMED mà phiên bản / dấu vân P4 hiện tại
 * khác lúc xác nhận ⇒ CŨ, phải xác nhận lại. Kỳ công đã KHOÁ ⇒ giữ nguyên (kỳ khoá là ảnh chụp, không tính lại).
 */
export function lyDoCu(dv: DonViDaLuu, hienTai: HienTaiCuaPhanCong, kyKhoa: boolean): LyDoCu | null {
  if (dv.status !== "CONFIRMED" || kyKhoa) return null;
  if (!hienTai) return "PHAN_CONG_KHONG_CON_SONG";
  if (dv.assignmentVersion !== hienTai.assignmentVersion) return "PHIEN_BAN_DOI";
  if (dv.evidenceFingerprint !== hienTai.dauVan) return "BANG_CHUNG_DOI";
  return null;
}

/** Trạng thái HIỆU LỰC khi đọc (đơn vị đã đánh dấu STALE trong DB hoặc vừa lệch mà chưa đánh dấu đều là CŨ). */
export function trangThaiHieuLuc(dv: DonViDaLuu, hienTai: HienTaiCuaPhanCong, kyKhoa: boolean): "CONFIRMED" | "STALE" | "VOIDED" {
  if (dv.status !== "CONFIRMED") return dv.status;
  return lyDoCu(dv, hienTai, kyKhoa) ? "STALE" : "CONFIRMED";
}

// ─── Cổng xác nhận (thuần — dùng trước phép ghi đầu tiên) ────────────────────────────────────

export type QuyetDinhThucHien = "CONFIRMED" | "REJECTED" | "NEEDS_INFO";

export function kiemXacNhan(p: {
  /** Ứng viên dạy (P5a) hoặc ca trực (P5b, lớp CHO ⇒ "CHUA_XONG") — cổng chỉ đọc lớp + lý do. */
  ungVien: { lop: LopUngVien; lyDo: readonly string[] };
  phienBanHienTai: number;
  dauVanHienTai: string;
  phienBanDaXem: number;
  dauVanDaXem: string;
  quyetDinh: QuyetDinhThucHien;
  lyDo: string | null;
  nguoiXacNhanId: string;
  nguoiLamId: string;
  kyKhoa: boolean;
  hangLoat: boolean;
}): string | null {
  if (p.nguoiXacNhanId === p.nguoiLamId) return "Không tự xác nhận công của chính mình — nhờ quản lý khác.";
  if (p.kyKhoa) return "Kỳ công của tháng này đã khoá — mở lại kỳ trước khi xác nhận.";
  if (p.phienBanDaXem !== p.phienBanHienTai || p.dauVanDaXem !== p.dauVanHienTai) return "Dữ liệu buổi / chấm công vừa thay đổi — tải lại trang rồi xem lại.";
  const u = p.ungVien;
  if (u.lop === "KHONG_AP_DUNG" || u.lop === "CHUA_XONG") return "Phân công này chưa tới lượt xác nhận thực hiện.";
  const coLyDo = (p.lyDo ?? "").trim().length >= 5;
  if (p.quyetDinh !== "CONFIRMED") return coLyDo ? null : "Ghi lý do (tối thiểu 5 ký tự).";
  if (u.lop === "CHAN") return `Không xác nhận được: ${u.lyDo.join(", ")}.`;
  if (p.hangLoat && u.lop !== "TU_DONG") return "Dòng có ngoại lệ — xác nhận từng dòng, kèm lý do.";
  if (u.lop === "XEM_TAY" && !coLyDo) return "Dòng có ngoại lệ — ghi lý do khi xác nhận (tối thiểu 5 ký tự).";
  return null;
}
