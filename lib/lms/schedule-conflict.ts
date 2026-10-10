import "server-only";
import { db } from "@/lib/db";
import {
  detectScheduleConflict,
  phamViKiemTrung,
  type Slot,
  type TaiNguyenBuoi,
} from "@/lib/lms/scheduling";
import { vnAddDays, vnDateAt, vnParts, vnStartOfDay } from "@/lib/time/vn";

// =============================================================================
// LMS-6 — nối detectScheduleConflict vào write-path: 1 buổi candidate có trùng
// PHÒNG / GIÁO VIÊN với buổi khác cùng ngày không.
//   • cửa sổ buổi = [date, date + (endTime-startTime của lớp)] (fallback 90').
//   • phòng/GV hiệu lực của buổi ĐỐI CHIẾU = substitute ?? actual ?? cấp buổi ?? lớp.
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
};

const EMPTY: ConflictResult = {
  roomConflict: false,
  teacherConflict: false,
  conflictIds: [],
  messages: [],
};

function toResult(r: {
  roomConflict: boolean;
  teacherConflict: boolean;
  conflictIds: string[];
}): ConflictResult {
  const messages: string[] = [];
  if (r.roomConflict) messages.push("Trùng phòng với buổi khác cùng giờ");
  if (r.teacherConflict) messages.push("Trùng giáo viên với buổi khác cùng giờ");
  return { ...r, messages };
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

/**
 * WHERE cho các buổi "đối chiếu": bỏ buổi đã huỷ, bỏ lớp đã xoá mềm, tuỳ chọn giới
 * hạn theo cơ sở, và LOẠI buổi của chính lớp đang xét (`excludeClassId`) — double-book
 * chỉ có nghĩa GIỮA 2 LỚP; buổi cùng lớp dùng chung phòng/GV là bình thường.
 */
function othersWhere(opts: {
  centerId?: string | null;
  excludeClassId?: string | null;
  excludeSessionId?: string | null;
}) {
  return {
    status: { not: "CANCELLED" as const },
    ...(opts.excludeSessionId ? { id: { not: opts.excludeSessionId } } : {}),
    ...(opts.excludeClassId ? { classId: { not: opts.excludeClassId } } : {}),
    class: {
      deletedAt: null,
      ...(opts.centerId ? { centerId: opts.centerId } : {}),
    },
  };
}

/** Dò trùng cho 1 buổi candidate so với các buổi khác CÙNG NGÀY. */
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
  // Khung NGÀY phải theo đồng hồ VN. Bản cũ dùng `new Date(y,m,d)` = ngày theo TZ
  // máy chạy: trên Vercel (UTC) một buổi 00:00 VN lưu là 17:00Z HÔM TRƯỚC ⇒ lấy
  // nhầm sang tập buổi của ngày khác, vừa bỏ sót trùng thật vừa bắt trùng oan.
  const dayStart = vnStartOfDay(input.startAt);
  const dayEnd = vnAddDays(dayStart, 1);

  const others = await db.classSession.findMany({
    where: {
      ...othersWhere({
        centerId: input.centerId,
        excludeClassId: input.excludeClassId,
        excludeSessionId: input.sessionId,
      }),
      date: { gte: dayStart, lt: dayEnd },
    },
    select: SESSION_SELECT,
  });

  const res = detectScheduleConflict(rowsToSlots(others), {
    id: input.sessionId,
    roomId: input.roomId,
    teacherId: input.teacherId,
    startAt: input.startAt,
    endAt: input.endAt,
  });
  return toResult(res);
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
 * Dò trùng cho 1 LOẠT ngày (sinh buổi / dời cả lớp hàng loạt). 1 query lấy buổi hiện
 * có trong khoảng ngày, rồi kiểm tra in-memory từng ngày candidate. Trả về danh sách
 * ngày trùng + thông điệp (caller quyết định WARN hay BLOCK).
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
}): Promise<{ date: Date; messages: string[] }[]> {
  if ((!input.roomId && !input.teacherId) || input.dates.length === 0) return [];
  const times = input.dates.map((d) => d.getTime());
  const minDay = new Date(Math.min(...times));
  const maxDay = new Date(Math.max(...times));
  const rangeStart = new Date(minDay.getFullYear(), minDay.getMonth(), minDay.getDate());
  const rangeEnd = new Date(
    maxDay.getFullYear(),
    maxDay.getMonth(),
    maxDay.getDate() + 1,
  );

  const skip = new Set(input.excludeSessionIds ?? []);
  const others = await db.classSession.findMany({
    where: {
      ...othersWhere({ centerId: input.centerId, excludeClassId: input.excludeClassId }),
      date: { gte: rangeStart, lt: rangeEnd },
    },
    select: SESSION_SELECT,
  });
  const slots = rowsToSlots(others.filter((o) => !skip.has(o.id)));

  const out: { date: Date; messages: string[] }[] = [];
  for (const d of input.dates) {
    const win = sessionWindow(d, input.classStartTime, input.classEndTime);
    const res = detectScheduleConflict(slots, {
      roomId: input.roomId,
      teacherId: input.teacherId,
      startAt: win.startAt,
      endAt: win.endAt,
    });
    if (res.roomConflict || res.teacherConflict) {
      out.push({ date: d, messages: toResult(res).messages });
    }
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
