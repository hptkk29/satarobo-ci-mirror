import * as XLSX from "xlsx";

/**
 * Dựng workbook cho file xuất danh sách Lead.
 *
 * TÁCH RA KHỎI ROUTE để test được: route `/api/admin/leads/export` cần session +
 * permission nên Vitest không gọi thẳng được, mà phần dễ sai nhất lại nằm ở đây —
 * ĐỊNH KIỂU Ô, không phải ở tầng HTTP.
 *
 * ⚠️ VÌ SAO PHẢI ÉP CỘT SĐT THÀNH CHUỖI: Excel đọc "0905123456" thành SỐ rồi hiển thị
 * "905123456" — mất số 0 đầu. Đây đúng là lý do bỏ CSV (chốt 31/08/2026): CSV không
 * mang được kiểu ô nên Excel luôn tự đoán. Sang xlsx mà vẫn để nó tự đoán thì đổi định
 * dạng cũng vô nghĩa. Repo đã từng dính đúng lỗi này ở đường import lead (đọc SĐT từ
 * sheet bị nuốt số 0 đầu).
 */
export function buildLeadsWorkbook(input: {
  headers: string[];
  rows: (string | number)[][];
  watermark: string;
  /** Chỉ số cột SĐT (0-based) — cột phải ép kiểu chuỗi. */
  phoneColumnIndex: number;
}): XLSX.WorkBook {
  const { headers, rows, watermark, phoneColumnIndex } = input;
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows, [], [watermark]]);

  for (let i = 0; i < rows.length; i++) {
    const cell = ws[XLSX.utils.encode_cell({ r: i + 1, c: phoneColumnIndex })];
    if (cell) {
      cell.t = "s"; // string
      cell.z = "@"; // định dạng "Text" của Excel
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Leads");
  return wb;
}
