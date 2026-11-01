// File mẫu import lead (26/07): GIỮ file soạn tay mau-lead-v2.xlsx, chỉ vá thêm
// dropdown khoá/cơ sở thật + ràng buộc tuổi + kiểu cột SĐT/tuổi.
//
// 28/10/2026 — BỎ CỘT «Nguồn» (và «Mã NV giới thiệu») khỏi file mẫu: nguồn nay là ô «Nguồn của cả file» chọn trước khi nhập.
// Ca [TPL-NG-*] canh việc gỡ cột trên FILE THẬT (không chỉ trên chuỗi giả): đọc lại bằng SheetJS, và kiểm mọi phần XML còn là XML hợp lệ.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import JSZip from "jszip";
// @ts-expect-error — jsdom không có khai báo kiểu trong repo; chỉ dùng DOMParser để kiểm XML hợp lệ (xem `xmlHopLe`)
import * as jsdom from "jsdom";
import {
  boCotNguonComments,
  boCotNguonSheet,
  boCotNguonVml,
  boCotNguonWorkbook,
  boDongNguonTuDien,
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
import { GHI_CHU_MOT_FILE_MOT_NGUON } from "@/lib/nguon/nguon-ca-file-ghi-chu";

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
  it("[TPL-2] ghi danh mục vào cột J (I là cột 'Sale phụ trách' nhìn thấy được), mở rộng dimension, ẩn cột J", () => {
    const out = injectCourseList(SHEET_STUB, COURSES);
    expect(out).toContain('<c r="J1" t="inlineStr">');
    expect(out).not.toContain('<c r="I1"');
    expect(out).toContain("<t>Sata1 — Robosim Master</t>");
    expect(out).toContain('<dimension ref="A1:J121"/>');
    expect(out).toContain('<col min="10" max="10" width="0" hidden="1"');
    expect(out).not.toContain('<col min="9"');
  });

  it("[TPL-3] escape ký tự XML trong tên khoá (& < >)", () => {
    const out = injectCourseList(SHEET_STUB, ["Sata2 — Đấu trường Robot & More"]);
    expect(out).toContain("Robot &amp; More");
    expect(out).not.toContain("Robot & More");
  });

  it("[TPL-4] không phá cấu trúc dòng có sẵn (ô cũ vẫn còn, J nằm cuối dòng)", () => {
    const out = injectCourseList(SHEET_STUB, COURSES);
    expect(out).toContain('<c r="A2" s="3"/>');
    expect(/<c r="A2" s="3"\/><c r="J2"/.test(out)).toBe(true);
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
  it("[TPL-6] dropdown khoá trỏ vào cột J theo đúng số khoá + tuổi 3–18", () => {
    const xml = buildDataValidationsXml({ lastRow: 121, courseCount: 2, centerCodes: ["CS1", "CS2"] });
    expect(xml).toContain('<formula1>$J$2:$J$3</formula1>');
    expect(xml).toContain('sqref="G2:G121"');
    expect(xml).toContain('"CS1,CS2"');
    expect(xml).toContain('type="whole"');
    expect(xml).toContain("<formula1>3</formula1><formula2>18</formula2>");
    expect(xml).toContain('count="3"');
  });

  it("[TPL-7] chưa có khoá/cơ sở → chỉ còn ràng buộc tuổi, không đẻ dropdown rỗng", () => {
    const xml = buildDataValidationsXml({ lastRow: 121, courseCount: 0, centerCodes: [] });
    expect(xml).toContain('count="1"');
    expect(xml).not.toContain("$J$2");
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
    // 28/10/2026: hướng dẫn nói rõ nguồn KHÔNG còn là cột — chọn «Nguồn của cả file» ở màn nhập.
    expect(out).toContain("«Nguồn của cả file»");
    // 28/10/2026 (vòng 2): cùng ghi chú «một file = một nguồn + một người giới thiệu» với hai màn nhập — MỘT chuỗi chung.
    expect(out).toContain(GHI_CHU_MOT_FILE_MOT_NGUON);
  });
});

// ── GỠ CỘT «NGUỒN» (28/10/2026) ───────────────────────────────────────────────────────────────────────────────────────────────
/** Parser XML của jsdom (repo không có `@types/jsdom` — khai đúng phần dùng): sai cấu trúc ⇒ có phần tử `parsererror`. Đây là thứ Excel sẽ kêu «tệp bị hỏng». */
type JsdomToi = { JSDOM: new (html: string) => { window: { DOMParser: new () => { parseFromString(s: string, mime: string): { getElementsByTagName(n: string): ArrayLike<unknown> } } } } };
const xmlHopLe = (xml: string): boolean => {
  const { JSDOM } = jsdom as unknown as JsdomToi;
  const doc = new new JSDOM("").window.DOMParser().parseFromString(xml, "application/xml");
  return doc.getElementsByTagName("parsererror").length === 0;
};

describe("[TPL-NG] gỡ cột «Nguồn» khỏi file mẫu", () => {
  it("[TPL-NG-00] tự kiểm: bộ dò XML THẤY XML hỏng (không xanh vì không soi gì)", () => {
    expect(xmlHopLe("<a><b></a>")).toBe(false);
    expect(xmlHopLe("<a><b/></a>")).toBe(true);
  });

  const SHEET_DATA =
    '<worksheet><dimension ref="A1:I3"/><cols><col width="16" min="1" max="1"/><col width="12" min="8" max="8"/><col width="18" min="9" max="9"/></cols>' +
    '<sheetData><row r="1"><c r="G1" t="inlineStr"><is><t>Khoá</t></is></c><c r="H1" t="inlineStr"><is><t>Nguồn</t></is></c><c r="I1" t="inlineStr"><is><t>Ghi chú</t></is></c></row>' +
    '<row r="2"><c r="G2" s="3" t="n"></c><c r="H2" s="3" t="n"></c><c r="I2" s="3" t="n"></c></row>' +
    '<row r="3"><c r="G3"/><c r="H3" s="5"/><c r="I3" s="5"/></row></sheetData>' +
    '<autoFilter ref="A1:I1"/><mergeCells count="1"><mergeCell ref="A1:I1"/></mergeCells></worksheet>';

  it("[TPL-NG-01] sheet dữ liệu: ô H biến mất (cả ô rỗng, ô chữ, ô tự đóng), ô I đổi tên thành H, giữ nguyên nội dung + style", () => {
    const out = boCotNguonSheet(SHEET_DATA);
    expect(out).not.toContain("<t>Nguồn</t>");
    expect(out).toContain('<c r="H1" t="inlineStr"><is><t>Ghi chú</t></is></c>');
    expect(out).toContain('<c r="H2" s="3" t="n"></c>');
    expect(out).toContain('<c r="H3" s="5"/>');
    expect(out).not.toMatch(/<c r="I\d/);
    // Cột G (đứng TRƯỚC cột gỡ) không bị động tới.
    expect(out).toContain('<c r="G3"/>');
    expect((out.match(/<c r="H\d+"/g) ?? []).length).toBe(3);
  });

  it("[TPL-NG-02] dimension · autoFilter · mergeCell kết thúc ở H; <cols> bỏ cột 8 và hạ cột 9 xuống 8", () => {
    const out = boCotNguonSheet(SHEET_DATA);
    expect(out).toContain('<dimension ref="A1:H3"/>');
    expect(out).toContain('<autoFilter ref="A1:H1"/>');
    expect(out).toContain('<mergeCell ref="A1:H1"/>');
    expect(out).toContain('<col width="18" min="8" max="8"/>');
    expect(out).not.toContain('min="9"');
    expect(out).not.toContain('<col width="12" min="8" max="8"/>');
    expect(out).toContain('<col width="16" min="1" max="1"/>');
  });

  it("[TPL-NG-03] đối chứng: sheet KHÔNG có cột H/I thì giữ nguyên, không vỡ", () => {
    expect(boCotNguonSheet("<worksheet><sheetData/></worksheet>")).toBe("<worksheet><sheetData/></worksheet>");
  });

  it("[TPL-NG-04] workbook: tên ẩn _FilterDatabase $A$1:$I$1 → $A$1:$H$1", () => {
    expect(boCotNguonWorkbook("<definedName>'Lead'!$A$1:$I$1</definedName>")).toBe("<definedName>'Lead'!$A$1:$H$1</definedName>");
    expect(boCotNguonWorkbook("<x>'Lead'!$A$1:$K$1</x>")).toBe("<x>'Lead'!$A$1:$K$1</x>");
  });

  it("[TPL-NG-05] comment: bỏ comment H1, dời comment I1 sang H1", () => {
    const xml =
      '<comments><commentList><comment ref="G1"><text><t>Khoá</t></text></comment>' +
      '<comment ref="H1"><text><t>Nguồn lead</t></text></comment><comment ref="I1"><text><t>Ghi chú</t></text></comment></commentList></comments>';
    const out = boCotNguonComments(xml);
    expect(out).not.toContain("Nguồn lead");
    expect(out).toContain('<comment ref="H1"><text><t>Ghi chú</t></text></comment>');
    expect(out).not.toContain('ref="I1"');
    expect(out).toContain('<comment ref="G1">');
  });

  it("[TPL-NG-06] VML: bỏ khung của cột 7 (H), hạ cột 8 (I) xuống 7, cột khác giữ nguyên", () => {
    const shape = (col: number) =>
      `<v:shape id="s${col}"><x:ClientData><x:Row>0</x:Row><x:Column>${col}</x:Column></x:ClientData></v:shape>`;
    const out = boCotNguonVml(`<xml><v:shapetype id="t"/>${shape(6)}${shape(7)}${shape(8)}</xml>`);
    expect(out).toContain("<x:Column>6</x:Column>");
    expect((out.match(/<x:Column>7<\/x:Column>/g) ?? []).length).toBe(1); // cột 8 cũ → 7; cột 7 cũ đã bỏ
    expect(out).not.toContain("<x:Column>8</x:Column>");
    expect(out).toContain('<v:shapetype id="t"/>'); // shapetype không bị coi là shape
    expect(out).not.toContain('id="s7"'); // đúng khung của H bị bỏ
    expect(out).toContain('id="s8"');
  });

  const GUIDE =
    '<worksheet><dimension ref="A1:H5"/><sheetData>' +
    '<row r="2"><c r="A2" t="inlineStr"><is><t>tiêu đề</t></is></c></row>' +
    '<row r="3"><c r="A3" t="n"><v>7</v></c><c r="B3" t="inlineStr"><is><t>Kho&#225; quan t&#226;m</t></is></c></row>' +
    '<row r="4" ht="30"><c r="A4" t="n"><v>8</v></c><c r="B4" t="inlineStr"><is><t>Ngu&#7891;n</t></is></c></row>' +
    '<row r="5" ht="15"><c r="A5" s="15" t="n"><v>9</v></c><c r="B5" t="inlineStr"><is><t>Ghi ch&#250;</t></is></c></row>' +
    "</sheetData></worksheet>";

  it("[TPL-NG-07] sheet hướng dẫn: bỏ đúng hàng có ô B = «Nguồn» (thực thể số được giải), dồn hàng sau lên, STT liền mạch, dimension co lại", () => {
    const out = boDongNguonTuDien(GUIDE);
    expect(out).not.toContain("Ngu&#7891;n");
    expect(out).toContain('<row r="4" ht="15"><c r="A4" s="15" t="n"><v>8</v></c><c r="B4" t="inlineStr"><is><t>Ghi ch&#250;</t></is></c></row>');
    expect(out).not.toContain('r="5"');
    expect(out).toContain('<dimension ref="A1:H4"/>');
    // Hàng TRƯỚC dòng gỡ không bị động tới.
    expect(out).toContain('<row r="3"><c r="A3" t="n"><v>7</v></c>');
  });

  it("[TPL-NG-08] đối chứng: không có hàng «Nguồn» ⇒ trả nguyên văn", () => {
    const khong = GUIDE.replace("Ngu&#7891;n", "Kh&#225;c");
    expect(boDongNguonTuDien(khong)).toBe(khong);
  });

  it("[TPL-NG-09] FILE THẬT: header = LEAD_IMPORT_COLUMNS (không «Nguồn», không «Mã NV giới thiệu»); I = Sale phụ trách; J = danh mục khoá ẨN", async () => {
    const buf = await buildLeadImportTemplate({ source: SOURCE, courseNames: COURSES, centerCodes: ["CS1", "CS2"] });
    const wb = XLSX.read(buf, { type: "buffer" });
    const header = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["Lead"]!, { header: 1 })[0] as string[];
    // Cột J (index 9) là nhãn danh mục khoá ẨN — không thuộc `LEAD_IMPORT_COLUMNS`.
    expect(header.slice(0, LEAD_IMPORT_COLUMNS.length)).toEqual([...LEAD_IMPORT_COLUMNS]);
    expect(header).not.toContain("Nguồn");
    expect(header).not.toContain("Mã NV giới thiệu");
    expect(header[8]).toContain("Sale phụ trách");
    expect(header[9]).toBe("DANH MỤC KHOÁ (không xoá)");
    // Không ô nào còn là đúng chữ «Nguồn» / «Nguồn lead» ở BA sheet (tiêu đề cột · từ điển hướng dẫn · ví dụ).
    for (const ten of wb.SheetNames) {
      const o = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[ten]!, { header: 1 }).flat().map(String);
      expect(o, ten).not.toContain("Nguồn");
      expect(o, ten).not.toContain("Nguồn lead");
    }
  });

  it("[TPL-NG-10] FILE THẬT: sheet VÍ DỤ không mất cột nào khác, Ghi chú liền sau Khoá", async () => {
    const buf = await buildLeadImportTemplate({ source: SOURCE, courseNames: COURSES, centerCodes: ["CS1"] });
    const wb = XLSX.read(buf, { type: "buffer" });
    const viDu = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[2]!]!, { header: 1 });
    expect(viDu[1]).toEqual(["Tên phụ huynh", "SĐT", "Email", "Tên con", "Tuổi con", "Cơ sở (mã CS, để trống)", "Khoá quan tâm", "Ghi chú"]);
    expect(viDu[2]).toEqual(["Nguyễn Văn A", "0901234567", "a@example.com", "Nguyễn Bảo Bo", 8, "CS1", "Lập trình Robot", "Quan tâm lớp K-3"]);
  });

  it("[TPL-NG-11] FILE THẬT: mọi phần XML đã vá vẫn là XML HỢP LỆ; autoFilter · tên ẩn · comment · VML cùng trỏ cột H, không còn dấu vết cột I cũ", async () => {
    const buf = await buildLeadImportTemplate({ source: SOURCE, courseNames: COURSES, centerCodes: ["CS1"] });
    const zip = await JSZip.loadAsync(buf);
    const doc = async (p: string) => zip.file(p)!.async("string");
    const sheet1 = await doc("xl/worksheets/sheet1.xml");
    const sheet2 = await doc("xl/worksheets/sheet2.xml");
    const sheet3 = await doc("xl/worksheets/sheet3.xml");
    const wbk = await doc("xl/workbook.xml");
    const cmt = await doc("xl/comments/comment1.xml");
    const vml = await doc("xl/drawings/commentsDrawing1.vml");
    for (const [ten, x] of Object.entries({ sheet1, sheet2, sheet3, wbk, cmt, vml })) expect(xmlHopLe(x), `${ten} không còn là XML hợp lệ`).toBe(true);
    expect(sheet1).toContain('<autoFilter ref="A1:H1"/>');
    expect(wbk).toContain("'Lead'!$A$1:$H$1");
    expect(wbk).not.toContain("$I$1");
    // 8 comment tiêu đề: A..H (Nguồn lead đã bỏ; Ghi chú nay ở H1). Không comment nào nói «Nguồn lead».
    expect((cmt.match(/<comment\s+ref="/g) ?? []).length).toBe(8);
    expect(cmt).not.toContain("Nguồn lead");
    expect(cmt).toMatch(/<comment\s+ref="H1"[\s\S]*?Ghi chú/);
    // VML: 8 khung, cột 0..7 mỗi cột đúng một khung.
    const cot = [...vml.matchAll(/<(\w+):Column>(\d+)<\/\1:Column>/g)].map((m) => Number(m[2]));
    expect(cot.sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // sheet Lead không còn ô nào ở cột I ngoài tiêu đề Sale phụ trách.
    expect([...sheet1.matchAll(/<c r="I(\d+)"/g)].map((m) => m[1])).toEqual(["1"]);
  });
});

describe("buildLeadImportTemplate (vá file thật)", () => {
  it("[TPL-8] GIỮ NGUYÊN 3 sheet + 8 cột đầu của file soạn tay; I = Sale phụ trách (không còn Nguồn / Mã NV giới thiệu)", async () => {
    const buf = await buildLeadImportTemplate({
      source: SOURCE,
      courseNames: COURSES,
      centerCodes: ["CS1", "CS2"],
    });
    const wb = XLSX.read(buf, { type: "buffer" });
    expect(wb.SheetNames[0]).toBe("Lead");
    expect(wb.SheetNames.length).toBe(3); // Lead + 📖 HƯỚNG DẪN + ✅ VÍ DỤ
    const header = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["Lead"]!, { header: 1 })[0];
    expect(header?.slice(0, 9)).toEqual([...LEAD_IMPORT_COLUMNS]);
    expect(LEAD_IMPORT_COLUMNS.length).toBe(9);
  });

  it("[TPL-9] sheet 📖 HƯỚNG DẪN giữ bố cục (bớt đúng 1 dòng từ điển «Nguồn») nhưng cập nhật luật mới", async () => {
    const before = XLSX.read(SOURCE, { type: "buffer" });
    const after = XLSX.read(
      await buildLeadImportTemplate({ source: SOURCE, courseNames: COURSES, centerCodes: ["CS1"] }),
      { type: "buffer" },
    );

    const guideSheet = before.SheetNames[1]!;
    const rowsBefore = XLSX.utils.sheet_to_json<unknown[]>(before.Sheets[guideSheet]!, { header: 1 });
    const rowsAfter = XLSX.utils.sheet_to_json<unknown[]>(after.Sheets[guideSheet]!, { header: 1 });
    expect(rowsAfter.length).toBe(rowsBefore.length - 1); // bớt đúng dòng từ điển của cột «Nguồn»
    expect(rowsAfter[0]).toEqual(rowsBefore[0]); // tiêu đề giữ nguyên
    const text = rowsAfter.flat().filter(Boolean).join(" | ");
    expect(text).toContain("GỘP thành 1 lead nhiều con");
    expect(text).not.toContain("Trùng SĐT sẽ bị BỎ QUA");
    // Bảng từ điển còn đủ 8 cột khác, STT liền mạch 1..8.
    const stt = rowsAfter.filter((r) => typeof r[0] === "number").map((r) => r[0]);
    expect(stt).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("[TPL-10] có dropdown khoá thật + danh mục ghi ở cột J (ẩn)", async () => {
    const buf = await buildLeadImportTemplate({
      source: SOURCE,
      courseNames: COURSES,
      centerCodes: ["CS1", "CS2"],
    });
    const zip = await JSZip.loadAsync(buf);
    const sheetXml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(sheetXml).toContain('sqref="G2:G121"');
    expect(sheetXml).toContain("$J$2:$J$3");
    expect(sheetXml).not.toContain("$L$2");

    const wb = XLSX.read(buf, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Lead"]!, {
      header: 1,
      defval: null,
    }) as unknown as unknown[][];
    expect(rows[1]?.[9]).toBe(COURSES[0]); // J2
    expect(rows[2]?.[9]).toBe(COURSES[1]); // J3
    // Cột I (đứng NGAY trước vùng danh mục) KHÔNG được dính danh mục khoá: nó là ô nhập "Sale phụ trách".
    expect(rows[1]?.[8] ?? null).toBeNull();
  });

  it("[TPL-10b] I1 = 'Sale phụ trách' và cột I KHÔNG bị ẩn (người nhập phải thấy ô để điền); cột danh mục J mới ẩn; không còn K1", async () => {
    const buf = await buildLeadImportTemplate({ source: SOURCE, courseNames: COURSES, centerCodes: ["CS1"] });
    const zip = await JSZip.loadAsync(buf);
    const sheetXml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(sheetXml).toContain('<c r="I1"');
    expect(sheetXml).not.toContain('<c r="K1"');
    const cols = sheetXml.match(/<col\b[^>]*\/>/g) ?? [];
    const an = cols.filter((c) => /hidden="1"/.test(c)).map((c) => /min="(\d+)"/.exec(c)?.[1]);
    expect(an).toContain("10");
    expect(an).not.toContain("9");
    const wb = XLSX.read(buf, { type: "buffer" });
    const dong1 = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["Lead"]!, { header: 1 })[0];
    expect(dong1?.[8]).toBe("Sale phụ trách (email hoặc mã NV, để trống)");
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
