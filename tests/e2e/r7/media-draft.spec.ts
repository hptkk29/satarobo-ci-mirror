/**
 * KHO ẢNH buổi học (DRAFT) — GV upload cả loạt vào kho, chọn ảnh gửi PH sau.
 * Postgres LOCAL (.env.test). Test service-level (mẫu bulk-convert.spec): gọi thẳng
 * createDraftMediaBatch / publishClassMedia / deleteDraftMedia, không dựng HTTP.
 *
 * Phủ: tạo lô DRAFT không tag; publish tag → PENDING/APPROVED (autoApprove);
 * C6.2 (không tag & không class-wide → reject); C6.3 (HS chưa consent → reject);
 * portal query không trả DRAFT; xoá kho chỉ đụng row DRAFT.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedUser } from "../_helpers/seed";
import {
  createDraftMediaBatch,
  publishClassMedia,
  deleteDraftMedia,
} from "../../../lib/lms/media-publish";

test.describe("[KHO] Kho ảnh buổi học (DRAFT)", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  let seq = 0;
  const uniq = () => `${Date.now().toString(36)}-${seq++}`;

  async function seedCenter(code = "CS1") {
    return db.center.create({
      data: { code, name: `Cơ sở ${code}`, slug: `cs-${code.toLowerCase()}-${uniq()}`, address: "x" },
    });
  }

  /** Lớp + buổi + GV phụ trách + HS (đang học, consent tuỳ chọn). */
  async function seedClassroom(opts: { studentConsents: boolean[] }) {
    const center = await seedCenter();
    const teacher = await seedUser({
      email: `gv-${uniq()}@test.com`,
      role: "TEACHER",
      name: "GV Kho",
      centerId: center.id,
    });
    const course = await db.course.create({
      data: { name: `Sata ${uniq()}`, slug: `sata-${uniq()}`, price: 4_000_000 },
    });
    const cls = await db.class.create({
      data: { name: `Lớp ${uniq()}`, courseId: course.id, centerId: center.id, teacherId: teacher.id },
    });
    const ses = await db.classSession.create({
      data: { classId: cls.id, date: new Date("2026-07-20T02:00:00Z"), topic: "Buổi 5", centerId: center.id },
    });
    const students = [];
    for (let i = 0; i < opts.studentConsents.length; i++) {
      const st = await db.student.create({ data: { name: `HV ${i + 1} ${uniq()}` } });
      // Enrollment ∈ SCOPED_MODELS — luôn set centerId khi create (bất biến FL3-02).
      await db.enrollment.create({
        data: {
          studentId: st.id,
          classId: cls.id,
          courseId: course.id,
          status: "CONFIRMED",
          centerId: center.id,
        },
      });
      if (opts.studentConsents[i]) {
        await db.studentConsent.create({
          data: { studentId: st.id, type: "CLASS_MEDIA", status: "GRANTED" },
        });
      }
      students.push(st);
    }
    const actor = { id: teacher.id, name: "GV Kho" };
    return { center, teacher, course, cls, ses, students, actor };
  }

  const files = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      fileUrl: `https://r2.test/media/${uniq()}-${i}.jpg`,
      fileName: `anh-${i}.jpg`,
    }));

  test("[KHO-01] createDraftMediaBatch tạo N DRAFT không tag, gắn buổi + takenAt fallback ngày buổi, 1 audit lms", async () => {
    const { cls, ses, actor } = await seedClassroom({ studentConsents: [true] });

    const res = await createDraftMediaBatch(actor, {
      classId: cls.id,
      classSessionId: ses.id,
      files: files(3),
      uploadedById: actor.id,
      uploadedByName: actor.name,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ids).toHaveLength(3);

    const rows = await db.classSessionMedia.findMany({
      where: { id: { in: res.ids } },
      include: { tags: true },
    });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === "DRAFT")).toBe(true);
    expect(rows.every((r) => r.isClassWide === false)).toBe(true);
    expect(rows.every((r) => r.tags.length === 0)).toBe(true);
    expect(rows.every((r) => r.classSessionId === ses.id)).toBe(true);
    // takenAt không truyền → fallback ngày buổi.
    expect(rows.every((r) => r.takenAt?.toISOString() === ses.date.toISOString())).toBe(true);

    // 1 audit cho CẢ LÔ (không spam N record).
    const audits = await db.auditLog.findMany({
      where: { module: "lms", action: "MEDIA_DRAFT_BATCH_CREATE" },
    });
    expect(audits).toHaveLength(1);
  });

  test("[KHO-02] publish với studentIds → tag đúng + PENDING khi autoApprove=false (GV gửi, chờ duyệt)", async () => {
    const { cls, students, actor } = await seedClassroom({ studentConsents: [true, true] });
    const created = await createDraftMediaBatch(actor, {
      classId: cls.id,
      files: files(2),
      uploadedById: actor.id,
      uploadedByName: actor.name,
    });
    if (!created.ok) throw new Error("seed draft fail");

    const res = await publishClassMedia(actor, {
      mediaIds: created.ids,
      studentIds: [students[0]!.id, students[1]!.id],
      autoApprove: false,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.status).toBe("PENDING");
    expect(res.count).toBe(2);

    const rows = await db.classSessionMedia.findMany({
      where: { id: { in: created.ids } },
      include: { tags: true },
    });
    expect(rows.every((r) => r.status === "PENDING")).toBe(true);
    expect(rows.every((r) => r.tags.length === 2)).toBe(true);
    // GV gửi → KHÔNG có dấu duyệt.
    expect(rows.every((r) => r.approvedById === null && r.approvedAt === null)).toBe(true);
  });

  test("[KHO-03] publish autoApprove=true (QL) → APPROVED luôn + approvedBy* set", async () => {
    const { cls, students, actor } = await seedClassroom({ studentConsents: [true] });
    const ql = await seedUser({ email: `ql-${uniq()}@test.com`, role: "CENTER_MANAGER", name: "QL Kho" });
    const created = await createDraftMediaBatch(actor, {
      classId: cls.id,
      files: files(2),
      uploadedById: actor.id,
      uploadedByName: actor.name,
    });
    if (!created.ok) throw new Error("seed draft fail");

    const res = await publishClassMedia(
      { id: ql.id, name: "QL Kho" },
      { mediaIds: created.ids, studentIds: [students[0]!.id], autoApprove: true },
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.status).toBe("APPROVED");

    const rows = await db.classSessionMedia.findMany({ where: { id: { in: created.ids } } });
    expect(rows.every((r) => r.status === "APPROVED")).toBe(true);
    expect(rows.every((r) => r.approvedById === ql.id && r.approvedByName === "QL Kho")).toBe(true);
    expect(rows.every((r) => r.approvedAt !== null)).toBe(true);
  });

  test("[KHO-04] C6.2 — publish KHÔNG tag KHÔNG isClassWide → reject, ảnh vẫn DRAFT", async () => {
    const { cls, actor } = await seedClassroom({ studentConsents: [true] });
    const created = await createDraftMediaBatch(actor, {
      classId: cls.id,
      files: files(1),
      uploadedById: actor.id,
      uploadedByName: actor.name,
    });
    if (!created.ok) throw new Error("seed draft fail");

    const res = await publishClassMedia(actor, { mediaIds: created.ids, autoApprove: false });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("NO_TARGET");
    const row = await db.classSessionMedia.findUniqueOrThrow({ where: { id: created.ids[0]! } });
    expect(row.status).toBe("DRAFT");
  });

  test("[KHO-05] C6.3 — publish tag HS CHƯA consent → reject, không ghi tag, ảnh vẫn DRAFT", async () => {
    // HS[0] có consent, HS[1] KHÔNG.
    const { cls, students, actor } = await seedClassroom({ studentConsents: [true, false] });
    const created = await createDraftMediaBatch(actor, {
      classId: cls.id,
      files: files(1),
      uploadedById: actor.id,
      uploadedByName: actor.name,
    });
    if (!created.ok) throw new Error("seed draft fail");

    const res = await publishClassMedia(actor, {
      mediaIds: created.ids,
      studentIds: [students[0]!.id, students[1]!.id],
      autoApprove: false,
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("NO_CONSENT");
    expect(await db.mediaStudentTag.count()).toBe(0);
    const row = await db.classSessionMedia.findUniqueOrThrow({ where: { id: created.ids[0]! } });
    expect(row.status).toBe("DRAFT");
  });

  test("[KHO-06] portal query (where như lib/portal/photos.ts) KHÔNG trả DRAFT", async () => {
    const { cls, students, actor } = await seedClassroom({ studentConsents: [true] });
    const student = students[0]!;

    // 2 ảnh vào kho; 1 ảnh publish+approve (tag con), 1 ảnh Ở LẠI kho.
    const created = await createDraftMediaBatch(actor, {
      classId: cls.id,
      files: files(2),
      uploadedById: actor.id,
      uploadedByName: actor.name,
    });
    if (!created.ok) throw new Error("seed draft fail");
    const pub = await publishClassMedia(actor, {
      mediaIds: [created.ids[0]!],
      studentIds: [student.id],
      autoApprove: true,
    });
    expect(pub.ok).toBe(true);

    // Dựng ĐÚNG where của getStudentPhotos (lib/portal/photos.ts — file có
    // "server-only" nên không import được trong Playwright): APPROVED + (tag con
    // HOẶC class-wide) trong các lớp con đang học.
    const visible = await db.classSessionMedia.findMany({
      where: {
        classId: { in: [cls.id] },
        status: "APPROVED",
        OR: [{ tags: { some: { studentId: student.id } } }, { isClassWide: true }],
      },
      select: { id: true, status: true },
    });
    expect(visible).toHaveLength(1);
    expect(visible[0]!.id).toBe(created.ids[0]!);
    // Ảnh còn trong kho tuyệt đối không lọt.
    expect(visible.some((m) => m.id === created.ids[1]!)).toBe(false);
    expect(
      await db.classSessionMedia.count({ where: { id: created.ids[1]!, status: "DRAFT" } }),
    ).toBe(1);
  });

  test("[KHO-07] deleteDraftMedia chỉ xoá DRAFT — PENDING/APPROVED nguyên vẹn", async () => {
    const { cls, students, actor } = await seedClassroom({ studentConsents: [true] });
    const created = await createDraftMediaBatch(actor, {
      classId: cls.id,
      files: files(3),
      uploadedById: actor.id,
      uploadedByName: actor.name,
    });
    if (!created.ok) throw new Error("seed draft fail");
    const [stayDraft, toPending, toApproved] = created.ids as [string, string, string];

    // Đưa 2 ảnh rời kho: 1 PENDING (GV gửi), 1 APPROVED (QL gửi).
    const p1 = await publishClassMedia(actor, {
      mediaIds: [toPending],
      studentIds: [students[0]!.id],
      autoApprove: false,
    });
    const p2 = await publishClassMedia(actor, {
      mediaIds: [toApproved],
      isClassWide: true,
      autoApprove: true,
    });
    expect(p1.ok && p2.ok).toBe(true);

    // Gọi xoá với CẢ 3 id → chỉ row DRAFT bị xoá.
    const res = await deleteDraftMedia(actor, { mediaIds: [stayDraft, toPending, toApproved] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.deleted).toBe(1);

    expect(await db.classSessionMedia.count({ where: { id: stayDraft } })).toBe(0);
    const pending = await db.classSessionMedia.findUniqueOrThrow({ where: { id: toPending } });
    const approved = await db.classSessionMedia.findUniqueOrThrow({ where: { id: toApproved } });
    expect(pending.status).toBe("PENDING");
    expect(approved.status).toBe("APPROVED");
    expect(approved.isClassWide).toBe(true);
  });
});
