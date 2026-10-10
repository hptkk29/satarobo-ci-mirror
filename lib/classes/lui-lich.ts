/**
 * lib/classes/lui-lich.ts — LÙI LỊCH MỘT LỚP MỘT NHỊP quanh những ngày lớp không học.
 *
 * Hai thao tác (chủ dự án 27/09/2026):
 *   · `luiLichLop` — Ngày NGHỈ TRUNG TÂM (`Holiday`, `lib/holidays/apply.ts`): cả trung tâm
 *     nghỉ, chấm công đọc nó. Chỉ buổi TƯƠNG LAI ⇒ dời NGÀY (chính dòng Holiday giữ ngày đó).
 *   · `nghiBuoiLop` — Nghỉ RIÊNG MỘT LỚP (nút "Nghỉ & lùi lịch"): trung tâm vẫn làm, chỉ lớp
 *     này nghỉ. Áp được cả buổi ĐÃ QUA ⇒ KHÔNG dời ngày (buổi sau có thể đã điểm danh — ngày
 *     điểm danh là sự thật) mà LÙI NỘI DUNG BÀI một buổi (`./lui-bai.ts`). Buổi nghỉ thành
 *     "Đã huỷ" ghi lý do — bộ xếp lại buổi coi nó là đã khoá, rà lịch coi ngày đó là ngày
 *     không học ⇒ lần sửa lịch sau không kéo buổi về. KHÔNG tạo Holiday.
 *
 * Phần tính ngày là hàm thuần `cuonChieuBuoi` (`lib/holidays/cuon-chieu.ts`): buổi chưa khoá
 * lấy ngày của buổi kế tiếp, buổi cuối nhận ngày học mới; buổi đã có dữ liệu giữ ngày; bài
 * đi theo buổi nên thứ tự giáo trình không đổi.
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { SchedulePhase } from "@/lib/classes/phases";
import { findLockedSessions } from "@/lib/classes/phases-service";
import { expandHolidaySet } from "@/lib/classes/schedule";
import { logClassAudit } from "@/lib/audit/log";
import { publishEvent } from "@/lib/events/publish";
import { cuonChieuBuoi, ngayHocMoi, type DoiBuoi } from "@/lib/holidays/cuon-chieu";
import { keHoachLuiBai } from "./lui-bai";
import { suyThuHopLe } from "@/lib/holidays/thu-hop-le";
import { vnDateOnly, vnStartOfDay, vnWeekday, vnYmd } from "@/lib/time/vn";

export type KetQuaLuiLich = {
  moves: DoiBuoi[];
  /** Ngày buổi cuối mới (null khi không dời gì). */
  cuoiMoi: Date | null;
};

export async function luiLichLop(input: {
  classId: string;
  /** Khoá "YYYY-MM-DD" (lịch VN) — ngày lớp này KHÔNG học lần này. */
  ngayNghi: ReadonlySet<string>;
  actor: { id: string | null; name: string };
  lyDo: string;
}): Promise<KetQuaLuiLich> {
  const rong: KetQuaLuiLich = { moves: [], cuoiMoi: null };
  const lop = await db.class.findFirst({
    where: { id: input.classId, deletedAt: null },
    select: {
      id: true,
      centerId: true,
      scheduleDays: true,
      schedulePhases: {
        orderBy: { effectiveFrom: "asc" },
        select: {
          effectiveFrom: true,
          effectiveTo: true,
          slots: { select: { weekday: true, startTime: true, endTime: true } },
        },
      },
    },
  });
  if (!lop) return rong;

  const phases: SchedulePhase[] = lop.schedulePhases
    .map((p) => ({ effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo, slots: p.slots }))
    .filter((p) => p.slots.length > 0);

  // Ngày lớp không học = ngày nghỉ lần này + ngày nghỉ trung tâm (toàn hệ thống + cùng cơ sở)
  // + ngày đã có buổi huỷ — buổi dời không được rơi vào đó.
  const [holidayRows, tatCaBuoi] = await Promise.all([
    db.holiday.findMany({
      where: { OR: [{ centerId: null }, ...(lop.centerId ? [{ centerId: lop.centerId }] : [])] },
      select: { date: true, endDate: true },
    }),
    db.classSession.findMany({
      where: { classId: input.classId },
      select: { id: true, date: true, status: true },
    }),
  ]);
  const ngayNghi = new Set<string>([...input.ngayNghi, ...expandHolidaySet(holidayRows)]);

  // Chỉ xét từ HÔM NAY: buổi đã qua là lịch sử, không cuốn theo.
  const homNay = vnStartOfDay(new Date());
  const tuHomNay = tatCaBuoi.filter((b) => b.date >= homNay);
  const khoa = await findLockedSessions(
    tuHomNay.map((b) => b.id),
    new Map(tuHomNay.map((b) => [b.id, b.status as string])),
  );
  const buoiTrenNgayNghi = tuHomNay.filter(
    (b) => !khoa.has(b.id) && input.ngayNghi.has(vnYmd(b.date)),
  );
  if (buoiTrenNgayNghi.length === 0) return rong;

  const moves = cuonChieuBuoi({
    buoi: tuHomNay.map((b) => ({ id: b.id, date: b.date, khoa: khoa.has(b.id) })),
    ngayNghi,
    thuHopLe: suyThuHopLe(
      lop.scheduleDays,
      tatCaBuoi.filter((b) => b.status !== "CANCELLED").map((b) => vnWeekday(b.date)),
      vnWeekday(buoiTrenNgayNghi[0]!.date),
    ),
    phases,
  });
  if (moves.length === 0) return rong;

  const cuoiMoi = moves.reduce((a, m) => (m.newDate > a ? m.newDate : a), moves[0]!.newDate);
  await db.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    for (const m of moves) {
      await tx.classSession.update({ where: { id: m.id }, data: { date: m.newDate } });
    }
    const hienTai = await tx.class.findUnique({
      where: { id: input.classId },
      select: { endDate: true },
    });
    if (hienTai?.endDate && vnYmd(cuoiMoi) > vnYmd(hienTai.endDate)) {
      await tx.class.update({ where: { id: input.classId }, data: { endDate: vnDateOnly(cuoiMoi) } });
    }
    await logClassAudit({
      classId: input.classId,
      action: "UPDATE",
      actorId: input.actor.id,
      actorName: input.actor.name,
      oldValues: { sessions: moves.map((m) => ({ id: m.id, date: vnYmd(m.oldDate) })) },
      newValues: {
        sessions: moves.map((m) => ({ id: m.id, date: vnYmd(m.newDate) })),
        ngayNghi: [...input.ngayNghi],
      },
      changedFields: ["sessions.date", "endDate"],
      reason: `${input.lyDo} — lùi lịch một nhịp`,
      tx,
    });
    // Một event cho cả lô — đừng bắn mỗi buổi một tin cho phụ huynh.
    await publishEvent(
      "class.session_changed",
      { classId: input.classId, change: "RESCHEDULED", count: moves.length },
      { tx },
    );
  });

  return { moves, cuoiMoi };
}

/** Lỗi nghiệp vụ của "Nghỉ & lùi lịch" — câu nói được thẳng với người dùng. */
export class LoiNghiBuoi extends Error {}

/**
 * "Nghỉ & lùi lịch" theo LỚP — buổi `sessionId` thành "Đã huỷ", NỘI DUNG BÀI của nó và mọi
 * buổi sau lùi một buổi, cuối khoá thêm một buổi mang bài cuối. Áp được cả buổi ĐÃ QUA.
 * Ngày, điểm danh, nhận xét, giáo viên/phòng thực dạy của mọi buổi GIỮ NGUYÊN.
 *
 * Chặn: buổi nghỉ đã có dữ liệu (điểm danh / nhận xét / bài tập / ảnh / hoàn tất) — lớp đã
 * học buổi đó thì không phải buổi nghỉ.
 */
export async function nghiBuoiLop(input: {
  sessionId: string;
  actor: { id: string | null; name: string };
  lyDo: string;
}): Promise<{ doiNoiDung: number; buoiMoiNgay: Date }> {
  const s0 = await db.classSession.findUnique({
    where: { id: input.sessionId },
    select: { id: true, classId: true, date: true, status: true },
  });
  if (!s0) throw new LoiNghiBuoi("Buổi học không tồn tại.");
  if (s0.status === "CANCELLED") throw new LoiNghiBuoi("Buổi này đã huỷ trước đó.");
  const khoaS0 = await findLockedSessions([s0.id], new Map([[s0.id, s0.status as string]]));
  const vi = khoaS0.get(s0.id);
  if (vi) throw new LoiNghiBuoi(`Buổi ${vi} — lớp đã học buổi này, không cho nghỉ.`);

  const lop = await db.class.findFirst({
    where: { id: s0.classId, deletedAt: null },
    select: {
      centerId: true,
      scheduleDays: true,
      schedulePhases: {
        orderBy: { effectiveFrom: "asc" },
        select: {
          effectiveFrom: true,
          effectiveTo: true,
          slots: { select: { weekday: true, startTime: true, endTime: true } },
        },
      },
    },
  });
  if (!lop) throw new LoiNghiBuoi("Lớp không tồn tại.");

  const [tatCa, holidayRows] = await Promise.all([
    db.classSession.findMany({
      where: { classId: s0.classId },
      select: {
        id: true,
        date: true,
        status: true,
        roomId: true,
        planId: true,
        lessonId: true,
        topic: true,
        lessonNotes: true,
        sessionCategoryId: true,
      },
    }),
    db.holiday.findMany({
      where: { OR: [{ centerId: null }, ...(lop.centerId ? [{ centerId: lop.centerId }] : [])] },
      select: { date: true, endDate: true },
    }),
  ]);

  const kh = keHoachLuiBai({
    buoi: tatCa.map((b) => ({
      id: b.id,
      date: b.date,
      huy: b.status === "CANCELLED",
      noiDung: {
        planId: b.planId,
        lessonId: b.lessonId,
        topic: b.topic,
        lessonNotes: b.lessonNotes,
        sessionCategoryId: b.sessionCategoryId,
      },
    })),
    buoiNghiId: s0.id,
  });

  // Ngày cho buổi mới ở cuối: né ngày nghỉ trung tâm + ngày có buổi huỷ (kể cả buổi vừa nghỉ).
  const ngayNghi = new Set<string>(expandHolidaySet(holidayRows));
  for (const b of tatCa) if (b.status === "CANCELLED") ngayNghi.add(vnYmd(b.date));
  ngayNghi.add(vnYmd(s0.date));
  const phases: SchedulePhase[] = lop.schedulePhases
    .map((p) => ({ effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo, slots: p.slots }))
    .filter((p) => p.slots.length > 0);
  const song = tatCa.filter((b) => b.status !== "CANCELLED");
  const [ngayMoi] = ngayHocMoi({
    lichCu: tatCa.map((b) => b.date),
    soNgay: 1,
    ngayNghi,
    thuHopLe: suyThuHopLe(lop.scheduleDays, song.map((b) => vnWeekday(b.date)), vnWeekday(s0.date)),
    phases,
  });
  if (!ngayMoi) throw new LoiNghiBuoi("Không tìm được ngày học mới ở cuối khoá trong 400 ngày tới.");
  const cuoiCu = song.reduce((a, b) => (b.date > a.date ? b : a), song[0]!);

  await db.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    // Cổng đứng TRƯỚC phép ghi đầu tiên (luật rollback): đọc lại khoá trong giao dịch.
    const hienTai = await tx.classSession.findUnique({ where: { id: s0.id }, select: { status: true } });
    if (hienTai?.status !== s0.status) throw new LoiNghiBuoi("Buổi vừa đổi trạng thái — tải lại trang.");

    await tx.classSession.update({
      where: { id: s0.id },
      data: {
        status: "CANCELLED",
        topic: `Lớp nghỉ — ${input.lyDo}`,
        planId: null,
        lessonId: null,
        lessonNotes: null,
        sessionCategoryId: null,
      },
    });
    for (const d of kh.doiNoiDung) {
      await tx.classSession.update({ where: { id: d.id }, data: d.noiDung });
    }
    await tx.classSession.create({
      data: {
        classId: s0.classId,
        date: ngayMoi,
        status: "SCHEDULED",
        ...kh.noiDungBuoiMoi,
        roomId: cuoiCu.roomId,
        centerId: lop.centerId, // SCOPED_MODELS — quên là buổi vô hình với người cấp cơ sở
      },
    });
    const lopHienTai = await tx.class.findUnique({ where: { id: s0.classId }, select: { endDate: true } });
    if (lopHienTai?.endDate && vnYmd(ngayMoi) > vnYmd(lopHienTai.endDate)) {
      await tx.class.update({ where: { id: s0.classId }, data: { endDate: vnDateOnly(ngayMoi) } });
    }
    await logClassAudit({
      classId: s0.classId,
      action: "UPDATE",
      actorId: input.actor.id,
      actorName: input.actor.name,
      oldValues: { buoiNghi: { id: s0.id, date: vnYmd(s0.date) } },
      newValues: {
        luiBai: kh.doiNoiDung.map((d) => ({ id: d.id, topic: d.noiDung.topic })),
        buoiMoi: { date: vnYmd(ngayMoi), topic: kh.noiDungBuoiMoi.topic },
      },
      changedFields: ["sessions.status", "sessions.lesson", "endDate"],
      reason: `${input.lyDo} — lớp nghỉ, lùi bài một buổi`,
      tx,
    });
    await publishEvent(
      "class.session_changed",
      { classId: s0.classId, sessionId: s0.id, change: "CANCELLED", count: kh.doiNoiDung.length + 1 },
      { tx },
    );
  });

  return { doiNoiDung: kh.doiNoiDung.length, buoiMoiNgay: ngayMoi };
}
