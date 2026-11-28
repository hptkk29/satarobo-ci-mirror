/**
 * R3-06 — media tag bắt buộc + consent (privacy-first, exit-criteria). PG LOCAL.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../../e2e/_helpers/seed";
import {
  grantMediaConsent,
  revokeMediaConsent,
  tagStudentToMedia,
  isMediaVisibleForStudent,
  ConsentError,
} from "../../../lib/lms/media-consent";

async function setup() {
  const course = await db.course.create({ data: { name: "Sata 1", slug: "sata-1-mc" } });
  const klass = await db.class.create({ data: { name: "Lớp M", courseId: course.id } });
  const student = await db.student.create({ data: { name: "Bé X" } });
  const media = await db.classSessionMedia.create({ data: { classId: klass.id, fileUrl: "r2://class-media/x.jpg", status: "APPROVED" } });
  return { klass, student, media };
}

test.describe("[R3-06] Media + consent", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[R3-06-C6.2] media KHÔNG tag → không hiển thị cho PH", async () => {
    const { media, student } = await setup();
    await grantMediaConsent(student.id);
    expect(await isMediaVisibleForStudent(media.id, student.id)).toBe(false); // chưa tag
  });

  test("[R3-06-C6.3] tag HS chưa GRANTED consent → từ chối", async () => {
    const { media, student } = await setup();
    await expect(tagStudentToMedia(media.id, student.id)).rejects.toThrow(ConsentError);
  });

  test("[R3-06-C6.1] có consent + tag + APPROVED → hiển thị", async () => {
    const { media, student } = await setup();
    await grantMediaConsent(student.id);
    await tagStudentToMedia(media.id, student.id);
    expect(await isMediaVisibleForStudent(media.id, student.id)).toBe(true);
  });

  test("[R3-06-C6.4] thu hồi consent → media có tag con đó ẩn ngay", async () => {
    const { media, student } = await setup();
    await grantMediaConsent(student.id);
    await tagStudentToMedia(media.id, student.id);
    expect(await isMediaVisibleForStudent(media.id, student.id)).toBe(true);
    await revokeMediaConsent(student.id);
    expect(await isMediaVisibleForStudent(media.id, student.id)).toBe(false); // ẩn ngay
  });

  // #08 (L7) — grant/revoke KÈM audit → ghi AuditLog (ai – GRANTED/REVOKED – nguồn).
  test("[#08-L7] grant/revoke có audit → AuditLog StudentConsent GRANTED rồi REVOKED", async () => {
    const { student } = await setup();
    const actor = { id: "u-audit-1", name: "PH Test" };

    await grantMediaConsent(student.id, { actor, source: "PORTAL_SELF_SERVICE" });
    await revokeMediaConsent(student.id, { actor, source: "PORTAL_SELF_SERVICE" });

    const logs = await db.auditLog.findMany({
      where: { entityType: "StudentConsent", entityId: student.id },
      orderBy: { createdAt: "asc" },
      select: { action: true, actorId: true, newValues: true },
    });
    expect(logs.map((l) => l.action)).toEqual(["CONSENT_GRANTED", "CONSENT_REVOKED"]);
    expect(logs.every((l) => l.actorId === "u-audit-1")).toBe(true);

    // Không truyền audit → KHÔNG phát sinh thêm log (backward-compat cho caller cũ/test).
    await grantMediaConsent(student.id);
    const after = await db.auditLog.count({
      where: { entityType: "StudentConsent", entityId: student.id },
    });
    expect(after).toBe(2);
  });
});
