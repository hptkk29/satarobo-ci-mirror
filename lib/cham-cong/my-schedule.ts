// lib/cham-cong/my-schedule.ts — L5: LỊCH CA CỦA TÔI đọc từ lưới mới (ShiftAssignment), thay
// ShiftRegistration cũ (đăng ký ca tự đề xuất — đã đóng băng L5, kế hoạch §5). Dùng chung cho
// /cham-cong/lich-ca (admin), /teacher/lich và /teacher/bang-cong. Đọc `db` trần vì luôn lọc theo
// CHÍNH userId của phiên (dữ liệu của mình).
import type { NgayCongGop } from "./tong-hop-cong";
import { db } from "@/lib/db";
import type { ShiftSegment } from "./catalog";
import type { LoaiMaCa } from "./nhan-ca";
import { LUOT_CON_TINH } from "./sua-gio-quet";

export type MyShiftRow = {
  date: Date; // @db.Date → UTC 00:00
  code: string;
  name: string;
  centerId: string;
  centerLabel: string;
  /**
   * `ShiftTemplate.kind`. ⚠️ ĐỪNG thay bằng `isLeave` khi cần biết "ngày này có nghỉ không":
   * `X` (Nghỉ) mang `kind: OFF` nhưng `isLeave: FALSE` — nó không phải nghỉ PHÉP. Lọc bằng
   * `isLeave` là để `X` lọt qua thành ca làm, đúng bug prod 10/09/2026. Nhãn ở `nhan-ca.ts`.
   */
  kind: LoaiMaCa;
  isLeave: boolean;
  dayCredit: number;
  /** "07:45–11:30 · 14:00–17:45" hoặc "" (mã không giờ). */
  timeLabel: string;
  source: string;
};

export async function getMyAssignments(userId: string, from: Date, to: Date): Promise<MyShiftRow[]> {
  const rows = await db.shiftAssignment.findMany({
    where: { userId, workDate: { gte: from, lt: to }, status: "ACTIVE" },
    select: { workDate: true, templateCode: true, centerId: true, isLeave: true, dayCredit: true, segments: true, source: true, template: { select: { name: true, kind: true } } },
    orderBy: { workDate: "asc" },
    take: 100,
  });
  const centerIds = [...new Set(rows.map((r) => r.centerId))];
  const centers = centerIds.length ? await db.center.findMany({ where: { id: { in: centerIds } }, select: { id: true, code: true, name: true } }) : [];
  const labelOf = new Map(centers.map((c) => [c.id, c.code ?? c.name]));
  return rows.map((r) => ({
    date: r.workDate,
    code: r.templateCode,
    name: r.template.name,
    centerId: r.centerId,
    centerLabel: labelOf.get(r.centerId) ?? (r.centerId === "hoi-so" ? "HO" : r.centerId),
    kind: r.template.kind,
    isLeave: r.isLeave,
    dayCredit: r.dayCredit,
    timeLabel: ((r.segments as ShiftSegment[] | null) ?? []).filter((s) => s.kind === "WORK").map((s) => `${s.start}–${s.end}`).join(" · "),
    source: r.source,
  }));
}

/**
 * Một ngày công của CHÍNH người đăng nhập.
 *
 * `gop` mang ĐỦ cột mà `gopNgayCong` (`tong-hop-cong.ts`) cần — cùng phép gộp admin dùng ở
 * `buildPeriodSummary`. Đừng cộng tay từ các trường phẳng bên trên: chúng có để hiển thị
 * từng dòng, còn mọi con số TỔNG phải đi qua `gopNgayCong` (luật 12b — site GV đọc số của
 * admin, không dựng lại).
 */
export type MyDayRow = {
  date: Date;
  units: number;
  worked: number;
  expected: number;
  flags: string[];
  override: boolean;
  locked: boolean;
  code: string | null;
  gop: NgayCongGop;
};

export async function getMyAttendanceDays(userId: string, from: Date, to: Date): Promise<MyDayRow[]> {
  const rows = await db.staffAttendanceDay.findMany({
    where: { userId, workDate: { gte: from, lt: to } },
    select: {
      workDate: true, overrideUnits: true, dayCreditEarned: true, dayCreditExpected: true,
      workedMinutes: true, expectedMinutes: true, flags: true, status: true, templateCode: true,
      dayType: true, leaveUnits: true, holidayPaidUnits: true, hourCredit: true,
      lateMinutes: true, earlyLeaveMinutes: true, absenceStatus: true, pairs: true,
      lateApprovedMinutes: true, earlyLeaveApprovedMinutes: true, otPayableMinutes: true,
      holidayWorkMinutes: true, restDayWorkMinutes: true,
    },
    orderBy: { workDate: "asc" },
  });
  return rows.map((r) => ({
    date: r.workDate,
    units: r.overrideUnits ?? r.dayCreditEarned,
    worked: r.workedMinutes,
    expected: r.expectedMinutes,
    flags: r.flags,
    override: r.overrideUnits != null,
    locked: r.status === "LOCKED",
    code: r.templateCode,
    gop: {
      workDate: r.workDate,
      dayType: r.dayType,
      templateCode: r.templateCode,
      overrideUnits: r.overrideUnits,
      dayCreditEarned: r.dayCreditEarned,
      dayCreditExpected: r.dayCreditExpected,
      leaveUnits: r.leaveUnits,
      holidayPaidUnits: r.holidayPaidUnits,
      hourCredit: r.hourCredit,
      workedMinutes: r.workedMinutes,
      expectedMinutes: r.expectedMinutes,
      lateMinutes: r.lateMinutes,
      earlyLeaveMinutes: r.earlyLeaveMinutes,
      lateApprovedMinutes: r.lateApprovedMinutes,
      earlyLeaveApprovedMinutes: r.earlyLeaveApprovedMinutes,
      otPayableMinutes: r.otPayableMinutes,
      holidayWorkMinutes: r.holidayWorkMinutes,
      restDayWorkMinutes: r.restDayWorkMinutes,
      flags: r.flags,
      absenceStatus: r.absenceStatus,
      pairs: r.pairs,
    },
  }));
}

export type MyKyCong = {
  centerId: string;
  periodKey: string;
  standardUnits: number | null;
  status: "OPEN" | "CLOSING" | "LOCKED" | "REOPENED" | null;
  lockedAt: Date | null;
};

/**
 * KỲ CÔNG của chính người này, cho tháng `periodKey` ("YYYY-MM").
 *
 * 🔴 ĐỌC `db` TRẦN, KHÔNG qua `scopedDb` — và đây là một bản vá, không phải tiện tay.
 *
 * Bản đầu (15/09/2026) tra bằng `sdb.attendancePeriod.findFirst(...)`. Chụp màn thật thì thẻ
 * "Kỳ công" in **"Chưa lập kỳ"** trong khi kỳ ĐÃ được lập, có `standardUnits = 24`. Nguyên do:
 * `AttendancePeriod` nằm trong `SCOPED_MODELS`, và một giáo viên không có dòng `UserOrgRole`
 * thì `visibleCenterIds` rỗng ⇒ `scopedDb` lọc sạch ⇒ trả `null`.
 *
 * `null` ở đó KHÔNG phân biệt được "chưa lập kỳ" với "bạn không được xem" — nên màn hình nói
 * một câu SAI thay vì nói "không biết". Đúng lớp lỗi mục 1 sinh ra để sửa, và đúng họ RC-A
 * (thiếu `UserOrgRole` ⇒ ẩn oan) đã gặp ở đợt R7.
 *
 * Vì sao đọc trần là ĐÚNG chứ không phải nới quyền: khoá tra là `centerId` của CHÍNH cơ sở nhà
 * người này (`resolveHomeCenter`), và `standardUnits` là hằng số vận hành của cơ sở họ đang làm
 * — thứ họ phải biết để đọc bảng công của mình. Cùng khuôn "own-rows" mà `getMyAssignments`
 * ngay trên đây và `lib/lms/teacher-schedule.ts` đã dùng, với cùng lý do.
 */
export async function getMyPeriod(userId: string, periodKey: string): Promise<MyKyCong> {
  const { resolveHomeCenter } = await import("./home-center");
  const nha = await resolveHomeCenter(userId);
  const r = await db.attendancePeriod.findUnique({
    where: { centerId_periodKey: { centerId: nha.centerId, periodKey } },
    select: { standardUnits: true, status: true, lockedAt: true },
  });
  return {
    centerId: nha.centerId,
    periodKey,
    standardUnits: r?.standardUnits ?? null,
    status: r?.status ?? null,
    lockedAt: r?.lockedAt ?? null,
  };
}

export type MyTapRow = {
  id: string;
  direction: "CHECK_IN" | "CHECK_OUT";
  loggedAt: Date;
  source: string;
  flags: string[];
};

/**
 * Lượt chấm ĐÃ GHI NHẬN của chính người này trong một ngày.
 *
 * Đọc `db` trần theo đúng khuôn own-rows của file này: khoá tra là `userId` của phiên, nên
 * không có gì để scope. Đi qua `scopedDb` ở đây còn ẩn oan — lượt công tác mang `centerId`
 * là cơ sở NHÀ, có thể khác cơ sở người đang xem được gán.
 *
 * Chỉ lượt CÒN TÍNH (`LUOT_CON_TINH`): lượt `REJECTED` (vé hỏng, ngoài vùng) ghi để hậu kiểm,
 * và lượt đã bị THAY bằng chỉnh tay (06/10/2026) — cả hai KHÔNG phải thứ nói với người dùng rằng
 * "bạn đã chấm rồi". Màn hiện "đã vào 08:32" trong khi quản lý đã ghi đè thành 08:00 là nói dối.
 */
export async function getMyTapsOfDay(userId: string, workDate: Date): Promise<MyTapRow[]> {
  const rows = await db.staffTimeLog.findMany({
    where: { userId, workDate, ...LUOT_CON_TINH },
    select: { id: true, direction: true, loggedAt: true, source: true, flags: true },
    orderBy: { loggedAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    direction: r.direction as "CHECK_IN" | "CHECK_OUT",
    loggedAt: r.loggedAt,
    source: r.source,
    flags: r.flags,
  }));
}

export type MyCaHomNay = {
  templateCode: string;
  placeMode: "AT_UNITS" | "ANY_CENTER" | "OFFSITE" | "ANYWHERE";
  soCapQuetKyVong: number;
};

/**
 * Ca được xếp cho chính người này trong một ngày — đủ để màn "Của tôi" biết hiện nút gì.
 *
 * Trả `placeMode` chứ KHÔNG trả riêng "có phải mã NG không": chủ dự án chốt hai nút công tác
 * hiện theo ĐIỀU KIỆN, không theo mã. Mã nào khai `OFFSITE` cũng được nút.
 */
export async function getMyShiftOfDay(userId: string, workDate: Date): Promise<MyCaHomNay | null> {
  const a = await db.shiftAssignment.findFirst({
    where: { userId, workDate, status: "ACTIVE" },
    select: { templateCode: true, placeMode: true, soCapQuetKyVong: true },
  });
  return a
    ? { templateCode: a.templateCode, placeMode: a.placeMode, soCapQuetKyVong: a.soCapQuetKyVong }
    : null;
}
