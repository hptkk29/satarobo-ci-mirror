// lib/cham-cong/recompute.ts — cầu DB cho engine: đọc ca + lượt + lễ + tham số → computeDay →
// upsert StaffAttendanceDay. ĐƯỜNG GHI DUY NHẤT vào bảng công ngày (kế hoạch §3.1): mọi chỗ
// khác chỉ được gọi `markAttendanceDayDirty()` để hàng đợi DomainEvent tính lại.
//
// Luật:
//  - Ngày thuộc kỳ LOCKED hoặc dòng đã LOCKED ⇒ bỏ qua, trả `skipped: "LOCKED"` (audit ở
//    tầng gọi khi cần). Sửa sau khoá chỉ qua TIMESHEET_FIX được duyệt + mở lại kỳ.
//  - Người `timesheetExempt` ⇒ không sinh dòng; dòng cũ (chưa khoá) bị xoá.
//  - `overrideUnits` (QLCS đã rà và ghi đè) được GIỮ qua mọi lần tính lại; status ADJUSTED.
//  - Chỉ lượt CÒN TÍNH vào engine: `result = ACCEPTED` và `reviewStatus ≠ DISMISSED` (lượt đã
//    bị ghi đè bằng chỉnh tay — 06/10/2026). Helper `acceptedLogsOfDay`, có test.
//  - Ngày công tính theo giờ VN (`lib/time/vn.ts`); `workDate` là DATE-only UTC-midnight.
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings/service";
import { vnDateAt, vnParts, vnWeekday, vnYmd } from "@/lib/time/vn";
import {
  computeDay,
  ketQuaNgayChuaDienRa,
  type EngineAssignment,
  type EngineLog,
  type EngineRules,
} from "./engine";
import { resolveHomeCenter } from "./home-center";
import { noiChiuCongCuaNgay } from "./noi-chiu-cong";
import { orgUnitIdForCenter } from "../org/org-service";
import { LUOT_CON_TINH } from "./sua-gio-quet";
import { dungNguCanhDon } from "./don-trong-ngay";
import { ngayLeCuaNgay } from "./ngay-le-db";
import { doiChieuQuyTuCong, NGUON_QUY, type KetQuaDoiChieu } from "./nghi-bu";
import { writeAudit } from "@/lib/audit/audit-log";
import { docDonHieuLucNgay } from "./don-trong-ngay-db";
import type { ShiftSegment } from "./catalog";

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * Chỉ lượt CÒN TÍNH (ACCEPTED và chưa bị thay bằng chỉnh tay), sắp theo giờ — mọi câu tính
 * công đi qua đây. Lượt `DISMISSED` (đã được ghi đè bởi quản lý / đơn chỉnh công đủ bộ mốc,
 * chốt 06/10/2026) vẫn nằm trong DB để xem lại nhưng KHÔNG vào engine — xem `LUOT_CON_TINH`.
 */
export async function acceptedLogsOfDay(client: Client, userId: string, workDate: Date) {
  return client.staffTimeLog.findMany({
    where: { userId, workDate, ...LUOT_CON_TINH },
    orderBy: { loggedAt: "asc" },
    select: { id: true, loggedAt: true, direction: true, flags: true, centerId: true, orgUnitId: true },
  });
}

/** Phút VN trong ngày của một mốc thời gian (lượt lúc 00:30 ngày sau vẫn thuộc ngày sau — GC-09). */
export function vnMinuteOfDay(d: Date): number {
  const p = vnParts(d);
  return p.hour * 60 + p.minute;
}

export async function loadEngineRules(orgUnitId: string | null): Promise<EngineRules> {
  const o = { orgUnitId };
  const [lateGraceMinutes, earlyArrivalMinutes, duplicateTapMinutes, maxLogsPerDay, pairingMaxGapMinutes, otRoundingMinutes] = await Promise.all([
    getSetting("shift.lateGraceMinutes", o),
    getSetting("shift.earlyArrivalMinutes", o),
    getSetting("shift.duplicateTapMinutes", o),
    getSetting("shift.maxLogsPerDay", o),
    getSetting("shift.pairingMaxGapMinutes", o),
    getSetting("shift.otLamTronPhut", o),
  ]);
  const congTacDuCong = (await getSetting("shift.congTacCheDo", o)) === "DU_CONG";
  return { lateGraceMinutes, earlyArrivalMinutes, duplicateTapMinutes, maxLogsPerDay, pairingMaxGapMinutes, otRoundingMinutes, congTacDuCong };
}

export type RecomputeResult =
  | { ok: true; skipped?: undefined; dayId: string | null; flags: string[] }
  | { ok: true; skipped: "LOCKED" | "EXEMPT" | "NO_USER" };

export async function recomputeAttendanceDay(
  userId: string,
  workDate: Date,
  /**
   * `now` — mốc "bây giờ" để biết `workDate` đã tới chưa. Mặc định đồng hồ thật.
   *
   * Có tham số này vì test KHÔNG được đọc đồng hồ (luật 19): ngày tuyệt đối trong fixture +
   * một hàm rơi về `new Date()` = ca hẹn giờ nổ, mã không đổi mà tờ lịch đổi. Hàm đã có
   * `now` thì ca test PHẢI truyền.
   */
  opts: { tx?: Prisma.TransactionClient; now?: Date } = {},
): Promise<RecomputeResult> {
  const client: Client = opts.tx ?? db;
  const home = await resolveHomeCenter(userId);
  const existing = await client.staffAttendanceDay.findUnique({
    where: { userId_workDate: { userId, workDate } },
    select: { id: true, status: true, overrideUnits: true, overrideById: true, overrideAt: true, overrideNote: true, periodId: true, flags: true },
  });
  if (existing?.status === "LOCKED") return { ok: true, skipped: "LOCKED" };

  if (home.timesheetExempt) {
    if (existing) await client.staffAttendanceDay.delete({ where: { id: existing.id } });
    return { ok: true, skipped: "EXEMPT" };
  }

  const assignment = await client.shiftAssignment.findFirst({
    where: { userId, workDate, status: "ACTIVE" },
    select: {
      id: true,
      centerId: true,
      orgUnitId: true,
      templateCode: true,
      segments: true,
      attendanceMode: true,
      soCapQuetKyVong: true,
      dayCredit: true,
      isLeave: true,
      nominalMinutes: true,
      placeMode: true,
      template: { select: { kind: true } },
    },
  });
  const logs = await acceptedLogsOfDay(client, userId, workDate);
  // 🔴 Vá 13/09/2026 — NƠI CHỊU CÔNG là nơi TRỰC THUỘC / được xếp ca, KHÔNG phải nơi quét.
  // Bản cũ: `?? logs[0]?.centerId ??` chen NƠI QUÉT vào giữa, nên ngày KHÔNG có ca xếp thì
  // công của người Hội sở rơi vào cơ sở họ vừa ghé. Vế ấy chưa bao giờ cần: `resolveHomeCenter`
  // luôn trả về một centerId. Luật + ca test ở `noi-chiu-cong.ts`.
  const centerId = noiChiuCongCuaNgay({
    centerIdCaDuocXep: assignment?.centerId ?? null,
    centerIdNha: home.centerId,
  });
  // `orgUnitId` phải theo CÙNG nguồn với `centerId` — nó là thứ `loadEngineRules` và
  // `getSetting("shift.weeklyOffDays")` đọc, nên lấy theo nơi quét là tính ngày công của
  // người này bằng tham số vận hành của cơ sở khác. (Trả `null` cho Center("hoi-so") mồ côi
  // là ĐÚNG: rơi về tham số toàn hệ thống, không mượn của ai.)
  const orgUnitId = assignment?.orgUnitId ?? (await orgUnitIdForCenter(centerId));

  // Kỳ đã khoá ⇒ không tính lại (kể cả khi chưa có dòng — dòng mới sau khoá là sai).
  const periodKey = vnYmd(vnDateAt(workDate.getUTCFullYear(), workDate.getUTCMonth(), workDate.getUTCDate())).slice(0, 7);
  const period = await client.attendancePeriod.findUnique({
    where: { centerId_periodKey: { centerId, periodKey } },
    select: { id: true, status: true },
  });
  if (period?.status === "LOCKED") return { ok: true, skipped: "LOCKED" };

  // Lễ: một chỗ cho tính công và cổng duyệt đơn (`ngay-le-db.ts`).
  const holiday = await ngayLeCuaNgay(client, centerId, workDate);

  const rules = await loadEngineRules(orgUnitId);
  const weeklyOff = await getSetting("shift.weeklyOffDays", { orgUnitId });

  const engineAssignment: EngineAssignment | null = assignment
    ? {
        templateCode: assignment.templateCode,
        segments: ((assignment.segments as ShiftSegment[] | null) ?? []).map((s) => ({ start: s.start, end: s.end, kind: s.kind, place: s.place })),
        attendanceMode: assignment.attendanceMode,
        // Ép về 0|1|2: cột DB là `Int` nên Prisma trả `number`. Giá trị lạ (ai đó gõ tay
        // vào DB) rơi về 1 — chiều FAIL-CLOSED, cùng lý do với DEFAULT của migration.
        soCapQuetKyVong: ([0, 1, 2] as const).includes(assignment.soCapQuetKyVong as 0 | 1 | 2)
          ? (assignment.soCapQuetKyVong as 0 | 1 | 2)
          : 1,
        dayCredit: assignment.dayCredit,
        isLeave: assignment.isLeave,
        nominalMinutes: assignment.nominalMinutes,
        placeMode: assignment.placeMode,
        isOff: assignment.template.kind === "OFF",
      }
    : null;
  const engineLogs: EngineLog[] = logs.map((l) => ({ id: l.id, minute: vnMinuteOfDay(l.loggedAt), direction: l.direction, flags: l.flags }));

  // NGỮ CẢNH ĐƠN của ngày (BA §10): mọi đơn còn hiệu lực — đi muộn/về sớm, OT, … — MỘT câu đọc
  // (`docDonHieuLucNgay`). Đọc MỖI lần tính lại chứ không chụp lúc duyệt: đơn thường nộp trước
  // ngày, lúc duyệt chưa có lượt nào — xem đầu `don-trong-ngay.ts`.
  const nguCanhDon = dungNguCanhDon(await docDonHieuLucNgay(client, userId, workDate));

  const r = computeDay({
    assignment: engineAssignment,
    logs: engineLogs,
    rules,
    holiday,
    exempt: false,
    nguCanhDon,
    isWeeklyOff: weeklyOff.includes(vnWeekday(vnDateAt(workDate.getUTCFullYear(), workDate.getUTCMonth(), workDate.getUTCDate(), 12))),
  });

  // ── NGÀY CHƯA DIỄN RA: giữ kế hoạch, xoá mọi vế đã xảy ra ──────────────────────────
  //
  // `recomputeRange` lặp trọn kỳ kể cả kỳ ĐANG CHẠY, nên nút "Tính lại" giữa tháng vẫn đi
  // qua đây cho ngày mai, ngày kia. Cổng đặt Ở ĐÂY chứ không ở `recomputeRange`: mọi đường
  // ghi đều chụm về hàm này (cron dọn hàng đợi bẩn, nút Tính lại, `lockPeriod`, script), nên
  // chặn ở một chỗ là chặn hết — chặn ở vòng lặp thì ba đường kia vẫn lọt.
  //
  // So theo NGÀY giờ VN, không so `Date` trực tiếp: `workDate` là `@db.Date` (UTC 00:00) còn
  // `now` mang giờ thật, so thẳng là lệch đúng một ngày suốt buổi tối giờ VN.
  const homNayYmd = vnYmd(opts.now ?? new Date());
  const laNgayChuaToi = workDate.toISOString().slice(0, 10) > homNayYmd;
  const rr = laNgayChuaToi ? ketQuaNgayChuaDienRa(r) : r;

  // ── Quỹ nghỉ bù từ OT (đợt 8) + làm ngày nghỉ / lễ (đợt 9) ───────────────────────────────────
  // Số mong muốn chỉ đến từ đơn mà LÚC DUYỆT chính sách là NGHI_BU (tỉ lệ chụp trên đơn) — KHÔNG đọc cấu
  // hình hiện hành (đổi chính sách về sau không hồi tố). Luôn đối chiếu (kể cả mong muốn 0) để đơn bị huỷ /
  // giờ làm giảm thì trừ lại đúng; ghi CHÊNH LỆCH nên tính lại nhiều lần không cộng trùng. Ngày chưa tới
  // không ghi. Trừ lại mà quỹ đã được dùng ⇒ TREO (không ghi âm, không kẹp 0) + cờ rà soát (`nghi-bu.ts`).
  const treo: { nguon: string; phut: number; soDu: number | null }[] = [];
  if (!laNgayChuaToi) {
    const doiChieu = (sourceType: typeof NGUON_QUY.OT | typeof NGUON_QUY.LAM_NGAY_NGHI, mongMuon: number): Promise<KetQuaDoiChieu> => {
      const args = { userId, centerId, orgUnitId, workDate, sourceType, mongMuon };
      return opts.tx ? doiChieuQuyTuCong(opts.tx, args) : db.$transaction((tx) => doiChieuQuyTuCong(tx, args));
    };
    for (const [nguon, mongMuon] of [
      [NGUON_QUY.OT, rr.otCompMinutes],
      [NGUON_QUY.LAM_NGAY_NGHI, rr.lamNgayNghiCompMinutes],
    ] as const) {
      const k = await doiChieu(nguon, mongMuon);
      if (k.treo > 0) treo.push({ nguon, phut: k.treo, soDu: k.soDu });
    }
  }
  const flags = treo.length ? [...rr.flags, CO_QUY_CAN_RA_SOAT].sort() : rr.flags;

  const keepOverride = existing?.overrideUnits != null;
  const data = {
    centerId,
    orgUnitId,
    assignmentId: assignment?.id ?? null,
    templateCode: assignment?.templateCode ?? null,
    placeMode: assignment?.placeMode ?? null,
    dayType: rr.dayType,
    expectedMinutes: rr.expectedMinutes,
    workedMinutes: rr.workedMinutes,
    paidBreakMinutes: rr.paidBreakMinutes,
    rawPairedMinutes: rr.rawPairedMinutes,
    amExpected: rr.amExpected,
    amWorked: rr.amWorked,
    pmExpected: rr.pmExpected,
    pmWorked: rr.pmWorked,
    lateMinutes: rr.lateMinutes,
    arrivalDeltaMinutes: rr.arrivalDeltaMinutes,
    earlyLeaveMinutes: rr.earlyLeaveMinutes,
    lateApprovedMinutes: rr.lateApprovedMinutes,
    earlyLeaveApprovedMinutes: rr.earlyLeaveApprovedMinutes,
    otApprovedMinutes: rr.otApprovedMinutes,
    otActualMinutes: rr.otActualMinutes,
    otPayableMinutes: rr.otPayableMinutes,
    holidayWorkMinutes: rr.holidayWorkMinutes,
    restDayWorkMinutes: rr.restDayWorkMinutes,
    missedEarlyArrival: rr.missedEarlyArrival,
    dayCreditExpected: rr.dayCreditExpected,
    dayCreditEarned: rr.dayCreditEarned,
    hourCredit: rr.hourCredit,
    leaveUnits: rr.leaveUnits,
    holidayPaidUnits: rr.holidayPaidUnits,
    pairs: rr.pairs as unknown as Prisma.InputJsonValue,
    flags,
    status: keepOverride ? ("ADJUSTED" as const) : ("COMPUTED" as const),
    ruleSnapshot: { ...rr.ruleSnapshot, holiday, weeklyOff, donIds: nguCanhDon.donIds, quyNghiBuTreo: treo } as Prisma.InputJsonValue,
    computedBy: "ENGINE" as const,
    computedAt: new Date(),
    periodId: period?.id ?? existing?.periodId ?? null,
  };
  const row = await client.staffAttendanceDay.upsert({
    where: { userId_workDate: { userId, workDate } },
    create: { userId, workDate, ...data },
    update: data,
    select: { id: true },
  });

  // Audit MỘT lần khi ngày CHUYỂN sang trạng thái treo (tính lại nhiều lần không ghi trùng).
  if (treo.length && !existing?.flags.includes(CO_QUY_CAN_RA_SOAT)) {
    await writeAudit({
      actor: { id: null, name: "Hệ thống — tính lại công" },
      module: "hr_attendance",
      entityType: "StaffAttendanceDay",
      entityId: row.id,
      action: "COMP_TIME_RECONCILE_BLOCKED",
      oldValues: null,
      newValues: { userId, ngay: workDate.toISOString().slice(0, 10), treo },
      reason: "Tính lại công làm giảm phần quỹ nghỉ bù đã được dùng — không trừ để quỹ không âm; cần rà soát",
      orgUnitId,
      tx: opts.tx,
    });
  }
  return { ok: true, dayId: row.id, flags };
}

/** Cờ ngày: tính lại công muốn trừ quỹ nghỉ bù nhưng quỹ đã được dùng — xem `nghi-bu.ts`. */
export const CO_QUY_CAN_RA_SOAT = "QUY_NGHI_BU_CAN_RA_SOAT";

export const ATTENDANCE_DAY_DIRTY = "hr.attendance_day_dirty";

/**
 * Xếp hàng tính lại một ngày công. dedupeKey theo phút để một loạt lượt quét trong cùng phút
 * chỉ sinh MỘT event, nhưng thay đổi ở phút sau vẫn kích hoạt lại (dedupeKey là unique vĩnh viễn).
 */
export async function markAttendanceDayDirty(
  userId: string,
  workDate: Date,
  opts: { tx?: Prisma.TransactionClient; reason?: string } = {},
): Promise<void> {
  // KHÔNG dùng publishEvent ở đây: nó bắt P2002 rồi findUnique, nhưng TRONG một transaction
  // Postgres thì INSERT vỡ unique đã làm hỏng cả tx (25P02) — duyệt đơn đổi ca + chỉnh công
  // cùng phút cho cùng người là đổ (bắt được ở tests/cham-cong/requests.spec.ts, 06/09).
  // createMany + skipDuplicates = ON CONFLICT DO NOTHING, an toàn cả trong lẫn ngoài tx.
  await markAttendanceDaysDirtyMany([{ userId, workDate }], opts);
}

/** Xếp hàng nhiều ngày một lượt (import lưới, duyệt đơn nhiều ngày) — 1 INSERT, trùng thì bỏ. */
export async function markAttendanceDaysDirtyMany(
  days: { userId: string; workDate: Date }[],
  opts: { tx?: Prisma.TransactionClient; reason?: string } = {},
): Promise<number> {
  if (days.length === 0) return 0;
  const client: Client = opts.tx ?? db;
  const bucket = Math.floor(Date.now() / 60_000);
  const seen = new Set<string>();
  const data: Prisma.DomainEventCreateManyInput[] = [];
  for (const d of days) {
    const ymd = d.workDate.toISOString().slice(0, 10);
    const key = `attday:${d.userId}:${ymd}:${bucket}`;
    if (seen.has(key)) continue;
    seen.add(key);
    data.push({ type: ATTENDANCE_DAY_DIRTY, payloadJson: { userId: d.userId, workDate: ymd, reason: opts.reason ?? null }, dedupeKey: key, maxAttempts: 5 });
  }
  const r = await client.domainEvent.createMany({ data, skipDuplicates: true });
  return r.count;
}

/** Tính lại cả kỳ (chốt sổ / import): duyệt từng ngày, không tx bọc chung (mỗi ngày độc lập). */
export async function recomputeRange(
  userIds: string[],
  from: Date,
  to: Date,
  /** Chuyển thẳng xuống `recomputeAttendanceDay` — xem chú thích `now` ở đó (luật 19). */
  opts: { now?: Date } = {},
): Promise<{ days: number; locked: number }> {
  let days = 0;
  let locked = 0;
  for (const userId of userIds) {
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86_400_000)) {
      const r = await recomputeAttendanceDay(userId, d, { now: opts.now });
      if (r.skipped === "LOCKED") locked += 1;
      else days += 1;
    }
  }
  return { days, locked };
}
