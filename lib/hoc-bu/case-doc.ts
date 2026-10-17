import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { scopedDb } from "@/lib/db-scope";
import { deriveSessionLabel } from "@/lib/lms/session-project-name";
import { hocVienCuaSale } from "@/lib/hoc-bu/danh-sach-db";
import { timHocVienBu } from "@/lib/hoc-bu/loc";
import type { NhomBu } from "@/lib/hoc-bu/xep-case";
import { demTienDo, type TienDoCase } from "@/lib/hoc-bu/tien-do";

export type { TienDoCase };

// ĐỌC case dạy bù (docs/hoc-bu/DAC-TA.md). Admin đọc qua `scopedDb`; site GV đọc trần theo
// `teacherId` (người dạy chỉ thấy case của chính mình).
//
// Sale (không có `makeup:view-all`) thấy case do mình tạo hoặc case có ÍT NHẤT một học viên
// mình phụ trách — và khi mở case thì thấy ĐỦ các bé trong đó (chốt 29/09: "khi gộp vào lớp học
// bù chung thì mới thấy học viên của sale khác được add vào").

type Sdb = ReturnType<typeof scopedDb>;

export type TrangThaiCase = "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

/**
 * T07 — mục bị GỠ khỏi case được GIỮ lại làm lịch sử (status RELEASED); mọi màn "bé trong case" phải bỏ qua chúng. Một bé có thể có 1–3 mục
 * trong một case, nên "số bé" đếm theo HỌC VIÊN, không theo mục.
 */
type TrangThaiMuc = "PLACED" | "PRESENT" | "ABSENT";
function conSong<T extends { status: TrangThaiMuc | "RELEASED" }>(xs: readonly T[]): (T & { status: TrangThaiMuc })[] {
  return xs.filter((x): x is T & { status: TrangThaiMuc } => x.status !== "RELEASED");
}
const demBe = (xs: readonly { makeupNeed: { studentId: string } }[]): number => new Set(xs.map((x) => x.makeupNeed.studentId)).size;

export type DongCase = {
  id: string;
  centerId: string;
  date: Date;
  startTime: string;
  endTime: string;
  status: TrangThaiCase;
  khoa: string;
  buoi: string;
  giaoVien: string;
  phong: string | null;
  soBe: number;
  soCoMat: number;
  /** Tên các bé trong case (xếp theo tên) — màn danh sách in thẳng ra. */
  hocVien: string[];
  /** Tiến độ để Sale NHẮC (chốt 30/09): bao nhiêu bé đã điểm danh, bao nhiêu bé có mặt đã
   *  có phiếu nhận xét ở buổi gốc. Chỉ màn danh sách admin đọc. */
  tienDo?: TienDoCase;
};


export type LocCase = {
  centerId?: string;
  courseId?: string;
  /** Chuỗi tìm đã chuẩn hoá — case có ít nhất một bé khớp (tên / mã học viên / lớp gốc). */
  tim?: string;
  chiCuaSale: string | null;
  trangThai?: TrangThaiCase;
};

export function whereCase(p: LocCase): Prisma.MakeupCaseWhereInput {
  return {
    ...(p.centerId ? { centerId: p.centerId } : {}),
    ...(p.courseId ? { courseId: p.courseId } : {}),
    ...(p.trangThai ? { status: p.trangThai } : {}),
    // Tìm đứng trong AND: `OR` ở dưới đã là lọc Sale — gộp phẳng là ghi đè nhau.
    ...(p.tim ? { AND: [{ students: { some: { makeupNeed: timHocVienBu(p.tim) } } }] } : {}),
    ...(p.chiCuaSale
      ? {
          OR: [
            { createdById: p.chiCuaSale },
            { students: { some: { makeupNeed: { student: hocVienCuaSale(p.chiCuaSale) } } } },
          ],
        }
      : {}),
  };
}

async function nhanCase(
  rows: { id: string; courseId: string; lessonId: string; teacherId: string; roomId: string | null }[],
): Promise<{ khoa: Map<string, string>; buoi: Map<string, string>; gv: Map<string, string>; phong: Map<string, string> }> {
  const [khoa, bai, gv, phong] = await Promise.all([
    db.course.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.courseId))] } }, select: { id: true, name: true } }),
    db.lesson.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.lessonId))] } },
      select: { id: true, order: true, title: true, moduleCode: true },
    }),
    db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.teacherId))] } }, select: { id: true, name: true } }),
    db.room.findMany({
      where: { id: { in: rows.map((r) => r.roomId).filter((x): x is string => !!x) } },
      select: { id: true, name: true },
    }),
  ]);
  return {
    khoa: new Map(khoa.map((k) => [k.id, k.name])),
    buoi: new Map(
      bai.map((b) => [
        b.id,
        deriveSessionLabel({ lessonOrder: b.order, lessonTitle: b.title, moduleCode: b.moduleCode }) || `Bài ${b.order}`,
      ]),
    ),
    gv: new Map(gv.map((u) => [u.id, u.name ?? "Giáo viên"])),
    phong: new Map(phong.map((r) => [r.id, r.name])),
  };
}

export async function docDanhSachCase(
  sdb: Sdb,
  p: LocCase & { trang: number; soDong: number },
): Promise<{ dong: DongCase[]; tong: number; trang: number; soTrang: number }> {
  const where = whereCase(p);
  const tong = await sdb.makeupCase.count({ where });
  const soTrang = Math.max(1, Math.ceil(tong / p.soDong));
  const trang = Math.min(Math.max(1, Math.floor(p.trang) || 1), soTrang);
  const rowsTho = await sdb.makeupCase.findMany({
    where,
    orderBy: [{ date: "desc" }, { startTime: "desc" }, { id: "asc" }],
    skip: (trang - 1) * p.soDong,
    take: p.soDong,
    select: {
      id: true,
      centerId: true,
      date: true,
      startTime: true,
      endTime: true,
      status: true,
      courseId: true,
      lessonId: true,
      teacherId: true,
      roomId: true,
      students: {
        select: {
          status: true,
          makeupNeed: { select: { missedSessionId: true, studentId: true, student: { select: { name: true } } } },
        },
      },
    },
  });
  const rows = rowsTho.map((r) => ({ ...r, students: conSong(r.students) }));
  const coMat = rows.flatMap((r) => r.students.filter((s) => s.status === "PRESENT"));
  const [n, phieu] = await Promise.all([
    nhanCase(rows),
    coMat.length
      ? db.studentSessionFeedback.findMany({
          where: {
            OR: coMat.map((s) => ({ classSessionId: s.makeupNeed.missedSessionId, studentId: s.makeupNeed.studentId })),
          },
          select: { classSessionId: true, studentId: true },
        })
      : Promise.resolve([]),
  ]);
  const daCoPhieu = new Set(phieu.map((f) => `${f.classSessionId}|${f.studentId}`));
  return {
    tong,
    trang,
    soTrang,
    dong: rows.map((r) => ({
      id: r.id,
      centerId: r.centerId,
      date: r.date,
      startTime: r.startTime,
      endTime: r.endTime,
      status: r.status,
      khoa: n.khoa.get(r.courseId) ?? "—",
      buoi: n.buoi.get(r.lessonId) ?? "—",
      giaoVien: n.gv.get(r.teacherId) ?? "—",
      phong: r.roomId ? (n.phong.get(r.roomId) ?? null) : null,
      soBe: demBe(r.students),
      soCoMat: demBe(r.students.filter((s) => s.status === "PRESENT")),
      hocVien: [...new Set(r.students.map((s) => s.makeupNeed.student.name))].sort((a, b) => a.localeCompare(b, "vi")),
      tienDo: demTienDo(
        r.students.map((s) => ({
          status: s.status,
          coNhanXet: daCoPhieu.has(`${s.makeupNeed.missedSessionId}|${s.makeupNeed.studentId}`),
        })),
      ),
    })),
  };
}

/** Case còn nhận thêm bé cùng nhóm (cùng cơ sở, khoá, buổi bù), từ hôm nay trở đi. */
export async function caseCungNhom(sdb: Sdb, nhom: NhomBu, homNay: Date): Promise<DongCase[]> {
  if (!nhom.centerId || !nhom.lessonId) return [];
  return caseChoNhom(sdb, { centerId: nhom.centerId, courseId: nhom.courseId, lessonIds: [nhom.lessonId] }, homNay);
}

/**
 * T07 — case còn nhận thêm nhóm bé: cùng cơ sở + khoá, và MỌI bài vắng của nhóm nằm trong bộ bài của case. (Case đời cũ chưa có bộ bài thì khớp
 * bài chính.)
 */
export async function caseChoNhom(
  sdb: Sdb,
  nhom: { centerId: string; courseId: string; lessonIds: readonly string[] },
  homNay: Date,
): Promise<DongCase[]> {
  if (nhom.lessonIds.length === 0) return [];
  const rowsTho = await sdb.makeupCase.findMany({
    where: {
      status: "SCHEDULED",
      centerId: nhom.centerId,
      courseId: nhom.courseId,
      // T07: case nhận bé khi bài vắng của bé nằm trong BỘ BÀI của case (case đời cũ chưa có bộ bài thì khớp bài chính).
      AND: nhom.lessonIds.map((lessonId) => ({ OR: [{ lessonId }, { lessons: { some: { lessonId } } }] })),
      date: { gte: homNay },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    take: 20,
    select: {
      id: true,
      centerId: true,
      date: true,
      startTime: true,
      endTime: true,
      status: true,
      courseId: true,
      lessonId: true,
      teacherId: true,
      roomId: true,
      students: { select: { status: true, makeupNeed: { select: { studentId: true, student: { select: { name: true } } } } } },
    },
  });
  const rows = rowsTho.map((r) => ({ ...r, students: conSong(r.students) }));
  const n = await nhanCase(rows);
  return rows.map((r) => ({
    id: r.id,
    centerId: r.centerId,
    date: r.date,
    startTime: r.startTime,
    endTime: r.endTime,
    status: r.status,
    khoa: n.khoa.get(r.courseId) ?? "—",
    buoi: n.buoi.get(r.lessonId) ?? "—",
    giaoVien: n.gv.get(r.teacherId) ?? "—",
    phong: r.roomId ? (n.phong.get(r.roomId) ?? null) : null,
    soBe: demBe(r.students),
    soCoMat: demBe(r.students.filter((s) => s.status === "PRESENT")),
    hocVien: [...new Set(r.students.map((s) => s.makeupNeed.student.name))].sort((a, b) => a.localeCompare(b, "vi")),
  }));
}

/** Lịch site GV — case dạy bù của giáo viên trong khoảng ngày. */
export async function caseCuaGiaoVien(
  teacherId: string,
  from: Date,
  to: Date,
): Promise<{ id: string; date: Date; startTime: string; endTime: string; status: TrangThaiCase; khoa: string; buoi: string; soBe: number }[]> {
  const rows = await db.makeupCase.findMany({
    where: { teacherId, date: { gte: from, lt: to }, status: { not: "CANCELLED" } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    take: 200,
    select: {
      id: true,
      centerId: true,
      date: true,
      startTime: true,
      endTime: true,
      status: true,
      courseId: true,
      lessonId: true,
      teacherId: true,
      roomId: true,
      students: { select: { status: true, makeupNeed: { select: { studentId: true } } } },
    },
  });
  const n = await nhanCase(rows);
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    startTime: r.startTime,
    endTime: r.endTime,
    status: r.status,
    khoa: n.khoa.get(r.courseId) ?? "—",
    buoi: n.buoi.get(r.lessonId) ?? "—",
    soBe: demBe(conSong(r.students)),
  }));
}

// ─── Site GV — màn "Học bù" (29/09/2026), khuôn giống danh sách Trial ─────────────────────
export type DongCaseGv = {
  id: string;
  date: Date;
  startTime: string;
  endTime: string;
  status: TrangThaiCase;
  khoa: string;
  buoi: string;
  hocVien: string[];
  soBe: number;
  soDaDiemDanh: number;
  soCoMat: number;
  soDaNhanXet: number;
  coTaiLieu: boolean;
};

/** Case của GV: `sapToi` (chưa chốt, từ hôm nay) + `daDay` (đã chốt, 60 ngày gần nhất). */
export async function danhSachCaseGv(
  teacherId: string,
  homNay: Date,
): Promise<{ sapToi: DongCaseGv[]; daDay: DongCaseGv[] }> {
  const tu = new Date(homNay.getTime() - 60 * 86_400_000);
  const rowsTho = await db.makeupCase.findMany({
    where: {
      teacherId,
      OR: [
        { status: "SCHEDULED" },
        { status: { in: ["COMPLETED", "NO_SHOW"] }, date: { gte: tu } },
      ],
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    take: 300,
    select: {
      id: true,
      centerId: true,
      date: true,
      startTime: true,
      endTime: true,
      status: true,
      courseId: true,
      lessonId: true,
      teacherId: true,
      roomId: true,
      students: {
        select: {
          status: true,
          makeupNeed: { select: { studentId: true, missedSessionId: true, student: { select: { name: true } } } },
        },
      },
    },
  });
  const rows = rowsTho.map((r) => ({ ...r, students: conSong(r.students) }));
  const coMat = rows.flatMap((r) => r.students.filter((s) => s.status === "PRESENT").map((s) => s.makeupNeed));
  const [n, phieu, goi] = await Promise.all([
    nhanCase(rows),
    coMat.length
      ? db.studentSessionFeedback.findMany({
          where: { OR: coMat.map((m) => ({ classSessionId: m.missedSessionId, studentId: m.studentId })) },
          select: { classSessionId: true, studentId: true },
        })
      : Promise.resolve([]),
    db.scormPackage.findMany({
      where: { lessonId: { in: [...new Set(rows.map((r) => r.lessonId))] }, isActiveForLesson: true, status: "PUBLISHED" },
      select: { lessonId: true },
    }),
  ]);
  const daNhanXet = new Set(phieu.map((f) => `${f.classSessionId}|${f.studentId}`));
  const coGoi = new Set(goi.map((g) => g.lessonId));
  const dong = rows.map((r) => ({
    id: r.id,
    date: r.date,
    startTime: r.startTime,
    endTime: r.endTime,
    status: r.status,
    khoa: n.khoa.get(r.courseId) ?? "—",
    buoi: n.buoi.get(r.lessonId) ?? "—",
    hocVien: [...new Set(r.students.map((s) => s.makeupNeed.student.name))].sort((a, b) => a.localeCompare(b, "vi")),
    soBe: demBe(r.students),
    soDaDiemDanh: demBe(r.students.filter((s) => s.status !== "PLACED")),
    soCoMat: demBe(r.students.filter((s) => s.status === "PRESENT")),
    soDaNhanXet: r.students.filter(
      (s) => s.status === "PRESENT" && daNhanXet.has(`${s.makeupNeed.missedSessionId}|${s.makeupNeed.studentId}`),
    ).length,
    coTaiLieu: coGoi.has(r.lessonId),
  }));
  return {
    sapToi: dong.filter((d) => d.status === "SCHEDULED"),
    daDay: dong.filter((d) => d.status === "COMPLETED" || d.status === "NO_SHOW").reverse(),
  };
}
