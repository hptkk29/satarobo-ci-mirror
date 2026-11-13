// lib/bao-luu/mau-don-do-rong.ts — ước độ rộng chữ Times New Roman 12pt để biết một giá trị có VỪA ô chấm chấm của mẫu không.
// Thuần, không phụ thuộc DOM/font của máy.
//
// VÌ SAO KHÔNG ĐẾM KÝ TỰ: ô trên giấy là "nhãn + giá trị" nằm trong MỘT cột có tab phải. Cột rộng 244pt (trái) / 218pt (phải)
// nhưng nhãn chiếm sẵn một phần — "Giáo viên phụ trách: " ăn gần nửa cột phải, nên chỗ còn cho giá trị chỉ ~22 ký tự, trong khi
// "Mã học viên: " cho ~45. Đếm "~45 ký tự" cho mọi ô để lọt các ô hẹp: Word đẩy tab sang dòng khác và đơn tràn sang trang hai
// (đo bằng Word thật 13/10/2026: hai khoá ngắn 40 ký tự đã đủ làm đơn 2 trang).
//
// Số đo: bảng độ rộng chuẩn của Times-Roman (Adobe AFM, đơn vị 1/1000 em) — Times New Roman cùng số đo. Dấu thanh/dấu mũ không
// đổi độ rộng nên bỏ dấu (NFD) rồi tra chữ gốc; riêng Đ/đ tra riêng.

const RONG: Record<string, number> = {
  " ": 250, "!": 333, '"': 408, "#": 500, $: 500, "%": 833, "&": 778, "'": 180, "(": 333, ")": 333, "*": 500, "+": 564, ",": 250, "-": 333,
  ".": 250, "/": 278, ":": 278, ";": 278, "<": 564, "=": 564, ">": 564, "?": 444, "@": 921,
  A: 722, B: 667, C: 667, D: 722, E: 611, F: 556, G: 722, H: 722, I: 333, J: 389, K: 722, L: 611, M: 889, N: 722, O: 722, P: 556, Q: 722,
  R: 667, S: 556, T: 611, U: 722, V: 722, W: 944, X: 722, Y: 722, Z: 611,
  "[": 333, "]": 333, _: 500,
  a: 444, b: 500, c: 444, d: 500, e: 444, f: 333, g: 500, h: 500, i: 278, j: 278, k: 500, l: 278, m: 778, n: 500, o: 500, p: 500, q: 500,
  r: 333, s: 389, t: 278, u: 500, v: 500, w: 722, x: 500, y: 500, z: 444,
  "–": 500, "—": 1000, "…": 1000, "☐": 1000, "☒": 1000,
};
const MAC_DINH = 500;

/** Độ rộng ước tính của một chuỗi, đơn vị pt, ở cỡ chữ 12pt (cỡ của mẫu). */
export function doRongPt(chu: string): number {
  let tong = 0;
  for (const c of chu.normalize("NFD")) {
    const ma = c.codePointAt(0)!;
    if (ma >= 0x0300 && ma <= 0x036f) continue; // dấu kết hợp: không chiếm chỗ
    if (c === "Đ") tong += 722;
    else if (c === "đ") tong += 500;
    else if (c >= "0" && c <= "9") tong += 500;
    else tong += RONG[c] ?? MAC_DINH;
  }
  return (tong * 12) / 1000;
}

/** Cột của mẫu (pt), lấy từ các tab trong .docx: 4880 / (5000→9354) / 9354 twips, 20 twips = 1pt. */
export const CHIEU_RONG_COT_PT = { 1: 4880 / 20, 2: (9354 - 5000) / 20, 0: 9354 / 20 } as const;

/** Chừa cho đường chấm chấm: một giá trị sát mép cột trông như không còn chỗ ký và dễ tràn khi Word đổi font. */
export const LE_CHAM_PT = 10;
