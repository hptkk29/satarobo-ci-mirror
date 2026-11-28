// lib/bao-luu/qua-han-tru-bao-luu.ts — "ĐỢT NÀY QUÁ HẠN BAO NHIÊU NGÀY, TRỪ THỜI GIAN BẢO LƯU". THUẦN, không DB. K19 (vòng 3 sau nghiệm thu, 12/10/2026).
//
// ─────────────────────────────────────────────────────────────────────────────
// QUY CHẾ SR.QD.236 Phụ lục 01, Mục 15: *"Đợt đã quá hạn trước ngày bảo lưu chỉ được tạm dừng tính quá hạn trong thời gian bảo lưu; khi phục học nghĩa vụ
// thanh toán tiếp tục."* Chủ dự án chốt K19: KHÔNG dời hạn sổ cũ — sửa ở ĐẦU ĐỌC bằng MỘT hàm dùng chung.
//
//     số ngày quá hạn = (homNay − hạn đợt)  −  số ngày nằm TRONG các khoảng bảo lưu đã có hiệu lực
//
// Một công thức cho cả ba giai đoạn, không nhánh nào:
//   · ĐANG bảo lưu         ⇒ đóng băng (khoảng chạy tới `homNay` nên phần trừ tăng đúng bằng phần tăng của hiệu);
//   · SAU phục học         ⇒ đếm tiếp từ chỗ đã dừng (khoảng đã đóng, phần trừ cố định);
//   · đợt tới hạn GIỮA kỳ ⇒ 0 ngày lúc phục học (cả quãng từ hạn tới ngày phục học nằm trong khoảng).
//
// Cách đếm (đã khớp A6 — vòng 2): ngày lịch VN; một khoảng [tu, den] góp (den − tu) ngày chồng với [hạn, homNay]. Bắt đầu bảo lưu ngày S, phục học ngày R ⇒ trừ
// đúng R − S ngày. Quá hạn 12 ngày lúc S, phục học sau 30 ngày ⇒ 12; sau thêm 5 ngày ⇒ 17.
//
// ⚠️ Không trừ hai lần: hạn của `PaymentRequest` đã được dời theo bảo lưu (`pauseShiftDays`) nằm SAU ngày phục học, nên phần chồng với khoảng bằng 0 — công thức
// tự đúng, không cần nhánh "đợt này đã dời". Khoảng của các hồ sơ chồng nhau (bé học hai khoá, hai hồ sơ cùng lúc) được HỢP NHẤT trước khi trừ.
// ⚠️ Đơn nhiều con: chỉ những ngày TẤT CẢ các bé đều đang bảo lưu mới được trừ (`giaoKhoang`) — khoản của bé còn đi học vẫn đếm bình thường.
import { vnDateOnly } from "@/lib/time/vn";

const MS_NGAY = 24 * 60 * 60 * 1000;

/** Một khoảng tạm dừng. `den = null` = đang chạy (tính tới `homNay`). */
export type KhoangTamDung = { tu: Date; den: Date | null };

/** Số thứ tự ngày lịch VN (nguyên). */
export function ngaySo(d: Date): number {
  return Math.round(vnDateOnly(d).getTime() / MS_NGAY);
}

type DoanSo = [number, number];

function hopNhatSo(ds: readonly DoanSo[]): DoanSo[] {
  const xep = [...ds].filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const ra: DoanSo[] = [];
  for (const [a, b] of xep) {
    const cuoi = ra[ra.length - 1];
    if (cuoi && a <= cuoi[1]) cuoi[1] = Math.max(cuoi[1], b);
    else ra.push([a, b]);
  }
  return ra;
}

const sangSo = (k: readonly KhoangTamDung[]): DoanSo[] =>
  hopNhatSo(k.map((x) => [ngaySo(x.tu), x.den ? ngaySo(x.den) : Number.POSITIVE_INFINITY] as DoanSo));

/** Ngày chồng lên nhau của hai tập khoảng đã hợp nhất. */
function giaoHaiSo(a: readonly DoanSo[], b: readonly DoanSo[]): DoanSo[] {
  const ra: DoanSo[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i]![0], b[j]![0]);
    const hi = Math.min(a[i]![1], b[j]![1]);
    if (hi > lo) ra.push([lo, hi]);
    if (a[i]![1] < b[j]![1]) i++;
    else j++;
  }
  return ra;
}

const sangDate = (n: number): Date => new Date(n * MS_NGAY);

/** Hợp nhất các khoảng chồng nhau (cùng một bé, nhiều hồ sơ). */
export function hopNhatKhoang(khoang: readonly KhoangTamDung[]): KhoangTamDung[] {
  return sangSo(khoang).map(([a, b]) => ({ tu: sangDate(a), den: Number.isFinite(b) ? sangDate(b) : null }));
}

/**
 * Khoảng mà TẤT CẢ các bé đều đang bảo lưu (cho đơn nhiều con). Danh sách rỗng hoặc có một bé không có khoảng nào ⇒ rỗng.
 */
export function giaoKhoang(theoBe: readonly (readonly KhoangTamDung[])[]): KhoangTamDung[] {
  if (theoBe.length === 0) return [];
  let cur = sangSo(theoBe[0]!);
  for (const k of theoBe.slice(1)) {
    cur = giaoHaiSo(cur, sangSo(k));
    if (cur.length === 0) return [];
  }
  return cur.map(([a, b]) => ({ tu: sangDate(a), den: Number.isFinite(b) ? sangDate(b) : null }));
}

/**
 * Số ngày quá hạn của một đợt, TRỪ thời gian bảo lưu. `khoang` rỗng ⇒ đúng bằng phép tính cũ (`homNay − hạn`, không âm).
 * `homNay` là THAM SỐ (luật 19).
 */
export function tinhSoNgayQuaHanTruBaoLuu(hanDot: Date, homNay: Date, khoang: readonly KhoangTamDung[]): number {
  const d = ngaySo(hanDot);
  const t = ngaySo(homNay);
  const tho = t - d;
  if (tho <= 0) return 0;
  let tru = 0;
  for (const [a, b] of sangSo(khoang)) {
    tru += Math.max(0, Math.min(t, b) - Math.max(d, a));
  }
  return Math.max(0, tho - tru);
}

export type NhomTuoiNo = "none" | "1-7" | "8-30" | ">30";

/** Nhóm tuổi nợ theo SỐ NGÀY quá hạn (cùng ngưỡng với `overdueBucket`). */
export function nhomTheoSoNgay(soNgay: number): NhomTuoiNo {
  if (soNgay <= 0) return "none";
  if (soNgay <= 7) return "1-7";
  if (soNgay <= 30) return "8-30";
  return ">30";
}
