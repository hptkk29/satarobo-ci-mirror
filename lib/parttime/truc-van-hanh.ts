// lib/parttime/truc-van-hanh.ts — P5b · ĐƠN VỊ TRẢ của một ca trực vận hành (SR.QD.238). THUẦN, không đồng hồ.
//
// D-Q3 / D-N1 (chủ dự án chốt): công trực CHỈ sinh từ `OperationsDutyAssignment` TƯỜNG MINH. Không có dòng trực ⇒ 0, dù
// người đó có ô ca S/C/T, có mặt ở cơ sở cả buổi, hay chỉ dạy một tiết. Hàm này không nhận ô ca (ShiftAssignment) làm đầu
// vào — không có đường nào để ô ca chạm tới tiền trực.
//
// Có dòng trực (đã nhận đúng phiên bản):
//   tiết dạy được trả trong ca = 0 ⇒ 1,0 ca · 1 ⇒ 0,5 ca · ≥ `toiDaTietMoiCa` (2) ⇒ 0.
// "Nửa ca" là ĐƠN VỊ TRẢ (45.000đ), KHÔNG phải nửa thời gian — không chia ca thành đoạn giờ.
// Tiết "được trả" = phân công dạy (MAIN/TA) của chính người đó, buổi nằm TRỌN trong khung ca, đã được QLCS QUYẾT:
//   xác nhận (đơn vị WorkUnit hiệu lực) ⇒ đếm 1 · từ chối ⇒ đếm 0. Còn tiết chưa quyết ⇒ CHỜ (không đoán).
// Buổi VƯỢT ranh ca (chạm khung mà không nằm trọn) ⇒ CHAN Q2 — chưa chốt buổi đó thuộc ca nào, nên đơn vị trả KHÔNG
// tính được (xác nhận tay cũng không: ghi 1 / 0,5 là âm thầm quyết Q2). Màn hình gọi là "cần xem lại (Q2)".
// Phút có mặt trong khung ca (`phutCoMatTrongCa`) là THƯỚC ĐO RIÊNG cho báo cáo — không bao giờ quy đổi thành đơn vị trả.
import type { KhoangCoMat } from "./bang-chung-cong";
import { phutTrongNgay, type ThamSoChinhSach } from "./chinh-sach";

export type TietTrongNgay = {
  assignmentId: string;
  gioBatDau: string; // "HH:mm" — giờ DẠY (không gồm 10' chuẩn bị)
  gioKetThuc: string;
  /** XAC_NHAN = có đơn vị dạy hiệu lực · TU_CHOI = QLCS từ chối thực hiện · CHUA = chưa quyết (hoặc đơn vị đã CŨ) ·
   *  Q1_KHONG_CHUAN = buổi thời lượng ≠ chuẩn — Q1 còn mở, KHÔNG đếm được là 0 hay 1 dù QLCS đã quyết gì. */
  quyet: "XAC_NHAN" | "TU_CHOI" | "CHUA" | "Q1_KHONG_CHUAN";
};

export type LopTruc = "TU_DONG" | "XEM_TAY" | "CHAN" | "CHO" | "KHONG_AP_DUNG";
export type LyDoTruc =
  | "LEGACY"
  | "MA_CA_KHONG_CO"
  | "TRUC_DA_HUY"
  | "CHUA_HET_CA"
  | "CHUA_NHAN"
  | "KHONG_CO_MAT"
  | "TIET_CHUA_QUYET"
  | "Q2_VUOT_CA"
  | "Q1_THOI_LUONG";

const LOP: Record<LyDoTruc, LopTruc> = {
  LEGACY: "KHONG_AP_DUNG",
  MA_CA_KHONG_CO: "CHAN",
  TRUC_DA_HUY: "KHONG_AP_DUNG",
  CHUA_HET_CA: "CHO",
  CHUA_NHAN: "CHAN",
  KHONG_CO_MAT: "CHAN",
  TIET_CHUA_QUYET: "CHO",
  Q2_VUOT_CA: "CHAN",
  Q1_THOI_LUONG: "CHAN",
};
const THU_TU: LopTruc[] = ["KHONG_AP_DUNG", "CHAN", "CHO", "XEM_TAY"];

export type DauVaoTruc = {
  thamSo: ThamSoChinhSach | null;
  ngay: string; // "YYYY-MM-DD"
  shiftCode: string;
  centerId: string;
  conSong: boolean;
  daNhan: boolean;
  tiet: readonly TietTrongNgay[];
  khoang: readonly KhoangCoMat[];
  now: Date;
};

export type DanhGiaTruc = {
  lop: LopTruc;
  lyDo: LyDoTruc[];
  /** Khung ca theo chính sách tại ngày trực (null khi LEGACY / mã ca lạ). */
  khung: { tu: string; den: string } | null;
  /** Tiết đã QUYẾT được trả trong ca (đếm vào luật 1 / 0,5 / 0). */
  soTietTrongCa: number;
  /** Đơn vị trả: "1" · "0.5" · "0" — null khi chưa tính được (CHỜ / CHẶN / không áp dụng / Q2). */
  donViTra: "1" | "0.5" | "0" | null;
  /** Đơn giá 1 ca đầy đủ (VND) — nhân `donViTra` ra tiền trực. */
  donGiaCa: number | null;
  phutCoMatTrongCa: number;
  tietTrongCa: string[];
  tietVuotCa: string[];
};

const mocVn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);

export function danhGiaTruc(v: DauVaoTruc): DanhGiaTruc {
  const ts = v.thamSo && v.thamSo.loai === "SR_QD_238" ? v.thamSo : null;
  const ca = ts?.ca.find((c) => c.ma === v.shiftCode) ?? null;
  const ly: LyDoTruc[] = [];
  const ra: Omit<DanhGiaTruc, "lop" | "lyDo"> = {
    khung: ca ? { tu: ca.tu, den: ca.den } : null,
    soTietTrongCa: 0,
    donViTra: null,
    donGiaCa: ts ? ts.donGia.trucCa : null,
    phutCoMatTrongCa: 0,
    tietTrongCa: [],
    tietVuotCa: [],
  };
  if (!ts) ly.push("LEGACY");
  else if (!ca) ly.push("MA_CA_KHONG_CO");
  if (!v.conSong) ly.push("TRUC_DA_HUY");

  if (ts && ca) {
    const tu = phutTrongNgay(ca.tu);
    const den = phutTrongNgay(ca.den);
    const moTu = mocVn(v.ngay, ca.tu).getTime();
    const moDen = mocVn(v.ngay, ca.den).getTime();
    for (const k of v.khoang) {
      if (k.centerId !== v.centerId) continue;
      const giao = Math.min((k.den ?? v.now).getTime(), moDen) - Math.max(k.tu.getTime(), moTu);
      if (giao > 0) ra.phutCoMatTrongCa += Math.round(giao / 60_000);
    }
    let chuaQuyet = false;
    let q1 = false;
    for (const t of v.tiet) {
      const a = phutTrongNgay(t.gioBatDau);
      const b = phutTrongNgay(t.gioKetThuc);
      if (b <= tu || a >= den) continue; // không chạm ca
      if (a < tu || b > den) {
        ra.tietVuotCa.push(t.assignmentId);
        continue;
      }
      ra.tietTrongCa.push(t.assignmentId);
      if (t.quyet === "XAC_NHAN") ra.soTietTrongCa++;
      else if (t.quyet === "CHUA") chuaQuyet = true;
      // Từ chối buổi 60'/120' để "gỡ" ca trực là âm thầm quyết Q1 (coi = 0 tiết) ⇒ chặn bất kể quyết định.
      else if (t.quyet === "Q1_KHONG_CHUAN") q1 = true;
    }
    if (v.now.getTime() < moDen) ly.push("CHUA_HET_CA");
    if (!v.daNhan) ly.push("CHUA_NHAN");
    if (ra.phutCoMatTrongCa === 0) ly.push("KHONG_CO_MAT");
    if (chuaQuyet) ly.push("TIET_CHUA_QUYET");
    if (ra.tietVuotCa.length) ly.push("Q2_VUOT_CA");
    if (q1) ly.push("Q1_THOI_LUONG");
  }
  const lop = THU_TU.find((l) => ly.some((x) => LOP[x] === l)) ?? "TU_DONG";
  if (lop === "TU_DONG" && ts) ra.donViTra = ra.soTietTrongCa === 0 ? "1" : ra.soTietTrongCa < ts.toiDaTietMoiCa ? "0.5" : "0";
  return { lop, lyDo: ly.filter((x) => LOP[x] === lop), ...ra };
}

/**
 * Dấu vân của mọi đầu vào quyết định đơn vị trả (FNV-1a) — đổi tiết / quyết định / lượt / phiên bản ⇒ đổi dấu ⇒ đơn vị CŨ.
 * CHỈ tiết CHẠM ca này (trong ca + vượt ca): tiết ở ca khác được xác nhận sau không được làm cũ đơn vị trực của ca này.
 */
export function dauVanTruc(p: { dutyId: string; phienBan: number; v: DauVaoTruc; d: DanhGiaTruc }): string {
  const cham = new Set([...p.d.tietTrongCa, ...p.d.tietVuotCa]);
  const s = JSON.stringify([
    p.dutyId,
    p.phienBan,
    p.v.ngay,
    p.v.shiftCode,
    p.v.centerId,
    p.v.conSong,
    p.v.daNhan,
    p.d.khung,
    p.v.tiet.filter((t) => cham.has(t.assignmentId)).sort((a, b) => a.assignmentId.localeCompare(b.assignmentId)).map((t) => [t.assignmentId, t.gioBatDau, t.gioKetThuc, t.quyet]),
    p.d.phutCoMatTrongCa > 0,
    p.d.donViTra,
    p.d.lop,
  ]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
