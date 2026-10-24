import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildClassExportWorkbook, scheduleText, type ExportClassRow } from "./class-export";
import {
  classExportOptionsSchema,
  parseClassExportOptions,
  toClassExportQuery,
  type ClassExportOptions,
} from "./class-export-options";

const LOP: ExportClassRow = {
  id: "c1",
  classCode: "S3-01",
  name: "Sata 3 tối T2",
  course: "Sata 3",
  center: "CS1",
  room: "P1",
  scheduleDays: [1, 5],
  startTime: "17:30",
  endTime: "19:00",
  slots: [{ weekday: 5, startTime: "08:00", endTime: "09:30" }],
  teacher: "GV A",
  assistant: null,
  enrolled: 8,
  maxStudents: 12,
  startDate: new Date("2026-09-01T00:00:00Z"),
  endDate: null,
  statusLabel: "Đang dạy",
  sessionsDone: 3,
  sessionsTotal: 24,
  notes: null,
};

const OPTS: ClassExportOptions = {
  sheets: ["lop", "hocvien"],
  columns: ["name", "classCode", "enrolled"],
  rosterScope: "dang-hoc",
  parentContact: true,
  sessionScope: "tat-ca",
};

const ROSTER = [
  {
    classId: "c1",
    studentCode: "0012",
    studentName: "Bé Na",
    dateOfBirth: null,
    statusLabel: "Đang học",
    enrolledAt: new Date("2026-08-20T03:00:00Z"),
    sale: null,
    parentName: "Chị Lan",
    parentPhone: "0905123456",
  },
];

function rows(wb: XLSX.WorkBook, sheet: string) {
  return XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets[sheet], { header: 1 });
}

describe("buildClassExportWorkbook", () => {
  it("[CEX-01] chỉ đúng các cột đã chọn, theo thứ tự DANH MỤC (không theo thứ tự bấm)", () => {
    const wb = buildClassExportWorkbook({
      options: OPTS,
      classes: [LOP],
      roster: [],
      sessions: [],
      includeParentContact: false,
      watermark: "wm",
    });
    expect(rows(wb, "Danh sách lớp")[0]).toEqual(["Mã lớp", "Tên lớp", "Sĩ số"]);
    expect(rows(wb, "Danh sách lớp")[1]).toEqual(["S3-01", "Sata 3 tối T2", 8]);
    expect(wb.SheetNames).toEqual(["Danh sách lớp", "Học viên theo lớp"]);
  });

  it("[CEX-02] SĐT phụ huynh là Ô CHỮ — Excel không nuốt số 0 đầu", () => {
    const wb = buildClassExportWorkbook({
      options: OPTS,
      classes: [LOP],
      roster: ROSTER,
      sessions: [],
      includeParentContact: true,
      watermark: "wm",
    });
    const ws = wb.Sheets["Học viên theo lớp"];
    const header = rows(wb, "Học viên theo lớp")[0];
    const col = header.indexOf("SĐT phụ huynh");
    const cell = ws[XLSX.utils.encode_cell({ r: 1, c: col })];
    expect(cell.t).toBe("s");
    expect(cell.v).toBe("0905123456");
    // định dạng "Text": người dùng sửa ô rồi lưu lại, Excel vẫn không đổi thành số.
    expect(cell.z).toBe("@");
  });

  it("[CEX-03] không được phép ⇒ KHÔNG có cột phụ huynh, kể cả khi dữ liệu lỡ có", () => {
    const wb = buildClassExportWorkbook({
      options: OPTS,
      classes: [LOP],
      roster: ROSTER,
      sessions: [],
      includeParentContact: false,
      watermark: "wm",
    });
    const flat = JSON.stringify(rows(wb, "Học viên theo lớp"));
    expect(flat).not.toContain("0905123456");
    expect(flat).not.toContain("Chị Lan");
  });

  it("[CEX-04] lịch học đọc giờ RIÊNG theo thứ (slot thắng giờ chung)", () => {
    expect(scheduleText(LOP)).toBe("T2 17:30–19:00 · T6 08:00–09:30");
  });
});

describe("tuỳ chọn export", () => {
  it("[CEX-05] vòng query → parse giữ nguyên, và bắt buộc ≥1 sheet", () => {
    const back = parseClassExportOptions(new URLSearchParams(toClassExportQuery(OPTS)));
    expect(back.success && back.data).toEqual(OPTS);
    expect(classExportOptionsSchema.safeParse({ ...OPTS, sheets: [] }).success).toBe(false);
    expect(
      parseClassExportOptions(new URLSearchParams("sheets=lop,xoa-db&cols=name")).success,
    ).toBe(false);
  });
});
