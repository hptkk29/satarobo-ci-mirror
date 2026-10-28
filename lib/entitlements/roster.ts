// lib/entitlements/roster.ts — HỌC VIÊN CÓ ĐƯỢC HỌC BÀI NÀY THEO QUYỀN HỌC KHÔNG. THUẦN, chưa nối vào roster.
//
// 🔴 CHƯA CÓ NƠI NÀO GỌI. `lib/attendance/roster.ts` (và cổng ghi `getSessionRosterStudentIds`, nơi G-29 từng
// kẹt) VẪN dùng `Enrollment.buoiBatDau` như hôm nay. Người nối vào phải giữ nguyên hai điều:
//   1. Ghi danh KHÔNG có quyền học nào = LEGACY ⇒ `loai: "LEGACY"`, người gọi GIỮ hành vi cũ (fail-open).
//      Đây là lý do hàm trả `LEGACY` thay vì `duoc: false` khi danh sách rỗng — rỗng mà hiểu là "không được
//      học" thì mọi học viên cũ biến mất khỏi roster trong một đêm.
//   2. Cờ `billing.scopePurchaseEnabled` TẮT ⇒ đừng gọi hàm này (đường cũ chạy nguyên).
//
// Một học viên có thể có NHIỀU quyền học trên cùng một khoá (mua tiếp). Bài được học nếu BẤT KỲ quyền học nào
// cho học; nếu không quyền nào cho, lý do được chọn theo thứ tự ưu tiên có nghĩa nhất cho người đọc.
import { phanLoaiBai, tinhConLai, type QuyenHocTomTat } from "./tieu-thu";
import type { TrangThaiQuyenHoc } from "./trang-thai";

export interface QuyenHocChoRoster extends QuyenHocTomTat {
  readonly id: string;
  readonly status: TrangThaiQuyenHoc;
  /** Số bài đã tiêu thụ (cache hoặc tính từ sổ cái). */
  readonly consumedSessions: number;
  /** Ân hạn đã dùng. */
  readonly graceSessionsUsed: number;
}

export type LyDoKhongDuocHoc =
  | "NGOAI_PHAM_VI" //     bài nằm ngoài mọi quyền học đang có
  | "BO_QUA" //            bài thuộc phạm vi nhưng bị bỏ qua (vượt trần học vượt)
  | "DANG_BAO_LUU"
  | "CHUA_XEP_LOP" //      quyền học chưa chốt phạm vi
  | "DA_HET_QUYEN"; //     đã dùng hết buổi / hết ân hạn

export type KetQuaDuocHoc =
  | { readonly loai: "LEGACY" } //                        không có quyền học ⇒ người gọi giữ luật cũ
  | { readonly loai: "DUOC"; readonly nguon: "TRONG_PHAM_VI" | "AN_HAN"; readonly quyenHocId: string }
  | { readonly loai: "KHONG"; readonly lyDo: LyDoKhongDuocHoc };

/** Thứ tự ưu tiên khi KHÔNG quyền nào cho học: lý do càng "gần được học" càng được nêu trước. */
const UU_TIEN_LY_DO: readonly LyDoKhongDuocHoc[] = ["DANG_BAO_LUU", "CHUA_XEP_LOP", "DA_HET_QUYEN", "BO_QUA", "NGOAI_PHAM_VI"];

const DONG_KHONG_DAY_HOC: ReadonlySet<TrangThaiQuyenHoc> = new Set(["COMPLETED", "EXPIRED", "STOPPED", "VOIDED"]);

function xetMotQuyen(q: QuyenHocChoRoster, lessonOrder: number): KetQuaDuocHoc {
  if (q.status === "FROZEN") return { loai: "KHONG", lyDo: "DANG_BAO_LUU" };
  if (q.status === "AWAITING_PLACEMENT") return { loai: "KHONG", lyDo: "CHUA_XEP_LOP" };
  if (DONG_KHONG_DAY_HOC.has(q.status) || q.status === "SEAT_HOLD") return { loai: "KHONG", lyDo: "DA_HET_QUYEN" };

  const pl = phanLoaiBai(q, lessonOrder);
  if (pl === "BO_QUA") return { loai: "KHONG", lyDo: "BO_QUA" };
  if (pl === "NGOAI_PHAM_VI") return { loai: "KHONG", lyDo: "NGOAI_PHAM_VI" };
  if (pl === "TRONG_PHAM_VI") {
    // ACTIVE còn buổi mới được học. (EXHAUSTED mà gặp bài trong phạm vi chưa có dòng = dữ liệu lệch: không cho.)
    const conBuoi = q.status === "ACTIVE" && tinhConLai(q, q.consumedSessions) > 0;
    return conBuoi ? { loai: "DUOC", nguon: "TRONG_PHAM_VI", quyenHocId: q.id } : { loai: "KHONG", lyDo: "DA_HET_QUYEN" };
  }
  // AN_HAN: chỉ khi quyền đã EXHAUSTED và còn ân hạn.
  return q.status === "EXHAUSTED" && q.graceSessionsUsed < q.graceSessionsGranted
    ? { loai: "DUOC", nguon: "AN_HAN", quyenHocId: q.id }
    : { loai: "KHONG", lyDo: "DA_HET_QUYEN" };
}

/** Học viên (qua danh sách quyền học TRÊN CÙNG MỘT KHOÁ) có được học bài `lessonOrder` không. */
export function xetBuoiTheoQuyenHoc(quyenHoc: readonly QuyenHocChoRoster[], lessonOrder: number): KetQuaDuocHoc {
  if (quyenHoc.length === 0) return { loai: "LEGACY" };
  const lyDo: LyDoKhongDuocHoc[] = [];
  for (const q of quyenHoc) {
    const kq = xetMotQuyen(q, lessonOrder);
    if (kq.loai === "DUOC") return kq;
    if (kq.loai === "KHONG") lyDo.push(kq.lyDo);
  }
  const chon = UU_TIEN_LY_DO.find((l) => lyDo.includes(l)) ?? "NGOAI_PHAM_VI";
  return { loai: "KHONG", lyDo: chon };
}

/** Nhãn hiện cho giáo viên / phụ huynh khi học viên không được học bài này. */
export function nhanLyDo(lyDo: LyDoKhongDuocHoc, phamVi?: { start: number; end: number }): string {
  switch (lyDo) {
    case "NGOAI_PHAM_VI":
      return phamVi ? `Ngoài phạm vi đăng ký (bài ${phamVi.start}–${phamVi.end})` : "Ngoài phạm vi đăng ký";
    case "BO_QUA":
      return "Bài này không nằm trong phần được học vượt";
    case "DANG_BAO_LUU":
      return "Đang bảo lưu";
    case "CHUA_XEP_LOP":
      return "Chưa xếp lớp";
    case "DA_HET_QUYEN":
      return "Đã học hết số buổi đã đăng ký";
  }
}
