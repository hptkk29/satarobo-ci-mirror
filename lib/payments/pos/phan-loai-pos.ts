// lib/payments/pos/phan-loai-pos.ts — Phân loại MỘT dòng giao dịch thẻ POS. THUẦN.
//
// Thứ tự luật là một phần của hợp đồng (docs/pos-the-smartpos.md "Luật khớp") — đổi thứ tự là
// đổi kết quả, ca `[POS-P07]` ghim:
//   1. Trạng thái ≠ "Thành công"            ⇒ BO_QUA
//   2. Loại ≠ "Thanh toán"                   ⇒ HUY (dòng hủy/hoàn; tầng nhập lô tự tìm gốc)
//   3. Hủy / hoàn TOÀN PHẦN (cột Hoàn/Hủy, hoặc một dòng hủy toàn phần trỏ tới) ⇒ BO_QUA
//   4. Số tiền ≤ 0                           ⇒ CAN_XU_LY, KHÔNG tạo BankTransaction
//   4b. Hoàn MỘT PHẦN / giá trị Hoàn/Hủy lạ   ⇒ CHAN_HOAN_MOT_PHAN (chủ dự án chốt Q-G 30/09/2026:
//       "Không dùng — chặn tự động"). Tầng nhập lô đưa giao dịch RA KHỎI hàng chờ (IGNORED) và
//       bật cảnh báo trên dòng gốc — KHÔNG ai gắn tay được SỐ GỘP: gắn tay buộc Σ = số của giao
//       dịch, mà số đó là số quẹt ban đầu, không phải số ròng còn giữ. Kế toán HO ghi số ròng
//       bằng luồng điều chỉnh. Bản 29/09 để giao dịch UNMATCHED "xử lý tay" ⇒ sổ ghi thừa đúng
//       số đã hoàn (ca `[POS-P03b]`, `[POS-DB-27..]`).
//   5. Thiết bị chưa gán cơ sở               ⇒ CAN_XU_LY, VẪN tạo BankTransaction (để gắn tay)
//   6. Mã phiếu: 0 hoặc ≥2 ⇒ CAN_XU_LY; đúng 1 ⇒ THU
//
// Hàm KHÔNG so số tiền với phiếu: "số phải thu" là việc của `thuTheoPhieuGop` (khớp đúng từng
// đồng). Ở đây chỉ quyết định dòng có ĐƯỢC ĐI khớp hay không.
import type { DongHuyPos, DongPos } from "./kieu";
import { tachMaPos } from "./tach-ma-pos";

export type PhanLoaiPos =
  | { loai: "BO_QUA"; lyDo: string }
  | { loai: "CAN_XU_LY"; lyDo: string; taoGiaoDich: boolean }
  | { loai: "CHAN_HOAN_MOT_PHAN"; lyDo: string }
  | { loai: "THU"; ma: string }
  | { loai: "HUY"; maGoc: string | null; toanPhan: boolean };

/**
 * Chuẩn hoá chữ tiếng Việt để SO SÁNH: NFC (Excel/ngân hàng có thể xuất NFD — "Thành công"
 * NFD ≠ NFC dù nhìn y hệt), gộp khoảng trắng, trim, chữ thường, và gộp hai cách bỏ dấu
 * "hủy"/"huỷ" (ủy ↔ uỷ). Chỉ dùng để so; giá trị in ra giữ nguyên bản gốc.
 */
function chuan(s: string | null): string {
  return (s ?? "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/uỷ/g, "ủy");
}

const THANH_CONG = chuan("Thành công");
const THANH_TOAN = chuan("Thanh toán");
const HUY = chuan("Hủy");
const TOAN_PHAN = chuan("toàn phần");
const MOT_PHAN = chuan("một phần");

/**
 * GĐ1 POS (06/10/2026) — "Trạng thái giao dịch" có phải "Thành công" không, bằng ĐÚNG phép chuẩn
 * hoá của luật 1 (NFC, gộp khoảng trắng, chữ thường). Provider đọc file (`provider/tcb-file.ts`)
 * dùng hàm này chứ không tự viết `chuan()` thứ hai — hai phép chuẩn hoá lệch nhau là một dòng
 * "Thành công" dạng NFD bị provider gọi là thất bại trong khi tầng nhập lô gọi là thu.
 */
export function laTrangThaiThanhCong(trangThai: string | null): boolean {
  return chuan(trangThai) === THANH_CONG;
}

/** GĐ1 POS — "Loại giao dịch" có phải "Thanh toán" không (luật 2), cùng phép chuẩn hoá. */
export function laLoaiThanhToan(loaiGiaoDich: string | null): boolean {
  return chuan(loaiGiaoDich) === THANH_TOAN;
}

/**
 * GĐ1 POS (T19) — mã lý do THẤT BẠI suy từ chữ trạng thái của file: bỏ dấu, IN HOA, mọi cụm không
 * phải chữ/số thành `_`. "Thất bại" ⇒ `THAT_BAI`. File không mang mã thẻ (05/51/USER_CANCELLED…) —
 * không bịa mã; bảng mã thẻ thật nằm ở `thong-diep-pos.ts`, chốt khi có API.
 */
export function maTrangThaiPos(trangThai: string | null): string {
  const ma = chuan(trangThai)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return ma || "KHONG_RO";
}

/**
 * Lý do BO_QUA của luật 3 (hủy/hoàn TOÀN PHẦN) — export để phiếu thu thẻ (GĐ1 POS) phân biệt "đã hủy
 * toàn bộ trên máy" với "giao dịch thất bại" (luật 1) mà không so chữ tự gõ.
 */
export const LY_DO_HUY_TOAN_PHAN = "Giao dịch đã bị hủy/hoàn";

/** Dòng hoàn một phần trỏ vào gốc KHÔNG có tiền chờ (luật 4: số tiền ≤ 0) — giữ như bản 29/09. */
export const LY_DO_HOAN_MOT_PHAN = "Hoàn một phần — xử lý tay";

/** Đuôi chung của mọi lý do CHẶN hoàn một phần — `loaiCanhBaoPos` nhận diện bằng nó. */
export const DUOI_CHAN_HOAN_MOT_PHAN = "Kế toán HO xử lý bằng luồng điều chỉnh, không gắn tay";
/** Lý do trên giao dịch gốc (`unmatchedNote`) + dòng POS gốc khi bị chặn vì hoàn một phần (Q-G). */
export const LY_DO_CHAN_HOAN_MOT_PHAN = `Hoàn một phần — ${DUOI_CHAN_HOAN_MOT_PHAN}`;
/** Lý do trên DÒNG hoàn một phần: việc nằm ở cảnh báo của gốc, không phải ở dòng này. */
export const LY_DO_HOAN_XEM_GOC = "Hoàn một phần — xem cảnh báo ở giao dịch gốc";

/**
 * Tín hiệu của cột `Trạng thái Hoàn/Hủy` trên MỘT dòng. "một phần" xét TRƯỚC: "Hủy một phần" là một
 * phần. TOÀN PHẦN chỉ khi chuỗi nói "toàn phần". Mọi giá trị khác (khác rỗng) ⇒ MOT_PHAN — Q-I theo
 * ĐÚNG CHỮ (chủ dự án xác nhận 30/09/2026), fail-closed: không biết giao dịch đã bị trừ bao nhiêu
 * thì không để ai gắn tay số gộp.
 *
 * Phép đo file thật 29/09: cột này chỉ mang "Hủy toàn phần" (trên dòng GỐC); dòng hủy mang loại
 * "Hủy" với cột TRỐNG. Chưa từng thấy giá trị trơn "Hủy" / "Hủy giao dịch" trong CỘT ⇒ đã bỏ tập
 * `HUY_TRON_DA_BIET` (bản rà vòng 3 coi hai chuỗi đó là toàn phần). Dòng loại "Hủy" cột trống vẫn
 * toàn phần khi |số tiền| = số gốc — vế đó ở `phanLoaiDongPos` + `laHuyToanPhanVoiGoc`.
 *
 * Mã TRƯỚC bản vá rà vòng 3: `includes("hủy") ⇒ TOAN_PHAN` — "Hủy thất bại", "Chờ hủy", "Yêu cầu
 * hủy", "Không hủy" đều ra toàn phần ⇒ BO_QUA im lặng / gỡ gắn đưa giao dịch ra IGNORED (fail-OPEN),
 * ca `[POS-P03e]` `[THG-11]`.
 */
export function tinHieuHoanHuy(trangThaiHoanHuy: string | null): "TRONG" | "TOAN_PHAN" | "MOT_PHAN" {
  const v = chuan(trangThaiHoanHuy);
  if (v === "") return "TRONG";
  if (v.includes(MOT_PHAN)) return "MOT_PHAN";
  return v.includes(TOAN_PHAN) ? "TOAN_PHAN" : "MOT_PHAN";
}

/**
 * Một dòng HỦY/HOÀN có thật là TOÀN PHẦN so với GỐC của nó không: phân loại nói toàn phần VÀ số
 * tiền (trị tuyệt đối) bằng ĐÚNG số gốc. Lệch một đồng ⇒ một phần (Q-G: "dòng loại Hủy/Hoàn có
 * số tiền ≠ −số gốc"). Mọi nơi quyết "toàn phần hay một phần" với một gốc đã biết số PHẢI đi qua
 * đây — `phanLoaiDongPos` không thấy gốc nên chỉ đọc chữ.
 */
export function laHuyToanPhanVoiGoc(
  p: Extract<PhanLoaiPos, { loai: "HUY" }>,
  soTienHuy: number,
  soTienGoc: number,
): boolean {
  return p.toanPhan && Math.abs(soTienHuy) === soTienGoc;
}

/**
 * Tín hiệu hủy/hoàn ĐÃ KẾT LUẬN trên chính một dòng THANH TOÁN đã lưu [rà đối kháng GĐ3 · 06/10/2026].
 * ĐƠN ĐIỆU khi nhập lại: một bản xuất CŨ hơn (cột Hoàn/Hủy còn trống, dòng Hủy chưa có) không xoá được
 * nó. Hai nguồn:
 *   · cột Hoàn/Hủy đã lưu (`tinHieuHoanHuy`);
 *   · lượt trước đã kết luận BO_QUA "đã bị hủy/hoàn" mà KHÔNG sinh giao dịch — kết luận đưa ra với tập hủy
 *     của CẢ FILE (dòng Hủy đi kèm qua `dongHuyCuaFile`, có thể chưa từng được lưu: lượt dừng trước lô
 *     cuối, nơi `catLoPos` xếp mọi dòng Hủy).
 * Dòng Hủy ĐÃ LƯU trỏ vào gốc là nguồn thứ ba — người gọi tự đọc (cần số gốc, `laHuyToanPhanVoiGoc`).
 *
 * Mã TRƯỚC bản vá: `nhapLoPos` phân loại lại dòng chưa khoá CHỈ bằng cột của FILE + tập hủy của lô ⇒ nhập
 * bản xuất cũ sau bản mới lật lần quẹt đã hủy thành THU và GHI TIỀN (ca `[POS3-DB-10]`, `[POS3-DB-10b]`).
 * Cùng vị từ với `provider/tcb-file.ts` (phiếu POS) — hai đường không được hiểu "đã hủy" khác nhau.
 */
export function huyDaKetLuanTrenDong(r: {
  trangThaiHoanHuy: string | null;
  matchStatus: string;
  matchReason: string | null;
  bankTransactionId: string | null;
}): "TRONG" | "TOAN_PHAN" | "MOT_PHAN" {
  const cot = tinHieuHoanHuy(r.trangThaiHoanHuy);
  if (cot !== "TRONG") return cot;
  return r.matchStatus === "BO_QUA" && r.bankTransactionId === null && r.matchReason === LY_DO_HUY_TOAN_PHAN
    ? "TOAN_PHAN"
    : "TRONG";
}

/**
 * Khu cảnh báo đỏ phân biệt hai loại theo LÝ DO trên dòng gốc: gốc bị chặn vì hoàn một phần
 * (chưa vào sổ, chờ điều chỉnh) ≠ hủy/hoàn sau khi tiền ĐÃ vào sổ.
 */
export type LoaiCanhBaoPos = "HOAN_MOT_PHAN" | "HUY_SAU_GHI_NHAN";

export function loaiCanhBaoPos(matchReason: string | null): LoaiCanhBaoPos {
  return (matchReason ?? "").includes(DUOI_CHAN_HOAN_MOT_PHAN) ? "HOAN_MOT_PHAN" : "HUY_SAU_GHI_NHAN";
}

/** Tiêu đề khu cảnh báo — đếm RIÊNG từng loại (khu thẻ POS + dải báo đầu trang dùng chung). */
export function tieuDeCanhBaoPos(canhBao: readonly { loai: LoaiCanhBaoPos }[]): string {
  const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);
  const soHuy = canhBao.filter((c) => c.loai === "HUY_SAU_GHI_NHAN").length;
  const soHoan = canhBao.length - soHuy;
  return [
    soHuy > 0 ? `${fmt(soHuy)} giao dịch thẻ bị hủy sau khi đã ghi nhận` : null,
    soHoan > 0 ? `${fmt(soHoan)} giao dịch thẻ hoàn một phần — đã chặn gắn tay` : null,
  ]
    .filter((x): x is string => x !== null)
    .join(" · ");
}

/**
 * `ctx.biHuyTrongLo`  — một dòng Hủy/Hoàn TOÀN PHẦN (đã qua chính hàm này, ra `HUY` +
 *                        `toanPhan`) trỏ tới dòng này.
 * `ctx.biHoanMotPhan` — một dòng Hoàn MỘT PHẦN trỏ tới dòng này.
 * Cả hai BẮT BUỘC (không mặc định): người gọi quên truyền thì `tsc` báo, thay vì dòng đi khớp
 * tiền theo số đã lệch.
 */
export function phanLoaiDongPos(
  d: DongPos,
  ctx: { thietBiDaGan: boolean; biHuyTrongLo: boolean; biHoanMotPhan: boolean },
): PhanLoaiPos {
  // (1)
  if (chuan(d.trangThai) !== THANH_CONG) {
    return { loai: "BO_QUA", lyDo: `Giao dịch ${d.trangThai.replace(/\s+/g, " ").trim()}` };
  }
  // (2)
  const loai = chuan(d.loaiGiaoDich);
  if (loai !== THANH_TOAN) {
    // Cột ghi "một phần" thắng loại "Hủy" (Q-G: "kể cả dòng loại Hủy mà cột ghi một phần").
    // Cột mang giá trị LẠ cũng vậy (Q-I, rà vòng 3 `[POS-P03e]`): loại "Hủy" chỉ toàn phần khi
    // cột TRỐNG hoặc nói toàn phần. Số tiền so với gốc là vế thứ hai — `laHuyToanPhanVoiGoc`.
    const cot = tinHieuHoanHuy(d.trangThaiHoanHuy);
    return {
      loai: "HUY",
      maGoc: d.maGiaoDichGoc?.trim() || null,
      toanPhan: cot === "TOAN_PHAN" || (cot === "TRONG" && loai === HUY),
    };
  }
  // (3) — "một phần" xét TRƯỚC chữ "hủy": "Hủy một phần" là một phần, rơi xuống 4b (xử lý
  // tay). Bản trước xét `includes(HUY)` trước ⇒ bỏ qua cả giao dịch, tiền ròng còn giữ rơi khỏi
  // mọi hàng chờ (ca `[POS-P03c]`).
  const tinHieu = tinHieuHoanHuy(d.trangThaiHoanHuy);
  if (tinHieu === "TOAN_PHAN" || ctx.biHuyTrongLo) {
    return { loai: "BO_QUA", lyDo: LY_DO_HUY_TOAN_PHAN };
  }
  // (4)
  if (d.soTien <= 0) {
    return { loai: "CAN_XU_LY", lyDo: "Số tiền không dương", taoGiaoDich: false };
  }
  // (4b) — Q-G: chặn, không để hàng chờ.
  if (tinHieu === "MOT_PHAN" || ctx.biHoanMotPhan) {
    const lyDo =
      ctx.biHoanMotPhan || chuan(d.trangThaiHoanHuy).includes(MOT_PHAN)
        ? LY_DO_CHAN_HOAN_MOT_PHAN
        : `Trạng thái Hoàn/Hủy "${(d.trangThaiHoanHuy ?? "").trim()}" — ${DUOI_CHAN_HOAN_MOT_PHAN}`;
    return { loai: "CHAN_HOAN_MOT_PHAN", lyDo };
  }
  // (5)
  if (!ctx.thietBiDaGan) {
    return { loai: "CAN_XU_LY", lyDo: "Thiết bị chưa gán cơ sở", taoGiaoDich: true };
  }
  // (6)
  const ma = tachMaPos(d.dienGiai);
  if (ma.length === 0) {
    return { loai: "CAN_XU_LY", lyDo: "Không có mã phiếu 5 ký tự trong ghi chú", taoGiaoDich: true };
  }
  if (ma.length >= 2) {
    return {
      loai: "CAN_XU_LY",
      lyDo: `Ghi chú có ${ma.length} mã phiếu: ${ma.join(", ")}`,
      taoGiaoDich: true,
    };
  }
  return { loai: "THU", ma: ma[0]! };
}

/**
 * VIỆC 3 (09/10/2026) — phân loại MỘT dòng khi sale đã XÁC NHẬN "đây là giao dịch của phiếu `ma`" (nhập sai mã trên máy).
 *
 * Chỉ MỘT luật bị thay: luật (6) "tách mã từ ghi chú" — vì ghi chú của giao dịch thẻ KHÔNG sửa được (máy, portal, file
 * xuất đều là bản ghi ngân hàng), nên mã đúng được lấy từ phiếu thay vì từ chữ gõ. Mọi luật còn lại chạy NGUYÊN:
 * trạng thái ≠ Thành công · hủy/hoàn toàn phần · số tiền ≤ 0 · hoàn một phần (Q-G) · thiết bị chưa gán cơ sở.
 *
 * Vì sao chỉ cần kiểm `CAN_XU_LY ∧ taoGiaoDich ∧ thietBiDaGan`: luật (4) trả `taoGiaoDich:false`, luật (5) trả khi
 * `!thietBiDaGan` ⇒ tổ hợp trên chỉ có thể sinh từ luật (6) (0 mã hoặc ≥ 2 mã). `THU(x)` (đúng một mã trong ghi chú — có
 * thể là mã của PHIẾU KHÁC) cũng bị thay bằng `THU(ma)`: người dùng đã quyết, tiền về đúng phiếu `ma`. `ma` KHÔNG
 * bao giờ do client gửi — chỉ `xuLyKetQuaPos` truyền xuống, và nó đòi `ma === code5` của phiếu (xem đó).
 */
export function phanLoaiDongPosXacNhan(
  d: DongPos,
  ctx: { thietBiDaGan: boolean; biHuyTrongLo: boolean; biHoanMotPhan: boolean },
  ma: string,
): PhanLoaiPos {
  const goc = phanLoaiDongPos(d, ctx);
  if (goc.loai === "THU") return { loai: "THU", ma };
  if (goc.loai === "CAN_XU_LY" && goc.taoGiaoDich && ctx.thietBiDaGan) return { loai: "THU", ma };
  return goc;
}

/** Ngữ cảnh phân loại một dòng HỦY — luật 1/2 không đọc máy hay tập hủy. */
export const CTX_XET_HUY = { thietBiDaGan: true, biHuyTrongLo: false, biHoanMotPhan: false } as const;

/**
 * Dựng lại `DongPos` từ bản TÓM của một dòng hủy (bản ghi đã lưu, hoặc dòng hủy màn import gửi
 * kèm) — chỉ để PHÂN LOẠI qua `phanLoaiDongPos` và xét lại. KHÔNG dùng để GHI cột gốc.
 */
export function dongTuBanGhi(r: DongHuyPos): DongPos {
  return {
    maGiaoDich: r.maGiaoDich,
    loaiGiaoDich: r.loaiGiaoDich,
    hinhThuc: "",
    trangThai: r.trangThai,
    soTien: r.soTien,
    thoiGian: "",
    dienGiai: "",
    maChuanChi: null,
    maGiaoDichThe: null,
    maGiaoDichGoc: r.maGiaoDichGoc,
    trangThaiHoanHuy: r.trangThaiHoanHuy,
    maDonHang: null,
    maQuay: null,
    maThietBi: null,
    soTheMasked: null,
    loaiThe: null,
    maHachToan: null,
    phiGiaoDich: null,
  };
}
