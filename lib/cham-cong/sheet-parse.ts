// lib/cham-cong/sheet-parse.ts — Đọc file Excel LỊCH PHÂN CA (bản Google Sheet 29/08/2026 tải
// về .xlsx) thành cấu trúc thuần: khung ca tuần, lưới tháng, danh mục ca, việc cố định, ghi đè.
// THUẦN (không DB, không "use server") — màn import gọi rồi tự đối chiếu với DB để ra diff.
//
// Bố cục tab (đo trên file thật, tests/fixtures/cham-cong/lich-phan-ca-2026-08-29.xlsx):
//   KHUNG CA CỐ ĐỊNH : hàng 3 = tiêu đề [STT|Tên hiển thị|Họ và tên đầy đủ|Đơn vị|Vai trò|SĐT|T2..CN]
//   LỊCH Tmm-yyyy     : hàng 2 = "Tháng:|m|Năm:|y"; hàng 3 = [STT|Họ và tên|Đơn vị|Vai trò|1..31|Tổng công|Nghỉ/Phép];
//                       hàng khối "CƠ SỞ 1 · …" / "CƠ SỞ 2 · …" / "HO …"; cuối tab là chú giải mã ca (bỏ).
//   DANH MỤC CA      : [Mã ca|Tên ca|Giờ sáng|Nơi sáng|Giờ chiều|Nơi chiều|Ghi chú]
//   VIỆC CỐ ĐỊNH     : [Đơn vị|Thứ|Nội dung]
//   GHI CHÚ & GHI ĐÈ : hàng 2 tiêu đề [Ngày|Đơn vị|Họ và tên|Ghi chú|Không gửi tin|Tin thay thế]
import * as XLSX from "xlsx";

export type SheetUnit = "CS1" | "CS2" | "HO";

export type KhungCaRow = {
  stt: number;
  displayName: string;
  fullName: string;
  unit: SheetUnit;
  unitRaw: string;
  role: string;
  phone: string | null;
  /** 0=CN … 6=T7 → mã ca (null = ô trống / "—"). */
  byWeekday: Record<number, string | null>;
};

export type MonthGridRow = {
  stt: number;
  name: string;
  unit: SheetUnit;
  unitRaw: string;
  role: string;
  /** ngày trong tháng → mã ca (null = ô trống). */
  cells: Record<number, string | null>;
  totalOnSheet: number | null;
  offOnSheet: number | null;
};

export type MonthGrid = {
  sheetName: string;
  periodKey: string; // "YYYY-MM"
  year: number;
  month: number; // 1..12
  daysInMonth: number;
  rows: MonthGridRow[];
  /** Dòng có đơn vị không nhận ra — báo cho người import, không im lặng bỏ. */
  unknownUnitRows: { stt: number; name: string; unitRaw: string }[];
};

export type DanhMucCaRow = {
  code: string;
  name: string;
  amRange: string | null;
  amPlace: string | null;
  pmRange: string | null;
  pmPlace: string | null;
  note: string | null;
};

export type ViecCoDinhRow = { unit: SheetUnit; weekday: number; text: string };
export type GhiChuRow = {
  date: string; // YYYY-MM-DD
  unit: SheetUnit;
  personName: string | null;
  text: string;
  suppress: boolean;
  replaceAll: boolean;
};

export type ParsedWorkbook = {
  khungCa: KhungCaRow[];
  months: MonthGrid[];
  danhMucCa: DanhMucCaRow[];
  viecCoDinh: ViecCoDinhRow[];
  ghiChu: GhiChuRow[];
  warnings: string[];
};

const WEEKDAY_BY_LABEL: Record<string, number> = { T2: 1, T3: 2, T4: 3, T5: 4, T6: 5, T7: 6, CN: 0 };
const WEEKDAY_BY_WORD: Record<string, number> = {
  "thứ hai": 1,
  "thứ ba": 2,
  "thứ tư": 3,
  "thứ năm": 4,
  "thứ sáu": 5,
  "thứ bảy": 6,
  "chủ nhật": 0,
};

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

/** "Cơ sở 1" → CS1 · "Cơ sở 2" → CS2 · "HO"/"Hội sở"/"HỘI SỞ" → HO · khác → null. */
export function parseUnit(raw: unknown): SheetUnit | null {
  const s = str(raw).toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  if (s === "ho" || s.startsWith("hội sở") || s.startsWith("hoi so")) return "HO";
  const m = /(?:cơ sở|co so|cs)\s*(\d)/.exec(s);
  if (m) {
    if (m[1] === "1") return "CS1";
    if (m[1] === "2") return "CS2";
  }
  return null;
}

/** Ô mã ca: trim + hoa; "" / "—" / "-" → null. Không kiểm tra thuộc danh mục — việc của diff. */
export function normalizeCode(raw: unknown): string | null {
  const s = str(raw).toUpperCase();
  if (!s || s === "—" || s === "-" || s === "–") return null;
  return s;
}

function sheetRows(wb: XLSX.WorkBook, name: string): unknown[][] {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
}

function findSheet(wb: XLSX.WorkBook, pattern: RegExp): string | undefined {
  return wb.SheetNames.find((n) => pattern.test(n.normalize("NFC")));
}

export function parseKhungCa(rows: unknown[][], warnings: string[]): KhungCaRow[] {
  const headerIdx = rows.findIndex((r) => str(r[0]).toUpperCase() === "STT");
  if (headerIdx < 0) {
    warnings.push("KHUNG CA CỐ ĐỊNH: không thấy hàng tiêu đề STT");
    return [];
  }
  const header = rows[headerIdx].map((c) => str(c).toUpperCase());
  const colOf = (label: string) => header.indexOf(label);
  const weekdayCols: [number, number][] = Object.entries(WEEKDAY_BY_LABEL)
    .map(([label, wd]) => [colOf(label), wd] as [number, number])
    .filter(([c]) => c >= 0);
  const out: KhungCaRow[] = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const stt = Number(r[0]);
    if (!Number.isFinite(stt) || stt <= 0 || !str(r[1])) continue;
    const unit = parseUnit(r[3]);
    if (!unit) {
      warnings.push(`KHUNG CA: dòng ${stt} "${str(r[1])}" có đơn vị lạ "${str(r[3])}" — bỏ qua`);
      continue;
    }
    const byWeekday: Record<number, string | null> = {};
    for (const [c, wd] of weekdayCols) byWeekday[wd] = normalizeCode(r[c]);
    out.push({
      stt,
      displayName: str(r[1]),
      fullName: str(r[2]) || str(r[1]),
      unit,
      unitRaw: str(r[3]),
      role: str(r[4]),
      phone: str(r[5]) || null,
      byWeekday,
    });
  }
  return out;
}

export function parseMonthGrid(sheetName: string, rows: unknown[][], warnings: string[]): MonthGrid | null {
  // Hàng "Tháng: | m | Năm: | y"
  let month = 0;
  let year = 0;
  for (const r of rows.slice(0, 4)) {
    const cells = r.map(str);
    const iM = cells.findIndex((c) => /^tháng/i.test(c));
    const iY = cells.findIndex((c) => /^năm/i.test(c));
    if (iM >= 0 && iY >= 0) {
      month = Number(cells[iM + 1]);
      year = Number(cells[iY + 1]);
    }
  }
  if (!month || !year) {
    const m = /T(\d{2})-(\d{4})/.exec(sheetName);
    if (m) {
      month = Number(m[1]);
      year = Number(m[2]);
    }
  }
  if (!month || !year) {
    warnings.push(`${sheetName}: không đọc được tháng/năm`);
    return null;
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const headerIdx = rows.findIndex((r) => str(r[0]).toUpperCase() === "STT");
  if (headerIdx < 0) {
    warnings.push(`${sheetName}: không thấy hàng tiêu đề STT`);
    return null;
  }
  const header = rows[headerIdx];
  const dayCols: [number, number][] = [];
  header.forEach((c, i) => {
    const n = Number(c);
    if (i >= 4 && Number.isInteger(n) && n >= 1 && n <= 31) dayCols.push([i, n]);
  });
  const totalCol = header.findIndex((c) => /tổng công/i.test(str(c)));
  const offCol = header.findIndex((c) => /nghỉ/i.test(str(c)));

  const out: MonthGridRow[] = [];
  const unknownUnitRows: MonthGrid["unknownUnitRows"] = [];
  let seenEmployee = false;
  for (const r of rows.slice(headerIdx + 1)) {
    const stt = Number(r[0]);
    const name = str(r[1]);
    if (!Number.isFinite(stt) || stt <= 0 || !name) {
      // Hàng khối ("CƠ SỞ 1 · …") hoặc chú giải cuối tab — sau khi đã gặp nhân sự, gặp hàng
      // không STT mà có giờ ở cột 3 (vd "09:00–11:30 & 14:00–17:45") là chú giải ⇒ dừng.
      if (seenEmployee && name && /\d{1,2}:\d{2}/.test(str(r[3]))) break;
      continue;
    }
    seenEmployee = true;
    const unit = parseUnit(r[2]);
    if (!unit) {
      unknownUnitRows.push({ stt, name, unitRaw: str(r[2]) });
      continue;
    }
    const cells: Record<number, string | null> = {};
    for (const [c, day] of dayCols) {
      if (day <= daysInMonth) cells[day] = normalizeCode(r[c]);
    }
    const num = (i: number) => (i >= 0 && r[i] != null && r[i] !== "" ? Number(r[i]) : null);
    out.push({ stt, name, unit, unitRaw: str(r[2]), role: str(r[3]), cells, totalOnSheet: num(totalCol), offOnSheet: num(offCol) });
  }
  return {
    sheetName,
    periodKey: `${year}-${String(month).padStart(2, "0")}`,
    year,
    month,
    daysInMonth,
    rows: out,
    unknownUnitRows,
  };
}

export function parseDanhMucCa(rows: unknown[][]): DanhMucCaRow[] {
  const out: DanhMucCaRow[] = [];
  for (const r of rows.slice(1)) {
    const code = normalizeCode(r[0]);
    if (!code || !str(r[1])) continue;
    out.push({
      code,
      name: str(r[1]),
      amRange: str(r[2]) || null,
      amPlace: str(r[3]) || null,
      pmRange: str(r[4]) || null,
      pmPlace: str(r[5]) || null,
      note: str(r[6]) || null,
    });
  }
  return out;
}

export function parseViecCoDinh(rows: unknown[][]): ViecCoDinhRow[] {
  const out: ViecCoDinhRow[] = [];
  for (const r of rows.slice(1)) {
    const unit = parseUnit(r[0]);
    const wd = WEEKDAY_BY_WORD[str(r[1]).toLowerCase()];
    if (!unit || wd === undefined || !str(r[2])) continue;
    out.push({ unit, weekday: wd, text: str(r[2]) });
  }
  return out;
}

function toYmd(v: unknown): string | null {
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof v === "number") {
    // Excel serial (raw:true) → ngày UTC
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = str(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const m2 = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m2) return `${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
  return null;
}

export function parseGhiChu(rows: unknown[][]): GhiChuRow[] {
  const headerIdx = rows.findIndex((r) => /^ngày/i.test(str(r[0])));
  if (headerIdx < 0) return [];
  const out: GhiChuRow[] = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const date = toYmd(r[0]);
    const unit = parseUnit(r[1]);
    if (!date || !unit || !str(r[3])) continue;
    const yes = (v: unknown) => /^(có|co|x|yes|true|1)$/i.test(str(v));
    out.push({ date, unit, personName: str(r[2]) || null, text: str(r[3]), suppress: yes(r[4]), replaceAll: yes(r[5]) });
  }
  return out;
}

/** Đọc toàn bộ workbook (Buffer/ArrayBuffer/Uint8Array). Không ném lỗi vì thiếu tab — báo qua `warnings`. */
export function parseWorkbook(data: ArrayBuffer | Uint8Array | Buffer): ParsedWorkbook {
  // cellDates: false CÓ CHỦ ĐÍCH — bật lên thì xlsx dựng Date theo múi giờ MÁY (dev +07, Vercel
  // UTC) và ngày 01/09 đọc ra thành 31/08 tuỳ máy (đúng bẫy lib/time/vn.ts). Serial Excel
  // đi qua SSF.parse_date_code là số thuần, không dính múi giờ.
  const wb = XLSX.read(data, { type: data instanceof ArrayBuffer ? "array" : "buffer", cellDates: false });
  const warnings: string[] = [];
  const khungName = findSheet(wb, /^KHUNG CA/i);
  const khungCa = khungName ? parseKhungCa(sheetRows(wb, khungName), warnings) : [];
  if (!khungName) warnings.push("Không có tab KHUNG CA CỐ ĐỊNH");
  const months: MonthGrid[] = [];
  for (const n of wb.SheetNames) {
    if (!/^LỊCH\s+T\d{2}-\d{4}/i.test(n.normalize("NFC"))) continue;
    const g = parseMonthGrid(n, sheetRows(wb, n), warnings);
    if (g) months.push(g);
  }
  const dmName = findSheet(wb, /^DANH MỤC CA/i);
  const vcdName = findSheet(wb, /^VIỆC CỐ ĐỊNH/i);
  const gcName = findSheet(wb, /^GHI CHÚ/i);
  return {
    khungCa,
    months,
    danhMucCa: dmName ? parseDanhMucCa(sheetRows(wb, dmName)) : [],
    viecCoDinh: vcdName ? parseViecCoDinh(sheetRows(wb, vcdName)) : [],
    ghiChu: gcName ? parseGhiChu(sheetRows(wb, gcName)) : [],
    warnings,
  };
}

/** Đếm số ô theo mã trong một lưới tháng — "15 con số" đối chiếu sau import. */
export function countCodes(grid: Pick<MonthGrid, "rows">): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of grid.rows) {
    for (const code of Object.values(r.cells)) {
      if (!code) continue;
      out[code] = (out[code] ?? 0) + 1;
    }
  }
  return out;
}

/** Tổng công theo luật Sheet: số ô có mã trừ X và P. */
export function sheetTotalOf(row: Pick<MonthGridRow, "cells">): { total: number; off: number } {
  let total = 0;
  let off = 0;
  for (const code of Object.values(row.cells)) {
    if (!code) continue;
    if (code === "X" || code === "P") off += 1;
    else total += 1;
  }
  return { total, off };
}
