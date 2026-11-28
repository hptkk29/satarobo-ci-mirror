// [MIP-*] File mẫu import lịch phân ca: đọc NGƯỢC bằng chính `parseWorkbook` — lệch bố cục tab
// là đỏ. Hai điều quan trọng nhất cần khoá: (1) mẫu mang đúng lịch đang có (nộp lại không sửa gì
// thì không ô nào đổi — vì ô trống khi import là HUỶ, không phải bỏ qua) và (2) tab hướng dẫn
// nói đúng điều đó.
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseWorkbook } from "@/lib/cham-cong/sheet-parse";
import { dungFileMauImport, type DauVaoMau } from "@/lib/cham-cong/mau-import-phan-ca";

const MA_CA = [
  { code: "CG", name: "Ca gãy", gio: "08:00–11:30 · 13:30–17:30" },
  { code: "X", name: "Nghỉ", gio: "" },
];

const DAU_VAO: DauVaoMau = {
  ky: "2026-10",
  donVi: "CS2",
  nhanKhoi: "CS2 · Cơ sở Hoàng Diệu",
  nguoi: [
    {
      ten: "Nguyễn Thị Hoàng Anh",
      hoTen: "Nguyễn Thị Hoàng Anh",
      vaiTro: "Giáo viên",
      sdt: null,
      khung: { 6: "CG", 0: null },
      o: { 3: "CG", 4: "X", 17: "CG" },
    },
    { ten: "Người mới", hoTen: "Người mới", vaiTro: "Tư vấn", sdt: null, khung: {}, o: {} },
  ],
  nguoiKiemNhiem: ["Mr Phúc"],
  maCa: MA_CA,
};

async function doc(v: DauVaoMau) {
  return parseWorkbook(Buffer.from(await dungFileMauImport(v).xlsx.writeBuffer()));
}

describe("[MIP] file mẫu import lịch phân ca", () => {
  it("[MIP-01] parseWorkbook đọc lại đúng tháng, đơn vị, mã ca từng ngày", async () => {
    const p = await doc(DAU_VAO);
    expect(p.months).toHaveLength(1);
    const g = p.months[0];
    expect(g.periodKey).toBe("2026-10");
    expect(g.daysInMonth).toBe(31);
    expect(g.rows.map((r) => r.name)).toEqual(["Nguyễn Thị Hoàng Anh", "Người mới"]);
    expect(g.rows.every((r) => r.unit === "CS2")).toBe(true);
    expect(g.rows[0].cells[3]).toBe("CG");
    expect(g.rows[0].cells[4]).toBe("X");
    expect(g.rows[0].cells[17]).toBe("CG");
    expect(g.rows[0].cells[5]).toBeNull();
    // Người mới: toàn ô trống (hàng để điền).
    expect(Object.values(g.rows[1].cells).every((c) => c === null)).toBe(true);
    expect(p.warnings).toEqual([]);
  });

  it("[MIP-02] khung ca: thứ nào có mã thì mang mã, thứ nào không thì null", async () => {
    const p = await doc(DAU_VAO);
    expect(p.khungCa).toHaveLength(2);
    expect(p.khungCa[0].byWeekday[6]).toBe("CG");
    expect(p.khungCa[0].byWeekday[1]).toBeNull();
    expect(p.khungCa[0].unit).toBe("CS2");
    expect(p.khungCa[0].role).toBe("Giáo viên");
  });

  it("[MIP-03] tháng 30 ngày chỉ có 30 cột ngày; công thức tổng công/nghỉ khớp số ô", async () => {
    const p = await doc({ ...DAU_VAO, ky: "2026-09" });
    expect(p.months[0].daysInMonth).toBe(30);
    expect(Object.keys(p.months[0].rows[0].cells)).toHaveLength(30);
    const wb = await dungFileMauImport({ ...DAU_VAO, ky: "2026-10" }).xlsx.writeBuffer().then(async (b) => {
      const w = new ExcelJS.Workbook();
      await w.xlsx.load(b as ArrayBuffer);
      return w;
    });
    const ws = wb.getWorksheet("LỊCH T10-2026")!;
    const r = ws.getRow(4);
    expect((r.getCell(5 + 31).value as { result: number }).result).toBe(2); // CG ×2
    expect((r.getCell(6 + 31).value as { result: number }).result).toBe(1); // X ×1
  });

  it("[MIP-04] tab DANH MỤC CA liệt kê mã, ô mã ca có danh sách thả xuống trỏ đúng dải", async () => {
    const buf = await dungFileMauImport(DAU_VAO).xlsx.writeBuffer();
    const w = new ExcelJS.Workbook();
    await w.xlsx.load(buf as ArrayBuffer);
    const dm = w.getWorksheet("DANH MỤC CA")!;
    expect([dm.getCell("A2").value, dm.getCell("A3").value]).toEqual(["CG", "X"]);
    // Chỉ Mã ca / Tên ca / Giờ làm việc: "Công", "Lần chấm/ngày" là cấu hình hệ thống, file mẫu không mang.
    expect([1, 2, 3].map((c) => dm.getCell(1, c).value)).toEqual(["Mã ca", "Tên ca", "Giờ làm việc"]);
    expect(dm.getCell(1, 4).value).toBeNull();
    expect(dm.getCell("D2").value).toBeNull();
    const o = w.getWorksheet("LỊCH T10-2026")!.getCell(4, 8);
    expect(o.dataValidation?.type).toBe("list");
    expect(o.dataValidation?.formulae?.[0]).toBe("'DANH MỤC CA'!$A$2:$A$3");
    expect(o.numFmt).toBe("@");
  });

  it("[MIP-05] tab HƯỚNG DẪN nói rõ ô trống = huỷ/xoá và nêu tên người kiêm nhiệm bị loại", async () => {
    const buf = await dungFileMauImport(DAU_VAO).xlsx.writeBuffer();
    const w = new ExcelJS.Workbook();
    await w.xlsx.load(buf as ArrayBuffer);
    const chu = w.getWorksheet("HƯỚNG DẪN")!;
    const het: string[] = [];
    chu.eachRow((r) => het.push(String(r.getCell(2).value ?? "")));
    const text = het.join("\n");
    expect(text).toMatch(/Ô TRỐNG KHÔNG PHẢI/);
    expect(text).toMatch(/HUỶ ca/);
    expect(text).toMatch(/XOÁ khung ca/);
    expect(text).toMatch(/Mr Phúc/);
  });

  it("[MIP-06] không có người kiêm nhiệm thì không in mục loại trừ", async () => {
    const buf = await dungFileMauImport({ ...DAU_VAO, nguoiKiemNhiem: [] }).xlsx.writeBuffer();
    const w = new ExcelJS.Workbook();
    await w.xlsx.load(buf as ArrayBuffer);
    const het: string[] = [];
    w.getWorksheet("HƯỚNG DẪN")!.eachRow((r) => het.push(String(r.getCell(2).value ?? "")));
    expect(het.join("\n")).not.toMatch(/KHÔNG CÓ TRONG FILE NÀY/);
  });
});

describe("[MIP-W] dây nối: route + trang", () => {
  const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
  const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("[MIP-W1] route kiểm quyền assign TẠI KHỐI và cổng vai xuất TRƯỚC khi đọc dữ liệu", () => {
    const s = boChuThich(doc("app/api/admin/cham-cong/phan-ca/import/mau/route.ts"));
    const iQuyen = s.indexOf('checkPermission("hr_attendance:assign", { centerId: coSo })');
    const iXuat = s.indexOf('chanXuatVai("phan-ca-thang", session)');
    const iDoc = s.indexOf("docDauVaoMau(");
    expect(iQuyen).toBeGreaterThan(0);
    expect(iXuat).toBeGreaterThan(iQuyen);
    expect(iDoc).toBeGreaterThan(iXuat);
    expect(s.match(/checkPermission\(/g)).toHaveLength(1);
  });

  it("[MIP-W2] trang chỉ vẽ liên kết khi cổng xuất cho qua, và truyền mauLinks xuống wizard", () => {
    const s = boChuThich(doc("app/(admin)/admin/cham-cong/phan-ca/import/page.tsx"));
    expect(s).toMatch(/duocXuatCuaPhienHienTai\("phan-ca-thang", \{ centerId: b\.id \}\)/);
    expect(s).toMatch(/mauLinks=\{mauLinks\}/);
  });
});
