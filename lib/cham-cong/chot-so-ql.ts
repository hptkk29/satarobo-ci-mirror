// lib/cham-cong/chot-so-ql.ts — CHỐT KỲ CÔNG THEO SỐ QUẢN LÝ (chủ dự án chốt 04/11/2026).
//
// Vì sao có: có những số chốt mà engine không tự ra được — phút muộn/sớm QL miễn hoặc chỉ tính một
// phần, công bù của tháng trước, phần công trả ở cơ sở khác, phép không có trên lưới. Trước đây các số
// đó chỉ nằm trong file Excel, nên màn Kỳ công, file xuất và agent đọc prod đều ra số khác số đã trả.
//
// Cách làm: dựng `PeriodSummary` như lúc chốt thường (dữ liệu ngày hiện có, KHÔNG tính lại), rồi THAY
// số của từng người bằng số QL nhập, ghi vào `summaryJson` và khoá kỳ. Mọi màn đọc kỳ LOCKED (Kỳ công,
// Thống kê, Xuất Excel) và agent (A-06) đọc đúng số này. KHÔNG đổi công thức lương — chỉ đổi NGUỒN số.
//
// Luật cứng:
//  · CHỈ Quản trị tối cao (gác ở action).
//  · MỘT LẦN DUY NHẤT cho mỗi kỳ × cơ sở: chỉ kỳ CHƯA TỪNG khoá (`status = OPEN`, `lockedAt` null). Kỳ đã
//    chốt tay rồi không chốt tay lại được — kể cả sau khi mở lại.
//  · Phải phủ ĐỦ mọi người đang có trong bảng công của kỳ (muốn 0 thì ghi 0) — thiếu người là lỗi, không
//    âm thầm giữ số máy.
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { khoaKyCong } from "./khieu-nai-khoa-ky";
import { buildPeriodSummary, getOrCreatePeriod, periodRange, type ChotQlTheoNguoi, type ChotTay, type PeriodKey, type PeriodPersonRow, type PeriodSummary } from "./period";

const so = (max: number) => z.number().finite().min(0).max(max);
const phut = z.number().int().min(0).max(20_000);

export const dongChotSchema = z.object({
  userId: z.string().min(1),
  /** Công đi làm chốt (đã gồm công bù nếu có). */
  units: so(62),
  /** Ngày phép chốt. */
  leaveUnits: so(31),
  lateCount: z.number().int().min(0).max(200),
  lateMinutes: phut,
  earlyLeaveCount: z.number().int().min(0).max(200),
  earlyLeaveMinutes: phut,
  ghiChu: z.string().trim().max(1000).optional(),
  /** Chi tiết tuỳ ý QL muốn lưu kèm (công bù, tiết dạy, phần theo cơ sở…). */
  chiTiet: z.record(z.string(), z.unknown()).optional(),
});
export type DongChot = z.infer<typeof dongChotSchema>;

export const chotSoQlSchema = z.object({
  centerId: z.string().min(1),
  ky: z.string().regex(/^\d{4}-\d{2}$/),
  lyDo: z.string().trim().min(10, "Lý do tối thiểu 10 ký tự").max(500),
  rows: z.array(dongChotSchema).min(1).max(500),
});

export type { ChotQlTheoNguoi, ChotTay };

type NguoiMoi = { name: string; employeeCode: string | null; jobTitle: string | null };

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * THUẦN: áp số QL lên summary. Trả lỗi (danh sách) nếu: trùng người, thiếu người đang có trong bảng công,
 * hoặc người mới mà không có hồ sơ.
 */
export function apDungChotSoQl(
  summary: PeriodSummary,
  rows: DongChot[],
  nguoiMoi: Map<string, NguoiMoi>,
  chot: ChotTay,
): { ok: true; summary: PeriodSummary } | { ok: false; loi: string[] } {
  const loi: string[] = [];
  const theoId = new Map<string, DongChot>();
  for (const r of rows) {
    if (theoId.has(r.userId)) loi.push(`Trùng người: ${r.userId}`);
    theoId.set(r.userId, r);
  }
  const coSan = new Set(summary.rows.map((r) => r.userId));
  for (const r of summary.rows) if (!theoId.has(r.userId)) loi.push(`Thiếu số chốt cho ${r.employeeCode ?? r.userId} (${r.name}) — muốn 0 thì ghi 0`);
  for (const id of theoId.keys()) if (!coSan.has(id) && !nguoiMoi.has(id)) loi.push(`Không tìm thấy nhân sự ${id}`);
  if (loi.length) return { ok: false, loi };

  const apMot = (base: PeriodPersonRow, d: DongChot): PeriodPersonRow => ({
    ...base,
    units: r2(d.units),
    leaveUnits: r2(d.leaveUnits),
    lateCount: d.lateCount,
    lateMinutes: d.lateMinutes,
    earlyLeaveCount: d.earlyLeaveCount,
    earlyLeaveMinutes: d.earlyLeaveMinutes,
    chotQl: {
      soMay: {
        units: base.units,
        leaveUnits: base.leaveUnits,
        lateCount: base.lateCount,
        lateMinutes: base.lateMinutes,
        earlyLeaveCount: base.earlyLeaveCount,
        earlyLeaveMinutes: base.earlyLeaveMinutes,
      },
      ...(d.ghiChu ? { ghiChu: d.ghiChu } : {}),
      ...(d.chiTiet ? { chiTiet: d.chiTiet } : {}),
    },
  });

  const out: PeriodPersonRow[] = summary.rows.map((r) => apMot(r, theoId.get(r.userId)!));
  for (const [id, d] of theoId) {
    if (coSan.has(id)) continue;
    const p = nguoiMoi.get(id)!;
    out.push(apMot(dongRong(id, p), d));
  }
  return {
    ok: true,
    summary: {
      ...summary,
      rows: out,
      chotTay: chot,
      totals: { ...summary.totals, people: out.length, units: r2(out.reduce((s, r) => s + r.units, 0)) },
    },
  };
}

function dongRong(userId: string, p: NguoiMoi): PeriodPersonRow {
  return {
    userId, name: p.name, employeeCode: p.employeeCode, jobTitle: p.jobTitle,
    units: 0, expectedUnits: 0, leaveUnits: 0, holidayPaidUnits: 0, hourCredit: 0, workedMinutes: 0, expectedMinutes: 0,
    lateCount: 0, lateMinutes: 0, earlyLeaveCount: 0, earlyLeaveMinutes: 0, otMinutes: 0, holidayWorkMinutes: 0, restDayWorkMinutes: 0,
    workedDays: 0, scheduledDays: 0, missingTapDays: 0, overrideDays: 0, flaggedDays: 0, teachingSessions: 0,
    noiQuy: { caQuyDinh: 0, caThucTe: 0, soLanTre: 0, ngayKhongPhep: 0, ngayChoKetLuan: 0, phanTramTru: 0 },
    grid: {}, unitsByDay: {},
  };
}

export type KetQuaChotSoQl = { ok: true; people: number; units: number } | { ok: false; error: string };

/** Ghi: kỳ phải đã kết thúc + CHƯA TỪNG khoá. Khoá kỳ + đóng băng ngày công như `lockPeriod`. */
export async function chotKyTheoSoQl(input: {
  centerId: string;
  periodKey: PeriodKey;
  rows: DongChot[];
  lyDo: string;
  actorId: string;
  actorName: string;
  now?: Date;
}): Promise<KetQuaChotSoQl> {
  const now = input.now ?? new Date();
  const { from, to } = periodRange(input.periodKey);
  if (to.getTime() > now.getTime()) return { ok: false, error: "Kỳ chưa kết thúc" };
  const center = await db.center.findUnique({ where: { id: input.centerId }, select: { id: true } });
  if (!center) return { ok: false, error: "Không có cơ sở này" };
  const period = await getOrCreatePeriod(input.centerId, input.periodKey);
  if (period.status !== "OPEN" || period.lockedAt) {
    return { ok: false, error: "Kỳ này đã chốt (hoặc từng chốt) — chốt theo số QL chỉ làm MỘT lần cho kỳ chưa từng khoá" };
  }

  const summary = await buildPeriodSummary(input.centerId, input.periodKey);
  const coSan = new Set(summary.rows.map((r) => r.userId));
  const moi = input.rows.map((r) => r.userId).filter((id) => !coSan.has(id));
  const users = moi.length
    ? await db.user.findMany({ where: { id: { in: moi } }, select: { id: true, name: true, email: true, employee: { select: { employeeCode: true, jobTitle: true } } } })
    : [];
  const nguoiMoi = new Map<string, NguoiMoi>(
    users.map((u) => [u.id, { name: u.name ?? u.email ?? u.id, employeeCode: u.employee?.employeeCode ?? null, jobTitle: u.employee?.jobTitle ?? null }]),
  );
  const ap = apDungChotSoQl(summary, input.rows, nguoiMoi, { boi: input.actorName, luc: now.toISOString(), lyDo: input.lyDo });
  if (!ap.ok) return { ok: false, error: ap.loi.join("\n") };

  await db.$transaction(
    async (tx) => {
      await khoaKyCong(tx, input.centerId, input.periodKey);
      const lock = await tx.attendancePeriod.updateMany({
        where: { id: period.id, status: "OPEN", lockedAt: null },
        data: {
          status: "LOCKED",
          lockedById: input.actorId,
          lockedAt: now,
          lockReason: `Chốt theo số QL: ${input.lyDo}`,
          summaryJson: ap.summary as unknown as Prisma.InputJsonValue,
          standardUnits: period.standardUnits ?? ap.summary.standardUnits ?? undefined,
        },
      });
      if (lock.count === 0) throw new Error("Kỳ vừa được người khác chốt");
      await tx.staffAttendanceDay.updateMany({
        where: { centerId: input.centerId, workDate: { gte: from, lte: to } },
        data: { status: "LOCKED", periodId: period.id },
      });
    },
    { timeout: 60_000 },
  );
  return { ok: true, people: ap.summary.totals.people, units: ap.summary.totals.units };
}
