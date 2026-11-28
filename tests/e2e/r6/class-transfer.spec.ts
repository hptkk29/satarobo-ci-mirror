/**
 * R6-E2 — Chuyển lớp giữa kỳ cùng mức phí (atomic, sức chứa, audit, quyền chéo cơ sở).
 * Postgres LOCAL (.env.test).
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import { approveTransfer } from "../../../lib/transfer/service";
import { canApproveTransfer, isSameFeeTransfer } from "../../../lib/transfer/transfer-policy";

async function course(slug: string) {
  return db.course.create({ data: { name: slug, slug } });
}
async function klass(name: string, courseId: string, centerId?: string, maxStudents = 20) {
  return db.class.create({ data: { name, courseId, centerId: centerId ?? null, maxStudents, status: "ACTIVE" } });
}
async function student(name: string, centerId?: string) {
  return db.student.create({ data: { name, status: "ACTIVE", centerId: centerId ?? null } });
}

test.describe("[R6-E2] Chuyển lớp giữa kỳ", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[R6-E2-T1-01] duyệt chuyển atomic: enrollment cũ TRANSFERRED, lớp đích STUDYING + audit", async () => {
    const c = await course("sata1-e2");
    const from = await klass("Lớp nguồn", c.id);
    const to = await klass("Lớp đích", c.id);
    const st = await student("Bé Bình");
    const oldEnr = await db.enrollment.create({
      data: { studentId: st.id, classId: from.id, courseId: c.id, status: "STUDYING" },
    });
    const req = await db.studentTransferRequest.create({
      data: { studentId: st.id, fromClassId: from.id, toClassId: to.id, status: "PENDING", reason: "gần nhà" },
    });

    const res = await approveTransfer(req.id, "admin-1", "ok", {
      actor: { id: "admin-1", name: "Admin" },
      reason: "phụ huynh yêu cầu",
    });
    expect(res.ok).toBe(true);

    expect((await db.enrollment.findUnique({ where: { id: oldEnr.id } }))!.status).toBe("TRANSFERRED");
    const newEnr = await db.enrollment.findFirst({ where: { studentId: st.id, classId: to.id } });
    expect(newEnr!.status).toBe("STUDYING");

    const log = await db.auditLog.findFirst({
      where: { module: "transfer", entityType: "StudentTransferRequest", entityId: req.id },
    });
    expect(log).not.toBeNull();
    expect(log!.reason).toBe("phụ huynh yêu cầu");
  });

  test("[R6-E2-T1-02] khác khoá (khác mức phí) → chặn", async () => {
    const c1 = await course("sata1-x");
    const c2 = await course("sata2-x");
    const from = await klass("Nguồn", c1.id);
    const to = await klass("Đích khác khoá", c2.id);
    const st = await student("Bé C");
    await db.enrollment.create({ data: { studentId: st.id, classId: from.id, courseId: c1.id, status: "STUDYING" } });
    const req = await db.studentTransferRequest.create({
      data: { studentId: st.id, fromClassId: from.id, toClassId: to.id, status: "PENDING" },
    });
    const res = await approveTransfer(req.id, "admin-1", null);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("phí");
  });

  test("[R6-E2-T7-01] lớp đích đầy → chặn", async () => {
    const c = await course("sata1-full");
    const from = await klass("Nguồn", c.id);
    const to = await klass("Đích đầy", c.id, undefined, 1); // maxStudents=1
    const other = await student("Đã chiếm chỗ");
    await db.enrollment.create({ data: { studentId: other.id, classId: to.id, courseId: c.id, status: "STUDYING" } });
    const st = await student("Bé D");
    await db.enrollment.create({ data: { studentId: st.id, classId: from.id, courseId: c.id, status: "STUDYING" } });
    const req = await db.studentTransferRequest.create({
      data: { studentId: st.id, fromClassId: from.id, toClassId: to.id, status: "PENDING" },
    });
    const res = await approveTransfer(req.id, "admin-1", null);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("hết chỗ");
  });

  test("[R6-E2-T9-01] canApproveTransfer: cross-center cần thấy cả 2 cơ sở", () => {
    const cm1 = { isSuperAdmin: false, isHoLevel: false, visibleCenterIds: ["cs1"] };
    // cùng CS1 → ok
    expect(canApproveTransfer(cm1, { fromCenterId: "cs1", toCenterId: "cs1" })).toBe(true);
    // CS1→CS2 nhưng CM chỉ thấy CS1 → chặn
    expect(canApproveTransfer(cm1, { fromCenterId: "cs1", toCenterId: "cs2" })).toBe(false);
    // SUPER_ADMIN → mọi nơi
    expect(canApproveTransfer({ isSuperAdmin: true, isHoLevel: false, visibleCenterIds: [] }, { fromCenterId: "cs1", toCenterId: "cs2" })).toBe(true);
    // HO-level → mọi nơi
    expect(canApproveTransfer({ isSuperAdmin: false, isHoLevel: true, visibleCenterIds: [] }, { fromCenterId: "cs1", toCenterId: "cs2" })).toBe(true);
    expect(isSameFeeTransfer("c1", "c1")).toBe(true);
    expect(isSameFeeTransfer("c1", "c2")).toBe(false);
  });
});
