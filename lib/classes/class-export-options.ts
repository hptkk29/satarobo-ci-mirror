// TUỲ CHỌN xuất danh sách lớp — THUẦN, không kéo `xlsx`: hộp thoại client import file
// này, còn bộ dựng workbook (`class-export.ts`, có `xlsx`) chỉ chạy ở server.

import { z } from "zod";

export const CLASS_EXPORT_COLUMNS = [
  { key: "classCode", label: "Mã lớp" },
  { key: "name", label: "Tên lớp" },
  { key: "course", label: "Khoá học" },
  { key: "center", label: "Cơ sở" },
  { key: "room", label: "Phòng" },
  { key: "schedule", label: "Lịch học" },
  { key: "teacher", label: "GV chính" },
  { key: "assistant", label: "Trợ giảng" },
  { key: "enrolled", label: "Sĩ số" },
  { key: "capacity", label: "Sức chứa" },
  { key: "startDate", label: "Khai giảng" },
  { key: "endDate", label: "Kết thúc" },
  { key: "status", label: "Trạng thái" },
  { key: "sessionsDone", label: "Buổi đã dạy" },
  { key: "sessionsTotal", label: "Tổng buổi" },
  { key: "notes", label: "Ghi chú" },
] as const;
export type ClassExportColumn = (typeof CLASS_EXPORT_COLUMNS)[number]["key"];
const COLUMN_KEYS = CLASS_EXPORT_COLUMNS.map((c) => c.key) as [
  ClassExportColumn,
  ...ClassExportColumn[],
];

export const DEFAULT_CLASS_COLUMNS: ClassExportColumn[] = [
  "classCode",
  "name",
  "course",
  "center",
  "schedule",
  "teacher",
  "enrolled",
  "capacity",
  "startDate",
  "status",
];

export const SHEET_VALUES = ["lop", "hocvien", "buoi"] as const;
export type ExportSheet = (typeof SHEET_VALUES)[number];

export const ROSTER_SCOPE_VALUES = ["dang-hoc", "tat-ca"] as const;
export const SESSION_SCOPE_VALUES = ["tat-ca", "da-day", "sap-toi"] as const;

export const classExportOptionsSchema = z.object({
  sheets: z.array(z.enum(SHEET_VALUES)).min(1, "Chọn ít nhất một sheet"),
  columns: z.array(z.enum(COLUMN_KEYS)).min(1, "Chọn ít nhất một cột"),
  /** Học viên: chỉ ghi danh đang thuộc lớp, hay cả đã rời/hoàn thành/chuyển. */
  rosterScope: z.enum(ROSTER_SCOPE_VALUES),
  /** Kèm tên + SĐT phụ huynh — route còn gác thêm theo quyền. */
  parentContact: z.boolean(),
  sessionScope: z.enum(SESSION_SCOPE_VALUES),
});
export type ClassExportOptions = z.infer<typeof classExportOptionsSchema>;

/** Đọc tuỳ chọn từ searchParams của route (`sheets=lop,buoi&cols=...`). */
export function parseClassExportOptions(sp: URLSearchParams) {
  const list = (k: string) =>
    (sp.get(k) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return classExportOptionsSchema.safeParse({
    sheets: [...new Set(list("sheets"))],
    columns: [...new Set(list("cols"))],
    rosterScope: sp.get("hv") ?? "dang-hoc",
    parentContact: sp.get("ph") === "1",
    sessionScope: sp.get("buoi") ?? "tat-ca",
  });
}

export function toClassExportQuery(o: ClassExportOptions): string {
  const p = new URLSearchParams();
  p.set("sheets", o.sheets.join(","));
  p.set("cols", o.columns.join(","));
  p.set("hv", o.rosterScope);
  if (o.parentContact) p.set("ph", "1");
  p.set("buoi", o.sessionScope);
  return p.toString();
}

