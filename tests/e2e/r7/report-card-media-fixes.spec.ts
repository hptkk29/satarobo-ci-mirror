/**
 * FIX 02/08 — vá HỌC BẠ + ẢNH THEO BUỔI (rà soát lớp học). Postgres LOCAL (.env.test).
 * Test service-level (mẫu bulk-convert.spec / media-draft.spec): gọi thẳng lib,
 * không dựng HTTP (Server Action cần auth() — các cổng lib dưới đây chính là chỗ
 * action chặn/đi qua).
 *
 * Phủ:
 *  A1 — reportCardPeriodDisplay: SESSION_5/SESSION_12 → nhãn tiếng Việt (PH không
 *       thấy mã kỹ thuật trên web/PDF).
 *  A2 — enrollment XOÁ MỀM: biến mất khỏi list admin (where deletedAt: null),
 *       getEnrollmentContext null (save/transition/editor cùng bị chặn), handler
 *       publish KHÔNG tạo thông báo ma.
 *  A3 — snapshot phát hành giữ đúng thứ tự tiêu chí theo criteria.order
 *       (orderScoresByCriteria — đúng code _actions.ts dùng khi PUBLISH).
 *  B1 — loadClassMediaItems tách cửa sổ DRAFT: 120 DRAFT + 5 PENDING → vẫn đủ 5 PENDING.
 *  B3 — publishClassMedia với classSessionId → ảnh gắn đúng buổi (panel GV mới truyền).
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedUser } from "../_helpers/seed";
import {
  buildPublishedSnapshot,
  computeReportCardMetrics,
  getCourseCriteria,
  getEnrollmentContext,
  orderScoresByCriteria,
  reportCardPeriodDisplay,
} from "../../../lib/lms/report-card";
import { milestoneLabel, milestonePeriodKey } from "../../../lib/lms/report-card-milestone";
import { onReportCardPublished } from "../../../lib/_handlers/report-card";
import { loadClassMediaItems } from "../../../lib/classes/detail-tabs-data";
import { createDraftMediaBatch, publishClassMedia } from "../../../lib/lms/media-publish";

let seq = 0;
const uniq = () => `${Date.now().toString(36)}-${seq++}`;

async function seedCenter() {
  // Center.code unique — vài test seed NHIỀU center trong 1 case nên code phải unique.
  const code = `CS-${uniq()}`;
  return db.center.create({
    data: { code, name: `Cơ sở ${code}`, slug: `cs-${code.toLowerCase()}`, address: "x" },
  });
}

/** Center + course + class + 1 HV đang học (enrollment CONFIRMED, có centerId). */
async function seedClassWithStudent(opts?: { studentName?: string }) {
  const center = await seedCenter();
  const course = await db.course.create({
    data: { name: `Sata ${uniq()}`, slug: `sata-${uniq()}`, price: 4_000_000 },
  });
  const cls = await db.class.create({
    data: { name: `Lớp ${uniq()}`, courseId: course.id, centerId: center.id },
  });
  const student = await db.student.create({
    data: { name: opts?.studentName ?? `HV ${uniq()}`, centerId: center.id },
  });
  // Enrollment ∈ SCOPED_MODELS — luôn set centerId khi create (bất biến FL3-02).
  const enr = await db.enrollment.create({
    data: {
      studentId: student.id,
      classId: cls.id,
      courseId: course.id,
      status: "CONFIRMED",
      centerId: center.id,
    },
  });
  return { center, course, cls, student, enr };
}

test.describe("[FIX-0208] Học bạ + ảnh theo buổi", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  // ── A1 — PH không thấy mã kỹ thuật SESSION_5/SESSION_12 ─────────────────────
  test("[A1] reportCardPeriodDisplay map khoá kỳ chuẩn → nhãn tiếng Việt, period tự do giữ nguyên", async () => {
    // Cùng nguồn nhãn với editor (milestoneLabel) — renderer web + PDF dùng hàm này.
    expect(milestonePeriodKey(5)).toBe("SESSION_5");
    expect(milestonePeriodKey(12)).toBe("SESSION_12");
    expect(reportCardPeriodDisplay("SESSION_5")).toBe(milestoneLabel(5));
    expect(reportCardPeriodDisplay("SESSION_12")).toBe(milestoneLabel(12));
    // Nhãn là tiếng Việt, không lộ mã kỹ thuật.
    expect(reportCardPeriodDisplay("SESSION_5")).toBe("Kỳ 1 — buổi 5");
    expect(reportCardPeriodDisplay("SESSION_12")).toBe("Kỳ 2 — buổi 12");
    expect(reportCardPeriodDisplay("SESSION_5")).not.toContain("SESSION");
    // Khoảng trắng thừa (dữ liệu period lưu lỏng) vẫn map được.
    expect(reportCardPeriodDisplay("  SESSION_5 ")).toBe("Kỳ 1 — buổi 5");
    // Period tự do cũ (không phải khoá kỳ chuẩn) in nguyên văn.
    expect(reportCardPeriodDisplay("Giữa khoá")).toBe("Giữa khoá");
    expect(reportCardPeriodDisplay("SESSION_7")).toBe("SESSION_7");
  });

  // ── A2 — enrollment xoá mềm không lọt luồng học bạ ───────────────────────────
  test("[A2a] enrollment xoá mềm: biến khỏi list admin + getEnrollmentContext null (save/publish cùng bị chặn)", async () => {
    const { cls, course, center, enr: alive } = await seedClassWithStudent();
    // HV thứ 2 cùng lớp — bị XOÁ MỀM (deletedAt set, status GIỮ NGUYÊN — đúng bug).
    const ghostStudent = await db.student.create({ data: { name: "HV Đã Xoá", centerId: center.id } });
    const ghost = await db.enrollment.create({
      data: {
        studentId: ghostStudent.id,
        classId: cls.id,
        courseId: course.id,
        status: "STUDYING",
        centerId: center.id,
        deletedAt: new Date(),
      },
    });

    // List admin (app/(admin)/admin/report-cards/page.tsx dùng ĐÚNG where này qua sdb —
    // scopedDb không tự lọc deletedAt nên filter phải nằm trong where).
    const listRows = await db.enrollment.findMany({
      where: { classId: cls.id, deletedAt: null },
      select: { id: true },
    });
    expect(listRows.map((r) => r.id)).toEqual([alive.id]);

    // Cổng chung của saveReportCardAction / transitionReportCardAction / editor page:
    // ghi danh xoá mềm → null → action trả "Không tìm thấy đăng ký học" (hết nhập/duyệt/
    // PHÁT HÀNH); ghi danh sống vẫn đi qua bình thường.
    expect(await getEnrollmentContext(ghost.id)).toBeNull();
    const ctx = await getEnrollmentContext(alive.id);
    expect(ctx?.enrollmentId).toBe(alive.id);
    expect(ctx?.classId).toBe(cls.id);
  });

  test("[A2b] handler reportcard.published: enrollment xoá mềm → KHÔNG tạo thông báo ma; enrollment sống → có", async () => {
    const { enr: alive, student } = await seedClassWithStudent();
    const { enr: ghostEnr, student: ghostStudent } = await seedClassWithStudent({
      studentName: "HV Ma",
    });
    await db.enrollment.update({ where: { id: ghostEnr.id }, data: { deletedAt: new Date() } });

    // Ghi danh xoá mềm → handler bỏ qua (PH không nhận "Học bạ đã phát hành" trong khi
    // portal ẩn học bạ của ghi danh đã xoá — getPublishedReportCards lọc deletedAt).
    await onReportCardPublished({
      id: `evt-ghost-${uniq()}`,
      type: "reportcard.published",
      payload: { reportCardId: `rc-${uniq()}`, enrollmentId: ghostEnr.id },
    });
    expect(await db.notification.count({ where: { studentId: ghostStudent.id } })).toBe(0);

    // Sanity: ghi danh sống vẫn được thông báo như cũ.
    await onReportCardPublished({
      id: `evt-alive-${uniq()}`,
      type: "reportcard.published",
      payload: { reportCardId: `rc-${uniq()}`, enrollmentId: alive.id },
    });
    expect(await db.notification.count({ where: { studentId: student.id } })).toBe(1);
  });

  // ── A3 — snapshot phát hành giữ đúng thứ tự tiêu chí ─────────────────────────
  test("[A3] snapshot phát hành xếp scores theo criteria.order; điểm tiêu chí đã tắt giữ cuối", async () => {
    const { course, enr } = await seedClassWithStudent();

    // Tạo tiêu chí với order ĐẢO thứ tự tạo (createdAt ≠ order) — getCourseCriteria
    // phải trả [order asc, createdAt asc].
    const cTuDuy = await db.reportCardCriterion.create({
      data: { courseId: course.id, name: "Tư duy", order: 2, active: true },
    });
    const cLapRap = await db.reportCardCriterion.create({
      data: { courseId: course.id, name: "Lắp ráp", order: 0, active: true },
    });
    const cLapTrinh = await db.reportCardCriterion.create({
      data: { courseId: course.id, name: "Lập trình", order: 1, active: true },
    });
    const cTat = await db.reportCardCriterion.create({
      data: { courseId: course.id, name: "Tiêu chí đã tắt", order: 9, active: false },
    });

    const criteria = await getCourseCriteria(course.id);
    expect(criteria.map((c) => c.name)).toEqual(["Lắp ráp", "Lập trình", "Tư duy"]);

    // scores đến theo "thứ tự DB tuỳ ý" (mô phỏng findMany không orderBy) + 1 điểm
    // của tiêu chí đã TẮT — đúng shape _actions.ts đọc từ reportCardScore.findMany.
    const scoresDbOrder = [
      { criterionId: cTuDuy.id, level: 3, note: null },
      { criterionId: cTat.id, level: 2, note: null },
      { criterionId: cLapTrinh.id, level: 4, note: "ghi chú" },
      { criterionId: cLapRap.id, level: 1, note: null },
    ];
    // ĐÚNG pipeline PUBLISH của _actions.ts: orderScoresByCriteria → buildPublishedSnapshot.
    const metrics = await computeReportCardMetrics(enr.id);
    const snapshot = buildPublishedSnapshot({
      metrics,
      reportCard: { finalComment: null, completionStatus: null, periodComments: [] },
      scores: orderScoresByCriteria(scoresDbOrder, criteria),
      criteria,
      student: { name: "HV A3", studentCode: null },
      course: { name: "Khoá A3" },
      className: "Lớp A3",
      publishedAt: new Date(),
    });

    expect(snapshot.scores.map((s) => s.name)).toEqual([
      "Lắp ráp",
      "Lập trình",
      "Tư duy",
      "(tiêu chí)", // điểm của tiêu chí đã tắt: không rơi mất, nằm cuối
    ]);
    expect(snapshot.scores.map((s) => s.level)).toEqual([1, 4, 3, 2]);
  });

  // ── B1 — tab Ảnh của admin class hub không để DRAFT nuốt cửa sổ ──────────────
  test("[B1] loadClassMediaItems: 120 DRAFT + 5 PENDING → kết quả vẫn đủ 5 PENDING", async () => {
    const { cls } = await seedClassWithStudent();

    // 120 DRAFT MỚI HƠN 5 PENDING (bug cũ: take 100 theo createdAt desc → PENDING bị đẩy
    // khỏi cửa sổ, tab Ảnh không còn gì để duyệt).
    const old = new Date("2026-07-01T02:00:00Z");
    const pendingIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const row = await db.classSessionMedia.create({
        data: {
          classId: cls.id,
          fileUrl: `https://r2.test/p-${uniq()}.jpg`,
          status: "PENDING",
          isClassWide: true,
          createdAt: new Date(old.getTime() + i * 1000),
        },
        select: { id: true },
      });
      pendingIds.push(row.id);
    }
    await db.classSessionMedia.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        classId: cls.id,
        fileUrl: `https://r2.test/d-${uniq()}-${i}.jpg`,
        status: "DRAFT" as const,
        isClassWide: false,
      })),
    });

    const items = await loadClassMediaItems(cls.id, "Lớp B1");
    const gotPending = items.filter((m) => m.status === "PENDING").map((m) => m.id);
    expect(gotPending.sort()).toEqual([...pendingIds].sort()); // đủ cả 5, không thiếu cái nào
    // DRAFT vẫn hiện (cửa sổ riêng 100) — không mất kho, không nuốt hàng duyệt.
    expect(items.filter((m) => m.status === "DRAFT").length).toBe(100);
  });

  // ── B3 — gửi ảnh kho kèm gán buổi (panel GV giờ truyền classSessionId) ───────
  test("[B3] publishClassMedia có classSessionId → ảnh gắn đúng buổi + takenAt fallback ngày buổi", async () => {
    const { center, cls } = await seedClassWithStudent();
    const teacher = await seedUser({
      email: `gv-b3-${uniq()}@test.com`,
      role: "TEACHER",
      name: "GV B3",
      centerId: center.id,
    });
    const actor = { id: teacher.id, name: "GV B3" };
    const ses = await db.classSession.create({
      data: { classId: cls.id, date: new Date("2026-07-20T02:00:00Z"), topic: "Buổi 5", centerId: center.id },
    });

    // Lô DRAFT KHÔNG gắn buổi (đúng hiện trạng panel cũ để lại).
    const created = await createDraftMediaBatch(actor, {
      classId: cls.id,
      files: [
        { fileUrl: `https://r2.test/b3-${uniq()}-0.jpg`, fileName: "a0.jpg" },
        { fileUrl: `https://r2.test/b3-${uniq()}-1.jpg`, fileName: "a1.jpg" },
      ],
      uploadedById: actor.id,
      uploadedByName: actor.name,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const before = await db.classSessionMedia.findMany({ where: { id: { in: created.ids } } });
    expect(before.every((r) => r.classSessionId === null && r.takenAt === null)).toBe(true);

    // Payload đúng như DraftStorePanel gửi: isClassWide + classSessionId.
    const res = await publishClassMedia(actor, {
      mediaIds: created.ids,
      isClassWide: true,
      classSessionId: ses.id,
      autoApprove: false,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.status).toBe("PENDING");

    const rows = await db.classSessionMedia.findMany({ where: { id: { in: created.ids } } });
    expect(rows.every((r) => r.classSessionId === ses.id)).toBe(true);
    // Ảnh chưa có ngày chụp → fallback ngày buổi (album PH gom đúng nhóm buổi).
    expect(rows.every((r) => r.takenAt?.toISOString() === ses.date.toISOString())).toBe(true);

    // Buổi của LỚP KHÁC → chặn (không gắn chéo lớp bằng payload tuỳ ý).
    const other = await seedClassWithStudent();
    const otherSes = await db.classSession.create({
      data: {
        classId: other.cls.id,
        date: new Date("2026-07-21T02:00:00Z"),
        centerId: other.center.id,
      },
    });
    const created2 = await createDraftMediaBatch(actor, {
      classId: cls.id,
      files: [{ fileUrl: `https://r2.test/b3-${uniq()}-2.jpg`, fileName: "a2.jpg" }],
      uploadedById: actor.id,
      uploadedByName: actor.name,
    });
    expect(created2.ok).toBe(true);
    if (!created2.ok) return;
    const bad = await publishClassMedia(actor, {
      mediaIds: created2.ids,
      isClassWide: true,
      classSessionId: otherSes.id,
      autoApprove: false,
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.code).toBe("SESSION_WRONG_CLASS");
    // Ảnh vẫn nguyên trong kho.
    const stay = await db.classSessionMedia.findUniqueOrThrow({ where: { id: created2.ids[0]! } });
    expect(stay.status).toBe("DRAFT");
  });
});
