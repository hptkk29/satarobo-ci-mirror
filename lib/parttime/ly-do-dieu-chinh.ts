// lib/parttime/ly-do-dieu-chinh.ts — "VÌ SAO phân công này khác kế hoạch ban đầu" (PR7 lưới phân công GV, 25/10/2026). THUẦN.
//
// Chỉ ĐỌC từ những nơi đã ghi lý do thật — KHÔNG suy lý do từ việc PLAN khác ACTUAL, KHÔNG cho Excel ghi lý do tự do:
//   · SUA_BUOI_DA_QUA — nhật ký "Sửa buổi đã qua" (QLCS sửa trực tiếp, bắt buộc lý do, có trước/sau);
//   · DON_TU          — đơn của giáo viên (dạy thay / đổi ca / nghỉ buổi…) đã được duyệt — phân công mang `sourceWorkRequestId`;
//   · GIU_TRUC / HUY_TRUC — nhật ký dòng trực (PR6 giữ trực khi có học bù; huỷ trực kèm lý do);
//   · CHUYEN_DOI      — phân công nhập lúc chuyển đổi (CUTOVER): KHÔNG có dữ liệu lịch sử ⇒ nói thẳng như vậy, không tự viết lý do.
export type NguonDieuChinh = "SUA_BUOI_DA_QUA" | "DON_TU" | "GIU_TRUC" | "HUY_TRUC" | "CHUYEN_DOI";

export type DieuChinh = {
  nguon: NguonDieuChinh;
  lyDo: string | null;
  nguoiYeuCau: string | null;
  nguoiDuyet: string | null;
  /** ISO — lúc điều chỉnh có hiệu lực (sửa / duyệt / ghi nhật ký). */
  luc: string | null;
  truocSau: string | null;
  /** id bản ghi nguồn (audit / đơn từ / phân công) để tra ngược. */
  maThamChieu: string;
};

export const NHAN_NGUON_DIEU_CHINH: Record<NguonDieuChinh, string> = {
  SUA_BUOI_DA_QUA: "Sửa buổi đã qua",
  DON_TU: "Đơn từ đã duyệt",
  GIU_TRUC: "Giữ trực khi có học bù",
  HUY_TRUC: "Huỷ trực",
  CHUYEN_DOI: "Nhập lúc chuyển đổi",
};

export const KHONG_CO_LICH_SU = "Không có dữ liệu lịch sử";

const NHAN_TRUONG: Record<string, string> = { MAIN_TEACHER: "Đứng chính", TEACHING_ASSISTANT: "Trợ giảng", THUC_DAY: "Người thực dạy" };

export function tuSuaBuoi(d: { id: string; luc: string; nguoiSua: string; truong: string; tu: string | null; den: string | null; lyDo: string | null }): DieuChinh {
  return {
    nguon: "SUA_BUOI_DA_QUA",
    lyDo: d.lyDo,
    nguoiYeuCau: d.nguoiSua,
    // QLCS sửa trực tiếp trong quyền của mình — không có bước duyệt riêng; nói rõ thay vì để trống (trống đọc như "thiếu dữ liệu").
    nguoiDuyet: "Sửa trực tiếp (không qua duyệt)",
    luc: d.luc,
    truocSau: `${NHAN_TRUONG[d.truong] ?? d.truong}: ${d.tu ?? "—"} → ${d.den ?? "—"}`,
    maThamChieu: d.id,
  };
}

export function tuDonTu(w: {
  id: string;
  loai: string;
  lyDo: string;
  nguoiGui: string | null;
  nguoiDuyet: string | null;
  lucDuyet: string | null;
  trangThai: string;
}): DieuChinh {
  return {
    nguon: "DON_TU",
    lyDo: w.lyDo,
    nguoiYeuCau: w.nguoiGui,
    nguoiDuyet: w.nguoiDuyet,
    luc: w.lucDuyet,
    truocSau: w.trangThai === "APPROVED" ? w.loai : `${w.loai} (đơn ${w.trangThai})`,
    maThamChieu: w.id,
  };
}

export function tuNhatKyTruc(a: { id: string; action: string; reason: string | null; actorName: string | null; createdAt: string }): DieuChinh | null {
  if (a.action === "PT_DUTY_KEPT_WITH_MAKEUP") {
    return { nguon: "GIU_TRUC", lyDo: a.reason, nguoiYeuCau: a.actorName, nguoiDuyet: a.actorName, luc: a.createdAt, truocSau: "T + học bù → TD", maThamChieu: a.id };
  }
  if (a.action === "PT_DUTY_CANCELLED") {
    return { nguon: "HUY_TRUC", lyDo: a.reason, nguoiYeuCau: a.actorName, nguoiDuyet: a.actorName, luc: a.createdAt, truocSau: "Trực → không trực", maThamChieu: a.id };
  }
  return null;
}

export function tuChuyenDoi(assignmentId: string): DieuChinh {
  return { nguon: "CHUYEN_DOI", lyDo: null, nguoiYeuCau: null, nguoiDuyet: null, luc: null, truocSau: null, maThamChieu: assignmentId };
}

/** Một câu cho ô "Lý do điều chỉnh" — lý do thật, hoặc nói thẳng là không có dữ liệu. Rỗng = không có điều chỉnh nào. */
export function lyDoHienThi(d: DieuChinh): string {
  if (d.nguon === "CHUYEN_DOI") return KHONG_CO_LICH_SU;
  return d.lyDo?.trim() || `${NHAN_NGUON_DIEU_CHINH[d.nguon]} — không ghi lý do`;
}

export function tomTatDieuChinh(ds: readonly DieuChinh[]): string {
  return ds.map((d) => `${NHAN_NGUON_DIEU_CHINH[d.nguon]}: ${lyDoHienThi(d)}`).join(" | ");
}
