// lib/cham-cong/nghi-trong-ca.ts — NGHỈ MỘT PHẦN CA (đợt 7 — nghỉ nửa buổi / theo giờ; đợt 8 — nghỉ
// bù) quy ra khoảng phút trong ca. THUẦN.
//
// Vì sao không ghi ô ca như nghỉ cả ngày: mỗi người mỗi ngày chỉ có MỘT ô ca ACTIVE (chỉ mục duy
// nhất `ShiftAssignment_user_date_active_key`). Nghỉ sáng thì chiều vẫn phải làm theo ĐÚNG ca đó ⇒ ca
// giữ nguyên, phần nghỉ đi vào engine qua ngữ cảnh đơn.
//
// "Nửa buổi" = MỘT CỤM QUÉT của ca (`cumQuetKyVong` — sáng = cụm đầu, chiều = cụm cuối), KHÔNG phải
// mốc 12:00: ca `T` 17:15–21:00 không có buổi sáng nào. Ca chỉ có một cụm (S, C, T…) thì không nghỉ
// nửa buổi được — cổng duyệt chặn; engine gặp dữ liệu cũ như vậy thì gắn cờ chứ không đoán.
import { giao, gop, tong, tru, type Khoang } from "./khoang-gio";

export type NghiTrongNgay = {
  loai: "SANG" | "CHIEU" | "KHUNG" | "CA_NGAY";
  /** Chỉ với `KHUNG` (nghỉ theo giờ). */
  khung: Khoang | null;
  /** Thời gian nghỉ có hưởng lương không (loại nghỉ `paidRatio > 0`; nghỉ bù luôn có). */
  coLuong: boolean;
  nguon: "LEAVE" | "COMP_LEAVE";
};

export type KhungNghiDaGiai = {
  /** Mọi phút nghỉ nằm trong ca. */
  khung: Khoang[];
  /** Phần trong đó có hưởng lương. */
  khungCoLuong: Khoang[];
  /** Có đơn nghỉ nửa buổi mà ca không có hai cụm ⇒ không áp được. */
  khongAp: boolean;
  /**
   * Phần CÔNG của ca bị nghỉ (0–1) và phần có lương trong đó. Nửa buổi = đúng 1/số cụm (ca hành chính
   * ⇒ 0,5 — cách nhân sự quen đếm "nửa ngày phép"), KHÔNG theo phút (3h30 sáng / 7h30 cả ca = 0,47 là
   * con số không ai dùng). Theo giờ thì theo phút; cả ngày = 1.
   */
  tiLe: number;
  tiLeCoLuong: number;
};

export function giaiKhungNghi(nghi: readonly NghiTrongNgay[], cum: readonly Khoang[], gioCa: readonly Khoang[]): KhungNghiDaGiai {
  const khung: Khoang[] = [];
  const khungCoLuong: Khoang[] = [];
  let khongAp = false;
  let tiLe = 0;
  let tiLeCoLuong = 0;
  const phutCa = tong(gioCa);
  for (const n of nghi) {
    let k: Khoang[] = [];
    let phan = 0;
    if (n.loai === "CA_NGAY") {
      k = [...gioCa];
      phan = 1;
    } else if (n.loai === "KHUNG") {
      k = n.khung ? [n.khung] : [];
      phan = phutCa > 0 ? tong(giao(k, gioCa)) / phutCa : 0;
    } else if (cum.length < 2) {
      khongAp = true;
    } else {
      k = [n.loai === "SANG" ? cum[0]! : cum[cum.length - 1]!];
      phan = 1 / cum.length;
    }
    const trongCa = giao(k, gioCa);
    khung.push(...trongCa);
    tiLe += phan;
    if (n.coLuong) {
      khungCoLuong.push(...trongCa);
      tiLeCoLuong += phan;
    }
  }
  return { khung: gop(khung), khungCoLuong: gop(khungCoLuong), khongAp, tiLe: Math.min(1, tiLe), tiLeCoLuong: Math.min(1, tiLeCoLuong) };
}

/**
 * Cụm quét còn PHẢI chấm sau khi trừ phần nghỉ: cụm bị nghỉ phủ trọn ⇒ bỏ; nghỉ chạm đầu / cuối cụm
 * ⇒ dời mốc đầu / cuối (nghỉ 08:00–09:30 thì giờ vào cụm sáng là 09:30); nghỉ nằm GIỮA cụm ⇒ giữ
 * nguyên hai mốc ngoài (không đòi quét ra-vào quanh khoảng nghỉ).
 */
export function cumSauNghi(cum: readonly Khoang[], khungNghi: readonly Khoang[]): Khoang[] {
  if (khungNghi.length === 0) return [...cum];
  const out: Khoang[] = [];
  for (const c of cum) {
    const con = tru([c], khungNghi);
    if (con.length === 0) continue;
    out.push({ start: con[0]!.start, end: con[con.length - 1]!.end });
  }
  return out;
}
