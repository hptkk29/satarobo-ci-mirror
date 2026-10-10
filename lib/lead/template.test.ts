// File mẫu import lead (26/07): GIỮ file soạn tay mau-lead-v2.xlsx, chỉ vá thêm
// dropdown khoá/cơ sở thật + ràng buộc tuổi + kiểu cột SĐT/tuổi.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import {
  buildLeadImportTemplate,
  buildDataValidationsXml,
  injectCourseList,
  patchGuideSheet,
  patchPhoneAndAgeColumns,
  patchStylesXml,
  readLastRow,
  setInlineCell,
  LEAD_TEMPLATE_SOURCE,
} from "./template";
import { LEAD_IMPORT_COLUMNS } from "./import";

const COURSES = ["Sata1 — Robosim Master", "Sata2 — Đấu trường Robot & More"];
const SOURCE = readFileSync(path.join(process.cwd(), LEAD_TEMPLATE_SOURCE));

const SHEET_STUB =
  '<worksheet><dimension ref="A1:I121"/>' +
  '<cols><col width="16" customWidth="1" min="1" max="1"/><col width="12" customWidth="1" min="2" max="2"/>' +
  '<col width="12" customWidth="1" min="5" max="5"/></cols>' +
  '<sheetData><row r="1" ht="34"><c r="A1" s="1"/></row><row r="2"><c r="A2" s="3"/></row>' +
  '<row r="3"><c r="A3" s="5"/></row></sheetData>' +
  '<dataValidations count="1"><dataValidation sqref="F2:F121" type="list"><formula1>"CS1,CS2"</formula1></dataValidation></dataValidations>' +
  '<pageMargins left="0.75"/></worksheet>';

describe("readLastRow", () => {
  it("[TPL-1] đọc số dòng dữ liệu từ dimension", () => {
    expect(readLastRow(SHEET_STUB)).toBe(121);
    expect(readLastRow("<worksheet/>", 99)).toBe(99);
  });
});

describe("injectCourseList", () => {
  it("[TPL-2] ghi danh mục vào cột K, mở rộng dimension, ẩn cột K", () => {
    const out = injectCourseList(SHEET_STUB, COURSES);
    expect(out).toContain('<c r="K1" t="inlineStr">');
    expect(out).toContain("<t>Sata1 — Robosim Master</t>");
    expect(out).toContain('<dimension ref="A1:K121"/>');
    expect(out).toContain('<col min="11" max="11" width="0" hidden="1"');
  });

  it("[TPL-3] escape ký tự XML trong tên khoá (& < >)", () => {
    const out = injectCourseList(SHEET_STUB, ["Sata2 — Đấu trường Robot & More"]);
    expect(out).toContain("Robot &amp; More");
    expect(out).not.toContain("Robot & More");
  });

  it("[TPL-4] không phá cấu trúc dòng có sẵn (ô cũ vẫn còn, K nằm cuối dòng)", () => {
    const out = injectCourseList(SHEET_STUB, COURSES);
    expect(out).toContain('<c r="A2" s="3"/>');
    expect(/<c r="A2" s="3"\/><c r="K2"/.test(out)).toBe(true);
  });
});

describe("patchStylesXml + patchPhoneAndAgeColumns", () => {
  it("[TPL-5] thêm 2 cellXf và gắn đúng cột B (text) / E (số)", () => {
    const styles = patchStylesXml('<styleSheet><cellXfs count="20"><xf/></cellXfs></styleSheet>');
    expect(styles.textStyleId).toBe(20);
    expect(styles.intStyleId).toBe(21);
    expect(styles.xml).toContain('<cellXfs count="22">');

    const out = patchPhoneAndAgeColumns(SHEET_STUB, {
      textStyleId: styles.textStyleId,
      intStyleId: styles.intStyleId,
    });
    const colOf = (min: string) =>
      (out.match(/<col\b[^>]*\/>/g) ?? []).find((c) => c.includes(`min="${min}"`)) ?? "";
    expect(colOf("2")).toContain('style="20"'); // SĐT → text
    expect(colOf("5")).toContain('style="21"'); // Tuổi con → số
    expect(out).toContain('<col width="16" customWidth="1" min="1" max="1"/>'); // cột khác giữ nguyên
  });
});

describe("buildDataValidationsXml", () => {
  it("[TPL-6] dropdown khoá trỏ vào cột K theo đúng số khoá + tuổi 3–18", () => {
    const xml = buildDataValidationsXml({ lastRow: 121, courseCount: 2, centerCodes: ["CS1", "CS2"] });
    expect(xml).toContain('<formula1>$K$2:$K$3</formula1>');
    expect(xml).toContain('sqref="G2:G121"');
    expect(xml).toContain('"CS1,CS2"');
    expect(xml).toContain('type="whole"');
    expect(xml).toContain("<formula1>3</formula1><formula2>18</formula2>");
    expect(xml).toContain('count="3"');
  });

  it("[TPL-7] chưa có khoá/cơ sở → chỉ còn ràng buộc tuổi, không đẻ dropdown rỗng", () => {
    const xml = buildDataValidationsXml({ lastRow: 121, courseCount: 0, centerCodes: [] });
    expect(xml).toContain('count="1"');
    expect(xml).not.toContain("$K$2");
  });
});

describe("setInlineCell", () => {
  const guide =
    '<worksheet><sheetData>' +
    '<row r="29"><c r="A29" s="9" t="inlineStr"><is><t>6</t></is></c>' +
    '<c r="F29" s="9" t="inlineStr"><is><t>Chọn: CS1 / CS2</t></is></c>' +
    '<c r="H29" s="9" t="inlineStr"><is><t>cũ</t></is></c></row>' +
    '<row r="30"><c r="A30" s="9" t="inlineStr"><is><t>7</t></is></c>' +
    '<c r="G30" s="9" t="inlineStr"><is><t>x</t></is></c></row>' +
    "</sheetData></worksheet>";

  it("[TPL-12] ô có sẵn: đổi chữ, GIỮ style", () => {
    const out = setInlineCell(guide, "F29", "Chọn: CS1 / CS2 / CS3");
    expect(out).toContain('<c r="F29" s="9" t="inlineStr"><is><t>Chọn: CS1 / CS2 / CS3</t></is></c>');
    expect(out).toContain("<t>cũ</t>"); // ô khác không đụng
  });

  it("[TPL-13] ô chưa có: chèn ĐÚNG THỨ TỰ cột trong dòng", () => {
    const out = setInlineCell(guide, "F30", "Chọn trong danh sách");
    const row30 = /<row r="30"[\s\S]*?<\/row>/.exec(out)![0];
    expect(row30.indexOf('r="F30"')).toBeGreaterThan(row30.indexOf('r="A30"'));
    expect(row30.indexOf('r="F30"')).toBeLessThan(row30.indexOf('r="G30"'));
  });

  it("[TPL-14] dòng không tồn tại → bỏ qua, không vỡ XML", () => {
    expect(setInlineCell(guide, "B99", "x")).toBe(guide);
  });
});

describe("patchGuideSheet", () => {
  it("[TPL-15] cập nhật luật trùng SĐT + mã cơ sở thật vào sheet hướng dẫn", () => {
    const guide =
      '<worksheet><sheetData><row r="16"><c r="A16" s="9" t="inlineStr"><is><t>Trùng SĐT sẽ bị BỎ QUA</t></is></c></row>' +
      '<row r="29"><c r="F29" s="9" t="inlineStr"><is><t>Chọn: CS1 / CS2</t></is></c></row></sheetData></worksheet>';
    const out = patchGuideSheet(guide, { courseNames: COURSES, centerCodes: ["CS1", "CS2", "CS3"] });
    expect(out).not.toContain("BỎ QUA");
    expect(out).toContain("GỘP thành 1 lead nhiều con");
    expect(out).toContain("Chọn: CS1 / CS2 / CS3");
  });
});

describe("buildLeadImportTemplate (vá file thật)", () => {
  it("[TPL-8] GIỮ NGUYÊN 3 sheet + header 9 cột của file soạn tay", async () => {
    const buf = await buildLeadImportTemplate({
      source: SOURCE,
      courseNames: COURSES,
      centerCodes: ["CS1", "CS2"],
    });
    const wb = XLSX.read(buf, { type: "buffer" });
    expect(wb.SheetNames[0]).toBe("Lead");
    expect(wb.SheetNames.length).toBe(3); // Lead + 📖 HƯỚNG DẪN + ✅ VÍ DỤ
    const header = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["Lead"]!, { header: 1 })[0];
    expect(header?.slice(0, 10)).toEqual([...LEAD_IMPORT_COLUMNS]);
  });

  it("[TPL-9] sheet ✅ VÍ DỤ giữ nguyên; sheet 📖 HƯỚNG DẪN giữ bố cục nhưng cập nhật luật mới", async () => {
    const before = XLSX.read(SOURCE, { type: "buffer" });
    const after = XLSX.read(
      await buildLeadImportTemplate({ source: SOURCE, courseNames: COURSES, centerCodes: ["CS1"] }),
      { type: "buffer" },
    );

    const exampleSheet = before.SheetNames[2]!;
    expect(XLSX.utils.sheet_to_json(after.Sheets[exampleSheet]!, { header: 1 })).toEqual(
      XLSX.utils.sheet_to_json(before.Sheets[exampleSheet]!, { header: 1 }),
    );

    const guideSheet = before.SheetNames[1]!;
    const rowsBefore = XLSX.utils.sheet_to_json<unknown[]>(before.Sheets[guideSheet]!, { header: 1 });
    const rowsAfter = XLSX.utils.sheet_to_json<unknown[]>(after.Sheets[guideSheet]!, { header: 1 });
    expect(rowsAfter.length).toBe(rowsBefore.length);
    expect(rowsAfter[0]).toEqual(rowsBefore[0]); // tiêu đề giữ nguyên
    const text = rowsAfter.flat().filter(Boolean).join(" | ");
    expect(text).toContain("GỘP thành 1 lead nhiều con");
    expect(text).not.toContain("Trùng SĐT sẽ bị BỎ QUA");
  });

  it("[TPL-10] có dropdown khoá thật + danh mục ghi ở cột K", async () => {
    const buf = await buildLeadImportTemplate({
      source: SOURCE,
      courseNames: COURSES,
      centerCodes: ["CS1", "CS2"],
    });
    const zip = await JSZip.loadAsync(buf);
    const sheetXml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(sheetXml).toContain('sqref="G2:G121"');
    expect(sheetXml).toContain("$K$2:$K$3");

    const wb = XLSX.read(buf, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Lead"]!, {
      header: 1,
      defval: null,
    }) as unknown as unknown[][];
    expect(rows[1]?.[10]).toBe(COURSES[0]); // K2
    expect(rows[2]?.[10]).toBe(COURSES[1]); // K3
  });

  it("[TPL-11] file lạ (không phải xlsx đúng cấu trúc) → trả nguyên bản, không ném", async () => {
    const zip = new JSZip();
    zip.file("hello.txt", "x");
    const weird = await zip.generateAsync({ type: "nodebuffer" });
    const out = await buildLeadImportTemplate({
      source: weird,
      courseNames: COURSES,
      centerCodes: [],
    });
    expect(out.length).toBe(weird.length);
  });
});
