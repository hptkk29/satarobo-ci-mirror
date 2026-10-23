// lib/khuyen-mai/ap-vao-don.ts — "mã khuyến mãi nào dùng được cho DÒNG này, và trừ bao nhiêu".
// THUẦN: không DB, không mạng, không `server-only`.
//
// ── VÌ SAO PHẢI THUẦN ────────────────────────────────────────────────────────────────
// Form tạo đơn (client) và `createOrderManualAction` (server) phải ra CÙNG một con số.
// Hai bản cài đặt là hai con số, và con số sale đọc trên màn hình sẽ khác con số vào sổ.
// Cùng lý do `lib/orders/giam-gia-dong.ts` thuần.
//
// ── RANH GIỚI VỚI `gopGiamGia` — ĐỪNG NHẬP NHẰNG ─────────────────────────────────────
// File này KHÔNG cộng tiền. Nó chỉ trả lời hai câu, rồi giao lại:
//   1. mã này có DÙNG ĐƯỢC cho dòng này không  → `maDungDuocChoDong`
//   2. mã này biến thành KHOẢN GIẢM nào        → `khaiGiamTuMa`
// Phép cộng dồn + kẹp vào phần còn lại của dòng vẫn hoàn toàn nằm ở `gopGiamGia`
// (`lib/orders/giam-gia-dong.ts`), và đó vẫn là chỗ DUY NHẤT quyết định một đồng nào.
//
// Nếu không giữ ranh giới này thì sẽ có hai đường tính tiền giảm: một cho khoản gõ tay,
// một cho khoản theo mã — và chúng sẽ lệch nhau ở ca biên (nhiều khoản trên một dòng,
// tổng vượt tạm tính) đúng lúc không ai để ý.
//
// ── HIỆU LỰC: GỌI `hieu-luc.ts`, KHÔNG CHÉP LẠI ──────────────────────────────────────
// CLAUDE.md (mục docs/khuyen-mai) cấm viết lại điều kiện hiệu lực ở chỗ gọi, "kể cả khi
// nối voucher vào thanh toán" — đây chính là lúc đó. Ba nơi tự viết điều kiện là ba câu
// trả lời khác nhau cho cùng một chính sách.
import { dangHieuLuc, apDungTrongPhamVi, type HieuLucVao } from "./hieu-luc";
import {
  KIEU_GIAM,
  discountFromPercent,
  type KhaiGiam,
} from "@/lib/orders/giam-gia-dong";

/**
 * Một mã khuyến mãi ở dạng form/action dùng được — đã gộp sẵn phần cần của `Voucher` và
 * của `PromotionPolicy` cha.
 *
 * ⚠️ `coSo` là **MÃ** OrgUnit, KHÔNG phải id. `PromotionPolicy.orgUnitIds` lưu id, nên
 * người nạp dữ liệu (`chon-cho-don.ts`) phải đổi id→mã TRƯỚC khi dựng kiểu này — và phải
 * fail-closed: chính sách có khai cơ sở mà không mã nào còn trên cây thì LOẠI, không được
 * coi là "toàn hệ thống" (đó là mở rộng phạm vi BLĐ không ban hành).
 */
export type MaApDung = {
  voucherId: string;
  /** `Voucher.code` — thứ sale đọc. */
  ma: string;
  /** `PromotionPolicy.documentCode`. */
  maVanBan: string;
  tenChuongTrinh: string;
  kieu: "PERCENT" | "FIXED";
  /** 1–100 khi `PERCENT`. */
  phanTram: number | null;
  /** VND khi `FIXED`. */
  soTien: number | null;
  /** `Voucher.maxDiscount` — TRẦN TIỀN khi giảm theo %. */
  giamToiDa: number | null;
  /** `Voucher.minOrderValue` — SÀN tạm tính của dòng. */
  donToiThieu: number;
  /** `PromotionPolicy.courseIds`. RỖNG = mọi khoá. */
  khoaHoc: readonly string[];
  /** MÃ OrgUnit (xem cảnh báo trên). RỖNG = toàn hệ thống. */
  coSo: readonly string[];
  /** Ngày hiệu lực của VĂN BẢN — `dangHieuLuc` đọc. */
  hieuLuc: HieuLucVao;
  /** `Voucher.isActive`. */
  dangBat: boolean;
  /** Còn lượt dùng: `quantity == null` (không giới hạn) hoặc `usedCount < quantity`. */
  conLuot: boolean;
};

/** Bối cảnh của DÒNG đang hỏi. */
export type BoiCanhDong = {
  /** `Course.id` của dòng. `null` = dòng không phải khoá học (sản phẩm, lệ phí thi…). */
  courseId: string | null;
  /** MÃ OrgUnit của cơ sở đơn. Rỗng = chưa biết cơ sở. */
  phamViCoSo: readonly string[];
  /** Ngày xét, "YYYY-MM-DD" giờ VN. */
  ngay: string;
  /** `unitPrice * quantity` của dòng — để xét `donToiThieu`. */
  tamTinhDong: number;
};

/**
 * Chính sách áp cho khoá này không. RỖNG = mọi khoá.
 *
 * ⚠️ `courseId = null` (dòng không phải khoá học) CHỈ khớp chính sách "mọi khoá". Chính
 * sách khai đích danh vài khoá thì không thể áp cho một dòng không có khoá nào — đoán
 * ngược lại là phát ưu đãi cho thứ BLĐ không ban hành cho.
 */
export function apDungChoKhoa(
  khoaHoc: readonly string[],
  courseId: string | null,
): boolean {
  if (khoaHoc.length === 0) return true;
  if (!courseId) return false;
  return khoaHoc.includes(courseId);
}

/** Vì sao một mã KHÔNG dùng được — để nói thật trên màn thay vì lặng lẽ giấu mã đi. */
export type LyDoLoai =
  | "tat"
  | "het_luot"
  | "ngoai_hieu_luc"
  | "ngoai_co_so"
  | "ngoai_khoa"
  | "duoi_san_don";

/**
 * `null` = dùng được. Ngược lại trả LÝ DO đầu tiên gặp.
 *
 * Thứ tự xét là thứ tự "chắc chắn nhất trước": trạng thái của chính mã → hiệu lực văn bản
 * → phạm vi → tiền. Nhờ vậy câu báo cho sale luôn là nguyên nhân GỐC, không phải triệu
 * chứng — mã đã tắt thì báo "đã tắt", đừng báo "đơn chưa đủ 3 triệu".
 */
export function lyDoKhongDung(m: MaApDung, ctx: BoiCanhDong): LyDoLoai | null {
  if (!m.dangBat) return "tat";
  if (!m.conLuot) return "het_luot";
  if (!dangHieuLuc(m.hieuLuc, ctx.ngay)) return "ngoai_hieu_luc";
  if (!apDungTrongPhamVi(m.coSo, ctx.phamViCoSo)) return "ngoai_co_so";
  if (!apDungChoKhoa(m.khoaHoc, ctx.courseId)) return "ngoai_khoa";
  if (ctx.tamTinhDong < m.donToiThieu) return "duoi_san_don";
  return null;
}

export function maDungDuocChoDong(m: MaApDung, ctx: BoiCanhDong): boolean {
  return lyDoKhongDung(m, ctx) === null;
}

/** Những mã bày ra trong bộ chọn của MỘT dòng. Giữ nguyên thứ tự đầu vào. */
export function locMaChoDong(
  ds: readonly MaApDung[],
  ctx: BoiCanhDong,
): MaApDung[] {
  return ds.filter((m) => maDungDuocChoDong(m, ctx));
}

/**
 * SỐ TIỀN mã này trừ trên một dòng có tạm tính `tamTinhDong` — CHƯA kẹp theo các khoản
 * khác của dòng (việc đó là của `gopGiamGia`).
 *
 * `PERCENT` → `%` của tạm tính, rồi kẹp xuống `giamToiDa` nếu có.
 * `FIXED`   → đúng số tiền, kẹp trong `[0, tamTinhDong]`.
 */
export function tienGiamCuaMa(m: MaApDung, tamTinhDong: number): number {
  const goc = Math.max(0, Math.round(tamTinhDong));
  if (m.kieu === "FIXED") return Math.min(goc, Math.max(0, Math.round(m.soTien ?? 0)));
  const theoPhanTram = discountFromPercent(goc, m.phanTram ?? 0);
  return m.giamToiDa != null ? Math.min(theoPhanTram, Math.max(0, m.giamToiDa)) : theoPhanTram;
}

/**
 * Mã → một `KhaiGiam` để `gopGiamGia` xử lý như mọi khoản khác.
 *
 * ⚠️ GIỮ NGUYÊN `kieu` CỦA MÃ, đừng quy hết về `SO_TIEN`. Quy về số tiền thì gọn hơn
 * (trần `giamToiDa` tính sẵn được, không cần trường mới) nhưng mất HAI thứ:
 *   · cờ `vuotTran` không bao giờ bật ⇒ một chương trình khai 60% sẽ lặng lẽ đi vòng qua
 *     tham số vận hành `orders.maxDiscountPercent`. Trần đó tồn tại để chặn nhầm lẫn, và
 *     một đường ghi không đi qua nó là một đường ghi không ai canh;
 *   · `OrderItem.discountPercent` mất nghĩa — hoá đơn và báo cáo đang đọc cột đó.
 * Nên trần TIỀN đi bằng `tranTien` và `gopGiamGia` tự kẹp.
 *
 * `lyDo` sinh tự động: cột `discountReason` được hoá đơn + nhật ký đọc, và với khoản theo
 * chương trình thì câu đúng là MÃ VĂN BẢN — sale không phải gõ lại, và không gõ sai được.
 */
export function khaiGiamTuMa(m: MaApDung): KhaiGiam {
  const laPhanTram = m.kieu === "PERCENT";
  return {
    kieu: laPhanTram ? KIEU_GIAM.PHAN_TRAM : KIEU_GIAM.SO_TIEN,
    giaTri: laPhanTram ? (m.phanTram ?? 0) : (m.soTien ?? 0),
    // Trần tiền CHỈ có nghĩa với khoản %; với FIXED thì `giaTri` đã là số cuối.
    tranTien: laPhanTram ? m.giamToiDa : null,
    lyDo: lyDoTuMa(m),
    loai: null,
    voucherId: m.voucherId,
  };
}

/** Câu giải trình tự sinh cho một khoản theo chương trình. */
export function lyDoTuMa(m: MaApDung): string {
  return `${m.maVanBan} · ${m.ma} — ${m.tenChuongTrinh}`;
}

/** Nhãn ngắn của mức ưu đãi: "giảm 15%", "giảm 10% (tối đa 800.000đ)", "giảm 500.000đ". */
export function nhanMucUuDai(m: MaApDung): string {
  if (m.kieu === "FIXED") return `giảm ${(m.soTien ?? 0).toLocaleString("vi-VN")}đ`;
  const tran = m.giamToiDa != null ? ` (tối đa ${m.giamToiDa.toLocaleString("vi-VN")}đ)` : "";
  return `giảm ${m.phanTram ?? 0}%${tran}`;
}

export const NHAN_LY_DO_LOAI: Record<LyDoLoai, string> = {
  tat: "Mã đã tắt",
  het_luot: "Mã đã hết lượt dùng",
  ngoai_hieu_luc: "Ngoài thời gian hiệu lực",
  ngoai_co_so: "Không áp dụng cho cơ sở của đơn",
  ngoai_khoa: "Không áp dụng cho khoá học của dòng này",
  duoi_san_don: "Dòng chưa đạt mức tối thiểu của chương trình",
};
