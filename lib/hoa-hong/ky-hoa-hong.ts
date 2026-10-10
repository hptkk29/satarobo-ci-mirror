// lib/hoa-hong/ky-hoa-hong.ts — KỲ hoa hồng (tháng × cơ sở): vòng đời + kỳ GHI SỔ của một dòng.
//
// Nguồn: docs/source-commission/04 §12 (kỳ), L9. THUẦN — không DB, không đồng hồ (luật 19).
//
//   OPEN → CALCULATED → REVIEWING → LOCKED → EXPORTED → PAID     (tháng VN × cơ sở)
//
// Không có REOPEN sau LOCKED (PRD: LOCKED không đổi). Sửa = dòng điều chỉnh vào kỳ OPEN kế tiếp (L9).
//
// ⚠️ Hai thứ "kỳ" cần phân biệt (H22):
//   · `naturalPeriod` (kỳ HIỆU LỰC)  = tháng VN của `paidDate` — nó KHÔNG BAO GIỜ đổi trên dòng sổ.
//   · `periodId`      (kỳ GHI SỔ)    = kỳ đang mở nhận dòng — `kyGhiSo` dưới đây. Khác kỳ hiệu lực ⇒ `lateArrival`.
// Kỳ đã đóng KHÔNG bao giờ được mở lại để nhận dòng muộn.

export const TRANG_THAI_KY = ["OPEN", "CALCULATED", "REVIEWING", "LOCKED", "EXPORTED", "PAID"] as const;
export type TrangThaiKy = (typeof TRANG_THAI_KY)[number];

/** Kỳ nhận dòng sổ mới: chỉ OPEN và CALCULATED (đúng với trigger `hoa_hong_so_ky_mo`). */
export function laKyNhanDong(trangThai: TrangThaiKy): boolean {
  return trangThai === "OPEN" || trangThai === "CALCULATED";
}

export type KyTomTat = { thang: string; orgUnitId: string; trangThai: TrangThaiKy };

const DANG_THANG = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function laThangHopLe(t: string): boolean {
  return DANG_THANG.test(t);
}

/** Cộng `n` tháng vào "YYYY-MM". Sai dạng ⇒ ném (không đoán). */
export function congThang(thang: string, n: number): string {
  const m = DANG_THANG.exec(thang);
  if (!m) throw new Error(`Tháng không hợp lệ: "${thang}" (cần "YYYY-MM", tháng 01–12).`);
  const idx = Number(m[1]) * 12 + (Number(m[2]) - 1) + n;
  const y = Math.floor(idx / 12);
  const mo = (idx % 12) + 1;
  return `${y}-${String(mo).padStart(2, "0")}`;
}

/** Số tháng tối đa tìm kỳ mở kế tiếp trước khi coi là dữ liệu hỏng. */
const SO_THANG_TOI_DA = 120;

/**
 * Kỳ GHI SỔ của một dòng (04 §12.2).
 *
 *   kyDau = max(kyTuNhien, kyCutover)         — engine mới KHÔNG BAO GIỜ tạo/ghi kỳ < mốc (L9)
 *   = kyDau nếu kỳ đó chưa có hoặc đang OPEN/CALCULATED;
 *   ngược lại = tháng nhỏ nhất > kyDau của cùng đơn vị mà chưa có hoặc OPEN/CALCULATED.
 *
 * `kyCutover` BẮT BUỘC (luật 7). Kết quả luôn ≥ `kyCutover`.
 */
export function kyGhiSo(input: {
  kyTuNhien: string;
  orgUnitId: string;
  kyCutover: string;
  ky: readonly KyTomTat[];
}): string {
  if (!laThangHopLe(input.kyTuNhien)) throw new Error(`Kỳ tự nhiên không hợp lệ: "${input.kyTuNhien}"`);
  if (!laThangHopLe(input.kyCutover)) throw new Error(`Mốc cutover không hợp lệ: "${input.kyCutover}"`);
  const trangThai = new Map<string, TrangThaiKy>();
  for (const k of input.ky) if (k.orgUnitId === input.orgUnitId) trangThai.set(k.thang, k.trangThai);

  let thang = input.kyTuNhien < input.kyCutover ? input.kyCutover : input.kyTuNhien;
  for (let i = 0; i <= SO_THANG_TOI_DA; i++) {
    const st = trangThai.get(thang);
    if (st === undefined || laKyNhanDong(st)) return thang;
    thang = congThang(thang, 1);
  }
  throw new Error(`Không tìm được kỳ mở trong ${SO_THANG_TOI_DA} tháng kể từ ${input.kyTuNhien} (đơn vị ${input.orgUnitId}).`);
}

/** Các cặp chuyển trạng thái hợp lệ — NGUỒN DUY NHẤT; ca [NHH-PER-01] duyệt đủ 36 cặp. */
const CHUYEN_HOP_LE: ReadonlySet<string> = new Set([
  "OPEN>CALCULATED",
  "CALCULATED>CALCULATED", // Tính lại
  "CALCULATED>REVIEWING",
  "REVIEWING>CALCULATED", // trả lại (lý do bắt buộc ở tầng gọi)
  "REVIEWING>LOCKED",
  "LOCKED>EXPORTED",
  "EXPORTED>PAID",
]);

/**
 * Kiểm một lần chuyển trạng thái kỳ. Trả `null` = cho phép; chuỗi = lý do từ chối (tiếng Việt, hiện thẳng cho người dùng).
 *
 * Hai cổng dữ liệu (04 §12.1):
 *   · CALCULATED → REVIEWING và REVIEWING → LOCKED: phải đã Tính SAU thay đổi cuối cùng của tập đầu vào
 *     (`dauVaoMoiNhat` không được mới hơn `lastCalculatedAt`; bằng nhau là qua).
 *   · REVIEWING → LOCKED: không còn hàng chờ chặn. Khiếu nại mở và hàng chờ treo KHÔNG chặn (đếm ở tầng gọi).
 */
export function kiemChuyenTrangThaiKy(input: {
  tu: TrangThaiKy;
  den: TrangThaiKy;
  soHangChoChan: number;
  lastCalculatedAt: Date | null;
  dauVaoMoiNhat: Date | null;
}): string | null {
  const { tu, den } = input;
  if (!CHUYEN_HOP_LE.has(`${tu}>${den}`)) {
    if (tu === "LOCKED" || tu === "EXPORTED" || tu === "PAID") {
      if (den === "REVIEWING" || den === "CALCULATED" || den === "OPEN" || tu === den) {
        return `Kỳ đã ${tu} — không mở lại. Sửa bằng dòng điều chỉnh vào kỳ đang mở kế tiếp.`;
      }
    }
    return `Không thể chuyển kỳ từ ${tu} sang ${den}.`;
  }

  if (den === "REVIEWING" || den === "LOCKED") {
    if (input.lastCalculatedAt === null) return "Kỳ chưa được Tính — hãy bấm Tính trước.";
    if (input.dauVaoMoiNhat !== null && input.dauVaoMoiNhat.getTime() > input.lastCalculatedAt.getTime()) {
      return "Có dữ liệu đầu vào thay đổi sau lần Tính gần nhất — hãy Tính lại rồi mới tiếp tục.";
    }
  }
  if (den === "LOCKED" && input.soHangChoChan > 0) {
    return `Còn ${input.soHangChoChan} hàng chờ đang chặn khoá kỳ — xử lý xong mới khoá được.`;
  }
  return null;
}
