// lib/finance/hoa-don/so-tien-bang-chu.ts — "Số tiền viết bằng chữ" của hoá đơn GTGT.
// THUẦN.
//
// Ô này BẮT BUỘC có trên mẫu và là thứ người ta đối chiếu bằng mắt với cột tổng. Ba tờ
// thật đo được (E:\websatarobo data\hoadon) là ba ca kiểm:
//   2.000.000 → "Hai triệu đồng."
//   4.320.000 → "Bốn triệu ba trăm hai mươi nghìn đồng."
//   8.976.000 → "Tám triệu chín trăm bảy mươi sáu nghìn đồng."
//
// ⚠️ Ba bẫy của tiếng Việt mà bản viết vội nào cũng sụp:
//   · **mươi/lăm/mốt**: 21 là "hai mươi mốt" (không phải "hai mươi một"), 25 là "hai mươi
//     lăm", 15 là "mười lăm", 10 là "mười" (không phải "một mươi").
//   · **"lẻ"**: 105 là "một trăm lẻ năm", không phải "một trăm không trăm năm".
//   · **nhóm giữa bằng 0**: 1.000.005 là "một triệu không trăm lẻ năm" — nhóm nghìn bằng 0
//     nhưng KHÔNG được bỏ, vì bỏ thì thành "một triệu năm" (= 1.500.000 trong cách nói
//     thường ngày). Đây là bẫy đắt nhất: nó chỉ lộ ra ở số lẻ, mà hầu hết học phí là số
//     tròn nên test viết bằng dữ liệu tròn sẽ xanh vĩnh viễn.
const CHU_SO = [
  "không",
  "một",
  "hai",
  "ba",
  "bốn",
  "năm",
  "sáu",
  "bảy",
  "tám",
  "chín",
];

/** Đọc một nhóm 3 chữ số. `dayDu` = phải đọc cả "không trăm" (nhóm không đứng đầu). */
function docBaChuSo(n: number, dayDu: boolean): string {
  const tram = Math.floor(n / 100);
  const chuc = Math.floor((n % 100) / 10);
  const donVi = n % 10;
  const ra: string[] = [];

  if (tram > 0 || dayDu) ra.push(`${CHU_SO[tram]} trăm`);

  if (chuc === 0) {
    // "lẻ" chỉ xuất hiện khi PHÍA TRƯỚC đã có chữ (trăm), nếu không thì đọc trần.
    if (donVi > 0 && ra.length > 0) ra.push("lẻ", CHU_SO[donVi]);
    else if (donVi > 0) ra.push(CHU_SO[donVi]);
    return ra.join(" ");
  }

  ra.push(chuc === 1 ? "mười" : `${CHU_SO[chuc]} mươi`);
  if (donVi === 1 && chuc > 1) ra.push("mốt");
  else if (donVi === 5) ra.push("lăm");
  else if (donVi > 0) ra.push(CHU_SO[donVi]);
  return ra.join(" ");
}

const HANG = ["", "nghìn", "triệu", "tỷ", "nghìn tỷ", "triệu tỷ"];

/**
 * Đọc số tiền VND thành chữ, viết hoa chữ đầu, kết thúc bằng "đồng." — đúng dạng in trên
 * cả ba tờ mẫu.
 */
export function soTienBangChu(so: number): string {
  const n = Math.max(0, Math.round(so));
  if (n === 0) return "Không đồng.";

  // Tách thành các nhóm 3 chữ số, nhóm nhỏ nhất trước.
  const nhom: number[] = [];
  let con = n;
  while (con > 0) {
    nhom.push(con % 1000);
    con = Math.floor(con / 1000);
  }

  const phan: string[] = [];
  for (let i = nhom.length - 1; i >= 0; i--) {
    const g = nhom[i];
    // "Nhóm đầu" = nhóm ĐÃ ĐỌC đầu tiên, không phải nhóm cao nhất: 1.000.005 bỏ nhóm
    // nghìn nên nhóm đơn vị vẫn phải mang "không trăm".
    const dauTien = phan.length === 0;
    // Nhóm 0 thì BỎ HẲN — "không trăm" của nó đã được nhóm sau đọc hộ nhờ `dayDu`.
    //
    // Bản đầu đọc thêm một "không trăm" cho chính nhóm 0 và ra "một triệu không trăm
    // KHÔNG TRĂM lẻ năm" cho 1.000.005. Ca [SBC-03] bắt được ngay — đó là lý do ca đó
    // dùng số LẺ: mọi số tròn (học phí thật) đều đi qua nhánh này mà không lộ gì.
    if (g === 0) continue;
    phan.push(`${docBaChuSo(g, !dauTien)} ${HANG[i]}`.trim());
  }

  const chu = phan.join(" ").replace(/\s+/g, " ").trim();
  return `${chu.charAt(0).toUpperCase()}${chu.slice(1)} đồng.`;
}
