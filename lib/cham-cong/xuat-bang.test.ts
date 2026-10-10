/**
 * lib/cham-cong/xuat-bang.test.ts — hàm xuất Excel dùng chung.
 *
 * Vì sao test: hỏng ở đây hỏng ÂM THẦM. Tệp vẫn mở được, vẫn có số — chỉ là mã nhân viên
 * "0123" thành 123, hoặc bảng mất viền, và người nhận phát hiện sau khi đã gửi đi.
 *
 * ⚠️ Các ca định dạng (viền, nền) là thứ KHÔNG thể kiểm bằng mắt trên CI, và cũng chính là
 * thứ vừa buộc đổi thư viện: `xlsx@0.18.5` (bản cộng đồng) ghi `border`/`fill` KHÔNG có tác
 * dụng — đo 25/09/2026 bằng cách ghi rồi đọc lại, style bị vứt sạch. Nên phải khẳng định
 * chúng ở đây, không thì lần nâng cấp sau có thể lặng lẽ quay về bản không viền.
 */
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { dungWorkbook, tenTepAnToan, type CotXuat, type KhoiNguoi } from "./xuat-bang";

type Dong = { ma: string; ten: string; cong: number };
const dong: Dong[] = [
  { ma: "0123", ten: "Nguyễn Bảo Minh", cong: 21.5 },
  { ma: "NV07", ten: "Trần Thị Hoà", cong: 20 },
];
const cot: CotXuat<Dong>[] = [
  { nhan: "Mã NV", lay: (r) => r.ma, chuoi: true },
  { nhan: "Họ tên", lay: (r) => r.ten },
  { nhan: "Công", lay: (r) => r.cong },
];

const dung = (extra: Partial<Parameters<typeof dungWorkbook<Dong>>[0]> = {}) =>
  dungWorkbook<Dong>({
    tieuDe: "BẢNG THỬ",
    cot,
    dong,
    watermark: "ai đó xuất lúc nào đó",
    ...extra,
  });

const ten = (wb: ExcelJS.Workbook) => wb.worksheets.map((w) => w.name);

describe("dungWorkbook — sheet dữ liệu", () => {
  it("cột khai `chuoi` mang định dạng TEXT — đây là lý do file này tồn tại", () => {
    // Dòng 1 = tiêu đề, 2 = trống, 3 = header, 4 = dòng dữ liệu đầu.
    const cell = dung().getWorksheet("Du lieu")!.getRow(4).getCell(1);
    expect(cell.value).toBe("0123");
    // ⚠️ KHẲNG ĐỊNH VÀO `numFmt`, KHÔNG vào kiểu ô. Bản đầu của ca này kiểm kiểu và nó XANH
    // cả khi đã gỡ hẳn phần ép định dạng — vì chuỗi JS vốn đã lưu thành ô chữ. Thứ Excel
    // THẬT SỰ đọc để không đổi "0123" thành 123 là định dạng số `@` (Text).
    expect(cell.numFmt, "thiếu định dạng Text ⇒ Excel đọc 0123 thành 123").toBe("@");
  });

  it("cột KHÔNG khai `chuoi` giữ kiểu số — để còn cộng được trong Excel", () => {
    const cell = dung().getWorksheet("Du lieu")!.getRow(4).getCell(3);
    expect(cell.value).toBe(21.5);
    expect(cell.numFmt).toBeUndefined();
  });

  it("mọi ô dữ liệu ĐƯỢC KẺ VIỀN — yêu cầu 25/09 'kẻ bảng cho dễ nhận biết'", () => {
    const row = dung().getWorksheet("Du lieu")!.getRow(4);
    for (let c = 1; c <= cot.length; c++) {
      expect(row.getCell(c).border?.top?.style, `ô ${c} mất viền`).toBe("thin");
    }
  });

  it("dòng header in đậm + có nền — để phân biệt với dữ liệu", () => {
    const h = dung().getWorksheet("Du lieu")!.getRow(3);
    expect(h.font?.bold).toBe(true);
    expect(h.getCell(1).fill).toBeTruthy();
  });

  it("đóng băng dòng tiêu đề + bật lọc — cuộn 500 dòng vẫn thấy tên cột", () => {
    const ws = dung().getWorksheet("Du lieu")!;
    expect(ws.views?.[0]?.state).toBe("frozen");
    expect(ws.autoFilter).toBeTruthy();
  });

  it("luôn có sheet `_watermark` — export dữ liệu nhân sự phải truy được ai lấy", () => {
    expect(ten(dung())).toContain("_watermark");
  });

  it("ô rỗng (`lay` trả null) thành chuỗi trống, không thành chữ 'null'", () => {
    const wb = dungWorkbook<Dong>({
      tieuDe: "x",
      cot: [{ nhan: "Ghi chú", lay: () => null }],
      dong: [dong[0]],
      watermark: "w",
    });
    expect(wb.getWorksheet("Du lieu")!.getRow(4).getCell(1).value).toBe("");
  });

  it("hai lần xuất cùng dữ liệu ra cùng mốc thời gian — để còn so được tệp", () => {
    expect(dung().created.getTime()).toBe(0);
  });
});

describe("tên sheet", () => {
  it("quá 31 ký tự bị CẮT, không ném — Excel từ chối tên dài", () => {
    const wb = dung({ tenSheet: "Ten sheet rat dai vuot qua gioi han cua Excel" });
    expect(ten(wb)[0].length).toBeLessThanOrEqual(31);
  });

  it("ký tự Excel cấm bị thay, không ném", () => {
    expect(ten(dung({ tenSheet: "Thang 09/2026 [CS1]" }))[0]).not.toMatch(/[:\\/?*[\]]/);
  });
});

describe("khoiNguoi — chia theo TỪNG NHÂN VIÊN, mỗi người liệt kê TỪNG NGÀY", () => {
  const khoi: KhoiNguoi[] = [
    {
      tieuDe: "Nguyễn Bảo Minh · Tư vấn viên · CS1",
      tomTat: "Tổng 21,5 công · 157h20 làm thật",
      cot: ["Ngày", "Thứ", "Mã ca", "Vào", "Ra", "Trạng thái"],
      dong: [
        { o: ["01/09", "T3", "HC", "07:55", "17:32", "Đi làm, đúng giờ"] },
        { o: ["02/09", "T4", "HC", "08:41", "17:30", "Đi muộn"], nen: "FFFAC7C7" },
      ],
    },
    {
      tieuDe: "Trần Thị Hoà · Giáo viên · CS1",
      tomTat: "Tổng 20 công",
      cot: ["Ngày", "Thứ", "Mã ca", "Vào", "Ra", "Trạng thái"],
      dong: [{ o: ["01/09", "T3", "CG", "09:00", "17:45", "Đi làm, đúng giờ"] }],
    },
  ];
  const wb = () => dung({ khoiNguoi: { ten: "Chi tiet theo nguoi", khoi } });

  it("thành sheet riêng, mỗi người một khối ngăn nhau bằng dòng trống", () => {
    const ws = wb().getWorksheet("Chi tiet theo nguoi")!;
    expect(ws.getRow(1).getCell(1).value).toContain("Nguyễn Bảo Minh");
    expect(ws.getRow(2).getCell(1).value).toContain("21,5 công");
    expect(ws.getRow(3).getCell(1).value).toBe("Ngày"); // header của khối
    expect(ws.getRow(4).getCell(1).value).toBe("01/09");
    // 1 tiêu đề + 1 tóm tắt + 1 header + 2 ngày + 1 trống = người thứ hai bắt đầu ở dòng 7
    expect(ws.getRow(7).getCell(1).value).toContain("Trần Thị Hoà");
  });

  it("dòng có `nen` được TÔ MÀU, dòng thường thì không — để đỏ còn nổi", () => {
    const ws = wb().getWorksheet("Chi tiet theo nguoi")!;
    expect(ws.getRow(5).getCell(1).fill).toBeTruthy(); // 02/09 đi muộn
    expect(ws.getRow(4).getCell(1).fill).toBeUndefined(); // 01/09 bình thường
  });

  it("bảng ngày được kẻ viền", () => {
    const ws = wb().getWorksheet("Chi tiet theo nguoi")!;
    expect(ws.getRow(4).getCell(1).border?.left?.style).toBe("thin");
  });

  it("không khai ⇒ không đẻ sheet thừa", () => {
    expect(ten(dung())).not.toContain("Chi tiet theo nguoi");
  });
});

describe("bangPhu — sheet bảng phẳng (nhật ký lượt quét)", () => {
  const wb = () =>
    dung({
      bangPhu: [
        {
          ten: "Luot quet",
          cot: ["Ngày", "Giờ", "Nhân sự", "Kết quả"],
          rong: { "Nhân sự": 26 },
          dong: [
            ["2026-09-15", "07:55", "Nguyễn Bảo Minh", "Đã ghi"],
            ["2026-09-15", "17:31", "Nguyễn Bảo Minh", "Bị từ chối: TICKET_EXPIRED"],
          ],
        },
      ],
    });

  it("thành sheet riêng, đúng tên, đủ dòng", () => {
    const ws = wb().getWorksheet("Luot quet")!;
    expect(ws.getRow(1).getCell(1).value).toBe("Ngày");
    expect(ws.rowCount).toBe(3); // 1 header + 2 lượt
  });

  it("GIỮ lượt bị từ chối kèm lý do — đó là thứ giải thích ngày 'không có lượt'", () => {
    // Lọc lượt bị từ chối đi là xoá đúng bằng chứng người bị gắn cờ oan cần có.
    expect(String(wb().getWorksheet("Luot quet")!.getRow(3).getCell(4).value)).toContain(
      "Bị từ chối",
    );
  });

  it("độ rộng cột khai riêng được áp, cột không khai lấy mặc định", () => {
    const ws = wb().getWorksheet("Luot quet")!;
    expect(ws.getColumn(3).width).toBe(26); // "Nhân sự"
    expect(ws.getColumn(1).width).toBe(11); // "Ngày" — mặc định
  });

  it("không khai ⇒ không đẻ sheet thừa", () => {
    expect(ten(dung())).not.toContain("Luot quet");
  });
});

describe("tenTepAnToan", () => {
  it("bỏ dấu tiếng Việt và ký tự OS từ chối", () => {
    expect(tenTepAnToan("bảng công tháng 09/2026 — CS1")).toBe("bang-cong-thang-09-2026-CS1");
  });
  it("đ/Đ ra d/D chứ không bị nuốt", () => {
    expect(tenTepAnToan("Đơn từ")).toBe("Don-tu");
  });
});
