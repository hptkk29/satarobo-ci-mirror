// lib/cham-cong/buoi-bu-ky.ts — BUỔI DẠY BÙ TRONG KỲ CÔNG (T12, 08/10/2026). THUẦN, không chạm DB.
//
// Luật đã chốt (bản duyệt T12):
//   · Case COMPLETED hoặc NO_SHOW (giáo viên có mặt dạy, kể cả khi mọi bé vắng) có công. CANCELLED / SCHEDULED không.
//   · MỘT case = MỘT buổi công: thời lượng = giờ kết − giờ bắt đầu của case, KHÔNG nhân theo số bài (1–3) hay số bé.
//   · Công dạy bù (`HB_CHINH`) tính theo danh mục loại công như mọi nguồn khác — `countsInPeriod` do danh mục quyết, không do file này.
//   · Bản CHỐT kỳ phải chứa các buổi bù của kỳ, để về sau đối chiếu được "lúc chốt có những buổi nào". Kỳ đã chốt KHÔNG bị sửa trực tiếp:
//     case hoàn thành SAU khi chốt thì chỉ bị báo (luật TV-93 của checker), không ghi ngược vào bản chốt.
//
// File này là CHỖ DUY NHẤT trả lời "case nào tính là buổi bù trong kỳ" và "thời lượng bao nhiêu" cho bản chốt và checker. Đường
// tính công dạy (`cong-day-db.ts`) cùng dùng `TRANG_THAI_CASE_CO_CONG` để hai nơi không lệch nhau.
import { phutGiuaHaiGio } from "./cong-day";

/** Trạng thái case có công dạy. Chỉ ĐỔI Ở ĐÂY — `cong-day-db.ts` và bản chốt kỳ cùng đọc hằng này. */
export const TRANG_THAI_CASE_CO_CONG = ["COMPLETED", "NO_SHOW"] as const;
export type TrangThaiCaseCoCong = (typeof TRANG_THAI_CASE_CO_CONG)[number];

export function caseCoCong(status: string): status is TrangThaiCaseCoCong {
  return (TRANG_THAI_CASE_CO_CONG as readonly string[]).includes(status);
}

/** Một buổi bù như bản chốt kỳ ghi nhận. Chỉ mang thứ cần để đối chiếu, không mang tên người / bé. */
export type BuoiBuTrongKy = {
  caseId: string;
  teacherId: string;
  /** Ngày VN (YYYY-MM-DD). */
  ymd: string;
  /** Thời lượng = giờ kết − giờ bắt đầu; null khi giờ hỏng (không đoán). */
  phut: number | null;
  status: TrangThaiCaseCoCong;
};

export type CaseDauVao = {
  id: string;
  teacherId: string;
  /** Nửa đêm UTC của ngày VN (hình dạng cột `@db.Date`). */
  date: Date;
  startTime: string;
  endTime: string;
  status: string;
};

/** Dựng danh sách buổi bù từ case. Bỏ case không có công; mỗi case đúng MỘT dòng; xếp ổn định theo (ngày, id). */
export function buoiBuTuCase(cases: readonly CaseDauVao[]): BuoiBuTrongKy[] {
  const theoId = new Map<string, BuoiBuTrongKy>();
  for (const c of cases) {
    if (!caseCoCong(c.status)) continue;
    theoId.set(c.id, {
      caseId: c.id,
      teacherId: c.teacherId,
      ymd: c.date.toISOString().slice(0, 10),
      phut: phutGiuaHaiGio(c.startTime, c.endTime),
      status: c.status,
    });
  }
  return [...theoId.values()].sort((a, b) => a.ymd.localeCompare(b.ymd) || a.caseId.localeCompare(b.caseId));
}

export type TongBuoiBu = { soBuoi: number; phut: number };

/** Gom theo giáo viên. Một case = một buổi; phút null (giờ hỏng) đếm buổi nhưng không cộng phút. */
export function gomBuoiBuTheoNguoi(buoi: readonly BuoiBuTrongKy[]): Map<string, TongBuoiBu> {
  const ra = new Map<string, TongBuoiBu>();
  for (const b of buoi) {
    const cu = ra.get(b.teacherId) ?? { soBuoi: 0, phut: 0 };
    ra.set(b.teacherId, { soBuoi: cu.soBuoi + 1, phut: cu.phut + (b.phut ?? 0) });
  }
  return ra;
}

export type LechBanChot = {
  caseId: string;
  /**
   * BAN_CHOT_TRUOC_T12  — bản chốt không có trường `buoiBu` (kỳ chốt trước khi bản chốt biết đến buổi bù): không đối chiếu được.
   * NGOAI_BAN_CHOT     — case có công bây giờ nhưng bản chốt không ghi (hoàn thành sau khi chốt, hoặc chốt sót).
   * DOI_SAU_CHOT       — bản chốt có case này nhưng giáo viên / trạng thái đã đổi.
   * MAT_SAU_CHOT       — bản chốt có case này nhưng bây giờ không còn có công (bị huỷ / sửa điểm danh về chưa dạy).
   */
  loai: "BAN_CHOT_TRUOC_T12" | "NGOAI_BAN_CHOT" | "DOI_SAU_CHOT" | "MAT_SAU_CHOT";
};

/**
 * So các buổi bù HIỆN TẠI của một kỳ ĐÃ CHỐT với bản chốt. `banChot === undefined` nghĩa là bản chốt cũ không có trường.
 * Trả rỗng nghĩa là khớp. KHÔNG ghi gì — đây là phép so thuần.
 */
export function lechSoVoiBanChot(banChot: readonly BuoiBuTrongKy[] | undefined, hienTai: readonly BuoiBuTrongKy[]): LechBanChot[] {
  if (banChot === undefined) return hienTai.map((b) => ({ caseId: b.caseId, loai: "BAN_CHOT_TRUOC_T12" as const }));
  const cu = new Map(banChot.map((b) => [b.caseId, b]));
  const nay = new Map(hienTai.map((b) => [b.caseId, b]));
  const ra: LechBanChot[] = [];
  for (const b of hienTai) {
    const o = cu.get(b.caseId);
    if (!o) ra.push({ caseId: b.caseId, loai: "NGOAI_BAN_CHOT" });
    else if (o.teacherId !== b.teacherId || o.status !== b.status || o.phut !== b.phut) ra.push({ caseId: b.caseId, loai: "DOI_SAU_CHOT" });
  }
  for (const o of banChot) if (!nay.has(o.caseId)) ra.push({ caseId: o.caseId, loai: "MAT_SAU_CHOT" });
  return ra.sort((a, b) => a.caseId.localeCompare(b.caseId));
}
