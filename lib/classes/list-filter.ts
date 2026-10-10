// BỘ LỌC DANH SÁCH LỚP — MỘT nguồn cho cả màn `/classes` lẫn file export.
//
// Vì sao tách (24/09/2026): trước đây điều kiện lọc viết thẳng trong `classes/page.tsx`.
// Thêm nút export mà chép lại khối đó sang route là mở đường cho "màn hiện 12 lớp, file
// xuất ra 15 lớp" — người dùng tin cái mình thấy trên màn và gửi file đi. Cả hai đọc
// qua `parseClassListFilters` + `buildClassWhere` ở đây, nên lệch là không thể.
//
// THUẦN (không đụng DB) — client component dùng được `toClassListQuery`, test không cần DB.

import type { ClassStatus, Prisma } from "@prisma/client";
import { parseVnYmd, vnAddDays } from "@/lib/time/vn";

export const CLASS_STATUS_VALUES = [
  "PLANNED",
  "RECRUITING",
  "PENDING_APPROVAL",
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
] as const satisfies readonly ClassStatus[];

/** Nhãn trạng thái lớp — dùng chung cho chip lọc, bảng, và file export. */
export const CLASS_STATUS_LABEL: Record<ClassStatus, string> = {
  PLANNED: "Đang lên KH",
  RECRUITING: "Tuyển sinh",
  PENDING_APPROVAL: "Chờ duyệt",
  ACTIVE: "Đang dạy",
  COMPLETED: "Hoàn thành",
  CANCELLED: "Huỷ",
};

export const FILL_VALUES =["empty", "available", "full"] as const;
export type FillFilter = (typeof FILL_VALUES)[number];

export const SORT_VALUES = ["status", "start_desc", "start_asc", "name"] as const;
export type ClassSort = (typeof SORT_VALUES)[number];

export interface ClassListFilters {
  q?: string;
  /** Rỗng = mọi trạng thái. */
  statuses: ClassStatus[];
  centerId?: string;
  courseId?: string;
  teacherId?: string;
  /** 0=CN … 6=T7 — lớp học ÍT NHẤT một trong các thứ này. */
  weekdays: number[];
  /** "YYYY-MM-DD" — khai giảng từ ngày (tính theo lịch VN). */
  startFrom?: string;
  startTo?: string;
  fill?: FillFilter;
  sort: ClassSort;
}

type RawParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  const t = s?.trim();
  return t ? t : undefined;
}

function csv(v: string | string[] | undefined): string[] {
  const all = Array.isArray(v) ? v : v ? [v] : [];
  return all
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Đọc searchParams → bộ lọc hợp lệ. Giá trị lạ bị BỎ (không ném): URL cũ đã lưu/chia sẻ
 * vẫn mở được, chỉ mất phần không còn hiểu.
 */
export function parseClassListFilters(sp: RawParams): ClassListFilters {
  const statuses = [
    ...new Set(
      csv(sp.status).filter((s): s is ClassStatus =>
        (CLASS_STATUS_VALUES as readonly string[]).includes(s),
      ),
    ),
  ];
  const weekdays = [
    ...new Set(
      csv(sp.thu)
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
    ),
  ].sort((a, b) => a - b);
  const fillRaw = first(sp.siSo);
  const sortRaw = first(sp.sort);
  const from = first(sp.tu);
  const to = first(sp.den);
  return {
    q: first(sp.q),
    statuses,
    centerId: first(sp.centerId),
    courseId: first(sp.courseId),
    teacherId: first(sp.teacherId),
    weekdays,
    startFrom: from && YMD.test(from) && parseVnYmd(from) ? from : undefined,
    startTo: to && YMD.test(to) && parseVnYmd(to) ? to : undefined,
    fill: (FILL_VALUES as readonly string[]).includes(fillRaw ?? "")
      ? (fillRaw as FillFilter)
      : undefined,
    sort: (SORT_VALUES as readonly string[]).includes(sortRaw ?? "")
      ? (sortRaw as ClassSort)
      : "status",
  };
}

/** Ngược lại của `parseClassListFilters` — chuỗi query gọn (bỏ giá trị mặc định). */
export function toClassListQuery(f: ClassListFilters): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.statuses.length) p.set("status", f.statuses.join(","));
  if (f.centerId) p.set("centerId", f.centerId);
  if (f.courseId) p.set("courseId", f.courseId);
  if (f.teacherId) p.set("teacherId", f.teacherId);
  if (f.weekdays.length) p.set("thu", f.weekdays.join(","));
  if (f.startFrom) p.set("tu", f.startFrom);
  if (f.startTo) p.set("den", f.startTo);
  if (f.fill) p.set("siSo", f.fill);
  if (f.sort !== "status") p.set("sort", f.sort);
  return p.toString();
}

/** Số điều kiện lọc đang bật (không đếm sắp xếp) — cho nhãn "Xoá lọc (3)". */
export function countActiveFilters(f: ClassListFilters): number {
  return [
    f.q,
    f.statuses.length > 0,
    f.centerId,
    f.courseId,
    f.teacherId,
    f.weekdays.length > 0,
    f.startFrom || f.startTo,
    f.fill,
  ].filter(Boolean).length;
}

/**
 * Điều kiện Prisma. `forceTeacherId` = người chỉ có `classes:view-own`: ép về lớp của
 * chính họ, BỎ QUA ô lọc GV trên URL (không để họ gõ `teacherId=` người khác).
 */
export function buildClassWhere(
  f: ClassListFilters,
  opts: { forceTeacherId: string | null },
): Prisma.ClassWhereInput {
  const and: Prisma.ClassWhereInput[] = [{ deletedAt: null }];
  if (f.statuses.length) and.push({ status: { in: f.statuses } });
  if (f.centerId) and.push({ centerId: f.centerId });
  if (f.courseId) and.push({ courseId: f.courseId });
  const teacher = opts.forceTeacherId ?? f.teacherId;
  if (teacher) and.push({ OR: [{ teacherId: teacher }, { assistantId: teacher }] });
  if (f.weekdays.length) and.push({ scheduleDays: { hasSome: f.weekdays } });
  // Khai giảng lưu theo hai quy ước (nửa đêm UTC của ngày VN — form hiện hành; 00:00 VN —
  // dữ liệu cũ). Mốc [00:00 VN ngày đầu, 00:00 VN ngày sau ngày cuối) ôm đúng cả hai.
  const from = f.startFrom ? parseVnYmd(f.startFrom) : null;
  const toStart = f.startTo ? parseVnYmd(f.startTo) : null;
  if (from || toStart) {
    and.push({
      startDate: {
        ...(from ? { gte: from } : {}),
        ...(toStart ? { lt: vnAddDays(toStart, 1) } : {}),
      },
    });
  }
  if (f.q) {
    and.push({
      OR: [
        { name: { contains: f.q, mode: "insensitive" } },
        { classCode: { contains: f.q, mode: "insensitive" } },
      ],
    });
  }
  return { AND: and };
}

export function buildClassOrderBy(sort: ClassSort): Prisma.ClassOrderByWithRelationInput[] {
  switch (sort) {
    case "start_desc":
      return [{ startDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }];
    case "start_asc":
      return [{ startDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }];
    case "name":
      return [{ name: "asc" }];
    default:
      return [{ status: "asc" }, { startDate: "desc" }, { createdAt: "desc" }];
  }
}

/**
 * Lọc sĩ số — làm SAU truy vấn vì so hai cột (đếm ghi danh vs `maxStudents`) Prisma không
 * diễn đạt được trong `where`. Danh sách lớp vốn tải trọn (phân trang ở tầng hiển thị).
 */
export function matchesFill(
  enrolled: number,
  maxStudents: number,
  fill: FillFilter | undefined,
): boolean {
  if (!fill) return true;
  if (fill === "empty") return enrolled === 0;
  if (fill === "full") return maxStudents > 0 && enrolled >= maxStudents;
  return enrolled < maxStudents;
}
