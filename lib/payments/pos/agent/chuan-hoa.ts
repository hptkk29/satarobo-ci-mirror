// lib/payments/pos/agent/chuan-hoa.ts — CHUẨN HOÁ một dòng giao dịch agent về ĐÚNG khuôn dòng của import file
// (`DongPos`, nhãn TIẾNG VIỆT của file) — GĐ4 POS. THUẦN. Thiết kế: docs/pos-gd4-thiet-ke.md §5.2, §5.5.
//
// Vì sao về khuôn FILE (T1): agent và file nói về CÙNG một giao dịch (khoá `transaction_id` = "Mã giao dịch")
// ⇒ PHẢI hội tụ vào CÙNG một `PosCardTransaction` qua CHÍNH `nhapLoPos` — một chuẩn hoá, một `phanLoaiDongPos`,
// một luật hủy/hoàn. Bảng / luật riêng cho agent = viết lại luật hủy/hoàn lần hai.
//
// FAIL-CLOSED cả hai chiều (T7, T8): không chắc thì KHÔNG tự thu (tiền lệch ⇒ từ chối dòng; file import là
// đường dự phòng) và KHÔNG mời quẹt lại (trạng thái lẫn lộn / lạ ⇒ giữ MÃ = "treo", câu ĐỪNG quẹt lại).
import { gioVN } from "@/lib/format/thoi-gian-vn";
import { dongPosSchema, type DongPos } from "../kieu";
import { bamDienGiai, jsonSapKhoa, sha256Hex, type DongDaChuanHoa } from "./bam";
import { chuanMa, phanGiaiMay, type MayPos } from "./may";
import { TRAN_DONG_AGENT, type KhoaDongAgent } from "./hop-dong";
import type { DongAgentTho } from "./schema";

export type MaTuChoi =
  | "MERCHANT_MISMATCH"
  | "BAD_TRANSACTION_ID"
  | "BAD_TIME"
  | "TYPE_MISSING"
  | "STATUS_MISSING"
  | "AMOUNT_MISSING"
  | "AMOUNT_NOT_INTEGER"
  | "AMOUNT_MISMATCH"
  | "CURRENCY_UNSUPPORTED"
  /** Chốt hợp đồng 1.1: một trường vượt trần §6.1 (`field` = tên khoá) — trước bản 1.1 là 400 CẢ LÔ. */
  | "FIELD_TOO_LONG";

/** Ảnh chụp của dòng BỊ TỪ CHỐI cho bảng nguồn (GĐ6) — những gì đọc được, không ghi chú, không số thẻ. */
export type AnhTuChoi = {
  bam: string;
  loaiGiaoDich: string | null;
  trangThai: string | null;
  soTien: number | null;
  thoiGian: Date | null;
  bamDienGiai: string | null;
  maQuay: string | null;
  maThietBi: string | null;
  centerIdMay: string | null;
};

export type KetQuaChuanHoa =
  | { loai: "NHAN"; dong: DongDaChuanHoa; may: MayPos | null }
  | {
      loai: "TU_CHOI";
      code: MaTuChoi;
      /** T29: MERCHANT_MISMATCH / BAD_TRANSACTION_ID ⇒ KHÔNG lưu gì; còn lại lưu DẤU (T30). */
      luuDau: boolean;
      maGiaoDich: string | null;
      anh: AnhTuChoi | null;
      /** Chỉ với `FIELD_TOO_LONG`: khoá §6.1 ĐẦU TIÊN vượt trần (API `rejected[].field`). */
      field?: KhoaDongAgent;
    };

const RE_MA_GD = /^[0-9A-Za-z]{8,64}$/;
/**
 * Trần cột số tiền INT4 (`PosTxnSource.soTien`, `PosCardTransaction.soTien`). Rà đối kháng RV-02: ảnh của dòng BỊ
 * TỪ CHỐI mang số ≥ 2^31 làm phép ghi dấu nguồn ném ConversionError ⇒ cả lô 500 SAU khi đã ghi tiền dòng khác.
 */
const INT4_MAX = 2_147_483_647;
const RE_MA_LY_DO = /^[A-Z][A-Z0-9_]{2,63}$/;

/** Khoá chịu trần theo ĐÚNG thứ tự bảng §6.1 — khoá vượt ĐẦU TIÊN thành `field`. */
const KHOA_TRAN = Object.keys(TRAN_DONG_AGENT) as KhoaDongAgent[];

/**
 * Chốt hợp đồng 1.1 (RV5.4 #2): khoá ĐẦU TIÊN (thứ tự §6.1) mang CHUỖI dài hơn trần `TRAN_DONG_AGENT`; không có ⇒ null.
 * Độ dài = `String.length` của chuỗi ĐÃ GỬI (agent trim trước khi gửi — hợp đồng §6.1). Trường số gửi dạng NUMBER
 * không chịu trần độ dài (chỉ dạng chuỗi).
 */
export function truongVuotTran(row: DongAgentTho): KhoaDongAgent | null {
  for (const k of KHOA_TRAN) {
    const v = row[k];
    if (typeof v === "string" && v.length > TRAN_DONG_AGENT[k]) return k;
  }
  return null;
}

/** Bản dòng mọi chuỗi đã CẮT về trần — CHỈ để chụp dấu của dòng `FIELD_TOO_LONG` (không lưu phần vượt trần). */
function catVeTran(row: DongAgentTho): DongAgentTho {
  const ra: DongAgentTho = { ...row };
  for (const k of KHOA_TRAN) {
    const v = row[k];
    if (typeof v === "string" && v.length > TRAN_DONG_AGENT[k]) Object.assign(ra, { [k]: v.slice(0, TRAN_DONG_AGENT[k]) });
  }
  return ra;
}

/** Mã giao dịch để VỌNG LẠI trong `rejected` (chốt 1.1): chỉ khi ≤ trần — chuỗi dài tuỳ ý không được vọng lại nguyên văn. */
function maDeVong(s: string | null): string | null {
  return s !== null && s.length <= TRAN_DONG_AGENT.transaction_id ? s : null;
}

/** Chuỗi đã trim; rỗng / null / vắng ⇒ null. */
function c(s: string | null | undefined): string | null {
  const v = (s ?? "").trim();
  return v === "" ? null : v;
}

const p2 = (n: number) => String(n).padStart(2, "0");

function soNgayTrongThang(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Ghép ISO +07:00 từ thành phần giờ VN; thành phần vô lý ⇒ null (khuôn `isoVn` của doc-file-pos.ts). */
function isoVn(y: number, mo: number, d: number, h: number, mi: number, s: number): string | null {
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12) return null;
  if (d < 1 || d > soNgayTrongThang(y, mo)) return null;
  if (h > 23 || mi > 59 || s > 59) return null;
  return `${y}-${p2(mo)}-${p2(d)}T${p2(h)}:${p2(mi)}:${p2(s)}+07:00`;
}

const TG_YMD = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})$/;
const TG_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** `YYYY/MM/DD HH:mm:ss` giờ VN (hoặc `-`, `T`) ⇒ ISO +07:00, ghép từ thành phần (KHÔNG `new Date(chuỗi)` — phụ
 *  thuộc TZ máy chạy); ISO có offset ⇒ đổi sang giờ VN. Ngày không có thật ⇒ null. */
export function gioGiaoDichVn(s: string | null | undefined): string | null {
  const v = c(s);
  if (v === null) return null;
  const m = TG_YMD.exec(v);
  if (m) return isoVn(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  if (TG_ISO.test(v)) {
    const t = Date.parse(v);
    if (Number.isNaN(t)) return null;
    const d = new Date(t);
    // Ngày trong chuỗi ISO phải có thật (Date.parse tự "tràn" 2026-02-30 sang tháng 3).
    const [y, mo, dd] = v.slice(0, 10).split("-").map(Number) as [number, number, number];
    if (mo < 1 || mo > 12 || dd < 1 || dd > soNgayTrongThang(y, mo)) return null;
    return gioVN(d);
  }
  return null;
}

/** Một trường số tiền: số / chuỗi chữ số (chấp nhận đuôi `.0`). `null` = vắng; `"LE"` = có phần lẻ / không đọc được. */
function docSoTien(v: number | string | null | undefined): number | null | "LE" {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isSafeInteger(v) ? v : "LE";
  const s = v.trim();
  if (s === "") return null;
  const m = /^(-?\d+)(?:\.0+)?$/.exec(s);
  if (!m) return "LE";
  const n = Number(m[1]);
  return Number.isSafeInteger(n) ? n : "LE";
}

/** Phí (hậu kết toán): số nguyên hoặc vắng — sai dạng ⇒ coi như vắng (không chặn cả dòng vì một cột phụ). */
function docPhi(v: number | string | null | undefined): number | null {
  const n = docSoTien(v);
  return typeof n === "number" ? n : null;
}

const LOAI: Readonly<Record<string, string>> = { PAYMENT: "Thanh toán", VOID: "Hủy", REFUND: "Hoàn" };
const HINH_THUC: Readonly<Record<string, string>> = { CARD: "Thẻ", QR: "QR" };
const THAT_BAI = new Set(["FAIL", "FAILED"]);

/** T7: mọi giá trị có mặt = SUCCESS ⇒ "Thành công"; mọi = FAIL/FAILED ⇒ "Thất bại"; lẫn lộn / lạ ⇒ GIỮ MÃ. */
function trangThaiTuMa(ds: readonly string[]): string {
  const ma = [...new Set(ds.map((x) => x.toUpperCase()))];
  if (ma.every((x) => x === "SUCCESS")) return "Thành công";
  if (ma.every((x) => THAT_BAI.has(x))) return "Thất bại";
  return ma.join("/");
}

function laLoaiThanhToan(type: string): boolean {
  return type.toUpperCase() === "PAYMENT";
}

/**
 * Một dòng agent ⇒ `NHAN` (dòng `DongPos` + cột hậu kết toán + máy) hoặc `TU_CHOI` (mã §7.2). Thứ tự kiểm:
 * merchant → mã GD → TRẦN ĐỘ DÀI (chốt 1.1) → giờ → loại → trạng thái → số tiền → tiền tệ. Đầu ra qua
 * `dongPosSchema.parse` (lưới che số thẻ của file).
 */
export function chuanHoaDongAgent(
  rowGui: DongAgentTho,
  ctx: { merchantCode: string; danhSachMay: readonly MayPos[] },
): KetQuaChuanHoa {
  const tuChoi = (code: MaTuChoi, luuDau: boolean, ma: string | null, anh: AnhTuChoi | null, field?: KhoaDongAgent): KetQuaChuanHoa => ({
    loai: "TU_CHOI",
    code,
    luuDau,
    maGiaoDich: ma,
    anh,
    ...(field ? { field } : {}),
  });

  // T29 — merchant của agent khác ⇒ dữ liệu cơ sở khác: không lưu gì.
  if (chuanMa(rowGui.merchant_code) !== chuanMa(ctx.merchantCode) || chuanMa(ctx.merchantCode) === "") {
    return tuChoi("MERCHANT_MISMATCH", false, maDeVong(c(rowGui.transaction_id)), null);
  }
  const maGiaoDich = c(rowGui.transaction_id);
  if (maGiaoDich === null || !RE_MA_GD.test(maGiaoDich)) return tuChoi("BAD_TRANSACTION_ID", false, maDeVong(maGiaoDich), null);

  // Chốt hợp đồng 1.1 — trần độ dài §6.1: vượt ⇒ từ chối DÒNG (`FIELD_TOO_LONG` + `field`, lưu dấu như mọi lỗi dữ liệu
  // — T30). Mọi giá trị dưới đây đọc từ bản đã CẮT về trần ⇒ dấu không bao giờ mang phần vượt; băm dấu tính trên dòng
  // ĐÃ GỬI (gửi lại y hệt ⇒ `unchanged`). Dòng không vượt: `row` CHÍNH là dòng đã gửi.
  const vuot = truongVuotTran(rowGui);
  const row = vuot === null ? rowGui : catVeTran(rowGui);

  // Máy (T10) — suy từ merchant + quầy (+ cửa hàng), KHÔNG từ `device_id`.
  const may = phanGiaiMay({
    merchantCode: ctx.merchantCode,
    terminalCode: c(row.terminal_code),
    storeCode: c(row.store_code),
    danhSachMay: ctx.danhSachMay,
  });

  const type = c(row.transaction_type);
  const loaiGiaoDich = type === null ? null : (LOAI[type.toUpperCase()] ?? type);
  const trangThaiDs = [c(row.transaction_detail_status), c(row.transaction_master_status)].filter((x): x is string => x !== null);
  const trangThai = trangThaiDs.length === 0 ? null : trangThaiTuMa(trangThaiDs);
  const soDoc = [row.order_amount, row.transaction_master_amount, row.transaction_detail_amount].map(docSoTien);
  const coMat = soDoc.filter((x): x is number | "LE" => x !== null);
  const thoiGian = gioGiaoDichVn(row.transaction_time);
  const dienGiai = c(row.order_description) ?? "";

  const anh = (code: MaTuChoi): AnhTuChoi => {
    // Số tiền chỉ ghi vào ảnh khi các trường CÓ MẶT đọc được, BẰNG NHAU và vừa cột INT4 — lệch thì không chọn hộ
    // một con số; ngoài INT4 thì không ghi (RV-02 — ảnh là chẩn đoán, không được làm hỏng lô).
    const so =
      coMat.length > 0 &&
      coMat.every((x) => typeof x === "number") &&
      new Set(coMat.map((x) => Math.abs(x as number))).size === 1 &&
      Math.abs(coMat[0] as number) <= INT4_MAX
        ? (coMat[0] as number)
        : null;
    return {
      bam: sha256Hex(jsonSapKhoa({ tuChoi: code, row: rowGui })),
      loaiGiaoDich,
      trangThai,
      soTien: so,
      thoiGian: thoiGian === null ? null : new Date(thoiGian),
      bamDienGiai: dienGiai === "" ? null : bamDienGiai(dienGiai),
      maQuay: c(row.terminal_code),
      maThietBi: may?.maThietBi ?? null,
      centerIdMay: may?.centerId ?? null,
    };
  };

  if (vuot !== null) return tuChoi("FIELD_TOO_LONG", true, maGiaoDich, anh("FIELD_TOO_LONG"), vuot);
  if (thoiGian === null) return tuChoi("BAD_TIME", true, maGiaoDich, anh("BAD_TIME"));
  if (type === null || loaiGiaoDich === null) return tuChoi("TYPE_MISSING", true, maGiaoDich, anh("TYPE_MISSING"));
  if (trangThai === null) return tuChoi("STATUS_MISSING", true, maGiaoDich, anh("STATUS_MISSING"));
  if (coMat.length === 0) return tuChoi("AMOUNT_MISSING", true, maGiaoDich, anh("AMOUNT_MISSING"));
  if (coMat.some((x) => x === "LE")) return tuChoi("AMOUNT_NOT_INTEGER", true, maGiaoDich, anh("AMOUNT_NOT_INTEGER"));
  const so = coMat as number[];
  // T8 — các trường có mặt phải BẰNG NHAU về trị tuyệt đối (chưa đo nghĩa từng trường: đoán sai là ghi sai tiền).
  if (new Set(so.map((x) => Math.abs(x))).size !== 1) return tuChoi("AMOUNT_MISMATCH", true, maGiaoDich, anh("AMOUNT_MISMATCH"));
  const tienTe = c(row.currency);
  if (tienTe !== null && !["VND", "704"].includes(tienTe.toUpperCase())) {
    return tuChoi("CURRENCY_UNSUPPORTED", true, maGiaoDich, anh("CURRENCY_UNSUPPORTED"));
  }

  // PAYMENT giữ dấu (≤ 0 ⇒ lõi luật 4 CAN_XU_LY); loại khác (hủy/hoàn) ⇒ số ÂM như file.
  const soTien = laLoaiThanhToan(type) ? so[0]! : -Math.abs(so[0]!);
  const hinh = c(row.payment_method);
  const lyDo = c(row.transaction_operation_msg);

  const d: DongPos = dongPosSchema.parse({
    maGiaoDich,
    loaiGiaoDich,
    hinhThuc: hinh === null ? "" : (HINH_THUC[hinh.toUpperCase()] ?? hinh),
    trangThai,
    soTien,
    thoiGian,
    dienGiai,
    maChuanChi: c(row.authorization_id),
    maGiaoDichThe: c(row.card_transaction_id),
    // List API không mang mã gốc (Chờ đo) ⇒ `ganGocVoid` suy ở tầng nhận lô.
    maGiaoDichGoc: null,
    // List API không có cột Hoàn/Hủy ⇒ null (T12: null KHÔNG xoá giá trị file đã có).
    trangThaiHoanHuy: null,
    maDonHang: c(row.merchant_order_id),
    maQuay: c(row.terminal_code),
    maThietBi: may?.maThietBi ?? null,
    soTheMasked: c(row.sender_card_number),
    loaiThe: c(row.sender_card_type),
    maHachToan: c(row.accounting_reference_id),
    phiGiaoDich: docPhi(row.fee),
  });
  return {
    loai: "NHAN",
    dong: {
      d,
      maKetToan: c(row.settlement_id),
      // T14 — chỉ MÃ (vd USER_CANCELLED); chữ tự do có thể mang PII ⇒ bỏ.
      maLyDoThatBai: lyDo !== null && RE_MA_LY_DO.test(lyDo) ? lyDo : null,
    },
    may,
  };
}

/** Cột của dòng POS ĐÃ CÓ mà trộn null đọc (T12). KHÔNG có Mã hạch toán / Phí — xem G9 ở chú thích dưới. */
export type CotTron = {
  maChuanChi: string | null;
  maGiaoDichThe: string | null;
  maGiaoDichGoc: string | null;
  trangThaiHoanHuy: string | null;
  maDonHang: string | null;
  maQuay: string | null;
  maThietBi: string | null;
  soTheMasked: string | null;
  loaiThe: string | null;
  dienGiai: string;
  hinhThuc: string;
};

/**
 * T12 — `null` của agent KHÔNG xoá giá trị đã có (trộn TRƯỚC khi gọi lõi; lõi giữ nguyên nghĩa "dòng nói gì
 * ghi nấy"). List API không có cột Hoàn/Hủy — ghi thẳng là xoá "Hủy toàn phần" file vừa nhập. Ghi chú / hình thức
 * RỖNG của agent = vắng (TỰ QUYẾT ở phụ lục HIỆN THỰC: hai cột NOT NULL mà rỗng nghĩa là "không thấy", ghi đè là
 * xoá mã phiếu file đang có).
 *
 * Gộp GĐ3 (07/10/2026 — docs/pos-gd4-thiet-ke.md Phụ lục G, G9): Mã hạch toán + Phí KHÔNG trộn. Lõi GĐ3 đã che hai
 * cột đó (`cotKetToanCapNhat`: ô trống = khoá VẮNG MẶT trong `update`). Mã TRƯỚC bản vá trộn cả hai ⇒ null của agent
 * thành giá trị ẢNH CHỤP đầu lô, lõi ghi nó TƯỜNG MINH ⇒ đè một lượt nhập file vừa commit giữa lúc lô agent chạy
 * (lỗ GĐ3 rà #2 sống lại trên nhánh AGENT — ca `[POS4-G3-06]`). `trangThaiHoanHuy` VẪN trộn: nó còn là đầu vào
 * PHÂN LOẠI (dòng Hủy/Hoàn toàn phần hay một phần — `phanLoaiDongPos` luật 2) và D7 của dòng đã khoá.
 */
export function tronVoiDongDaCo(d: DongPos, daCo: CotTron | null): DongPos {
  if (daCo === null) return d;
  return {
    ...d,
    maChuanChi: d.maChuanChi ?? daCo.maChuanChi,
    maGiaoDichThe: d.maGiaoDichThe ?? daCo.maGiaoDichThe,
    maGiaoDichGoc: d.maGiaoDichGoc ?? daCo.maGiaoDichGoc,
    trangThaiHoanHuy: d.trangThaiHoanHuy ?? daCo.trangThaiHoanHuy,
    maDonHang: d.maDonHang ?? daCo.maDonHang,
    maQuay: d.maQuay ?? daCo.maQuay,
    maThietBi: d.maThietBi ?? daCo.maThietBi,
    soTheMasked: d.soTheMasked ?? daCo.soTheMasked,
    loaiThe: d.loaiThe ?? daCo.loaiThe,
    dienGiai: d.dienGiai !== "" ? d.dienGiai : daCo.dienGiai,
    hinhThuc: d.hinhThuc !== "" ? d.hinhThuc : daCo.hinhThuc,
  };
}
