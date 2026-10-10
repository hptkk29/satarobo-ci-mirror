/**
 * R6-G2 — Chống race tiền/convert: 2 convert song song → 1 bộ; double-confirm idempotent.
 * FIX-C4 — Chống TOCTOU bán vượt sĩ số lớp + âm kho (2 ghi song song → đúng 1 thành công).
 * Postgres LOCAL (.env.test).
 */
import { test, expect } from "@playwright/test";
import { Prisma } from "@prisma/client";
import { db } from "../../../lib/db";
import { resetDb, seedOrg } from "../_helpers/seed";
import { convertLeadToEnrollment, ConvertError } from "../../../lib/crm/convert-lead";
import { confirmOrderPayment } from "../../../lib/finance/debt";

// Trạng thái tính vào sĩ số lớp (đồng bộ enrollments/_actions.ts CAPACITY_COUNT_STATUSES).
const CAPACITY_STATUSES = ["PENDING", "CONFIRMED", "STUDYING", "ACTIVE"] as const;

const ACTOR = { id: "csm", name: "Tư vấn" };

async function setup() {
  await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-g2", address: "a", city: "" } });
  await seedOrg(["HO", "CS1"]);
  const cs1 = (await db.center.findFirst({ where: { code: "CS1" }, select: { id: true } }))!.id;
  const course = await db.course.create({ data: { name: "Sata 1", slug: "sata-1-g2" } });
  const klass = await db.class.create({ data: { name: "Lớp A", courseId: course.id, centerId: cs1 } });
  const lead = await db.lead.create({
    data: { parentName: "Chị Lan", phone: "0901234567", centerId: cs1, status: "CHO_QUYET_DINH" },
  });
  return { cs1, course, klass, lead };
}

test.describe("[R6-G2] Chống race tiền/convert", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[R6-G2-T6-01] 2 convert SONG SONG cùng lead → đúng 1 bộ (student/order)", async () => {
    const { course, klass, lead } = await setup();
    const call = () =>
      convertLeadToEnrollment(ACTOR, {
        leadId: lead.id,
        classId: klass.id,
        courseId: course.id,
        parentEmail: "ph-g2@test.local",
        amount: 5_000_000,
      });

    const results = await Promise.allSettled([call(), call()]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1); // chỉ 1 lượt thành công
    expect(failed).toHaveLength(1);
    if (failed[0].status === "rejected") {
      expect(failed[0].reason).toBeInstanceOf(ConvertError);
      expect((failed[0].reason as ConvertError).code).toBe("ALREADY_ENROLLED");
    }

    // đúng 1 bộ trong DB.
    expect(await db.student.count()).toBe(1);
    expect(await db.order.count()).toBe(1);
    expect((await db.lead.findUnique({ where: { id: lead.id } }))!.status).toBe("DA_DANG_KY");
  });

  test("[R6-G2-T6-02] convert lần 2 (tuần tự) → ALREADY_ENROLLED, không tạo thêm bộ", async () => {
    const { course, klass, lead } = await setup();
    await convertLeadToEnrollment(ACTOR, {
      leadId: lead.id, classId: klass.id, courseId: course.id, parentEmail: "ph2@test.local", amount: 1,
    });
    await expect(
      convertLeadToEnrollment(ACTOR, {
        leadId: lead.id, classId: klass.id, courseId: course.id, parentEmail: "ph2@test.local", amount: 1,
      }),
    ).rejects.toThrow(/chốt/);
    expect(await db.student.count()).toBe(1);
  });

  test("[R6-G2-T6-03] double-confirm thanh toán idempotent → 1 lần đổi trạng thái", async () => {
    await db.center.create({ data: { code: "CS9", name: "CS9", slug: "cs9-g2", address: "a", city: "" } });
    const order = await db.order.create({
      data: { code: "ORD-G2-1", type: "COURSE", customerName: "PH", customerPhone: "0900000000", totalAmount: 1_000_000, status: "PENDING_PAYMENT" },
    });
    const first = await confirmOrderPayment(ACTOR, order.id, "thu tiền");
    const second = await confirmOrderPayment(ACTOR, order.id, "thu tiền lần 2");
    expect(first.alreadyConfirmed).toBe(false);
    expect(second.alreadyConfirmed).toBe(true); // idempotent
    // chỉ 1 audit STATUS_CHANGE cho order này.
    const logs = await db.auditLog.count({
      where: { module: "finance", entityType: "Order", entityId: order.id, action: "STATUS_CHANGE" },
    });
    expect(logs).toBe(1);
  });
});

/**
 * FIX-C4 — TOCTOU oversell. Test cơ chế guard ở tầng DB (giống hệt cách
 * `enrollments/_actions.ts` và `inventory/movements/_actions.ts` ghi): server
 * action bị `auth()` chặn nên test ở node-context tái dựng đúng truy vấn guard.
 */
test.describe("[FIX-C4] TOCTOU oversell guard", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[FIX-C4-T6-04] 2 ghi danh SONG SONG vào lớp maxStudents=1 → đúng 1 thành công", async () => {
    await db.center.create({ data: { code: "CSC4", name: "CSC4", slug: "csc4-enroll", address: "a", city: "" } });
    const center = (await db.center.findFirst({ where: { code: "CSC4" }, select: { id: true } }))!;
    const course = await db.course.create({ data: { name: "Sata 1", slug: "sata-1-c4" } });
    const klass = await db.class.create({
      data: { name: "Lớp 1 chỗ", courseId: course.id, centerId: center.id, maxStudents: 1 },
    });
    const s1 = await db.student.create({ data: { name: "HS A" } });
    const s2 = await db.student.create({ data: { name: "HS B" } });

    // Mirror enrollStudent: count + create trong CÙNG tx Serializable.
    const enroll = (studentId: string) =>
      db.$transaction(
        async (tx) => {
          const n = await tx.enrollment.count({
            where: { classId: klass.id, status: { in: [...CAPACITY_STATUSES] } },
          });
          if (n >= 1) throw new Error("CLASS_FULL");
          return tx.enrollment.create({
            data: { studentId, classId: klass.id, courseId: course.id, status: "PENDING" },
            select: { id: true },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

    const results = await Promise.allSettled([enroll(s1.id), enroll(s2.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    // Đúng 1 enrollment đang chiếm chỗ — không vượt sĩ số.
    const active = await db.enrollment.count({
      where: { classId: klass.id, status: { in: [...CAPACITY_STATUSES] } },
    });
    expect(active).toBe(1);
  });

  test("[FIX-C4-T6-05] 2 phiếu xuất SONG SONG vượt tồn → đúng 1 thành công, tồn không âm", async () => {
    await db.center.create({ data: { code: "CSC5", name: "CSC5", slug: "csc5-issue", address: "a", city: "" } });
    const center = (await db.center.findFirst({ where: { code: "CSC5" }, select: { id: true } }))!;
    const item = await db.inventoryItem.create({ data: { itemCode: "ITM-C4", name: "Robot kit" } });
    await db.stockBalance.create({ data: { itemId: item.id, centerId: center.id, quantity: 1 } });

    // Mirror recordIssue: tạo movement + guarded updateMany decrement; rollback nếu không đủ.
    const issue = () =>
      db.$transaction(async (tx) => {
        await tx.stockMovement.create({
          data: { itemId: item.id, centerId: center.id, type: "ISSUE", quantity: 1 },
        });
        const upd = await tx.stockBalance.updateMany({
          where: { itemId: item.id, centerId: center.id, quantity: { gte: 1 } },
          data: { quantity: { decrement: 1 } },
        });
        if (upd.count === 0) throw new Error("STOCK_INSUFFICIENT");
      });

    const results = await Promise.allSettled([issue(), issue()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    const bal = await db.stockBalance.findUniqueOrThrow({
      where: { itemId_centerId: { itemId: item.id, centerId: center.id } },
      select: { quantity: true },
    });
    expect(bal.quantity).toBe(0); // không âm

    // Phiếu xuất "ma" của lượt thất bại đã rollback → đúng 1 movement ISSUE.
    expect(
      await db.stockMovement.count({ where: { itemId: item.id, type: "ISSUE" } }),
    ).toBe(1);
  });

  test("[FIX-C4-T6-06] CHECK ở DB chặn tồn kho âm (backstop migration)", async () => {
    await db.center.create({ data: { code: "CSC6", name: "CSC6", slug: "csc6-check", address: "a", city: "" } });
    const center = (await db.center.findFirst({ where: { code: "CSC6" }, select: { id: true } }))!;
    const item = await db.inventoryItem.create({ data: { itemCode: "ITM-C6", name: "Servo" } });
    await db.stockBalance.create({ data: { itemId: item.id, centerId: center.id, quantity: 0 } });

    // Ghi trực tiếp xuống âm phải bị CHECK constraint chặn.
    await expect(
      db.stockBalance.update({
        where: { itemId_centerId: { itemId: item.id, centerId: center.id } },
        data: { quantity: { decrement: 5 } },
      }),
    ).rejects.toThrow();
  });
});
