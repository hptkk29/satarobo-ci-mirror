// lib/hoa-hong/vi-sao.ts — ngăn "VÌ SAO CON SỐ NÀY" của một dòng sổ (06 §2.3, 04 §10.2).
//
// THUẦN. Dữ liệu duy nhất là ẢNH CHỤP nằm trên chính dòng sổ — đọc lại KHÔNG phụ thuộc chính sách live: chính sách đổi/hết hạn/bị huỷ sau đó
// vẫn giải thích đúng con số đã ghi. Đây là lý do sổ phải chụp (policyVersion, rule, rate, vatRate, netBase, capRate, lý do) chứ không chỉ lưu id.
//
// Luật 12 (affordance nói thật): ngăn này chỉ khẳng định điều dòng sổ THẬT SỰ chứa. Không có `reasonCode` thì không bịa lý do.

import { MA_KHIEU_NAI_DIEU_CHINH, MA_KHOI_PHUC_HOAN_LEGACY } from "./khieu-nai-ma";

export type DongChoViSao = {
  entryKind: string;
  amount: number;
  grossAmount: number;
  vatRate: number;
  netBase: number;
  rate: number | null;
  fixedAmount: number | null;
  capRate: number;
  equivalentRate: number;
  sourceGroupCode: string;
  transactionTypeCode: string;
  roleCode: string;
  splitMethod: string | null;
  documentNumber: string | null;
  versionNo: number | null;
  calcKind: string | null;
  reason: string;
  reasonCode: string | null;
  naturalPeriod: string;
  kyGhi: string;
  lateArrival: boolean;
  refEntryId: string | null;
  refEventType: string | null;
  refEventId: string | null;
  resolverBasis: unknown;
  paymentId: string | null;
};

export type BuocViSao = { nhan: string; giaTri: string; ghiChu?: string };

/** Nhãn của các bước mà tầng hiển thị đầy đủ (`vi-sao-day-du.ts`) lấy lại — MỘT nguồn chữ, đổi nhãn ở đây là cả hai nơi đổi theo. */
export const NHAN_BUOC_VI_SAO = {
  CONG_THUC: "Công thức",
  PHAN_CUA_NGUOI: "Phần của người này",
  SO_THU_HOI: "Số thu hồi",
  SO_TIEN: "Số tiền",
  KIEM_TRAN: "Kiểm trần",
  CHINH_SACH: "Chính sách áp dụng",
  KY: "Kỳ",
} as const;
export type ViSao = { tieuDe: string; buoc: BuocViSao[]; canhBao: string[] };

/** 1234567 → "1.234.567đ" — không dùng `toLocaleString` (khác nhau theo ICU của runtime). */
export function dinhDangDong(n: number): string {
  const r = Math.round(n);
  const dau = r < 0 ? "−" : ""; // dấu theo giá trị ĐÃ làm tròn: −0,4 ⇒ "0đ", không "−0đ"
  return `${dau}${Math.abs(r).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}đ`;
}

/**
 * Số (không phải tiền) kiểu Việt: 1234567 → "1.234.567"; `soLe` > 0 ⇒ phẩy thập phân đủ chừng ấy chữ số (8,5 → "8,50").
 * CÙNG luật với `dinhDangDong` (nhóm nghìn bằng dấu chấm, dấu trừ thật, dấu theo giá trị ĐÃ làm tròn) và cũng không đi qua ICU —
 * MỘT chỗ cho cả module (lưới `[NHH-DD-GOM-01]` cấm `Intl.NumberFormat` / `toLocaleString` ở nơi khác).
 */
export function dinhDangSo(n: number, soLe = 0): string {
  const hs = 10 ** soLe;
  const r = Math.round(n * hs) / hs; // làm tròn như dinhDangDong (Math.round) — hai hàm không lệch nhau ở nửa đơn vị
  const [nguyen = "0", le = ""] = Math.abs(r).toFixed(soLe).split(".");
  const dau = r < 0 ? "−" : "";
  return `${dau}${nguyen.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}${le ? `,${le}` : ""}`;
}

export const phanTram =(x: number): string => `${(Math.round(x * 1_000_000) / 10_000).toString().replace(".", ",")}%`;

export const TEN_LOAI_DONG: Record<string, string> = {
  ORIGINAL: "Hoa hồng phát sinh từ khoản thu",
  LATE_ARRIVAL: "Hoa hồng khoản thu đến muộn",
  REVERSAL: "Thu hồi do hoàn tiền / điều chỉnh giảm",
  SOURCE_CORRECTION: "Điều chỉnh do đổi nguồn sau thanh toán",
  INPUT_CORRECTION: "Điều chỉnh do đầu vào thay đổi",
  DISPUTE_ADJUSTMENT: "Điều chỉnh do khiếu nại",
  LEGACY_REVERSAL: "Thu hồi khoản của sổ cũ",
  PERIOD_BONUS: "Thưởng bậc theo kỳ",
};

export const TEN_MA_LY_DO: Record<string, string> = {
  KY_GOC_DA_DONG: "kỳ hiệu lực đã đóng nên khoản này được ghi vào kỳ đang mở kế tiếp",
  KY_TRUOC_MOC: "kỳ hiệu lực nằm trước mốc chuyển sang sổ mới nên khoản này được ghi vào kỳ đầu tiên của sổ mới",
  HOAN_TIEN: "khoản thu đã bị hoàn hoặc điều chỉnh giảm",
};

/**
 * Tên loại dòng bằng chữ. Kind `DISPUTE_ADJUSTMENT` còn được MƯỢN cho dòng trả lại hoa hồng của khoản hoàn sổ cũ bị bác (CHECK DB cấm
 * LEGACY_REVERSAL dương) — không gọi nó là "khiếu nại". MỘT hàm cho ngăn "Vì sao" và danh sách điều chỉnh liên quan.
 */
export function tenLoaiDong(entryKind: string, reasonCode: string | null): string {
  return entryKind === "DISPUTE_ADJUSTMENT" && reasonCode === MA_KHOI_PHUC_HOAN_LEGACY ? "Trả lại hoa hồng đã thu hồi (khoản hoàn của sổ cũ bị bác)" : (TEN_LOAI_DONG[entryKind] ?? entryKind);
}

/**
 * @param hienTongTiLe  có in TỔNG tỉ lệ các vai của khoản (`equivalentRate`) không. Tổng ấy là thông tin về các vai KHÁC: người chỉ có `view-self` trừ tỉ lệ của mình ra là biết
 *                      tổng tỉ lệ của họ, nhân với cơ sở tính (đã hiện) ra tiền. KHÔNG có giá trị mặc định (luật 7): quên truyền là lỗi biên dịch, không phải lỗ rò.
 */
export function dungViSao(d: DongChoViSao, hienTongTiLe: boolean): ViSao {
  const buoc: BuocViSao[] = [];
  const canhBao: string[] = [];
  const loai = tenLoaiDong(d.entryKind, d.reasonCode);

  buoc.push({ nhan: "Loại dòng", giaTri: loai });

  // Dòng điều chỉnh do KHIẾU NẠI (PR11): không phải một lần tính theo tỉ lệ — người duyệt quyết thẳng một số tiền. Nếu để chạy tiếp, ngăn này sẽ in
  // "cơ sở → cơ sở" và "Công thức / Kiểm trần" cho một dòng KHÔNG có cơ sở, tỉ lệ hay trần nào (nói dối). Chỉ in điều dòng thật sự chứa.
  if (d.entryKind === "DISPUTE_ADJUSTMENT" && d.reasonCode === MA_KHIEU_NAI_DIEU_CHINH) {
    const kyKN = d.lateArrival ? `Hiệu lực ${d.naturalPeriod} · ghi vào kỳ ${d.kyGhi}` : `Kỳ ${d.kyGhi}`;
    buoc.push({ nhan: "Kỳ", giaTri: kyKN, ...(d.lateArrival ? { ghiChu: "Kỳ hiệu lực đã đóng nên khoản điều chỉnh được ghi vào kỳ đang mở kế tiếp — kỳ cũ không bị mở lại." } : {}) });
    buoc.push({ nhan: "Số tiền điều chỉnh", giaTri: dinhDangDong(d.amount), ghiChu: "Do người duyệt khiếu nại quyết định, không tính theo tỉ lệ chính sách." });
    buoc.push({ nhan: "Lý do", giaTri: d.reason });
    if (d.refEventType === "DISPUTE" && d.refEventId) buoc.push({ nhan: "Khiếu nại", giaTri: d.refEventId });
    if (d.refEntryId) buoc.push({ nhan: "Dòng liên quan", giaTri: d.refEntryId });
    return { tieuDe: `${loai} · ${d.roleCode}`, buoc, canhBao: d.lateArrival ? ["Dòng này ghi vào kỳ khác kỳ hiệu lực — kỳ cũ không bị mở lại."] : [] };
  }

  // Kỳ: hiệu lực vs ghi sổ (H22).
  const kyGiaTri = d.lateArrival ? `Hiệu lực ${d.naturalPeriod} · ghi vào kỳ ${d.kyGhi}` : `Kỳ ${d.kyGhi}`;
  const lyKy = d.reasonCode && TEN_MA_LY_DO[d.reasonCode] ? `Vì ${TEN_MA_LY_DO[d.reasonCode]}.` : undefined;
  buoc.push({ nhan: NHAN_BUOC_VI_SAO.KY, giaTri: kyGiaTri, ...(d.lateArrival && lyKy ? { ghiChu: lyKy } : {}) });
  if (d.lateArrival) canhBao.push("Dòng này ghi vào kỳ khác kỳ hiệu lực của khoản thu — kỳ cũ không bị mở lại.");

  // Cơ sở tính.
  if (d.entryKind === "REVERSAL") {
    buoc.push({
      nhan: "Cơ sở thu hồi",
      giaTri: `${dinhDangDong(Math.abs(d.netBase))} (đã bỏ VAT ${phanTram(d.vatRate)} của dòng gốc)`,
      ghiChu: "Thu hồi theo TỈ LỆ TIỀN của chính dòng gốc trên phần cơ sở còn lại, không nhân lại tỉ lệ chính sách hôm nay.",
    });
  } else {
    buoc.push({
      nhan: "Cơ sở tính hoa hồng",
      giaTri: `${dinhDangDong(d.grossAmount)} → ${dinhDangDong(d.netBase)}`,
      ghiChu: d.vatRate > 0 ? `Đã bỏ VAT ${phanTram(d.vatRate)}. Chỉ tính trên thành phần học phí.` : "Chưa có VAT (0%). Chỉ tính trên thành phần học phí.",
    });
  }

  buoc.push({ nhan: "Loại giao dịch", giaTri: d.transactionTypeCode === "NEW" ? "Khách mới (NEW)" : d.transactionTypeCode === "RENEWAL" ? "Tái tục (RENEWAL)" : d.transactionTypeCode });
  buoc.push({ nhan: "Nhóm nguồn", giaTri: d.sourceGroupCode === "UNKNOWN" ? "Chưa rõ nguồn — tính theo mức thấp nhất trong các nhóm" : d.sourceGroupCode });

  // Chính sách thắng.
  const vanBan = d.documentNumber ? `${d.documentNumber}${d.versionNo ? ` · phiên bản ${d.versionNo}` : ""}` : "(không ghi)";
  buoc.push({ nhan: NHAN_BUOC_VI_SAO.CHINH_SACH, giaTri: vanBan, ghiChu: d.reason });

  // Công thức.
  if (d.entryKind === "REVERSAL") {
    buoc.push({ nhan: NHAN_BUOC_VI_SAO.SO_THU_HOI, giaTri: dinhDangDong(d.amount) });
  } else if (d.calcKind === "PERCENT" && d.rate !== null) {
    buoc.push({ nhan: NHAN_BUOC_VI_SAO.CONG_THUC, giaTri: `${dinhDangDong(d.netBase)} × ${phanTram(d.rate)} = ${dinhDangDong(Math.round(d.netBase * d.rate))}`, ghiChu: "Tiền của cả vai; nhiều người cùng vai thì chia đều." });
    buoc.push({ nhan: NHAN_BUOC_VI_SAO.PHAN_CUA_NGUOI, giaTri: dinhDangDong(d.amount) });
  } else if (d.calcKind === "FIXED_PER_PURCHASE" && d.fixedAmount !== null) {
    buoc.push({ nhan: NHAN_BUOC_VI_SAO.CONG_THUC, giaTri: `Mức cố định ${dinhDangDong(d.fixedAmount)}` });
    buoc.push({ nhan: NHAN_BUOC_VI_SAO.PHAN_CUA_NGUOI, giaTri: dinhDangDong(d.amount) });
  } else {
    buoc.push({ nhan: NHAN_BUOC_VI_SAO.SO_TIEN, giaTri: dinhDangDong(d.amount) });
  }

  // Trần.
  buoc.push(
    hienTongTiLe
      ? {
          nhan: NHAN_BUOC_VI_SAO.KIEM_TRAN,
          giaTri: `Tổng tỉ lệ ${phanTram(d.equivalentRate)} ≤ trần ${phanTram(d.capRate)}`,
          ghiChu: "Trần tính trên TỈ LỆ của các chính sách thắng, GV dạy Trial nằm trong trần; vượt trần là lỗi cấu hình và không ghi dòng nào.",
        }
      : {
          nhan: NHAN_BUOC_VI_SAO.KIEM_TRAN,
          giaTri: `Trong trần ${phanTram(d.capRate)}`,
          ghiChu: "Trần tính trên tổng tỉ lệ mọi vai của khoản; vượt trần là lỗi cấu hình và không ghi dòng nào. Bạn chỉ xem phần của chính mình.",
        },
  );
  if (hienTongTiLe && d.equivalentRate > d.capRate) canhBao.push("Tỉ lệ tương đương lớn hơn trần ghi trên dòng — dữ liệu bất thường, báo kế toán.");

  if (d.refEntryId) buoc.push({ nhan: "Dòng gốc", giaTri: d.refEntryId });
  if (d.refEventType === "PAYMENT" && d.refEventId) buoc.push({ nhan: "Giao dịch liên quan", giaTri: d.refEventId });
  return { tieuDe: `${loai} · ${d.roleCode}`, buoc, canhBao };
}
