// lib/cham-cong/period.ts — L5: KỲ CÔNG theo cơ sở × tháng (AttendancePeriod): công chuẩn (K-04),
// bảng tổng hợp (nguồn export), CHỐT SỔ trong transaction, MỞ LẠI (SUPER_ADMIN), ghi đè công ngày.
//
// · Công chuẩn = số ngày trong tháng − ngày nghỉ tuần (`shift.weeklyOffDays`, đè được theo cơ sở)
//   − ngày lễ (Holiday type HOLIDAY, toàn hệ thống hoặc của cơ sở, hiệu lực ≠ INFO_ONLY). Sinh tự
//   động, Kế toán sửa được trước khi khoá (theo MISA: công chuẩn CHUNG, không đè theo người).
// · summaryJson chỉ được ghi lúc KHOÁ — sau khoá, export đọc từ đó (không tính lại), nên số trên
//   file luôn là số đã chốt dù lưới có bị sửa sau (không sửa được vì engine bỏ qua ngày LOCKED).
// · Buổi dạy (K-05): đếm ClassSession COMPLETED trong kỳ mà người đó là GV thực dạy
//   (actualTeacherId → substituteTeacherId → class.teacherId). Lớp trải nghiệm là model khác
//   (TrialClassSession) nên tự loại; buổi huỷ có status CANCELLED nên tự loại. Đơn giá gõ tay ở
//   module lương — ở đây chỉ đếm.
// Không "use server" — action ở app/ kiểm quyền rồi gọi.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings/service";
import { vnDateAt, vnWeekday } from "@/lib/time/vn";
import { HO_CENTER_ID, loadCenterMap } from "./home-center";
import { recomputeRange } from "./recompute";
import { gopNgayCong } from "./tong-hop-cong";
import { thongKeNguoi, type NoiQuyRules, type ThongKeNguoi } from "./noi-quy";
import { chanChotKyThieuBuoi } from "./ky-gac";
import { buoiBuTuCase, gomBuoiBuTheoNguoi, TRANG_THAI_CASE_CO_CONG, type BuoiBuTrongKy } from "./buoi-bu-ky";

export type PeriodKey = string; // "YYYY-MM"

export function parsePeriodKey(key: string): { y: number; m: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return { y, m: mo };
}

export function periodRange(key: PeriodKey): {
  from: Date;
  to: Date;
  days: number;
} {
  const p = parsePeriodKey(key);
  if (!p) throw new Error(`periodKey không hợp lệ: ${key}`);
  const from = new Date(Date.UTC(p.y, p.m - 1, 1));
  const to = new Date(Date.UTC(p.y, p.m, 0));
  return { from, to, days: to.getUTCDate() };
}

export function currentPeriodKey(now = new Date()): PeriodKey {
  const vn = new Date(now.getTime() + 7 * 3_600_000);
  return `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Thuần: đếm ngày làm việc chuẩn của một tháng. */
export function countStandardUnits(input: {
  key: PeriodKey;
  weeklyOff: number[];
  holidayDates: Set<string>;
}): number {
  const { from, days } = periodRange(input.key);
  let n = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(from.getTime() + i * 86_400_000);
    const ymd = d.toISOString().slice(0, 10);
    const wd = vnWeekday(
      vnDateAt(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12),
    );
    if (input.weeklyOff.includes(wd)) continue;
    if (input.holidayDates.has(ymd)) continue;
    n += 1;
  }
  return n;
}

async function orgUnitOf(centerId: string): Promise<string | null> {
  if (centerId === HO_CENTER_ID) return null;
  const map = await loadCenterMap();
  return (
    Object.values(map.byCode).find((c) => c.centerId === centerId)?.orgUnitId ??
    null
  );
}

export async function computeStandardUnits(
  centerId: string,
  key: PeriodKey,
): Promise<number> {
  const { from, to } = periodRange(key);
  const orgUnitId = await orgUnitOf(centerId);
  const weeklyOff = await getSetting("shift.weeklyOffDays", { orgUnitId });
  const holidays = await db.holiday.findMany({
    where: {
      type: "HOLIDAY",
      date: { lte: to },
      OR: [{ endDate: null, date: { gte: from } }, { endDate: { gte: from } }],
      AND: [{ OR: [{ centerId: null }, { centerId }] }],
    },
    select: { date: true, endDate: true, attendanceEffect: true },
  });
  const dates = new Set<string>();
  for (const h of holidays) {
    if (h.attendanceEffect === "INFO_ONLY") continue;
    const end = h.endDate ?? h.date;
    for (
      let d = new Date(h.date);
      d <= end;
      d = new Date(d.getTime() + 86_400_000)
    )
      dates.add(d.toISOString().slice(0, 10));
  }
  return countStandardUnits({ key, weeklyOff, holidayDates: dates });
}

export async function getOrCreatePeriod(centerId: string, key: PeriodKey) {
  const existing = await db.attendancePeriod.findUnique({
    where: { centerId_periodKey: { centerId, periodKey: key } },
  });
  if (existing) return existing;
  const [standardUnits, orgUnitId] = await Promise.all([
    computeStandardUnits(centerId, key),
    orgUnitOf(centerId),
  ]);
  return db.attendancePeriod.upsert({
    where: { centerId_periodKey: { centerId, periodKey: key } },
    update: {},
    create: {
      centerId,
      orgUnitId,
      periodKey: key,
      standardUnits,
      status: "OPEN",
    },
  });
}

// ─── Tổng hợp ─────────────────────────────────────────────────────────────────────────

export type PeriodPersonRow = {
  userId: string;
  name: string;
  employeeCode: string | null;
  jobTitle: string | null;
  /** Σ (overrideUnits ?? dayCreditEarned) — công thực tế. */
  units: number;
  expectedUnits: number;
  leaveUnits: number;
  holidayPaidUnits: number;
  hourCredit: number;
  workedMinutes: number;
  expectedMinutes: number;
  lateCount: number;
  /** Σ phút đến muộn. Có VÌ phạt (mục 3) tính được theo lần HOẶC theo phút — bày một vế là
   *  ép người đọc suy vế kia, và 2 lần × 3′ khác hẳn 2 lần × 90′. */
  lateMinutes: number;
  earlyLeaveCount: number;
  earlyLeaveMinutes: number;
  /**
   * Σ phút OT được trả (đợt 4). ⚠️ Kỳ ĐÃ CHỐT trước đợt 4 lưu `summaryJson` không có trường này —
   * chỗ đọc phải chịu `undefined`.
   */
  otMinutes: number;
  /**
   * Σ phút làm ngày lễ / ngày nghỉ theo đơn đã duyệt (đợt 9). Kỳ chốt trước đợt 9 không có trường
   * này trong `summaryJson` — chỗ đọc phải chịu `undefined`, giống `otMinutes`.
   */
  holidayWorkMinutes: number;
  restDayWorkMinutes: number;
  /** Số NGÀY có phút làm > 0. KHÁC `noiQuy.caThucTe` — cái kia đo bằng ĐƠN VỊ CÔNG. */
  workedDays: number;
  /** Số NGÀY được xếp ca làm việc. KHÁC `noiQuy.caQuyDinh` — cùng lý do. */
  scheduledDays: number;
  missingTapDays: number;
  overrideDays: number;
  flaggedDays: number;
  teachingSessions: number;
  /**
   * T12 — buổi DẠY BÙ người này dạy trong kỳ (case COMPLETED / NO_SHOW). Trường MỚI và tuỳ chọn: bản chốt cũ không có nó, và
   * `teachingSessions` KHÔNG đổi nghĩa (vẫn chỉ đếm buổi lớp). Một case = một buổi, bất kể số bài / số bé.
   */
  makeupSessions?: number;
  /** T12 — tổng phút các buổi bù ở trên (giờ kết − giờ bắt đầu từng case). */
  makeupMinutes?: number;
  /**
   * Thống kê NỘI QUY của người này trong kỳ: ca thực tế / ca quy định, số lần trễ, ngày nghỉ
   * không phép (đã xác nhận), ngày vắng chờ kết luận, và % bị trừ.
   *
   * CỐ Ý tách khỏi `units`/`expectedUnits` ngay bên trên: hai cột kia đếm công theo KẾ HOẠCH
   * (luật T-01, engine không tự trừ) nên tỷ lệ giữa chúng luôn là 100%. Đây là đại lượng riêng,
   * đếm từ bằng chứng có mặt, và không đụng tới cột công dùng để trả lương.
   */
  noiQuy: ThongKeNguoi;
  /** ngày → mã ca / "P" / "X" — lưới sheet 2 */
  grid: Record<string, string>;
  unitsByDay: Record<string, number>;
};

export type PeriodSummary = {
  centerId: string;
  periodKey: PeriodKey;
  standardUnits: number | null;
  builtAt: string;
  days: string[]; // "YYYY-MM-DD"
  rows: PeriodPersonRow[];
  /**
   * T12 — MỌI buổi dạy bù của cơ sở trong kỳ lúc dựng, kể cả của giáo viên không có dòng công nào (nên không nằm trong `rows`).
   * Đây là thứ checker TV-93 đối chiếu để biết case nào hoàn thành SAU khi chốt. Tuỳ chọn: bản chốt cũ không có.
   */
  buoiBu?: BuoiBuTrongKy[];
  totals: {
    people: number;
    units: number;
    teachingSessions: number;
    flaggedDays: number;
    /** T12 — tuỳ chọn như `buoiBu`. */
    makeupSessions?: number;
  };
};


export async function buildPeriodSummary(
  centerId: string,
  key: PeriodKey,
): Promise<PeriodSummary> {
  const { from, to, days: nDays } = periodRange(key);
  // Ngưỡng và mức trừ là THAM SỐ VẬN HÀNH, đọc theo đơn vị. Hằng trong `noi-quy.ts` chỉ là
  // mặc định cho hàm thuần — đường nào chạm DB thì phải đọc setting rồi truyền vào, kẻo người
  // vận hành sửa ở màn Cấu hình mà bảng vẫn tính theo số cũ (đúng bài học của trần hoa hồng).
  const orgUnitIdForRules = await orgUnitOf(centerId);
  const noiQuyRules: NoiQuyRules = {
    latePenaltyGraceMinutes: await getSetting("shift.latePenaltyGraceMinutes", {
      orgUnitId: orgUnitIdForRules,
    }),
    penaltyLatePercent: await getSetting("shift.penaltyLatePercent", {
      orgUnitId: orgUnitIdForRules,
    }),
    penaltyAbsentPercent: await getSetting("shift.penaltyAbsentPercent", {
      orgUnitId: orgUnitIdForRules,
    }),
  };
  const period = await db.attendancePeriod.findUnique({
    where: { centerId_periodKey: { centerId, periodKey: key } },
    select: { standardUnits: true },
  });
  const [dayRows, assignments] = await Promise.all([
    db.staffAttendanceDay.findMany({
      where: { centerId, workDate: { gte: from, lte: to } },
    }),
    db.shiftAssignment.findMany({
      where: { centerId, workDate: { gte: from, lte: to }, status: "ACTIVE" },
      select: { userId: true, workDate: true, templateCode: true },
    }),
  ]);
  const userIds = [
    ...new Set([
      ...dayRows.map((r) => r.userId),
      ...assignments.map((a) => a.userId),
    ]),
  ];
  const users = userIds.length
    ? await db.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          name: true,
          email: true,
          employee: { select: { employeeCode: true, jobTitle: true } },
        },
      })
    : [];
  const userOf = new Map(users.map((u) => [u.id, u]));

  // Buổi dạy trong kỳ (K-05) — GV thực dạy của buổi COMPLETED, lớp thuộc cơ sở này.
  const sessions = userIds.length
    ? await db.classSession.findMany({
        where: {
          status: "COMPLETED",
          date: { gte: from, lt: new Date(to.getTime() + 86_400_000) },
          class: { centerId },
        },
        select: {
          actualTeacherId: true,
          substituteTeacherId: true,
          class: { select: { teacherId: true } },
        },
      })
    : [];
  const teach = new Map<string, number>();
  for (const s of sessions) {
    const t = s.actualTeacherId ?? s.substituteTeacherId ?? s.class.teacherId;
    if (t) teach.set(t, (teach.get(t) ?? 0) + 1);
  }

  // Buổi dạy BÙ trong kỳ (T12) — case đã dạy (COMPLETED / NO_SHOW) của cơ sở này. Không lọc theo `userIds`: giáo viên chỉ có
  // buổi bù (không ca, không lượt quét) vẫn phải nằm trong bản chốt, kẻo checker không thấy buổi của họ.
  const buoiBu = buoiBuTuCase(
    await db.makeupCase.findMany({
      where: { centerId, status: { in: [...TRANG_THAI_CASE_CO_CONG] }, date: { gte: from, lte: to } },
      select: { id: true, teacherId: true, date: true, startTime: true, endTime: true, status: true },
    }),
  );
  const buBoiNguoi = gomBuoiBuTheoNguoi(buoiBu);

  const days: string[] = [];
  for (let i = 0; i < nDays; i++)
    days.push(
      new Date(from.getTime() + i * 86_400_000).toISOString().slice(0, 10),
    );

  const rows: PeriodPersonRow[] = userIds
    .map((userId) => {
      const u = userOf.get(userId);
      const mine = dayRows.filter((r) => r.userId === userId);
      const grid: Record<string, string> = {};
      const unitsByDay: Record<string, number> = {};
      for (const a of assignments.filter((x) => x.userId === userId))
        grid[a.workDate.toISOString().slice(0, 10)] = a.templateCode;
      const row: PeriodPersonRow = {
        userId,
        name: u?.name ?? u?.email ?? userId,
        employeeCode: u?.employee?.employeeCode ?? null,
        jobTitle: u?.employee?.jobTitle ?? null,
        units: 0,
        expectedUnits: 0,
        leaveUnits: 0,
        holidayPaidUnits: 0,
        hourCredit: 0,
        workedMinutes: 0,
        expectedMinutes: 0,
        lateCount: 0,
        lateMinutes: 0,
        earlyLeaveCount: 0,
        earlyLeaveMinutes: 0,
        otMinutes: 0,
        holidayWorkMinutes: 0,
        restDayWorkMinutes: 0,
        workedDays: 0,
        scheduledDays: 0,
        missingTapDays: 0,
        overrideDays: 0,
        flaggedDays: 0,
        teachingSessions: teach.get(userId) ?? 0,
        makeupSessions: buBoiNguoi.get(userId)?.soBuoi ?? 0,
        makeupMinutes: buBoiNguoi.get(userId)?.phut ?? 0,
        noiQuy: thongKeNguoi(mine, noiQuyRules),
        grid,
        unitsByDay,
      };
      // Phép GỘP nay nằm ở `tong-hop-cong.ts` (thuần) để site giáo viên gọi được đúng phép
      // tính này cho MỘT người — trước đó nó inline ở đây, nên site GV không gọi được và đã
      // ba lần tự cộng lại rồi lệch (luật 12b). Vòng lặp còn lại chỉ dựng LƯỚI, không cộng số.
      const gop = gopNgayCong(mine);
      for (const d of mine) {
        const ymd = d.workDate.toISOString().slice(0, 10);
        if (!grid[ymd] && d.templateCode) grid[ymd] = d.templateCode;
      }
      Object.assign(unitsByDay, gop.unitsByDay);
      row.units = gop.units;
      row.expectedUnits = gop.expectedUnits;
      row.leaveUnits = gop.leaveUnits;
      row.holidayPaidUnits = gop.holidayPaidUnits;
      row.hourCredit = gop.hourCredit;
      row.workedMinutes = gop.workedMinutes;
      row.expectedMinutes = gop.expectedMinutes;
      row.lateCount = gop.lateCount;
      row.lateMinutes = gop.latePhut;
      row.earlyLeaveCount = gop.earlyLeaveCount;
      row.earlyLeaveMinutes = gop.earlyLeavePhut;
      row.otMinutes = gop.otPhut;
      row.holidayWorkMinutes = gop.lamNgayLePhut;
      row.restDayWorkMinutes = gop.lamNgayNghiPhut;
      row.missingTapDays = gop.missingTapDays;
      row.overrideDays = gop.overrideDays;
      row.flaggedDays = gop.flaggedDays;
      row.workedDays = gop.ngayDaLam;
      row.scheduledDays = gop.ngayCoCa;
      return row;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "vi"));

  return {
    centerId,
    periodKey: key,
    standardUnits: period?.standardUnits ?? null,
    builtAt: new Date().toISOString(),
    days,
    rows,
    buoiBu,
    totals: {
      people: rows.length,
      units: round2(rows.reduce((s, r) => s + r.units, 0)),
      teachingSessions: rows.reduce((s, r) => s + r.teachingSessions, 0),
      flaggedDays: rows.reduce((s, r) => s + r.flaggedDays, 0),
      makeupSessions: buoiBu.length,
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Chốt / mở lại ────────────────────────────────────────────────────────────────────

export type LockResult =
  | { ok: true; summary: PeriodSummary; days: number }
  | { ok: false; error: string };

/**
 * Chốt sổ: (1) tính lại mọi ngày trong kỳ của mọi người có ca/lượt ở cơ sở (ngoài tx — mỗi ngày độc
 * lập, engine bỏ qua ngày đã LOCKED); (2) TRONG tx: dựng summary, ghi LOCKED + summaryJson, đóng
 * băng từng StaffAttendanceDay (status LOCKED + periodId). Kỳ tương lai không chốt được.
 */
export async function lockPeriod(input: {
  centerId: string;
  periodKey: PeriodKey;
  actorId: string;
  reason: string | null;
  /**
   * Đường vượt cổng "kỳ chưa buổi nào được chốt". CHỈ cấp Hội sở được đặt, và action
   * layer bắt buộc lý do — xem `lockPeriodAction`.
   */
  boQuaBuoiChuaChot?: boolean;
  now?: Date;
}): Promise<LockResult> {
  const now = input.now ?? new Date();
  const { from, to } = periodRange(input.periodKey);
  if (to.getTime() > now.getTime())
    return {
      ok: false,
      error: "Kỳ chưa kết thúc — chỉ chốt sau ngày cuối tháng",
    };
  const period = await getOrCreatePeriod(input.centerId, input.periodKey);
  if (period.status === "LOCKED") return { ok: false, error: "Kỳ đã chốt" };

  // ── CHẶN CỨNG: kỳ có buổi học mà CHƯA buổi nào được chốt ─────────────────────
  //
  // Đặt Ở ĐÂY, sau cổng "đã chốt" và TRƯỚC `recomputeRange`: đặt sau là "chặn nhưng
  // vẫn ghi" — đã tính lại và ghi đè hàng loạt `StaffAttendanceDay` rồi mới báo lỗi.
  //
  // Đếm thẳng `ClassSession`, không dùng `summary.totals.teachingSessions` — xem
  // `lib/cham-cong/ky-gac.ts`.
  if (!input.boQuaBuoiChuaChot) {
    const [duKien, xong] = await Promise.all([
      db.classSession.count({
        where: {
          class: { centerId: input.centerId },
          date: { gte: from, lte: to },
          status: { not: "CANCELLED" },
        },
      }),
      db.classSession.count({
        where: {
          class: { centerId: input.centerId },
          date: { gte: from, lte: to },
          status: "COMPLETED",
        },
      }),
    ]);
    const loi = chanChotKyThieuBuoi({ duKien, xong });
    if (loi) return { ok: false, error: loi };
  }

  const userIds = [
    ...new Set(
      (
        await db.shiftAssignment.findMany({
          where: {
            centerId: input.centerId,
            workDate: { gte: from, lte: to },
            status: "ACTIVE",
          },
          select: { userId: true },
          distinct: ["userId"],
        })
      )
        .map((a) => a.userId)
        .concat(
          (
            await db.staffTimeLog.findMany({
              where: {
                centerId: input.centerId,
                workDate: { gte: from, lte: to },
                result: "ACCEPTED",
              },
              select: { userId: true },
              distinct: ["userId"],
            })
          ).map((l) => l.userId),
        ),
    ),
  ];
  const rc = await recomputeRange(userIds, from, to);

  const summary = await buildPeriodSummary(input.centerId, input.periodKey);
  await db.$transaction(async (tx) => {
    const lock = await tx.attendancePeriod.updateMany({
      where: { id: period.id, status: { not: "LOCKED" } },
      data: {
        status: "LOCKED",
        lockedById: input.actorId,
        lockedAt: now,
        lockReason: input.reason,
        summaryJson: summary as unknown as Prisma.InputJsonValue,
        standardUnits:
          period.standardUnits ?? summary.standardUnits ?? undefined,
      },
    });
    if (lock.count === 0) throw new Error("Kỳ vừa được người khác chốt");
    await tx.staffAttendanceDay.updateMany({
      where: { centerId: input.centerId, workDate: { gte: from, lte: to } },
      data: { status: "LOCKED", periodId: period.id },
    });
  });
  return { ok: true, summary, days: rc.days };
}

export async function reopenPeriod(input: {
  centerId: string;
  periodKey: PeriodKey;
  actorId: string;
  reason: string;
  now?: Date;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = input.now ?? new Date();
  const { from, to } = periodRange(input.periodKey);
  const period = await db.attendancePeriod.findUnique({
    where: {
      centerId_periodKey: {
        centerId: input.centerId,
        periodKey: input.periodKey,
      },
    },
    select: { id: true, status: true },
  });
  if (!period || period.status !== "LOCKED")
    return { ok: false, error: "Kỳ chưa chốt, không có gì để mở lại" };
  await db.$transaction(async (tx) => {
    await tx.attendancePeriod.update({
      where: { id: period.id },
      data: {
        status: "REOPENED",
        reopenedById: input.actorId,
        reopenedAt: now,
        reopenReason: input.reason,
      },
    });
    // Mở băng ngày công: ngày có ghi đè về ADJUSTED, còn lại về COMPUTED — engine tính lại được.
    await tx.staffAttendanceDay.updateMany({
      where: {
        centerId: input.centerId,
        workDate: { gte: from, lte: to },
        status: "LOCKED",
        overrideUnits: { not: null },
      },
      data: { status: "ADJUSTED" },
    });
    await tx.staffAttendanceDay.updateMany({
      where: {
        centerId: input.centerId,
        workDate: { gte: from, lte: to },
        status: "LOCKED",
      },
      data: { status: "COMPUTED" },
    });
  });
  return { ok: true };
}

/** Ghi đè công một ngày (hộp cờ Quản lý): null = bỏ ghi đè. Ngày LOCKED không sửa. */
export async function setDayOverride(input: {
  userId: string;
  workDate: Date;
  units: number | null;
  note: string | null;
  actorId: string;
  now?: Date;
}): Promise<
  | { ok: true; before: number | null; centerId: string }
  | { ok: false; error: string }
> {
  const row = await db.staffAttendanceDay.findUnique({
    where: {
      userId_workDate: { userId: input.userId, workDate: input.workDate },
    },
    select: { id: true, status: true, overrideUnits: true, centerId: true },
  });
  if (!row)
    return {
      ok: false,
      error: "Ngày này chưa được tính — chờ engine vài phút rồi thử lại",
    };
  if (row.status === "LOCKED")
    return { ok: false, error: "Ngày thuộc kỳ đã chốt" };
  if (input.units != null && !input.note?.trim())
    return { ok: false, error: "Ghi đè công phải có lý do" };
  await db.staffAttendanceDay.update({
    where: { id: row.id },
    data:
      input.units == null
        ? {
            overrideUnits: null,
            overrideById: null,
            overrideAt: null,
            overrideNote: null,
            status: "COMPUTED",
          }
        : {
            overrideUnits: input.units,
            overrideById: input.actorId,
            overrideAt: input.now ?? new Date(),
            overrideNote: input.note,
            status: "ADJUSTED",
          },
  });
  return { ok: true, before: row.overrideUnits, centerId: row.centerId };
}
