// lib/entitlements/hang-doi/doi-soat-lech.ts — PHÁT HIỆN DỮ LIỆU LỆCH GIỮA DÒNG ĐƠN SCOPE ↔ QUYỀN HỌC ↔ GHI DANH ↔ HỌC VIÊN. THUẦN, không DB.
//
// Chỉ nhìn QUAN HỆ giữa các bản ghi đã có — KHÔNG tính tiền (định nghĩa "đủ tiền" chỉ có một nơi: `cap-tu-don.ts`, và cron đi qua chính nó ở chế độ
// CHI_GHI_NHAN). Mỗi phát hiện là một MÃ ổn định + một câu cho người đọc; tập mã của một dòng đơn là dấu vân của dòng LECH_DU_LIEU (đổi tập mã ⇒ đổi lý do
// ⇒ mở lại / cập nhật CHÍNH dòng đó). Mọi số tiền trong câu chữ kết thúc bằng "đ" để `an-tien.ts` che được cho vai không có `entitlements:view-money`.
//
import { hanhDongChoChuyenDoi, type HanhDongCho, type TinhHuongCho } from "../cho-chuyen-doi";

// ĐỌC `docs/thu-hoc-phi-pham-vi/HANG-DOI-VAN-HANH.md` mục "Cron đối soát": phát hiện #5 (quyền học đã đóng / hết hạn mà ghi danh còn sống) CỐ Ý không tạo dòng
// — chỉ báo trong report cron — vì `roster.ts` chưa nối vào điểm danh nên "không hợp lệ" chưa có nghĩa vận hành rõ ràng (mơ hồ ⇒ chỉ báo, không đoán).

export type MaLech =
  | "GHI_DANH_KHONG_QUYEN"
  | "QUYEN_LECH_DON"
  | "QUYEN_LECH_CO_SO"
  | "QUYEN_LECH_KHOA"
  | "QUYEN_LECH_HOC_VIEN"
  | "QUYEN_LECH_GHI_DANH"
  | "QUYEN_LECH_BE"
  | "QUYEN_LECH_SO_TIEN"
  | "QUYEN_LECH_SO_BUOI"
  | "TIEN_KHONG_GAN_DONG";

export interface PhatHienLech {
  readonly ma: MaLech;
  readonly moTa: string;
}

export interface GhiDanhLech {
  readonly id: string;
  readonly studentId: string;
  readonly courseId: string;
  readonly status: string;
  readonly deletedAt: Date | null;
}

export interface QuyenLech {
  readonly id: string;
  readonly status: string;
  readonly studentId: string;
  readonly courseId: string;
  readonly orderId: string | null;
  readonly centerId: string;
  readonly enrollmentId: string | null;
  readonly netAmount: number;
  readonly purchaseSessions: number;
  readonly graceSessionsGranted: number;
  readonly graceSessionsUsed: number;
}

export interface DongLechVao {
  readonly orderItemId: string;
  readonly orderId: string;
  readonly donCenterId: string | null;
  readonly courseIdDong: string | null;
  readonly leadChildIdDong: string | null;
  readonly dongStudentId: string | null;
  readonly dongEnrollmentId: string | null;
  /** Ghi danh mà `OrderItem.enrollmentId` trỏ tới. */
  readonly ghiDanhCuaDong: GhiDanhLech | null;
  /** Số tiền / số buổi ghi trong dấu SCOPE của dòng. */
  readonly thanhTien: number;
  readonly soBuoiMua: number;
  /** Quyền học CÒN SỐNG (khác VOIDED); `null` = chưa có. */
  readonly quyen: QuyenLech | null;
  /** Từng có quyền học nhưng toàn bộ đã VOIDED (không hồi sinh — không phải lệch). */
  readonly chiCoQuyenDaHuy: boolean;
  readonly hocVienCuaQuyenLeadChildId: string | null;
  /** Ghi danh mà `StudyEntitlement.enrollmentId` trỏ tới. */
  readonly ghiDanhCuaQuyen: GhiDanhLech | null;
  /** Có dòng OPEN (hoặc dòng người đã quyết) thuộc CHO_CHUYEN_DOI / CHO_XEP_LOP / THIEU_QUYEN_HOC đang giải thích việc dòng chưa có quyền học. */
  readonly coDongGiaiThich: boolean;
  /** `cap-tu-don` báo tiền của đơn nhiều dòng không gắn được dòng này (`chuaXacDinhDuocDong`). */
  readonly tienMoHo: boolean;
  /** Dòng đơn còn hiệu lực (ACTIVE) và đơn chưa huỷ/hoàn — dòng không còn hiệu lực không phải lệch. */
  readonly conHieuLuc: boolean;
}

export const TRANG_THAI_GHI_DANH_DANG_HOC = ["CONFIRMED", "STUDYING", "ACTIVE"] as const;
const GHI_DANH_SONG = ["PENDING", "CONFIRMED", "STUDYING", "ACTIVE"] as const;

const laGhiDanhSong = (g: GhiDanhLech | null): g is GhiDanhLech => g !== null && g.deletedAt === null && (GHI_DANH_SONG as readonly string[]).includes(g.status);
const dong = (n: number): string => `${n}đ`;

/** Mọi chỗ lệch của MỘT dòng đơn SCOPE. Rỗng = khớp. Thứ tự ổn định (theo mã) để câu chữ ổn định. */
export function phatHienLech(v: DongLechVao): PhatHienLech[] {
  if (!v.conHieuLuc) return [];
  const ra: PhatHienLech[] = [];
  const them = (ma: MaLech, moTa: string): void => void ra.push({ ma, moTa });
  const q = v.quyen;

  // #4 — ghi danh gắn với dòng SCOPE mà không có quyền học và không dòng nào giải thích.
  if (!q && !v.chiCoQuyenDaHuy && laGhiDanhSong(v.ghiDanhCuaDong) && !v.coDongGiaiThich) {
    them("GHI_DANH_KHONG_QUYEN", "Dòng đơn đã gắn ghi danh còn hiệu lực nhưng KHÔNG có quyền học và không có dòng chờ nào giải thích.");
  }

  // #6 — lẫn dòng giữa nhiều bé / nhiều khoá / nhiều dòng.
  if (q) {
    if (q.orderId !== null && q.orderId !== v.orderId) them("QUYEN_LECH_DON", "Quyền học thuộc một đơn khác với đơn của dòng.");
    if (v.donCenterId !== null && q.centerId !== v.donCenterId) them("QUYEN_LECH_CO_SO", "Quyền học thuộc cơ sở khác với cơ sở của đơn.");
    if (v.courseIdDong !== null && q.courseId !== v.courseIdDong) them("QUYEN_LECH_KHOA", "Quyền học thuộc khoá khác với khoá của dòng đơn.");
    const hvDong = v.dongStudentId ?? v.ghiDanhCuaDong?.studentId ?? null;
    if (hvDong !== null && hvDong !== q.studentId) them("QUYEN_LECH_HOC_VIEN", "Quyền học thuộc học viên khác với học viên ghi trên dòng đơn / ghi danh của dòng.");
    if (v.dongEnrollmentId !== null && q.enrollmentId !== null && v.dongEnrollmentId !== q.enrollmentId) {
      them("QUYEN_LECH_GHI_DANH", "Quyền học đã xếp vào một ghi danh khác với ghi danh gắn trên dòng đơn.");
    } else {
      const g = v.ghiDanhCuaQuyen;
      if (g !== null && (g.studentId !== q.studentId || g.courseId !== q.courseId)) {
        them("QUYEN_LECH_GHI_DANH", "Ghi danh mà quyền học trỏ tới thuộc học viên / khoá khác với quyền học.");
      }
    }
    if (v.leadChildIdDong !== null && v.hocVienCuaQuyenLeadChildId !== null && v.leadChildIdDong !== v.hocVienCuaQuyenLeadChildId) {
      them("QUYEN_LECH_BE", "Học viên của quyền học là hồ sơ của bé khác với bé ghi trên dòng đơn.");
    }
    if (q.netAmount !== v.thanhTien) them("QUYEN_LECH_SO_TIEN", `Quyền học ghi ${dong(q.netAmount)} nhưng dấu SCOPE của dòng đơn ghi ${dong(v.thanhTien)}.`);
    if (q.purchaseSessions !== v.soBuoiMua) them("QUYEN_LECH_SO_BUOI", `Quyền học ghi ${q.purchaseSessions} buổi nhưng dấu SCOPE của dòng đơn ghi ${v.soBuoiMua} buổi.`);
  }

  // Tiền của đơn nhiều dòng không gắn được dòng này ⇒ `cap-tu-don` cố ý KHÔNG kết luận (không đoán) và cũng không ghi dòng nào — nên không ai thấy.
  if (v.tienMoHo) them("TIEN_KHONG_GAN_DONG", "Đơn nhiều dòng có khoản tiền không gắn được vào dòng nào (hoặc khoản âm lạc dòng) — hệ thống không kết luận được dòng này đã đủ tiền chưa.");

  return ra.sort((a, b) => (a.ma < b.ma ? -1 : a.ma > b.ma ? 1 : 0));
}

export const TIEN_TO_LY_DO_LECH = "Dữ liệu lệch: ";

/** `lyDo` của dòng LECH_DU_LIEU. Rỗng ⇒ `null` (không cần dòng). */
export function lyDoLech(ph: readonly PhatHienLech[]): string | null {
  return ph.length === 0 ? null : `${TIEN_TO_LY_DO_LECH}${ph.map((p) => p.moTa).join(" · ")}`;
}

// ── #5 — chỉ BÁO, không tạo dòng ──────────────────────────────────────────────────────────────────────────────────────

export interface QuyenDongConGhiDanhVao {
  readonly quyenId: string;
  readonly status: string;
  readonly graceSessionsGranted: number;
  readonly graceSessionsUsed: number;
  readonly ghiDanh: GhiDanhLech | null;
}

/** Quyền học đã đóng / hết hạn / hết ân hạn mà ghi danh nó trỏ tới vẫn đang học (CONFIRMED / STUDYING / ACTIVE). Nghĩa vận hành chưa chốt ⇒ chỉ báo. */
export function quyenDongConGhiDanhMo(v: QuyenDongConGhiDanhVao): boolean {
  const g = v.ghiDanh;
  if (g === null || g.deletedAt !== null || !(TRANG_THAI_GHI_DANH_DANG_HOC as readonly string[]).includes(g.status)) return false;
  if (v.status === "EXPIRED" || v.status === "STOPPED" || v.status === "SEAT_HOLD") return true;
  return v.status === "EXHAUSTED" && v.graceSessionsUsed >= v.graceSessionsGranted;
}

// ── Vòng đời dòng LECH_DU_LIEU của MỘT dòng đơn — dùng lại hàm thuần của CHO_CHUYEN_DOI (cùng khuôn mở / mở lại / đổi lý do / đóng) ───────────────────────

export interface DongLechHienCo {
  readonly trangThai: "OPEN" | "DA_XU_LY" | "HUY";
  readonly lyDo: string;
  /** Dấu vân quyết định của người xử lý (da-quyet.ts); người đã quyết đúng bộ phát hiện này ⇒ không mở lại. */
  readonly daQuyetDauVan: string | null;
}

export const LY_DO_HET_LECH = "Dữ liệu đã khớp lại — không còn lệch.";

export function keHoachLechMotDong(ph: readonly PhatHienLech[], hienCo: DongLechHienCo | null): { readonly lyDo: string | null; readonly viec: HanhDongCho } {
  const lyDo = lyDoLech(ph);
  const tinhHuong: TinhHuongCho = lyDo === null ? { kieu: "KHONG_CON_HOP_LE", lyDo: LY_DO_HET_LECH } : { kieu: "PHAI_CHO", lyDo };
  return { lyDo, viec: hanhDongChoChuyenDoi(hienCo, tinhHuong) };
}
