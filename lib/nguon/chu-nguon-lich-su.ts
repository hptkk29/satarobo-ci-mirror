/**
 * lib/nguon/chu-nguon-lich-su.ts — CHỦ NGUỒN THEO LỊCH SỬ: ai là chủ của một nguồn VÀO MỘT NGÀY. THUẦN — không DB, không đồng hồ.
 *
 * ── Vì sao (hướng B+C, chủ dự án 10/10/2026) ───────────────────────────────────────────────────────────────
 * Chủ nguồn từng chỉ nằm ở bản chụp `LeadAttribution.signals.nguon.chuNhanVienId` (lúc ghi nhận) và ở dòng nguồn SỐNG. Đổi chủ A → B không có MỐC NGÀY nên không
 * nói được "giao dịch này thuộc chủ nào". Nay `LeadSourceOwnerPeriod` ghi: từ ngày nào ai là chủ. Engine hỏi hàm này bằng NGÀY SỰ KIỆN của giao dịch:
 *
 *   ngày sự kiện = NGÀY THU ĐẦU của lần mua (`ngayThuDau` của dòng đơn). Mọi đợt trả góp của MỘT lần mua dùng chung ngày ấy ⇒ không bao giờ chia hai người
 *   (giữ ý quyết định 09/10 res4-1) — nhưng chủ mới CHỈ áp cho lần mua có ngày thu đầu SAU mốc hiệu lực.
 *
 * ── Thứ tự quyết (MỘT chỗ) ──────────────────────────────────────────────────────────────────────────────────
 *   1. Có khoảng lịch sử PHỦ ngày sự kiện (`effectiveFrom ≤ d < effectiveTo|∞`)       → chủ của khoảng ấy (kể cả `null` = khoảng "không có chủ"). Nguồn "LICH_SU".
 *      Đây là cách lead ghi nhận lúc nguồn CHƯA có chủ vẫn được trả khi sự kiện rơi vào khoảng đã có chủ (hết "treo vĩnh viễn").
 *   2. Không khoảng nào phủ và nguồn CHƯA CÓ lịch sử nào                                 → đường cũ có kiểm soát (bản chụp / nguồn sống), y như trước đợt này.
 *   3. Không khoảng nào phủ, nguồn có lịch sử, ngày TRƯỚC khoảng đầu tiên                → bản chụp `signals.nguon` nếu có (HOP_LE / HONG như cũ);
 *      riêng hàng CHƯA CÓ bản chụp (đọc sống): "nguồn sống ĐÓNG BĂNG ở chủ khởi tạo" — khoảng đầu là KHOI_TAO ⇒ chủ của nó, ngược lại ⇒ không có chủ.
 *      KHÔNG BAO GIỜ đọc nguồn sống của HÔM NAY ở nhánh này: nguồn đã đổi chủ thì "sống" = chủ mới = hồi tố đúng thứ phải chặn.
 *   4. Không khoảng nào phủ, ngày SAU khoảng cuối đã đóng (lỗ hổng dữ liệu)             → không có chủ (fail-closed, hold `NGUON_CHUA_CO_NGUOI_PHU_TRACH`).
 *
 * `signals.chuNhanVienId` thành LEGACY: chỉ còn tác dụng ở nhánh 2 và 3. Hàm `chupNguon()` (nguon-chup.ts) vẫn ghi nó lúc ghi nhận — đừng đổi chữ ký.
 */
import { nguonHieuLucChoEngine } from "./nguon-chup";

export type KhoangChu = {
  id: string;
  ownerEmployeeId: string | null;
  kind: "KHOI_TAO" | "DOI_CHU";
  effectiveFrom: Date;
  /** `null` = đang mở. */
  effectiveTo: Date | null;
};

export type GocChuNguon =
  | "LICH_SU"
  | "LICH_SU_KHOI_TAO"
  | "BAN_CHUP"
  | "NGUON_SONG"
  | "BAN_CHUP_HONG"
  /** Có lịch sử nhưng ngày rơi vào lỗ hổng — không có chủ. */
  | "LICH_SU_LO_HONG";

export type ChuNguonTaiNgay = {
  chuNhanVienId: string | null;
  cuaSoRiengNgay: number | null;
  goc: GocChuNguon;
  khoangId: string | null;
};

const truoc = (a: Date, b: Date) => a.getTime() < b.getTime();

/** Khoảng phủ ngày `d`: `effectiveFrom ≤ d` và (`effectiveTo` rỗng hoặc `d < effectiveTo`). Khoảng không chồng nhau (trigger DB) nên tối đa một. */
export function khoangPhuNgay(lichSu: readonly KhoangChu[], d: Date): KhoangChu | null {
  return lichSu.find((k) => !truoc(d, k.effectiveFrom) && (k.effectiveTo === null || truoc(d, k.effectiveTo))) ?? null;
}

export function chonChuNguonTaiNgay(i: {
  lichSu: readonly KhoangChu[];
  /** BẮT BUỘC (luật 7): ngày sự kiện = ngày thu đầu của lần mua. Không có mặc định "hôm nay". */
  ngaySuKien: Date;
  signals: unknown;
  song: { cuaSoRiengNgay: number | null; chuNhanVienId: string | null };
}): ChuNguonTaiNgay {
  const lichSu = [...i.lichSu].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
  const cu = nguonHieuLucChoEngine(i.signals, i.song);

  const phu = khoangPhuNgay(lichSu, i.ngaySuKien);
  if (phu) return { chuNhanVienId: phu.ownerEmployeeId, cuaSoRiengNgay: cu.cuaSoRiengNgay, goc: "LICH_SU", khoangId: phu.id };

  if (lichSu.length === 0) return { chuNhanVienId: cu.chuNhanVienId, cuaSoRiengNgay: cu.cuaSoRiengNgay, goc: cu.nguonGoc, khoangId: null };

  const dau = lichSu[0]!;
  if (truoc(i.ngaySuKien, dau.effectiveFrom)) {
    if (cu.nguonGoc === "NGUON_SONG") {
      // Hàng chưa có bản chụp: đóng băng ở chủ khởi tạo — KHÔNG đọc nguồn sống của hôm nay.
      return { chuNhanVienId: dau.kind === "KHOI_TAO" ? dau.ownerEmployeeId : null, cuaSoRiengNgay: cu.cuaSoRiengNgay, goc: "LICH_SU_KHOI_TAO", khoangId: dau.kind === "KHOI_TAO" ? dau.id : null };
    }
    return { chuNhanVienId: cu.chuNhanVienId, cuaSoRiengNgay: cu.cuaSoRiengNgay, goc: cu.nguonGoc, khoangId: null };
  }
  return { chuNhanVienId: null, cuaSoRiengNgay: cu.cuaSoRiengNgay, goc: "LICH_SU_LO_HONG", khoangId: null };
}

/**
 * Chủ ĐANG HIỆU LỰC tại `now` và thay đổi chủ ĐÃ HẸN (khoảng bắt đầu SAU `now`) — để màn hình không gọi cột `LeadSourceGroup.ownerEmployeeId` là "người phụ trách hiện tại".
 * Cột ấy đổi NGAY lúc lưu (nó là ý định mới nhất của biểu mẫu, và là thứ người đọc cột thấy — vd. "nguồn có chủ hay chưa"), còn tiền đi theo LỊCH SỬ: giữa lúc lưu và ngày hiệu lực,
 * cột nói B nhưng engine vẫn trả A. THUẦN — `now` BẮT BUỘC (luật 19).
 */
export function chuTaiThoiDiem(lichSu: readonly KhoangChu[], now: Date): { dangHieuLuc: KhoangChu | null; henGio: KhoangChu | null } {
  const xep = [...lichSu].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
  return { dangHieuLuc: khoangPhuNgay(xep, now), henGio: xep.find((k) => k.effectiveFrom.getTime() > now.getTime()) ?? null };
}

// ── Đặt chủ mới: kiểm mốc hiệu lực ───────────────────────────────────────────────────────────

export type LoiMocHieuLuc = "LUI_NGAY" | "KHONG_SAU_KHOANG_TRUOC" | "DA_CO_THAY_DOI_HEN_GIO";

/**
 * Mốc hiệu lực của lần đổi chủ phải: (1) không sớm hơn `now` — KHÔNG LÙI NGÀY, đổi chủ hôm nay không viết lại ngày hôm qua; (2) sau mốc bắt đầu của khoảng đang mở;
 * (3) không có một thay đổi nào đã được hẹn giờ ở tương lai (khoảng đã đóng không sửa lại được — trigger DB — nên chỉ cho MỘT thay đổi chờ tại một thời điểm).
 */
export function kiemMocHieuLuc(i: { lichSu: readonly KhoangChu[]; hieuLucTu: Date; now: Date }): LoiMocHieuLuc | null {
  if (truoc(i.hieuLucTu, i.now)) return "LUI_NGAY";
  if (i.lichSu.some((k) => k.effectiveFrom.getTime() > i.now.getTime())) return "DA_CO_THAY_DOI_HEN_GIO";
  const mo = i.lichSu.find((k) => k.effectiveTo === null);
  if (mo && !truoc(mo.effectiveFrom, i.hieuLucTu)) return "KHONG_SAU_KHOANG_TRUOC";
  return null;
}

const KHUON_NGAY = /^\d{4}-\d{2}-\d{2}$/;
const ngayVNCua = (d: Date): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/**
 * Ô «ngày hiệu lực» của biểu mẫu là NGÀY (giờ Việt Nam, `YYYY-MM-DD`). Quy về mốc thời gian:
 *   · đúng NGÀY HÔM NAY ⇒ TỪ LÚC LƯU (`now`) — không phải 00:00 sáng nay: 00:00 sáng nay là quá khứ và sẽ viết lại các khoản đã thu từ sáng;
 *   · ngày sau hôm nay ⇒ 00:00 giờ VN của ngày đó;
 *   · ngày trước hôm nay ⇒ 00:00 giờ VN của ngày đó (quá khứ) — để `kiemMocHieuLuc` từ chối bằng câu "không lùi ngày", thay vì lặng lẽ sửa thành hôm nay.
 * Chuỗi sai dạng ⇒ `null`. `now` BẮT BUỘC (luật 19).
 */
export function mocHieuLucTuNgayVN(ngay: string, now: Date): Date | null {
  if (!KHUON_NGAY.test(ngay)) return null;
  const nua = new Date(`${ngay}T00:00:00+07:00`);
  if (Number.isNaN(nua.getTime())) return null;
  return ngay === ngayVNCua(now) ? now : nua;
}

export const CAU_LOI_MOC_HIEU_LUC: Readonly<Record<LoiMocHieuLuc, string>> = {
  LUI_NGAY: "Ngày hiệu lực không được sớm hơn thời điểm ghi — đổi chủ nguồn không viết lại được lịch sử tiền đã tính.",
  KHONG_SAU_KHOANG_TRUOC: "Ngày hiệu lực phải sau ngày bắt đầu của chủ nguồn hiện tại.",
  DA_CO_THAY_DOI_HEN_GIO: "Nguồn này đang có một thay đổi chủ đã hẹn ngày hiệu lực. Chờ thay đổi đó có hiệu lực trước khi hẹn thay đổi khác.",
};
