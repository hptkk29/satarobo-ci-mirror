import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { passesScope } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { rosterWhere } from "@/lib/enrollment-scope";
import { phamViKiemTrung, type Slot, type TaiNguyenBuoi } from "@/lib/lms/scheduling";
import {
  KHONG_XUNG_DOT,
  anDanhKetQua,
  dungThongDiep,
  khoangTuNgayGio,
  timXungDot,
  type KetQuaXungDot,
  type LoaiTru,
  type MucLich,
  type MucLichHocVien,
  type NguonLich,
  type TenThamChieu,
  type XungDot,
} from "@/lib/lms/lich-xung-dot";
import { vnAddDays, vnDateAt, vnParts, vnStartOfDay, vnYmd } from "@/lib/time/vn";

// =============================================================================
// LMS-6 — nối detectScheduleConflict vào write-path: 1 buổi candidate có trùng
// PHÒNG / GIÁO VIÊN với buổi khác cùng ngày không.
//   • cửa sổ buổi = [date, date + (endTime-startTime của lớp)] (fallback 90').
//   • phòng/GV hiệu lực của buổi ĐỐI CHIẾU = substitute ?? actual ?? cấp buổi ?? lớp.
//
// T09 (08/10/2026) — ĐA NGUỒN + CHIỀU HỌC VIÊN: `checkScheduleConflicts` nhìn CẢ BA nguồn lịch
// (`ClassSession`, `TrialClassSession`, `MakeupCase`) theo CẢ BA chiều (giáo viên, phòng, học viên);
// `detectSessionConflicts` / `detectBatchConflicts` cũ là lớp mỏng trên CHÍNH nó. Phép so thuần ở
// `lich-xung-dot.ts`. Trước đây lớp chính chỉ thấy lớp chính, và case học bù không thấy ai (HB-28).
//
// T4.2 — module conflict DUY NHẤT: mọi write-path (sinh / đổi 1 buổi / dời cả lớp /
// xếp bù) đi qua đây. Bản cũ `findScheduleConflicts` (lib/classes/generate.ts) chỉ so
// GV/phòng CẤP LỚP nên bỏ sót lớp khác có dạy-thay / đổi phòng ⇒ ĐÃ GỠ BỎ.
// =============================================================================

function parseHHmm(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(h)) return null;
  return (h || 0) * 60 + (m || 0);
}

/**
 * PURE — khung giờ thật của một buổi: NEO theo `startTime` của lớp (đồng hồ VN),
 * dài bằng `endTime - startTime` (fallback 90').
 *
 * ⚠️ Bản cũ trả `startAt: date` và chỉ dùng startTime/endTime để tính ĐỘ DÀI — tức
 * phép so trùng KHÔNG BAO GIỜ đọc giờ lớp, chỉ đọc phần giờ nằm trong cột `date`.
 * Mà `date` lưu 00:00 cho mọi buổi ⇒ lớp 10:00–11:30 và lớp 18:00–19:30 cùng ngày
 * đều ra `00:00–01:30`, đè khít nhau. Hệ quả: HAI LỚP BẤT KỲ cùng ngày, cùng GV
 * (hoặc cùng phòng) luôn bị báo "Trùng lịch giáo viên", dù giờ cách nhau bao xa.
 * Chủ dự án gặp 06/08 khi cài sata6 10h-11h30 và sata4 18h-19h30 cùng 30/07/2026.
 *
 * Neo giờ đi qua `vnDateAt` chứ KHÔNG dùng `new Date(y,m,d,h,m)`: Vercel chạy UTC
 * còn máy dev +07 — dựng giờ bằng constructor local là lệch 7 tiếng trên prod.
 */
export function sessionWindow(
  date: Date,
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): { startAt: Date; endAt: Date } {
  const s = parseHHmm(startTime);
  const e = parseHHmm(endTime);
  const durMin = s != null && e != null && e - s > 0 ? e - s : 90;

  // Không đọc được giờ lớp → giữ nguyên mốc cũ (không đoán bừa, không chặn oan).
  if (s == null) return { startAt: date, endAt: new Date(date.getTime() + durMin * 60_000) };

  const p = vnParts(date);
  const startAt = vnDateAt(p.year, p.month, p.day, Math.floor(s / 60), s % 60);
  return { startAt, endAt: new Date(startAt.getTime() + durMin * 60_000) };
}

/**
 * Khung giờ lấy từ CHÍNH thời điểm của buổi, độ dài suy từ giờ lớp (mặc định 90').
 *
 * 07/08 — lớp có kế hoạch nhiều giai đoạn thì `Class.startTime` chỉ là bản sao của
 * giai đoạn đang hiệu lực, KHÔNG phải giờ của buổi này. Ép mọi buổi về giờ lớp sẽ bỏ
 * sót trùng thật (lớp B đã sang ca sáng, so bằng ca chiều nên không thấy đụng phòng)
 * và báo trùng oan chiều ngược lại. Buổi đã mang giờ đúng từ lúc sinh — dùng nó.
 */
function sessionWindowFromOwnTime(
  date: Date,
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): { startAt: Date; endAt: Date } {
  const s = parseHHmm(startTime);
  const e = parseHHmm(endTime);
  const durMin = s != null && e != null && e - s > 0 ? e - s : 90;
  return { startAt: date, endAt: new Date(date.getTime() + durMin * 60_000) };
}

type SessionRow = {
  id: string;
  date: Date;
  roomId?: string | null;
  actualRoomId: string | null;
  actualTeacherId: string | null;
  substituteRoomId?: string | null;
  substituteTeacherId?: string | null;
  class: {
    roomId: string | null;
    teacherId: string | null;
    startTime: string | null;
    endTime: string | null;
  } | null;
};

/**
 * PURE — quy đổi các buổi (kèm lớp) thành Slot.
 * Phòng: substitute ?? actual ?? phòng CỦA BUỔI (ClassSession.roomId — W2-4b) ?? lớp.
 * GV:    substitute ?? actual ?? lớp.
 */
export function rowsToSlots(rows: SessionRow[]): Slot[] {
  return rows.map((o) => {
    // Buổi có giờ THẬT (khác 00:00 giờ VN) → dùng chính nó. Buổi cũ còn nằm ở 00:00
    // (dữ liệu trước đợt backfill giờ buổi) mới lùi về giờ lớp — giữ nguyên bản vá
    // 06/08 chống "hai lớp bất kỳ cùng ngày đều báo trùng".
    const p = vnParts(o.date);
    const win =
      p.hour !== 0 || p.minute !== 0
        ? sessionWindowFromOwnTime(o.date, o.class?.startTime, o.class?.endTime)
        : sessionWindow(o.date, o.class?.startTime, o.class?.endTime);
    return {
      id: o.id,
      roomId:
        o.substituteRoomId ?? o.actualRoomId ?? o.roomId ?? o.class?.roomId ?? null,
      teacherId: o.substituteTeacherId ?? o.actualTeacherId ?? o.class?.teacherId ?? null,
      startAt: win.startAt,
      endAt: win.endAt,
    };
  });
}

const SESSION_SELECT = {
  id: true,
  date: true,
  roomId: true,
  actualRoomId: true,
  actualTeacherId: true,
  substituteRoomId: true,
  substituteTeacherId: true,
  class: { select: { roomId: true, teacherId: true, startTime: true, endTime: true } },
} as const;

export type ConflictResult = {
  roomConflict: boolean;
  teacherConflict: boolean;
  conflictIds: string[];
  messages: string[];
  /** T09 — TỪNG trùng (nguồn, id, tên, giờ…) để người gọi dựng câu nói cụ thể thay vì câu chung. */
  chiTiet: XungDot[];
};

const EMPTY: ConflictResult = {
  roomConflict: false,
  teacherConflict: false,
  conflictIds: [],
  messages: [],
  chiTiet: [],
};

function toResult(r: {
  roomConflict: boolean;
  teacherConflict: boolean;
  conflictIds: string[];
  chiTiet?: XungDot[];
}): ConflictResult {
  const messages: string[] = [];
  if (r.roomConflict) messages.push("Trùng phòng với buổi khác cùng giờ");
  if (r.teacherConflict) messages.push("Trùng giáo viên với buổi khác cùng giờ");
  return { ...r, chiTiet: r.chiTiet ?? [], messages };
}

/** Câu cảnh báo VI gộp (null nếu không trùng). */
export function conflictMessage(c: {
  roomConflict: boolean;
  teacherConflict: boolean;
}): string | null {
  const parts: string[] = [];
  if (c.teacherConflict) parts.push("trùng lịch giáo viên");
  if (c.roomConflict) parts.push("trùng phòng");
  if (parts.length === 0) return null;
  return `Cảnh báo xếp lịch: ${parts.join(" và ")} với lớp khác.`;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// LÕI ĐA NGUỒN (T09)
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Các bảng lõi đọc. `db` trần, `scopedDb(actor)` (ép kiểu — tiền lệ `tx` của scopedDb) hay một `tx` đều đưa vào được: nơi gọi tự chọn
 * PHẠM VI NHÌN. Xếp case / sửa buổi lớp dùng `db` trần (GV và học viên có thể thuộc cơ sở khác); màn trial dùng `scopedDb` để giữ
 * nguyên tính fail-closed của note đỏ.
 */
export type NguonDoc = Pick<
  Prisma.TransactionClient,
  "classSession" | "trialClassSession" | "makeupCase" | "makeupCaseStudent" | "enrollment" | "student" | "trialEnrollment"
>;

const MUC_LOP_SELECT = {
  ...SESSION_SELECT,
  classId: true,
  class: { select: { roomId: true, teacherId: true, startTime: true, endTime: true, name: true, centerId: true } },
} as const;
const MUC_TRIAL_SELECT = {
  id: true,
  date: true,
  startTime: true,
  endTime: true,
  roomId: true,
  teacherId: true,
  trialClass: { select: { name: true, centerId: true, roomId: true, teacherId: true } },
} as const;
const MUC_CASE_SELECT = {
  id: true,
  date: true,
  startTime: true,
  endTime: true,
  roomId: true,
  teacherId: true,
  centerId: true,
} as const;

const ngayUtc = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
/** Khoảng cho cột `@db.Date` (nửa đêm UTC của NGÀY VN) phủ [tu, den). */
const khoangNgayDb = (tu: Date, den: Date) => ({ gte: ngayUtc(vnYmd(tu)), lte: ngayUtc(vnYmd(new Date(den.getTime() - 1))) });
/** Khoảng cho cột `Timestamptz` mang giờ thật phủ cả các NGÀY VN chứa [tu, den). */
const khoangNgayTz = (tu: Date, den: Date) => ({ gte: vnStartOfDay(tu), lt: vnAddDays(vnStartOfDay(new Date(den.getTime() - 1)), 1) });

type TrialRow = Prisma.TrialClassSessionGetPayload<{ select: typeof MUC_TRIAL_SELECT }>;
type CaseRow = Prisma.MakeupCaseGetPayload<{ select: typeof MUC_CASE_SELECT }>;

function mucTuTrial(r: TrialRow): MucLich | null {
  const k = khoangTuNgayGio(r.date, r.startTime, r.endTime);
  if (!k) return null; // giờ hỏng: không đoán, không chặn oan
  return {
    nguon: "TRIAL_CLASS_SESSION",
    id: r.id,
    tieuDe: r.trialClass.name,
    ...k,
    // Lớp cũ còn giữ GV/phòng ở CẤP LỚP (pha A của migration 28/08); buổi mới để null ở cấp lớp. Hiệu lực = buổi ?? lớp.
    teacherId: r.teacherId ?? r.trialClass.teacherId ?? null,
    roomId: r.roomId ?? r.trialClass.roomId ?? null,
    centerId: r.trialClass.centerId,
    classId: null,
  };
}

function mucTuCase(r: CaseRow): MucLich | null {
  const k = khoangTuNgayGio(r.date, r.startTime, r.endTime);
  if (!k) return null;
  return {
    nguon: "MAKEUP_CASE",
    id: r.id,
    tieuDe: "Case dạy bù",
    ...k,
    teacherId: r.teacherId,
    roomId: r.roomId,
    centerId: r.centerId,
    classId: null,
  };
}

function mucTuBuoiLop(rows: Prisma.ClassSessionGetPayload<{ select: typeof MUC_LOP_SELECT }>[]): MucLich[] {
  const slots = rowsToSlots(rows);
  return rows.map((r, i) => ({
    nguon: "CLASS_SESSION" as const,
    id: r.id,
    tieuDe: r.class?.name ?? "Lớp học",
    startAt: slots[i]!.startAt,
    endAt: slots[i]!.endAt,
    teacherId: slots[i]!.teacherId ?? null,
    roomId: slots[i]!.roomId ?? null,
    centerId: r.class?.centerId ?? null,
    classId: r.classId,
  }));
}

/**
 * ĐỌC các khoảng BẬN (theo GV/phòng) của cả ba nguồn trong [tu, den). Chỉ bản ghi còn sống: bỏ CANCELLED, bỏ lớp đã xoá mềm / lớp trial
 * đã huỷ. Trả TẤT CẢ trong các ngày VN chứa khoảng — phép so giờ chính xác là việc của `timXungDot`.
 */
export async function layMucLich(
  nguon: NguonDoc,
  p: { tu: Date; den: Date; centerId?: string | null; nguonLich?: readonly NguonLich[] },
): Promise<MucLich[]> {
  const dung = (n: NguonLich) => !p.nguonLich || p.nguonLich.includes(n);
  const [lop, trial, bu] = await Promise.all([
    dung("CLASS_SESSION")
      ? nguon.classSession.findMany({
          where: {
            status: { not: "CANCELLED" },
            date: khoangNgayTz(p.tu, p.den),
            class: { deletedAt: null, ...(p.centerId ? { centerId: p.centerId } : {}) },
          },
          select: MUC_LOP_SELECT,
        })
      : [],
    dung("TRIAL_CLASS_SESSION")
      ? nguon.trialClassSession.findMany({
          where: {
            status: { not: "CANCELLED" },
            date: khoangNgayDb(p.tu, p.den),
            trialClass: { status: { not: "CANCELLED" }, ...(p.centerId ? { centerId: p.centerId } : {}) },
          },
          select: MUC_TRIAL_SELECT,
        })
      : [],
    dung("MAKEUP_CASE")
      ? nguon.makeupCase.findMany({
          where: { status: { not: "CANCELLED" }, date: khoangNgayDb(p.tu, p.den), ...(p.centerId ? { centerId: p.centerId } : {}) },
          select: MUC_CASE_SELECT,
        })
      : [],
  ]);
  return [...mucTuBuoiLop(lop), ...trial.map(mucTuTrial), ...bu.map(mucTuCase)].filter((m): m is MucLich => m !== null);
}

/**
 * ĐỌC các khoảng bận của TỪNG HỌC VIÊN trong [tu, den) — BATCH, không N+1 (một lượt mỗi nguồn cho cả danh sách):
 *   · lớp chính — buổi của các lớp bé đang học (`rosterWhere("dang-hoc")`, cùng định nghĩa với checker TV-27);
 *   · case dạy bù — mục case còn PLACED/PRESENT (ABSENT = bé đã không tới, không còn chiếm giờ) của case chưa huỷ;
 *   · lớp trial — ghi danh ACTIVE của đứa trẻ nguồn (`Student.leadChildId`): buổi được chọn, hoặc cả lớp với lớp slot cũ.
 */
export async function layMucLichHocVien(
  nguon: NguonDoc,
  studentIds: readonly string[],
  p: { tu: Date; den: Date; /** Chỉ đọc các nguồn này (mặc định cả ba) — bớt truy vấn khi người gọi chỉ quan tâm một nguồn. */ nguonLich?: readonly NguonLich[] },
): Promise<MucLichHocVien[]> {
  const ids = [...new Set(studentIds)];
  if (ids.length === 0) return [];
  const ra: MucLichHocVien[] = [];
  const dung = (n: NguonLich) => !p.nguonLich || p.nguonLich.includes(n);

  const [ghiDanh, chiaCase, hocVien] = await Promise.all([
    dung("CLASS_SESSION")
      ? nguon.enrollment.findMany({
          where: { ...rosterWhere("dang-hoc"), studentId: { in: ids } },
          select: { studentId: true, classId: true },
        })
      : [],
    dung("MAKEUP_CASE")
      ? nguon.makeupCaseStudent.findMany({
          where: {
            status: { in: ["PLACED", "PRESENT"] },
            makeupNeed: { studentId: { in: ids } },
            case: { status: { not: "CANCELLED" }, date: khoangNgayDb(p.tu, p.den) },
          },
          select: { makeupNeed: { select: { studentId: true } }, case: { select: MUC_CASE_SELECT } },
        })
      : [],
    dung("TRIAL_CLASS_SESSION")
      ? nguon.student.findMany({ where: { id: { in: ids }, leadChildId: { not: null } }, select: { id: true, leadChildId: true } })
      : [],
  ]);

  // lớp chính
  const lopCuaBe = new Map<string, Set<string>>();
  for (const g of ghiDanh) (lopCuaBe.get(g.classId) ?? lopCuaBe.set(g.classId, new Set()).get(g.classId)!).add(g.studentId);
  if (lopCuaBe.size > 0) {
    const buoi = await nguon.classSession.findMany({
      where: {
        classId: { in: [...lopCuaBe.keys()] },
        status: { not: "CANCELLED" },
        date: khoangNgayTz(p.tu, p.den),
        class: { deletedAt: null },
      },
      select: MUC_LOP_SELECT,
    });
    for (const m of mucTuBuoiLop(buoi)) {
      for (const sid of lopCuaBe.get(m.classId!) ?? []) ra.push({ ...m, hocVienId: sid });
    }
  }
  // case dạy bù
  for (const c of chiaCase) {
    const m = mucTuCase(c.case);
    if (m) ra.push({ ...m, hocVienId: c.makeupNeed.studentId });
  }
  // lớp trial
  if (hocVien.length > 0) {
    const beCuaTre = new Map<string, string[]>();
    for (const h of hocVien) (beCuaTre.get(h.leadChildId!) ?? beCuaTre.set(h.leadChildId!, []).get(h.leadChildId!)!).push(h.id);
    const ghiDanhTrial = await nguon.trialEnrollment.findMany({
      where: { leadChildId: { in: [...beCuaTre.keys()] }, status: "ACTIVE", trialClass: { status: { not: "CANCELLED" } } },
      select: {
        leadChildId: true,
        scheduledSessionId: true,
        trialClass: {
          select: {
            name: true,
            centerId: true,
            roomId: true,
            teacherId: true,
            theoKhung: true,
            sessions: {
              where: { status: { not: "CANCELLED" }, date: khoangNgayDb(p.tu, p.den) },
              select: { id: true, date: true, startTime: true, endTime: true, roomId: true, teacherId: true },
            },
          },
        },
      },
    });
    for (const e of ghiDanhTrial) {
      for (const s of e.trialClass.sessions) {
        // Cùng luật "bé thuộc buổi nào" với `lib/trial/nghia-null.ts` (`thuocCase`): đã chọn buổi ⇒ đúng buổi đó; chưa chọn ⇒ chỉ lớp slot
        // cũ mới là "học cả lớp"; lớp theo khung mà chưa xếp case thì bé chưa chiếm giờ nào.
        const thuoc = e.scheduledSessionId === s.id || (e.scheduledSessionId === null && !e.trialClass.theoKhung);
        if (!thuoc) continue;
        const m = mucTuTrial({
          ...s,
          trialClass: { name: e.trialClass.name, centerId: e.trialClass.centerId, roomId: e.trialClass.roomId, teacherId: e.trialClass.teacherId },
        });
        if (!m) continue;
        for (const sid of beCuaTre.get(e.leadChildId) ?? []) ra.push({ ...m, hocVienId: sid });
      }
    }
  }
  return ra;
}

/**
 * HỌC VIÊN đang học (ghi danh còn hiệu lực) của một lớp — tập học viên XÁC ĐỊNH của mọi buổi lớp chính (cùng định nghĩa `rosterWhere("dang-hoc")`
 * với chiều học viên của lõi và checker TV-27). Một lượt cho cả lớp.
 */
export async function layHocVienDangHocCuaLop(nguon: Pick<NguonDoc, "enrollment">, classId: string): Promise<string[]> {
  const rows = await nguon.enrollment.findMany({
    where: { ...rosterWhere("dang-hoc"), classId },
    select: { studentId: true },
  });
  return [...new Set(rows.map((r) => r.studentId))];
}

/** Học viên (bản ghi `Student`) ứng với các đứa trẻ lead — qua `Student.leadChildId`. Đứa trẻ chưa thành học viên thì không có case dạy bù để va. */
export async function hocVienTuTre(nguon: Pick<NguonDoc, "student">, leadChildIds: readonly string[]): Promise<string[]> {
  const ids = [...new Set(leadChildIds)];
  if (ids.length === 0) return [];
  const rows = await nguon.student.findMany({ where: { leadChildId: { in: ids } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/**
 * Học viên THẬT SỰ thuộc một buổi/case trial — đúng luật `lib/trial/nghia-null.ts` (`thuocCase`), KHÔNG suy đoán:
 * ghi danh `ACTIVE` đã chọn đúng buổi này; hoặc chưa chọn buổi mà là lớp slot CŨ (học cả lớp). Lớp theo khung mà chưa xếp case thì chưa thuộc
 * buổi nào. Một lượt đọc cho cả buổi, rồi một lượt đổi sang học viên.
 */
export async function layHocVienCuaBuoiTrial(
  nguon: Pick<NguonDoc, "trialClassSession" | "trialEnrollment" | "student">,
  sessionId: string,
): Promise<string[]> {
  const ses = await nguon.trialClassSession.findUnique({
    where: { id: sessionId },
    select: { trialClassId: true, trialClass: { select: { theoKhung: true } } },
  });
  if (!ses) return [];
  const ghiDanh = await nguon.trialEnrollment.findMany({
    where: {
      trialClassId: ses.trialClassId,
      status: "ACTIVE",
      OR: [{ scheduledSessionId: sessionId }, ...(ses.trialClass.theoKhung ? [] : [{ scheduledSessionId: null }])],
    },
    select: { leadChildId: true },
  });
  return hocVienTuTre(nguon, ghiDanh.map((g) => g.leadChildId));
}

/** Khung giờ của yêu cầu: hoặc hai mốc thật, hoặc NGÀY VN + "HH:mm" (case dạy bù / buổi trial). */
export type KhungYeuCau = { startAt: Date; endAt: Date } | { ymd: string; startTime: string; endTime: string };

export function khungTuYeuCau(k: KhungYeuCau): { startAt: Date; endAt: Date } {
  const kq = "ymd" in k ? khoangTuNgayGio(ngayUtc(k.ymd), k.startTime, k.endTime) : k.endAt.getTime() - k.startAt.getTime() > 0 ? k : null; // độ dài dương — KHÔNG phải phép so trùng
  if (!kq) throw new RangeError("Khung giờ không hợp lệ (giờ kết thúc phải sau giờ bắt đầu)");
  return kq;
}

export type ThamSoKiemLich = {
  khung: KhungYeuCau;
  teacherId?: string | null;
  roomId?: string | null;
  /** Học viên cần kiểm (xếp case, thêm bé vào case). Bỏ trống ⇒ không kiểm chiều học viên. */
  studentIds?: readonly string[];
  /** Loại khỏi phép so — đang SỬA chính nó (xem `LoaiTru`). */
  exclude?: readonly LoaiTru[];
  /**
   * LỌC theo cơ sở (cả ba nguồn). Mặc định KHÔNG lọc: giáo viên và học viên là nguồn lực chung, có thể bận ở cơ sở khác — đó chính là
   * trùng thật. Chỉ truyền khi biết chắc muốn thu hẹp.
   */
  centerId?: string | null;
  /** Chỉ nhìn một số nguồn (mặc định cả ba). */
  nguon?: readonly NguonLich[];
  /**
   * Chỉ riêng chiều HỌC VIÊN nhìn các nguồn này (mặc định = `nguon`, tức cả ba). Đường lớp chính / trial truyền `["MAKEUP_CASE"]`: chúng phải
   * thấy case dạy bù của học viên (HB-28), nhưng KHÔNG nhân đó biến "một bé ghi danh hai lớp trùng giờ" (dữ liệu cũ có thật) thành lý do chặn
   * sửa buổi — đó là luật mới chưa ai chốt.
   */
  nguonHocVien?: readonly NguonLich[];
};

/**
 * KIỂM TRÙNG LỊCH — cửa DUY NHẤT (T09). Trả CẤU TRÚC (không chỉ boolean): từng trùng của giáo viên, của phòng, và theo TỪNG học viên.
 * Không có GV/phòng/học viên trong yêu cầu thì không có chiều đó (và không tốn câu truy vấn nào cho nó).
 *
 * ⚠️ Kiểm TRƯỚC transaction chưa đủ chống đua — đường GHI phải gọi lại trong transaction, ngay sau `khoaLichTrongTx`.
 * ⚠️ Đây là soát LỊCH (GV đã nhận việc khác chưa), KHÔNG phải điều kiện "GV có ca làm" (`lib/trial/gv-kha-dung.ts`) — hai câu hỏi khác nhau.
 */
export async function checkScheduleConflicts(p: ThamSoKiemLich, client: NguonDoc = db): Promise<KetQuaXungDot> {
  const coChieuGvPhong = Boolean(p.teacherId || p.roomId);
  const coChieuHocVien = (p.studentIds?.length ?? 0) > 0;
  if (!coChieuGvPhong && !coChieuHocVien) return KHONG_XUNG_DOT;
  const khung = khungTuYeuCau(p.khung);
  const nguonHv = p.nguonHocVien ?? p.nguon;
  const [muc, mucHocVien] = await Promise.all([
    coChieuGvPhong ? layMucLich(client, { tu: khung.startAt, den: khung.endAt, centerId: p.centerId, nguonLich: p.nguon }) : [],
    coChieuHocVien ? layMucLichHocVien(client, p.studentIds!, { tu: khung.startAt, den: khung.endAt, nguonLich: nguonHv }) : [],
  ]);
  return timXungDot(
    { muc, mucHocVien },
    { ...khung, teacherId: p.teacherId, roomId: p.roomId, studentIds: p.studentIds },
    p.exclude ?? [],
  );
}

/**
 * Khoá advisory HẸP cho đường GHI: mỗi (giáo viên | phòng | học viên) × NGÀY một khoá — hai người xếp cùng một GV/phòng/bé vào cùng ngày
 * xếp hàng, còn việc xếp lịch cho người khác/ngày khác KHÔNG chặn nhau (không serialize cả hệ thống). Thứ tự khoá được SẮP theo chuỗi khoá
 * nên hai lượt lấy các khoá chồng nhau không bao giờ vòng chờ. Gọi NGAY ĐẦU phần ghi của transaction, rồi `checkScheduleConflicts` lại.
 * PHẢI `$executeRaw`, không `$queryRaw`: `pg_advisory_xact_lock()` trả `void` (cùng bẫy `khoaDonTrongTx`).
 */
export async function khoaLichTrongTx(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  p: { khung: KhungYeuCau; teacherId?: string | null; roomId?: string | null; studentIds?: readonly string[] },
): Promise<void> {
  const k = khungTuYeuCau(p.khung);
  const ngays = [...new Set([vnYmd(k.startAt), vnYmd(new Date(k.endAt.getTime() - 1))])];
  const khoa: string[] = [];
  for (const ymd of ngays) {
    if (p.teacherId) khoa.push(`lich:gv:${p.teacherId}:${ymd}`);
    if (p.roomId) khoa.push(`lich:phong:${p.roomId}:${ymd}`);
    for (const sid of new Set(p.studentIds ?? [])) khoa.push(`lich:hv:${sid}:${ymd}`);
  }
  for (const key of [...new Set(khoa)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)`;
  }
}

/** Câu nói cụ thể cho từng trùng ("GV Nguyễn A đang có lớp Robotics 6A từ 18:00–19:30."). Tên tra thêm 1 lượt cho cả danh sách. */
export async function dungThongDiepXungDot(kq: KetQuaXungDot, tuyChon: { actor?: Actor } = {}): Promise<string[]> {
  if (!kq.coXungDot) return [];
  const gvIds = [...new Set(kq.teacherConflicts.map((x) => x.teacherId).filter((x): x is string => !!x))];
  const phongIds = [...new Set(kq.roomConflicts.map((x) => x.roomId).filter((x): x is string => !!x))];
  const hvIds = kq.studentConflicts.map((x) => x.studentId);
  const [gv, phong, hv] = await Promise.all([
    gvIds.length ? db.user.findMany({ where: { id: { in: gvIds } }, select: { id: true, name: true } }) : [],
    phongIds.length ? db.room.findMany({ where: { id: { in: phongIds } }, select: { id: true, name: true } }) : [],
    hvIds.length ? db.student.findMany({ where: { id: { in: hvIds } }, select: { id: true, name: true } }) : [],
  ]);
  const ten: TenThamChieu = {
    giaoVien: (id) => gv.find((x) => x.id === id)?.name ?? undefined,
    phong: (id) => phong.find((x) => x.id === id)?.name,
    hocVien: (id) => hv.find((x) => x.id === id)?.name,
  };
  // Không biết người xem ⇒ KHÔNG ẩn (người gọi đã được phép). Biết người xem ⇒ nguồn ở cơ sở họ không đọc được chỉ nói LOẠI việc.
  return dungThongDiep(kq, ten, tuyChon.actor ? anDanhTheoActor(tuyChon.actor) : undefined);
}

/**
 * "Nguồn này ở cơ sở người xem KHÔNG đọc được" — một định nghĩa cho câu nói lẫn kết quả cấu trúc. Dùng `passesScope` của chính `scopedDb`
 * (cùng ranh giới đọc dữ liệu), nên đổi cách phân quyền cơ sở thì đổi ở một nơi.
 */
export const anDanhTheoActor = (actor: Actor) => (centerId: string | null) => !passesScope("MakeupCase", { centerId }, actor);

/** Kết quả cấu trúc đã gỡ metadata ngoài tầm nhìn của `actor` — dùng khi đưa kết quả RA NGOÀI (lỗi, phản hồi). Phép kiểm vẫn chặn như thường. */
export const ketQuaAnToan = (kq: KetQuaXungDot, actor?: Actor): KetQuaXungDot => (actor ? anDanhKetQua(kq, anDanhTheoActor(actor)) : kq);

/**
 * Lỗi nghiệp vụ trùng lịch — ném TRONG transaction để rollback; người gọi dựng câu nói ở NGOÀI (`dungThongDiepXungDot`, có ẩn danh theo người
 * xem). `ketQua` là dữ liệu cấu trúc ĐẦY ĐỦ, chỉ để ở phía máy chủ — đưa ra ngoài phải qua `ketQuaAnToan`. `boiCanh` mang thêm ý nghĩa của yêu cầu
 * (vd. ngày của buổi thay thế) cho câu lỗi.
 */
export class LoiXungDotLich extends Error {
  constructor(
    message: string,
    readonly ketQua: KetQuaXungDot,
    readonly boiCanh: { buoiThayThe?: Date } = {},
  ) {
    super(message);
    this.name = "LoiXungDotLich";
  }
}

function ketQuaCu(kq: KetQuaXungDot): ConflictResult {
  return toResult({
    roomConflict: kq.roomConflicts.length > 0,
    teacherConflict: kq.teacherConflicts.length > 0,
    conflictIds: [...new Set([...kq.teacherConflicts, ...kq.roomConflicts].map((x) => x.id))],
    chiTiet: [...kq.teacherConflicts, ...kq.roomConflicts],
  });
}

/** Dò trùng cho 1 buổi candidate so với các buổi khác CÙNG NGÀY — bây giờ nhìn cả case dạy bù và buổi trial. */
export async function detectSessionConflicts(input: {
  sessionId?: string;
  /** Loại buổi của chính lớp này khỏi phép so (double-book chỉ tính giữa 2 lớp). */
  excludeClassId?: string | null;
  /** null = soát TOÀN HỆ THỐNG (GV có thể dạy 2 cơ sở → trùng liên cơ sở vẫn bắt). */
  centerId: string | null;
  roomId: string | null;
  teacherId: string | null;
  startAt: Date;
  endAt: Date;
}): Promise<ConflictResult> {
  if (!input.roomId && !input.teacherId) return EMPTY;
  const loaiTru: LoaiTru[] = [];
  if (input.sessionId) loaiTru.push({ type: "CLASS_SESSION", id: input.sessionId });
  if (input.excludeClassId) loaiTru.push({ type: "CLASS", id: input.excludeClassId });
  const kq = await checkScheduleConflicts({
    khung: { startAt: input.startAt, endAt: input.endAt },
    teacherId: input.teacherId,
    roomId: input.roomId,
    exclude: loaiTru,
    centerId: input.centerId,
  });
  return ketQuaCu(kq);
}

export type KetQuaKiemTrung = {
  /** Câu CHẶN — trùng do chính thao tác gây ra. null = cho qua. */
  loi: string | null;
  /** Trùng CÓ SẴN mà thao tác không chạm tới — báo, không chặn. */
  canhBao: string | null;
};

async function tenLopCuaBuoi(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.classSession.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, class: { select: { name: true } } },
  });
  return new Map(rows.map((r) => [r.id, r.class.name]));
}

/**
 * Kiểm trùng cho MỘT thao tác trên buổi (tạo / sửa / điều chỉnh / duyệt dạy thay) — chỗ
 * DUY NHẤT quyết định chặn hay chỉ cảnh báo, và chỗ duy nhất giữ câu "Trùng phòng" /
 * "Trùng lịch giáo viên" (trước 09/10 chép tay ở `lib/classes/adjust.ts` và
 * `app/(admin)/admin/sessions/_actions.ts`).
 *
 * Chặn hay không do `phamViKiemTrung` quyết (chỉ chặn vì thứ thao tác làm đổi). Phòng và
 * GV dò RIÊNG từng tài nguyên để câu báo nêu đúng lớp đang chiếm tài nguyên đó.
 */
export async function kiemTrungThaoTacBuoi(input: {
  sessionId?: string;
  classId: string;
  /** Phòng/GV hiệu lực TRƯỚC thao tác. null = buổi mới. */
  truoc: TaiNguyenBuoi | null;
  sau: TaiNguyenBuoi;
  doiGio: boolean;
  startAt: Date;
  endAt: Date;
}): Promise<KetQuaKiemTrung> {
  const pv = phamViKiemTrung(input);
  const chung = {
    sessionId: input.sessionId,
    excludeClassId: input.classId,
    centerId: null, // soát toàn hệ thống: GV có thể dạy 2 cơ sở
    startAt: input.startAt,
    endAt: input.endAt,
  };
  const [gv, phong] = await Promise.all([
    input.sau.teacherId
      ? detectSessionConflicts({ ...chung, teacherId: input.sau.teacherId, roomId: null })
      : EMPTY,
    input.sau.roomId
      ? detectSessionConflicts({ ...chung, teacherId: null, roomId: input.sau.roomId })
      : EMPTY,
  ]);
  const ten = await tenLopCuaBuoi([...gv.conflictIds, ...phong.conflictIds]);
  const lop = (ids: string[]) => {
    const ds = [...new Set(ids.map((id) => ten.get(id)).filter((x): x is string => !!x))];
    return ds.length > 0 ? ds.join(", ") : "khác";
  };

  if (gv.teacherConflict && pv.chanGv) {
    return { loi: `Trùng lịch giáo viên: GV đã có buổi dạy lớp ${lop(gv.conflictIds)} vào khung giờ này.`, canhBao: null };
  }
  if (phong.roomConflict && pv.chanPhong) {
    return { loi: `Trùng phòng: phòng đã được lớp ${lop(phong.conflictIds)} sử dụng vào khung giờ này.`, canhBao: null };
  }
  const coSan: string[] = [];
  if (gv.teacherConflict) coSan.push(`GV đang trùng lịch với lớp ${lop(gv.conflictIds)}`);
  if (phong.roomConflict) coSan.push(`phòng đang trùng với lớp ${lop(phong.conflictIds)}`);
  return {
    loi: null,
    canhBao:
      coSan.length > 0
        ? `Lưu ý: ${coSan.join("; ")} — trùng có từ trước, thao tác này không đổi nó; cần xếp lại lịch.`
        : null,
  };
}

/**
 * Dò trùng cho 1 LOẠT ngày (sinh buổi / dời cả lớp hàng loạt). 1 lượt đọc cho cả khoảng ngày (cả ba nguồn), rồi so in-memory từng ngày
 * candidate bằng CHÍNH `timXungDot`. Trả danh sách ngày trùng + thông điệp (caller quyết định WARN hay BLOCK).
 */
export async function detectBatchConflicts(input: {
  centerId: string | null;
  excludeClassId?: string | null;
  /** Buổi của chính lớp đang dời — loại khỏi phép so (đang được gán ngày mới). */
  excludeSessionIds?: string[];
  classStartTime: string | null;
  classEndTime: string | null;
  roomId: string | null;
  teacherId: string | null;
  dates: Date[];
  /**
   * Lớp có các buổi đang được xếp/dời: học viên ĐANG HỌC của lớp được kiểm với CASE DẠY BÙ của chính họ (T09-F1). Vẫn là CẢNH BÁO — hàm này
   * không chặn ai; người gọi quyết định. Bỏ trống ⇒ không có chiều học viên.
   */
  hocVienCuaLop?: string | null;
}): Promise<{ date: Date; messages: string[] }[]> {
  if (input.dates.length === 0) return [];
  const studentIds = input.hocVienCuaLop ? await layHocVienDangHocCuaLop(db, input.hocVienCuaLop) : [];
  if (!input.roomId && !input.teacherId && studentIds.length === 0) return [];
  const khungs = input.dates.map((d) => ({ d, ...sessionWindow(d, input.classStartTime, input.classEndTime) }));
  const tu = new Date(Math.min(...khungs.map((k) => k.startAt.getTime())));
  const den = new Date(Math.max(...khungs.map((k) => k.endAt.getTime())));
  const coGvPhong = Boolean(input.roomId || input.teacherId);
  const [muc, mucHocVien] = await Promise.all([
    coGvPhong ? layMucLich(db, { tu, den, centerId: input.centerId }) : [],
    studentIds.length > 0 ? layMucLichHocVien(db, studentIds, { tu, den, nguonLich: ["MAKEUP_CASE"] }) : [],
  ]);

  const loaiTru: LoaiTru[] = (input.excludeSessionIds ?? []).map((id) => ({ type: "CLASS_SESSION" as const, id }));
  if (input.excludeClassId) loaiTru.push({ type: "CLASS", id: input.excludeClassId });

  const out: { date: Date; messages: string[] }[] = [];
  for (const k of khungs) {
    const kq = timXungDot(
      { muc, mucHocVien },
      { startAt: k.startAt, endAt: k.endAt, teacherId: input.teacherId, roomId: input.roomId, studentIds },
      loaiTru,
    );
    const r = ketQuaCu(kq);
    const messages = [...r.messages];
    if (kq.studentConflicts.length > 0) {
      messages.push(`Trùng lịch ${kq.studentConflicts.length} học viên với case học bù cùng giờ`);
    }
    if (messages.length > 0) out.push({ date: k.d, messages });
  }
  return out;
}

/**
 * T4.1 — dò trùng cho 1 buổi ĐÃ TỒN TẠI (dùng khi xếp học bù: buổi đích thuộc lớp
 * khác, có thể khác cơ sở). Buổi không tồn tại / thiếu dữ liệu → không kết luận trùng.
 */
export async function detectConflictsForExistingSession(
  sessionId: string,
): Promise<ConflictResult> {
  const s = await db.classSession.findUnique({
    where: { id: sessionId },
    select: { ...SESSION_SELECT, classId: true },
  });
  if (!s?.class?.startTime) return EMPTY;

  const [slot] = rowsToSlots([s]);
  if (!slot) return EMPTY;

  return detectSessionConflicts({
    sessionId: s.id,
    excludeClassId: s.classId,
    centerId: null,
    roomId: slot.roomId ?? null,
    teacherId: slot.teacherId ?? null,
    startAt: slot.startAt,
    endAt: slot.endAt,
  });
}
