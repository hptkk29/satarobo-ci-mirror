import JSZip from "jszip";
import { LEAD_IMPORT_SALE_HEADER } from "./import";

// =============================================================================
// File mẫu import LEAD — GIỮ NGUYÊN file soạn tay `public/templates/mau-lead-v2.xlsx`
// (3 sheet: Lead + 📖 HƯỚNG DẪN + ✅ VÍ DỤ, màu, comment header, 120 dòng đã format)
// và chỉ VÁ THÊM 3 thứ theo yêu cầu 26/07:
//
//   1. "Khoá quan tâm" (cột G) → DROPDOWN đúng tên khoá đang có trong CRM
//      (`Sata1 — Robosim Master`…). Danh sách dài > 255 ký tự nên không nhét inline
//      được → ghi vào cột K (ẨN) của chính sheet Lead rồi trỏ validation vào đó.
//   2. "Cơ sở" (cột F) → dropdown lấy MÃ CƠ SỞ THẬT thay cho danh sách cứng "CS1,CS2"
//      trong file gốc (thêm cơ sở mới không phải soạn lại mẫu).
//   3. "Tuổi con" (cột E) → ràng buộc SỐ NGUYÊN 3–18 (đúng parseChildAge ở server).
//      Cột E vốn đã là định dạng số (numFmtId 0) và cột B (SĐT) đã là text (numFmtId 49)
//      trong file gốc — patchPhoneAndAgeColumns() chỉ chốt thêm ở cấp CỘT để dòng người
//      dùng thêm mới (ngoài 120 dòng có sẵn) vẫn giữ đúng kiểu.
//
// KHÔNG dựng lại workbook bằng SheetJS: ghi lại sẽ mất format/comment/hướng dẫn của
// file soạn tay (đã burn 26/07). Mọi thay đổi làm ở tầng XML trong zip.
// =============================================================================

/** Đường dẫn file mẫu gốc (soạn tay) trong repo. */
export const LEAD_TEMPLATE_SOURCE = "public/templates/mau-lead-v2.xlsx";

/** Cột chứa danh sách khoá (ẩn) — K = cột thứ 11, ngay sau vùng dữ liệu A..I. */
const LIST_COL = "K";
const LIST_COL_INDEX = 11;

/** Escape text cho XML inline string. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Số dòng dữ liệu của sheet Lead (đọc từ `<dimension ref="A1:I121"/>`). */
export function readLastRow(sheetXml: string, fallback = 121): number {
  const m = /<dimension\s+ref="[A-Z]+\d+:([A-Z]+)(\d+)"/.exec(sheetXml);
  return m ? parseInt(m[2]!, 10) : fallback;
}

/**
 * THUẦN — ghi danh sách khoá vào cột K (ẩn) của sheet Lead: K1 = nhãn, K2… = tên khoá.
 * Chèn ô vào CUỐI mỗi `<row>` tương ứng (cột K đứng sau I nên đúng thứ tự cột).
 * Dòng vượt quá số dòng có sẵn của sheet sẽ bị bỏ (không tạo row mới cho gọn).
 */
export function injectCourseList(sheetXml: string, courses: string[]): string {
  const values = ["DANH MỤC KHOÁ (không xoá)", ...courses];
  let out = sheetXml;

  values.forEach((value, i) => {
    const rowNo = i + 1;
    const cell = `<c r="${LIST_COL}${rowNo}" t="inlineStr"><is><t>${esc(value)}</t></is></c>`;
    const rowOpen = new RegExp(`<row r="${rowNo}"([^>]*)>`);
    if (!rowOpen.test(out)) return;
    out = out.replace(
      new RegExp(`(<row r="${rowNo}"[^>]*>)([\\s\\S]*?)(</row>)`),
      (_m, open: string, body: string, close: string) => `${open}${body}${cell}${close}`,
    );
  });

  // Mở rộng vùng dữ liệu để Excel biết cột K có nội dung.
  out = out.replace(
    /<dimension\s+ref="([A-Z]+\d+):([A-Z]+)(\d+)"\s*\/>/,
    (_m, start: string, _col: string, lastRow: string) =>
      `<dimension ref="${start}:${LIST_COL}${lastRow}"/>`,
  );

  // Ẩn cột danh mục (người nhập không cần thấy).
  if (!out.includes(`min="${LIST_COL_INDEX}"`)) {
    out = out.replace(
      "</cols>",
      `<col min="${LIST_COL_INDEX}" max="${LIST_COL_INDEX}" width="0" hidden="1" customWidth="1"/></cols>`,
    );
  }
  return out;
}

/**
 * THUẦN — chốt kiểu cột: B (SĐT) = text `@`, E (Tuổi con) = số. File gốc đã set đúng
 * cho 120 dòng có sẵn; đây là cho các dòng người dùng thêm bên dưới.
 * Trả về XML mới + index 2 cellXf vừa thêm vào styles.xml.
 */
export function patchStylesXml(stylesXml: string): {
  xml: string;
  textStyleId: number;
  intStyleId: number;
} {
  const m = /<cellXfs count="(\d+)">/.exec(stylesXml);
  if (!m) return { xml: stylesXml, textStyleId: 0, intStyleId: 0 };
  const count = parseInt(m[1]!, 10);
  const added =
    `<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`;
  return {
    xml: stylesXml
      .replace(/<cellXfs count="\d+">/, `<cellXfs count="${count + 2}">`)
      .replace("</cellXfs>", `${added}</cellXfs>`),
    textStyleId: count,
    intStyleId: count + 1,
  };
}

/** THUẦN — gắn style vào `<col>` của cột B (SĐT, text) và E (tuổi, số). */
export function patchPhoneAndAgeColumns(
  sheetXml: string,
  opts: { textStyleId: number; intStyleId: number },
): string {
  return sheetXml.replace(/<col\b[^>]*\/>/g, (colTag) => {
    if (colTag.includes("style=")) return colTag;
    const min = /min="(\d+)"/.exec(colTag)?.[1];
    if (min === "2") return colTag.replace("/>", ` style="${opts.textStyleId}"/>`);
    if (min === "5") return colTag.replace("/>", ` style="${opts.intStyleId}"/>`);
    return colTag;
  });
}

/**
 * THUẦN — dựng lại khối `<dataValidations>`: Cơ sở (F) + Khoá quan tâm (G) + Tuổi con (E).
 * Giữ `errorStyle="warning"` như file gốc: cảnh báo chứ không CHẶN cứng (dán dữ liệu
 * hàng loạt vẫn được), server vẫn là chốt chặn cuối.
 */
export function buildDataValidationsXml(input: {
  lastRow: number;
  courseCount: number;
  centerCodes: string[];
}): string {
  const { lastRow, courseCount, centerCodes } = input;
  const parts: string[] = [];

  if (centerCodes.length > 0) {
    parts.push(
      `<dataValidation sqref="F2:F${lastRow}" showDropDown="0" showInputMessage="1" showErrorMessage="1"` +
        ` allowBlank="1" type="list" errorStyle="warning"` +
        ` promptTitle="${esc("Cơ sở")}" prompt="${esc("Để TRỐNG = cơ sở của bạn. Chỉ điền khi nhập hộ cơ sở khác.")}"` +
        ` errorTitle="${esc("Kiểm tra lại mã cơ sở")}" error="${esc("Mã cơ sở nên nằm trong danh sách gợi ý.")}">` +
        `<formula1>"${esc(centerCodes.join(","))}"</formula1></dataValidation>`,
    );
  }
  if (courseCount > 0) {
    parts.push(
      `<dataValidation sqref="G2:G${lastRow}" showDropDown="0" showInputMessage="1" showErrorMessage="1"` +
        ` allowBlank="1" type="list" errorStyle="warning"` +
        ` promptTitle="${esc("Khoá quan tâm")}" prompt="${esc("Chọn 1 khoá trong danh sách (đúng tên khoá trong hệ thống).")}"` +
        ` errorTitle="${esc("Khoá không khớp")}" error="${esc("Tên khoá phải trùng khoá có thật, nếu không dòng đó sẽ báo lỗi khi import.")}">` +
        `<formula1>$${LIST_COL}$2:$${LIST_COL}$${courseCount + 1}</formula1></dataValidation>`,
    );
  }
  parts.push(
    `<dataValidation sqref="E2:E${lastRow}" showDropDown="0" showInputMessage="1" showErrorMessage="1"` +
      ` allowBlank="1" type="whole" operator="between" errorStyle="warning"` +
      ` promptTitle="${esc("Tuổi con")}" prompt="${esc("Nhập SỐ nguyên từ 3 đến 18.")}"` +
      ` errorTitle="${esc("Tuổi con")}" error="${esc("Tuổi con phải là số nguyên 3–18.")}">` +
      `<formula1>3</formula1><formula2>18</formula2></dataValidation>`,
  );

  return `<dataValidations count="${parts.length}">${parts.join("")}</dataValidations>`;
}

/** THUẦN — thay khối dataValidations cũ (nếu có) bằng khối mới, đúng vị trí schema. */
export function replaceDataValidations(sheetXml: string, validationsXml: string): string {
  if (/<dataValidations[\s\S]*?<\/dataValidations>/.test(sheetXml)) {
    return sheetXml.replace(/<dataValidations[\s\S]*?<\/dataValidations>/, validationsXml);
  }
  if (sheetXml.includes("<pageMargins")) {
    return sheetXml.replace("<pageMargins", `${validationsXml}<pageMargins`);
  }
  return sheetXml.replace("</worksheet>", `${validationsXml}</worksheet>`);
}

/** A1 → 1, B1 → 2, K1 → 11 (so sánh thứ tự cột khi chèn ô mới). */
function colIndexOfRef(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? "";
  return [...letters].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
}

/**
 * THUẦN — đặt nội dung 1 ô dạng inline string, GIỮ NGUYÊN style của ô (`s="…"`).
 * Ô chưa tồn tại thì chèn đúng thứ tự cột trong `<row>`; dòng không tồn tại → bỏ qua.
 * Dùng để cập nhật chữ trong sheet 📖 HƯỚNG DẪN (mô tả cột, quy tắc trùng SĐT…).
 */
export function setInlineCell(sheetXml: string, ref: string, text: string): string {
  const rowNo = /(\d+)$/.exec(ref)?.[1];
  if (!rowNo) return sheetXml;
  const cellRe = new RegExp(`<c r="${ref}"([^>]*?)(/>|>[\\s\\S]*?</c>)`);
  const existing = cellRe.exec(sheetXml);
  const style = /s="(\d+)"/.exec(existing?.[1] ?? "")?.[1];
  const cell =
    `<c r="${ref}"${style ? ` s="${style}"` : ""} t="inlineStr">` +
    `<is><t>${esc(text)}</t></is></c>`;

  if (existing) return sheetXml.replace(cellRe, cell);

  const rowRe = new RegExp(`(<row r="${rowNo}"[^>]*>)([\\s\\S]*?)(</row>)`);
  const row = rowRe.exec(sheetXml);
  if (!row) return sheetXml;

  const target = colIndexOfRef(ref);
  const cells = row[2]!.match(/<c r="[A-Z]+\d+"[\s\S]*?(?:\/>|<\/c>)/g) ?? [];
  const after = cells.find((c) => {
    const r = /r="([A-Z]+\d+)"/.exec(c)?.[1];
    return r ? colIndexOfRef(r) > target : false;
  });
  const body = after ? row[2]!.replace(after, `${cell}${after}`) : `${row[2]}${cell}`;
  return sheetXml.replace(rowRe, `${row[1]}${body}${row[3]}`);
}

/**
 * THUẦN — cập nhật sheet 📖 HƯỚNG DẪN cho khớp hành vi mới (26/07): trùng SĐT nay
 * GỘP con thay vì bỏ qua; để trống cơ sở = cơ sở của người nhập; khoá quan tâm chọn
 * từ dropdown. Ô nào không có trong file thì lệnh tự bỏ qua (không vỡ).
 */
export function patchGuideSheet(
  guideXml: string,
  input: { courseNames: string[]; centerCodes: string[] },
): string {
  const codes = input.centerCodes.join(" / ") || "(chưa có cơ sở)";
  const firstCourse = input.courseNames[0] ?? "";
  const rules: [string, string][] = [
    [
      "A16",
      "Trùng SĐT = CÙNG MỘT NHÀ: các dòng cùng số (trong file hoặc trùng lead đã có) được GỘP thành 1 lead nhiều con — không tạo lead trùng số. Tên phụ huynh ghi khác nhau vẫn gộp, tên đang có được giữ nguyên.",
    ],
    [
      "A20",
      `"Điền dữ liệu vào bảng import LEAD của Sata Robo. Cột BẮT BUỘC: 'Tên phụ huynh', 'SĐT'. Giữ nguyên tên cột, mỗi lead 1 dòng. SĐT để dạng chữ, giữ số 0 đầu, 10 số. Cột 'Cơ sở (mã CS, để trống)' để TRỐNG (hệ thống tự gán cơ sở của người nhập) hoặc chọn: ${codes}. Cột 'Khoá quan tâm' phải đúng tên khoá trong danh sách của file. 1 phụ huynh nhiều con thì ghi mỗi con 1 dòng, cùng SĐT. Trả về dạng bảng đúng thứ tự cột. Dữ liệu thô của tôi: [DÁN VÀO ĐÂY]"`,
    ],
    ["H25", "Trùng SĐT → con của dòng đó được thêm vào lead có sẵn (không tạo lead trùng)."],
    ["F28", "Số nguyên 3–18"],
    ["F29", `Chọn: ${codes}`],
    ["G29", ""],
    [
      "H29",
      "Để TRỐNG = cơ sở của người nhập (quản lý/sale cơ sở). Chỉ HO/Super Admin cần điền mã khi nhập hộ cơ sở khác.",
    ],
    ["E30", "Chọn"],
    ["F30", "Chọn trong danh sách của ô (đúng tên khoá trong hệ thống)"],
    ["G30", firstCourse],
    ["H30", "Sai tên khoá → dòng đó báo lỗi khi import."],
  ];
  return rules.reduce((xml, [ref, text]) => setInlineCell(xml, ref, text), guideXml);
}

export interface LeadTemplateInput {
  /** Nội dung file mẫu gốc (public/templates/mau-lead-v2.xlsx). */
  source: Buffer | Uint8Array;
  /** Tên khoá ĐẦY ĐỦ đúng như trong CRM. */
  courseNames: string[];
  /** Mã cơ sở đang hoạt động (vd CS1, CS2). */
  centerCodes: string[];
}

/** Vá file mẫu lead: dropdown khoá/cơ sở thật + ràng buộc tuổi + kiểu cột SĐT/tuổi. */
export async function buildLeadImportTemplate(input: LeadTemplateInput): Promise<Buffer> {
  const zip = await JSZip.loadAsync(input.source);
  const sheetFile = zip.file("xl/worksheets/sheet1.xml");
  const stylesFile = zip.file("xl/styles.xml");
  if (!sheetFile || !stylesFile) {
    // Không đúng cấu trúc mong đợi → trả nguyên file gốc còn hơn trả file hỏng.
    return Buffer.from(input.source);
  }

  const styles = patchStylesXml(await stylesFile.async("string"));
  let sheet = await sheetFile.async("string");
  const lastRow = readLastRow(sheet);

  // 04/09/2026 — cột "Sale phụ trách" (TUỲ CHỌN). Ghi thêm vào J1 thay vì sửa
  // file mẫu soạn tay: file đó giữ nguyên 9 cột A–I với định dạng + dropdown neo
  // theo chữ cái cột, nên THÊM ở cuối là thao tác duy nhất không dời gì cả.
  sheet = setInlineCell(sheet, "J1", LEAD_IMPORT_SALE_HEADER);

  sheet = injectCourseList(sheet, input.courseNames);
  sheet = patchPhoneAndAgeColumns(sheet, {
    textStyleId: styles.textStyleId,
    intStyleId: styles.intStyleId,
  });
  sheet = replaceDataValidations(
    sheet,
    buildDataValidationsXml({
      lastRow,
      // Danh sách khoá chỉ ghi được tối đa (lastRow - 1) dòng.
      courseCount: Math.min(input.courseNames.length, lastRow - 1),
      centerCodes: input.centerCodes,
    }),
  );

  zip.file("xl/worksheets/sheet1.xml", sheet);
  zip.file("xl/styles.xml", styles.xml);

  // Sheet 2 = 📖 HƯỚNG DẪN: sửa chữ cho khớp luật mới (trùng SĐT gộp con, để trống cơ sở).
  const guideFile = zip.file("xl/worksheets/sheet2.xml");
  if (guideFile) {
    const guide = patchGuideSheet(await guideFile.async("string"), {
      courseNames: input.courseNames,
      centerCodes: input.centerCodes,
    });
    zip.file("xl/worksheets/sheet2.xml", guide);
  }

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
