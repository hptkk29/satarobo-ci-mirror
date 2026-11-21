// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc modules/report/cham.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * CHẤM ĐIỂM DISC — hàm THUẦN theo hợp đồng DISC_BA.md §7.5.
 *
 * Không đụng DOM, không đụng localStorage, không đụng React (ADR-004). Bốn bước:
 *   1. Đảo chiều câu đảo
 *   2. Chuẩn hoá về thang 0–100
 *   3. Kiểm hợp lệ (HL-1..HL-5) — chạy TRƯỚC khi trả kết quả
 *   4. Xếp kiểu: đơn / pha / phổ đều
 *
 * 🔴 Vì sao phải chuẩn hoá: năm bộ đề có số câu và số mức khác nhau. Không quy về cùng
 * thang thì không bao giờ đối chiếu được bài của con với bài của bố mẹ — tức là mất
 * tính năng chủ lực của cả sản phẩm.
 */

import { NGUONG_PHA } from "@/lib/disc/engine-goc/config/disc-nguong";

import {
  MA_TRUC,
  type BoDe,
  type KetQua,
  type Kieu,
  type MaTruc,
} from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";

import { daoChieu, kiemHopLe, type TraLoi } from "./kiem-hop-le";

// Kiểu nằm ở `core` (QĐ5) — xuất lại ở đây để nơi gọi không phải nhớ hai đường dẫn.
export type { KetQua, Kieu };

/** Tổng điểm thô của một trục, sau khi đã đảo chiều các câu đảo. */
function tongTruc(boDe: BoDe, traLoi: TraLoi, truc: MaTruc): { tong: number; soCau: number } {
  let tong = 0;
  let soCau = 0;
  for (const c of boDe.cau) {
    if (c.truc !== truc) continue;
    tong += daoChieu(traLoi[c.ma], c.dao, boDe.mucToiDa);
    soCau += 1;
  }
  return { tong, soCau };
}

/**
 * Chuẩn hoá tổng thô về thang 0–100.
 *
 * Tổng thấp nhất có thể là `soCau` (mọi câu chọn mức 1), cao nhất là `soCau × mucToiDa`.
 * Biên độ = `soCau × (mucToiDa − 1)`.
 */
export function chuanHoa(tong: number, soCau: number, mucToiDa: number): number {
  const bienDo = soCau * (mucToiDa - 1);
  if (bienDo <= 0) return 0;
  const diem = ((tong - soCau) / bienDo) * 100;
  return Math.round(diem * 10) / 10;
}

/** Xếp bốn trục giảm dần. Bằng điểm thì giữ thứ tự cố định D-I-S-C. */
export function xepHangTruc(diem: Readonly<Record<MaTruc, number>>): MaTruc[] {
  return [...MA_TRUC].sort((a, b) => {
    const chenh = diem[b] - diem[a];
    if (Math.abs(chenh) > 1e-9) return chenh;
    return MA_TRUC.indexOf(a) - MA_TRUC.indexOf(b);
  });
}

/**
 * Xếp kiểu từ bốn điểm đã sắp giảm dần.
 *
 * 🔴 Thứ tự kiểm QUAN TRỌNG: phải hỏi "phổ đều" TRƯỚC. Bốn điểm sát nhau thì `d1−d2`
 * cũng nhỏ, nên nếu hỏi "pha" trước sẽ ép một cái nhãn pha lên một phổ thực chất là đều
 * — và đó là cách nhanh nhất để phụ huynh đọc xong rồi nói "không đúng con tôi".
 */
export function xepKieu(diem: Readonly<Record<MaTruc, number>>, xepHang: readonly MaTruc[]): Kieu {
  const [t1, t2] = xepHang;
  const d1 = diem[xepHang[0]];
  const d2 = diem[xepHang[1]];
  const d4 = diem[xepHang[3]];

  if (d1 - d4 < NGUONG_PHA) return { loai: "deu" };
  if (d1 - d2 >= NGUONG_PHA) return { loai: "don", truc: t1 };

  // Cặp pha viết theo thứ tự cố định D-I-S-C — sáu cặp, không phải mười hai.
  const cap = [t1, t2].sort((a, b) => MA_TRUC.indexOf(a) - MA_TRUC.indexOf(b)) as [
    MaTruc,
    MaTruc,
  ];
  return { loai: "pha", cap };
}

/**
 * Chấm một bài.
 *
 * @param giay Tổng thời gian làm bài, tính bằng giây. Không đo được thì truyền `null`
 *             — HL-4 sẽ bị bỏ qua thay vì báo bừa.
 */
export function cham(boDe: BoDe, traLoi: TraLoi, giay: number | null): KetQua {
  const kiem = kiemHopLe(boDe, traLoi, giay);
  if (kiem.chan !== null) {
    return { hopLe: false, lyDo: kiem.chan, cauThieu: kiem.cauThieu };
  }

  const diem = {} as Record<MaTruc, number>;
  for (const t of MA_TRUC) {
    const { tong, soCau } = tongTruc(boDe, traLoi, t);
    diem[t] = chuanHoa(tong, soCau, boDe.mucToiDa);
  }

  const xepHang = xepHangTruc(diem);
  return { hopLe: true, diem, xepHang, kieu: xepKieu(diem, xepHang), canhBao: kiem.canhBao };
}
