/**
 * R7-17 (missing trigger) — account.activated handler.
 *
 * SERVICE-LEVEL spec (Postgres LOCAL, .env.test). Gọi handler fn TRỰC TIẾP với
 * event tổng hợp { id, type, payload } sau khi seed PH + HV — cô lập logic handler
 * khỏi dispatcher/outbox. Idempotency kiểm tra bằng cách replay handler 2 lần.
 *
 * Handler under test:
 *   - lib/_handlers/account-notif.ts → onAccountActivated
 *     (Notification audience STUDENT, dedupeKey = account.activated:<userId>)
 *
 * Chạy:  R7_SKIP_WEBSERVER=1 pnpm test:e2e:r7 account-notif.spec.ts
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import type { DomainEventLite } from "../../../lib/events/registry";
import { onAccountActivated } from "../../../lib/_handlers/account-notif";

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

// ─── account.activated → Notification chào mừng vào feed học viên đầu tiên ───────
test("[R7-17] onAccountActivated → Notification STUDENT cho HV đầu tiên + idempotent", async () => {
  const center = await makeCenter("acct");
  const parent = await seedUser({
    email: testEmail("parent-acct"),
    role: "PARENT",
    centerId: center.id,
  });
  const student = await db.student.create({
    data: { name: "Bé Bình", centerId: center.id, parentUserId: parent.id },
    select: { id: true },
  });

  const evt = event("account.activated", { userId: parent.id });
  await onAccountActivated(evt);

  const dedupeKey = `account.activated:${parent.id}`;
  const rows = await db.notification.findMany({ where: { dedupeKey } });
  expect(rows).toHaveLength(1);
  const n = rows[0];
  expect(n.audience).toBe("STUDENT");
  expect(n.studentId).toBe(student.id);
  expect(n.centerId).toBe(center.id);
  expect(n.title).toBe("Chào mừng đến với cổng phụ huynh Sata Robo");
  expect(n.createdByName).toBe("Hệ thống");

  // Replay (idempotent qua dedupeKey unique) → vẫn đúng 1 dòng.
  await onAccountActivated(evt);
  expect(await db.notification.count({ where: { dedupeKey } })).toBe(1);
});

// ─── studentId đính sẵn trong payload → dùng trực tiếp, không phải resolve ───────
test("[R7-17] onAccountActivated dùng studentId từ payload nếu có", async () => {
  const center = await makeCenter("acct2");
  const parent = await seedUser({ email: testEmail("parent-acct2"), role: "PARENT" });
  const student = await db.student.create({
    data: { name: "Bé Cường", centerId: center.id, parentUserId: parent.id },
    select: { id: true },
  });

  const evt = event("account.activated", { userId: parent.id, studentId: student.id });
  await onAccountActivated(evt);

  const rows = await db.notification.findMany({
    where: { dedupeKey: `account.activated:${parent.id}` },
  });
  expect(rows).toHaveLength(1);
  expect(rows[0].studentId).toBe(student.id);
  expect(rows[0].centerId).toBe(center.id);
});

// ─── PH chưa có học viên → không tạo thông báo (không có feed để gắn) ────────────
test("[R7-17] onAccountActivated không tạo Notification khi PH chưa có HV", async () => {
  const parent = await seedUser({ email: testEmail("parent-acct3"), role: "PARENT" });

  await onAccountActivated(event("account.activated", { userId: parent.id }));

  expect(
    await db.notification.count({ where: { dedupeKey: `account.activated:${parent.id}` } }),
  ).toBe(0);
});

// ─── payload thiếu userId → no-op ────────────────────────────────────────────────
test("[R7-17] onAccountActivated bỏ qua khi thiếu userId", async () => {
  await onAccountActivated(event("account.activated", {}));
  expect(await db.notification.count()).toBe(0);
});
