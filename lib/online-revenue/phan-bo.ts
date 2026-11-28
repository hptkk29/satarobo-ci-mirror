// lib/online-revenue/phan-bo.ts — chia MỘT số tiền nguyên theo trọng số, KHÔNG làm mất/đẻ ra đồng nào. THUẦN.
//
// Vì sao cần: tiền của đơn Online nằm ở mức ĐƠN (`Payment.orderItemId` NULL), còn báo cáo theo KHOÁ cần biết khoản đó thuộc khoá nào.
// Đơn một khoá ⇒ không phải chia. Đơn nhiều khoá / có học cụ / có phí giao ⇒ chia theo thành tiền từng nhóm dòng (trọng số = giá dòng sau giảm).
// Phương pháp phần dư lớn nhất (Hamilton): mỗi nhóm lấy phần nguyên, đồng lẻ còn lại giao cho nhóm có phần dư lớn nhất; bằng nhau ⇒ khoá chữ cái nhỏ hơn.
// Tổng các phần LUÔN bằng đúng số tiền gốc (kể cả số âm) — bất biến mà toàn bộ phép đối soát dựa vào.

// Không dùng literal `0n`: tsconfig của repo nhắm ES2017 (BigInt literal cần ES2020), còn hàm dựng `BigInt()` thì chạy được.
const ZERO = BigInt(0);
const ONE = BigInt(1);

/**
 * Trả `null` khi không có trọng số dương nào (người gọi tự quyết nơi nhận). Trọng số âm/không nguyên bị coi là 0.
 * Dùng BigInt cho tích `soTien × trongSo` (1e9 × 1e9 vượt 2^53).
 */
export function chiaTheoTrongSo(soTien: number, trongSo: ReadonlyMap<string, number>): Map<string, number> | null {
  if (!Number.isSafeInteger(soTien)) throw new Error("soTien phải là số nguyên");
  const muc = [...trongSo.entries()].filter(([, w]) => Number.isSafeInteger(w) && w > 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (muc.length === 0) return null;
  const dau = soTien < 0 ? -1 : 1;
  const tuyetDoi = BigInt(Math.abs(soTien));
  const tong = muc.reduce((s, [, w]) => s + BigInt(w), ZERO);
  const phan = muc.map(([k, w]) => {
    const tich = tuyetDoi * BigInt(w);
    return { k, nguyen: tich / tong, du: tich % tong };
  });
  let con = tuyetDoi - phan.reduce((s, p) => s + p.nguyen, ZERO);
  const thuTu = [...phan].sort((a, b) => (a.du === b.du ? (a.k < b.k ? -1 : 1) : a.du > b.du ? -1 : 1));
  for (const p of thuTu) {
    if (con <= ZERO) break;
    p.nguyen += ONE;
    con -= ONE;
  }
  const ra = new Map<string, number>();
  for (const p of phan) ra.set(p.k, dau * Number(p.nguyen) || 0); // `|| 0`: tránh -0
  return ra;
}
