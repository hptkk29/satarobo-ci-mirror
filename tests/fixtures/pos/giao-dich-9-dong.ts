// tests/fixtures/pos/giao-dich-9-dong.ts — FIXTURE ĐẶC TẢ của file "Danh sách giao dịch V2"
// (SmartPOS Techcombank), dựng theo đặc tả cột để phủ CA BIÊN mà file thật chưa có.
//
// ⚠️ ĐỪNG "thay bằng file thật": fixture THẬT (11 dòng thật 29/09/2026 đã che, 2 máy, giữ
// data descriptor của zip ngân hàng) đã có riêng ở `tests/fixtures/pos/smartpos-that.ts`
// (ca `[POS-THAT-xx]` + `[POS-THAT-DB-xx]`). Tệp này giữ vai trò KHÁC: nó cố ý mang thứ file
// 29/09 không có — dòng có mã phiếu 5 ký tự trong ghi chú, cột "Tên chủ thẻ" mang tên người
// thật (file thật chỉ có "/"), cột lạ xen giữa để kiểm tìm cột theo TÊN — nên xoá hay đổi nó
// theo file thật là mất các ca biên đó.
//
// Hình dạng (9 dòng):
//   · 3 dòng "Thanh toán" + "Thành công" — dòng thứ 3 là GỐC của cặp hủy
//     (`Trạng thái Hoàn/Hủy` = "Hủy toàn phần");
//   · 5 dòng "Thất bại" có ghi chú;
//   · 1 dòng "Hủy" — số tiền ÂM, `Mã giao dịch gốc` trỏ dòng gốc, CÙNG `Mã giao dịch thẻ`.
// Header = đủ COT_BAT_BUOC + "Tên chủ thẻ", "Ví điện tử", "DPAN", "Số tiền đơn hàng" + cột giả
// "Cột khác N" cho đủ 65 cột (file thật có 65 cột). Số tiền là Ô SỐ, ô trống là ''.
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { COT_BAT_BUOC } from "@/lib/payments/pos/kieu";
import { sinhMa } from "@/lib/payments/ma-phieu";

export const MA_1 = sinhMa(1234);
export const MA_2 = sinhMa(98765);
export const MA_3 = sinhMa(200000);

export const TEN_CHU_THE = "NGUYEN VAN CHU THE";

const COT_PHU = ["Tên chủ thẻ", "Ví điện tử", "DPAN", "Số tiền đơn hàng"];
export const SO_COT = 65;

export const HEADER: string[] = [
  // Xen cột phụ vào giữa để chắc tầng đọc tìm cột theo TÊN chứ không theo vị trí.
  "Cột khác 1",
  ...COT_BAT_BUOC.slice(0, 6),
  "Tên chủ thẻ",
  ...COT_BAT_BUOC.slice(6),
  ...COT_PHU.slice(1),
];
for (let i = 2; HEADER.length < SO_COT; i++) HEADER.push(`Cột khác ${i}`);

type Ban = Record<string, string | number>;

function dong(o: Ban): (string | number)[] {
  return HEADER.map((h) => {
    if (h in o) return o[h]!;
    if (h === "Tên chủ thẻ") return TEN_CHU_THE;
    if (h === "Ví điện tử") return "";
    if (h === "DPAN") return "";
    if (h === "Số tiền đơn hàng") return typeof o["Số tiền thanh toán"] === "number" ? o["Số tiền thanh toán"]! : "";
    if (h.startsWith("Cột khác")) return "rác";
    return "";
  });
}

const chung = {
  "Hình thức thanh toán": "Thẻ",
  "Mã quầy thanh toán": "Q01",
  "Mã thiết bị": "TCBPOS0001",
  "Loại thẻ": "VISA",
  "Mã hạch toán": "HT2609290001",
  "Mã đơn hàng": "",
};

const thatBai = (i: number, tien: number, ghiChu: string): Ban => ({
  ...chung,
  "Mã giao dịch": `FT2609290F0${i}`,
  "Loại giao dịch": "Thanh toán",
  "Trạng thái giao dịch": "Thất bại",
  "Số tiền thanh toán": tien,
  "Thời gian giao dịch": `2026/09/29 09:0${i}:00`,
  "Diễn giải đơn hàng": ghiChu,
  "Mã chuẩn chi": "",
  "Mã giao dịch thẻ": "",
  "Mã giao dịch gốc": "",
  "Trạng thái Hoàn/Hủy": "",
  "Số thẻ": "411111******1111",
  "Phí giao dịch": "",
});

export const DONG_BAN: Ban[] = [
  {
    ...chung,
    "Mã giao dịch": "FT2609290001",
    "Loại giao dịch": "Thanh toán",
    "Trạng thái giao dịch": "Thành công",
    "Số tiền thanh toán": 1_500_000,
    "Thời gian giao dịch": "2026/09/29 17:31:35",
    "Diễn giải đơn hàng": `Kiet 0328545229 ${MA_1}`,
    "Mã chuẩn chi": "123456",
    "Mã giao dịch thẻ": "RRN000000001",
    "Mã giao dịch gốc": "",
    "Trạng thái Hoàn/Hủy": "",
    "Số thẻ": "970436******1234",
    "Phí giao dịch": 16500,
  },
  {
    ...chung,
    "Mã giao dịch": "FT2609290002",
    "Loại giao dịch": "Thanh toán",
    "Trạng thái giao dịch": "Thành công",
    "Số tiền thanh toán": 2_000_000,
    "Thời gian giao dịch": "2026/09/29 08:05:09",
    "Diễn giải đơn hàng": MA_2,
    "Mã chuẩn chi": "654321",
    "Mã giao dịch thẻ": "RRN000000002",
    "Mã giao dịch gốc": "",
    "Trạng thái Hoàn/Hủy": "",
    "Số thẻ": "512345******6789",
    "Phí giao dịch": "",
  },
  // GỐC của cặp hủy
  {
    ...chung,
    "Mã giao dịch": "FT2609290003",
    "Loại giao dịch": "Thanh toán",
    "Trạng thái giao dịch": "Thành công",
    "Số tiền thanh toán": 3_000_000,
    "Thời gian giao dịch": "2026/09/29 10:00:00",
    "Diễn giải đơn hàng": `Be An ${MA_3}`,
    "Mã chuẩn chi": "111111",
    "Mã giao dịch thẻ": "RRN000000003",
    "Mã giao dịch gốc": "",
    "Trạng thái Hoàn/Hủy": "Hủy toàn phần",
    "Số thẻ": "970436******4321",
    "Phí giao dịch": 33000,
  },
  thatBai(1, 1_000_000, "Thẻ hết hạn"),
  thatBai(2, 1_000_000, "Không đủ số dư"),
  thatBai(3, 500_000, "Sai PIN"),
  thatBai(4, 500_000, "Khách hủy trên máy"),
  thatBai(5, 250_000, "Hết thời gian chờ"),
  // Dòng HỦY — số tiền âm, trỏ gốc, cùng Mã giao dịch thẻ
  {
    ...chung,
    "Mã giao dịch": "FT2609290004",
    "Loại giao dịch": "Hủy",
    "Trạng thái giao dịch": "Thành công",
    "Số tiền thanh toán": -3_000_000,
    "Thời gian giao dịch": "2026/09/29 10:15:00",
    "Diễn giải đơn hàng": "",
    "Mã chuẩn chi": "111111",
    "Mã giao dịch thẻ": "RRN000000003",
    "Mã giao dịch gốc": "FT2609290003",
    "Trạng thái Hoàn/Hủy": "",
    "Số thẻ": "970436******4321",
    "Phí giao dịch": "",
  },
];

/** Dựng workbook .xlsx (sheet đầu = dữ liệu) từ header + dòng thô. */
export function taoXlsx(
  rows: (string | number)[][] = DONG_BAN.map(dong),
  header: string[] = HEADER,
): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Danh sach giao dich");
  // Sheet thứ hai để chắc tầng đọc chỉ đọc SHEET ĐẦU.
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Không phải dữ liệu"]]), "Ghi chu");
  const out: ArrayBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true });
  return new Uint8Array(out);
}

export function dongTho(o: Ban): (string | number)[] {
  return dong(o);
}

/** Dựng .zip từ map đường dẫn → nội dung. */
export async function taoZip(files: Record<string, Uint8Array | string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [p, v] of Object.entries(files)) zip.file(p, v);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
