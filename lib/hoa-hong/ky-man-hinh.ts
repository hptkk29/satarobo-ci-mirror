// lib/hoa-hong/ky-man-hinh.ts — LUẬT THUẦN của màn "Kỳ hoa hồng" (06 §5.4): nút nào VẼ, nút nào KHÔNG VẼ và vì sao, câu nêu từng loại
// hàng chờ chặn khoá, tháng đang chọn. Không DB, không đồng hồ (luật 19).
//
// ── MỘT NGUỒN CHO "NÚT NÀY CÓ HỢP LỆ KHÔNG" (luật 12b) ───────────────────────────────────────────────────────────────────
// Mỗi nút vòng đời được quyết bằng CHÍNH `kiemChuyenTrangThaiKy` — hàm cổng mà service gọi lúc ghi. Không có bản chép điều kiện ở đây:
// cổng đổi thì nút đổi theo, và lý do hiện cho người dùng là câu của chính cổng (cộng phần nêu từng loại hàng chờ). Ca `[NHH-KY-UI-08]`
// duyệt toàn bộ tổ hợp và buộc hai bên đồng ý.
//
// ── Vì sao không có nút "override" ───────────────────────────────────────────────────────────────────────────────────────
// 04 §12.1: khoá kỳ chỉ có hai cổng (a) hàng chờ chặn (b) đầu vào trôi. Khiếu nại mở và vai "treo" KHÔNG chặn. Không có cách nào "khoá bất chấp"
// — thiếu dữ liệu thì phải xử lý, không phải bỏ qua cổng. Lối ra DUY NHẤT ngoài "xử lý" là "dời sang kỳ sau" (đổi `blockingPeriodId`): nút ở DÒNG HÀNG CHỜ của tab Sổ, chỉ cho
// hai mã cứng chờ văn bản/người quyết (`MA_DOI_DUOC_SANG_KY_SAU`, hang-cho-so-nhom.ts) và chỉ khi người xem giữ `commission_periods:manage`. Màn Kỳ chỉ nhắc tới nó khi nút có thật (ViecDangDo.doiDuoc).
import { ngayVN } from "./ngay-lam-viec";
import { hangChoChanKy, type MaHold } from "./hang-cho";
import { congThang, kiemChuyenTrangThaiKy, laThangHopLe, type TrangThaiKy } from "./ky-hoa-hong";

// ── Trạng thái kỳ ───────────────────────────────────────────────────────────────────────────────────

export const NHAN_TRANG_THAI_KY: Record<TrangThaiKy, string> = {
  OPEN: "Đang mở",
  CALCULATED: "Đã tính",
  REVIEWING: "Đang rà soát",
  LOCKED: "Đã khoá",
  EXPORTED: "Đã xuất",
  PAID: "Đã chi",
};

export type ToneKy = "info" | "warning" | "success" | "muted";

/** Tiền đã khoá/đã chi = success; chờ người rà = warning; còn đang tính = info (06 §0). Màu thương hiệu không mang nghĩa trạng thái. */
export const TONE_TRANG_THAI_KY: Record<TrangThaiKy, ToneKy> = {
  OPEN: "info",
  CALCULATED: "info",
  REVIEWING: "warning",
  LOCKED: "success",
  EXPORTED: "success",
  PAID: "success",
};

// ── Hàng chờ chặn: nêu TỪNG LOẠI ─────────────────────────────────────────────────────────────────────

/**
 * Cụm danh từ đứng sau "N khoản". Hai mã cùng nghĩa dùng chung một cụm để gom làm một mục. `Record<MaHold, …>`: thêm mã vào enum mà quên
 * ở đây là lỗi biên dịch, không phải một dòng "undefined khoản …" trên màn của kế toán.
 */
const CUM_CHAN: Record<MaHold, string> = {
  CHUA_GAN_CON: "chưa nối học viên",
  CHO_HOC_VIEN: "chưa nối học viên",
  CAP_EXCEEDED: "vượt trần",
  POLICY_OVERLAP: "chính sách chồng nhau",
  MANUAL_REVIEW_REQUIRED: "chờ duyệt tay",
  PENDING_REGULATION: "chờ văn bản",
  INTERNAL_TRANSFER: "chuyển tiền giữa hai bé chưa xử lý",
  NEGATIVE_WITHOUT_ORIGIN: "hoàn tiền không có khoản gốc",
  INPUT_DRIFT: "có đầu vào đã đổi",
  NO_ORG_UNIT: "chưa quy được cơ sở",
  PAYMENT_WITHDRAWN: "đã bị rút lại sau khi tính",
  NEGATIVE_BALANCE: "sổ âm kết chuyển",
  UNRESOLVED_BENEFICIARY: "chưa có người nhận",
};

/** Thứ tự cố định để hai tổ hợp cùng số lượng luôn ra cùng một câu (không phụ thuộc thứ tự bản ghi từ DB). */
const THU_TU_MA: readonly MaHold[] = Object.keys(CUM_CHAN) as MaHold[];

export type MucChan = { nhan: string; soLuong: number; ma: MaHold[] };

/** Gom số lượng theo mã thành các mục CHẶN KHOÁ. Mã không chặn (vai treo, sổ âm) và số ≤ 0 bị loại. */
export function gomChan(theoMa: Partial<Record<MaHold, number>>): MucChan[] {
  const gop = new Map<string, MucChan>();
  for (const ma of THU_TU_MA) {
    const n = theoMa[ma] ?? 0;
    if (n <= 0 || !hangChoChanKy(ma)) continue;
    const nhan = CUM_CHAN[ma];
    const cu = gop.get(nhan);
    if (cu) {
      cu.soLuong += n;
      cu.ma.push(ma);
    } else gop.set(nhan, { nhan, soLuong: n, ma: [ma] });
  }
  // `sort` ổn định: cùng số lượng thì giữ thứ tự chèn (= thứ tự cố định ở trên).
  return [...gop.values()].sort((a, b) => b.soLuong - a.soLuong);
}

/** "3 khoản chờ duyệt tay · 2 khoản vượt trần". Rỗng khi không có gì chặn. */
export function cauChanKhoa(muc: readonly MucChan[]): string {
  return muc.map((m) => `${m.soLuong} khoản ${m.nhan}`).join(" · ");
}

/** Nhãn cho phần "không chặn" (thông tin): cụm danh từ của mã. */
export function cumKhongChan(ma: MaHold): string {
  return CUM_CHAN[ma];
}

// ── Hành động theo vòng đời ──────────────────────────────────────────────────────────────────────────

export type HanhDongKy =
  | "TINH"
  | "TINH_LAI"
  | "CHUYEN_RA_SOAT"
  | "TRA_LAI"
  | "KHOA"
  | "XUAT_BANG_CHI"
  | "XUAT_QUYET_TOAN"
  | "DANH_DAU_DA_CHI";

export const NHAN_HANH_DONG: Record<HanhDongKy, string> = {
  TINH: "Tính",
  TINH_LAI: "Tính lại",
  CHUYEN_RA_SOAT: "Chuyển rà soát",
  TRA_LAI: "Trả lại để tính lại",
  KHOA: "Khoá kỳ",
  XUAT_BANG_CHI: "Xuất bảng chi",
  XUAT_QUYET_TOAN: "Xuất quyết toán người ngoài",
  DANH_DAU_DA_CHI: "Đánh dấu đã chi",
};

/** Kỳ chưa mở thì "Tính" thật ra là mở kỳ rồi Tính (lượt Tính đầu tạo kỳ — 04 §12.1): nói đúng việc sắp xảy ra. */
export function nhanHanhDong(a: HanhDongKy, trangThai: TrangThaiKy | null): string {
  return a === "TINH" && trangThai === null ? "Mở kỳ và Tính" : NHAN_HANH_DONG[a];
}

export type DauVaoHanhDong = {
  /** `null` = kỳ (tháng × cơ sở) này chưa có trong DB. */
  trangThai: TrangThaiKy | null;
  /** Kỳ < mốc cutover: engine mới không tính/ghi, kỳ chỉ đọc ở `/crm/commission`. */
  truocMoc: boolean;
  /** `commission_periods:manage` — ĐÚNG key mà Server Action kiểm (luật 12). */
  coQuyenQuanLy: boolean;
  /** Số hàng chờ ĐANG MỞ có `blockingPeriodId` = kỳ này (cùng phép đếm với cổng khoá). */
  soChan: number;
  lastCalculatedAt: Date | null;
  /** Mốc thời gian MỚI NHẤT của mọi đầu vào thuộc tập Q (`dauVaoMoiNhat` của service). */
  dauVaoMoiNhat: Date | null;
  /** Câu nêu từng loại hàng chờ chặn (`cauChanKhoa`), null khi không có. */
  cauChan: string | null;
  /** "31/10/2026" — ngày của lần Tính cuối, để lý do nói được *đổi sau lần Tính nào*. */
  ngayTinhCuoi: string | null;
  /** `hoaHong.xuatLuongBat`. */
  xuatLuongBat: boolean;
  /** Dòng đã DUYỆT CHI (APPROVED) nhưng chưa vào lô nào, trong các kỳ đã khoá của tháng thuộc phạm vi người xem. */
  chuaXuat: { noiBo: number; ngoai: number };
  /** Số lô đã xuất đang CHỜ đánh dấu đã chi. */
  soLoChoChi: number;
};

export type KhongVe = { hanhDong: HanhDongKy | "TAT_CA"; lyDo: string };
export type QuyetDinhHanhDong = {
  /** Nút của bước kế tiếp — duy nhất một, hoặc không có (đang chờ việc ở nơi khác). */
  chinh: HanhDongKy | null;
  /** Nút phụ hợp lệ, KHÔNG phải nút chính. */
  phu: HanhDongKy[];
  /** Nút CHƯA hợp lệ — không vẽ, chỉ in lý do. */
  khongVe: KhongVe[];
};

const goiKy = (tu: TrangThaiKy, den: TrangThaiKy, i: DauVaoHanhDong, soChan: number) =>
  kiemChuyenTrangThaiKy({ tu, den, soHangChoChan: soChan, lastCalculatedAt: i.lastCalculatedAt, dauVaoMoiNhat: i.dauVaoMoiNhat });

/** Đầu vào có đổi sau lần Tính không — hỏi CỔNG (đặt `soHangChoChan: 0` để tách riêng vế (b)). */
function troiDauVao(i: DauVaoHanhDong): boolean {
  return goiKy("REVIEWING", "LOCKED", i, 0) !== null;
}

const lyDoTroi = (i: DauVaoHanhDong, viec: string) =>
  i.lastCalculatedAt === null
    ? `Kỳ chưa được Tính — bấm Tính trước khi ${viec}.`
    : `Dữ liệu đầu vào đã đổi sau lần Tính${i.ngayTinhCuoi ? ` ${i.ngayTinhCuoi}` : ""} — Tính lại trước khi ${viec}.`;

export function hanhDongCuaKy(i: DauVaoHanhDong): QuyetDinhHanhDong {
  const ra: QuyetDinhHanhDong = { chinh: null, phu: [], khongVe: [] };

  if (i.truocMoc) {
    ra.khongVe.push({ hanhDong: "TAT_CA", lyDo: "Kỳ này thuộc sổ cũ — chỉ xem, tính và khoá ở /crm/commission." });
    return ra;
  }
  if (!i.coQuyenQuanLy) {
    ra.khongVe.push({ hanhDong: "TAT_CA", lyDo: "Bạn chỉ có quyền xem kỳ này. Tính, rà soát, khoá và xuất bảng chi cần quyền commission_periods:manage." });
    return ra;
  }

  const tt = i.trangThai;

  // ── Chưa mở / OPEN / CALCULATED: Tính ───────────────────────────────────────────────
  if (tt === null || tt === "OPEN") {
    ra.chinh = "TINH";
    ra.khongVe.push({ hanhDong: "CHUYEN_RA_SOAT", lyDo: "Kỳ chưa được Tính — bấm Tính trước." });
    return ra;
  }

  if (tt === "CALCULATED") {
    const chan = goiKy("CALCULATED", "REVIEWING", i, 0);
    if (chan === null) {
      ra.chinh = "CHUYEN_RA_SOAT";
      ra.phu.push("TINH_LAI");
    } else {
      ra.chinh = "TINH_LAI";
      ra.khongVe.push({ hanhDong: "CHUYEN_RA_SOAT", lyDo: lyDoTroi(i, "chuyển rà soát") });
    }
    ra.khongVe.push({ hanhDong: "KHOA", lyDo: "Phải chuyển rà soát trước khi khoá." });
    return ra;
  }

  // ── REVIEWING: Khoá, hoặc Trả lại ───────────────────────────────────────────────────
  if (tt === "REVIEWING") {
    if (goiKy("REVIEWING", "CALCULATED", i, 0) === null) ra.phu.push("TRA_LAI");
    const chanKhoa = goiKy("REVIEWING", "LOCKED", i, i.soChan);
    if (chanKhoa === null) {
      ra.chinh = "KHOA";
      return ra;
    }
    const lyDo: string[] = [];
    const troi = troiDauVao(i);
    if (troi) lyDo.push(`${lyDoTroi(i, "khoá")} Dùng “Trả lại để tính lại” rồi Tính lại.`);
    if (i.soChan > 0) {
      lyDo.push(`Còn ${i.cauChan ?? `${i.soChan} hàng chờ đang chặn`}. Xử lý xong mới khoá được.`);
    }
    // Cổng từ chối vì lý do nào khác (không phải hai vế trên) ⇒ nêu thẳng câu của cổng, không nuốt.
    if (lyDo.length === 0) lyDo.push(chanKhoa);
    ra.khongVe.push({ hanhDong: "KHOA", lyDo: lyDo.join(" ") });
    // Trôi ⇒ đường đi duy nhất là Trả lại (rồi Tính lại): đó là bước kế tiếp. Chỉ vướng hàng chờ ⇒ việc nằm ở nơi khác, không có nút chính.
    if (troi && ra.phu.includes("TRA_LAI")) {
      ra.chinh = "TRA_LAI";
      ra.phu = ra.phu.filter((a) => a !== "TRA_LAI");
    }
    return ra;
  }

  // ── LOCKED / EXPORTED / PAID: chi trả ───────────────────────────────────────────────
  if (tt === "PAID") return ra;

  if (!i.xuatLuongBat) {
    ra.khongVe.push({
      hanhDong: tt === "LOCKED" ? "XUAT_BANG_CHI" : "DANH_DAU_DA_CHI",
      lyDo: "Xuất bảng chi đang tắt — kỳ dừng ở “đã khoá” cho tới khi quản trị hệ thống bật mục “Cho xuất bảng chi hoa hồng” ở Cấu hình vận hành.",
    });
    return ra;
  }

  if (tt === "LOCKED") {
    // Một kỳ khoá luôn xuất được (kể cả khi 0 dòng: lượt xuất là thứ đưa kỳ sang EXPORTED).
    ra.chinh = "XUAT_BANG_CHI";
    if (i.chuaXuat.ngoai > 0) ra.phu.push("XUAT_QUYET_TOAN");
    return ra;
  }

  // EXPORTED: còn lô chờ chi ⇒ đánh dấu đã chi là nút chính; còn dòng chưa vào lô (kỳ vào EXPORTED khi lô ĐẦU TIÊN xuất) ⇒ xuất tiếp là nút phụ.
  const conXuat: HanhDongKy[] = [];
  if (i.chuaXuat.noiBo > 0) conXuat.push("XUAT_BANG_CHI");
  if (i.chuaXuat.ngoai > 0) conXuat.push("XUAT_QUYET_TOAN");
  if (i.soLoChoChi > 0 && goiKy("EXPORTED", "PAID", i, 0) === null) {
    ra.chinh = "DANH_DAU_DA_CHI";
    ra.phu.push(...conXuat);
  } else if (conXuat.length > 0) {
    ra.chinh = conXuat[0]!;
    ra.phu.push(...conXuat.slice(1));
  }
  return ra;
}

// ── Số liệu và xác nhận khoá ───────────────────────────────────────────────────────────────────────

export type SoLieuKy = {
  coSoTinh: number;
  hoaHong: number;
  dieuChinh: number;
  soNguoi: number;
  /** ISO — lần Tính cuối; đổi ⇒ số có thể đã khác dù tổng vẫn như cũ. */
  lastCalculatedAt: string | null;
};

/** Hai bản chụp số liệu có là MỘT không. Hộp thoại khoá gửi bản chụp đã hiện; server chụp lại và so — không khớp ⇒ từ chối. */
export function soLieuKhop(a: SoLieuKy, b: SoLieuKy): boolean {
  return (
    a.coSoTinh === b.coSoTinh &&
    a.hoaHong === b.hoaHong &&
    a.dieuChinh === b.dieuChinh &&
    a.soNguoi === b.soNguoi &&
    a.lastCalculatedAt === b.lastCalculatedAt
  );
}

/** Loại dòng GHI MỚI (hoa hồng) và loại dòng ĐIỀU CHỈNH (hoàn tiền, đổi nguồn, đầu vào, khiếu nại). Cộng hai nhóm = số phải chi ròng. */
export const LOAI_DONG_GHI_MOI = ["ORIGINAL", "LATE_ARRIVAL", "PERIOD_BONUS"] as const;
export const LOAI_DONG_DIEU_CHINH = ["REVERSAL", "SOURCE_CORRECTION", "INPUT_CORRECTION", "DISPUTE_ADJUSTMENT", "LEGACY_REVERSAL"] as const;

// ── Tháng ───────────────────────────────────────────────────────────────────────────────────────────

/** Tháng VN hiện tại của một thời điểm, "YYYY-MM". */
export function thangVN(now: Date): string {
  return ngayVN(now).slice(0, 7);
}

/** Tháng màn mở ra khi chưa chọn: tháng hiện tại (giờ VN), nhưng không sớm hơn mốc cutover (kỳ cũ không có gì để làm ở đây). */
export function thangMacDinhCuaMan(p: { now: Date; kyCutover: string | null }): string {
  const nay = thangVN(p.now);
  return p.kyCutover !== null && p.kyCutover > nay ? p.kyCutover : nay;
}

/** `?thang=` hợp lệ thì dùng; rác ⇒ mặc định (không ném, không đoán). */
export function docThangTuUrl(raw: string | null, macDinh: string): string {
  return raw !== null && laThangHopLe(raw) ? raw : macDinh;
}

export const thangKeTiep = (t: string): string => congThang(t, 1);
export const thangTruoc = (t: string): string => congThang(t, -1);

/** "2026-10" → "10/2026". */
export function nhanThangKy(t: string): string {
  const [n, th] = t.split("-");
  return `${th}/${n}`;
}

/** Kỳ thuộc sổ MỚI (≥ mốc)? Chưa có mốc ⇒ không kỳ nào thuộc sổ mới. */
export function kyTrongPhamViTinh(thang: string, kyCutover: string | null): boolean {
  return kyCutover !== null && thang >= kyCutover;
}

// ── Định dạng ───────────────────────────────────────────────────────────────────────────────────────

/** "31/10" — ngày VN, không năm, cho ô bảng hẹp (ngày đủ nằm ở `title`). */
export function ngayNganVN(d: Date): string {
  const [, th, ng] = ngayVN(d).split("-");
  return `${ng}/${th}`;
}
