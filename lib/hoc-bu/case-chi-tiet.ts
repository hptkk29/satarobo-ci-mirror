// lib/hoc-bu/case-chi-tiet.ts — ĐỌC chi tiết MỘT case dạy bù theo mô hình T07 (T16, 08/10/2026): bộ bài, bé tham gia, từng mục (bài) của từng bé.
//
// Thay `docChiTietCase` (cũ: đọc theo MỤC, một dòng một bé-một-bài, không biết bộ bài / điểm danh hai tầng). Màn chi tiết case ở admin và site giáo viên
// đọc qua đây: cùng một hình dạng dữ liệu, chỉ khác phạm vi (admin: `scopedDb` + lọc Sale; giáo viên: case MÌNH dạy).
//
// Case ĐỜI CŨ chưa nâng lên mô hình nhiều bài (không có bé tham gia) trả `daNangCap = false` kèm danh sách mục — màn hiện một nút "Nâng cấp case này"
// (action chạy `nangCapCase`, idempotent) chứ KHÔNG ghi gì trong lúc render.
import "server-only";
import { laDongMienPhi } from "@/lib/hoc-bu/xep-case";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { scopedDb } from "@/lib/db-scope";
import { deriveSessionLabel, deriveSessionProjectName } from "@/lib/lms/session-project-name";
import { whereCase } from "@/lib/hoc-bu/case-doc";
import { normalizeEvalRatings } from "@/lib/lms/session-eval-rubric";

type Sdb = ReturnType<typeof scopedDb>;

export type KetQuaMuc = "PLANNED" | "COMPLETED" | "NOT_COMPLETED" | "RELEASED";
export type TrangThaiBe = "PENDING" | "PRESENT" | "ABSENT" | "REMOVED";
export type CachXep = "LUOT" | "PHI" | "MIEN_PHI";

export type MucChiTiet = {
  id: string;
  makeupNeedId: string;
  lessonId: string | null;
  tenBai: string;
  result: KetQuaMuc;
  /** "Đánh giá chung" của phiếu. */
  danhGia: string | null;
  /** Bảng năng lực 9 tiêu chí của phiếu (T16b); null = chưa chấm bảng. */
  rubric: Record<string, number> | null;
  /** Tên dự án suy từ bài — in trên phiếu. */
  duAn: string;
  cachXep: CachXep;
  ngayVang: Date | null;
};

export type BeChiTiet = {
  id: string;
  studentId: string;
  hocVien: string;
  lop: string[];
  status: TrangThaiBe;
  /** Khoá lạc quan khi SỬA điểm danh (phiên bản lúc mở màn). */
  version: number;
  nhanXetChung: string | null;
  /** Mục còn sống (không RELEASED), theo thứ tự bài trong bộ bài. */
  muc: MucChiTiet[];
  /** Mục đã nhả (lịch sử: bị gỡ, hoặc bé vắng/chưa xong) — chỉ để HIỆN, không thao tác. */
  mucDaNha: MucChiTiet[];
};

export type ChiTietCaseV2 = {
  id: string;
  version: number;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  centerId: string;
  courseId: string;
  date: Date;
  startTime: string;
  endTime: string;
  khoa: string;
  boBai: { id: string; ten: string }[];
  /** Tên dự án của bài ĐẦU TIÊN (hộp nhận xét in chỉ đọc). */
  duAn: string;
  teacherId: string;
  giaoVien: string;
  roomId: string | null;
  phong: string | null;
  /** Sức chứa của phòng (null = chưa xếp phòng). */
  sucChua: number | null;
  note: string | null;
  /** Case có bé tham gia (đã nâng lên mô hình T07). false = case đời cũ, màn chỉ hiện nút nâng cấp. */
  daNangCap: boolean;
  classIds: string[];
  be: BeChiTiet[];
  /** Bé đang tính (không REMOVED). */
  soBe: number;
  soCoMat: number;
  soChoDiemDanh: number;
};

const CHON = {
  id: true,
  version: true,
  status: true,
  centerId: true,
  courseId: true,
  lessonId: true,
  date: true,
  startTime: true,
  endTime: true,
  teacherId: true,
  roomId: true,
  note: true,
  lessons: { select: { lessonId: true, order: true }, orderBy: { order: "asc" } },
  participants: {
    select: {
      id: true,
      studentId: true,
      attendanceStatus: true,
      version: true,
      generalComment: true,
      student: { select: { name: true } },
      items: {
        select: {
          id: true,
          makeupNeedId: true,
          lessonId: true,
          result: true,
          teacherEvaluation: true,
          evaluationRubric: true,
          dungLuot: true,
          createdAt: true,
          makeupNeed: { select: { freeApprovedAt: true, nguon: true, classId: true, class: { select: { name: true } }, missedSessionId: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  },
  students: { select: { id: true, participantId: true } },
} satisfies Prisma.MakeupCaseSelect;

/** Json đã lưu → bảng 9 tiêu chí (hoặc null khi chưa từng chấm bảng). */
function rubricCuaMuc(raw: unknown): Record<string, number> | null {
  return raw && typeof raw === "object" ? normalizeEvalRatings(raw) : null;
}

type Tho = Prisma.MakeupCaseGetPayload<{ select: typeof CHON }>;
async function layTho(client: Sdb | typeof db, where: Prisma.MakeupCaseWhereInput): Promise<Tho | null> {
  return (client as typeof db).makeupCase.findFirst({ where, select: CHON });
}

async function ghep(c: Tho): Promise<ChiTietCaseV2> {
  const baiIds = [...new Set([c.lessonId, ...c.lessons.map((l) => l.lessonId), ...c.participants.flatMap((p) => p.items.map((i) => i.lessonId))].filter((x): x is string => !!x))];
  const buoiIds = [...new Set(c.participants.flatMap((p) => p.items.map((i) => i.makeupNeed.missedSessionId)))];
  const [khoa, bai, gv, phong, buoi] = await Promise.all([
    db.course.findUnique({ where: { id: c.courseId }, select: { name: true } }),
    db.lesson.findMany({ where: { id: { in: baiIds } }, select: { id: true, order: true, title: true, moduleCode: true } }),
    db.user.findUnique({ where: { id: c.teacherId }, select: { name: true } }),
    c.roomId ? db.room.findUnique({ where: { id: c.roomId }, select: { name: true, capacity: true } }) : Promise.resolve(null),
    buoiIds.length ? db.classSession.findMany({ where: { id: { in: buoiIds } }, select: { id: true, date: true } }) : Promise.resolve([]),
  ]);
  const baiTheoId = new Map(bai.map((b) => [b.id, b]));
  const tenBai = (id: string | null): string => {
    const b = id ? baiTheoId.get(id) : undefined;
    return b ? deriveSessionLabel({ lessonOrder: b.order, lessonTitle: b.title, moduleCode: b.moduleCode }) || `Bài ${b.order}` : "Bài chưa xác định";
  };
  const duAnBai = (id: string | null): string => {
    const b = id ? baiTheoId.get(id) : undefined;
    return b ? deriveSessionProjectName({ lessonOrder: b.order, lessonTitle: b.title, moduleCode: b.moduleCode }) : "";
  };
  const ngayBuoi = new Map(buoi.map((b) => [b.id, b.date]));
  const thuTuBai = new Map(c.lessons.map((l) => [l.lessonId, l.order]));
  const boBaiId = c.lessons.length > 0 ? c.lessons.map((l) => l.lessonId) : [c.lessonId];
  const dauTien = baiTheoId.get(boBaiId[0]!);

  const be: BeChiTiet[] = c.participants.map((p) => {
    const mucTho: MucChiTiet[] = p.items.map((i) => ({
      id: i.id,
      makeupNeedId: i.makeupNeedId,
      lessonId: i.lessonId,
      tenBai: tenBai(i.lessonId),
      result: i.result,
      danhGia: i.teacherEvaluation,
      rubric: rubricCuaMuc(i.evaluationRubric),
      duAn: duAnBai(i.lessonId),
      cachXep: i.dungLuot ? "LUOT" : laDongMienPhi(i.makeupNeed) ? "MIEN_PHI" : "PHI",
      ngayVang: ngayBuoi.get(i.makeupNeed.missedSessionId) ?? null,
    }));
    const thuTu = (m: MucChiTiet) => (m.lessonId ? (thuTuBai.get(m.lessonId) ?? 99) : 99);
    return {
      id: p.id,
      studentId: p.studentId,
      hocVien: p.student.name,
      lop: [...new Set(p.items.map((i) => i.makeupNeed.class.name))],
      status: p.attendanceStatus,
      version: p.version,
      nhanXetChung: p.generalComment,
      muc: mucTho.filter((m) => m.result !== "RELEASED").sort((a, b) => thuTu(a) - thuTu(b)),
      mucDaNha: mucTho.filter((m) => m.result === "RELEASED"),
    };
  });
  const dangTinh = be.filter((b) => b.status !== "REMOVED");
  return {
    id: c.id,
    version: c.version,
    status: c.status,
    centerId: c.centerId,
    courseId: c.courseId,
    date: c.date,
    startTime: c.startTime,
    endTime: c.endTime,
    khoa: khoa?.name ?? "—",
    boBai: boBaiId.map((id) => ({ id, ten: tenBai(id) })),
    duAn: dauTien ? deriveSessionProjectName({ lessonOrder: dauTien.order, lessonTitle: dauTien.title, moduleCode: dauTien.moduleCode }) : "",
    teacherId: c.teacherId,
    giaoVien: gv?.name ?? "Giáo viên",
    roomId: c.roomId,
    phong: phong?.name ?? null,
    sucChua: phong?.capacity ?? null,
    note: c.note,
    daNangCap: c.participants.length > 0 || c.students.length === 0,
    classIds: [...new Set(c.participants.flatMap((p) => p.items.map((i) => i.makeupNeed.classId)))],
    be,
    soBe: dangTinh.length,
    soCoMat: dangTinh.filter((b) => b.status === "PRESENT").length,
    soChoDiemDanh: dangTinh.filter((b) => b.status === "PENDING").length,
  };
}

/** Admin: qua `scopedDb`; Sale (`chiCuaSale` ≠ null) chỉ thấy case mình tạo hoặc có bé mình phụ trách (như danh sách). */
export async function docChiTietCaseV2(sdb: Sdb, p: { caseId: string; chiCuaSale: string | null }): Promise<ChiTietCaseV2 | null> {
  const c = await layTho(sdb, { id: p.caseId, ...whereCase({ chiCuaSale: p.chiCuaSale }) });
  return c ? ghep(c) : null;
}

/** Site giáo viên: chỉ case mà người này DẠY. */
export async function docChiTietCaseV2ChoGv(teacherId: string, caseId: string): Promise<ChiTietCaseV2 | null> {
  const c = await layTho(db, { id: caseId, teacherId });
  return c ? ghep(c) : null;
}
