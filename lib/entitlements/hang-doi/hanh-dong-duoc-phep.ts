// lib/entitlements/hang-doi/hanh-dong-duoc-phep.ts — MỘT chính sách "dòng hàng đợi này được làm gì". THUẦN.
//
// Luật 12: giao diện chỉ vẽ nút khi action thật sự sẽ cho làm, và action quyết bằng CÙNG hàm này. Hai chỗ tự viết điều kiện thì sẽ có ngày lệch —
// nút hiện mà bấm ra "không được" (lời hứa suông) hoặc nút ẩn mà action vẫn cho (cổng mở toang). Lưới `[HD-W*]` ghim: trang và mọi action đều gọi hàm này.
//
// QUYỀN: đọc = `entitlements:view`; MỌI ghi = `entitlements:manage` (chủ dự án), TRỪ `DUYET_HOC_VUOT` (quyết định 5, 13/10/2026): duyệt học vượt THÊM phần vượt trần cần
// `entitlements:approve-exception` (Giám đốc / Admin). Người chỉ có `manage` (QLCS) KHÔNG duyệt được phần vượt trần nhưng đóng / từ chối được (DONG, có lý do); ngoại lệ
// duy nhất khi cấu hình trần không rõ — xem `quyenCanDuyetHocVuot` (hoc-vuot-duyet.ts).
//
// CỜ: phạm vi (theo cơ sở) TẮT cho cơ sở của dòng ⇒ mọi ghi bị từ chối (đọc vẫn xem được lịch sử). Rollback = tắt cờ ⇒ hàng đợi đóng băng.
import type { QuyenCanDuyet } from "../hoc-vuot-duyet";
import type { LoaiHangDoi, TrangThaiHangDoi } from "./loai";

export const HANH_DONG_HANG_DOI = ["THU_LAI", "DONG", "GIU_QUYEN", "DUYET_THU_HOI", "DANH_DAU_CAN_DUYET", "DUYET_HOC_VUOT"] as const;
export type HanhDongHangDoi = (typeof HANH_DONG_HANG_DOI)[number];

export const NHAN_HANH_DONG: Readonly<Record<HanhDongHangDoi, string>> = {
  THU_LAI: "Thử cấp lại",
  DONG: "Đóng (có lý do)",
  GIU_QUYEN: "Giữ quyền học",
  DUYET_THU_HOI: "Duyệt thu hồi",
  DANH_DAU_CAN_DUYET: "Cần duyệt tay",
  DUYET_HOC_VUOT: "Duyệt học vượt thêm",
};

/** Trạng thái quyền học mà `dungQuyenHocTrongTx` đóng được (máy trạng thái có cạnh HUY_HOAN / DUNG_HOC). SEAT_HOLD, COMPLETED, EXPIRED… KHÔNG có cạnh ⇒ không thu hồi. */
export const TRANG_THAI_THU_HOI_DUOC = ["AWAITING_PLACEMENT", "ACTIVE", "FROZEN", "EXHAUSTED"] as const;

/** Lý do người nhập tối thiểu (ký tự, sau khi cắt khoảng trắng). */
export const LY_DO_TOI_THIEU = 10;
export const LY_DO_TOI_DA = 500;

export interface DongHangDoiXet {
  readonly loai: LoaiHangDoi;
  readonly trangThai: TrangThaiHangDoi;
  /** Dòng đơn có quyền học CÒN SỐNG (khác VOIDED) không. */
  readonly coQuyenHoc: boolean;
  readonly trangThaiQuyenHoc: string | null;
  /** `null` = chưa biết (không đọc được sổ cái) ⇒ coi như KHÔNG thu hồi được (fail-closed). */
  readonly daTieuThu: boolean | null;
  /**
   * Chỉ có nghĩa với CHO_DUYET_HOC_VUOT: ai được duyệt đề xuất này (`quyenCanDuyetHocVuot` trên `payload`). `null` = loại khác, hoặc payload không đọc được
   * ⇒ KHÔNG ai duyệt được (fail-closed — không duyệt theo thứ đoán). BẮT BUỘC (luật 7): quên truyền = nút duyệt biến mất / hiện nhầm mà không lỗi nào báo.
   */
  readonly quyenCanDuyet: QuyenCanDuyet | null;
}

export interface NguCanhXet {
  /** `entitlements:manage` tại ĐÚNG cơ sở / đơn vị của dòng. */
  readonly coQuyenManage: boolean;
  /** Cờ phạm vi (theo cơ sở) của cơ sở của dòng. */
  readonly coBat: boolean;
  /** `entitlements:approve-exception` tại ĐÚNG cơ sở / đơn vị của dòng. BẮT BUỘC (luật 7). */
  readonly coQuyenDuyetNgoaiLe: boolean;
}

/** Trạng thái quyền học còn "sống" để nhận thêm bài học vượt. */
const TRANG_THAI_NHAN_HOC_VUOT = ["ACTIVE", "EXHAUSTED", "FROZEN"] as const;

export type KetQuaXet = { readonly duoc: true } | { readonly duoc: false; readonly lyDo: string };

export function xetHanhDong(hd: HanhDongHangDoi, dong: DongHangDoiXet, nc: NguCanhXet): KetQuaXet {
  if (hd === "DUYET_HOC_VUOT") return xetDuyetHocVuot(dong, nc);
  if (!nc.coQuyenManage) return { duoc: false, lyDo: "Bạn chỉ có quyền xem hàng đợi — xử lý cần quyền entitlements:manage." };
  if (!nc.coBat) return { duoc: false, lyDo: "Thu học phí theo phạm vi học chưa được bật cho cơ sở này." };
  if (dong.trangThai !== "OPEN") return { duoc: false, lyDo: "Dòng này đã đóng." };
  switch (hd) {
    case "THU_LAI":
      // Dòng xin duyệt học vượt do NGƯỜI quyết — chạy lại đường cấp quyền / xếp lớp không đổi được gì ở đây, nên không vẽ nút.
      return dong.loai === "CHO_DUYET_HOC_VUOT" ? { duoc: false, lyDo: "Dòng xin duyệt học vượt chỉ người mới quyết được (duyệt hoặc đóng / từ chối)." } : { duoc: true };
    case "DONG":
      return { duoc: true };
    case "GIU_QUYEN":
      return dong.loai === "CAN_THU_HOI" || dong.loai === "TREO_DUYET_TAY"
        ? { duoc: true }
        : { duoc: false, lyDo: "Chỉ dòng thu hồi / treo duyệt tay mới có quyết định 'giữ quyền học'." };
    case "DUYET_THU_HOI":
      if (dong.loai !== "CAN_THU_HOI") return { duoc: false, lyDo: "Chỉ dòng 'cần thu hồi' (quyền học CHƯA tiêu thụ buổi nào) mới thu hồi được." };
      if (!dong.coQuyenHoc || dong.trangThaiQuyenHoc === null) return { duoc: false, lyDo: "Dòng đơn không còn quyền học nào để thu hồi." };
      if (dong.daTieuThu !== false) return { duoc: false, lyDo: "Quyền học đã có buổi tiêu thụ (hoặc không đọc được sổ cái) — KHÔNG tự thu hồi." };
      return (TRANG_THAI_THU_HOI_DUOC as readonly string[]).includes(dong.trangThaiQuyenHoc)
        ? { duoc: true }
        : { duoc: false, lyDo: `Quyền học đang ở ${dong.trangThaiQuyenHoc} — máy trạng thái không có cạnh thu hồi từ đây.` };
    case "DANH_DAU_CAN_DUYET":
      if (dong.loai !== "CHO_CHUYEN_DOI" && dong.loai !== "THIEU_QUYEN_HOC" && dong.loai !== "LECH_DU_LIEU") {
        return { duoc: false, lyDo: "Loại này không chuyển sang 'treo duyệt tay' được." };
      }
      // Đã có quyền học ⇒ `cap-tu-don` tự quản TREO_DUYET_TAY theo tiền + buổi đã tiêu thụ và sẽ ĐÓNG dòng người đánh dấu ở lượt hích kế tiếp.
      return dong.coQuyenHoc
        ? { duoc: false, lyDo: "Dòng đơn đã có quyền học: hệ thống tự quản 'treo duyệt tay' theo tiền và buổi đã học, dấu của người sẽ bị đóng ở lượt kế tiếp." }
        : { duoc: true };
  }
}

function xetDuyetHocVuot(dong: DongHangDoiXet, nc: NguCanhXet): KetQuaXet {
  if (dong.loai !== "CHO_DUYET_HOC_VUOT") return { duoc: false, lyDo: "Chỉ dòng xin duyệt học vượt mới có quyết định này." };
  const q = dong.quyenCanDuyet;
  if (q === null) return { duoc: false, lyDo: "Không đọc được đề xuất học vượt của dòng này — không duyệt theo thứ đoán; đóng dòng có lý do rồi báo kỹ thuật." };
  // Quyền TRƯỚC cờ / trạng thái (cùng thứ tự các hành động khác): người không đủ quyền thấy lý do về QUYỀN, không phải về cờ.
  const duoc = nc.coQuyenDuyetNgoaiLe || (q === "MANAGE" && nc.coQuyenManage);
  if (!duoc) {
    return nc.coQuyenManage
      ? { duoc: false, lyDo: "Phần học vượt này vượt trần — cần người có quyền duyệt ngoại lệ (Giám đốc / Admin). Bạn đóng / từ chối được, nhưng không duyệt được." }
      : { duoc: false, lyDo: "Duyệt học vượt vượt trần cần quyền entitlements:approve-exception." };
  }
  if (!nc.coBat) return { duoc: false, lyDo: "Thu học phí theo phạm vi học chưa được bật cho cơ sở này." };
  if (dong.trangThai !== "OPEN") return { duoc: false, lyDo: "Dòng này đã đóng." };
  if (!dong.coQuyenHoc || dong.trangThaiQuyenHoc === null || !(TRANG_THAI_NHAN_HOC_VUOT as readonly string[]).includes(dong.trangThaiQuyenHoc)) {
    return { duoc: false, lyDo: "Dòng đơn không còn quyền học đang hiệu lực để nhận thêm bài học vượt." };
  }
  return { duoc: true };
}

/** Danh sách nút giao diện được vẽ — đúng bằng tập mà action sẽ cho làm. */
export function hanhDongDuocPhep(dong: DongHangDoiXet, nc: NguCanhXet): HanhDongHangDoi[] {
  return HANH_DONG_HANG_DOI.filter((hd) => xetHanhDong(hd, dong, nc).duoc);
}

/** Lý do người nhập hợp lệ không. Trả câu lỗi hoặc `null`. */
export function kiemLyDoNhap(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  if (t.length < LY_DO_TOI_THIEU) return `Lý do phải từ ${LY_DO_TOI_THIEU} ký tự.`;
  if (t.length > LY_DO_TOI_DA) return `Lý do tối đa ${LY_DO_TOI_DA} ký tự.`;
  return null;
}
