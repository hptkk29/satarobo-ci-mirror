// lib/pricing/de-xuat-doi-chuong-trinh.ts — SALE ĐỀ XUẤT THÊM / BỎ CHƯƠNG TRÌNH GIẢM SO VỚI GỢI Ý (D5). THUẦN: không DB, không đồng hồ.
//
// Chủ dự án chốt D5 (18/10/2026, bằng lời): Sale được ĐỀ XUẤT thêm hoặc bỏ ưu đãi do hệ thống gợi ý; BẮT BUỘC có lý do; CHỜ QLCS duyệt
// TRƯỚC khi áp dụng; kiểm quyền + phạm vi cơ sở ở giao diện lẫn máy chủ; ghi nhật ký người đề xuất · người duyệt · lý do · kết quả.
//
// ⛔ Tệp này KHÔNG quyết định hai việc mà chủ dự án CHƯA chốt:
//   · thành phần cùng văn bản có tính vào `orders.maxDiscountItems` không (D8);
//   · giá sau khi đề xuất được duyệt (trần 25%, vượt trần ⇒ Tổng Giám đốc — D3, đường duyệt TGĐ chưa có).
//   `tapMaSauDuyet` chỉ trả TẬP MÃ cuối cùng; việc ghi vào dòng đơn / tính lại tiền là bước nối (chưa làm, lưới `[DXC-PIN]`).
//
// Tệp này CHƯA được nối vào đâu.

import { createHash } from "node:crypto";
import { soSanhXacNhan, type KetQuaGoiY, type NguCanhGoiY } from "./goi-y-chuong-trinh";

/** Độ dài lý do tối thiểu — cùng ngưỡng với `kiemLyDoNhap` của hàng đợi quyền học và CHECK ở DB. */
export const LY_DO_TOI_THIEU = 10;

export type MaLoiDeXuat =
  | "LY_DO_NGAN"
  | "DE_XUAT_RONG"
  | "MA_LAP"
  | "VUA_THEM_VUA_BO"
  | "BO_MA_KHONG_CO_TRONG_GOI_Y"
  | "THEM_MA_DA_CO_TRONG_GOI_Y"
  | "THEM_MA_KHONG_DUNG_DUOC";

export interface DeXuatHopLe {
  readonly themVao: readonly string[];
  readonly boBot: readonly string[];
  readonly lyDo: string;
}

export type KetQuaKiemDeXuat = { readonly ok: true; readonly deXuat: DeXuatHopLe } | { readonly ok: false; readonly ma: MaLoiDeXuat; readonly chiTiet: readonly string[] };

const loi = (ma: MaLoiDeXuat, chiTiet: readonly string[] = []): KetQuaKiemDeXuat => ({ ok: false, ma, chiTiet });

const duyNhat = (xs: readonly string[]) => new Set(xs).size === xs.length;

/**
 * Kiểm một đề xuất THÊM / BỎ so với gợi ý HIỆN TẠI do máy chủ tính. Không tin client: `goiY` và `choPhepThem` đều do máy chủ dựng.
 *
 * @param choPhepThem các mã dùng được cho cơ sở/ngày này (còn hiệu lực, đúng cơ sở) mà KHÔNG nằm trong gợi ý. Mã ngoài tập này không thêm được.
 */
export function kiemDeXuat(vao: {
  readonly goiY: KetQuaGoiY;
  readonly themVao: readonly string[];
  readonly boBot: readonly string[];
  readonly lyDo: string;
  readonly choPhepThem: ReadonlySet<string>;
}): KetQuaKiemDeXuat {
  const lyDo = vao.lyDo.trim();
  if (lyDo.length < LY_DO_TOI_THIEU) return loi("LY_DO_NGAN");
  if (vao.themVao.length + vao.boBot.length === 0) return loi("DE_XUAT_RONG");
  if (!duyNhat(vao.themVao) || !duyNhat(vao.boBot)) return loi("MA_LAP");
  const giao = vao.themVao.filter((id) => vao.boBot.includes(id));
  if (giao.length > 0) return loi("VUA_THEM_VUA_BO", giao);

  const goiYIds = new Set(vao.goiY.thanhPhan.map((t) => t.id));
  const boLa = vao.boBot.filter((id) => !goiYIds.has(id));
  if (boLa.length > 0) return loi("BO_MA_KHONG_CO_TRONG_GOI_Y", boLa);
  const themTrung = vao.themVao.filter((id) => goiYIds.has(id));
  if (themTrung.length > 0) return loi("THEM_MA_DA_CO_TRONG_GOI_Y", themTrung);
  const themLa = vao.themVao.filter((id) => !vao.choPhepThem.has(id));
  if (themLa.length > 0) return loi("THEM_MA_KHONG_DUNG_DUOC", themLa);

  return { ok: true, deXuat: { themVao: [...vao.themVao].sort(), boBot: [...vao.boBot].sort(), lyDo } };
}

/**
 * Từ TẬP MÃ Sale chọn ở dòng "Giảm giá dòng này" suy ra đề xuất (thêm/bỏ so với gợi ý). Trùng khít gợi ý ⇒ `null` (không cần duyệt).
 * Gửi lặp một mã ⇒ lỗi `MA_LAP` (nếu không bắt, một mã có thể bị trừ hai lần).
 */
export function deXuatTuLuaChon(
  goiY: KetQuaGoiY,
  idDaChon: readonly string[],
  lyDo: string,
  choPhepThem: ReadonlySet<string>,
): KetQuaKiemDeXuat | null {
  const so = soSanhXacNhan(goiY, idDaChon);
  if (so.khop) return null;
  if (so.lap.length > 0) return loi("MA_LAP", so.lap);
  return kiemDeXuat({ goiY, themVao: so.themVao, boBot: so.boBot, lyDo, choPhepThem });
}

/** Tập mã CUỐI CÙNG nếu đề xuất được duyệt = (gợi ý − bỏ bớt) ∪ thêm vào. Không tính tiền (xem đầu tệp). */
export function tapMaSauDuyet(goiY: KetQuaGoiY, deXuat: Pick<DeXuatHopLe, "themVao" | "boBot">): readonly string[] {
  const bo = new Set(deXuat.boBot);
  return [...goiY.thanhPhan.map((t) => t.id).filter((id) => !bo.has(id)), ...deXuat.themVao].sort();
}

/**
 * Dấu vân tay của gợi ý — băm những gì quyết định SỐ TIỀN và CĂN CỨ: thành phần (mã · phiên bản văn bản · % · số tiền), niêm yết, số buổi,
 * thứ tự con / sản phẩm 48. Đổi chính sách hoặc thứ hạng gia đình giữa lúc đề xuất và lúc duyệt ⇒ dấu vân tay đổi ⇒ không duyệt được bản cũ.
 * Thứ tự phần tử không ảnh hưởng.
 */
export function dauVanGoiY(goiY: KetQuaGoiY, ctx: NguCanhGoiY): string {
  const thanhPhan = [...goiY.thanhPhan]
    .map((t) => [t.id, t.phienBan, t.phanTram, t.soTien] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const noiDung = JSON.stringify({
    v: 1,
    niemYet: goiY.niemYet,
    giamGia: goiY.giamGia,
    thanhTien: goiY.thanhTien,
    tran: goiY.tranTong,
    soBuoi: ctx.soBuoi,
    thuTuCon: ctx.thuTuCon,
    thuTuSanPham48: ctx.thuTuSanPham48,
    thanhPhan,
  });
  return createHash("sha256").update(noiDung).digest("hex");
}

// ─── Quyết định trên một đề xuất ─────────────────────────────────────────────────────────────────────────────────────
export type TrangThaiDeXuat = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
export type HanhDongDeXuat = "DUYET" | "TU_CHOI" | "HUY";

export type MaLoiQuyetDinh = "LY_DO_NGAN" | "GOI_Y_DA_DOI" | "CHI_NGUOI_DE_XUAT_MOI_HUY_DUOC";

export type KetQuaQuyetDinh =
  | { readonly ok: true; readonly trangThaiMoi: Exclude<TrangThaiDeXuat, "PENDING">; readonly tuQuyet: boolean }
  | { readonly ok: false; readonly ma: MaLoiQuyetDinh }
  /** Đề xuất không còn chờ — bấm lại KHÔNG đổi gì, KHÔNG ghi nhật ký thêm. */
  | { readonly ok: "KHONG_DOI"; readonly trangThai: Exclude<TrangThaiDeXuat, "PENDING"> };

/**
 * Máy trạng thái: PENDING → APPROVED | REJECTED | CANCELLED, rồi dừng. Thuần; không biết quyền (quyền kiểm ở dịch vụ, có cơ sở).
 *
 * - DUYỆT chỉ khi dấu vân tay gợi ý HIỆN TẠI còn bằng dấu vân tay lúc đề xuất — nếu không, người duyệt đang ký một bản diff đã cũ.
 * - TỪ CHỐI cần lý do ≥ `LY_DO_TOI_THIEU` ký tự.
 * - HUỶ chỉ người đề xuất làm được.
 * - `tuQuyet` = người quyết cũng là người đề xuất. Chưa có quy tắc (câu hỏi mở §12.4) nên KHÔNG chặn, chỉ ghi vào nhật ký để soát.
 */
export function xetQuyetDinh(vao: {
  readonly trangThai: TrangThaiDeXuat;
  readonly hanhDong: HanhDongDeXuat;
  readonly dauVanLuc: string;
  readonly dauVanHienTai: string;
  readonly nguoiDeXuat: string;
  readonly nguoiQuyet: string;
  readonly lyDo: string | null;
}): KetQuaQuyetDinh {
  if (vao.trangThai !== "PENDING") return { ok: "KHONG_DOI", trangThai: vao.trangThai };
  const tuQuyet = vao.nguoiQuyet === vao.nguoiDeXuat;
  switch (vao.hanhDong) {
    case "DUYET":
      if (vao.dauVanLuc !== vao.dauVanHienTai) return { ok: false, ma: "GOI_Y_DA_DOI" };
      return { ok: true, trangThaiMoi: "APPROVED", tuQuyet };
    case "TU_CHOI":
      if ((vao.lyDo ?? "").trim().length < LY_DO_TOI_THIEU) return { ok: false, ma: "LY_DO_NGAN" };
      return { ok: true, trangThaiMoi: "REJECTED", tuQuyet };
    case "HUY":
      if (!tuQuyet) return { ok: false, ma: "CHI_NGUOI_DE_XUAT_MOI_HUY_DUOC" };
      return { ok: true, trangThaiMoi: "CANCELLED", tuQuyet };
  }
}
