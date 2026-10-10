"use server";

// app/(admin)/admin/cham-cong/ky-cong/_actions.ts — L5: kỳ công (tính lại, công chuẩn, chốt, mở lại).
// Quyền: `hr_attendance:close-period` tại cơ sở (chốt / sửa công chuẩn / tính lại);
// mở lại = `hr_attendance:close-period` ở cấp Hội sở (SUPER_ADMIN / kế toán HO) + lý do bắt buộc.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { writeAudit } from "@/lib/audit/audit-log";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { HO_CENTER_ID } from "@/lib/cham-cong/home-center";
import {
  computeStandardUnits,
  getOrCreatePeriod,
  lockPeriod,
  parsePeriodKey,
  periodRange,
  reopenPeriod,
} from "@/lib/cham-cong/period";
import { recomputeRange } from "@/lib/cham-cong/recompute";

type Res = { ok: true; note?: string } | { ok: false; error: string };

const base = z.object({
  centerId: z.string().min(1),
  ky: z.string().refine((s) => !!parsePeriodKey(s), "Kỳ dạng YYYY-MM"),
});

async function gate(centerId: string): Promise<boolean> {
  return checkPermission("hr_attendance:close-period", { centerId });
}

export async function recomputePeriodAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = base.safeParse(input);
  if (!p.success)
    return {
      ok: false,
      error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  if (!(await gate(p.data.centerId)))
    return { ok: false, error: "Không có quyền" };
  const { from, to } = periodRange(p.data.ky);
  const sdb = scopedDb(await resolveActor(session.user.id));
  const ids = [
    ...new Set(
      (
        await sdb.shiftAssignment.findMany({
          where: {
            centerId: p.data.centerId,
            workDate: { gte: from, lte: to },
            status: "ACTIVE",
          },
          select: { userId: true },
          distinct: ["userId"],
        })
      ).map((a) => a.userId),
    ),
  ];
  const r = await recomputeRange(ids, from, to);
  revalidatePath("/cham-cong/ky-cong");
  return {
    ok: true,
    note: `Đã tính lại ${r.days} ngày công${r.locked ? ` (bỏ qua ${r.locked} ngày đã chốt)` : ""}`,
  };
}

export async function setStandardUnitsAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = base
    .extend({
      standardUnits: z.coerce.number().min(0).max(31).nullable(),
      note: z.string().trim().max(200).optional(),
    })
    .safeParse(input);
  if (!p.success)
    return {
      ok: false,
      error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  if (!(await gate(p.data.centerId)))
    return { ok: false, error: "Không có quyền" };
  const period = await getOrCreatePeriod(p.data.centerId, p.data.ky);
  if (period.status === "LOCKED")
    return { ok: false, error: "Kỳ đã chốt — mở lại trước khi sửa công chuẩn" };
  const value =
    p.data.standardUnits ??
    (await computeStandardUnits(p.data.centerId, p.data.ky));
  const sdb = scopedDb(await resolveActor(session.user.id));
  await sdb.attendancePeriod.update({
    where: { id: period.id },
    data: { standardUnits: value, standardUnitsNote: p.data.note || null },
  });
  await writeAudit({
    actor: { id: session.user.id, name: session.user.name ?? "" },
    module: "hr_attendance",
    entityType: "AttendancePeriod",
    entityId: period.id,
    action: "SET_STANDARD_UNITS",
    oldValues: { standardUnits: period.standardUnits },
    newValues: { standardUnits: value },
    reason: p.data.note,
  });
  revalidatePath("/cham-cong/ky-cong");
  return { ok: true, note: `Công chuẩn kỳ ${p.data.ky}: ${value}` };
}

export async function lockPeriodAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = base
    .extend({
      reason: z.string().trim().max(300).optional(),
      /** Đường vượt cổng "kỳ chưa buổi nào được chốt" — chỉ cấp Hội sở, bắt buộc lý do. */
      boQuaBuoiChuaChot: z.boolean().optional(),
    })
    .safeParse(input);
  if (!p.success)
    return {
      ok: false,
      error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  if (!(await gate(p.data.centerId)))
    return { ok: false, error: "Không có quyền chốt kỳ" };
  // ── ĐƯỜNG VƯỢT: cấp HỘI SỞ + lý do bắt buộc ────────────────────────────────
  //
  // Cổng chặn và đường vượt LÊN CÙNG MỘT LẦN, nếu không thì cuối tháng mọi cơ sở đều
  // không chốt được kỳ. Nhưng đường vượt phải ở cấp HO: cơ sở tự vượt cổng chặn của
  // chính mình thì cổng đó không tồn tại. Cùng khuôn `reopenPeriodAction`.
  if (p.data.boQuaBuoiChuaChot) {
    if (
      !(await checkPermission("hr_attendance:close-period", {
        centerId: HO_CENTER_ID,
      }))
    ) {
      return {
        ok: false,
        error:
          "Chỉ cấp Hội sở mới bỏ qua được cổng 'kỳ chưa buổi nào được chốt'",
      };
    }
    if ((p.data.reason ?? "").trim().length < 5) {
      return {
        ok: false,
        error: "Bỏ qua cổng chốt kỳ phải ghi lý do (tối thiểu 5 ký tự)",
      };
    }
  }

  const r = await lockPeriod({
    centerId: p.data.centerId,
    periodKey: p.data.ky,
    actorId: session.user.id,
    reason: p.data.reason || null,
    boQuaBuoiChuaChot: p.data.boQuaBuoiChuaChot === true,
  });
  if (!r.ok) return r;
  await writeAudit({
    actor: { id: session.user.id, name: session.user.name ?? "" },
    module: "hr_attendance",
    entityType: "AttendancePeriod",
    entityId: `${p.data.centerId}:${p.data.ky}`,
    action: "LOCK_PERIOD",
    newValues: {
      boQuaBuoiChuaChot: p.data.boQuaBuoiChuaChot === true,
      people: r.summary.totals.people,
      units: r.summary.totals.units,
      teachingSessions: r.summary.totals.teachingSessions,
      recomputedDays: r.days,
    },
    reason: p.data.reason,
  });
  revalidatePath("/cham-cong/ky-cong");
  revalidatePath("/cham-cong");
  return {
    ok: true,
    note: `Đã chốt: ${r.summary.totals.people} người · ${r.summary.totals.units} công · ${r.summary.totals.teachingSessions} buổi dạy`,
  };
}

export async function reopenPeriodAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = base
    .extend({
      reason: z
        .string()
        .trim()
        .min(5, "Lý do mở lại tối thiểu 5 ký tự")
        .max(300),
    })
    .safeParse(input);
  if (!p.success)
    return {
      ok: false,
      error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  if (
    !(await checkPermission("hr_attendance:close-period", {
      centerId: HO_CENTER_ID,
    }))
  )
    return {
      ok: false,
      error:
        "Chỉ cấp Hội sở (Quản trị tối cao / Kế toán HO) mới mở lại kỳ đã chốt",
    };
  const r = await reopenPeriod({
    centerId: p.data.centerId,
    periodKey: p.data.ky,
    actorId: session.user.id,
    reason: p.data.reason,
  });
  if (!r.ok) return r;
  await writeAudit({
    actor: { id: session.user.id, name: session.user.name ?? "" },
    module: "hr_attendance",
    entityType: "AttendancePeriod",
    entityId: `${p.data.centerId}:${p.data.ky}`,
    action: "REOPEN_PERIOD",
    reason: p.data.reason,
  });
  revalidatePath("/cham-cong/ky-cong");
  revalidatePath("/cham-cong");
  return {
    ok: true,
    note: "Đã mở lại kỳ — số đã chốt trước đó vẫn nằm trong nhật ký; chốt lại sẽ ghi bản mới.",
  };
}
