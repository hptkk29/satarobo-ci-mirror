/**
 * R7-17 — trial.schedule_changed handler (DomainEvent → StaffNotification).
 *
 * SERVICE-LEVEL spec (Postgres LOCAL, .env.test). Gọi handler fn TRỰC TIẾP với
 * event tổng hợp { id, type, payload } sau khi seed lead + Sale phụ trách.
 *
 * KHÔNG e2e qua updateTrialAction: action gọi auth() (stub null trong test bundle)
 * → trả "Chưa đăng nhập" trước khi tới publishEvent. Vì vậy test cô lập handler.
 *
 * Idempotent: gọi handler 2 lần (replay cùng giờ mới) → vẫn 1 dòng (dedupeKey kèm toAt).
 * Reschedule thật (toAt khác) → 1 dòng mới.
 *
 * Handler under test:
 *   - lib/_handlers/trial-schedule-notif.ts → onTrialScheduleChanged
 *
 * Chạy:  R7_SKIP_WEBSERVER=1 pnpm test:e2e:r7 trial-schedule-notif.spec.ts
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import type { DomainEventLite } from "../../../lib/events/registry";
import { onTrialScheduleChanged } from "../../../lib/_handlers/trial-schedule-notif";

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;

function event(type: string, payload: Record<string, unknown>): DomainEventLite {
  return { id: uniq("evt"), type, payload };
}

async function makeCenter(label: string) {
  return db.center.create({
    data: { code: uniq(`C-${label}`), name: label, slug: uniq(`c-${label}`), address: "a", city: "" },
    select: { id: true },
  });
}

test.beforeEach(async () => {
  await resetDb();
});

test("[R7-17] onTrialScheduleChanged → StaffNotification cho Sale phụ trách + idempotent replay + reschedule mới", async () => {
  const center = await makeCenter("tsched");
  const sale = await seedUser({ email: testEmail("sale-tsched"), role: "SALES_CSM" });

  const lead = await db.lead.create({
    data: { parentName: "PH Đổi Lịch", phone: "0900000020", assignedToId: sale.id, centerId: center.id },
    select: { id: true },
  });
  const trial = await db.trialClass.create({
    data: { leadId: lead.id, scheduledAt: new Date("2026-07-01T11:00:00.000Z"), centerId: center.id },
    select: { id: true },
  });

  const toAt = "2026-07-05T11:00:00.000Z";
  const evt = event("trial.schedule_changed", {
    trialId: trial.id,
    leadId: lead.id,
    fromAt: "2026-07-01T11:00:00.000Z",
    toAt,
  });

  await onTrialScheduleChanged(evt);

  const dedupeKey = `trial.schedule_changed:${trial.id}:${toAt}`;
  const rows = await db.staffNotification.findMany({ where: { dedupeKey } });
  expect(rows).toHaveLength(1);
  const n = rows[0];
  expect(n.userId).toBe(sale.id);
  expect(n.category).toBe("LEAD");
  expect(n.title).toBe("Đổi lịch học thử");
  expect(n.href).toBe(`/leads/${lead.id}`);
  expect(n.body).toContain("PH Đổi Lịch");

  // Replay cùng giờ mới → idempotent (@@unique([userId, dedupeKey])).
  await onTrialScheduleChanged(evt);
  expect(await db.staffNotification.count({ where: { dedupeKey } })).toBe(1);

  // Reschedule thật (toAt khác) → dòng mới.
  const toAt2 = "2026-07-09T11:00:00.000Z";
  await onTrialScheduleChanged(
    event("trial.schedule_changed", { trialId: trial.id, leadId: lead.id, fromAt: toAt, toAt: toAt2 }),
  );
  expect(await db.staffNotification.count({ where: { userId: sale.id } })).toBe(2);
});
