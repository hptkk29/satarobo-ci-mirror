// XUẤT DANH SÁCH LỚP ra Excel — tuỳ chọn sheet + cột.
//
// Tách khỏi route để test được (route cần session nên Vitest không gọi thẳng) — cùng
// lý do với `lib/export/leads-xlsx.ts`. Phần dễ sai nằm ở đây: định kiểu ô (SĐT phải là
// CHUỖI kẻo Excel nuốt số 0 đầu) và việc chọn cột theo tuỳ chọn.

import * as XLSX from "xlsx";
import {
  CLASS_EXPORT_COLUMNS,
  type ClassExportColumn,
  type ClassExportOptions,
} from "@/lib/classes/class-export-options";
import { resolveClassSlots } from "@/lib/classes/slots";
import { vnParts, vnYmd } from "@/lib/time/vn";

// ── Dữ liệu vào ─────────────────────────────────────────────────────────────

export interface ExportClassRow {
  id: string;
  classCode: string | null;
  name: string;
  course: string | null;
  center: string | null;
  room: string | null;
  scheduleDays: number[];
  startTime: string | null;
  endTime: string | null;
  slots: { weekday: number; startTime: string; endTime: string | null }[];
  teacher: string | null;
  assistant: string | null;
  enrolled: number;
  maxStudents: number;
  startDate: Date | null;
  endDate: Date | null;
  statusLabel: string;
  sessionsDone: number;
  sessionsTotal: number;
  notes: string | null;
}

export interface ExportRosterRow {
  classId: string;
  studentCode: string | null;
  studentName: string;
  dateOfBirth: Date | null;
  statusLabel: string;
  enrolledAt: Date;
  sale: string | null;
  /** Đã che/bỏ ở route theo quyền — ở đây chỉ in. */
  parentName: string | null;
  parentPhone: string | null;
}

export interface ExportSessionRow {
  classId: string;
  index: number;
  date: Date;
  statusLabel: string;
  topic: string | null;
  room: string | null;
  rosterSize: number | null;
}

// ── Định dạng ───────────────────────────────────────────────────────────────

const DAY = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

export function fmtVnDate(d: Date | null): string {
  if (!d) return "";
  const [y, m, dd] = vnYmd(d).split("-");
  return `${dd}/${m}/${y}`;
}

function fmtVnTime(d: Date): string {
  const p = vnParts(d);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export function scheduleText(c: Pick<ExportClassRow, "scheduleDays" | "startTime" | "endTime" | "slots">): string {
  return resolveClassSlots({
    scheduleDays: c.scheduleDays,
    startTime: c.startTime,
    endTime: c.endTime,
    slots: c.slots,
  })
    .map((s) => {
      const t = s.startTime ? ` ${s.startTime}${s.endTime ? `–${s.endTime}` : ""}` : "";
      return `${DAY[s.weekday] ?? ""}${t}`;
    })
    .join(" · ");
}

function classCell(c: ExportClassRow, key: ClassExportColumn): string | number {
  switch (key) {
    case "classCode": return c.classCode ?? "";
    case "name": return c.name;
    case "course": return c.course ?? "";
    case "center": return c.center ?? "";
    case "room": return c.room ?? "";
    case "schedule": return scheduleText(c);
    case "teacher": return c.teacher ?? "";
    case "assistant": return c.assistant ?? "";
    case "enrolled": return c.enrolled;
    case "capacity": return c.maxStudents;
    case "startDate": return fmtVnDate(c.startDate);
    case "endDate": return fmtVnDate(c.endDate);
    case "status": return c.statusLabel;
    case "sessionsDone": return c.sessionsDone;
    case "sessionsTotal": return c.sessionsTotal;
    case "notes": return c.notes ?? "";
  }
}

function asTextColumn(ws: XLSX.WorkSheet, col: number, rowCount: number) {
  for (let r = 1; r <= rowCount; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: col })];
    if (cell) {
      cell.t = "s";
      cell.z = "@";
    }
  }
}

function sheetFrom(headers: string[], rows: (string | number)[][], watermark: string) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows, [], [watermark]]);
  ws["!cols"] = headers.map((h, i) => ({
    wch: Math.min(
      45,
      Math.max(h.length, ...rows.slice(0, 200).map((r) => String(r[i] ?? "").length)) + 2,
    ),
  }));
  return ws;
}

export function buildClassExportWorkbook(input: {
  options: ClassExportOptions;
  classes: ExportClassRow[];
  roster: ExportRosterRow[];
  sessions: ExportSessionRow[];
  /** Đã quyết ở route: người xuất có được kèm liên hệ phụ huynh không. */
  includeParentContact: boolean;
  watermark: string;
}): XLSX.WorkBook {
  const { options, classes, roster, sessions, includeParentContact, watermark } = input;
  const wb = XLSX.utils.book_new();
  const byId = new Map(classes.map((c) => [c.id, c]));
  const classLabel = (id: string) => {
    const c = byId.get(id);
    return c ? (c.classCode ? `${c.classCode} — ${c.name}` : c.name) : "";
  };

  if (options.sheets.includes("lop")) {
    // Giữ thứ tự cột theo danh mục, không theo thứ tự người dùng bấm.
    const cols = CLASS_EXPORT_COLUMNS.filter((c) => options.columns.includes(c.key));
    const ws = sheetFrom(
      cols.map((c) => c.label),
      classes.map((c) => cols.map((col) => classCell(c, col.key))),
      watermark,
    );
    XLSX.utils.book_append_sheet(wb, ws, "Danh sách lớp");
  }

  if (options.sheets.includes("hocvien")) {
    const headers = [
      "Lớp",
      "Mã HV",
      "Học viên",
      "Ngày sinh",
      "Trạng thái ghi danh",
      "Ngày ghi danh",
      "Sale phụ trách",
      ...(includeParentContact ? ["Phụ huynh", "SĐT phụ huynh"] : []),
    ];
    const rows = roster.map((r) => [
      classLabel(r.classId),
      r.studentCode ?? "",
      r.studentName,
      fmtVnDate(r.dateOfBirth),
      r.statusLabel,
      fmtVnDate(r.enrolledAt),
      r.sale ?? "",
      ...(includeParentContact ? [r.parentName ?? "", r.parentPhone ?? ""] : []),
    ]);
    const ws = sheetFrom(headers, rows, watermark);
    if (includeParentContact) asTextColumn(ws, headers.indexOf("SĐT phụ huynh"), rows.length);
    asTextColumn(ws, headers.indexOf("Mã HV"), rows.length);
    XLSX.utils.book_append_sheet(wb, ws, "Học viên theo lớp");
  }

  if (options.sheets.includes("buoi")) {
    const headers = ["Lớp", "Buổi", "Ngày", "Thứ", "Giờ", "Trạng thái", "Nội dung", "Phòng", "Sĩ số chốt"];
    const rows = sessions.map((s) => [
      classLabel(s.classId),
      s.index,
      fmtVnDate(s.date),
      DAY[vnParts(s.date).weekday] ?? "",
      fmtVnTime(s.date),
      s.statusLabel,
      s.topic ?? "",
      s.room ?? "",
      s.rosterSize ?? "",
    ]);
    XLSX.utils.book_append_sheet(wb, sheetFrom(headers, rows, watermark), "Lịch buổi học");
  }

  return wb;
}
