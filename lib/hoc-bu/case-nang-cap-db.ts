// lib/hoc-bu/case-nang-cap-db.ts — NÂNG một case đời cũ (một bài, mục không có bé tham gia) lên mô hình T07, TẠI CHỖ và TẤT ĐỊNH.
//
// Hai nơi dùng CHUNG một bộ luật: phép nâng lười (mọi đường GHI chạm case gọi `nangCapCase` trong giao dịch, sau khi khoá hàng case) và
// script `scripts/hoc-bu-case-v2-backfill.ts` (dry-run mặc định; dry-run chạy `lapKeHoachNangCap` THUẦN trên cùng dữ liệu, không ghi).
// Một bộ luật vì hai nơi mà nâng khác nhau là hai kết quả lịch sử khác nhau — và dry-run mà báo khác thực tế thì vô nghĩa.
//
// Nâng gì (chỉ THÊM, không đổi nghĩa dữ liệu cũ):
//   · bộ bài: một dòng `MakeupCaseLesson` cho `MakeupCase.lessonId` (order 1);
//   · mỗi bé: một `MakeupCaseParticipant` (tầng 1) suy từ các mục của bé: còn PLACED ⇒ PENDING; có PRESENT ⇒ PRESENT; còn lại ABSENT;
//   · mỗi mục: nối `participantId`, chụp `lessonId` / `originalSessionId` / `originalAttendanceId` từ DÒNG CẦN BÙ của nó, đặt `result` theo `status`.
// KHÔNG bịa: `attendedAt` / `processedById` của bé giữ null (dữ liệu cũ không ghi ai điểm danh lúc nào); mục có bài lệch bộ bài của case
// vẫn được nối nhưng được báo NEEDS_MANUAL_REVIEW (checker TV-14 cũng báo) — không tự thêm bài thứ hai vào case.
import type { MakeupCaseStudentStatus, MakeupItemResult, MakeupParticipantAttendance, Prisma } from "@prisma/client";
import { guongTrangThai } from "@/lib/hoc-bu/case-nhieu-bai-thuan";

type Tx = Prisma.TransactionClient;
type StatusCu = "PLACED" | "PRESENT" | "ABSENT" | "RELEASED";

export type BatThuongNangCap = { loai: "LECH_BAI" | "BAI_KHONG_TON_TAI"; id: string; chiTiet: string };

export type KetQuaNangCap = {
  daNangCap: boolean;
  lessonTao: number;
  beTao: number;
  mucNoi: number;
  batThuong: BatThuongNangCap[];
};

/** `result` suy từ `status` cũ — đúng bảng đã dùng trong migration (PRESENT→COMPLETED, ABSENT→RELEASED vì bé vắng, PLACED→PLANNED). */
export function resultTuStatusCu(status: StatusCu): MakeupItemResult {
  if (status === "PRESENT") return "COMPLETED";
  if (status === "PLACED") return "PLANNED";
  return "RELEASED";
}

/**
 * Tầng 1 của bé suy từ trạng thái cũ của các mục của bé. Còn mục PLACED ⇒ chưa điểm danh. Không còn PLACED: có PRESENT ⇒ có mặt;
 * toàn ABSENT ⇒ vắng. Toàn RELEASED (mục bị gỡ) ⇒ REMOVED.
 */
export function tang1TuTrangThaiCu(status: readonly StatusCu[]): MakeupParticipantAttendance {
  if (status.some((s) => s === "PLACED")) return "PENDING";
  if (status.some((s) => s === "PRESENT")) return "PRESENT";
  if (status.some((s) => s === "ABSENT")) return "ABSENT";
  return "REMOVED";
}

// ── Dữ liệu vào / kế hoạch (THUẦN) ──────────────────────────────────────────────────────────────────────────────────
export type CaseDuLieuNangCap = {
  id: string;
  lessonId: string;
  /** Bài chính của case có còn trong bảng bài không (không có ⇒ không dựng được bộ bài — FK RESTRICT). */
  baiChinhConTon: boolean;
  lessonIds: readonly string[];
  participants: readonly { id: string; studentId: string }[];
  muc: readonly {
    id: string;
    status: StatusCu;
    participantId: string | null;
    studentId: string;
    missedLessonId: string | null;
    missedSessionId: string;
    originalAttendanceId: string | null;
    completedAt: Date | null;
  }[];
};

export type MucNoi = {
  id: string;
  studentId: string;
  result: MakeupItemResult;
  status: MakeupCaseStudentStatus;
  lessonId: string | null;
  originalSessionId: string;
  originalAttendanceId: string | null;
  completedAt: Date | null;
};

export type KeHoachNangCap = {
  taoBoBai: boolean;
  /** Bé phải tạo mới (kèm tầng 1 suy được). */
  beMoi: { studentId: string; attendanceStatus: MakeupParticipantAttendance }[];
  mucNoi: MucNoi[];
  batThuong: BatThuongNangCap[];
};

/** Kế hoạch nâng một case. THUẦN: không ghi, không đọc DB. Dry-run của script in đúng kết quả này. */
export function lapKeHoachNangCap(c: CaseDuLieuNangCap): KeHoachNangCap {
  const kh: KeHoachNangCap = { taoBoBai: false, beMoi: [], mucNoi: [], batThuong: [] };
  if (c.lessonIds.length === 0) {
    if (c.baiChinhConTon) kh.taoBoBai = true;
    else kh.batThuong.push({ loai: "BAI_KHONG_TON_TAI", id: c.id, chiTiet: `Bài ${c.lessonId} của case không còn — không dựng được bộ bài` });
  }
  const baiCase = new Set<string>(c.lessonIds);
  if (kh.taoBoBai) baiCase.add(c.lessonId);

  const chuaNoi = c.muc.filter((m) => m.participantId === null);
  const theoBe = new Map<string, typeof chuaNoi>();
  for (const m of chuaNoi) (theoBe.get(m.studentId) ?? theoBe.set(m.studentId, []).get(m.studentId)!).push(m);
  const coSan = new Set(c.participants.map((p) => p.studentId));
  for (const [studentId, muc] of theoBe) {
    const tang1 = tang1TuTrangThaiCu(muc.map((m) => m.status));
    if (!coSan.has(studentId)) kh.beMoi.push({ studentId, attendanceStatus: tang1 });
    for (const m of muc) {
      if (m.missedLessonId && !baiCase.has(m.missedLessonId)) {
        kh.batThuong.push({
          loai: "LECH_BAI",
          id: m.id,
          chiTiet: `Mục bù bài ${m.missedLessonId} nhưng bộ bài của case là ${[...baiCase].join(", ") || "(trống)"}`,
        });
      }
      const result = resultTuStatusCu(m.status);
      kh.mucNoi.push({
        id: m.id,
        studentId,
        result,
        status: guongTrangThai(result, tang1 === "ABSENT"),
        lessonId: m.missedLessonId,
        originalSessionId: m.missedSessionId,
        originalAttendanceId: m.originalAttendanceId,
        completedAt: result === "COMPLETED" ? m.completedAt : null,
      });
    }
  }
  return kh;
}

export const canNangCap = (kh: KeHoachNangCap): boolean => kh.taoBoBai || kh.beMoi.length > 0 || kh.mucNoi.length > 0;

// ── Đọc ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const CHON = {
  id: true,
  centerId: true,
  orgUnitId: true,
  lessonId: true,
  lessons: { select: { lessonId: true } },
  participants: { select: { id: true, studentId: true } },
  students: {
    select: {
      id: true,
      status: true,
      participantId: true,
      makeupNeed: { select: { studentId: true, missedLessonId: true, missedSessionId: true, originalAttendanceId: true, completedAt: true } },
    },
  },
} satisfies Prisma.MakeupCaseSelect;

type CaseTho = Prisma.MakeupCaseGetPayload<{ select: typeof CHON }>;

async function lapDuLieu(tx: Tx, c: CaseTho): Promise<CaseDuLieuNangCap> {
  const co = c.lessons.length === 0 ? await tx.lesson.findUnique({ where: { id: c.lessonId }, select: { id: true } }) : null;
  return {
    id: c.id,
    lessonId: c.lessonId,
    baiChinhConTon: c.lessons.length > 0 || co !== null,
    lessonIds: c.lessons.map((l) => l.lessonId),
    participants: c.participants,
    muc: c.students.map((s) => ({
      id: s.id,
      status: s.status,
      participantId: s.participantId,
      studentId: s.makeupNeed.studentId,
      missedLessonId: s.makeupNeed.missedLessonId,
      missedSessionId: s.makeupNeed.missedSessionId,
      originalAttendanceId: s.makeupNeed.originalAttendanceId,
      completedAt: s.makeupNeed.completedAt,
    })),
  };
}

/** Các case cần nâng (chưa có bộ bài, hoặc còn mục chưa nối bé) cùng kế hoạch của từng case. Chỉ ĐỌC — dùng cho dry-run và để đếm `--expect`. */
export async function docKeHoachNangCapTatCa(tx: Tx): Promise<{ caseId: string; centerId: string; kh: KeHoachNangCap }[]> {
  const ds = await tx.makeupCase.findMany({
    where: { OR: [{ lessons: { none: {} } }, { students: { some: { participantId: null } } }] },
    select: CHON,
    orderBy: { id: "asc" },
  });
  const ra: { caseId: string; centerId: string; kh: KeHoachNangCap }[] = [];
  for (const c of ds) {
    const kh = lapKeHoachNangCap(await lapDuLieu(tx, c));
    if (canNangCap(kh) || kh.batThuong.length > 0) ra.push({ caseId: c.id, centerId: c.centerId, kh });
  }
  return ra;
}

/**
 * Nâng case `caseId`. IDEMPOTENT: case đã nâng (có bộ bài, mọi mục đã nối bé) thì không ghi gì. Gọi BÊN TRONG giao dịch của người gọi;
 * người gọi nên đã khoá hàng case (`SELECT … FOR UPDATE`) — hai lượt nâng cùng lúc cũng an toàn nhờ chỉ mục duy nhất + `skipDuplicates`.
 */
export async function nangCapCase(tx: Tx, caseId: string): Promise<KetQuaNangCap> {
  const c = await tx.makeupCase.findUnique({ where: { id: caseId }, select: CHON });
  if (!c) return { daNangCap: false, lessonTao: 0, beTao: 0, mucNoi: 0, batThuong: [] };
  const kh = lapKeHoachNangCap(await lapDuLieu(tx, c));

  let lessonTao = 0;
  if (kh.taoBoBai) {
    const r = await tx.makeupCaseLesson.createMany({ data: [{ caseId: c.id, lessonId: c.lessonId, order: 1 }], skipDuplicates: true });
    lessonTao = r.count;
  }
  const idBe = new Map(c.participants.map((p) => [p.studentId, p.id]));
  let beTao = 0;
  if (kh.beMoi.length > 0) {
    const r = await tx.makeupCaseParticipant.createMany({
      data: kh.beMoi.map((b) => ({ caseId: c.id, studentId: b.studentId, centerId: c.centerId, orgUnitId: c.orgUnitId, attendanceStatus: b.attendanceStatus })),
      skipDuplicates: true,
    });
    beTao = r.count;
    const moi = await tx.makeupCaseParticipant.findMany({
      where: { caseId: c.id, studentId: { in: kh.beMoi.map((b) => b.studentId) } },
      select: { id: true, studentId: true },
    });
    for (const m of moi) idBe.set(m.studentId, m.id);
  }
  for (const m of kh.mucNoi) {
    await tx.makeupCaseStudent.update({
      where: { id: m.id },
      data: {
        participantId: idBe.get(m.studentId)!,
        lessonId: m.lessonId,
        originalSessionId: m.originalSessionId,
        originalAttendanceId: m.originalAttendanceId,
        result: m.result,
        status: m.status,
        completedAt: m.completedAt,
      },
    });
  }
  return { daNangCap: lessonTao > 0 || beTao > 0 || kh.mucNoi.length > 0, lessonTao, beTao, mucNoi: kh.mucNoi.length, batThuong: kh.batThuong };
}

/**
 * ÁP DỤNG cho mọi case cần nâng, trong MỘT transaction: lệch `expect` ⇒ ném, chưa ghi gì. Mỗi case khoá hàng (FOR UPDATE) trước khi nâng.
 */
export async function apDungNangCapTatCa(
  tx: Tx,
  p: { expect: number },
): Promise<{ daNangCap: { caseId: string; ket: KetQuaNangCap }[]; batThuong: BatThuongNangCap[] }> {
  const ds = await docKeHoachNangCapTatCa(tx);
  if (ds.length !== p.expect) {
    throw new Error(`Số case cần nâng là ${ds.length}, không phải ${p.expect} như dry-run — dừng, chưa ghi gì.`);
  }
  const daNangCap: { caseId: string; ket: KetQuaNangCap }[] = [];
  const batThuong: BatThuongNangCap[] = [];
  for (const d of ds) {
    await tx.$queryRaw`SELECT id FROM "MakeupCase" WHERE id = ${d.caseId} FOR UPDATE`;
    const ket = await nangCapCase(tx, d.caseId);
    daNangCap.push({ caseId: d.caseId, ket });
    batThuong.push(...ket.batThuong);
  }
  return { daNangCap, batThuong };
}
