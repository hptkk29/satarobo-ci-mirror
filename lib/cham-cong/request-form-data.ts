// lib/cham-cong/request-form-data.ts — Dữ liệu cho FORM ĐƠN TỪ dùng chung (RSC gọi, không action).
// Cùng một loader cho site admin (tư vấn/giáo vụ/HO) và site GV → hai màn không lệch lựa chọn.
import "server-only";
import { db } from "@/lib/db";
import { resolveActor } from "@/lib/auth/actor";
import { getSetting } from "@/lib/settings/service";
import { vnAddDays, vnDateOnly, vnYmd } from "@/lib/time/vn";
import { HO_CENTER_ID, loadCenterMap } from "./home-center";
import { resolveRequestCenter } from "./requests";
import { soDuNghiBu } from "./nghi-bu";

export type RequestFormOptions = {
  /** Cơ sở nhận đơn suy ra được (null = Hội sở, người nộp chọn trong `centers`). */
  defaultCenter: { id: string; label: string } | null;
  centers: { id: string; label: string }[];
  templates: { id: string; code: string; name: string }[];
  /**
   * `noticeDays` = số ngày phải báo trước của loại nghỉ (null = không đòi). Form dùng để báo lỗi
   * TẠI CHỖ đúng luật server (`submitAttendanceRequest`: nộp sát ngày mà không chọn người làm thay
   * ⇒ từ chối) — thay vì để người dùng bấm Gửi rồi mới đọc lỗi.
   */
  leaveTypes: { id: string; code: string; name: string; paidRatio: number; noticeDays: number | null }[];
  /** Đồng nghiệp cùng cơ sở (nhận ca / làm thay). */
  colleagues: { id: string; name: string; isTeacher: boolean }[];
  myClasses: { id: string; name: string }[];
  timesheetExempt: boolean;
  noticeDays: number;
  /** Số dư quỹ nghỉ bù của người nộp (phút, đợt 8) — form in ra cạnh loại đơn Nghỉ bù. */
  soDuNghiBuPhut: number;
  /**
   * Ca ACTIVE của chính người nộp trong cửa sổ [tu, den] ("YYYY-MM-DD"), khoá theo ngày (06/10/2026).
   * Đơn chỉnh công dùng `soCap` (= `ShiftAssignment.soCapQuetKyVong`) để BÁO TRƯỚC khi duyệt sẽ ghi
   * đè hay ghi thêm — cùng hàm `cheDoChoDon` đường duyệt dùng. Ngày TRONG cửa sổ mà không có khoá
   * = chưa xếp ca (biết chắc); ngày NGOÀI cửa sổ = chưa biết ⇒ form nói chung chung, không đoán.
   */
  caTheoNgay: { tu: string; den: string; ca: Record<string, { code: string; soCap: number | null }> };
};

/** Cửa sổ ca nạp cho form: đơn chỉnh công thường hồi tố (≤ 45 ngày), đơn khác hướng tới (≤ 31). */
const CA_LUI = 45;
const CA_TOI = 31;

export async function loadRequestFormOptions(userId: string): Promise<RequestFormOptions> {
  const [map, resolved, actor] = await Promise.all([loadCenterMap(), resolveRequestCenter(userId, null), resolveActor(userId)]);
  const centerRows = await db.center.findMany({
    where: { isActive: true, code: { in: Object.keys(map.byCode) } },
    select: { id: true, code: true, name: true },
    orderBy: { displayOrder: "asc" },
  });
  const centers = centerRows.map((c) => ({ id: c.id, label: `${c.code} · ${c.name}` }));
  const defaultCenter = resolved.centerId ? (centers.find((c) => c.id === resolved.centerId) ?? { id: resolved.centerId, label: resolved.centerId }) : null;
  const scopeCenterIds = resolved.centerId && resolved.centerId !== HO_CENTER_ID ? [resolved.centerId] : centers.map((c) => c.id);

  const now = new Date();
  const caTu = vnDateOnly(vnAddDays(now, -CA_LUI));
  const caDen = vnDateOnly(vnAddDays(now, CA_TOI));
  const [templates, leaveTypes, colleagues, myClasses, noticeDays, myShifts] = await Promise.all([
    db.shiftTemplate.findMany({ where: { isActive: true, centerId: null, isLeave: false, kind: { not: "OFF" } }, select: { id: true, code: true, name: true }, orderBy: { displayOrder: "asc" } }),
    db.leaveType.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, paidRatio: true, noticeDays: true }, orderBy: { displayOrder: "asc" } }),
    db.user.findMany({
      where: { id: { not: userId }, isActive: true, centerId: { in: scopeCenterIds }, roles: { hasSome: ["TEACHER", "SALES_CSM", "CENTER_MANAGER", "HR", "TRAINING", "MARKETING", "ACCOUNTANT"] } },
      select: { id: true, name: true, email: true, roles: true },
      orderBy: { name: "asc" },
      take: 200,
    }),
    actor.assignedClassIds.size > 0
      ? db.class.findMany({ where: { id: { in: [...actor.assignedClassIds] } }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([] as { id: string; name: string }[]),
    getSetting("shift.requestNoticeDays"),
    // Ca của CHÍNH người nộp — dữ liệu của họ, đọc thẳng như `resolveRequestCenter`.
    db.shiftAssignment.findMany({
      where: { userId, status: "ACTIVE", workDate: { gte: caTu, lte: caDen } },
      select: { workDate: true, templateCode: true, soCapQuetKyVong: true },
      take: 200,
    }),
  ]);
  const ca: Record<string, { code: string; soCap: number | null }> = {};
  // `workDate` là `@db.Date` (nửa đêm UTC) ⇒ +12h rồi đọc lịch VN, cùng mẹo `requests.ts`.
  for (const s of myShifts) ca[vnYmd(new Date(s.workDate.getTime() + 12 * 3_600_000))] = { code: s.templateCode, soCap: s.soCapQuetKyVong };

  return {
    defaultCenter,
    centers,
    templates,
    leaveTypes,
    colleagues: colleagues.map((u) => ({ id: u.id, name: u.name ?? u.email ?? u.id, isTeacher: u.roles.includes("TEACHER") })),
    myClasses,
    timesheetExempt: resolved.timesheetExempt,
    noticeDays,
    soDuNghiBuPhut: await soDuNghiBu(db, userId),
    caTheoNgay: {
      tu: vnYmd(new Date(caTu.getTime() + 12 * 3_600_000)),
      den: vnYmd(new Date(caDen.getTime() + 12 * 3_600_000)),
      ca,
    },
  };
}
