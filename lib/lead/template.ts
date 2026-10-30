import JSZip from "jszip";
import { GHI_CHU_MOT_FILE_MOT_NGUON } from "@/lib/nguon/nguon-ca-file-ghi-chu";
import { LEAD_IMPORT_SALE_HEADER } from "./import";

// =============================================================================
// File mẫu import LEAD — GIỮ NGUYÊN file soạn tay `public/templates/mau-lead-v2.xlsx`
// (3 sheet: Lead + 📖 HƯỚNG DẪN + ✅ VÍ DỤ, màu, comment header, 120 dòng đã format)
// và chỉ VÁ THÊM 3 thứ theo yêu cầu 26/07:
//
// 28/10/2026 — BỎ CỘT «Nguồn» (cột H của file soạn tay; chủ dự án: «bỏ nguồn ở file mẫu template đi» — nguồn nay là ô «Nguồn của cả file»
// chọn trước khi nhập, `lib/nguon/nguon-ca-file.ts`). File soạn tay VẪN GIỮ NGUYÊN trên đĩa; cột bị gỡ lúc tải mẫu bằng `boCotNguon*` bên dưới
// (cùng tầng XML với các bản vá khác, cùng lý do: dựng lại workbook bằng SheetJS là mất format). Sau khi gỡ: A..H = 8 cột nhập liệu
// (Tên PH · SĐT · Email · Tên con · Tuổi con · Cơ sở · Khoá · Ghi chú), I = Sale phụ trách, J = danh mục khoá (ẨN). Cột «Mã NV giới thiệu» (K cũ) cũng đã bỏ.
//
//   1. "Khoá quan tâm" (cột G) → DROPDOWN đúng tên khoá đang có trong CRM
//      (`Sata1 — Robosim Master`…). Danh sách dài > 255 ký tự nên không nhét inline
//      được → ghi vào cột L (ẨN) của chính sheet Lead rồi trỏ validation vào đó.
//      (Trước 09/10/2026 là cột K; K nay là cột "Mã NV giới thiệu" — cột nhập liệu nhìn thấy được.)
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

/**
 * Cột chứa danh sách khoá (ẩn) — J = cột thứ 10, ngay sau vùng cột nhập liệu A..I (A–H sau khi gỡ cột Nguồn, I = Sale phụ trách).
 * ⚠️ Danh mục ẩn PHẢI đứng SAU mọi cột nhập: nếu nó chiếm đúng cột của một cột nhập thì cột đó bị ẩn và
 * dính danh sách khoá — người nhập không thấy ô để điền, hoặc dán nhầm khoá vào ô mã.
 */
const LIST_COL = "J";
const LIST_COL_INDEX = 10;

/** Chữ cái cột «Nguồn» trong file soạn tay (H) và cột đứng ngay sau nó (I = Ghi chú) — những gì bị gỡ / dời trái bởi `boCotNguon*`. */
const COT_NGUON = "H";
const COT_SAU_NGUON = "I";
/** Chỉ số cột (1-based, như thuộc tính `min`/`max` của `<col>`) của «Nguồn» và cột sau nó. */
const COT_NGUON_INDEX = 8;
const COT_SAU_NGUON_INDEX = 9;

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
 * THUẦN — ghi danh sách khoá vào cột L (ẩn) của sheet Lead: L1 = nhãn, L2… = tên khoá.
 * Chèn ô vào CUỐI mỗi `<row>` tương ứng (cột L đứng sau mọi cột nhập nên đúng thứ tự cột).
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

  // Mở rộng vùng dữ liệu để Excel biết cột danh mục có nội dung.
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
      `Trùng SĐT = CÙNG MỘT NHÀ: các dòng cùng số (trong file hoặc trùng lead đã có) được GỘP thành 1 lead nhiều con — không tạo lead trùng số. Tên phụ huynh ghi khác nhau vẫn gộp, tên đang có được giữ nguyên. NGUỒN không phải cột trong file: chọn «Nguồn của cả file» ở đầu màn nhập (áp cho mọi lead mới; lead đã có giữ nguồn gốc). ${GHI_CHU_MOT_FILE_MOT_NGUON}`,
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

// ── GỠ CỘT «NGUỒN» (28/10/2026) ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// Năm mảnh phải đi CÙNG NHAU, thiếu một là Excel báo «tệp bị hỏng, đang sửa»: ô + `<cols>` + dimension/autoFilter/merge (sheet dữ liệu) · tên ẩn `_FilterDatabase`
// (workbook) · comment tiêu đề (comments + VML) · dòng từ điển của sheet HƯỚNG DẪN. Mỗi mảnh là một hàm THUẦN có test; mảnh nào không thấy thứ cần gỡ thì trả nguyên văn.

/** THUẦN — gỡ cột H («Nguồn») khỏi một sheet dữ liệu (sheet Lead hoặc VÍ DỤ) và dời cột I («Ghi chú») sang H. Vùng `<cols>`, dimension, autoFilter và mergeCell đi theo. */
export function boCotNguonSheet(sheetXml: string): string {
  let out = sheetXml;
  // Ô của cột H: gỡ hẳn (ô rỗng `<c …></c>` · ô chữ `<c …><is>…</is></c>` · ô tự đóng `<c …/>`). Rồi ô cột I đổi tên thành H.
  out = out.replace(new RegExp(`<c r="${COT_NGUON}\\d+"[^>]*?(?:/>|>[\\s\\S]*?</c>)`, "g"), "");
  out = out.replace(new RegExp(`<c r="${COT_SAU_NGUON}(\\d+)"`, "g"), `<c r="${COT_NGUON}$1"`);
  // Vùng tham chiếu kết thúc ở cột I → H (dimension · autoFilter · mergeCell).
  out = out.replace(new RegExp(`(<dimension\\s+ref="[A-Z]+\\d+:)${COT_SAU_NGUON}(\\d+")`), `$1${COT_NGUON}$2`);
  out = out.replace(new RegExp(`(<autoFilter\\s+ref="[A-Z]+\\d+:)${COT_SAU_NGUON}(\\d+")`), `$1${COT_NGUON}$2`);
  out = out.replace(new RegExp(`(<mergeCell\\s+ref="[A-Z]+\\d+:)${COT_SAU_NGUON}(\\d+")`, "g"), `$1${COT_NGUON}$2`);
  // Độ rộng cột: bỏ cột 8, cột 9 thành cột 8.
  out = out.replace(/<col\b[^>]*\/>/g, (tag) => {
    const min = /\bmin="(\d+)"/.exec(tag)?.[1];
    const max = /\bmax="(\d+)"/.exec(tag)?.[1];
    if (min === String(COT_NGUON_INDEX) && max === String(COT_NGUON_INDEX)) return "";
    if (min === String(COT_SAU_NGUON_INDEX) && max === String(COT_SAU_NGUON_INDEX)) {
      return tag.replace(`min="${COT_SAU_NGUON_INDEX}"`, `min="${COT_NGUON_INDEX}"`).replace(`max="${COT_SAU_NGUON_INDEX}"`, `max="${COT_NGUON_INDEX}"`);
    }
    return tag;
  });
  return out;
}

/** THUẦN — tên ẩn `_FilterDatabase` của workbook trỏ `$A$1:$I$1` → `$A$1:$H$1` (khớp autoFilter mới). */
export function boCotNguonWorkbook(workbookXml: string): string {
  return workbookXml.replace(new RegExp(`(\\$A\\$1:\\$)${COT_SAU_NGUON}(\\$1)`, "g"), `$1${COT_NGUON}$2`);
}

/** THUẦN — bỏ comment tiêu đề của ô H1 («Nguồn lead») và dời comment I1 sang H1. */
export function boCotNguonComments(commentsXml: string): string {
  return commentsXml
    .replace(new RegExp(`<comment\\s+ref="${COT_NGUON}1"[\\s\\S]*?</comment>`), "")
    .replace(new RegExp(`<comment\\s+ref="${COT_SAU_NGUON}1"`), `<comment ref="${COT_NGUON}1"`);
}

/** THUẦN — bỏ khung VML của comment cột H (`Column` 7, 0-based) và hạ `Column` 8 xuống 7. */
export function boCotNguonVml(vml: string): string {
  return vml.replace(/<(\w+):shape\b[\s\S]*?<\/\1:shape>/g, (shape) => {
    const m = /<(\w+):Column>(\d+)<\/\1:Column>/.exec(shape);
    if (!m) return shape;
    const cot = Number(m[2]);
    if (cot === COT_NGUON_INDEX - 1) return "";
    if (cot === COT_SAU_NGUON_INDEX - 1) return shape.replace(m[0], `<${m[1]}:Column>${cot - 1}</${m[1]}:Column>`);
    return shape;
  });
}

/** Giải `&#7891;` → ký tự (file soạn tay ghi chữ có dấu dưới dạng thực thể số). */
function giaiThucThe(s: string): string {
  return s.replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)));
}

/**
 * THUẦN — bỏ DÒNG TỪ ĐIỂN của cột «Nguồn» ở sheet 📖 HƯỚNG DẪN (hàng có ô B = «Nguồn») và dồn các hàng sau nó lên một hàng (số hàng, tham chiếu ô, số STT ở cột A, dimension).
 * Giả định có chủ đích: mọi hàng SAU dòng này đều là dòng từ điển cột (STT ở cột A) và không có mergeCell nào nằm dưới nó — đúng với file soạn tay (nó là hàng áp chót của sheet).
 * Không thấy hàng «Nguồn» ⇒ trả nguyên văn.
 */
export function boDongNguonTuDien(guideXml: string): string {
  let soHang: number | null = null;
  for (const m of guideXml.matchAll(/<row r="(\d+)"[^>]*>[\s\S]*?<\/row>/g)) {
    const o = new RegExp(`<c r="B${m[1]}"[^>]*><is><t>([^<]*)</t></is></c>`).exec(m[0]);
    if (o && giaiThucThe(o[1]!).trim() === "Nguồn") {
      soHang = Number(m[1]);
      break;
    }
  }
  if (soHang === null) return guideXml;
  const dongGoc = soHang;
  let out = guideXml.replace(new RegExp(`<row r="${dongGoc}"[^>]*>[\\s\\S]*?</row>`), "");
  out = out.replace(/<row r="(\d+)"([^>]*)>([\s\S]*?)<\/row>/g, (hang, so: string, thuocTinh: string, than: string) => {
    const n = Number(so);
    if (n <= dongGoc) return hang;
    const thanMoi = than
      .replace(new RegExp(`<c r="([A-Z]+)${n}"`, "g"), `<c r="$1${n - 1}"`)
      // STT (cột A, kiểu số): hạ một bậc để bảng vẫn liền mạch 1..N.
      .replace(new RegExp(`(<c r="A${n - 1}"[^>]*t="n"[^>]*><v>)(\\d+)(</v>)`), (_m, a: string, k: string, z: string) => `${a}${Number(k) - 1}${z}`);
    return `<row r="${n - 1}"${thuocTinh}>${thanMoi}</row>`;
  });
  out = out.replace(/(<dimension\s+ref="[A-Z]+\d+:[A-Z]+)(\d+)(")/, (_m, a: string, k: string, z: string) => `${a}${Number(k) - 1}${z}`);
  return out;
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
  // 28/10/2026 — gỡ cột «Nguồn» TRƯỚC mọi bản vá khác: các ô/cột thêm bên dưới (Sale phụ trách, danh mục khoá) tính theo bố cục SAU khi gỡ.
  let sheet = boCotNguonSheet(await sheetFile.async("string"));
  const lastRow = readLastRow(sheet);

  // 04/09/2026 — cột "Sale phụ trách" (TUỲ CHỌN). Ghi thêm vào cột đứng ngay sau vùng nhập của file soạn tay (I1 sau khi gỡ «Nguồn»; trước đó là J1) thay vì sửa
  // file mẫu soạn tay: file đó giữ định dạng + dropdown neo theo chữ cái cột, nên THÊM ở cuối là thao tác duy nhất không dời gì cả. Phải đặt TRƯỚC `injectCourseList`.
  sheet = setInlineCell(sheet, "I1", LEAD_IMPORT_SALE_HEADER);

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

  // Sheet 2 = 📖 HƯỚNG DẪN: sửa chữ cho khớp luật mới (trùng SĐT gộp con, để trống cơ sở) và bỏ dòng từ điển của cột «Nguồn».
  const guideFile = zip.file("xl/worksheets/sheet2.xml");
  if (guideFile) {
    const guide = patchGuideSheet(boDongNguonTuDien(await guideFile.async("string")), {
      courseNames: input.courseNames,
      centerCodes: input.centerCodes,
    });
    zip.file("xl/worksheets/sheet2.xml", guide);
  }

  // Phần còn lại của việc gỡ cột «Nguồn»: sheet VÍ DỤ · tên ẩn của workbook · comment tiêu đề (+ khung VML). Mảnh nào file không có thì bỏ qua (không vỡ).
  const viDuFile = zip.file("xl/worksheets/sheet3.xml");
  if (viDuFile) zip.file("xl/worksheets/sheet3.xml", boCotNguonSheet(await viDuFile.async("string")));
  const workbookFile = zip.file("xl/workbook.xml");
  if (workbookFile) zip.file("xl/workbook.xml", boCotNguonWorkbook(await workbookFile.async("string")));
  const commentsFile = zip.file("xl/comments/comment1.xml");
  if (commentsFile) zip.file("xl/comments/comment1.xml", boCotNguonComments(await commentsFile.async("string")));
  const vmlFile = zip.file("xl/drawings/commentsDrawing1.vml");
  if (vmlFile) zip.file("xl/drawings/commentsDrawing1.vml", boCotNguonVml(await vmlFile.async("string")));

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
