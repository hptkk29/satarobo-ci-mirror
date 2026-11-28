import { tinhHanMoi, type KyHan } from "./thoi-han";

/**
 * E-LEARNING ONLINE — LUẬT QUYỀN HỌC (entitlement), hàm THUẦN (V7 §11–§13, ADR 0005).
 *
 * MỘT dòng quyền cho MỖI (học viên × khoá), tồn tại suốt đời cặp đó: mua lại / gia hạn / mở lại sau thu hồi đều ghi lên CHÍNH dòng này
 * (nên tiến độ và điểm giữ nguyên, và "một con không có hai quyền đang hoạt động" đúng TUYỆT ĐỐI — là khoá duy nhất, không phải kiểm tra ứng dụng).
 * Lịch sử nằm ở bảng sự kiện (mỗi lần cấp/gia hạn/thu hồi một dòng, khoá idempotency duy nhất).
 *
 * Trạng thái LƯU: `ACTIVE` | `REVOKED`. HẾT HẠN KHÔNG được lưu — suy từ `hetHan` so với `now` (không cron nào ghi quyền; luật nền #8).
 */

export type TrangThaiLuu = "ACTIVE" | "REVOKED";
export type QuyenHienCo = { trangThai: TrangThaiLuu; hetHan: Date | null; anchorDay: number };
export type LoaiCap = "MUA" | "CAP_MIEN_PHI" | "GIA_HAN";
export type TrangThaiHieuLuc = "CON_HAN" | "SAP_HET_HAN" | "HET_HAN" | "THU_HOI";

/** Ngưỡng nhãn "Sắp hết hạn" (ngày). Chỉ là nhãn hiển thị, KHÔNG ảnh hưởng quyền truy cập. */
export const NGAY_SAP_HET_HAN = 30;
const MS_NGAY = 24 * 60 * 60 * 1000;

export function trangThaiHieuLuc(q: Pick<QuyenHienCo, "trangThai" | "hetHan">, now: Date): TrangThaiHieuLuc {
  if (q.trangThai === "REVOKED") return "THU_HOI";
  if (q.hetHan === null) return "CON_HAN";
  const conLai = q.hetHan.getTime() - now.getTime();
  if (conLai <= 0) return "HET_HAN";
  return conLai <= NGAY_SAP_HET_HAN * MS_NGAY ? "SAP_HET_HAN" : "CON_HAN";
}

export const coQuyenHocLucNay = (q: Pick<QuyenHienCo, "trangThai" | "hetHan"> | null | undefined, now: Date): boolean =>
  !!q && (trangThaiHieuLuc(q, now) === "CON_HAN" || trangThaiHieuLuc(q, now) === "SAP_HET_HAN");

export type MaLoiCap = "DA_TRON_DOI" | "KHOA_KHONG_CHO_GIA_HAN" | "CHUA_CO_QUYEN_DE_GIA_HAN" | "KY_HAN_THIEU";
export type HanhDongCap = "TAO_MOI" | "GIA_HAN" | "MO_LAI_SAU_HET_HAN" | "MO_LAI_SAU_THU_HOI";

export type KetQuaCap =
  | { ok: true; hanhDong: HanhDongCap; hetHan: Date | null; anchorDay: number; thangDaCong: number | null }
  | { ok: false; ma: MaLoiCap; thongBao: string };

/**
 * Quyết định một lần cấp/mua/gia hạn. KHÔNG ghi gì — trả về hành động và hạn mới để lớp DB ghi trong MỘT giao dịch.
 *
 * - `MUA` (đơn hàng) và `CAP_MIEN_PHI` (quản trị): có quyền còn hạn ⇒ gia hạn (MUA chỉ khi khoá cho phép `choPhepGiaHan`; quản trị luôn được).
 * - `GIA_HAN` rõ ràng: bắt buộc đã có dòng quyền.
 * - Đang TRỌN ĐỜI (còn hiệu lực) ⇒ từ chối mua/cấp trùng (`DA_TRON_DOI`).
 * - Đã hết hạn / đã thu hồi ⇒ mở lại TỪ MỐC `now` (không cộng bù), giữ dòng quyền.
 */
export function quyetDinhCap(input: {
  now: Date;
  loai: LoaiCap;
  quyen: QuyenHienCo | null;
  ky: KyHan | null | undefined;
  /** Khoá cho phép phụ huynh gia hạn khi còn hạn (`OnlineCourse.renewalEnabled`). Chỉ áp cho `MUA`. */
  choPhepGiaHan: boolean;
}): KetQuaCap {
  const { now, loai, quyen } = input;
  if (!input.ky) return { ok: false, ma: "KY_HAN_THIEU", thongBao: "Khoá chưa cấu hình kỳ hạn học" };
  const ky = input.ky;

  if (loai === "GIA_HAN" && !quyen) return { ok: false, ma: "CHUA_CO_QUYEN_DE_GIA_HAN", thongBao: "Học viên chưa có quyền học khoá này để gia hạn" };

  if (!quyen) {
    const t = tinhHanMoi({ ky, now });
    return { ok: true, hanhDong: "TAO_MOI", hetHan: t.hetHan, anchorDay: t.anchorDay, thangDaCong: ky.loai === "THANG" ? ky.soThang : null };
  }

  const hieuLuc = trangThaiHieuLuc(quyen, now);
  if (hieuLuc === "THU_HOI" || hieuLuc === "HET_HAN") {
    const t = tinhHanMoi({ ky, now }); // mốc `now`: không dùng hạn cũ, không dùng neo cũ
    // Gia hạn rõ ràng cho quyền đã hết/thu hồi vẫn là MỞ LẠI từ `now` — gọi đúng tên để lịch sử không nói dối.
    return { ok: true, hanhDong: hieuLuc === "THU_HOI" ? "MO_LAI_SAU_THU_HOI" : "MO_LAI_SAU_HET_HAN", hetHan: t.hetHan, anchorDay: t.anchorDay, thangDaCong: ky.loai === "THANG" ? ky.soThang : null };
  }

  // Còn hiệu lực (CON_HAN / SAP_HET_HAN)
  if (quyen.hetHan === null) {
    return { ok: false, ma: "DA_TRON_DOI", thongBao: "Học viên đã có quyền học trọn đời khoá này — không mua/cấp trùng" };
  }
  if (loai === "MUA" && !input.choPhepGiaHan) {
    return { ok: false, ma: "KHOA_KHONG_CHO_GIA_HAN", thongBao: "Khoá không cho gia hạn khi còn hạn" };
  }
  if (ky.loai === "TRON_DOI") {
    // Nâng từ có hạn lên trọn đời: hợp lệ (mua/cấp trọn đời) — hạn thành null, ghi nhận là GIA_HAN.
    return { ok: true, hanhDong: "GIA_HAN", hetHan: null, anchorDay: quyen.anchorDay, thangDaCong: null };
  }
  const t = tinhHanMoi({ ky, now, hanHienTai: quyen.hetHan, anchorDay: quyen.anchorDay });
  return { ok: true, hanhDong: "GIA_HAN", hetHan: t.hetHan, anchorDay: t.anchorDay, thangDaCong: ky.soThang };
}

export type KetQuaThuHoi = { ok: true } | { ok: false; ma: "CHUA_CO_QUYEN" | "DA_THU_HOI"; thongBao: string };

/** Thu hồi: chỉ khi có dòng quyền và CHƯA thu hồi. Hết hạn rồi vẫn thu hồi được (quản trị dọn dòng) — nó chỉ đổi trạng thái lưu. */
export function quyetDinhThuHoi(quyen: Pick<QuyenHienCo, "trangThai"> | null): KetQuaThuHoi {
  if (!quyen) return { ok: false, ma: "CHUA_CO_QUYEN", thongBao: "Học viên chưa có quyền học khoá này" };
  if (quyen.trangThai === "REVOKED") return { ok: false, ma: "DA_THU_HOI", thongBao: "Quyền học đã bị thu hồi trước đó" };
  return { ok: true };
}

// ───────── Cổng truy cập nội dung (MỘT hàm cho mọi đầu ra nội dung) ─────────

export type MaTuChoiTruyCap = "KHONG_CO_QUYEN" | "DA_THU_HOI" | "HET_HAN" | "DA_HOAN_THANH_KHONG_XEM_LAI";
export type KetQuaTruyCap = { ok: true } | { ok: false; ma: MaTuChoiTruyCap };

/**
 * CỔNG DUY NHẤT trước khi trả nội dung (bài, video, tài liệu) cho học viên — API, trang học và vé media đều PHẢI đi qua hàm này.
 * `chinhSachKhongXemLai`: cài đặt học tập của BẢN ĐANG ÁP DỤNG cho người này. `baiDaHoanThanh`: bài này người này đã hoàn thành.
 * Vẫn LƯU điểm/tiến độ/lịch sử — chỉ chặn MỞ LẠI nội dung bài.
 */
export function kiemTraTruyCapNoiDung(input: {
  now: Date;
  quyen: Pick<QuyenHienCo, "trangThai" | "hetHan"> | null | undefined;
  chinhSachKhongXemLai: boolean;
  baiDaHoanThanh: boolean;
}): KetQuaTruyCap {
  if (!input.quyen) return { ok: false, ma: "KHONG_CO_QUYEN" };
  const t = trangThaiHieuLuc(input.quyen, input.now);
  if (t === "THU_HOI") return { ok: false, ma: "DA_THU_HOI" };
  if (t === "HET_HAN") return { ok: false, ma: "HET_HAN" };
  if (input.chinhSachKhongXemLai && input.baiDaHoanThanh) return { ok: false, ma: "DA_HOAN_THANH_KHONG_XEM_LAI" };
  return { ok: true };
}

/**
 * Xem trước một lần GIA HẠN cho hộp thoại (QoGiaHan): "hạn mới" tính bằng ĐÚNG `quyetDinhCap` — không công thức thứ hai.
 * `soThangCong`: số tháng cộng thêm (null = trọn đời). Lỗi ⇒ `{ ok:false, thongBao }` để hộp thoại nói thẳng thay vì hứa một hạn sai.
 */
export function xemTruocGiaHan(input: { now: Date; quyen: QuyenHienCo; ky: KyHan | null | undefined }): { ok: true; hetHan: Date | null; soThangCong: number | null; hanhDong: HanhDongCap } | { ok: false; thongBao: string } {
  const r = quyetDinhCap({ now: input.now, loai: "GIA_HAN", quyen: input.quyen, ky: input.ky, choPhepGiaHan: true });
  return r.ok ? { ok: true, hetHan: r.hetHan, soThangCong: r.thangDaCong, hanhDong: r.hanhDong } : { ok: false, thongBao: r.thongBao };
}
