/**
 * FL4-02 — PORTAL đọc phiếu đánh giá BUỔI HỌC (SESSION_EVAL) cho phụ huynh.
 * Postgres LOCAL (.env.test). SKELETON — KHÔNG chạy trong CI (chờ chốt seed Eval* FL).
 *
 * Bao phủ (tầng helper DB — page cần auth/cookie, test riêng ở manual):
 *  C1 — getStudentSessionEvals trả phiếu của ĐÚNG con (đợt SESSION_EVAL × buổi × HS),
 *       render đúng loại câu hỏi; con khác KHÔNG lẫn (không lộ studentId / cách ly con).
 *  C2 — ẢNH buổi gate theo StudentConsent CLASS_MEDIA: chưa GRANTED → map rỗng;
 *       GRANTED → trả ảnh APPROVED gắn thẻ con hoặc isClassWide; ảnh HS khác ẩn (C6.2).
 *  C3 — thu hồi consent → ảnh ẩn ngay.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import {
  getStudentSessionEvals,
  getSessionMediaForStudent,
} from "../../../lib/eval/session-eval-portal";
import { grantMediaConsent, revokeMediaConsent } from "../../../lib/lms/media-consent";

async function seedCenter(id: string) {
  await db.center.upsert({
    where: { id },
    create: { id, name: id, code: id, slug: id.toLowerCase(), address: "test" },
    update: {},
  });
}

async function seedFormRound() {
  const form = await db.evalForm.create({
    data: {
      title: "Phiếu đánh giá buổi học",
      scope: "SESSION_EVAL",
      status: "ACTIVE",
      questions: {
        create: [
          { type: "STAR_RATING", label: "Mức độ tập trung", required: true, order: 0 },
          {
            type: "RADIO",
            label: "Thái độ",
            options: ["Tích cực", "Bình thường"],
            required: false,
            order: 1,
          },
          { type: "TEXTBOX", label: "Nhận xét", required: false, order: 2 },
        ],
      },
    },
    include: { questions: { orderBy: { order: "asc" } } },
  });
  const round = await db.evaluationRound.create({
    data: { formId: form.id, name: "Đợt buổi học", scope: "SESSION_EVAL", status: "OPEN" },
  });
  return { form, round };
}

async function seedClassSession(centerId: string) {
  const course = await db.course.create({ data: { name: "Khoá Sata 3", slug: `sata3-${Date.now()}` } });
  const cls = await db.class.create({
    data: { name: "Lớp Sata 3 A", classCode: "S3A", courseId: course.id, centerId, status: "ACTIVE" },
    select: { id: true },
  });
  const sess = await db.classSession.create({
    data: { classId: cls.id, date: new Date(), status: "SCHEDULED" },
    select: { id: true },
  });
  const con = await db.student.create({ data: { name: "Con A", centerId }, select: { id: true } });
  const other = await db.student.create({ data: { name: "HS khác", centerId }, select: { id: true } });
  return { cls, sess, con, other };
}

test.describe("[FL4-02] Portal SESSION_EVAL", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[FL4-02-C1] getStudentSessionEvals chỉ trả phiếu của con + render đúng loại", async () => {
    await seedCenter("CS1");
    const { form, round } = await seedFormRound();
    const { sess, con, other } = await seedClassSession("CS1");
    const [qStar, qRadio, qText] = form.questions;

    await db.evalResponse.create({
      data: {
        roundId: round.id,
        classSessionId: sess.id,
        studentId: con.id,
        answers: {
          create: [
            { questionId: qStar!.id, valueNumber: 4 },
            { questionId: qRadio!.id, valueOptions: ["Tích cực"] },
            { questionId: qText!.id, valueText: "Tiến bộ rõ" },
          ],
        },
      },
    });
    // Phiếu của HS khác — KHÔNG được lẫn vào kết quả của con.
    await db.evalResponse.create({
      data: {
        roundId: round.id,
        classSessionId: sess.id,
        studentId: other.id,
        answers: { create: [{ questionId: qStar!.id, valueNumber: 2 }] },
      },
    });

    const cards = await getStudentSessionEvals(con.id);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.classSessionId).toBe(sess.id);
    expect(cards[0]!.answers.map((a) => a.type)).toEqual(["STAR_RATING", "RADIO", "TEXTBOX"]);
    expect(cards[0]!.answers[0]!.stars).toBe(4);
    expect(cards[0]!.classCode).toBe("S3A");
  });

  test("[FL4-02-C2] ảnh buổi gate theo consent: chưa GRANTED → rỗng; GRANTED → hiện", async () => {
    await seedCenter("CS1");
    const { sess, con } = await seedClassSession("CS1");
    await db.classSessionMedia.create({
      data: {
        classId: (await db.classSession.findUniqueOrThrow({ where: { id: sess.id }, select: { classId: true } })).classId,
        classSessionId: sess.id,
        fileUrl: "https://example/img.jpg",
        status: "APPROVED",
        isClassWide: true,
      },
    });

    // Chưa consent → không ảnh.
    expect((await getSessionMediaForStudent(con.id, [sess.id])).size).toBe(0);

    // GRANTED → có ảnh class-wide.
    await grantMediaConsent(con.id);
    const granted = await getSessionMediaForStudent(con.id, [sess.id]);
    expect(granted.get(sess.id)?.length).toBe(1);

    // Thu hồi → ẩn ngay (C3).
    await revokeMediaConsent(con.id);
    expect((await getSessionMediaForStudent(con.id, [sess.id])).size).toBe(0);
  });

  /**
   * F-04 — KÊNH ẢNH THỨ HAI. Ảnh đính TRONG PHIẾU (câu hỏi loại PHOTO, URL nằm ở
   * EvalAnswer.valueOptions) trước đây đi thẳng tới phụ huynh: không có bản ghi
   * ClassSessionMedia nào nên không cổng duyệt nào chạm tới. Case này khoá cả 3 nước:
   * chờ duyệt → ẩn · đã duyệt → hiện · ảnh cũ không có bản ghi → giữ nguyên (điều
   * khoản chuyển tiếp, xem lib/eval/session-eval-photo-gate.ts).
   */
  test("[F-04-C4] ảnh trong phiếu nhận xét chỉ tới phụ huynh khi ĐÃ DUYỆT", async () => {
    await seedCenter("CS1");
    const { sess, con } = await seedClassSession("CS1");
    const classId = (
      await db.classSession.findUniqueOrThrow({
        where: { id: sess.id },
        select: { classId: true },
      })
    ).classId;

    const form = await db.evalForm.create({
      data: {
        title: "Phiếu buổi có ảnh",
        scope: "SESSION_EVAL",
        status: "ACTIVE",
        questions: { create: [{ type: "PHOTO", label: "Ảnh dự án", required: false, order: 0 }] },
      },
      include: { questions: true },
    });
    const round = await db.evaluationRound.create({
      data: { formId: form.id, name: "Đợt có ảnh", scope: "SESSION_EVAL", status: "OPEN" },
    });
    const qPhoto = form.questions[0]!;

    const CHO_DUYET = "https://example/cho-duyet.jpg";
    const DA_DUYET = "https://example/da-duyet.jpg";
    const ANH_CU = "https://example/anh-cu.jpg";

    await db.evalResponse.create({
      data: {
        roundId: round.id,
        classSessionId: sess.id,
        studentId: con.id,
        answers: {
          create: [{ questionId: qPhoto.id, valueOptions: [CHO_DUYET, DA_DUYET, ANH_CU] }],
        },
      },
    });
    // Bản sao trong hàng duyệt: 1 chờ duyệt, 1 đã duyệt. ANH_CU CỐ Ý không có bản ghi
    // (mô phỏng ảnh lưu trước bản vá — phụ huynh đang xem, không được biến mất).
    await db.classSessionMedia.createMany({
      data: [
        { classId, classSessionId: sess.id, fileUrl: CHO_DUYET, status: "PENDING", isClassWide: false },
        { classId, classSessionId: sess.id, fileUrl: DA_DUYET, status: "APPROVED", isClassWide: false },
      ],
    });

    await grantMediaConsent(con.id);
    const cards = await getStudentSessionEvals(con.id);
    expect(cards).toHaveLength(1);
    const photos = cards[0]!.answers.find((a) => a.type === "PHOTO")?.photos ?? [];
    expect(photos).toEqual([DA_DUYET, ANH_CU]);
    expect(photos).not.toContain(CHO_DUYET);

    // QLCS duyệt nốt → ảnh xuất hiện, không cần GV lưu lại phiếu.
    await db.classSessionMedia.updateMany({
      where: { fileUrl: CHO_DUYET },
      data: { status: "APPROVED" },
    });
    const sau = await getStudentSessionEvals(con.id);
    expect(sau[0]!.answers.find((a) => a.type === "PHOTO")?.photos).toContain(CHO_DUYET);

    // Từ chối → biến mất khỏi cổng phụ huynh.
    await db.classSessionMedia.updateMany({
      where: { fileUrl: DA_DUYET },
      data: { status: "REJECTED" },
    });
    const cuoi = await getStudentSessionEvals(con.id);
    expect(cuoi[0]!.answers.find((a) => a.type === "PHOTO")?.photos).not.toContain(DA_DUYET);
  });
});
