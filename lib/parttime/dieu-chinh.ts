// lib/parttime/dieu-chinh.ts — P5c · ĐỀ XUẤT điều chỉnh tiền từ BẰNG CHỨNG (đi muộn · về sớm · thiếu nhận xét). THUẦN.
//
// TÁCH BẠCH: WorkUnit là SỰ THẬT ("đã dạy 1 tiết") — điều chỉnh KHÔNG BAO GIỜ sửa quantity, không sửa StaffTimeLog, không xoá
// đơn vị. Một khoản điều chỉnh chỉ là ĐỀ XUẤT cho tới khi QLCS xác nhận (khấu trừ lương là việc pháp lý — HR chịu trách nhiệm
// lời văn). Không có đường nào trừ tiền thẳng từ lượt chấm công thô.
//
// Bảng dưới là BẢN NHÁP do BLĐ gửi (CHƯA ký, KHÔNG nằm trong tham số SR.QD.238 — không sửa dòng chính sách đã có dữ liệu).
// Chỗ nào lời BLĐ mơ hồ / chủ dự án chưa trả lời thì KHÔNG có số tiền: mục đó thành "chờ quyết định chính sách", phải được giải
// quyết trước khi chốt kỳ (`chanChotKy`). Đặc biệt KHÔNG đoán khung giữa của đi muộn (lời gốc "15-10 phút").
import type { WorkRole } from "@prisma/client";
import type { TrangThaiNhanXet } from "./nhan-xet-han";

export type LoaiDieuChinh = "LATE_ARRIVAL" | "EARLY_LEAVE" | "MISSING_SESSION_COMMENT" | "ABANDONED_WORK";

/** DE_XUAT = có số tiền, tạo dòng PROPOSED chờ QLCS · CHO_CHINH_SACH = luật chưa chốt, không số · NGOAI_LE_NGHIEM_TRONG = "bỏ ca". */
export type TrangThaiMuc = "DE_XUAT" | "CHO_CHINH_SACH" | "NGOAI_LE_NGHIEM_TRONG";

export type MucDieuChinh = {
  loai: LoaiDieuChinh;
  /** Mã luật ghi vào dòng điều chỉnh — truy được về đúng ô của bảng nháp. */
  maLuat: string;
  soTien: number | null; // VND, âm = trừ
  trangThai: TrangThaiMuc;
  /** Câu hỏi chủ dự án đang chặn mục này (null khi đã có luật nháp). */
  cauHoi: string | null;
  moTa: string;
};

/** BẢN NHÁP BLĐ (chưa ký). Đổi số ⇒ sửa ĐÚNG chỗ này; khung chưa chốt để `soTien: null`. */
export const BANG_NHAP_BLD = {
  nguon: "Tin nhắn BLĐ gửi chủ dự án — bản nháp, chưa ký, chưa vào SR.QD.238",
  diMuon: [
    { maLuat: "LATE_0_15", tuPhutLonHon: 0, denPhut: 15, soTien: -10_000, cauHoi: null },
    { maLuat: "LATE_MIDDLE_UNRESOLVED", tuPhutLonHon: 15, denPhut: 30, soTien: null, cauHoi: "Q10" },
    { maLuat: "LATE_OVER_30_ABANDON", tuPhutLonHon: 30, denPhut: null, soTien: null, cauHoi: "Q11" },
  ],
  /** Lời BLĐ: -10.000đ — nhưng ngưỡng phút chưa có (Q13) ⇒ chưa đề xuất số tiền. */
  veSom: { maLuat: "EARLY_LEAVE_THRESHOLD_UNRESOLVED", soTienNhap: -10_000, cauHoi: "Q13" },
  /** Lời BLĐ: thiếu nhận xét -30.000đ — CHỈ GV đứng chính (Q14: chưa mở rộng sang trợ giảng). */
  thieuNhanXet: { maLuat: "MISSING_COMMENT_MAIN", soTien: -30_000 },
  /** "Bỏ ca" khi muộn > 30': mức phạt BLĐ nêu — chưa áp (Q11: có mất luôn tiền tiết không, phạt cộng thêm không). */
  boCaNhap: -200_000,
} as const;

export type DauVaoDieuChinh = {
  role: WorkRole;
  /** P4: số phút muộn THÔ so với giờ phải có mặt (bắt đầu − 10'), và có vượt dung sai không. */
  treVaoPhut: number | null;
  diMuon: boolean;
  raSomPhut: number | null;
  raSom: boolean;
  /** null = không xét nhận xét (trợ giảng / nguồn không có phiếu). */
  nhanXet: TrangThaiNhanXet | null;
};

const dong = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("vi-VN")}đ`;

export function deXuatDieuChinh(v: DauVaoDieuChinh): MucDieuChinh[] {
  const ra: MucDieuChinh[] = [];
  const laMain = v.role === "MAIN_TEACHER";

  if (v.diMuon && v.treVaoPhut != null && v.treVaoPhut > 0) {
    const m = v.treVaoPhut;
    const khung = BANG_NHAP_BLD.diMuon.find((k) => m > k.tuPhutLonHon && (k.denPhut == null || m <= k.denPhut))!;
    if (khung.maLuat === "LATE_OVER_30_ABANDON") {
      ra.push({ loai: "ABANDONED_WORK", maLuat: khung.maLuat, soTien: null, trangThai: "NGOAI_LE_NGHIEM_TRONG", cauHoi: "Q11", moTa: `Muộn ${m}' (> 30') — ứng viên "bỏ ca": QLCS xem tay; mức ${dong(BANG_NHAP_BLD.boCaNhap)} chưa áp (Q11).` });
    } else if (!laMain) {
      ra.push({ loai: "LATE_ARRIVAL", maLuat: khung.maLuat, soTien: null, trangThai: "CHO_CHINH_SACH", cauHoi: "Q12", moTa: `Trợ giảng muộn ${m}' — luật đi muộn có áp cho trợ giảng như đứng chính không (Q12).` });
    } else if (khung.soTien == null) {
      ra.push({ loai: "LATE_ARRIVAL", maLuat: khung.maLuat, soTien: null, trangThai: "CHO_CHINH_SACH", cauHoi: khung.cauHoi, moTa: `Muộn ${m}' — khung 15–30' chưa chốt mức (UNRESOLVED_LATE_BRACKET, Q10).` });
    } else {
      ra.push({ loai: "LATE_ARRIVAL", maLuat: khung.maLuat, soTien: khung.soTien, trangThai: "DE_XUAT", cauHoi: null, moTa: `Muộn ${m}' (≤ 15').` });
    }
  }

  if (v.raSom && v.raSomPhut != null && v.raSomPhut > 0) {
    ra.push({ loai: "EARLY_LEAVE", maLuat: BANG_NHAP_BLD.veSom.maLuat, soTien: null, trangThai: "CHO_CHINH_SACH", cauHoi: "Q13", moTa: `Về sớm ${v.raSomPhut}' — chưa có ngưỡng phút (Q13); mức nháp ${dong(BANG_NHAP_BLD.veSom.soTienNhap)} chưa áp.` });
  }

  if (laMain && v.nhanXet === "MISSING") {
    ra.push({ loai: "MISSING_SESSION_COMMENT", maLuat: BANG_NHAP_BLD.thieuNhanXet.maLuat, soTien: BANG_NHAP_BLD.thieuNhanXet.soTien, trangThai: "DE_XUAT", cauHoi: null, moTa: "Quá 10:00 hôm sau chưa hoàn thành nhận xét buổi." });
  } else if (laMain && v.nhanXet === "LATE") {
    ra.push({ loai: "MISSING_SESSION_COMMENT", maLuat: "COMMENT_LATE_UNRESOLVED", soTien: null, trangThai: "CHO_CHINH_SACH", cauHoi: "Q15", moTa: "Nhận xét hoàn thành SAU 10:00 hôm sau — nộp trễ có tính là thiếu nhận xét (-30.000đ) không (Q15)." });
  } else if (laMain && v.nhanXet === "CHUA_DIEM_DANH") {
    ra.push({ loai: "MISSING_SESSION_COMMENT", maLuat: "COMMENT_NO_ATTENDANCE", soTien: null, trangThai: "CHO_CHINH_SACH", cauHoi: null, moTa: "Buổi quá hạn mà chưa điểm danh — không xác định được học viên phải nhận xét; QLCS xem tay." });
  }
  return ra;
}

/** Mục chưa giải quyết — phải trống trước khi chốt kỳ lương (nơi chốt kỳ P5d gọi). */
export function chanChotKy(ds: readonly MucDieuChinh[]): MucDieuChinh[] {
  return ds.filter((m) => m.trangThai !== "DE_XUAT");
}

// ─── Cổng quyết định của QLCS ───────────────────────────────────────────────────────────────

export type QuyetDieuChinh = "CONFIRMED" | "REJECTED" | "CANCELLED";

export function kiemQuyetDieuChinh(p: { trangThai: "PROPOSED" | "CONFIRMED" | "REJECTED" | "CANCELLED"; quyet: QuyetDieuChinh; lyDo: string | null; nguoiQuyetId: string; nguoiBiTruId: string; kyKhoa: boolean }): string | null {
  if (p.nguoiQuyetId === p.nguoiBiTruId) return "Không tự quyết điều chỉnh tiền của chính mình.";
  if (p.kyKhoa) return "Kỳ công của tháng này đã khoá.";
  const coLyDo = (p.lyDo ?? "").trim().length >= 5;
  if (p.quyet === "CANCELLED") {
    if (p.trangThai !== "CONFIRMED" && p.trangThai !== "PROPOSED") return "Chỉ huỷ được khoản đang đề xuất hoặc đã xác nhận.";
    return coLyDo ? null : "Ghi lý do huỷ (tối thiểu 5 ký tự).";
  }
  if (p.trangThai !== "PROPOSED") return "Khoản này không còn ở trạng thái đề xuất.";
  if (p.quyet === "REJECTED" && !coLyDo) return "Ghi lý do không áp (tối thiểu 5 ký tự).";
  return null;
}
