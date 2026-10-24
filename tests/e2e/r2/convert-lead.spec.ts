/**
 * R2-02 ⚠️ — convert lead → enrollment trong 1 TRANSACTION (rollback safety). PG LOCAL.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg } from "../../e2e/_helpers/seed";
import { convertLeadToEnrollment, ConvertError, findConvertDuplicates } from "../../../lib/crm/convert-lead";
import { clearHandlers } from "../../../lib/events/registry";
import { registerLeadConvertedHandlers } from "../../../lib/crm/_handlers/lead-converted";
import { dispatchPendingEvents } from "../../../lib/events/dispatcher";

const ACTOR = { id: "csm", name: "Tư vấn" };

async function setup() {
  await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-cv", address: "a", city: "" } });
  await seedOrg(["HO", "CS1", "CS2"]);
  const cs1 = (await db.center.findFirst({ where: { code: "CS1" }, select: { id: true } }))!.id;
  const course = await db.course.create({ data: { name: "Sata 1", slug: "sata-1-cv" } });
  const klass = await db.class.create({ data: { name: "Lớp A", courseId: course.id, centerId: cs1 } });
  const lead = await db.lead.create({
    data: { parentName: "Chị Lan", phone: "0901234567", childName: "Bé Bi", centerId: cs1, status: "CHO_QUYET_DINH" },
  });
  return { cs1, course, klass, lead };
}

test.describe("[R2-02] Convert lead (transaction)", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[R2-02-C2.1][R2-02-C2.6][R2-04-C4.1] convert đầy đủ → tạo hết, lead DA_DANG_KY, parent PENDING (no password)", async () => {
    const { cs1, course, klass, lead } = await setup();
    const r = await convertLeadToEnrollment(ACTOR, {
      leadId: lead.id, classId: klass.id, courseId: course.id,
      parentEmail: "ph@test.local", amount: 5_000_000, paidAmount: 5_000_000,
    });
    expect((await db.lead.findUnique({ where: { id: lead.id } }))?.status).toBe("DA_DANG_KY");
    expect(r.student.centerId).toBe(cs1); // C2.6
    expect(r.parent.accountStatus).toBe("PENDING_ACTIVATION"); // C4.1
    expect(r.parent.password).toBeNull(); // C4.1 — không mật khẩu mặc định
    expect(await db.enrollment.count({ where: { studentId: r.student.id } })).toBe(1);
    expect(r.order.code).toMatch(/^INV-CS1-\d{4}-0001$/); // C3.1
    expect(r.order.status).toBe("CONFIRMED"); // đã thanh toán
    expect(r.order.centerId).toBe(cs1); // C3.2 — invoice gắn đúng center
    // C2.4 — AuditLog ghi convert (actor + chuyển trạng thái)
    const audit = await db.auditLog.findFirst({
      where: { entityType: "Lead", entityId: lead.id, action: "STATUS_CHANGE", module: "enrollment" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorName).toBe("Tư vấn");
  });

  test("[R2-02-C2.5] notify đi qua EVENT (sau commit): dispatch → email xác nhận vào hàng đợi", async () => {
    const { course, klass, lead } = await setup();
    await convertLeadToEnrollment(ACTOR, { leadId: lead.id, classId: klass.id, courseId: course.id, parentEmail: "ph-evt@test.local", amount: 1 });
    clearHandlers();
    registerLeadConvertedHandlers();
    await dispatchPendingEvents({ flagOn: true });
    expect(await db.emailQueue.count({ where: { toEmail: "ph-evt@test.local" } })).toBeGreaterThanOrEqual(1);
  });

  test("[R2-05-C5.1] findConvertDuplicates trả lead/student trùng phone (cảnh báo)", async () => {
    const { cs1 } = await setup();
    await db.lead.create({ data: { parentName: "Trùng", phone: "0907777777", centerId: cs1, status: "MOI" } });
    await db.student.create({ data: { name: "Bé cũ", parentPhone: "0907777777" } });
    const dup = await findConvertDuplicates("0907777777");
    expect(dup.leads.length).toBeGreaterThanOrEqual(1);
    expect(dup.students.length).toBe(1);
  });

  // AUTH-SĐT P1 (gom tồn dư 31/07) — ca PHỦ ĐỊNH cho lỗi ĐANG SỐNG trên prod.
  // Backfill 29/07 đưa mọi Lead.phone về canonical `84…`, trong khi form nhập của
  // sale gõ `0…`. Bản cũ so khớp ĐÚNG-BẰNG sau digit-strip ⇒ tra `0907…` KHÔNG khớp
  // `84907…` và hàm trả RỖNG trong im lặng — cảnh báo trùng "chạy" mà không cảnh báo.
  // Ca này ĐỎ trước khi vá.
  test("[R2-05-C5.1b] findConvertDuplicates khớp CHÉO dạng (DB canonical 84…, tra bằng 0…)", async () => {
    const { cs1 } = await setup();
    // DB lưu canonical — đúng hiện trạng prod sau backfill.
    await db.lead.create({ data: { parentName: "Trùng-84", phone: "84907777888", centerId: cs1, status: "MOI" } });
    await db.student.create({ data: { name: "Bé 84", parentPhone: "84907777888" } });

    // Sale gõ dạng nội địa.
    const byLocal = await findConvertDuplicates("0907777888");
    expect(byLocal.leads.length, "tra 0… không thấy lead lưu dạng 84…").toBeGreaterThanOrEqual(1);
    expect(byLocal.students.length, "tra 0… không thấy student lưu dạng 84…").toBe(1);

    // Và chiều ngược lại, kể cả khi người dùng gõ có khoảng trắng.
    const byCanonical = await findConvertDuplicates("+84 907 777 888");
    expect(byCanonical.leads.length).toBeGreaterThanOrEqual(1);
    expect(byCanonical.students.length).toBe(1);
  });

  test("[R2-02-C2.2] 1 bước lỗi → ROLLBACK toàn bộ (không student/order mồ côi)", async () => {
    const { course, lead } = await setup();
    await expect(
      convertLeadToEnrollment(ACTOR, {
        leadId: lead.id, classId: "class-không-tồn-tại", courseId: course.id,
        parentEmail: "ph2@test.local", amount: 1_000_000,
      }),
    ).rejects.toThrow(); // enrollment FK fail → rollback

    expect(await db.student.count()).toBe(0); // không mồ côi
    expect(await db.order.count()).toBe(0);
    expect(await db.user.count({ where: { email: "ph2@test.local" } })).toBe(0);
    expect((await db.lead.findUnique({ where: { id: lead.id } }))?.status).toBe("CHO_QUYET_DINH"); // chưa đổi
  });

  test("[R2-02-C2.3] event lead.converted phát SAU commit (thành công → có; rollback → không)", async () => {
    const { course, klass, lead } = await setup();
    await convertLeadToEnrollment(ACTOR, {
      leadId: lead.id, classId: klass.id, courseId: course.id, parentEmail: "ph3@test.local", amount: 1,
    });
    expect(await db.domainEvent.count({ where: { type: "lead.converted" } })).toBe(1);
  });

  test("[R2-03-C3.1] mã hoá đơn chạy tuần tự không trùng (0001, 0002)", async () => {
    const { cs1, course, klass } = await setup();
    const mk = async (i: number) =>
      db.lead.create({ data: { parentName: `KH${i}`, phone: `090000000${i}`, centerId: cs1, status: "MOI" } });
    const l1 = await mk(1);
    const l2 = await mk(2);
    const r1 = await convertLeadToEnrollment(ACTOR, { leadId: l1.id, classId: klass.id, courseId: course.id, parentEmail: "a@test.local", amount: 1 });
    const r2 = await convertLeadToEnrollment(ACTOR, { leadId: l2.id, classId: klass.id, courseId: course.id, parentEmail: "b@test.local", amount: 1 });
    expect(r1.order.code).toMatch(/-0001$/);
    expect(r2.order.code).toMatch(/-0002$/);
  });

  test("[R2-02] convert lại lead đã ENROLLED → từ chối", async () => {
    const { course, klass, lead } = await setup();
    await convertLeadToEnrollment(ACTOR, { leadId: lead.id, classId: klass.id, courseId: course.id, parentEmail: "c@test.local", amount: 1 });
    await expect(
      convertLeadToEnrollment(ACTOR, { leadId: lead.id, classId: klass.id, courseId: course.id, parentEmail: "c@test.local", amount: 1 }),
    ).rejects.toThrow(ConvertError);
  });
});
