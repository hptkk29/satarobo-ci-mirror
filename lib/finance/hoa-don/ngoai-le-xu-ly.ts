// lib/finance/hoa-don/ngoai-le-xu-ly.ts — XỬ LÝ NGOẠI LỆ HOÁ ĐƠN (Invoice Hub S12). THUẦN: máy trạng thái, lý do, nút nào được vẽ, nhãn cho người vận hành.
//
// Ngoại lệ (`HoaDonNgoaiLe`) do scanner S8 sinh. Người xử lý là KẾ TOÁN của cơ sở có ngoại lệ (hoặc Hội sở) — quyền DÙNG LẠI `payments:confirm` (TD-07), phạm vi theo
// nơi neo vai (`coQuyenKeToanTaiCoSo`): nút trên màn, action và dịch vụ ghi cùng hỏi MỘT vị từ (luật 12 — nút chỉ hiện khi bấm được).
//
//   MO ──nhận xử lý──▶ DANG_XU_LY ──đã xử lý──▶ DA_XU_LY            (lý do ≥ 10 ký tự)
//    └──────────────đã xử lý / bỏ qua có lý do──▶ DA_XU_LY | BO_QUA_CO_LY_DO
//
// ⚠️ "Đã xử lý" KHÔNG xoá nguyên nhân: nguyên nhân còn thì scanner mở lại một ngoại lệ mới ở lượt sau (người ta tưởng đã xong mà chưa). "Bỏ qua có lý do" thì
// scanner KHÔNG mở lại đúng khoá đó (`ngoaiLeBoQua` của kế hoạch S8). Hai nghĩa khác nhau — đừng gộp.

import type { ActionScopeActor } from "@/lib/lms/report-card-core";
import { coQuyenKeToanTaiCoSo, phamViKeToan } from "./quyen";

export type TrangThaiNgoaiLe = "MO" | "DANG_XU_LY" | "DA_XU_LY" | "BO_QUA_CO_LY_DO";
export type HanhDongNgoaiLe = "NHAN_XU_LY" | "DA_XU_LY" | "BO_QUA";

/** Khớp CHECK `HoaDonNgoaiLe_ly_do_xu_ly_check` (≥ 10 ký tự sau khi cắt khoảng trắng). */
export const TOI_THIEU_LY_DO_XU_LY = 10;
export const TOI_DA_LY_DO_XU_LY = 500;

export const NHAN_TRANG_THAI_NGOAI_LE: Record<TrangThaiNgoaiLe, string> = {
  MO: "Mới",
  DANG_XU_LY: "Đang xử lý",
  DA_XU_LY: "Đã xử lý",
  BO_QUA_CO_LY_DO: "Đã bỏ qua",
};

export const NHAN_MUC_NGOAI_LE = { THONG_TIN: "Thông tin", CAN_XU_LY: "Cần xử lý", KHAN: "Khẩn" } as const;
export type MucNgoaiLeHienThi = keyof typeof NHAN_MUC_NGOAI_LE;

/** Tên bằng chữ thường ngày cho người vận hành (không để lộ mã kỹ thuật). Gồm cả loại của các lát sau để nhãn có sẵn khi scanner sinh ra chúng. */
export const NHAN_LOAI_NGOAI_LE: Record<string, string> = {
  NGHI_TRUNG: "Nghi thu trùng",
  TIEN_THUA: "Thu thừa so với phải thu",
  COC_CHUA_PHAN_LOAI: "Khoản thu trước (cọc) chưa phân loại",
  LOAI_KHOAN_MO_HO: "Chưa rõ khoản thu thuộc loại nào",
  HOAN_TIEN_SAU_XUAT: "Hoàn tiền sau khi đã xuất hoá đơn",
  PHAP_NHAN_KHAC_NOI_NHAN_TIEN: "Tiền nhận ở cơ sở khác với đơn",
  NGUON_MAT: "Khoản thu đã xuất hoá đơn nhưng nay không còn",
  LECH_SHADOW: "Hai cách tính của hệ thống lệch nhau",
  THIEU_NGUOI_MUA: "Thiếu thông tin người mua",
  THIEU_MAPPING_THUE: "Chưa có cách tính thuế cho khoản này",
  CHINH_SACH_THIEU_HOAC_CHONG: "Chính sách hoá đơn thiếu hoặc chồng nhau",
  KHONG_RO_QUA_HAN: "Nhà cung cấp chưa trả lời quá hạn",
  TU_CHOI_NHA_CUNG_CAP: "Nhà cung cấp từ chối hoá đơn",
  LOI_TEP_QUA_HAN: "Đã có số hoá đơn nhưng chưa lưu được tệp",
  LOI_KY: "Ký số hoá đơn bị lỗi",
  LECH_DAY_SO: "Lệch dãy số hoá đơn",
};

/** Việc cần làm, một hai câu — nói ĐƯỢC cái gì phải làm, không nói hệ thống đã hỏng ở đâu. */
export const GOI_Y_XU_LY: Record<string, string> = {
  NGHI_TRUNG: "Xem hai khoản thu có cùng nội dung chuyển khoản không. Nếu trùng, hoàn hoặc đảo một khoản trước khi xuất hoá đơn.",
  TIEN_THUA: "Đối chiếu số đã thu với phiếu thu. Phần dư cần hoàn lại hoặc gắn sang đợt khác trước khi xuất.",
  COC_CHUA_PHAN_LOAI: "Chờ chốt khoản này là cọc hay học phí trả trước. Chưa xuất hoá đơn cho tới khi có quyết định.",
  LOAI_KHOAN_MO_HO: "Gắn khoản thu về đúng dòng của đơn (học phí, học cụ, lệ phí thi…) rồi xử lý lại.",
  HOAN_TIEN_SAU_XUAT: "Hoá đơn khách đang giữ đã lệch số tiền thực thu. Điều chỉnh hoặc thay thế theo quy định, làm ở MISA, rồi ghi nhận lại.",
  PHAP_NHAN_KHAC_NOI_NHAN_TIEN: "Khoản thu ghi ở cơ sở khác cơ sở của đơn. Xác định pháp nhân thực nhận tiền trước khi xuất hoá đơn.",
  NGUON_MAT: "Khoản thu đã có hoá đơn nhưng bị từ chối hoặc xoá. Kiểm tra nguyên nhân; hoá đơn đã xuất có thể cần điều chỉnh.",
  LECH_SHADOW: "Báo kỹ thuật: cách tính mới và danh sách chờ hiện tại cho kết quả khác nhau. Chuyển quản trị kiểm tra; không ảnh hưởng hoá đơn đang làm.",
  THIEU_NGUOI_MUA: "Bổ sung thông tin người mua của đơn.",
  THIEU_MAPPING_THUE: "Khai cách tính thuế cho loại khoản này ở Cấu hình hoá đơn.",
  CHINH_SACH_THIEU_HOAC_CHONG: "Kiểm tra các phiên bản chính sách hoá đơn: không được hở hoặc chồng ngày hiệu lực.",
  KHONG_RO_QUA_HAN: "Kiểm tra lại trạng thái hoá đơn với nhà cung cấp.",
  TU_CHOI_NHA_CUNG_CAP: "Đọc lý do nhà cung cấp từ chối, sửa thông tin rồi phát hành lại.",
  LOI_TEP_QUA_HAN: "Hoá đơn đã được cấp số nhưng PDF / XML chưa lưu được sau nhiều lần thử. Hệ thống vẫn tự thử lại; nếu kéo dài, tải tệp từ cổng nhà cung cấp rồi báo quản trị.",
  LOI_KY: "Bước ký số bị lỗi hoặc bị từ chối. Xem lệnh ký của hoá đơn, kiểm tra chứng thư / thiết bị ký rồi tạo lệnh ký mới.",
  LECH_DAY_SO: "So số hoá đơn đã phát hành với dãy số đã khai.",
};

// ── MÁY TRẠNG THÁI ───────────────────────────────────────────────────────

export type KetQuaChuyen = { ok: true; den: TrangThaiNgoaiLe } | { ok: false; lyDo: string };

const DICH: Record<HanhDongNgoaiLe, { tu: readonly TrangThaiNgoaiLe[]; den: TrangThaiNgoaiLe }> = {
  NHAN_XU_LY: { tu: ["MO"], den: "DANG_XU_LY" },
  DA_XU_LY: { tu: ["MO", "DANG_XU_LY"], den: "DA_XU_LY" },
  BO_QUA: { tu: ["MO", "DANG_XU_LY"], den: "BO_QUA_CO_LY_DO" },
};

const LA_TRANG_THAI = (s: string): s is TrangThaiNgoaiLe => s in NHAN_TRANG_THAI_NGOAI_LE;

export function chuyenNgoaiLe(tu: string, hanhDong: HanhDongNgoaiLe): KetQuaChuyen {
  if (!LA_TRANG_THAI(tu)) return { ok: false, lyDo: "Trạng thái ngoại lệ không hợp lệ." };
  if (tu === "DA_XU_LY" || tu === "BO_QUA_CO_LY_DO") return { ok: false, lyDo: "Ngoại lệ này đã đóng — không còn thao tác nào." };
  const d = DICH[hanhDong];
  if (!d.tu.includes(tu)) {
    return { ok: false, lyDo: hanhDong === "NHAN_XU_LY" ? "Ngoại lệ này đã có người nhận xử lý." : "Không thể thực hiện thao tác này ở trạng thái hiện tại." };
  }
  return { ok: true, den: d.den };
}

/** Lý do bắt buộc cho "đã xử lý" và "bỏ qua" (≥ 10 ký tự sau khi cắt khoảng trắng); nhận xử lý thì không đòi. `null` = hợp lệ. */
export function kiemLyDoXuLy(hanhDong: HanhDongNgoaiLe, lyDo: string): string | null {
  if (hanhDong === "NHAN_XU_LY") return null;
  const t = lyDo.trim();
  if (t.length < TOI_THIEU_LY_DO_XU_LY) return `Ghi lý do ít nhất ${TOI_THIEU_LY_DO_XU_LY} ký tự (đang có ${t.length}).`;
  if (t.length > TOI_DA_LY_DO_XU_LY) return `Lý do tối đa ${TOI_DA_LY_DO_XU_LY} ký tự.`;
  return null;
}

// ── NÚT NÀO ĐƯỢC VẼ ──────────────────────────────────────────────────────

export type HanhDongChoPhep = { nhan: boolean; daXuLy: boolean; boQua: boolean; lyDoKhong: string | null };

/**
 * Nút nào được VẼ cho một ngoại lệ. CÙNG vị từ với action và dịch vụ: kế toán TẠI cơ sở của ngoại lệ (`coQuyenKeToanTaiCoSo`) ∧ chuyển hợp lệ theo máy trạng thái.
 * Ngoài phạm vi ⇒ không nút và có câu nói THẬT vì sao (không ẩn lặng lẽ).
 */
export function hanhDongNgoaiLeChoPhep(actor: ActionScopeActor, ngoaiLe: { trangThai: string; centerId: string | null }): HanhDongChoPhep {
  const khong: HanhDongChoPhep = { nhan: false, daXuLy: false, boQua: false, lyDoKhong: null };
  if (ngoaiLe.trangThai === "DA_XU_LY" || ngoaiLe.trangThai === "BO_QUA_CO_LY_DO") return khong;
  if (!coQuyenKeToanTaiCoSo(actor, ngoaiLe.centerId)) {
    return { ...khong, lyDoKhong: "Ngoại lệ thuộc cơ sở khác — chỉ kế toán cơ sở đó hoặc kế toán Hội sở xử lý." };
  }
  return {
    nhan: chuyenNgoaiLe(ngoaiLe.trangThai, "NHAN_XU_LY").ok,
    daXuLy: chuyenNgoaiLe(ngoaiLe.trangThai, "DA_XU_LY").ok,
    boQua: chuyenNgoaiLe(ngoaiLe.trangThai, "BO_QUA").ok,
    lyDoKhong: null,
  };
}

// ── BỘ LỌC TRÊN URL ──────────────────────────────────────────────────────

export type NhomNgoaiLe = "DANG_MO" | "DA_DONG";
export type LocNgoaiLe = { nhom: NhomNgoaiLe; muc: MucNgoaiLeHienThi | null; loai: string | null; trang: number };

/** Các khoá URL của khu ngoại lệ (tiền tố `nl` để không đụng `coSo`/`thang`/`ngan` của tab). */
export const KHOA_URL_NGOAI_LE = ["nlNhom", "nlMuc", "nlLoai", "nlTrang"] as const;

export const CO_TRANG_NGOAI_LE = 20;

const NHOM_TRANG_THAI: Record<NhomNgoaiLe, readonly TrangThaiNgoaiLe[]> = {
  DANG_MO: ["MO", "DANG_XU_LY"],
  DA_DONG: ["DA_XU_LY", "BO_QUA_CO_LY_DO"],
};
export const trangThaiCuaNhom = (n: NhomNgoaiLe): readonly TrangThaiNgoaiLe[] => NHOM_TRANG_THAI[n];

/** Đọc bộ lọc từ URL — giá trị lạ BỎ, mặc định an toàn là "đang mở" (việc cần làm), không bao giờ ném. */
export function locDanhSachNgoaiLe(sp: { nlNhom?: string; nlMuc?: string; nlLoai?: string; nlTrang?: string }): LocNgoaiLe {
  const nhom: NhomNgoaiLe = sp.nlNhom === "DA_DONG" ? "DA_DONG" : "DANG_MO";
  const muc = sp.nlMuc && sp.nlMuc in NHAN_MUC_NGOAI_LE ? (sp.nlMuc as MucNgoaiLeHienThi) : null;
  const loai = sp.nlLoai && Object.prototype.hasOwnProperty.call(NHAN_LOAI_NGOAI_LE, sp.nlLoai) ? sp.nlLoai : null;
  const n = Number.parseInt(sp.nlTrang ?? "", 10);
  return { nhom, muc, loai, trang: Number.isFinite(n) && n >= 1 && n <= 10_000 ? n : 1 };
}

const GOC_CANH_BAO = "/payments/hoa-don/canh-bao";

/**
 * Đường dẫn tab Cảnh báo với một số tham số khu ngoại lệ được đổi; MỌI tham số khác (`coSo` · `thang` · `ngan` · `chon` …) GIỮ NGUYÊN để đổi bộ lọc không làm mất
 * phạm vi người dùng đang xem (N41). Đổi bộ lọc (không phải trang) thì quay về trang 1. `null` = gỡ khoá; rỗng/undefined bị bỏ.
 */
export function hrefNgoaiLe(
  hienTai: Record<string, string | undefined>,
  doi: Partial<Record<(typeof KHOA_URL_NGOAI_LE)[number], string | null>>,
): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(hienTai)) if (v) p.set(k, v);
  const chiDoiTrang = Object.keys(doi).every((k) => k === "nlTrang");
  if (!chiDoiTrang) p.delete("nlTrang");
  for (const [k, v] of Object.entries(doi)) {
    if (v) p.set(k, v);
    else p.delete(k);
  }
  const q = p.toString();
  return q ? `${GOC_CANH_BAO}?${q}` : GOC_CANH_BAO;
}

/** `?coSo=` → cơ sở lọc. Ngoài phạm vi kế toán của người xem ⇒ `null` (không lọc) — CÙNG cách `docBoLoc` của màn xử lý; phạm vi thật vẫn do `docDanhSachNgoaiLe` ép. */
export function coSoHopLe(actor: ActionScopeActor, thu: string | null | undefined): string | null {
  const t = thu?.trim();
  if (!t) return null;
  const pham = phamViKeToan(actor);
  return pham === "ALL" || pham.includes(t) ? t : null;
}

const DINH_DANG_VN = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** `dd/MM/yyyy HH:mm` theo giờ Việt Nam (máy chủ có thể chạy múi giờ khác). */
export function dinhDangThoiDiemVN(d: Date): string {
  const p = Object.fromEntries(DINH_DANG_VN.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}
