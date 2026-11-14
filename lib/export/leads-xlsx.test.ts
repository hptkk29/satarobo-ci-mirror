import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildLeadsWorkbook } from "./leads-xlsx";

const HEADERS = ["ID", "Phụ huynh", "SĐT", "Email"];
const ROWS: (string | number)[][] = [
  ["lead-1", "Chị Diễm", "0905123456", "a@b.vn"],
  ["lead-2", "Anh Khoa", "0941000001", ""],
];
const WATERMARK = "Xuất bởi UAT lúc 2026-08-31 — 2 dòng";

function build() {
  return buildLeadsWorkbook({
    headers: HEADERS,
    rows: ROWS,
    watermark: WATERMARK,
    phoneColumnIndex: 2,
  });
}

describe("[XLS-01] buildLeadsWorkbook — cấu trúc file", () => {
  it("có đúng một sheet tên Leads", () => {
    expect(build().SheetNames).toEqual(["Leads"]);
  });

  it("hàng đầu là tiêu đề, sau đó tới dữ liệu", () => {
    const ws = build().Sheets["Leads"]!;
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false });
    expect(aoa[0]).toEqual(HEADERS);
    expect(aoa[1]?.[1]).toBe("Chị Diễm");
  });

  it("giữ watermark ở dòng cuối — dấu vết ai xuất file này", () => {
    // SEC-M05: bỏ watermark khi đổi CSV→xlsx là mất đường truy ngược khi dữ liệu
    // khách hàng rò ra ngoài. Ca này chặn việc đó bị bỏ quên.
    const ws = build().Sheets["Leads"]!;
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false });
    expect(aoa[aoa.length - 1]?.[0]).toBe(WATERMARK);
  });
});

describe("[XLS-02] SĐT phải là CHUỖI — không mất số 0 đầu", () => {
  it("ô SĐT có kiểu 's' và định dạng Text", () => {
    const ws = build().Sheets["Leads"]!;
    expect(ws["C2"]!.t).toBe("s");
    expect(ws["C2"]!.z).toBe("@");
    expect(ws["C3"]!.t).toBe("s");
  });

  it("đọc lại ra ĐÚNG '0905123456', không thành 905123456", () => {
    // Đây là lý do cả đợt bỏ CSV. Nếu ai đó gỡ vòng ép kiểu trong buildLeadsWorkbook
    // thì ca này đỏ ngay, thay vì kế toán phát hiện lúc gọi nhầm số khách.
    const wb = build();
    const round = XLSX.read(
      XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer,
      { type: "buffer" },
    );
    const ws = round.Sheets["Leads"]!;
    expect(String(ws["C2"]!.v)).toBe("0905123456");
    expect(String(ws["C3"]!.v)).toBe("0941000001");
  });
});
