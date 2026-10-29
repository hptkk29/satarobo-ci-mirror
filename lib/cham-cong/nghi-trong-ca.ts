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
import { cumQuetKyVong } from "./cum-quet";
import { giao, gop, khoangTu, tong, tru, type Khoang } from "./khoang-gio";

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

/**
 * Ca có nghỉ NỬA BUỔI được không — đọc `soCapQuetKyVong` của ô ca (0/1/2). Chỉ ca khai 2 cụm quét
 * (HC, ST…) mới có "buổi sáng / buổi chiều" để nghỉ; ca một buổi (S, C, T) và ca khai 1 cụm (SC, CG…)
 * thì `giaiKhungNghi` gắn `khongAp` và cổng duyệt từ chối. Form, cổng nộp đơn và câu "Khi duyệt sẽ"
 * cùng hỏi hàm này để không hứa một thứ lúc duyệt sẽ bị chặn (sự cố 27/10/2026: ca T nộp "nửa buổi chiều").
 */
export function caChiaNuaBuoi(soCapQuetKyVong: number | null | undefined): boolean {
  return soCapQuetKyVong === 2;
}

/** Đoạn làm bắt đầu từ mốc này trở đi là "buổi tối"; trước {@link MOC_BUOI_CHIEU} là "buổi sáng". */
export const MOC_BUOI_CHIEU = "12:00";
export const MOC_BUOI_TOI = "17:00";

export type BuoiCuaCa = "SANG" | "CHIEU" | "TOI";
export const NHAN_NUT_BUOI: Record<BuoiCuaCa, string> = { SANG: "Nửa buổi sáng", CHIEU: "Nửa buổi chiều", TOI: "Nửa buổi tối" };

/** Một nút «Nửa buổi …» trên form nghỉ — đã quy sẵn ra đúng thứ form gửi đi. */
export type LuaChonBuoi = {
  buoi: BuoiCuaCa;
  /** Ca hành chính chia 2 cụm quét (HC) ⇒ «nửa buổi» cũ (đúng 0,5 công); ca khác ⇒ «theo giờ» với `khung`. */
  leaveDurationType: "HALF_DAY_AM" | "HALF_DAY_PM" | "HOURLY";
  /** Khung gửi kèm khi `HOURLY`; `null` với nửa buổi theo cụm. */
  khung: { tu: string; den: string } | null;
  /** Cụm còn PHẢI quét sau khi nghỉ — cùng phép engine (`cumSauNghi`), để form nói đúng giờ vào / ra. */
  conQuet: { vao: string; ra: string }[];
};

type DoanCa = { start: string; end: string; kind: string };
const hhmm = (phut: number) => `${String(Math.floor(phut / 60)).padStart(2, "0")}:${String(phut % 60).padStart(2, "0")}`;
const buoiCua = (start: string): BuoiCuaCa => (start < MOC_BUOI_CHIEU ? "SANG" : start < MOC_BUOI_TOI ? "CHIEU" : "TOI");

/**
 * Các nút «Nửa buổi …» của một ca (27/10/2026, chủ dự án: "hệ thống tự nhận diện buổi mà nhân viên đó
 * nghỉ" — ca sáng+chiều ⇒ sáng / chiều; ca chiều+tối ⇒ chiều / tối). Đọc `segments` CHỤP trên ô ca:
 * đoạn `WORK` chia buổi theo giờ BẮT ĐẦU (trước 12:00 sáng · trước 17:00 chiều · còn lại tối); đoạn nghỉ
 * có lương thuộc buổi ĐỨNG TRƯỚC nó (CT: chiều 13:45–17:30 gồm nghỉ 16:30–17:30 ⇒ nghỉ chiều thì vào lúc
 * 17:30, nghỉ tối thì ra lúc 17:30 — đúng chốt 17:30 của nút tối). Ca dưới hai buổi ⇒ `[]`: nghỉ trọn ca
 * là «Cả ngày», một phần là «Theo giờ».
 *
 * Ca khai 2 cụm quét (HC · ST) giữ đường «nửa buổi» cũ (1/2 công) — nhãn nút theo buổi thật (ST: sáng /
 * tối). Mọi ca khác đi «theo giờ» với đúng khung của buổi (SC sáng 07:45–11:30 · CT tối 17:30–21:00).
 * KHÔNG đẻ thời lượng mới, không đổi công thức công: cùng đường duyệt và cùng cách tính phút đã có.
 */
export function cacBuoiNghi(segments: unknown, soCapQuetKyVong: number | null | undefined): LuaChonBuoi[] {
  if (!Array.isArray(segments)) return [];
  const doan = (segments as { start?: unknown; end?: unknown; kind?: unknown }[])
    .filter((d): d is DoanCa => typeof d?.kind === "string" && typeof d.start === "string" && typeof d.end === "string" && d.start < d.end)
    .sort((x, y) => (x.start < y.start ? -1 : 1));
  const nhom: { buoi: BuoiCuaCa; tu: string; den: string }[] = [];
  for (const d of doan) {
    const cuoi = nhom[nhom.length - 1];
    if (d.kind !== "WORK") {
      if (cuoi && d.end > cuoi.den) cuoi.den = d.end;
      continue;
    }
    const b = buoiCua(d.start);
    if (cuoi && cuoi.buoi === b) cuoi.den = d.end > cuoi.den ? d.end : cuoi.den;
    else nhom.push({ buoi: b, tu: d.start, den: d.end });
  }
  if (nhom.length < 2) return [];

  const gioCa = gop(doan.map((d) => khoangTu(d.start, d.end)).filter((k): k is Khoang => k !== null));
  const soCap = soCapQuetKyVong === 0 || soCapQuetKyVong === 2 ? soCapQuetKyVong : 1;
  const cum = cumQuetKyVong(gioCa, soCap);
  // Ca khai 2 cụm quét (HC · ST) ⇒ mỗi buổi đúng một cụm ⇒ giữ đường «nửa buổi» cũ (1/2 công).
  const theoCum = soCap === 2 && nhom.length === 2;

  return nhom.map((g, i) => {
    const khung = theoCum ? null : { tu: g.tu, den: g.den };
    const nghi: NghiTrongNgay = theoCum
      ? { loai: i === 0 ? "SANG" : "CHIEU", khung: null, coLuong: false, nguon: "LEAVE" }
      : { loai: "KHUNG", khung: khoangTu(khung!.tu, khung!.den), coLuong: false, nguon: "LEAVE" };
    const conQuet = cumSauNghi(cum, giaiKhungNghi([nghi], cum, gioCa).khung, gioCa).map((c) => ({ vao: hhmm(c.start), ra: hhmm(c.end) }));
    return {
      buoi: g.buoi,
      leaveDurationType: theoCum ? (i === 0 ? "HALF_DAY_AM" : "HALF_DAY_PM") : "HOURLY",
      khung,
      conQuet,
    };
  });
}

/** Câu từ chối khi nghỉ nửa buổi trên ca không chia buổi — chỉ đường cho người nộp. */
export function loiCaKhongChiaNuaBuoi(maCa: string | null): string {
  return `Ca ${maCa ?? "ngày này"} không chia buổi sáng / chiều — nghỉ trọn ca thì chọn «Cả ngày», nghỉ một phần thì chọn «Theo giờ»`;
}

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
 * nguyên hai mốc ngoài (không đòi quét ra-vào quanh khoảng nghỉ). `gioCa` BẮT BUỘC: mốc mới phải rơi
 * vào giờ ca, không rơi vào khoảng hở không lương.
 */
export function cumSauNghi(cum: readonly Khoang[], khungNghi: readonly Khoang[], gioCa: readonly Khoang[]): Khoang[] {
  if (khungNghi.length === 0) return [...cum];
  const out: Khoang[] = [];
  for (const c of cum) {
    // Phần còn lại chỉ tính trong GIỜ CA: khoảng hở không lương giữa hai đoạn (SC 11:30–13:45) không
    // phải giờ phải có mặt. Thiếu bước này thì nghỉ sáng ca SC (07:45–11:30) dời giờ vào về 11:30 và
    // người vào đúng 13:45 bị ghi đi muộn 130 phút (27/10/2026).
    const con = giao(tru([c], khungNghi), gioCa);
    if (con.length === 0) continue;
    out.push({ start: con[0]!.start, end: con[con.length - 1]!.end });
  }
  return out;
}
