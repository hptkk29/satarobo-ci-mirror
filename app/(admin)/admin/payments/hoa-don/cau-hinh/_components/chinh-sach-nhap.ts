// Phần THUẦN của form Chính sách hoá đơn (S7): trạng thái nhập ↔ nội dung `noiDung`, nhãn tiếng Việt, kiểm nhanh phía trình duyệt.
// Không React, không server — client và test cùng import. Luật kiểm là của `chinh-sach-phien-ban.ts` (nguồn kiểu duy nhất); tệp này CHỈ gọi lại nó,
// không có bản luật thứ hai. Server vẫn kiểm lại tất cả (client chỉ để báo sớm).
//
// ⚠️ KHÔNG có mặc định pháp lý ở form: thời điểm lập, chế độ tối đa, mức người mua, mức thuế ĐỂ TRỐNG bắt chọn. Ngoại lệ DUY NHẤT có chủ đích là
// NHÃN TRÌNH BÀY của dòng mới ("Lần" / "Buổi" / "({n} buổi)") — không phải điều khoản; người dùng sửa được; bản sao từ phiên bản cũ giữ nguyên chữ của bản đó.

import {
  CAC_CHE_DO,
  CAC_DO_TIN_CAY,
  CAC_MUC_NGUOI_MUA,
  CAC_THOI_DIEM_LAP,
  NHAN_CHE_DO,
  kiemKhoangHieuLuc,
  phanTichNoiDung,
  type CheDoHub,
  type NoiDungChinhSach,
  type TrangThaiChinhSach,
} from "@/lib/finance/hoa-don/chinh-sach-phien-ban";
import { LOAI_KHOAN_GOP_VAO_COURSE, chuanLoaiKhoan } from "@/lib/finance/hoa-don/loai-khoan";

type ThoiDiemLap = (typeof CAC_THOI_DIEM_LAP)[number];
type MucNguoiMua = (typeof CAC_MUC_NGUOI_MUA)[number];
type DoTinCay = (typeof CAC_DO_TIN_CAY)[number];

export const NHAN_THOI_DIEM_LAP: Record<ThoiDiemLap, string> = {
  DO_KE_TOAN_CHOT: "Ngày do kế toán chốt (như hiện nay)",
  KHI_THU_TIEN: "Khi thu tiền",
  SAU_KE_TOAN_XAC_NHAN: "Sau khi kế toán xác nhận khoản thu",
  KHI_HOAN_THANH_DICH_VU: "Khi hoàn thành dịch vụ",
};

export const NHAN_KIEU_GIA: Record<"DA_GOM_THUE" | "CHUA_GOM_THUE", string> = {
  DA_GOM_THUE: "Số tiền trên đơn đã gồm thuế",
  CHUA_GOM_THUE: "Số tiền trên đơn chưa gồm thuế",
};

export const NHAN_CACH_SO_BUOI: Record<"MOT_KHOA_MO_TA_SO_BUOI" | "SO_BUOI_LA_SO_LUONG", string> = {
  MOT_KHOA_MO_TA_SO_BUOI: "Một khoá, số buổi ghi trong tên dòng",
  SO_BUOI_LA_SO_LUONG: "Số buổi là số lượng",
};

export const NHAN_MUC_NGUOI_MUA: Record<MucNguoiMua, string> = {
  NGUOI_TIEU_DUNG: "Người tiêu dùng (thông tin tối giản)",
  THONG_TIN_DAY_DU: "Thông tin đầy đủ",
};

export const NHAN_DO_TIN_CAY: Record<DoTinCay, string> = { CAO: "Cao", TRUNG: "Trung bình", THAP: "Thấp" };

/**
 * LOẠI KHOẢN có thật = `OrderType` của Prisma (engine khớp theo `Order.type`, xem `engine/chinh-sach.ts`) + dòng phủ chung `TAT_CA`.
 * Trước 02/11/2026 ô này là CHỮ GÕ TỰ DO ("Ví dụ COURSE hoặc TAT_CA") — người không rành kế toán phải đoán mã. Nay là danh sách chọn có tên tiếng Việt.
 * Test `[LK-01]` ghim danh sách này bằng `OrderType` của Prisma: thêm loại đơn mới mà quên khai ở đây ⇒ đỏ (không có chuyện loại khoản thiếu trong ô chọn).
 * Nhãn là TRÌNH BÀY, không phải điều khoản; không có số liệu thuế ở đây.
 */
export const LOAI_KHOAN_CHON = [
  { ma: "COURSE", nhan: "Học phí khoá học", giaiThich: "Đơn đăng ký học một hay nhiều khoá (kể cả mua theo gói) — phần lớn đơn của trung tâm." },
  { ma: "EXAM", nhan: "Lệ phí thi", giaiThich: "Đơn đăng ký thi." },
  { ma: "PRODUCT", nhan: "Học cụ / sản phẩm", giaiThich: "Bộ học cụ, cảm biến… bán kèm." },
  { ma: "COMBO", nhan: "Combo", giaiThich: "Đơn trọn bộ nhiều khoá." },
  { ma: "TAT_CA", nhan: "Tất cả loại còn lại", giaiThich: "Dòng dùng chung: loại khoản nào chưa có dòng riêng thì lấy theo dòng này." },
] as const;

/**
 * `PACKAGE` (đơn mua gói khoá) KHÔNG còn là một dòng chọn riêng [chủ dự án chốt 08/11/2026: «gói khoá học và học phí khoá học là một, bỏ đi để kế toán khỏi lẫn»].
 * Danh sách loại gộp khai ở engine (`LOAI_KHOAN_GOP_VAO_COURSE`) và `resolve` cũng gộp theo nó, nên nhãn và hành vi không lệch.
 * Dòng chính sách cũ mang mã này vẫn đọc được và hiện đúng tên «Học phí khoá học».
 */
export { LOAI_KHOAN_GOP_VAO_COURSE };

/** Tên tiếng Việt của một mã loại khoản; mã lạ (bản cũ sao chép sang) trả lại đúng mã đó, không đoán. */
export const nhanLoaiKhoan = (ma: string): string => LOAI_KHOAN_CHON.find((l) => l.ma === chuanLoaiKhoan(ma))?.nhan ?? ma;

export const NHAN_TRANG_THAI_PILL: Record<TrangThaiChinhSach, "muted" | "warning" | "success" | "info" | "danger"> = {
  NHAP: "muted",
  CHO_DUYET: "warning",
  HIEU_LUC: "success",
  HET_HIEU_LUC: "info",
  TU_CHOI: "danger",
};

export const nhanMucThue = (m: NoiDungChinhSach["anhXaThue"][number]["mucThue"]): string =>
  m.kieu === "SUAT" ? `${m.phanTram}%` : m.kieu === "KCT" ? "Không chịu thuế (KCT)" : "Không kê khai, nộp thuế (KKKNT)";

/** yyyy-mm-dd → dd/mm/yyyy ("" khi trống). */
export const ddmmyyyy = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

/** Mốc giờ (ISO) → "dd/mm/yyyy, hh:mm:ss" giờ Việt Nam — múi giờ khai cứng nên server và client in cùng chữ (không lệch hydrate). */
export const gioVN = (iso: string): string => new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

// ── TRẠNG THÁI NHẬP ───────────────────────────────────────────────────────

export type DongNhap = {
  loaiKhoan: string;
  kieuMuc: "" | "SUAT" | "KCT" | "KKKNT";
  phanTram: string;
  kieuGia: "" | "DA_GOM_THUE" | "CHUA_GOM_THUE";
  donViTinh: string;
  donViTinhBuoi: string;
  cachThuSoBuoi: "" | "MOT_KHOA_MO_TA_SO_BUOI" | "SO_BUOI_LA_SO_LUONG";
  mauMoTaSoBuoi: string;
};

export type CanCuNhap = {
  vanBan: string;
  dieu: string;
  khoan: string;
  doTinCay: "" | DoTinCay;
  canKeToanXacNhan: boolean;
  daKyDuyetBoi: string;
  daKyDuyetLuc: string;
};

export type NhapChinhSach = {
  /** true = DÙNG CHUNG toàn pháp nhân (chỉ Hội sở); false = riêng cơ sở đang xem. */
  chung: boolean;
  hieuLucTu: string;
  hieuLucDen: string;
  thoiDiemLap: "" | ThoiDiemLap;
  cheDoToiDa: "" | CheDoHub;
  mucNguoiMua: "" | MucNguoiMua;
  /** Chuỗi số; trống = không khai (rơi về mặc định của hệ thống). */
  qrTtlGio: string;
  dong: DongNhap[];
  canCu: CanCuNhap[];
  lyDo: string;
};

/** Dòng mới: chỉ nhãn trình bày được gợi ý sẵn (xem đầu tệp); mọi thứ có hệ quả thuế để TRỐNG. */
export const dongMoi = (): DongNhap => ({
  loaiKhoan: "",
  kieuMuc: "",
  phanTram: "",
  kieuGia: "",
  donViTinh: "Lần",
  donViTinhBuoi: "Buổi",
  cachThuSoBuoi: "",
  mauMoTaSoBuoi: "({n} buổi)",
});

export const canCuMoi = (): CanCuNhap => ({ vanBan: "", dieu: "", khoan: "", doTinCay: "", canKeToanXacNhan: false, daKyDuyetBoi: "", daKyDuyetLuc: "" });

export const nhapMoi = (chung: boolean): NhapChinhSach => ({
  chung,
  hieuLucTu: "",
  hieuLucDen: "",
  thoiDiemLap: "",
  cheDoToiDa: "",
  mucNguoiMua: "",
  qrTtlGio: "",
  dong: [dongMoi()],
  canCu: [],
  lyDo: "",
});

/** Soạn phiên bản mới TỪ một phiên bản có sẵn: chép nội dung, để ngày hiệu lực + lý do TRỐNG (phiên bản mới không thừa kế ngày). */
export function nhapTuNoiDung(nd: NoiDungChinhSach, chung: boolean): NhapChinhSach {
  return {
    chung,
    hieuLucTu: "",
    hieuLucDen: "",
    thoiDiemLap: nd.thoiDiemLap,
    cheDoToiDa: nd.cheDoToiDa,
    mucNguoiMua: nd.nguoiMua.buyerInfoLevel,
    qrTtlGio: nd.nguoiMua.qrTtlGio === null ? "" : String(nd.nguoiMua.qrTtlGio),
    dong: nd.anhXaThue.map((d) => ({
      loaiKhoan: d.loaiKhoan,
      kieuMuc: d.mucThue.kieu,
      phanTram: d.mucThue.kieu === "SUAT" ? String(d.mucThue.phanTram) : "",
      kieuGia: d.kieuGia,
      donViTinh: d.donViTinh,
      donViTinhBuoi: d.donViTinhBuoi,
      cachThuSoBuoi: d.cachThuSoBuoi,
      mauMoTaSoBuoi: d.mauMoTaSoBuoi,
    })),
    canCu: nd.legalBasisRef.map((r) => ({
      vanBan: r.vanBan,
      dieu: r.dieu ?? "",
      khoan: r.khoan ?? "",
      doTinCay: r.doTinCay,
      canKeToanXacNhan: r.canKeToanXacNhan,
      daKyDuyetBoi: r.daKyDuyetBoi ?? "",
      daKyDuyetLuc: r.daKyDuyetLuc ?? "",
    })),
    lyDo: "",
  };
}

const so = (s: string): number | undefined => (s.trim() === "" ? undefined : Number(s));

/**
 * Trạng thái nhập → nội dung THÔ gửi server. Ô trống ⇒ KHÔNG điền (`undefined`) để `phanTichNoiDung` báo "Phải chọn …" — không có mặc định ngầm.
 * `phanTram` trống/không phải số ⇒ `NaN`/`undefined` ⇒ bị từ chối ở phần thuế suất.
 */
export function noiDungTuNhap(n: NhapChinhSach): Record<string, unknown> {
  return {
    anhXaThue: n.dong.map((d) => ({
      loaiKhoan: d.loaiKhoan,
      mucThue: d.kieuMuc === "SUAT" ? { kieu: "SUAT", phanTram: so(d.phanTram) } : d.kieuMuc === "" ? undefined : { kieu: d.kieuMuc },
      kieuGia: d.kieuGia === "" ? undefined : d.kieuGia,
      donViTinh: d.donViTinh,
      donViTinhBuoi: d.donViTinhBuoi,
      cachThuSoBuoi: d.cachThuSoBuoi === "" ? undefined : d.cachThuSoBuoi,
      mauMoTaSoBuoi: d.mauMoTaSoBuoi,
    })),
    thoiDiemLap: n.thoiDiemLap === "" ? undefined : n.thoiDiemLap,
    cheDoToiDa: n.cheDoToiDa === "" ? undefined : n.cheDoToiDa,
    nguoiMua: { buyerInfoLevel: n.mucNguoiMua === "" ? undefined : n.mucNguoiMua, qrTtlGio: so(n.qrTtlGio) },
    lamTron: "HALF_UP",
    legalBasisRef: n.canCu.map((c) => ({
      vanBan: c.vanBan,
      dieu: c.dieu,
      khoan: c.khoan,
      doTinCay: c.doTinCay === "" ? undefined : c.doTinCay,
      canKeToanXacNhan: c.canKeToanXacNhan,
      daKyDuyetBoi: c.daKyDuyetBoi,
      daKyDuyetLuc: c.daKyDuyetLuc,
    })),
  };
}

/** Kiểm nhanh phía trình duyệt: danh sách lỗi tiếng Việt (rỗng ⇒ gửi được). Cùng luật với server. */
export function kiemNhap(n: NhapChinhSach): string[] {
  const loi: string[] = [];
  const k = kiemKhoangHieuLuc(n.hieuLucTu, n.hieuLucDen.trim() === "" ? null : n.hieuLucDen);
  if (k) loi.push(k);
  const p = phanTichNoiDung(noiDungTuNhap(n));
  if (!p.ok) loi.push(...p.loi);
  return loi;
}

export { CAC_CHE_DO, CAC_DO_TIN_CAY, CAC_MUC_NGUOI_MUA, CAC_THOI_DIEM_LAP, NHAN_CHE_DO };
