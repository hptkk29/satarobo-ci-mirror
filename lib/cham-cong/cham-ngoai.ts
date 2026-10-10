// lib/cham-cong/cham-ngoai.ts — được CHẤM CÔNG NGOÀI ĐIỂM CHẤM vào lúc này không, và vì sao (đợt 5–6–10
// đơn từ). THUẦN — MỘT chỗ cho: cổng của nút chấm ngoài (`cong-tac-action.ts`), luật vị trí lúc ghi
// lượt (`timelog.ts`) và trang hiện nút. Ba nơi hỏi ba kiểu là ba câu trả lời trôi khỏi nhau.
//
// Nguồn được phép, theo thứ tự:
//   1. Ca hôm nay `placeMode = OFFSITE` (ca công tác xếp tay — có từ 15/09).
//   2. Đơn CÔNG TÁC đã duyệt phủ hôm nay (cả ngày — BA 4.13: không cần quản lý xếp thêm ca).
//   3. Đơn LÀM TỪ XA đã duyệt phủ hôm nay — cả ngày, hoặc đúng khung giờ nếu đơn khai giờ (BA 4.12).
//   4. Đơn CHẤM CÔNG NGOÀI ĐỊA ĐIỂM đã duyệt, đúng khung giờ (BA 4.9 — không mở cả ngày cho đơn 2 giờ).
//
// Khung giờ có DUNG SAI hai đầu (`shift.chamNgoaiDungSaiPhut`): người xin 14:00–16:00 quét ra lúc
// 16:05 vẫn phải ghi được — không thì đơn duyệt rồi mà chấm vẫn hỏng. Ngoài khung + dung sai ⇒ luật
// vị trí bình thường áp lại.
import type { DonHieuLuc } from "./don-trong-ngay";
import { khoangTu } from "./khoang-gio";

export type LyDoChamNgoai = "CA_CONG_TAC" | "CONG_TAC" | "LAM_TU_XA" | "NGOAI_DIA_DIEM";

export type QuyenChamNgoai = {
  lyDo: LyDoChamNgoai;
  /** Cờ gắn lên lượt quét (thông tin, không phải vi phạm). null = không gắn (ca công tác có từ trước). */
  co: string | null;
  /** "Làm từ xa (đã duyệt) đến 17:30" — câu cho người dùng. */
  nhan: string;
};

export const CO_LUOT_NGOAI: Record<LyDoChamNgoai, string | null> = {
  CA_CONG_TAC: null,
  CONG_TAC: "CONG_TAC",
  LAM_TU_XA: "LAM_TU_XA",
  NGOAI_DIA_DIEM: "NGOAI_DIA_DIEM_DUYET",
};

/**
 * Ngày KHÔNG có ca nhưng có LỊCH theo đơn đã duyệt (công tác · làm ngày nghỉ / lễ) ⇒ lượt quét hôm đó
 * không phải "chấm ngoài lịch". Một chỗ cho cả lúc ghi lượt (`timelog.ts`) lẫn engine (gỡ cờ đã gắn
 * trên lượt quét TRƯỚC khi đơn được duyệt).
 */
export function coLichTheoDon(don: readonly Pick<DonHieuLuc, "kind">[]): boolean {
  return don.some((d) => d.kind === "BUSINESS_TRIP" || d.kind === "HOLIDAY_WORK");
}

function trongKhung(d: DonHieuLuc, phut: number, dungSai: number): boolean | null {
  const k = khoangTu(d.startTime, d.endTime);
  if (!k) return null; // đơn không khai giờ
  return phut >= k.start - dungSai && phut <= k.end + dungSai;
}

export function quyenChamNgoai(opts: {
  placeMode: string | null;
  /** Đơn còn hiệu lực của HÔM NAY (`docDonHieuLucNgay`). */
  don: readonly DonHieuLuc[];
  /** Phút kể từ 00:00 giờ VN của lúc quét. */
  phut: number;
  dungSaiPhut: number;
}): QuyenChamNgoai | null {
  if (opts.placeMode === "OFFSITE") return { lyDo: "CA_CONG_TAC", co: null, nhan: "Ca công tác" };
  if (opts.don.some((d) => d.kind === "BUSINESS_TRIP")) {
    return { lyDo: "CONG_TAC", co: CO_LUOT_NGOAI.CONG_TAC, nhan: "Đi công tác (đã duyệt)" };
  }
  for (const d of opts.don) {
    if (d.kind !== "REMOTE") continue;
    const ok = trongKhung(d, opts.phut, opts.dungSaiPhut);
    if (ok === null || ok) {
      return {
        lyDo: "LAM_TU_XA",
        co: CO_LUOT_NGOAI.LAM_TU_XA,
        nhan: ok === null ? "Làm từ xa (đã duyệt)" : `Làm từ xa (đã duyệt) ${d.startTime}–${d.endTime}`,
      };
    }
  }
  // Nguồn 4 (đợt 10) — đơn CHẤM CÔNG NGOÀI ĐỊA ĐIỂM: LUÔN có khung (cổng nộp + cổng duyệt đòi), và
  // chỉ trong khung ± dung sai. Đơn thiếu khung (dữ liệu lạ) KHÔNG mở cả ngày — khác làm từ xa.
  for (const d of opts.don) {
    if (d.kind !== "OUTSIDE_ATTENDANCE") continue;
    if (trongKhung(d, opts.phut, opts.dungSaiPhut) === true) {
      return {
        lyDo: "NGOAI_DIA_DIEM",
        co: CO_LUOT_NGOAI.NGOAI_DIA_DIEM,
        nhan: `Chấm ngoài địa điểm (đã duyệt) ${d.startTime}–${d.endTime}`,
      };
    }
  }
  return null;
}
