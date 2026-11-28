// lib/online-revenue/thoi-gian.ts — KHOẢNG NGÀY + NHÓM KỲ theo giờ VN (UTC+7, không có giờ mùa hè). THUẦN.
//
// Khoảng báo cáo là NỬA MỞ theo giờ VN: [00:00 ngày `tu`, 00:00 ngày `den`+1). Người dùng nhập NGÀY (YYYY-MM-DD), cả hai đầu ĐỀU GỒM.
// Một khoản thu 23:30 ngày 31 thuộc ngày 31; 00:10 ngày 01 thuộc ngày 01 — đúng theo lịch Việt Nam chứ không theo UTC.
import { congNgay, dauNgayTuChuoi, laNgayHopLe, ngayVN, soNgayGiua } from "@/lib/format/thoi-gian-vn";

/** Trần số ngày của MỘT lần gọi — để không quét vô hạn. */
export const TRAN_SO_NGAY = 400;
export const NHOM_THOI_GIAN = ["day", "week", "month"] as const;
export type NhomThoiGian = (typeof NHOM_THOI_GIAN)[number];
export const laNhomThoiGian = (v: string): v is NhomThoiGian => (NHOM_THOI_GIAN as readonly string[]).includes(v);

export type KhoangNgay = {
  /** Ngày đầu (gồm), YYYY-MM-DD giờ VN. */
  tu: string;
  /** Ngày cuối (gồm), YYYY-MM-DD giờ VN. */
  den: string;
  /** 00:00 giờ VN của `tu` — mốc DƯỚI (gồm). */
  batDau: Date;
  /** 00:00 giờ VN của ngày SAU `den` — mốc TRÊN (KHÔNG gồm). */
  ketThuc: Date;
  soNgay: number;
};

export type LoiKhoang = { ma: "THIEU_THAM_SO" | "NGAY_SAI" | "KHOANG_NGUOC" | "KHOANG_QUA_DAI"; thongBao: string };

/**
 * `tu`/`den` cùng vắng ⇒ 30 ngày gần nhất tính tới HÔM NAY (giờ VN). Chỉ một trong hai ⇒ lỗi (không đoán đầu còn lại).
 * `now` BẮT BUỘC (đọc đồng hồ ở chỗ gọi, không ở đây — luật 19).
 */
export function docKhoangNgay(tu: string | null, den: string | null, now: Date): { ok: true; khoang: KhoangNgay } | { ok: false; loi: LoiKhoang } {
  if (tu === null && den === null) {
    const cuoi = ngayVN(now);
    return docKhoangNgay(congNgay(cuoi, -29), cuoi, now);
  }
  if (tu === null || den === null) return { ok: false, loi: { ma: "THIEU_THAM_SO", thongBao: "Phải khai cả `tu` và `den` (hoặc bỏ cả hai để lấy 30 ngày gần nhất)." } };
  if (!laNgayHopLe(tu) || !laNgayHopLe(den)) return { ok: false, loi: { ma: "NGAY_SAI", thongBao: "Ngày phải dạng YYYY-MM-DD và có thật trên lịch." } };
  if (den < tu) return { ok: false, loi: { ma: "KHOANG_NGUOC", thongBao: "`den` phải bằng hoặc sau `tu`." } };
  const soNgay = soNgayGiua(tu, den) + 1;
  if (soNgay > TRAN_SO_NGAY) return { ok: false, loi: { ma: "KHOANG_QUA_DAI", thongBao: `Khoảng tối đa ${TRAN_SO_NGAY} ngày (đang xin ${soNgay}).` } };
  return { ok: true, khoang: { tu, den, batDau: dauNgayTuChuoi(tu), ketThuc: dauNgayTuChuoi(congNgay(den, 1)), soNgay } };
}

/** Thứ Hai của tuần chứa ngày "YYYY-MM-DD" (tuần ISO, thứ Hai là ngày đầu). */
export function thuHaiCuaTuan(ngay: string): string {
  const thu = new Date(`${ngay}T00:00:00Z`).getUTCDay(); // 0 = Chủ nhật
  return congNgay(ngay, -((thu + 6) % 7));
}

/** Khoá kỳ của một ngày VN: day = YYYY-MM-DD · week = ngày thứ Hai của tuần · month = YYYY-MM. */
export function khoaKyCuaNgay(ngay: string, nhom: NhomThoiGian): string {
  if (nhom === "day") return ngay;
  if (nhom === "month") return ngay.slice(0, 7);
  return thuHaiCuaTuan(ngay);
}

/** Khoá kỳ của một THỜI ĐIỂM (đổi sang ngày VN trước). */
export function khoaKy(thoiDiem: Date, nhom: NhomThoiGian): string {
  return khoaKyCuaNgay(ngayVN(thoiDiem), nhom);
}

/** Mọi khoá kỳ chạm tới khoảng (kỳ đầu/cuối có thể chỉ nằm một phần trong khoảng). Có thứ tự tăng dần. */
export function lietKeKy(khoang: KhoangNgay, nhom: NhomThoiGian): string[] {
  const ra: string[] = [];
  for (let i = 0; i < khoang.soNgay; i += 1) {
    const k = khoaKyCuaNgay(congNgay(khoang.tu, i), nhom);
    if (ra[ra.length - 1] !== k) ra.push(k);
  }
  return ra;
}
