/**
 * #08 (L8.2, câu 40) — PH tạo yêu cầu → DomainEvent parent_request.created →
 * báo TẤT CẢ Sale + Quản lý cơ sở TẠI cơ sở của HV; idempotent (dispatch lặp không
 * nhân đôi); reminder 12h nhắc 1 lần. Service-level (Postgres LOCAL) — không drive UI
 * vì `@/lib/auth` là stub trả null trong bundle test (không mô phỏng được auth() PH).
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedUser } from "../_helpers/seed";
import { publishEvent } from "../../../lib/events/publish";
import { dispatchPendingEvents } from "../../../lib/events/dispatcher";
import { clearHandlers } from "../../../lib/events/registry";
import { registerParentRequestHandlers } from "../../../lib/events/handlers/parent-request";
import { runParentRequestReminder } from "../../../lib/portal/parent-request-notify";

const CS1 = "CS1";
const CS2 = "CS2";

async function seedCenters(): Promise<void> {
  for (const id of [CS1, CS2]) {
    await db.center.upsert({
      where: { id },
      create: { id, name: id, code: id, slug: id.toLowerCase(), address: "test" },
      update: {},
    });
  }
}

test.describe("[#08] parent_request.created notify + reminder", () => {
  test.beforeEach(async () => {
    await resetDb();
    clearHandlers();
    registerParentRequestHandlers();
    await seedCenters();
  });

  async function seedStaffAndStudent() {
    const sale1 = await seedUser({ email: "pr-sale1@t.local", role: "SALES_CSM", centerId: CS1 });
    const manager1 = await seedUser({ email: "pr-mgr1@t.local", role: "CENTER_MANAGER", centerId: CS1 });
    const sale2 = await seedUser({ email: "pr-sale2@t.local", role: "SALES_CSM", centerId: CS2 });
    const teacher1 = await seedUser({ email: "pr-tea1@t.local", role: "TEACHER", centerId: CS1 });
    const student = await db.student.create({
      data: { name: "Bé A", centerId: CS1 },
      select: { id: true },
    });
    return { sale1, manager1, sale2, teacher1, student };
  }

  test("[#08-T1] event → chỉ báo Sale + QL cơ sở CS1 (không CS2/teacher); event DONE", async () => {
    const { sale1, manager1, sale2, teacher1, student } = await seedStaffAndStudent();
    const req = await db.parentRequest.create({
      data: { studentId: student.id, type: "ABSENCE", content: "Xin nghỉ buổi mai", status: "PENDING" },
      select: { id: true },
    });
    await publishEvent(
      "parent_request.created",
      { requestId: req.id, studentId: student.id, centerId: CS1, type: "ABSENCE" },
      { dedupeKey: `parent_request.created:${req.id}` },
    );

    const r = await dispatchPendingEvents({ flagOn: true });
    expect(r.done).toBe(1);

    const notified = await db.staffNotification.findMany({
      where: { dedupeKey: `parent_request.created:${req.id}` },
      select: { userId: true, href: true, category: true },
    });
    const ids = notified.map((n) => n.userId).sort();
    expect(ids).toEqual([manager1.id, sale1.id].sort());
    expect(ids).not.toContain(sale2.id); // khác cơ sở
    expect(ids).not.toContain(teacher1.id); // sai vai trò
    // ABSENCE → href trang báo vắng; category PARENT_REQUEST.
    expect(notified.every((n) => n.href === "/parent-requests/bao-vang")).toBe(true);
    expect(notified.every((n) => n.category === "PARENT_REQUEST")).toBe(true);
  });

  test("[#08-T2] publish + dispatch lặp lại cùng dedupeKey → KHÔNG nhân đôi", async () => {
    const { student } = await seedStaffAndStudent();
    const req = await db.parentRequest.create({
      data: { studentId: student.id, type: "OTHER", content: "Hỏi thông tin lớp", status: "PENDING" },
      select: { id: true },
    });
    const payload = { requestId: req.id, studentId: student.id, centerId: CS1, type: "OTHER" };
    const key = `parent_request.created:${req.id}`;

    await publishEvent("parent_request.created", payload, { dedupeKey: key });
    await dispatchPendingEvents({ flagOn: true });
    // Producer idempotent (dedupeKey trùng) + consumer idempotent (upsert).
    await publishEvent("parent_request.created", payload, { dedupeKey: key });
    await dispatchPendingEvents({ flagOn: true });

    expect(await db.domainEvent.count({ where: { dedupeKey: key } })).toBe(1);
    expect(await db.staffNotification.count({ where: { dedupeKey: key } })).toBe(2); // sale1 + manager1
  });

  test("[#08-T3] reminder: PENDING quá 12h nhắc 1 lần; yêu cầu mới không nhắc; chạy lại không lặp", async () => {
    const { student } = await seedStaffAndStudent();
    const overdue = await db.parentRequest.create({
      data: {
        studentId: student.id,
        type: "MAKEUP",
        content: "Xin học bù buổi trước",
        status: "PENDING",
        createdAt: new Date(Date.now() - 13 * 3_600_000),
      },
      select: { id: true },
    });
    const fresh = await db.parentRequest.create({
      data: { studentId: student.id, type: "MAKEUP", content: "Yêu cầu mới gửi", status: "PENDING" },
      select: { id: true },
    });

    const r1 = await runParentRequestReminder();
    expect(r1.scanned).toBe(1); // chỉ yêu cầu quá hạn
    expect(
      await db.staffNotification.count({ where: { dedupeKey: `parent_request.reminder:${overdue.id}` } }),
    ).toBe(2);

    // Chạy lại → dedupeKey chặn nhân đôi (chỉ nhắc 1 lần).
    await runParentRequestReminder();
    expect(
      await db.staffNotification.count({ where: { dedupeKey: `parent_request.reminder:${overdue.id}` } }),
    ).toBe(2);

    // Yêu cầu mới (< 12h) không phát sinh nhắc.
    expect(
      await db.staffNotification.count({ where: { dedupeKey: `parent_request.reminder:${fresh.id}` } }),
    ).toBe(0);
  });
});
