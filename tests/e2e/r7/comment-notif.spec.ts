/**
 * R7-17 — comment.added handler (DomainEvent → Notification).
 *
 * SERVICE-LEVEL spec (Postgres LOCAL, .env.test). Gọi handler fn TRỰC TIẾP với
 * event tổng hợp { id, type, payload } sau khi seed Student/Center mà handler đọc.
 *
 * Nguồn event THẬT: GV lưu nhận xét per-HV (StudentSessionFeedback) trong
 * app/(admin)/admin/sessions/[id]/_actions.ts → saveSessionFeedback. Site đó gọi
 * auth() (Server Action) nên KHÔNG test được emit-path ở service-level — chỉ test
 * handler + hợp đồng dedupeKey (`comment.added:<commentId>`).
 *
 * Handler under test:
 *   - lib/_handlers/comment-notif.ts → onCommentAdded (Notification audience STUDENT)
 *
 * Chạy:  R7_SKIP_WEBSERVER=1 pnpm test:e2e:r7 comment-notif.spec.ts
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import type { DomainEventLite } from "../../../lib/events/registry";
import { onCommentAdded } from "../../../lib/_handlers/comment-notif";

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

// ─── comment.added → Notification audience STUDENT cho PH của HV + idempotent ────
test("[R7-17] onCommentAdded → Notification STUDENT (dedupe theo commentId) + replay", async () => {
  const center = await makeCenter("comment");
  const student = await db.student.create({
    data: { name: "HV Nhận xét", centerId: center.id },
    select: { id: true },
  });
  const commentId = uniq("fb"); // StudentSessionFeedback.id (giả lập)

  const evt = event("comment.added", {
    studentId: student.id,
    sessionId: uniq("sess"),
    commentId,
    byUserId: uniq("teacher"),
  });
  await onCommentAdded(evt);

  const dedupeKey = `comment.added:${commentId}`;
  const rows = await db.notification.findMany({ where: { dedupeKey } });
  expect(rows).toHaveLength(1);
  const n = rows[0];
  expect(n.audience).toBe("STUDENT");
  expect(n.studentId).toBe(student.id);
  expect(n.centerId).toBe(center.id); // resolve từ student.centerId (payload không có centerId)
  expect(n.title).toBe("Nhận xét mới từ giáo viên");
  expect(n.createdByName).toBe("Hệ thống");

  // Replay (idempotent qua dedupeKey unique) → vẫn đúng 1 dòng.
  await onCommentAdded(evt);
  expect(await db.notification.count({ where: { dedupeKey } })).toBe(1);

  // Sửa nhận xét = upsert cùng StudentSessionFeedback.id = cùng commentId → event mới
  // (event.id khác) nhưng dedupeKey theo commentId KHÔNG đổi → không tạo thông báo trùng.
  const evt2 = event("comment.added", {
    studentId: student.id,
    sessionId: uniq("sess"),
    commentId,
    byUserId: uniq("teacher"),
  });
  await onCommentAdded(evt2);
  expect(await db.notification.count({ where: { dedupeKey } })).toBe(1);
});

// ─── 2 HV khác nhau cùng buổi → 2 Notification RIÊNG (không lộ chéo) ─────────────
test("[R7-17] onCommentAdded — mỗi HV 1 Notification riêng theo commentId", async () => {
  const center = await makeCenter("comment2");
  const [a, b] = await Promise.all([
    db.student.create({ data: { name: "HV A", centerId: center.id }, select: { id: true } }),
    db.student.create({ data: { name: "HV B", centerId: center.id }, select: { id: true } }),
  ]);
  const fbA = uniq("fbA");
  const fbB = uniq("fbB");

  await onCommentAdded(event("comment.added", { studentId: a.id, commentId: fbA }));
  await onCommentAdded(event("comment.added", { studentId: b.id, commentId: fbB }));

  expect(await db.notification.count()).toBe(2);
  const rowA = await db.notification.findUnique({ where: { dedupeKey: `comment.added:${fbA}` } });
  const rowB = await db.notification.findUnique({ where: { dedupeKey: `comment.added:${fbB}` } });
  expect(rowA?.studentId).toBe(a.id);
  expect(rowB?.studentId).toBe(b.id);
});

// ─── payload thiếu studentId / student không tồn tại → no-op (không tạo) ──────────
test("[R7-17] onCommentAdded — studentId rỗng hoặc HV không tồn tại → no-op", async () => {
  await onCommentAdded(event("comment.added", { commentId: uniq("fb") }));
  await onCommentAdded(event("comment.added", { studentId: uniq("ghost"), commentId: uniq("fb") }));
  expect(await db.notification.count()).toBe(0);
});
