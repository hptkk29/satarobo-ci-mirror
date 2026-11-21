/**
 * PHÂN PHỐI TÀI LIỆU CHO PH (luật chốt 02/08/2026) + vá rò rỉ portal learning.
 * Postgres LOCAL (.env.test). Spec service-level (R7_SKIP_WEBSERVER=1, mẫu
 * bulk-convert): gọi thẳng lib/portal/learning + lib/portal/dashboard, không dựng HTTP.
 *
 * Luật: PH CHỈ thấy bài tập/file hướng dẫn GV GIAO CHO CHÍNH LỚP của con vào buổi đó
 * (Assignment PUBLISHED/CLOSED gắn lesson) — KHÔNG dùng Document.isPublic (cờ toàn
 * cục ngân hàng tài liệu), TUYỆT ĐỐI không thấy giáo án nội bộ.
 *
 * Phủ: [TL-01] isPublic không còn là nguồn phân phối · [TL-02] file bài đã giao
 * (AssignmentDocument + AssignmentAttachment) hiện đúng, DRAFT/lớp khác không lộ ·
 * [TL-03] getAssignmentDetail chặn DRAFT qua URL · [TL-04] buổi CANCELLED không
 * tính "đã dạy" · [TL-05] FIX-C3 — ghi danh/khoản xóa mềm không tạo "nợ ma".
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedUser } from "../_helpers/seed";
import { getStudentLessons, getAssignmentDetail } from "../../../lib/portal/learning";
import { getParentDashboard } from "../../../lib/portal/dashboard";

const CENTER = "CS1";

let seq = 0;
const uniq = () => `${Date.now().toString(36)}-${seq++}`;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function seedCenter(): Promise<void> {
  await db.center.upsert({
    where: { id: CENTER },
    create: { id: CENTER, name: CENTER, code: CENTER, slug: CENTER.toLowerCase(), address: "test" },
    update: {},
  });
}

/** course→curriculum→lesson + lớp + HV enrollment STUDYING (lớp của con). */
async function seedLearningBase() {
  const slug = uniq();
  await seedCenter();
  const course = await db.course.create({
    data: { name: `Khoá ${slug}`, slug: `khoa-${slug}` },
    select: { id: true },
  });
  const curriculum = await db.curriculum.create({
    data: { name: `CT ${slug}`, courseId: course.id },
    select: { id: true },
  });
  const lesson = await db.lesson.create({
    data: { curriculumId: curriculum.id, order: 1, title: `Bài ${slug}` },
    select: { id: true },
  });
  const cls = await db.class.create({
    data: { name: `Lớp ${slug}`, courseId: course.id, centerId: CENTER, status: "ACTIVE" },
    select: { id: true },
  });
  const student = await db.student.create({
    data: { name: `HV ${slug}`, centerId: CENTER },
    select: { id: true },
  });
  await db.enrollment.create({
    data: { studentId: student.id, classId: cls.id, courseId: course.id, status: "STUDYING", centerId: CENTER },
  });
  return { courseId: course.id, curriculumId: curriculum.id, lessonId: lesson.id, classId: cls.id, studentId: student.id };
}

/** Buổi ĐÃ DẠY (quá khứ, COMPLETED) gắn lesson. */
async function seedTaughtSession(classId: string, lessonId: string, ago = 1) {
  return db.classSession.create({
    data: { classId, lessonId, date: daysAgo(ago), status: "COMPLETED", centerId: CENTER },
    select: { id: true },
  });
}

test.describe("[TAI-LIEU] Phân phối tài liệu cho PH theo luật 02/08/2026", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[TL-01] Document isPublic=true gắn lesson nhưng GV CHƯA giao bài nào → PH thấy 0 tài liệu", async () => {
    const { lessonId, classId, studentId } = await seedLearningBase();
    await seedTaughtSession(classId, lessonId);

    // Admin bật cờ Public trên ngân hàng tài liệu — trước đây là đủ để PH thấy.
    await db.document.create({
      data: {
        title: "Giáo án buổi 1 (bật Public nhầm)",
        type: "PDF",
        fileUrl: "https://r2.test/giao-an-b1.pdf",
        fileName: "giao-an-b1.pdf",
        fileSize: 1024,
        lessonId,
        isPublic: true,
      },
    });

    const lessons = await getStudentLessons(studentId);
    expect(lessons).toHaveLength(1); // buổi đã dạy → lesson vẫn hiện
    expect(lessons[0]!.documents).toHaveLength(0); // nhưng KHÔNG kèm tài liệu isPublic
  });

  test("[TL-02] GV giao bài PUBLISHED gắn lesson → PH thấy đúng file của bài (ngân hàng + upload trực tiếp); DRAFT và lớp khác KHÔNG lộ", async () => {
    const { courseId, lessonId, classId, studentId } = await seedLearningBase();
    await seedTaughtSession(classId, lessonId);

    // Tài liệu ngân hàng GV đính vào bài — isPublic=false để chứng minh cờ vô can.
    const bankDoc = await db.document.create({
      data: {
        title: "Phiếu hướng dẫn lắp ráp",
        type: "WORKSHEET",
        fileUrl: "https://r2.test/phieu-hd.pdf",
        fileName: "phieu-hd.pdf",
        fileSize: 2048,
        lessonId,
        isPublic: false,
      },
      select: { id: true },
    });

    const published = await db.assignment.create({
      data: { title: "BTVN buổi 1", description: "x", classId, lessonId, status: "PUBLISHED" },
      select: { id: true },
    });
    await db.assignmentDocument.create({
      data: { assignmentId: published.id, documentId: bankDoc.id },
    });
    const attachment = await db.assignmentAttachment.create({
      data: { assignmentId: published.id, fileUrl: "https://r2.test/de-bai.png", fileName: "de-bai.png" },
      select: { id: true },
    });

    // Nhiễu 1: bài DRAFT auto-sinh (kèm attachment) cùng lesson — chưa giao, không lộ.
    const draft = await db.assignment.create({
      data: { title: "BTVN nháp", description: "x", classId, lessonId, status: "DRAFT" },
      select: { id: true },
    });
    await db.assignmentAttachment.create({
      data: { assignmentId: draft.id, fileUrl: "https://r2.test/nhap.pdf", fileName: "nhap.pdf" },
    });

    // Nhiễu 2: LỚP KHÁC được giao bài cùng lesson — không phải lớp của con, không lộ.
    const otherClass = await db.class.create({
      data: { name: `Lớp khác ${uniq()}`, courseId, centerId: CENTER, status: "ACTIVE" },
      select: { id: true },
    });
    const otherAssignment = await db.assignment.create({
      data: { title: "BT lớp khác", description: "x", classId: otherClass.id, lessonId, status: "PUBLISHED" },
      select: { id: true },
    });
    await db.assignmentAttachment.create({
      data: { assignmentId: otherAssignment.id, fileUrl: "https://r2.test/lop-khac.pdf", fileName: "lop-khac.pdf" },
    });

    const lessons = await getStudentLessons(studentId);
    expect(lessons).toHaveLength(1);
    const docs = lessons[0]!.documents;
    expect(docs.map((d) => d.id).sort()).toEqual([bankDoc.id, attachment.id].sort());
    // File ngân hàng giữ title + type; file upload trực tiếp lấy fileName làm title, type null.
    expect(docs.find((d) => d.id === bankDoc.id)).toMatchObject({
      title: "Phiếu hướng dẫn lắp ráp",
      type: "WORKSHEET",
      fileUrl: "https://r2.test/phieu-hd.pdf",
    });
    expect(docs.find((d) => d.id === attachment.id)).toMatchObject({
      title: "de-bai.png",
      type: null,
      fileUrl: "https://r2.test/de-bai.png",
    });
  });

  test("[TL-03] bài DRAFT (auto-sinh) → getAssignmentDetail trả null; publish rồi mới đọc được", async () => {
    const { lessonId, classId, studentId } = await seedLearningBase();

    const draft = await db.assignment.create({
      data: { title: "BT auto-sinh", description: "x", classId, lessonId, status: "DRAFT" },
      select: { id: true },
    });
    await db.assignmentAttachment.create({
      data: { assignmentId: draft.id, fileUrl: "https://r2.test/de-som.pdf", fileName: "de-som.pdf" },
    });

    // DRAFT: đề + file tồn tại trước khi GV giao — đọc qua URL phải bị chặn.
    expect(await getAssignmentDetail(studentId, draft.id)).toBeNull();

    await db.assignment.update({ where: { id: draft.id }, data: { status: "PUBLISHED" } });
    const detail = await getAssignmentDetail(studentId, draft.id);
    expect(detail).not.toBeNull();
    expect(detail!.attachments.map((f) => f.fileName)).toEqual(["de-som.pdf"]);

    // CLOSED (hết hạn nộp) vẫn xem lại được — cùng bộ lọc với list.
    await db.assignment.update({ where: { id: draft.id }, data: { status: "CLOSED" } });
    expect(await getAssignmentDetail(studentId, draft.id)).not.toBeNull();
  });

  test("[TL-04] buổi CANCELLED gắn lesson → lesson KHÔNG vào danh sách 'đã dạy'", async () => {
    const { curriculumId, lessonId, classId, studentId } = await seedLearningBase();

    // Buổi quá khứ nhưng ĐÃ HỦY (R7-06 giữ nguyên date+lessonId) → không tính đã dạy.
    await db.classSession.create({
      data: { classId, lessonId, date: daysAgo(2), status: "CANCELLED", centerId: CENTER },
    });
    // Đối chứng: lesson 2 có buổi COMPLETED → vẫn hiện bình thường.
    const lesson2 = await db.lesson.create({
      data: { curriculumId, order: 2, title: "Bài đã dạy thật" },
      select: { id: true },
    });
    await seedTaughtSession(classId, lesson2.id);

    const lessons = await getStudentLessons(studentId);
    expect(lessons.map((l) => l.id)).toEqual([lesson2.id]);
  });

  test("[TL-05] FIX-C3 — ghi danh/khoản xóa mềm KHÔNG tạo 'nợ ma' trên card công nợ trang chủ", async () => {
    await seedCenter();
    const parent = await seedUser({ email: `ph-${uniq()}@test.com`, role: "PARENT" });
    const course = await db.course.create({
      data: { name: "Khoá nợ", slug: `khoa-no-${uniq()}` },
      select: { id: true },
    });
    const cls = await db.class.create({
      data: { name: "Lớp nợ", courseId: course.id, centerId: CENTER, status: "ACTIVE" },
      select: { id: true },
    });
    const student = await db.student.create({
      data: { name: "Bé Nợ", centerId: CENTER, parentUserId: parent.id },
      select: { id: true },
    });

    // Ghi danh SỐNG: 4tr, đã nộp CONFIRMED 1tr (sống) + 2tr (đã xóa mềm — không trừ).
    const alive = await db.enrollment.create({
      data: { studentId: student.id, classId: cls.id, courseId: course.id, status: "STUDYING", centerId: CENTER, finalPrice: 4_000_000 },
      select: { id: true },
    });
    // Ghi danh XÓA MỀM: 9tr chưa nộp — trước fix bị cộng thẳng vào công nợ.
    await db.enrollment.create({
      data: { studentId: student.id, classId: cls.id, courseId: course.id, status: "CANCELLED", centerId: CENTER, finalPrice: 9_000_000, deletedAt: new Date() },
    });
    const order = await db.order.create({
      data: { code: `ORD-${uniq()}`, type: "COURSE", customerName: "PH Nợ", customerPhone: "0905999999", centerId: CENTER },
      select: { id: true },
    });
    await db.payment.create({
      data: { orderId: order.id, enrollmentId: alive.id, amount: 1_000_000, method: "cash", paidDate: new Date(), accountantStatus: "CONFIRMED", centerId: CENTER },
    });
    await db.payment.create({
      data: { orderId: order.id, enrollmentId: alive.id, amount: 2_000_000, method: "cash", paidDate: new Date(), accountantStatus: "CONFIRMED", centerId: CENTER, deletedAt: new Date() },
    });

    const dash = await getParentDashboard(parent.id);
    // Chỉ ghi danh sống (4tr) trừ khoản CONFIRMED sống (1tr) = 3tr — không nợ ma 9tr,
    // không trừ khống 2tr từ khoản đã xóa.
    expect(dash.totalDebt).toBe(3_000_000);
  });
});
