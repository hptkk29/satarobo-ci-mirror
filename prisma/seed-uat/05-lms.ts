// prisma/seed-uat/05-lms.ts — bài tập, học bạ, hoàn thành khoá, học bù, ảnh lớp, tài liệu.
//
// Màn được nuôi: /assignments · /assignments/templates · /report-cards ·
// /hoan-thanh-khoa · /hoc-bu · /media · /documents · /exams · /questions ·
// /teaching-materials · site giáo viên (chấm bài, nhận xét) · cổng phụ huynh.
//
// CA BIÊN CỐ Ý
//  · bài tập ĐÃ HẾT HẠN mà học viên CHƯA NỘP → màn chấm bài có việc tồn;
//  · học bạ ở cả 4 trạng thái (nháp / chờ duyệt / đã phát hành / thu hồi);
//  · ảnh lớp còn CHỜ DUYỆT → `uat.giaovu` có việc;
//  · buổi vắng có phép CHƯA XẾP BÙ → màn Học bù có hàng chờ.
import {
  db, buoc, xong, chance, int, makeRng, ngay, ngayGio, pick, taoThieu, uid,
  type CoId, type CoSo, type Uat,
} from "./_common";
import type { Prisma } from "@prisma/client";

// ⚠️ CÁC CỘT "AI LÀM" TRONG LMS TRỎ `Employee`, KHÔNG TRỎ `User`:
//   Assignment.createdById · AssignmentSubmission.gradedById · Document.uploadedById
//   Exam.createdById · Question.authorId · StockMovement/InventoryAudit.performedById
// Nhét id của `User` vào là vỡ khoá ngoại. Các cột khác (ReportCard.teacherId,
// publishedById, ClassSessionMedia.uploadedById…) là cột trần, không có khoá ngoại.

const DE_BAI = [
  "Lắp lại khung xe đã học và quay video chạy thử",
  "Vẽ sơ đồ nối dây cảm biến khoảng cách",
  "Viết chương trình cho xe rẽ trái khi gặp vật cản",
  "Ghi lại 3 lỗi thường gặp khi lắp bánh dẫn động",
  "Thiết kế nhiệm vụ mới cho robot của nhóm",
  "Chụp ảnh sản phẩm buổi học và mô tả cách hoạt động",
];

export async function seedLms(_coSo: CoSo[], uat: Uat) {
  const rng = makeRng(5005);

  const lops = await db.class.findMany({
    where: { id: { startsWith: "uat-lop-" }, status: { in: ["ACTIVE", "COMPLETED"] } },
    select: { id: true, centerId: true, courseId: true, status: true, name: true },
  });
  const gds = await db.enrollment.findMany({
    where: { id: { startsWith: "uat-gd-" } },
    select: { id: true, studentId: true, classId: true, centerId: true, courseId: true, status: true },
  });
  const gdTheoLop = new Map<string, typeof gds>();
  for (const g of gds) {
    const arr = gdTheoLop.get(g.classId) ?? [];
    arr.push(g);
    gdTheoLop.set(g.classId, arr);
  }

  // ── Mẫu bài tập + bài tập + bài nộp ────────────────────────────────────────
  buoc("Bài tập + bài nộp");
  const mau: CoId<Prisma.AssignmentTemplateCreateManyInput>[] = DE_BAI.map((d, i) => ({
    id: uid("btmau", i),
    title: `Mẫu ${i + 1} — ${d.slice(0, 40)}`,
    description: d,
    createdById: uat.daotao.id,
  }));
  const nMau = await taoThieu(
    mau,
    (ids) => db.assignmentTemplate.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.assignmentTemplate.createMany({ data, skipDuplicates: true }),
  );

  const baiTap: CoId<Prisma.AssignmentCreateManyInput>[] = [];
  const baiNop: CoId<Prisma.AssignmentSubmissionCreateManyInput>[] = [];
  for (const lop of lops) {
    const soBai = int(rng, 2, 4);
    for (let b = 1; b <= soBai; b++) {
      const aid = uid("bt", lop.id.replace("uat-lop-", ""), b);
      // Hạn nộp: phần lớn đã qua (để có bài nộp/chấm), một phần còn hạn.
      const hanLech = chance(rng, 0.7) ? -int(rng, 1, 40) : int(rng, 2, 14);
      // MỘT đề cho cả tiêu đề lẫn mô tả, và KHÔNG cắt.
      // Bản cũ vừa `.slice(0, 45)` vừa bốc `description` bằng một lượt pick KHÁC, nên
      // tiêu đề cụt giữa từ ("…khi lắp bánh dẫn độn") trong khi mô tả lại đầy đủ và
      // nói chuyện khác. QA đo được đúng 45 ký tự và kết luận cột `title` bị giới hạn ở
      // tầng dữ liệu (BUG-009) — thực ra chỉ là dòng này.
      const de = pick(rng, DE_BAI);
      baiTap.push({
        id: aid,
        title: `Bài ${b} — ${de}`,
        description: de,
        classId: lop.id,
        totalPoints: 10,
        assignedAt: ngay(hanLech - 7),
        dueAt: ngayGio(hanLech, 22),
        status: "PUBLISHED",
        allowText: true,
        allowFile: true,
        // FK trỏ Employee, không phải User.
        createdById: uat.giaovien.employeeId,
      });

      for (const g of (gdTheoLop.get(lop.id) ?? []).filter((x) =>
        ["STUDYING", "ACTIVE", "COMPLETED"].includes(x.status))) {
        const daQuaHan = hanLech < 0;
        const r = rng();
        // Ca biên: quá hạn mà CHƯA NỘP — đây là thứ màn chấm bài phải nêu ra.
        const st: Prisma.AssignmentSubmissionCreateManyInput["status"] =
          !daQuaHan ? (r < 0.4 ? "SUBMITTED" : "NOT_SUBMITTED")
          : r < 0.55 ? "GRADED" : r < 0.75 ? "SUBMITTED" : r < 0.88 ? "LATE" : "NOT_SUBMITTED";
        baiNop.push({
          id: uid("btnop", aid.replace("uat-bt-", ""), g.studentId.slice(-6)),
          assignmentId: aid,
          studentId: g.studentId,
          status: st,
          textAnswer: st === "NOT_SUBMITTED" ? null : "Em đã làm xong và quay video ạ.",
          submittedAt: st === "NOT_SUBMITTED" ? null : ngayGio(hanLech - (st === "LATE" ? -1 : 1), 20),
          score: st === "GRADED" ? int(rng, 6, 10) : null,
          feedback: st === "GRADED" ? pick(rng, ["Làm tốt, trình bày rõ.", "Cần giải thích thêm phần lập trình.", "Đúng yêu cầu."]) : null,
          gradedAt: st === "GRADED" ? ngayGio(hanLech + 2, 20) : null,
          gradedById: st === "GRADED" ? uat.giaovien.employeeId : null, // FK trỏ Employee
        });
      }
    }
  }
  const nBt = await taoThieu(
    baiTap,
    (ids) => db.assignment.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.assignment.createMany({ data, skipDuplicates: true }),
  );
  const nNop = await taoThieu(
    baiNop,
    (ids) => db.assignmentSubmission.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.assignmentSubmission.createMany({ data, skipDuplicates: true }),
  );
  xong("Bài tập", { mẫu: nMau, bài: nBt, bài_nộp: nNop });

  // ── Học bạ ─────────────────────────────────────────────────────────────────
  buoc("Học bạ + điểm tiêu chí");
  const tieuChi = await db.reportCardCriterion.findMany({
    where: { id: { startsWith: "uat-rcc-" } },
    select: { id: true, courseId: true },
  });
  const tcTheoKhoa = new Map<string, string[]>();
  for (const t of tieuChi) {
    const arr = tcTheoKhoa.get(t.courseId) ?? [];
    arr.push(t.id);
    tcTheoKhoa.set(t.courseId, arr);
  }

  const hocBa: CoId<Prisma.ReportCardCreateManyInput>[] = [];
  const diemTc: CoId<Prisma.ReportCardScoreCreateManyInput>[] = [];
  for (const g of gds.filter((x) => ["STUDYING", "ACTIVE", "COMPLETED"].includes(x.status))) {
    if (!chance(rng, 0.55)) continue; // không phải em nào cũng đã có học bạ
    const rid = uid("hocba", g.id.replace("uat-gd-", ""));
    const r = rng();
    const st: Prisma.ReportCardCreateManyInput["status"] =
      r < 0.35 ? "PUBLISHED" : r < 0.6 ? "PENDING_REVIEW" : r < 0.92 ? "DRAFT" : "RECALLED";
    hocBa.push({
      id: rid,
      enrollmentId: g.id,
      status: st,
      teacherId: uat.giaovien.id,
      centerId: g.centerId,
      finalComment: pick(rng, [
        "Con tiến bộ đều, tự tin hơn khi trình bày.",
        "Cần rèn thêm tính kiên nhẫn khi gỡ lỗi.",
        "Kỹ năng lắp ráp tốt, nên thử phần nâng cao.",
      ]),
      publishedById: st === "PUBLISHED" ? uat.giaovu.id : null,
      publishedAt: st === "PUBLISHED" ? ngay(-int(rng, 1, 40)) : null,
    });
    for (const [k, tc] of (tcTheoKhoa.get(g.courseId) ?? []).entries()) {
      diemTc.push({
        id: uid("hbdiem", rid.replace("uat-hocba-", ""), k),
        reportCardId: rid,
        criterionId: tc,
        level: int(rng, 2, 4),
      });
    }
  }
  const nHb = await taoThieu(
    hocBa,
    (ids) => db.reportCard.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.reportCard.createMany({ data, skipDuplicates: true }),
  );
  const nDiem = await taoThieu(
    diemTc,
    (ids) => db.reportCardScore.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.reportCardScore.createMany({ data, skipDuplicates: true }),
  );
  xong("Học bạ", { học_bạ: nHb, điểm: nDiem });

  // ── Hoàn thành khoá + chứng chỉ ────────────────────────────────────────────
  buoc("Hoàn thành khoá");
  const ht: CoId<Prisma.CourseCompletionCreateManyInput>[] = [];
  for (const [i, g] of gds.filter((x) => x.status === "COMPLETED").entries()) {
    ht.push({
      id: uid("htk", i),
      studentId: g.studentId,
      courseId: g.courseId,
      classId: g.classId,
      completedAt: ngay(-int(rng, 5, 90)),
      finalGrade: pick(rng, ["Giỏi", "Khá", "Xuất sắc", "Đạt"]),
      finalAssessment: pick(rng, [
        "Hoàn thành đầy đủ nhiệm vụ của khoá.",
        "Nắm chắc kiến thức, sản phẩm cuối khoá tốt.",
        "Đạt yêu cầu, nên học tiếp khoá kế.",
      ]),
      certificateCode: `SR-UAT-${String(i + 1).padStart(5, "0")}`,
      createdById: uat.giaovu.id,
    });
  }
  const nHt = await taoThieu(
    ht,
    (ids) => db.courseCompletion.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.courseCompletion.createMany({ data, skipDuplicates: true }),
  );
  xong("Hoàn thành khoá", nHt);

  // ── Học bù ─────────────────────────────────────────────────────────────────
  buoc("Học bù");
  const vang = await db.attendance.findMany({
    where: { id: { startsWith: "uat-dd-" }, makeupStatus: "NEEDS_MAKEUP" },
    select: { id: true, studentId: true, sessionId: true, centerId: true,
              session: { select: { classId: true, lessonId: true } } },
    take: 160,
  });
  const bu: CoId<Prisma.MakeupNeedCreateManyInput>[] = vang.map((v, i) => ({
    id: uid("hocbu", i),
    studentId: v.studentId,
    classId: v.session.classId,
    missedSessionId: v.sessionId,
    missedLessonId: v.session.lessonId,
    centerId: v.centerId,
    // ~55% CHƯA xếp bù → màn Học bù có hàng chờ thật.
    status: chance(rng, 0.55) ? "PENDING" : chance(rng, 0.6) ? "SCHEDULED" : "COMPLETED",
    note: pick(rng, ["Phụ huynh xin bù cuối tuần", "Bù vào lớp cùng khoá", "Chờ sắp xếp"]),
    createdById: uat.giaovu.id,
  }));
  const nBu = await taoThieu(
    bu,
    (ids) => db.makeupNeed.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.makeupNeed.createMany({ data, skipDuplicates: true }),
  );
  xong("Học bù", nBu);

  // ── Ảnh lớp ────────────────────────────────────────────────────────────────
  buoc("Ảnh lớp");
  const buoiQuaKhu = await db.classSession.findMany({
    where: { id: { startsWith: "uat-buoi-" }, status: "COMPLETED" },
    select: { id: true, classId: true, date: true },
    take: 220,
  });
  const anh: CoId<Prisma.ClassSessionMediaCreateManyInput>[] = [];
  for (const [i, b] of buoiQuaKhu.entries()) {
    if (!chance(rng, 0.6)) continue;
    const soAnh = int(rng, 1, 3);
    for (let k = 0; k < soAnh; k++) {
      // ~25% còn CHỜ DUYỆT → giáo vụ có việc; ảnh chưa duyệt KHÔNG hiện ở cổng PH.
      const st: Prisma.ClassSessionMediaCreateManyInput["status"] =
        chance(rng, 0.25) ? "PENDING" : "APPROVED";
      anh.push({
        id: uid("anh", i, k),
        classId: b.classId,
        classSessionId: b.id,
        // Ảnh mẫu công khai — KHÔNG phải ảnh học viên thật.
        fileUrl: `https://picsum.photos/seed/uat${i}${k}/800/600`,
        fileName: `buoi-${i}-${k}.jpg`,
        caption: pick(rng, ["Sản phẩm cuối buổi", "Nhóm đang lắp khung", "Thi đấu nhóm", "Giờ trình bày"]),
        status: st,
        isClassWide: chance(rng, 0.6),
        takenAt: b.date,
        uploadedById: uat.giaovien.id,
        uploadedByName: uat.giaovien.name ?? "Giáo viên",
        approvedById: st === "APPROVED" ? uat.giaovu.id : null,
        approvedByName: st === "APPROVED" ? (uat.giaovu.name ?? "Giáo vụ") : null,
        approvedAt: st === "APPROVED" ? b.date : null,
        createdAt: b.date,
      });
    }
  }
  const nAnh = await taoThieu(
    anh,
    (ids) => db.classSessionMedia.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.classSessionMedia.createMany({ data, skipDuplicates: true }),
  );
  xong("Ảnh lớp", nAnh);

  // ── Tài liệu giảng dạy ─────────────────────────────────────────────────────
  buoc("Tài liệu");
  const bai = await db.lesson.findMany({
    where: { curriculum: { course: { isActive: true } } },
    select: { id: true, title: true },
    take: 60,
  });
  const tl: CoId<Prisma.DocumentCreateManyInput>[] = bai.map((l, i) => ({
    id: uid("tailieu", i),
    title: `Phiếu bài tập — ${l.title}`,
    type: pick(rng, ["PDF", "SLIDE", "WORKSHEET"] as const),
    lessonId: l.id,
    fileUrl: `https://example.com/uat/tai-lieu-${i}.pdf`,
    fileName: `tai-lieu-${i}.pdf`,
    fileSize: int(rng, 80, 4000) * 1024,
    uploadedById: uat.daotao.employeeId, // FK trỏ Employee
  }));
  const nTl = await taoThieu(
    tl,
    (ids) => db.document.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (data) => db.document.createMany({ data, skipDuplicates: true }),
  );
  xong("Tài liệu", nTl);
}
