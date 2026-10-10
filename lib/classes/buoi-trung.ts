// lib/classes/buoi-trung.ts — THUẦN: phân loại một NHÓM buổi trùng (cùng lớp, cùng thời điểm, đều còn sống) để dọn trước khi
// tạo chỉ mục duy nhất `ClassSession_class_date_active_key` (T03, 07/10/2026).
//
// Luật dọn — chốt theo quyết định 11 của chủ dự án ("không đoán, không bịa lịch sử"):
//   · KHÔNG BAO GIỜ xoá. Buổi dư được chuyển sang CANCELLED (rời phạm vi chỉ mục, giữ nguyên mọi tham chiếu).
//   · Chỉ TỰ SỬA khi có đúng một buổi "mang dữ liệu" (hoặc không buổi nào mang): giữ buổi ấy, huỷ các buổi trống còn lại.
//   · Từ HAI buổi mang dữ liệu trở lên ⇒ XEM TAY: dữ liệu của người không được hệ thống tự chọn bên nào.
//
// "Mang dữ liệu" khớp định nghĩa của checker T01 (TV-23): đã hoàn tất/đang diễn ra (công dạy tính theo trạng thái), hoặc có
// điểm danh, nhận xét, hay bất kỳ bản ghi nào trỏ vào buổi (bài tập, ảnh, đơn học bù…).
export type BuoiTrung = {
  id: string;
  status: string;
  soDiemDanh: number;
  soNhanXet: number;
  /** Tổng mọi bản ghi KHÁC trỏ vào buổi (bài tập, ảnh, đánh giá, đơn của phụ huynh, dòng học bù…). */
  soThamChieu: number;
  taoLuc: Date;
};

export type PhanLoaiNhom =
  | { loai: "TU_SUA"; giu: string; huy: string[]; lyDoGiu: "CO_DU_LIEU" | "TAO_SOM_NHAT" }
  | { loai: "XEM_TAY"; ids: string[]; lyDo: string };

export const mangDuLieu = (b: BuoiTrung): boolean =>
  b.status === "COMPLETED" || b.status === "IN_PROGRESS" || b.soDiemDanh > 0 || b.soNhanXet > 0 || b.soThamChieu > 0;

const somNhat = (xs: readonly BuoiTrung[]) =>
  [...xs].sort((a, b) => a.taoLuc.getTime() - b.taoLuc.getTime() || a.id.localeCompare(b.id))[0]!;

export function phanLoaiNhomTrung(buoi: readonly BuoiTrung[]): PhanLoaiNhom {
  if (buoi.length < 2) throw new Error("phanLoaiNhomTrung: một nhóm trùng phải có từ hai buổi trở lên");
  const co = buoi.filter(mangDuLieu);
  if (co.length >= 2) {
    return {
      loai: "XEM_TAY",
      ids: co.map((b) => b.id).sort(),
      lyDo: `${co.length} buổi cùng giờ đều đã mang dữ liệu (điểm danh/nhận xét/tham chiếu/hoàn tất) — hệ thống không tự chọn bên nào`,
    };
  }
  const giu = co.length === 1 ? co[0]! : somNhat(buoi);
  return {
    loai: "TU_SUA",
    giu: giu.id,
    huy: buoi.filter((b) => b.id !== giu.id).map((b) => b.id).sort(),
    lyDoGiu: co.length === 1 ? "CO_DU_LIEU" : "TAO_SOM_NHAT",
  };
}
