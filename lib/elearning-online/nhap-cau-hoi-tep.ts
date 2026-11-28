// QoImport — đọc/ghi tệp .xlsx cho nhập câu hỏi Online. Tách khỏi `nhap-cau-hoi.ts` (thuần) để phần luật không kéo thư viện bảng tính vào test thuần.
import * as XLSX from "xlsx";
import { MAU_THEO_LOAI, TOI_DA_BYTE, type LoaiNhap } from "./nhap-cau-hoi";

/** Đọc tệp (base64) → tên sheet → dòng × ô (chuỗi). Ném `Error` có thông báo tiếng Việt khi tệp hỏng/quá lớn. */
export function docTepXlsx(tepBase64: string): Record<string, string[][]> {
  const buf = Buffer.from(tepBase64, "base64");
  if (buf.byteLength === 0) throw new Error("Tệp rỗng");
  if (buf.byteLength > TOI_DA_BYTE) throw new Error(`Tệp quá lớn (tối đa ${Math.round(TOI_DA_BYTE / 1000)} KB). Chia nhỏ rồi nhập lại.`);
  // .xlsx là tệp ZIP ("PK"). `XLSX.read` KHÔNG ném với byte rác (nó thử đọc như văn bản CSV) ⇒ chặn ở cửa bằng chữ ký tệp.
  if (buf.byteLength < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error("Không đọc được tệp. Chỉ nhận tệp Excel .xlsx tải từ bộ mẫu.");
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: "buffer", cellFormula: false, cellHTML: false });
  } catch {
    throw new Error("Không đọc được tệp. Chỉ nhận tệp Excel .xlsx tải từ bộ mẫu.");
  }
  const kq: Record<string, string[][]> = {};
  for (const ten of wb.SheetNames) {
    const ws = wb.Sheets[ten];
    kq[ten] = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "", blankrows: false }).map((r) => r.map((c) => (c == null ? "" : String(c))));
  }
  return kq;
}

/** Bộ mẫu: mỗi dạng một sheet (dòng 1 là tiêu đề, dòng 2 là ví dụ) + sheet HUONG-DAN. `loai` ⇒ CHỈ sheet của dạng đó (tệp `mau-*.xlsx` từng dạng ở bảng "Mẫu theo từng dạng"). */
export function taoTepMau(loai?: LoaiNhap): Buffer {
  const wb = XLSX.utils.book_new();
  for (const m of MAU_THEO_LOAI.filter((x) => !loai || x.loai === loai)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([m.cot, m.viDu]), m.sheet);
  }
  const huongDan = [
    ["Quy tắc file"],
    ["Mỗi dạng câu một sheet; dòng 1 là tiêu đề cột, từ dòng 2 là câu hỏi. Dòng ví dụ ở dòng 2 — xoá hoặc thay bằng câu của bạn."],
    ["Tối đa 500 câu mỗi lần. Điểm là số nguyên 1–1000 (để trống = 1)."],
    ["Chọn một: Đáp án đúng là MỘT chữ A–F. Chọn nhiều: các chữ cách nhau bằng dấu ; (ví dụ A;C)."],
    ["Đúng/sai: ghi Đúng hoặc Sai. Trả lời ngắn: nhiều đáp án chấp nhận cách nhau bằng dấu | (ví dụ siêu âm|ultrasonic)."],
    ["Điền chỗ trống: đặt đáp án trong [[ ]] (nhiều đáp án chấp nhận: [[a|b]]); Từ gây nhiễu cách nhau bằng |; Cho gõ: Có/Không."],
    ["Ghép cặp: mỗi cặp một Trái n + Phải n (2–10 cặp). Sắp xếp: điền các Bước theo ĐÚNG thứ tự (2–12 bước). Phân loại: Nhóm n + Thẻ nhóm n (thẻ cách nhau bằng |, 2–6 nhóm)."],
    ["Chọn trên hình: Vùng đúng là rect:x,y,rộng,cao hoặc circle:x,y,bán kính, nhiều vùng cách nhau bằng ;. Nhập số: dấu , hoặc . đều được; Sai số tuỳ chọn."],
    ["Nộp sản phẩm: Loại tệp VIDEO;IMAGE;PDF (không tự chấm — người chấm chấm tay). Khối lệnh: toạ độ cột,hàng tính từ 1; Xe = cột,hàng,hướng (Bắc/Đông/Nam/Tây); Khối cho phép: fwd, right, left, repeat, ifwall, stop."],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(huongDan), "HUONG-DAN");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
