// Task #07 Việc 1 — Import danh sách "khách ĐÃ ĐĂNG KÝ" (file Excel thật của Sale)
// → Lead status REGISTERED + LeadChild per học viên.
//
// Pure — không import xlsx/db, testable bằng Vitest. Route chuyển workbook thành
// AoA (array-of-arrays) rồi gọi parseRegisteredSheets() + planRegisteredImport().
//
// Đặc thù file thật (đã phân tích):
// - 3 sheet theo tháng ("Tháng 52026"…), sheet SAU có thể TÍCH LŨY data sheet trước
//   → dedupe cross-sheet theo (SĐT chuẩn hoá + tên học viên chuẩn hoá) BẮT BUỘC.
// - Header khác nhau giữa sheet (Tháng 5 ở row 2, Tháng 6/7 ở row 1, thêm cột)
//   → detect header row + map theo TÊN cột (chuẩn hoá bỏ dấu), KHÔNG theo index.
// - Data bẩn: SĐT trailing space / thiếu số 0 đầu; học phí lẫn number + chuỗi
//   "4.640.000đ"; mã HV lẫn "CS1.HV0032" (thiếu dấu chấm); ~2000 dòng STT đánh
//   sẵn nhưng trống → bỏ dòng không có tên học viên + SĐT.
//
// Quyết định nghiệp vụ (phiếu #07 — KHÔNG hỏi lại):
// - Câu 34: trùng (theo SĐT chuẩn hoá) → GỘP: giữ record cũ, bổ sung field trống,
//   append ghi chú. Cùng SĐT + cùng tên HV = cùng bản ghi; cùng SĐT + khác tên
//   = 1 PH nhiều con → 1 Lead nhiều LeadChild.
// - Câu 4(1) BGĐ: 1 PH có 1 hoặc nhiều con.
// - Import = Lead REGISTERED, KHÔNG tự tạo Student/Enrollment (convert đi flow
//   convert v2 chính thống). Mã HV cũ + học phí + tình trạng TT → lưu note để
//   Sale đối chiếu khi convert. Học phí giữ NGUYÊN chuỗi gốc (không parse số —
//   data có typo "1.000.0000Đ", không tự "sửa" tiền).
// - CCCD Học viên: KHÔNG import (CLAUDE.md — không lưu giấy tờ tùy thân học viên).
//   CCCD Phụ huynh: lưu vào note có cấu trúc (cần cho xuất hoá đơn — câu 42/32).

import { normalizePhone, isValidPhone } from "./import";

export type CellValue = string | number | boolean | Date | null | undefined;

export interface SheetAoA {
  name: string;
  rows: CellValue[][];
}

export interface SheetRowError {
  sheet: string;
  /** Số dòng Excel (1-based, như hiển thị trong Excel). */
  row: number;
  reason: string;
}

export interface ParsedRegisteredChild {
  fullName: string;
  grade: string | null; // "Lớp 7" — giữ nguyên text → LeadChild.gradeLevel
  courseRaw: string | null; // "Sata 4" — resolve courseId ở planner, giữ raw trong note
  tuitionRaw: string | null; // giữ NGUYÊN chuỗi gốc (kể cả typo)
  paymentStatus: string | null; // "Đã thanh toán"…
  studentCodeOld: string | null; // mã HV cũ đã chuẩn hoá "CS1.HV.0032"
  invoiceRef: string | null;
  bank: string | null;
  invoiceIssued: string | null;
  dateRegistered: string | null; // dd/mm/yyyy
  noteRaw: string | null; // cột Ghi chú
  centerCode: string | null; // CS của dòng này (có thể khác giữa các con)
  /** 04/08 — tuổi suy từ cột Lớp (lớp + 5); null nếu cột Lớp trống/không đọc được. */
  ageYears: number | null;
  /** 04/08 — số tiền đọc được từ cột Học phí; null nếu chuỗi không chắc chắn. */
  paidAmount: number | null;
  /** 04/08 — FULL: đã đóng đủ (công nợ 0) · HALF: ghi chú nhắc 50%, còn nợ. */
  feeMode: FeeMode;
  /** 04/08 — khách trả làm 2 đợt (mặc định suy từ ghi chú, sửa tay được). */
  payIn2: boolean;
  /** 04/08 — hạn đóng đợt 2 (yyyy-mm-dd). Không có thì KHÔNG lập được kế hoạch. */
  dueDate2: string | null;
  /** 04/08 — chương trình giảm giá nhập tay ở màn xem thử. */
  discountKind: DiscountKind | null;
  discountValue: number | null;
  discountReason: string | null;
  /** 04/08 — cảnh báo từng dòng để soi TRƯỚC khi ghi (không chặn import). */
  warnings: string[];
  sources: { sheet: string; row: number }[];
}

export interface ParsedRegisteredParent {
  phone: string; // đã chuẩn hoá
  parentName: string | null; // nhiều dòng không có tên PH → planner fallback
  parentCccd: string | null; // giữ raw (kể cả text "không xin được thông tin")
  address: string | null;
  salesName: string | null; // tên ngắn ("Liên") — planner fuzzy-map sang User
  source: string | null; // cột Nguồn (chỉ có ở sheet Tháng 6/7)
  centerCode: string | null; // CS đầu tiên thấy được
  extraNotes: string[]; // ghi chú phát sinh khi gộp (vd tên PH khác nhau giữa dòng)
  children: ParsedRegisteredChild[];
}

/**
 * 04/08 — SỬA TAY NGAY TRÊN MÀN XEM THỬ.
 *
 * Người nhập soi bảng "cần kiểm tra", sửa ô nào thì gửi kèm giá trị mới; parser
 * ĐÈ giá trị đó lên ô gốc TRƯỚC khi suy diễn. Nhờ vậy mọi thứ phía sau tự tính
 * lại theo giá trị đã sửa: tuổi, số tiền, cách đóng, cơ sở, gộp trùng, và cả
 * cảnh báo (sửa xong thì cảnh báo tự biến mất) — không có đường nào lệch giữa
 * cái người ta nhìn thấy và cái được ghi.
 *
 * Khoá theo `sheet` + số dòng Excel: ổn định qua các lần xem thử lại.
 * KHÔNG cho đè `phone`/`studentName` — hai trường đó là ĐỊNH DANH gộp trùng; sửa
 * chúng ở đây là âm thầm đổi lead nào gộp vào lead nào. Sai số điện thoại thì
 * sửa trong Excel rồi tải lại.
 */
export type OverridableCol =
  | "grade"
  | "course"
  | "tuition"
  | "center"
  | "parentName"
  | "parentCccd"
  | "address"
  | "note"
  | "source"
  | "sales"
  // 04/08 — không phải cột trong Excel, mà là quyết định người nhập gõ ở màn xem thử.
  | "payIn2"
  | "discountKind"
  | "discountValue"
  | "discountReason"
  | "dueDate2";

export interface RegisteredRowOverride {
  sheet: string;
  /** Số dòng Excel (1-based) — đúng con số hiện ở bảng xem thử. */
  row: number;
  values: Partial<Record<OverridableCol, string>>;
}

/** Khoá tra override cho 1 dòng. */
export function overrideKey(sheet: string, row: number): string {
  return `${sheet}|${row}`;
}

export interface ParsedRegistered {
  /** Tổng dòng dữ liệu đã đọc (sau header, mọi sheet — kể cả dòng trống). */
  totalDataRows: number;
  /** Dòng trống bỏ qua (không có tên học viên + SĐT — gồm ~2000 dòng STT đánh sẵn). */
  skippedEmpty: number;
  /** Dòng hợp lệ (đã qua validate, TRƯỚC dedupe cross-sheet). */
  validRows: number;
  /** Dòng lặp cross-sheet đã gộp (cùng SĐT + cùng tên học viên). */
  mergedDuplicateRows: number;
  errors: SheetRowError[];
  parents: ParsedRegisteredParent[];
}

// ─── Chuẩn hoá ──────────────────────────────────────────────────────────────

/** Bỏ dấu tiếng Việt + lowercase + gộp khoảng trắng (so khớp header/tên).
 *  Character class bên dưới = dải combining marks U+0300–U+036F (sau NFD). */
export function normalizeVi(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * SĐT cho luồng import "khách đã đăng ký".
 * AUTH-SĐT P1 — case "Excel lưu number làm mất số 0 đầu" nay nằm trong
 * `canonicalPhone` (nhánh 9 chữ số trần), nên hàm này chỉ còn là alias giữ tên.
 */
export function normalizeRegisteredPhone(raw: unknown): string {
  return normalizePhone(raw);
}

/** Mã HV cũ: "CS1.HV0032" / "cs1.hv.0032" → "CS1.HV.0032"; format lạ giữ raw. */
export function normalizeStudentCode(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = s.replace(/\s+/g, "").match(/^(CS\d+)\.?(HV)\.?(\d+)$/i);
  if (!m) return s;
  return `${m[1].toUpperCase()}.${m[2].toUpperCase()}.${m[3]}`;
}

/** Cột Cơ sở "CS2: Hoàng Diệu" → "CS2"; fallback từ mã HV "CS1.HV.0031" → "CS1". */
export function extractCenterCode(centerCell: unknown, studentCode: string | null): string | null {
  const fromCell = String(centerCell ?? "").trim().match(/^(CS\d+)/i);
  if (fromCell) return fromCell[1].toUpperCase();
  const fromCode = (studentCode ?? "").match(/^(CS\d+)\./i);
  if (fromCode) return fromCode[1].toUpperCase();
  return null;
}

/** Excel serial / Date / chuỗi → "dd/mm/yyyy" (làm tròn về ngày, tránh lệch TZ). */
export function formatExcelDate(raw: CellValue): string | null {
  const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
  let dayMs: number | null = null;
  if (typeof raw === "number" && raw > 20000 && raw < 80000) {
    dayMs = EXCEL_EPOCH_UTC + Math.round(raw) * 86400000;
  } else if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    dayMs = EXCEL_EPOCH_UTC + Math.round((raw.getTime() - EXCEL_EPOCH_UTC) / 86400000) * 86400000;
  } else if (typeof raw === "string" && raw.trim()) {
    return raw.trim(); // đã là text — giữ nguyên
  }
  if (dayMs === null) return null;
  const d = new Date(dayMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function cellStr(v: CellValue): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return formatExcelDate(v);
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * Lớp văn hoá → TUỔI. Quy ước chủ dự án chốt 04/08: lớp 1 = 6 tuổi ⇒ tuổi = lớp + 5.
 * Ô trống / không đọc được số lớp → null (KHÔNG đoán bừa tuổi cho hồ sơ trẻ em).
 */
export function ageFromGrade(grade: string | null): number | null {
  if (!grade) return null;
  const n = /(\d{1,2})/.exec(grade)?.[1];
  if (!n) return null;
  const g = Number(n);
  if (!Number.isInteger(g) || g < 1 || g > 12) return null;
  return g + 5;
}

/**
 * "4,640,000vnd" · "3.986.000" · "1,000,000 vnd" → 4640000. Trả null khi không
 * đọc được CHẮC CHẮN (chuỗi chữ, nhiều số rời rạc…) — thà để trống còn hơn ghi
 * sai một con số tiền.
 */
export function parseTuitionAmount(raw: string | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/vnd|đ|vnđ/gi, " ").trim();
  const digits = cleaned.replace(/[.,\s]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000_000) return null;
  return n;
}

/**
 * Cách đóng, suy từ cột Ghi chú (luật chủ dự án chốt 04/08):
 *  · ghi chú nhắc "50%"        → HALF  : số trong cột là MỘT NỬA, còn nợ phần kia
 *  · còn lại                    → FULL  : số trong cột là ĐÃ ĐÓNG ĐỦ, và cũng CHÍNH LÀ
 *                                        tổng đơn (đã trừ khuyến mãi) ⇒ công nợ = 0
 * Ghi chú nhắc "đợt"/"cọc"/"còn lại" KHÔNG tự xếp vào HALF — nó chỉ được ĐÁNH DẤU
 * để người nhập soi, vì mỗi câu một kiểu và đoán sai là sai tiền.
 */
export type FeeMode = "FULL" | "HALF";

/** Kiểu giảm giá nhập ở màn xem thử — theo SỐ TIỀN hoặc theo %. */
export type DiscountKind = "AMOUNT" | "PERCENT";

/**
 * Ghi chú có nói khách trả LÀM 2 ĐỢT không?
 * Bắt cả "đóng 2 đợt" lẫn "50%" — 50% học phí nghĩa là còn một nửa, tức 2 đợt.
 * Người nhập vẫn tick/bỏ tick tay được ở màn xem thử; đây chỉ là giá trị mặc định.
 */
export function payIn2FromNote(note: string | null): boolean {
  if (!note) return false;
  // Bỏ dấu trước khi khớp: chuỗi tiếng Việt vào đây từ nhiều nguồn (Excel, gõ tay,
  // file test) và có cả dạng NFC lẫn NFD — so khớp trực tiếp "đợt" là trượt im lặng.
  const n = normalizeVi(note);
  return /50\s*%/.test(n) || /(2\s*dot|hai\s*dot|dot\s*1|dot\s*2)/.test(n);
}

export function feeModeFromNote(note: string | null): FeeMode {
  return note && /50\s*%/.test(note) ? "HALF" : "FULL";
}

/** Học phí: number → chuỗi số nguyên; chuỗi → giữ NGUYÊN (không parse/sửa tiền). */
function tuitionStr(v: CellValue): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(Math.round(v));
  return cellStr(v);
}

// ─── Header detection + column mapping ──────────────────────────────────────

type ColKey =
  | "date"
  | "studentCode"
  | "studentName"
  | "grade"
  | "phone"
  | "source"
  | "course"
  | "tuition"
  | "center"
  | "paymentStatus"
  | "sales"
  | "note"
  | "invoice"
  | "bank"
  | "parentName"
  | "parentCccd"
  | "address"
  | "invoiceIssued";

// So khớp EXACT trên tên đã bỏ dấu ("hoc phi" ≠ "hoa don hoc phi").
// ⚠️ CỐ Ý KHÔNG map "cccd hoc vien" — KHÔNG import giấy tờ tùy thân học viên.
const HEADER_MAP: Record<string, ColKey> = {
  "ngay": "date",
  "ma hoc vien": "studentCode",
  "ho va ten hoc vien": "studentName",
  "ten hoc vien": "studentName",
  "lop": "grade",
  "so dien thoai": "phone",
  "sdt": "phone",
  "nguon": "source",
  "khoa hoc dang ky": "course",
  "hoc phi": "tuition",
  "co so": "center",
  "tinh trang": "paymentStatus",
  "sales": "sales",
  "sale": "sales",
  "ghi chu": "note",
  "hoa don hoc phi": "invoice",
  "hoa don dong hoc phi": "invoice",
  "ngan hang": "bank",
  "ten phu huynh": "parentName",
  "cccd phu huynh": "parentCccd",
  "dia chi": "address",
  "da xuat hoa don": "invoiceIssued",
};

const HEADER_SCAN_ROWS = 10;

/** Tìm dòng header (có "số điện thoại" + tên học viên) trong N dòng đầu. */
function findHeader(rows: CellValue[][]): { rowIdx: number; cols: Map<ColKey, number> } | null {
  for (let i = 0; i < Math.min(HEADER_SCAN_ROWS, rows.length); i++) {
    const cols = new Map<ColKey, number>();
    for (let c = 0; c < rows[i].length; c++) {
      const key = HEADER_MAP[normalizeVi(rows[i][c])];
      if (key !== undefined && !cols.has(key)) cols.set(key, c);
    }
    if (cols.has("phone") && cols.has("studentName")) return { rowIdx: i, cols };
  }
  return null;
}

// ─── Parse ──────────────────────────────────────────────────────────────────

export function parseRegisteredSheets(
  sheets: SheetAoA[],
  overrides: readonly RegisteredRowOverride[] = [],
): ParsedRegistered {
  const overrideByRow = new Map<string, Partial<Record<OverridableCol, string>>>();
  for (const o of overrides) overrideByRow.set(overrideKey(o.sheet, o.row), o.values);

  const errors: SheetRowError[] = [];
  let totalDataRows = 0;
  let skippedEmpty = 0;
  let validRows = 0;
  let mergedDuplicateRows = 0;

  // key = phone → parent; key = phone|normName(child) → child (dedupe cross-sheet)
  const parents = new Map<string, ParsedRegisteredParent>();
  const childByKey = new Map<string, ParsedRegisteredChild>();

  for (const sheet of sheets) {
    const header = findHeader(sheet.rows);
    if (!header) {
      errors.push({
        sheet: sheet.name,
        row: 0,
        reason: "Không tìm thấy dòng tiêu đề (cần cột 'Số điện thoại' + 'Họ và Tên học viên')",
      });
      continue;
    }
    const { rowIdx, cols } = header;
    const rawCol = (row: CellValue[], key: ColKey): CellValue => {
      const idx = cols.get(key);
      return idx === undefined ? null : row[idx];
    };

    for (let i = rowIdx + 1; i < sheet.rows.length; i++) {
      const row = sheet.rows[i];
      const excelRow = i + 1; // 1-based như Excel
      totalDataRows++;

      // Giá trị người nhập sửa tay ở màn xem thử ĐÈ lên ô gốc, TRƯỚC mọi suy diễn.
      // Chuỗi rỗng = "xoá ô này" (có chủ đích, để bỏ ghi chú rác).
      const patch = overrideByRow.get(overrideKey(sheet.name, excelRow));
      const col = (r: CellValue[], key: ColKey): CellValue => {
        if (patch && key in patch) return patch[key as OverridableCol] ?? null;
        return rawCol(r, key);
      };

      const studentName = cellStr(col(row, "studentName"));
      const phoneCell = col(row, "phone");
      const phone = normalizeRegisteredPhone(phoneCell);

      // Dòng trống (kể cả dòng STT đánh số sẵn): không tên + không SĐT → bỏ qua.
      if (!studentName && !phone) {
        skippedEmpty++;
        continue;
      }
      if (!studentName) {
        errors.push({ sheet: sheet.name, row: excelRow, reason: "Thiếu tên học viên" });
        continue;
      }
      if (!phone) {
        errors.push({ sheet: sheet.name, row: excelRow, reason: "Thiếu số điện thoại" });
        continue;
      }
      if (!isValidPhone(phone)) {
        errors.push({
          sheet: sheet.name,
          row: excelRow,
          reason: `SĐT không hợp lệ: "${String(phoneCell ?? "").trim()}"`,
        });
        continue;
      }
      validRows++;

      const studentCodeOld = normalizeStudentCode(col(row, "studentCode"));
      const centerCode = extractCenterCode(col(row, "center"), studentCodeOld);
      const grade = cellStr(col(row, "grade"));
      const courseRaw = cellStr(col(row, "course"));
      const tuitionRaw = tuitionStr(col(row, "tuition"));
      const noteRaw = cellStr(col(row, "note"));
      const parentName = cellStr(col(row, "parentName"));

      const ageYears = ageFromGrade(grade);
      const paidAmount = parseTuitionAmount(tuitionRaw);
      const feeMode = feeModeFromNote(noteRaw);

      // Trả 2 đợt: mặc định suy từ ghi chú ("2 đợt" / "50%"), người nhập tick lại được.
      const payIn2Raw = patch?.payIn2;
      const payIn2 =
        payIn2Raw === undefined ? payIn2FromNote(noteRaw) : payIn2Raw === "1" || payIn2Raw === "true";

      // Chương trình giảm giá — chỉ có khi người nhập gõ ở màn xem thử (file Excel
      // không có cột này). Giá trị vô lý → bỏ, KHÔNG tự sửa thành số khác.
      const dkRaw = patch?.discountKind;
      const discountKind: DiscountKind | null =
        dkRaw === "AMOUNT" || dkRaw === "PERCENT" ? dkRaw : null;
      const dvNum = Number(String(patch?.discountValue ?? "").replace(/[.,\s]/g, ""));
      const discountValue =
        discountKind && Number.isFinite(dvNum) && dvNum > 0
          ? discountKind === "PERCENT"
            ? Math.min(100, Math.round(dvNum))
            : Math.round(dvNum)
          : null;
      const discountReason = (patch?.discountReason ?? "").trim() || null;
      const dd2 = (patch?.dueDate2 ?? "").trim();
      const dueDate2 = /^\d{4}-\d{2}-\d{2}$/.test(dd2) ? dd2 : null;

      // 04/08 — CẢNH BÁO, không phải lỗi: dòng vẫn vào được, chỉ là người nhập cần
      // soi trước khi ghi. Mục đích: thấy hết ở màn xem thử, khỏi phải dò từng lead
      // sau khi đã nhập vào hệ thống.
      const warnings: string[] = [];
      if (!grade) warnings.push("thiếu Lớp → không suy được tuổi");
      else if (ageYears === null) warnings.push(`Lớp không đọc được số: "${grade}"`);
      if (!courseRaw) warnings.push("thiếu Khoá học đăng ký");
      if (!tuitionRaw) warnings.push("thiếu Học phí");
      else if (paidAmount === null) warnings.push(`Học phí không đọc được số: "${tuitionRaw}"`);
      if (feeMode === "HALF") warnings.push("ghi chú nhắc 50% → còn nợ, kiểm số tiền");
      else if (noteRaw && /%/.test(noteRaw)) {
        warnings.push("ghi chú có giảm theo % → xác nhận số đã đóng");
      } else if (noteRaw && /(đợt|cọc|còn lại|còn thiếu)/i.test(noteRaw)) {
        warnings.push("ghi chú nhắc đợt/cọc/còn lại → xác nhận số đã đóng");
      }
      if (payIn2 && !dueDate2) {
        // Không có hạn thì bước chốt KHÔNG lập được kế hoạch 2 đợt (và không có QR đợt 2).
        warnings.push("đóng 2 đợt nhưng CHƯA có hạn đợt 2");
      }
      if (discountValue !== null && !discountReason) {
        // Cùng luật với màn tạo đơn: giảm giá PHẢI có giải trình.
        warnings.push("có giảm giá nhưng CHƯA giải trình");
      }
      // File không ghi tên PH KHÔNG còn là "thiếu" — hệ thống tự điền "Phụ huynh của
      // <tên con>" (chốt 05/08). Vẫn nêu ra để người nhập biết mà sửa nếu có tên thật.
      if (!parentName) warnings.push('tên PH tự điền theo tên con — sửa nếu biết tên thật');
      if (!cellStr(col(row, "parentCccd"))) warnings.push("thiếu CCCD Phụ Huynh");
      if (!cellStr(col(row, "address"))) warnings.push("thiếu Địa chỉ");

      const childData: Omit<ParsedRegisteredChild, "sources"> = {
        fullName: studentName,
        grade,
        courseRaw,
        tuitionRaw,
        paymentStatus: cellStr(col(row, "paymentStatus")),
        studentCodeOld,
        invoiceRef: cellStr(col(row, "invoice")),
        bank: cellStr(col(row, "bank")),
        invoiceIssued: cellStr(col(row, "invoiceIssued")),
        dateRegistered: formatExcelDate(col(row, "date")),
        noteRaw,
        centerCode,
        ageYears,
        paidAmount,
        feeMode,
        payIn2,
        dueDate2,
        discountKind,
        discountValue,
        discountReason,
        warnings,
      };
      const rowParent = {
        parentName,
        parentCccd: cellStr(col(row, "parentCccd")),
        address: cellStr(col(row, "address")),
        salesName: cellStr(col(row, "sales")),
        source: cellStr(col(row, "source")),
        centerCode,
      };

      // Gộp theo SĐT → 1 PH; theo SĐT + tên HV (chuẩn hoá) → 1 con.
      let parent = parents.get(phone);
      if (!parent) {
        parent = {
          phone,
          parentName: rowParent.parentName,
          parentCccd: rowParent.parentCccd,
          address: rowParent.address,
          salesName: rowParent.salesName,
          source: rowParent.source,
          centerCode: rowParent.centerCode,
          extraNotes: [],
          children: [],
        };
        parents.set(phone, parent);
      } else {
        // Câu 34: giữ giá trị cũ, bổ sung field trống; tên PH khác → ghi chú.
        if (!parent.parentName) parent.parentName = rowParent.parentName;
        else if (
          rowParent.parentName &&
          normalizeVi(rowParent.parentName) !== normalizeVi(parent.parentName)
        ) {
          const note = `Tên PH khác trong file: ${rowParent.parentName}`;
          if (!parent.extraNotes.includes(note)) parent.extraNotes.push(note);
        }
        if (!parent.parentCccd) parent.parentCccd = rowParent.parentCccd;
        if (!parent.address) parent.address = rowParent.address;
        if (!parent.salesName) parent.salesName = rowParent.salesName;
        if (!parent.source) parent.source = rowParent.source;
        if (!parent.centerCode) parent.centerCode = rowParent.centerCode;
      }

      const childKey = `${phone}|${normalizeVi(studentName)}`;
      const existingChild = childByKey.get(childKey);
      if (!existingChild) {
        const child: ParsedRegisteredChild = {
          ...childData,
          sources: [{ sheet: sheet.name, row: excelRow }],
        };
        childByKey.set(childKey, child);
        parent.children.push(child);
      } else {
        // Dòng lặp cross-sheet → gộp, đắp field trống.
        //
        // ⚠️ KHÔNG cộng dồn học phí. Đo file thật 05/08: 16/19 ca lặp có số tiền
        // GIỐNG HỆT nhau ở cả hai sheet — đó là danh sách mang sang tháng sau, cộng
        // vào là thổi khống doanh thu (73.752.000 trên file này). Chỉ 3 ca có số
        // tiền KHÁC nhau mới là đóng đợt 2 (vd 4.320.000 + 3.600.000 = đúng giá
        // niêm yết Sata3). Máy không tự quyết được ca nào là đợt 2 → nêu ra cho
        // người nhập chọn, kèm sẵn tổng để điền.
        mergedDuplicateRows++;
        existingChild.sources.push({ sheet: sheet.name, row: excelRow });
        const cu = existingChild.paidAmount;
        const moi = childData.paidAmount;
        if (cu !== null && moi !== null && cu !== moi) {
          const dsSheet = existingChild.sources.map((s) => s.sheet).join(" · ");
          existingChild.warnings.push(
            `${CROSS_SHEET_FEE_WARNING} (${dsSheet}): ${cu.toLocaleString("vi-VN")} và ${moi.toLocaleString("vi-VN")}` +
              ` — nếu là đóng 2 đợt thì tổng là ${(cu + moi).toLocaleString("vi-VN")}; sửa ô Học phí cho đúng`,
          );
        }
        for (const k of [
          "grade",
          "courseRaw",
          "tuitionRaw",
          "paymentStatus",
          "studentCodeOld",
          "invoiceRef",
          "bank",
          "invoiceIssued",
          "dateRegistered",
          "noteRaw",
          "centerCode",
        ] as const) {
          if (existingChild[k] === null && childData[k] !== null) {
            existingChild[k] = childData[k];
          }
        }
      }
    }
  }

  return {
    totalDataRows,
    skippedEmpty,
    validRows,
    mergedDuplicateRows,
    errors,
    parents: [...parents.values()],
  };
}

// ─── Fuzzy map Sales (tên ngắn "Liên"/"Nhật Hạ") → User ─────────────────────

export interface SalesUser {
  id: string;
  name: string | null;
  /** role chính + roles[] (union) — dùng tie-break khi tên ngắn khớp nhiều user. */
  roles: string[];
}

/** Role "bán hàng được" — tie-break khi tên ngắn mơ hồ (Sale thật có thể là CM). */
const SALES_CAPABLE_ROLES = new Set(["SALES_CSM", "CENTER_MANAGER"]);

/**
 * Khớp khi tên ngắn = ĐUÔI tên đầy đủ (bỏ dấu): "Liên" ↔ "Nguyễn Thị Liên",
 * "Nhật Hạ" ↔ "Trần Nhật Hạ". Nhận khi khớp DUY NHẤT 1 user; nếu mơ hồ thì
 * thu hẹp về user có role bán hàng (SALES_CSM/CENTER_MANAGER) — vẫn mơ hồ /
 * không khớp → null (giữ tên trong note theo phiếu).
 */
export function matchSalesUser(salesName: string, users: SalesUser[]): SalesUser | null {
  const target = normalizeVi(salesName);
  if (!target) return null;
  const targetWords = target.split(" ");
  const matches = users.filter((u) => {
    const words = normalizeVi(u.name ?? "").split(" ").filter(Boolean);
    if (words.length === 0) return false;
    if (words.join(" ") === target) return true;
    if (words.length < targetWords.length) return false;
    return words.slice(-targetWords.length).join(" ") === target;
  });
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    const salesOnly = matches.filter((u) => u.roles.some((r) => SALES_CAPABLE_ROLES.has(r)));
    if (salesOnly.length === 1) return salesOnly[0];
  }
  return null;
}

// ─── Course key map — khớp "Sata 4" (file) với "Sata4 — Bứt Phá Giới Hạn"/slug "sata4" (DB) ──

/** Key nén: bỏ dấu + bỏ mọi ký tự không phải chữ/số ("Sata 4" & "sata4" → "sata4"). */
export function compactKey(raw: unknown): string {
  return normalizeVi(raw).replace(/[^a-z0-9]/g, "");
}

/** Map tên/slug khoá (cả dạng chuẩn hoá lẫn dạng nén) → Course.id. */
/**
 * Tên hiển thị của phụ huynh khi file KHÔNG ghi tên (chủ dự án chốt 05/08/2026:
 * điền "Phụ huynh của <tên con>").
 *
 * Rất nhiều dòng thật chỉ có SĐT — để trống thì danh sách CRM hiện một loạt lead
 * không tên, Sale không biết gọi cho ai. Lấy tên con làm mốc nhận diện gia đình.
 * Nhiều con thì nêu đủ (2 em) hoặc rút gọn (≥3 em) cho khỏi dài.
 */
export function parentDisplayName(
  parentName: string | null | undefined,
  children: { fullName: string }[],
  phone: string,
): string {
  const given = (parentName ?? "").trim();
  if (given) return given;

  const names = children.map((c) => c.fullName.trim()).filter(Boolean);
  if (names.length === 0) return `Phụ huynh của ${phone}`; // không cả tên con → còn SĐT
  if (names.length === 1) return `Phụ huynh của ${names[0]}`;
  if (names.length === 2) return `Phụ huynh của ${names[0]} và ${names[1]}`;
  return `Phụ huynh của ${names[0]} và ${names.length - 1} em khác`;
}

/** Tiền tố của tên PH do hệ thống tự điền (cả dạng cũ trước 05/08). */
const PLACEHOLDER_NAME_PREFIXES = ["phu huynh cua ", "ph cua "];

/**
 * Tên PH này là do hệ thống tự điền hay do người ghi thật?
 * Dùng để quyết định có được ĐÈ khi file có tên thật hay không — tên thật thì
 * tuyệt đối giữ, tên tự điền thì nâng cấp.
 */
export function isPlaceholderParentName(name: string | null | undefined): boolean {
  const n = normalizeVi(name);
  return PLACEHOLDER_NAME_PREFIXES.some((p) => n.startsWith(p));
}

/** Đọc lại CCCD PH / Địa chỉ từ note lead do import ghi (cặp với buildLeadNote). */
export function contactFromLeadNote(note: string | null | undefined): {
  cccd: string | null;
  address: string | null;
} {
  const raw = String(note ?? "");
  const pick = (label: string): string | null => {
    // Các mảnh trong note nối bằng " · " nên cắt tới dấu đó hoặc hết dòng.
    const m = new RegExp(`${label}:\\s*([^·\\n]+)`).exec(raw);
    const v = m?.[1]?.trim();
    return v ? v : null;
  };
  return { cccd: pick("CCCD PH"), address: pick("Địa chỉ") };
}

/** Hồ sơ học viên đã tồn tại (chỉ các field import có thể bổ sung). */
export interface ExistingStudentLite {
  id: string;
  parentName: string | null;
  parentPhone: string | null;
  parentNationalId: string | null;
  address: string | null;
}

/** Thông tin phụ huynh lấy từ file import, đã chuẩn hoá. */
export interface ImportedContact {
  parentName: string | null;
  parentPhone: string | null;
  cccd: string | null;
  address: string | null;
}

/**
 * Đắp thông tin từ file import sang HỒ SƠ HỌC VIÊN đã tồn tại (chốt 05/08:
 * "nhập vào thì merge với toàn bộ thông tin của lead đó và học viên đó luôn").
 *
 * Trước đây thông tin chỉ dừng ở Lead; học viên đã chốt từ đợt trước không nhận
 * được gì khi import lại file có thêm CCCD/địa chỉ.
 *
 * Luật: CHỈ đắp chỗ đang trống — không ghi đè dữ liệu người đã nhập tay. Ngoại lệ
 * duy nhất là tên PH đang là tên hệ thống tự điền thì cho tên thật thay thế.
 * CCCD là PII: chỉ ghi khi actor có quyền (canWritePii), giống màn hồ sơ học viên.
 */
export function planStudentSync(
  s: ExistingStudentLite,
  info: ImportedContact,
  opts: { canWritePii: boolean },
): Partial<Pick<ExistingStudentLite, "parentName" | "parentPhone" | "parentNationalId" | "address">> {
  const set: ReturnType<typeof planStudentSync> = {};
  const name = info.parentName?.trim();
  if (name && (!s.parentName?.trim() || isPlaceholderParentName(s.parentName))) {
    set.parentName = name;
  }
  if (info.parentPhone?.trim() && !s.parentPhone?.trim()) set.parentPhone = info.parentPhone.trim();
  if (opts.canWritePii && info.cccd?.trim() && !s.parentNationalId?.trim()) {
    set.parentNationalId = info.cccd.trim();
  }
  if (info.address?.trim() && !s.address?.trim()) set.address = info.address.trim();
  return set;
}

export function buildCourseKeyMap(
  courses: { id: string; name: string; slug: string | null }[],
): Map<string, string> {
  const map = new Map<string, string>();
  const add = (key: string, id: string) => {
    if (key && !map.has(key)) map.set(key, id);
  };
  for (const c of courses) {
    add(normalizeVi(c.name), c.id);
    if (c.slug) add(normalizeVi(c.slug), c.id);
  }
  for (const c of courses) {
    add(compactKey(c.name), c.id);
    if (c.slug) add(compactKey(c.slug), c.id);
  }
  return map;
}

// ─── Plan (pure) — quyết định create/merge, KHÔNG đụng DB ───────────────────

export interface ExistingLeadChild {
  id: string;
  fullName: string;
  gradeLevel: string | null;
  ageYears: number | null;
  note: string | null;
  interestedCourseId: string | null;
  interestedCenterId: string | null;
}

export interface ExistingLead {
  id: string;
  parentName: string;
  phone: string;
  status: string;
  note: string | null;
  centerId: string | null;
  orgUnitId: string | null;
  courseId: string | null;
  assignedToId: string | null;
  children: ExistingLeadChild[];
}

export interface PlanContext {
  /** Center.code ("CS1") → Center.id */
  centerByCode: Map<string, string>;
  /** OrgUnit.code → OrgUnit.id (dual-write 2-phase như route import leads sự kiện) */
  orgUnitByCode: Map<string, string>;
  /** tên/slug khoá (normalizeVi) → Course.id */
  courseByKey: Map<string, string>;
  salesUsers: SalesUser[];
  /** SĐT chuẩn hoá → lead đang có trong CRM (deletedAt null) */
  existingByPhone: Map<string, ExistingLead>;
}

export interface ChildCreatePlan {
  fullName: string;
  gradeLevel: string | null;
  /** 04/08 — tuổi suy từ Lớp (lớp + 5) → LeadChild.ageYears. */
  ageYears: number | null;
  interestedCourseId: string | null;
  interestedCenterId: string | null;
  note: string;
}

export interface LeadCreatePlan {
  phone: string;
  parentName: string;
  centerId: string | null;
  orgUnitId: string | null;
  courseId: string | null;
  assignedToId: string | null;
  source: string;
  note: string;
  children: ChildCreatePlan[];
}

export interface LeadMergePlan {
  leadId: string;
  phone: string;
  parentName: string; // tên hiển thị (record cũ)
  /**
   * Field trống trên record cũ được đắp (câu 34 — không ghi đè giá trị cũ).
   * Ngoại lệ DUY NHẤT: `parentName` được đè khi tên cũ là tên hệ thống tự điền
   * ("Phụ huynh của …") và file có tên thật — xem isPlaceholderParentName.
   */
  set: Partial<{
    parentName: string;
    centerId: string;
    orgUnitId: string;
    courseId: string;
    assignedToId: string;
    status: "DA_DANG_KY";
  }>;
  noteAppend: string | null; // null nếu note import đã có sẵn (idempotent)
  newChildren: ChildCreatePlan[];
  childUpdates: {
    childId: string;
    set: Partial<{
      gradeLevel: string;
      ageYears: number;
      interestedCourseId: string;
      interestedCenterId: string;
    }>;
    noteAppend: string | null;
  }[];
  /** false = không có gì thay đổi (re-import cùng file) → bỏ qua, không ghi. */
  changed: boolean;
}

export interface RegisteredImportPlan {
  creates: LeadCreatePlan[];
  merges: LeadMergePlan[];
  unmatchedSales: string[]; // tên Sales không khớp User (giữ trong note)
  unmatchedCourses: string[]; // tên khoá không khớp Course (giữ trong note)
  unmatchedCenters: string[]; // mã CS không khớp Center
}

export const IMPORT_NOTE_MARKER = "[Import ĐK Excel]";

/**
 * Đầu câu cảnh báo "cùng học viên nhưng học phí khác nhau giữa các sheet".
 * Export để route nâng dòng đó thành BẮT BUỘC QUYẾT — đây là tiền, bỏ sót là ghi
 * nhận thiếu doanh thu (đo file thật 05/08: 7 dòng, lệch 30.736.000).
 */
export const CROSS_SHEET_FEE_WARNING = "Học phí KHÁC nhau giữa các sheet";

/**
 * 04/08 — nhãn số tiền ĐÃ ĐÓNG dạng máy đọc được trong note của con
 * (vd `ĐãĐóng=8640000`). Màn "Chốt hàng loạt" đọc nhãn này để ĐIỀN SẴN ô "Đã đóng",
 * thay vì người nhập gõ tay từng dòng. Đổi chuỗi này là gãy chỗ đọc — sửa cả hai.
 */
export const PAID_NOTE_TAG = "ĐãĐóng=";
/** 04/08 — quyết định nhập ở màn xem thử, đọc lại ở bước "Chốt hàng loạt". */
export const DISCOUNT_NOTE_TAG = "Giảm=";
export const DISCOUNT_REASON_TAG = "LýDoGiảm=";
export const PAY2_NOTE_TAG = "Trả2Đợt";
export const DUE2_NOTE_TAG = "HạnĐợt2=";

/** Đọc ngược khoản giảm từ note. null nếu note không ghi giảm giá. */
export function discountFromNote(
  note: string | null | undefined,
): { kind: DiscountKind; value: number } | null {
  const m = new RegExp(`${DISCOUNT_NOTE_TAG}(\\d+)(%|đ)`).exec(note ?? "");
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return { kind: m[2] === "%" ? "PERCENT" : "AMOUNT", value };
}

/** Hạn đóng đợt 2 ghi trong note (yyyy-mm-dd). null nếu chưa đặt. */
export function dueDate2FromNote(note: string | null | undefined): string | null {
  // ⚠️ Phải là `\\d`: trong template literal `\d` bị nuốt thành `d`, regex hoá thành
  // `d{4}-d{2}-d{2}` và KHÔNG BAO GIỜ khớp ngày (bug đã lọt 1 lượt, ESLint bắt được).
  const m = new RegExp(`${DUE2_NOTE_TAG}(\\d{4}-\\d{2}-\\d{2})`).exec(note ?? "");
  return m ? m[1] : null;
}

/** Note có đánh dấu trả 2 đợt không? */
export function payIn2FromNoteTag(note: string | null | undefined): boolean {
  return (note ?? "").includes(PAY2_NOTE_TAG);
}

/** Đọc ngược số tiền đã đóng từ note của LeadChild. null nếu note không có nhãn. */
export function paidAmountFromNote(note: string | null | undefined): number | null {
  const m = new RegExp(`${PAID_NOTE_TAG}(\\d+)`).exec(note ?? "");
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Note có cấu trúc cho Lead (PII PH cần cho xuất hoá đơn — CCCD PH, địa chỉ). */
function buildLeadNote(p: ParsedRegisteredParent): string {
  const parts: string[] = [];
  if (p.salesName) parts.push(`Sales: ${p.salesName}`);
  if (p.source) parts.push(`Nguồn: ${p.source}`);
  if (p.parentCccd) parts.push(`CCCD PH: ${p.parentCccd}`);
  if (p.address) parts.push(`Địa chỉ: ${p.address}`);
  for (const n of p.extraNotes) parts.push(n);
  return `${IMPORT_NOTE_MARKER} ${parts.join(" · ") || "Không có thông tin thêm"}`;
}

/** Note có cấu trúc cho LeadChild (mã HV cũ + học phí + tình trạng TT để đối chiếu khi convert). */
function buildChildNote(c: ParsedRegisteredChild): string {
  const parts: string[] = [];
  if (c.studentCodeOld) parts.push(`Mã HV cũ: ${c.studentCodeOld}`);
  if (c.dateRegistered) parts.push(`Ngày ĐK: ${c.dateRegistered}`);
  if (c.courseRaw) parts.push(`Khoá ĐK: ${c.courseRaw}`);
  if (c.tuitionRaw) parts.push(`Học phí: ${c.tuitionRaw}`);
  // 04/08 — số tiền dạng MÁY ĐỌC ĐƯỢC để màn "Chốt hàng loạt" điền sẵn ô "Đã đóng",
  // khỏi phải gõ tay 102 dòng. Chuỗi gốc vẫn giữ ở trên để đối chiếu.
  if (c.paidAmount !== null) parts.push(`${PAID_NOTE_TAG}${c.paidAmount}`);
  if (c.feeMode === "HALF") parts.push("Đóng 50% — CÒN NỢ");
  if (c.discountKind && c.discountValue !== null) {
    parts.push(
      `${DISCOUNT_NOTE_TAG}${c.discountValue}${c.discountKind === "PERCENT" ? "%" : "đ"}`,
    );
  }
  if (c.discountReason) parts.push(`${DISCOUNT_REASON_TAG}${c.discountReason}`);
  if (c.payIn2) parts.push(PAY2_NOTE_TAG);
  if (c.dueDate2) parts.push(`${DUE2_NOTE_TAG}${c.dueDate2}`);
  if (c.paymentStatus) parts.push(`Tình trạng TT: ${c.paymentStatus}`);
  if (c.invoiceRef) parts.push(`Hoá đơn: ${c.invoiceRef}`);
  if (c.bank) parts.push(`Ngân hàng: ${c.bank}`);
  if (c.invoiceIssued) parts.push(`Đã xuất HĐ: ${c.invoiceIssued}`);
  if (c.noteRaw) parts.push(`Ghi chú: ${c.noteRaw}`);
  return `${IMPORT_NOTE_MARKER} ${parts.join(" · ") || "Không có thông tin thêm"}`;
}

/**
 * Trạng thái KHÔNG nâng lên "Đã đăng ký" khi gộp (đã ngang/hơn, hoặc lead đã mất).
 *
 * GĐ5 — trước đây là ba giá trị REGISTERED/ENROLLED/DUPLICATE. Sau khi gộp enum thì
 * hai cái đầu cùng thành DA_DANG_KY và DUPLICATE thành DA_MAT, nên còn đúng hai.
 */
const NO_UPGRADE_STATUSES = new Set(["DA_DANG_KY", "DA_MAT"]);

export function planRegisteredImport(
  parsed: ParsedRegistered,
  ctx: PlanContext,
): RegisteredImportPlan {
  const creates: LeadCreatePlan[] = [];
  const merges: LeadMergePlan[] = [];
  const unmatchedSales = new Set<string>();
  const unmatchedCourses = new Set<string>();
  const unmatchedCenters = new Set<string>();

  const resolveCourse = (raw: string | null): string | null => {
    if (!raw) return null;
    // Thử dạng chuẩn hoá trước, rồi dạng nén ("Sata 4" ↔ slug "sata4").
    const id = ctx.courseByKey.get(normalizeVi(raw)) ?? ctx.courseByKey.get(compactKey(raw)) ?? null;
    if (!id) unmatchedCourses.add(raw);
    return id;
  };
  const resolveCenter = (code: string | null): { centerId: string | null; orgUnitId: string | null } => {
    if (!code) return { centerId: null, orgUnitId: null };
    const centerId = ctx.centerByCode.get(code) ?? null;
    const orgUnitId = ctx.orgUnitByCode.get(code) ?? null;
    if (!centerId && !orgUnitId) unmatchedCenters.add(code);
    return { centerId, orgUnitId };
  };

  for (const p of parsed.parents) {
    const { centerId, orgUnitId } = resolveCenter(p.centerCode);
    const salesUser = p.salesName ? matchSalesUser(p.salesName, ctx.salesUsers) : null;
    if (p.salesName && !salesUser) unmatchedSales.add(p.salesName);

    const childPlans: ChildCreatePlan[] = p.children.map((c) => {
      const courseId = resolveCourse(c.courseRaw);
      const childCenter = resolveCenter(c.centerCode);
      return {
        fullName: c.fullName,
        gradeLevel: c.grade,
        ageYears: c.ageYears,
        interestedCourseId: courseId,
        interestedCenterId: childCenter.centerId,
        note: buildChildNote(c),
      };
    });
    // Lead.courseId chỉ set khi TẤT CẢ con cùng 1 khoá match được (tránh gán sai).
    const distinctCourseIds = new Set(
      childPlans.map((c) => c.interestedCourseId).filter((x): x is string => x !== null),
    );
    const leadCourseId = distinctCourseIds.size === 1 ? [...distinctCourseIds][0] : null;
    const leadNote = buildLeadNote(p);

    const existing = ctx.existingByPhone.get(p.phone);
    if (!existing) {
      creates.push({
        phone: p.phone,
        parentName: parentDisplayName(p.parentName, p.children, p.phone),
        centerId,
        orgUnitId,
        courseId: leadCourseId,
        assignedToId: salesUser?.id ?? null,
        source: p.source ?? "Import Excel ĐK",
        note: leadNote,
        children: childPlans,
      });
      continue;
    }

    // ── GỘP với lead đã có (câu 34): giữ record cũ, đắp field trống, append note.
    const set: LeadMergePlan["set"] = {};
    // Tên PH: record cũ đang mang tên hệ thống tự điền → thay bằng tên THẬT nếu file
    // có, không thì ít nhất chuẩn hoá về định dạng hiện hành. Nếu không chuẩn hoá,
    // danh sách CRM lẫn lộn "PH của X (chưa rõ tên)" (dạng trước 05/08) với
    // "Phụ huynh của X". Tên người thật thì tuyệt đối không đè.
    if (isPlaceholderParentName(existing.parentName)) {
      const moi = parentDisplayName(p.parentName, p.children, p.phone);
      if (moi !== existing.parentName) set.parentName = moi;
    }
    if (!existing.centerId && centerId) set.centerId = centerId;
    if (!existing.orgUnitId && orgUnitId) set.orgUnitId = orgUnitId;
    if (!existing.courseId && leadCourseId) set.courseId = leadCourseId;
    if (!existing.assignedToId && salesUser) set.assignedToId = salesUser.id;
    if (!NO_UPGRADE_STATUSES.has(existing.status)) set.status = "DA_DANG_KY";

    const noteAppend = existing.note?.includes(leadNote) ? null : leadNote;

    const existingChildByName = new Map(
      existing.children.map((c) => [normalizeVi(c.fullName), c]),
    );
    const newChildren: ChildCreatePlan[] = [];
    const childUpdates: LeadMergePlan["childUpdates"] = [];
    for (let i = 0; i < p.children.length; i++) {
      const plan = childPlans[i];
      const match = existingChildByName.get(normalizeVi(plan.fullName));
      if (!match) {
        newChildren.push(plan);
        continue;
      }
      const cset: (typeof childUpdates)[number]["set"] = {};
      if (!match.gradeLevel && plan.gradeLevel) cset.gradeLevel = plan.gradeLevel;
      // Tuổi suy từ cột Lớp — trước đây tính ra rồi BỎ khi gộp, nên lead cũ mãi
      // không có tuổi dù file mới đã có.
      if (!match.ageYears && plan.ageYears) cset.ageYears = plan.ageYears;
      if (!match.interestedCourseId && plan.interestedCourseId)
        cset.interestedCourseId = plan.interestedCourseId;
      if (!match.interestedCenterId && plan.interestedCenterId)
        cset.interestedCenterId = plan.interestedCenterId;
      const cNoteAppend = match.note?.includes(plan.note) ? null : plan.note;
      if (Object.keys(cset).length > 0 || cNoteAppend) {
        childUpdates.push({ childId: match.id, set: cset, noteAppend: cNoteAppend });
      }
    }

    const changed =
      Object.keys(set).length > 0 ||
      noteAppend !== null ||
      newChildren.length > 0 ||
      childUpdates.length > 0;

    merges.push({
      leadId: existing.id,
      phone: p.phone,
      parentName: existing.parentName,
      set,
      noteAppend,
      newChildren,
      childUpdates,
      changed,
    });
  }

  return {
    creates,
    merges,
    unmatchedSales: [...unmatchedSales],
    unmatchedCourses: [...unmatchedCourses],
    unmatchedCenters: [...unmatchedCenters],
  };
}

// ─── Câu 34 (user chốt 09/07/2026) — CHẶN gộp cross-center ────────────────────
// Đường GỘP trước đây dedupe SĐT toàn hệ thống: Sale CS1 import SĐT đang thuộc lead CS2
// thì ghi thẳng vào lead CS2. `scopedDb` chỉ scope READ nên không chặn được đường ghi này.
// Nay: lead cũ thuộc cơ sở ngoài phạm vi actor → KHÔNG gộp, KHÔNG tạo, chỉ báo SĐT
// (không trả tên PH / trạng thái / người phụ trách — không lộ dữ liệu cơ sở khác).
// Lead untagged (centerId = null) vẫn gộp: nó chưa thuộc cơ sở nào.
//
// Tách THUẦN khỏi route để test được không cần request/DB.
export function splitMergesByScope(
  merges: LeadMergePlan[],
  centerIdByPhone: Map<string, string | null>,
  isInScope: (centerId: string) => boolean,
): { allowed: LeadMergePlan[]; rejectedPhones: string[] } {
  const allowed: LeadMergePlan[] = [];
  const rejectedPhones: string[] = [];
  for (const m of merges) {
    const centerId = centerIdByPhone.get(m.phone);
    if (centerId == null || isInScope(centerId)) allowed.push(m);
    else rejectedPhones.push(m.phone);
  }
  return { allowed, rejectedPhones };
}
