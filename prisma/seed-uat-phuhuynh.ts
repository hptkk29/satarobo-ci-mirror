/**
 * prisma/seed-uat-phuhuynh.ts — SEED DỮ LIỆU CHO TÀI KHOẢN UAT PHỤ HUYNH.
 *
 *   pnpm tsx prisma/seed-uat-phuhuynh.ts            (dry-run: chỉ in kế hoạch)
 *   pnpm tsx prisma/seed-uat-phuhuynh.ts --apply    (ghi thật)
 *
 * MỤC TIÊU: 8 mảng phụ huynh nghiệm thu trên portal đều có dữ liệu —
 *   lớp · lịch học · nhận xét · hình ảnh lớp · học bạ · yêu cầu học bù ·
 *   bài tập của con · đánh giá giáo viên.
 *
 * BỔ SUNG chứ KHÔNG dựng lại: tài khoản uat.phuhuynh@satarobo.vn đã có sẵn 3 con,
 * 6 ghi danh, 5 lớp có buổi. Script này lấp đúng các chỗ đang RỖNG khiến trang
 * portal ra khung trắng (đo ngày 26/08/2026):
 *   · StudentConsent 0       → trang Hình ảnh chỉ hiện lời mời "bật đồng ý"
 *   · MediaStudentTag 0      → 55 ảnh có sẵn không ảnh nào là "ảnh của con"
 *   · ReportCard 0 PUBLISHED → Học bạ rơi về bảng tổng hợp cũ
 *   · MakeupNeed 0           → mục "Học bù" trong trang Yêu cầu trống
 *   · HomeworkAssignment 0   → "Bài kiểm tra (0)"
 *   · EvalForm/Round 0       → trang Đánh giá giáo viên trống
 *
 * IDEMPOTENT: mọi bản ghi MỚI mang id tiền tố `uatph-`; chạy lại sẽ xoá sạch phần
 * cũ CỦA CHÍNH NÓ rồi dựng lại theo mốc thời gian hôm nay. Các bản ghi `uat-` có
 * sẵn chỉ bị SỬA bằng thao tác lặp-lại-được (upsert / set trạng thái).
 *
 * AN TOÀN: mặc định chỉ chạy trên DB dev/test (project ref mqvojwccdhqbagfnjhfo).
 * Chạy nơi khác phải thêm --force-host (cố ý, không vô tình bắn vào PROD).
 *
 * GIỜ GIẤC: mọi mốc dựng bằng lib/time/vn.ts — Vercel chạy UTC, máy dev +07.
 */
import "../scripts/_load-env";
import type { Prisma } from "@prisma/client";
import { currentDbHost } from "../scripts/_load-env";
import { scriptDb } from "../scripts/_script-db";
import { vnDateAt, vnParts, vnAddDays } from "../lib/time/vn";

const db = scriptDb();

// ── Cấu hình ─────────────────────────────────────────────────────────────────
const PARENT_EMAIL = "uat.phuhuynh@satarobo.vn";
const EXPECTED_DB_REF = "mqvojwccdhqbagfnjhfo";
const P = "uatph-"; // tiền tố id của MỌI bản ghi MỚI script này tạo
const CENTER_ID = "co-so-nguyen-huu-tho"; // CS1

const APPLY = process.argv.includes("--apply");
const FORCE_HOST = process.argv.includes("--force-host");

/** Lớp chưa có buổi nào (RECRUITING) thì dựng cả khoá cho có lịch sắp tới. */
const EMPTY_CLASS_SESSIONS = 12;

/** Trạng thái ghi danh mà portal coi là "đang học" (lib/portal/learning.ts). */
const ACTIVE_ENROLLMENT = ["CONFIRMED", "STUDYING", "ACTIVE"] as const;

// ── Tiện ích ─────────────────────────────────────────────────────────────────
/** Ngẫu nhiên TẤT ĐỊNH — chạy lại ra đúng kết quả cũ (không dùng Math.random). */
function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function pick<T>(arr: readonly T[], r: number): T {
  return arr[Math.min(arr.length - 1, Math.floor(r * arr.length))]!;
}

const plan: string[] = [];
function note(line: string): void {
  plan.push(line);
  console.log(`   ${line}`);
}

/** 9 tiêu chí rubric phiếu nhận xét buổi (lib/lms/session-eval-rubric — mức 1 là TỐT NHẤT). */
const RUBRIC_IDS = [
  "kt-cu",
  "kt-moi",
  "kn-st",
  "kn-pb",
  "kn-mem",
  "sp-ht",
  "sp-yt",
  "td-tt",
  "td-gt",
] as const;

const OVERALL_TEXTS = [
  "Buổi này con tập trung tốt, lắp khung xe gọn gàng và tự kiểm tra lại các mối nối trước khi chạy thử. Phần lập trình con còn nhầm thứ tự khối rẽ hướng, sau khi được gợi ý đã tự sửa được. Về nhà phụ huynh cho con thử lại bài rẽ theo vạch giúp cô nhé.",
  "Con nắm bài nhanh, hoàn thành nhiệm vụ chính sớm hơn nhóm và chủ động xin làm thêm phần nâng cao. Khi trình bày sản phẩm con nói còn nhỏ, cô sẽ cho con lên bảng nhiều hơn ở các buổi tới.",
  "Con làm việc nhóm rất tốt, biết chia việc và nhắc bạn giữ an toàn khi dùng tua vít. Kiến thức cũ về cảm biến khoảng cách con còn quên một phần, cô đã ôn lại cuối buổi.",
  "Hôm nay con hơi mất tập trung ở nửa đầu buổi nên phần lắp cơ khí chậm hơn các bạn. Nửa sau con đã bắt nhịp lại và hoàn thành sản phẩm. Phụ huynh nhắc con ngủ sớm trước buổi học giúp cô.",
  "Con tiến bộ rõ ở phần gỡ lỗi: tự đọc lại chương trình, tìm được chỗ sai mà không cần cô nhắc. Sản phẩm chạy đúng yêu cầu ngay lần thử thứ hai.",
];

const PROJECT_NAMES = [
  "Dự án 1: Xe dò vạch",
  "Dự án 2: Cánh tay gắp vật",
  "Dự án 3: Robot tránh vật cản",
  "Dự án 4: Xe điều khiển từ xa",
  "Dự án 5: Cổng tự động",
];

// ── Ngữ cảnh ─────────────────────────────────────────────────────────────────
type Ctx = Awaited<ReturnType<typeof loadContext>>;

async function loadContext() {
  const parent = await db.user.findUnique({
    where: { email: PARENT_EMAIL },
    select: { id: true, name: true, role: true, roles: true },
  });
  if (!parent) throw new Error(`Không tìm thấy tài khoản ${PARENT_EMAIL}`);

  const students = await db.student.findMany({
    where: { parentUserId: parent.id, deletedAt: null },
    select: { id: true, name: true, studentCode: true, centerId: true, orgUnitId: true },
    orderBy: { name: "asc" },
  });
  if (students.length === 0) throw new Error("Tài khoản phụ huynh chưa liên kết học viên nào");

  const enrollments = await db.enrollment.findMany({
    where: { studentId: { in: students.map((s) => s.id) }, deletedAt: null },
    select: { id: true, studentId: true, classId: true, courseId: true, status: true },
  });

  const classes = await db.class.findMany({
    where: { id: { in: [...new Set(enrollments.map((e) => e.classId))] } },
    select: {
      id: true,
      name: true,
      classCode: true,
      status: true,
      courseId: true,
      centerId: true,
      orgUnitId: true,
      teacherId: true,
      assistantId: true,
      startDate: true,
      endDate: true,
      startTime: true,
      endTime: true,
      course: { select: { name: true } },
    },
  });

  const sessions = await db.classSession.findMany({
    where: { classId: { in: classes.map((c) => c.id) } },
    select: { id: true, classId: true, date: true, status: true, topic: true, lessonId: true },
    orderBy: { date: "asc" },
  });

  return { parent, students, enrollments, classes, sessions };
}

// ═════════════════════════════════════════════════════════════════════════════
// 0 — DỌN phần script này tạo lần trước (idempotent)
// ═════════════════════════════════════════════════════════════════════════════
async function cleanup(): Promise<void> {
  const pre = { startsWith: P };
  // Thứ tự NGƯỢC phụ thuộc: con trước, cha sau.
  const steps: [string, () => Promise<{ count: number }>][] = [
    ["EvalAnswer", () => db.evalAnswer.deleteMany({ where: { id: pre } })],
    ["EvalResponse", () => db.evalResponse.deleteMany({ where: { id: pre } })],
    ["EvaluationRound", () => db.evaluationRound.deleteMany({ where: { id: pre } })],
    ["EvalQuestion", () => db.evalQuestion.deleteMany({ where: { id: pre } })],
    ["EvalForm", () => db.evalForm.deleteMany({ where: { id: pre } })],
    ["MediaStudentTag", () => db.mediaStudentTag.deleteMany({ where: { id: pre } })],
    ["ClassSessionMedia", () => db.classSessionMedia.deleteMany({ where: { id: pre } })],
    ["HomeworkAssignment", () => db.homeworkAssignment.deleteMany({ where: { id: pre } })],
    ["ExamAttempt", () => db.examAttempt.deleteMany({ where: { id: pre } })],
    ["MakeupNeed", () => db.makeupNeed.deleteMany({ where: { id: pre } })],
    ["ParentRequest", () => db.parentRequest.deleteMany({ where: { id: pre } })],
    ["StudentSkillAssessment", () => db.studentSkillAssessment.deleteMany({ where: { id: pre } })],
    ["AssignmentSubmission", () => db.assignmentSubmission.deleteMany({ where: { id: pre } })],
    ["Assignment", () => db.assignment.deleteMany({ where: { id: pre } })],
    ["ReportCardScore", () => db.reportCardScore.deleteMany({ where: { id: pre } })],
    ["ReportCard", () => db.reportCard.deleteMany({ where: { id: pre } })],
    ["StudentSessionFeedback", () => db.studentSessionFeedback.deleteMany({ where: { id: pre } })],
    ["ClassSession", () => db.classSession.deleteMany({ where: { id: pre } })],
  ];
  let total = 0;
  for (const [label, run] of steps) {
    const { count } = await run();
    total += count;
    if (count > 0) note(`dọn ${label}: ${count}`);
  }
  if (total === 0) note("dọn: chưa có bản ghi uatph- nào từ lần chạy trước");
}

// ═════════════════════════════════════════════════════════════════════════════
// 1 — LỚP: mỗi con phải có ít nhất 1 lớp ĐANG học
// ═════════════════════════════════════════════════════════════════════════════
async function seedClasses(ctx: Ctx): Promise<void> {
  for (const s of ctx.students) {
    const mine = ctx.enrollments.filter((e) => e.studentId === s.id);
    const live = mine.filter((e) => (ACTIVE_ENROLLMENT as readonly string[]).includes(e.status));
    if (live.length > 0) {
      note(`${s.name}: đã có ${live.length} lớp đang học — giữ nguyên`);
      continue;
    }
    // Con không có lớp nào "đang học" ⇒ mọi trang Lịch/Bài tập/Hình ảnh ra trắng
    // (classIdsFor lọc đúng 3 trạng thái trên). Mở lại lớp còn buổi trong tương lai.
    const now = new Date();
    const target =
      mine.find((e) => ctx.sessions.some((x) => x.classId === e.classId && x.date > now)) ?? mine[0];
    if (!target) {
      note(`${s.name}: KHÔNG có ghi danh nào — bỏ qua`);
      continue;
    }
    const cls = ctx.classes.find((c) => c.id === target.classId);
    if (APPLY) {
      await db.enrollment.update({ where: { id: target.id }, data: { status: "ACTIVE" } });
    }
    target.status = "ACTIVE";
    note(`${s.name}: ghi danh ${target.id} (${cls?.name ?? "?"}) → ACTIVE — trước đó không lớp nào đang học`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 2 — LỊCH HỌC: lớp chưa có buổi thì dựng lịch tuần; đảm bảo có buổi SẮP TỚI
// ═════════════════════════════════════════════════════════════════════════════
async function seedSchedule(ctx: Ctx): Promise<void> {
  const now = new Date();
  const liveClassIds = new Set(
    ctx.enrollments
      .filter((e) => (ACTIVE_ENROLLMENT as readonly string[]).includes(e.status))
      .map((e) => e.classId),
  );

  for (const cls of ctx.classes) {
    if (!liveClassIds.has(cls.id)) continue;
    const own = ctx.sessions.filter((s) => s.classId === cls.id);
    const future = own.filter((s) => s.date > now);
    if (future.length >= 3) {
      note(`${cls.name}: ${own.length} buổi (${future.length} sắp tới) — giữ nguyên`);
      continue;
    }

    // Mốc bắt đầu: buổi cuối + 1 tuần, hoặc 1 tuần nữa nếu lớp chưa có buổi nào.
    const last = own[own.length - 1]?.date ?? null;
    const [hh, mm] = (cls.startTime ?? "17:30").split(":").map((x) => Number(x) || 0);
    let cursor = last ? vnAddDays(last, 7) : vnAddDays(new Date(), 7);
    while (cursor <= now) cursor = vnAddDays(cursor, 7);
    const need = own.length === 0 ? EMPTY_CLASS_SESSIONS : Math.max(0, 4 - future.length);

    const rows: Prisma.ClassSessionCreateManyInput[] = [];
    for (let i = 0; i < need; i++) {
      const p = vnParts(cursor);
      const date = vnDateAt(p.year, p.month, p.day, hh ?? 17, mm ?? 30);
      const no = own.length + i + 1;
      rows.push({
        id: `${P}buoi-${cls.id}-${no}`,
        classId: cls.id,
        date,
        topic: `Buổi ${no}`,
        status: "SCHEDULED",
        centerId: cls.centerId,
        orgUnitId: cls.orgUnitId,
      });
      cursor = vnAddDays(cursor, 7);
    }
    if (rows.length === 0) continue;
    if (APPLY) await db.classSession.createMany({ data: rows, skipDuplicates: true });
    for (const r of rows) {
      ctx.sessions.push({
        id: r.id!,
        classId: cls.id,
        date: r.date as Date,
        status: "SCHEDULED",
        topic: r.topic ?? null,
        lessonId: null,
      });
    }
    const first = (rows[0]!.date as Date).toISOString().slice(0, 10);
    const lastNew = (rows[rows.length - 1]!.date as Date).toISOString().slice(0, 10);
    note(`${cls.name}: +${rows.length} buổi sắp tới (${first} → ${lastNew})`);
  }
  ctx.sessions.sort((a, b) => a.date.getTime() - b.date.getTime());
}

// ═════════════════════════════════════════════════════════════════════════════
// 3 — NHẬN XÉT: phiếu đầy đủ (dự án + "Đánh giá chung" + rubric 9 tiêu chí)
// ═════════════════════════════════════════════════════════════════════════════
async function seedFeedback(ctx: Ctx): Promise<void> {
  const teacherByClass = new Map(ctx.classes.map((c) => [c.id, c.teacherId]));
  let created = 0;
  let filled = 0;

  for (const s of ctx.students) {
    const myClassIds = ctx.enrollments.filter((e) => e.studentId === s.id).map((e) => e.classId);
    const done = ctx.sessions.filter(
      (x) => myClassIds.includes(x.classId) && x.status === "COMPLETED",
    );
    const existing = await db.studentSessionFeedback.findMany({
      where: { studentId: s.id },
      select: { id: true, classSessionId: true, notes: true, rubric: true, projectName: true },
    });
    const bySession = new Map(existing.map((f) => [f.classSessionId, f]));

    for (const [i, sess] of done.entries()) {
      const r = rng(s.id.length * 977 + i * 31 + 7);
      const gv = teacherByClass.get(sess.classId);
      if (!gv) continue;

      const rubric: Record<string, number> = {};
      for (const [k, cid] of RUBRIC_IDS.entries()) {
        rubric[cid] = 1 + ((Math.floor(r() * 3) + k) % 4); // 1..4 (mức 1 = tốt nhất)
      }
      const notes = {
        overall: pick(OVERALL_TEXTS, r()),
        knowledge: "",
        skill: "",
        attitude: "",
        proposal: "",
      };
      const projectName = pick(PROJECT_NAMES, r());

      const cur = bySession.get(sess.id);
      if (cur) {
        // Phiếu cũ chỉ có comment/rating → bổ sung phần mở rộng để trang Nhận xét
        // render đủ 3 khối (Dự án · Đánh giá chung · bảng năng lực).
        if (cur.notes && cur.rubric && cur.projectName) continue;
        if (APPLY) {
          await db.studentSessionFeedback.update({
            where: { id: cur.id },
            data: {
              projectName: cur.projectName ?? projectName,
              notes: notes as unknown as Prisma.InputJsonValue,
              rubric: rubric as unknown as Prisma.InputJsonValue,
            },
          });
        }
        filled++;
        continue;
      }
      if (APPLY) {
        await db.studentSessionFeedback.create({
          data: {
            id: `${P}nx-${sess.id}-${s.id}`,
            classSessionId: sess.id,
            studentId: s.id,
            comment: null,
            rating: 3 + Math.floor(r() * 3),
            projectName,
            notes: notes as unknown as Prisma.InputJsonValue,
            rubric: rubric as unknown as Prisma.InputJsonValue,
            createdById: gv,
          },
        });
      }
      created++;
    }
  }
  note(`nhận xét buổi: +${created} phiếu mới, ${filled} phiếu cũ được bổ sung dự án/đánh giá chung/rubric`);
}

// ═════════════════════════════════════════════════════════════════════════════
// 4 — HÌNH ẢNH LỚP: consent CLASS_MEDIA + gắn thẻ con vào ảnh ĐÃ DUYỆT
// ═════════════════════════════════════════════════════════════════════════════
async function seedPhotos(ctx: Ctx): Promise<void> {
  // (a) Không có StudentConsent GRANTED thì trang Hình ảnh chỉ hiện lời mời bật
  //     đồng ý — đây là lý do 55 ảnh có sẵn không hiện được ảnh nào (C6.4).
  for (const s of ctx.students) {
    if (APPLY) {
      await db.studentConsent.upsert({
        where: { studentId_type: { studentId: s.id, type: "CLASS_MEDIA" } },
        update: { status: "GRANTED", revokedAt: null },
        create: { studentId: s.id, type: "CLASS_MEDIA", status: "GRANTED" },
      });
    }
  }
  note(`consent CLASS_MEDIA: GRANTED cho ${ctx.students.length} con`);

  // (b) Trang Hình ảnh CHỈ đọc lớp con ĐANG học (status ∈ ACTIVE_ENROLLMENT) — ảnh
  //     của lớp đã kết thúc không hiện. Lớp đang học nào ít ảnh thì bù cho đủ,
  //     nếu không phụ huynh mở trang ra chỉ thấy 1-2 tấm.
  const MIN_PHOTOS_PER_LIVE_CLASS = 9;
  const CAPTIONS = [
    "Nhóm đang lắp khung xe",
    "Giờ thực hành cảm biến",
    "Sản phẩm cuối buổi",
    "Con thuyết trình trước lớp",
    "Thi đấu giữa các nhóm",
    "Cô hướng dẫn phần lập trình",
    "Cả lớp chụp ảnh cuối buổi",
    "Con tự kiểm tra mối nối",
    "Thử nghiệm robot dò vạch",
  ];
  let added = 0;
  const liveClassIds = [
    ...new Set(
      ctx.enrollments
        .filter((e) => (ACTIVE_ENROLLMENT as readonly string[]).includes(e.status))
        .map((e) => e.classId),
    ),
  ];
  for (const classId of liveClassIds) {
    const cls = ctx.classes.find((c) => c.id === classId)!;
    const have = await db.classSessionMedia.count({ where: { classId, status: "APPROVED" } });
    const done = ctx.sessions.filter((x) => x.classId === classId && x.status === "COMPLETED");
    if (done.length === 0) continue;
    for (let i = have; i < MIN_PHOTOS_PER_LIVE_CLASS; i++) {
      const anchor = done[i % done.length]!;
      if (APPLY) {
        await db.classSessionMedia.upsert({
          where: { id: `${P}anh-${classId}-${i}` },
          update: {},
          create: {
            id: `${P}anh-${classId}-${i}`,
            classId,
            classSessionId: anchor.id,
            fileUrl: `https://picsum.photos/seed/uatph${classId.slice(-4)}${i}/800/600`,
            fileName: `buoi-${i + 1}.jpg`,
            caption: CAPTIONS[i % CAPTIONS.length]!,
            status: "APPROVED",
            // Xen kẽ ảnh chung cả lớp / ảnh gắn thẻ riêng để nghiệm thu cả 2 nhánh C6.2.
            isClassWide: i % 3 === 0,
            takenAt: anchor.date,
            uploadedById: cls.teacherId,
            uploadedByName: "UAT — Giáo viên CS1",
            approvedByName: "UAT — Quản lý cơ sở",
            approvedAt: new Date(),
          },
        });
      }
      added++;
    }
  }
  note(`hình ảnh lớp: +${added} ảnh bổ sung cho lớp đang học (đủ ${MIN_PHOTOS_PER_LIVE_CLASS} ảnh/lớp)`);

  // (c) Gắn thẻ con vào ảnh APPROVED của lớp con đang/đã học (C6.1/C6.2) — ảnh có
  //     thẻ con được portal xếp TRƯỚC ảnh chung cả lớp.
  let tags = 0;
  let approved = 0;
  for (const s of ctx.students) {
    const myClassIds = ctx.enrollments.filter((e) => e.studentId === s.id).map((e) => e.classId);
    if (myClassIds.length === 0) continue;
    const media = await db.classSessionMedia.findMany({
      where: { classId: { in: myClassIds } },
      select: { id: true, status: true, isClassWide: true, takenAt: true, classSessionId: true },
      orderBy: { createdAt: "asc" },
    });
    for (const [i, m] of media.entries()) {
      // Ảnh chờ duyệt: duyệt một nửa để phụ huynh thấy thêm ảnh, nửa còn lại giữ
      // PENDING làm dữ liệu cho hàng duyệt bên admin.
      if (m.status === "PENDING" && i % 2 === 0) {
        if (APPLY) {
          await db.classSessionMedia.update({
            where: { id: m.id },
            data: {
              status: "APPROVED",
              approvedAt: new Date(),
              approvedByName: "UAT — Quản lý cơ sở",
            },
          });
        }
        m.status = "APPROVED";
        approved++;
      }
      if (m.status !== "APPROVED") continue;
      // Gắn thẻ ~2/3 số ảnh đã duyệt; phần còn lại để nguyên (ảnh chung cả lớp
      // hoặc ảnh bạn khác) — đúng luật C6.2 mà vẫn có cả hai loại để nghiệm thu.
      if (i % 3 === 2) continue;
      if (APPLY) {
        await db.mediaStudentTag.upsert({
          where: { mediaId_studentId: { mediaId: m.id, studentId: s.id } },
          update: {},
          create: { id: `${P}tag-${m.id}-${s.id}`, mediaId: m.id, studentId: s.id },
        });
      }
      tags++;
    }
  }
  note(`hình ảnh lớp: duyệt thêm ${approved} ảnh, gắn thẻ con ${tags} lượt`);
}

// ═════════════════════════════════════════════════════════════════════════════
// 5 — KỸ NĂNG ROBOT (số liệu "skills" trên học bạ)
// ═════════════════════════════════════════════════════════════════════════════
const SKILLS = [
  "MECH_ASSEMBLY",
  "ALGORITHM",
  "PROGRAMMING",
  "SENSOR",
  "MOTOR_CONTROL",
  "PROBLEM_SOLVING",
  "TEAMWORK",
  "PRESENTATION",
  "CREATIVITY",
  "COMPETITION_READY",
] as const;
const LEVELS = ["NEED_SUPPORT", "BASIC", "GOOD", "EXCELLENT"] as const;

async function seedSkills(ctx: Ctx): Promise<void> {
  let n = 0;
  for (const s of ctx.students) {
    const myClassIds = ctx.enrollments.filter((e) => e.studentId === s.id).map((e) => e.classId);
    const done = ctx.sessions.filter(
      (x) => myClassIds.includes(x.classId) && x.status === "COMPLETED",
    );
    const anchor = done[done.length - 1];
    const gv = ctx.classes.find((c) => c.id === anchor?.classId)?.teacherId;
    if (!anchor || !gv) continue;
    for (const [i, skill] of SKILLS.entries()) {
      const r = rng(s.id.length * 617 + i * 23);
      if (APPLY) {
        await db.studentSkillAssessment.upsert({
          where: { id: `${P}kn-${s.id}-${skill}` },
          update: {},
          create: {
            id: `${P}kn-${s.id}-${skill}`,
            studentId: s.id,
            skill,
            level: pick(LEVELS, r()),
            note: null,
            assessedById: gv,
            assessedAt: anchor.date,
            classSessionId: anchor.id,
          },
        });
      }
      n++;
    }
  }
  note(`kỹ năng robot: +${n} bản đánh giá (10 kỹ năng × ${ctx.students.length} con)`);
}

// ═════════════════════════════════════════════════════════════════════════════
// 6 — BÀI TẬP CỦA CON: Assignment/Submission + HomeworkAssignment (bài kiểm tra)
// ═════════════════════════════════════════════════════════════════════════════
const HOMEWORK_TITLES = [
  "Bài về nhà — Vẽ sơ đồ khối chương trình đã học",
  "Bài về nhà — Quay video robot chạy thử tại nhà",
  "Bài về nhà — Liệt kê 3 cảm biến và công dụng",
];

async function seedHomework(ctx: Ctx): Promise<void> {
  // (a) Cho phép phụ huynh xem điểm tổng quan (mặc định TẮT → PH chỉ thấy trạng thái).
  if (APPLY) {
    await db.systemSetting.upsert({
      where: { key: "homework.showScoreToParent" },
      update: { valueJson: true },
      create: {
        key: "homework.showScoreToParent",
        valueJson: true,
        updatedByName: "seed-uat-phuhuynh",
      },
    });
  }
  note("setting homework.showScoreToParent = true (PH xem được điểm tổng quan)");

  const liveClassIds = [
    ...new Set(
      ctx.enrollments
        .filter((e) => (ACTIVE_ENROLLMENT as readonly string[]).includes(e.status))
        .map((e) => e.classId),
    ),
  ];

  const teacherEmp = await db.employee.findFirst({
    where: { centerId: CENTER_ID, fullName: { contains: "UAT" } },
    select: { id: true },
  });

  // (b) Bài tập VỀ NHÀ (kind HOMEWORK) — dữ liệu có sẵn chỉ toàn CLASSWORK.
  let asg = 0;
  let subs = 0;
  for (const classId of liveClassIds) {
    const sess = ctx.sessions.filter((x) => x.classId === classId && x.status === "COMPLETED");
    for (const [i, title] of HOMEWORK_TITLES.entries()) {
      const id = `${P}bt-${classId}-${i}`;
      const anchor = sess[Math.max(0, sess.length - 1 - i)];
      const anchorDate = anchor?.date ?? new Date();
      if (APPLY) {
        await db.assignment.upsert({
          where: { id },
          update: {},
          create: {
            id,
            title,
            description: "Con làm bài ở nhà rồi nộp lại cho giáo viên vào buổi kế tiếp.",
            kind: "HOMEWORK",
            classId,
            classSessionId: anchor?.id ?? null,
            lessonId: anchor?.lessonId ?? null,
            totalPoints: 10,
            assignedAt: anchorDate,
            dueAt: new Date(anchorDate.getTime() + 7 * 864e5),
            status: "PUBLISHED",
            createdById: teacherEmp?.id ?? null,
          },
        });
      }
      asg++;

      // Bài nộp của CHÍNH con phụ huynh này trong lớp đó. Trạng thái xoay theo CHỈ SỐ
      // chứ không bốc ngẫu nhiên: bốc ngẫu nhiên trên tập 3 bài rất dễ ra 0 bài
      // "đã chấm", và phụ huynh mở trang lại thấy "Đã chấm 0".
      const SUB_CYCLE = ["GRADED", "SUBMITTED", "LATE", "GRADED", "NOT_SUBMITTED"] as const;
      for (const e of ctx.enrollments.filter((x) => x.classId === classId)) {
        const r = rng(e.id.length * 53 + i * 19);
        const st = SUB_CYCLE[i % SUB_CYCLE.length]!;
        if (APPLY) {
          await db.assignmentSubmission.upsert({
            where: { assignmentId_studentId: { assignmentId: id, studentId: e.studentId } },
            update: {},
            create: {
              id: `${P}np-${id}-${e.studentId}`,
              assignmentId: id,
              studentId: e.studentId,
              status: st,
              textAnswer:
                st === "NOT_SUBMITTED" ? null : "Con đã làm xong bài và gửi kèm ảnh sản phẩm ạ.",
              submittedAt: st === "NOT_SUBMITTED" ? null : new Date(),
              score: st === "GRADED" ? 7 + Math.round(r() * 3) : null,
              feedback:
                st === "GRADED"
                  ? "Bài làm sạch sẽ, ý tưởng tốt. Lần sau con ghi rõ hơn phần giải thích nhé."
                  : null,
              gradedAt: st === "GRADED" ? new Date() : null,
              gradedById: st === "GRADED" ? (teacherEmp?.id ?? null) : null,
            },
          });
        }
        subs++;
      }
    }
  }
  note(`bài tập về nhà: +${asg} bài, +${subs} bài nộp`);

  // (c) Bài KIỂM TRA — mục "Bài kiểm tra" của portal đọc HomeworkAssignment, đang rỗng.
  let hw = 0;
  let attempts = 0;
  for (const classId of liveClassIds) {
    const exams = await db.exam.findMany({
      where: { classId },
      select: { id: true, status: true, totalPoints: true },
    });
    if (exams.length === 0) continue;
    const sess = ctx.sessions.filter((x) => x.classId === classId && x.status === "COMPLETED");
    // Giao bài theo NHIỀU buổi (3 buổi gần nhất) — mỗi (buổi × đề × HV) là 1 dòng
    // HomeworkAssignment, nếu chỉ neo vào buổi cuối thì con chỉ có đúng 1 bài kiểm tra.
    const anchors = sess.slice(-3);
    if (anchors.length === 0) continue;

    for (const ex of exams) {
      // Đề DRAFT không giao được cho học viên → phát hành.
      if (ex.status !== "PUBLISHED" && APPLY) {
        await db.exam.update({ where: { id: ex.id }, data: { status: "PUBLISHED" } });
      }
      // Trạng thái xoay theo CHỈ SỐ buổi (xem ghi chú ở bài về nhà) — mỗi con chắc
      // chắn có 1 bài ĐÃ CHẤM, 1 bài đã nộp, 1 bài chưa làm.
      const HW_CYCLE = ["GRADED", "SUBMITTED", "ASSIGNED"] as const;
      for (const [ai, anchor] of anchors.entries()) {
        for (const e of ctx.enrollments.filter((x) => x.classId === classId)) {
          const r = rng(ex.id.length * 71 + e.id.length * 13 + ai * 97);
          const st = HW_CYCLE[ai % HW_CYCLE.length]!;
          if (APPLY) {
            await db.homeworkAssignment.upsert({
              where: {
                classSessionId_examId_studentId: {
                  classSessionId: anchor.id,
                  examId: ex.id,
                  studentId: e.studentId,
                },
              },
              update: {},
              create: {
                id: `${P}kt-${anchor.id}-${ex.id}-${e.studentId}`,
                classSessionId: anchor.id,
                examId: ex.id,
                studentId: e.studentId,
                dueAt: new Date(anchor.date.getTime() + 7 * 864e5),
                status: st,
                assignMode: "NOW",
                assignedAt: anchor.date,
              },
            });
            // ExamAttempt unique theo (đề × HV × lần) — tạo đúng 1 lần, gắn vào buổi
            // mang trạng thái GRADED (ai = 0 theo HW_CYCLE) để luôn có bài đã chấm.
            if (ai === 0) {
              const score = 6 + Math.round(r() * 4);
              await db.examAttempt.upsert({
                where: {
                  examId_studentId_attemptNo: {
                    examId: ex.id,
                    studentId: e.studentId,
                    attemptNo: 1,
                  },
                },
                update: {},
                create: {
                  id: `${P}lt-${ex.id}-${e.studentId}`,
                  examId: ex.id,
                  studentId: e.studentId,
                  attemptNo: 1,
                  startedAt: anchor.date,
                  submittedAt: new Date(anchor.date.getTime() + 36e5),
                  gradedAt: st === "GRADED" ? new Date(anchor.date.getTime() + 864e5) : null,
                  status: st === "GRADED" ? "GRADED" : "SUBMITTED",
                  totalScore: st === "GRADED" ? score : null,
                  passed: st === "GRADED" ? score >= (ex.totalPoints || 10) / 2 : null,
                  feedback:
                    st === "GRADED"
                      ? "Con làm đúng phần cảm biến, còn nhầm ở câu về vòng lặp."
                      : null,
                },
              });
              attempts++;
            }
          }
          hw++;
        }
      }
    }
  }
  note(`bài kiểm tra: +${hw} lượt giao, +${attempts} bài đã làm/chấm`);
}

// ═════════════════════════════════════════════════════════════════════════════
// 7 — YÊU CẦU + HỌC BÙ: Attendance vắng → MakeupNeed 3 trạng thái + ParentRequest
// ═════════════════════════════════════════════════════════════════════════════
const REQUESTS: {
  type:
    | "ABSENCE"
    | "MAKEUP"
    | "TRANSFER_CLASS"
    | "TRANSFER_CENTER"
    | "RESERVE"
    | "OTHER"
    | "CONSENT_CHANGE";
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  content: string;
  response: string | null;
}[] = [
  {
    type: "ABSENCE",
    status: "PENDING",
    content: "Tuần này gia đình có việc ở quê nên con xin nghỉ buổi tới, nhờ trung tâm xếp buổi bù giúp ạ.",
    response: null,
  },
  {
    type: "MAKEUP",
    status: "APPROVED",
    content: "Con nghỉ buổi cảm biến khoảng cách, phụ huynh xin học bù vào cuối tuần.",
    response: "Trung tâm đã xếp con học bù vào lớp T7 sáng, phụ huynh cho con đến trước 15 phút giúp ạ.",
  },
  {
    type: "ABSENCE",
    status: "APPROVED",
    content: "Con bị sốt nhẹ, xin phép nghỉ buổi ngày mai.",
    response: "Đã ghi nhận vắng có phép. Chúc con mau khỏe ạ.",
  },
  {
    type: "RESERVE",
    status: "PENDING",
    content: "Gia đình đi công tác 1 tháng, xin bảo lưu khoá học của con.",
    response: null,
  },
  {
    type: "TRANSFER_CLASS",
    status: "REJECTED",
    content: "Xin chuyển con sang lớp tối thứ 3 cho tiện đưa đón.",
    response: "Lớp tối thứ 3 hiện đã đủ sĩ số. Trung tâm sẽ báo lại khi có chỗ trống ạ.",
  },
  {
    type: "TRANSFER_CENTER",
    status: "PENDING",
    content: "Nhà mình vừa chuyển về gần Hoàng Diệu, xin chuyển con sang cơ sở CS2.",
    response: null,
  },
  {
    type: "OTHER",
    status: "CANCELLED",
    content: "Hỏi về lịch thi RoboSim sắp tới.",
    response: null,
  },
  {
    type: "CONSENT_CHANGE",
    status: "APPROVED",
    content: "Phụ huynh đồng ý cho trung tâm dùng hình ảnh của con trong hoạt động lớp.",
    response: "Đã cập nhật đồng ý dùng hình ảnh cho con.",
  },
];

async function seedRequestsAndMakeup(ctx: Ctx): Promise<void> {
  const now = new Date();

  // (a) Học bù — bám vào buổi con ĐÃ vắng. Không có buổi vắng thì đổi 1 buổi đã
  //     điểm danh thành vắng có phép (dữ liệu UAT, không phải prod).
  const MAKEUP_PLAN: ("PENDING" | "SCHEDULED" | "COMPLETED")[] = [
    "PENDING",
    "SCHEDULED",
    "COMPLETED",
  ];
  let needs = 0;

  for (const s of ctx.students) {
    const myClassIds = ctx.enrollments.filter((e) => e.studentId === s.id).map((e) => e.classId);
    const att = await db.attendance.findMany({
      where: { studentId: s.id, session: { classId: { in: myClassIds } } },
      select: {
        id: true,
        sessionId: true,
        status: true,
        makeupStatus: true,
        session: { select: { classId: true, date: true, lessonId: true } },
      },
      orderBy: { session: { date: "asc" } },
    });
    if (att.length === 0) {
      note(`${s.name}: chưa có điểm danh — bỏ qua học bù`);
      continue;
    }

    // 3 buổi (ưu tiên buổi đã vắng) → 3 trạng thái học bù.
    const isAbsent = (x: (typeof att)[number]) =>
      ["ABSENT", "EXCUSED", "ABSENT_EXCUSED", "ABSENT_UNEXCUSED"].includes(x.status);
    const chosen = [...att.filter(isAbsent), ...att.filter((a) => !isAbsent(a))].slice(
      0,
      MAKEUP_PLAN.length,
    );

    for (const [i, a] of chosen.entries()) {
      const status = MAKEUP_PLAN[i]!;
      const makeupSessionId =
        status === "PENDING"
          ? null
          : (ctx.sessions.find((x) => x.classId === a.session.classId && x.date > a.session.date)
              ?.id ?? null);

      if (APPLY) {
        await db.attendance.update({
          where: { id: a.id },
          data: {
            status: "ABSENT_EXCUSED",
            makeupStatus: status === "COMPLETED" ? "MADE_UP" : "NEEDS_MAKEUP",
            makeupSessionId: status === "COMPLETED" ? makeupSessionId : null,
            absenceReason: "Phụ huynh báo vắng — gia đình có việc riêng.",
          },
        });
        await db.makeupNeed.upsert({
          where: { studentId_missedSessionId: { studentId: s.id, missedSessionId: a.sessionId } },
          update: { status, makeupSessionId, classId: a.session.classId },
          create: {
            id: `${P}bu-${s.id}-${a.sessionId}`,
            studentId: s.id,
            classId: a.session.classId,
            centerId: CENTER_ID,
            orgUnitId: s.orgUnitId,
            missedSessionId: a.sessionId,
            missedLessonId: a.session.lessonId,
            status,
            makeupSessionId,
            note:
              status === "PENDING"
                ? "Chờ giáo vụ xếp buổi bù cho con."
                : "Đã xếp buổi bù cùng khối lớp.",
            completedAt:
              status === "COMPLETED" ? new Date(a.session.date.getTime() + 7 * 864e5) : null,
          },
        });
      }
      needs++;
    }
  }
  note(`học bù: ${needs} phiếu (PENDING / SCHEDULED / COMPLETED cho mỗi con)`);

  // (b) Yêu cầu của phụ huynh — phủ đủ 7 loại × 4 trạng thái, rải cho 3 con.
  let reqs = 0;
  for (const [si, s] of ctx.students.entries()) {
    const upcoming = ctx.sessions.find(
      (x) =>
        ctx.enrollments.some((e) => e.studentId === s.id && e.classId === x.classId) &&
        x.date > now,
    );
    for (const [i, r] of REQUESTS.entries()) {
      if ((i + si) % 3 === 2) continue;
      if (APPLY) {
        await db.parentRequest.upsert({
          where: { id: `${P}yc-${s.id}-${i}` },
          update: {},
          create: {
            id: `${P}yc-${s.id}-${i}`,
            studentId: s.id,
            parentUserId: ctx.parent.id,
            type: r.type,
            content: r.content,
            preferredDate: r.type === "ABSENCE" ? (upcoming?.date ?? null) : null,
            sessionId: r.type === "ABSENCE" ? (upcoming?.id ?? null) : null,
            status: r.status,
            response: r.response,
            handledByName: r.response ? "UAT — Giáo vụ CS1" : null,
            handledAt: r.response ? new Date() : null,
          },
        });
      }
      reqs++;
    }
  }
  note(`yêu cầu phụ huynh: +${reqs} phiếu (đủ 7 loại × các trạng thái)`);
}

// ═════════════════════════════════════════════════════════════════════════════
// 8 — HỌC BẠ: ReportCard PUBLISHED + snapshot đóng băng (portal đọc snapshot)
// ═════════════════════════════════════════════════════════════════════════════
type Metrics = {
  attendance: {
    total: number;
    attended: number;
    absent: number;
    needMakeup: number;
    madeUp: number;
    rate: number;
  };
  exams: { count: number; passed: number; averageScore: number | null };
  assignments: { total: number; submitted: number; graded: number; averageScore: number | null };
  skills: { skill: string; level: string }[];
  computedAt: string;
};

/**
 * Số liệu học bạ tính TẠI CHỖ. Không import lib/lms/report-card — file đó gắn
 * `server-only`, chạy bằng tsx ngoài Next là ném ngay. Công thức bám đúng
 * lib/lms/report-card-core (attendanceRatePercent / computeExamAverage /
 * computeAssignmentSummary / latestSkillLevels).
 */
async function computeMetrics(studentId: string, classId: string): Promise<Metrics> {
  const [attRows, totalSessions, attempts, subs, skills] = await Promise.all([
    db.attendance.findMany({
      where: { studentId, session: { classId } },
      select: { status: true, makeupStatus: true, session: { select: { status: true } } },
    }),
    db.classSession.count({ where: { classId, status: { not: "CANCELLED" } } }),
    db.examAttempt.findMany({
      where: {
        studentId,
        exam: { classId },
        status: { in: ["SUBMITTED", "GRADED", "REVIEWED"] },
      },
      select: { totalScore: true, passed: true, exam: { select: { totalPoints: true } } },
    }),
    db.assignmentSubmission.findMany({
      where: { studentId, assignment: { classId } },
      select: { status: true, score: true, assignment: { select: { totalPoints: true } } },
    }),
    db.studentSkillAssessment.findMany({
      where: { studentId },
      select: { skill: true, level: true, assessedAt: true },
      orderBy: { assessedAt: "asc" },
    }),
  ]);

  const PRESENT = new Set(["PRESENT", "LATE"]);
  const ABSENT = new Set(["ABSENT", "EXCUSED", "ABSENT_EXCUSED", "ABSENT_UNEXCUSED"]);
  let attended = 0;
  let absent = 0;
  let needMakeup = 0;
  let madeUp = 0;
  for (const a of attRows) {
    if (a.session.status === "CANCELLED") continue;
    if (a.makeupStatus === "MADE_UP") {
      madeUp++;
      attended++;
      continue;
    }
    if (PRESENT.has(a.status)) {
      attended++;
      continue;
    }
    if (ABSENT.has(a.status)) {
      if (a.makeupStatus === "NEEDS_MAKEUP") needMakeup++;
      else absent++;
    }
  }
  const rate = totalSessions > 0 ? Math.round((attended / totalSessions) * 100) : 0;

  const scored = attempts.filter((a) => a.totalScore != null);
  const examAvg = scored.length
    ? Math.round(
        (scored.reduce(
          (s, a) => s + ((a.totalScore ?? 0) / (a.exam.totalPoints || 10)) * 10,
          0,
        ) /
          scored.length) *
          10,
      ) / 10
    : null;

  const gradedRows = subs.filter((s) => s.status === "GRADED" && s.score != null);
  const asgAvg = gradedRows.length
    ? Math.round(
        (gradedRows.reduce(
          (s, x) => s + ((x.score ?? 0) / (x.assignment.totalPoints || 10)) * 10,
          0,
        ) /
          gradedRows.length) *
          10,
      ) / 10
    : null;

  // rows đã sort assessedAt asc → bản ghi cuối mỗi kỹ năng là mới nhất.
  const latest = new Map<string, string>();
  for (const r of skills) latest.set(r.skill, r.level);

  return {
    attendance: { total: totalSessions, attended, absent, needMakeup, madeUp, rate },
    exams: {
      count: scored.length,
      passed: attempts.filter((a) => a.passed === true).length,
      averageScore: examAvg,
    },
    assignments: {
      total: subs.length,
      submitted: subs.filter((s) => ["SUBMITTED", "LATE", "GRADED"].includes(s.status)).length,
      graded: gradedRows.length,
      averageScore: asgAvg,
    },
    skills: Array.from(latest.entries()).map(([skill, level]) => ({ skill, level })),
    computedAt: new Date().toISOString(),
  };
}

const FINAL_COMMENTS = [
  "Con hoàn thành khoá học với thái độ tích cực. Kỹ năng lắp ráp cơ khí đã vững, phần lập trình điều kiện con nắm tốt và biết tự gỡ lỗi. Đề xuất cho con học tiếp khoá kế tiếp để phát triển phần cảm biến nâng cao.",
  "Con tiến bộ đều qua từng kỳ, đặc biệt là khả năng làm việc nhóm và trình bày sản phẩm trước lớp. Cần duy trì thói quen kiểm tra lại chương trình trước khi chạy thử.",
  "Con có tư duy giải quyết vấn đề tốt, thường tìm ra cách làm khác với hướng dẫn mẫu. Kỷ luật lớp học tốt, luôn dọn dẹp bộ học cụ sau buổi.",
];
const PERIOD_COMMENTS: Record<string, string> = {
  SESSION_5:
    "Sau 5 buổi con đã quen với bộ học cụ, lắp được khung xe cơ bản và nạp chương trình đơn giản. Con còn cần cô nhắc thứ tự các bước.",
  SESSION_12:
    "Hết 12 buổi con tự lắp và lập trình trọn một dự án, biết dùng cảm biến để điều khiển. Con đã tự tin trình bày sản phẩm trước lớp.",
};

async function seedReportCards(ctx: Ctx): Promise<void> {
  let published = 0;
  let createdScores = 0;

  for (const enr of ctx.enrollments) {
    const s = ctx.students.find((x) => x.id === enr.studentId);
    const cls = ctx.classes.find((c) => c.id === enr.classId);
    if (!s || !cls) continue;

    const criteria = await db.reportCardCriterion.findMany({
      where: { courseId: enr.courseId, active: true },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true },
    });
    if (criteria.length === 0) {
      note(`học bạ ${s.name} / ${cls.name}: khoá chưa có tiêu chí năng lực — bỏ qua`);
      continue;
    }

    // Lớp mới học vài buổi thì để DRAFT — học bạ chỉ phát hành khi đã đủ dữ liệu.
    const completed = ctx.sessions.filter(
      (x) => x.classId === cls.id && x.status === "COMPLETED",
    ).length;
    const willPublish = completed >= 5;

    const existing = await db.reportCard.findUnique({
      where: { enrollmentId: enr.id },
      select: { id: true, status: true, finalComment: true, completionStatus: true },
    });
    const rcId = existing?.id ?? `${P}hocba-${enr.id}`;
    const r = rng(enr.id.length * 131 + 17);
    const finalComment = existing?.finalComment ?? pick(FINAL_COMMENTS, r());
    const periodComments = [
      { period: "SESSION_5", comment: PERIOD_COMMENTS.SESSION_5! },
      ...(completed >= 12 ? [{ period: "SESSION_12", comment: PERIOD_COMMENTS.SESSION_12! }] : []),
    ];
    const completionStatus =
      existing?.completionStatus ?? (completed >= 12 ? "Hoàn thành khoá" : "Đang học");

    // Điểm từng tiêu chí — thang 1..4 (ReportCardScore.level).
    const scores = criteria.map((c, i) => ({
      criterionId: c.id,
      level: 2 + ((i + Math.floor(r() * 3)) % 3), // 2..4
      note: i === 0 ? "Giáo viên theo dõi thêm ở khoá kế tiếp." : null,
    }));

    if (APPLY) {
      await db.reportCard.upsert({
        where: { enrollmentId: enr.id },
        update: {
          finalComment,
          completionStatus,
          periodComments: periodComments as unknown as Prisma.InputJsonValue,
          teacherId: cls.teacherId,
          centerId: cls.centerId,
          orgUnitId: cls.orgUnitId,
        },
        create: {
          id: rcId,
          enrollmentId: enr.id,
          status: "DRAFT",
          finalComment,
          completionStatus,
          periodComments: periodComments as unknown as Prisma.InputJsonValue,
          teacherId: cls.teacherId,
          centerId: cls.centerId,
          orgUnitId: cls.orgUnitId,
        },
      });
      for (const sc of scores) {
        await db.reportCardScore.upsert({
          where: { reportCardId_criterionId: { reportCardId: rcId, criterionId: sc.criterionId } },
          update: { level: sc.level, note: sc.note },
          create: { id: `${P}rcs-${rcId}-${sc.criterionId}`, reportCardId: rcId, ...sc },
        });
      }
    }
    createdScores += scores.length;

    if (!willPublish) {
      note(`học bạ ${s.name} / ${cls.name}: giữ DRAFT (mới ${completed} buổi hoàn tất)`);
      continue;
    }

    // Snapshot đóng băng — portal ĐỌC TỪ ĐÂY chứ không tính lại (lib/lms/report-card).
    const publishedAt = new Date();
    const metrics: Metrics = APPLY
      ? await computeMetrics(s.id, cls.id)
      : {
          attendance: { total: 0, attended: 0, absent: 0, needMakeup: 0, madeUp: 0, rate: 0 },
          exams: { count: 0, passed: 0, averageScore: null },
          assignments: { total: 0, submitted: 0, graded: 0, averageScore: null },
          skills: [],
          computedAt: publishedAt.toISOString(),
        };
    const critName = new Map(criteria.map((c) => [c.id, c.name]));
    const snapshot = {
      version: 1 as const,
      metrics,
      finalComment,
      completionStatus,
      periodComments,
      scores: scores.map((sc) => ({
        criterionId: sc.criterionId,
        name: critName.get(sc.criterionId) ?? "(tiêu chí)",
        level: sc.level,
        note: sc.note,
      })),
      student: { name: s.name, studentCode: s.studentCode },
      course: { name: cls.course.name },
      className: cls.name,
      publishedAt: publishedAt.toISOString(),
    };

    if (APPLY) {
      await db.reportCard.update({
        where: { id: rcId },
        data: {
          status: "PUBLISHED",
          publishedAt,
          publishedById: cls.teacherId,
          publishedSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          centerId: cls.centerId,
        },
      });
    }
    published++;
    note(
      `học bạ ${s.name} / ${cls.name}: PHÁT HÀNH (${criteria.length} tiêu chí, ${periodComments.length} kỳ nhận xét)`,
    );
  }
  note(`học bạ: ${published} bản phát hành, ${createdScores} dòng điểm tiêu chí`);
}

// ═════════════════════════════════════════════════════════════════════════════
// 9 — ĐÁNH GIÁ GIÁO VIÊN: EvalForm + đợt MỞ (+1 phiếu đã gửi để có cả 2 trạng thái)
// ═════════════════════════════════════════════════════════════════════════════
const TEACHER_QUESTIONS: {
  type: "STAR_RATING" | "RADIO" | "CHECKBOX" | "TEXTBOX";
  label: string;
  options?: string[];
  required?: boolean;
}[] = [
  { type: "STAR_RATING", label: "Mức độ hài lòng chung với giáo viên", required: true },
  { type: "STAR_RATING", label: "Giáo viên truyền đạt dễ hiểu", required: true },
  {
    type: "RADIO",
    label: "Giáo viên có phản hồi kịp thời khi phụ huynh hỏi không?",
    options: ["Luôn luôn", "Thường xuyên", "Thỉnh thoảng", "Hiếm khi"],
    required: true,
  },
  {
    type: "CHECKBOX",
    label: "Điều phụ huynh hài lòng nhất",
    options: [
      "Nhiệt tình với học viên",
      "Nhận xét chi tiết theo buổi",
      "Gửi ảnh/hoạt động đầy đủ",
      "Quản lý lớp tốt",
      "Đúng giờ",
    ],
  },
  { type: "TEXTBOX", label: "Góp ý thêm cho giáo viên" },
];

async function seedTeacherEval(ctx: Ctx): Promise<void> {
  const formId = `${P}form-gv`;
  const roundId = `${P}dot-gv`;
  const p = vnParts(new Date());
  const opensAt = vnDateAt(p.year, p.month, p.day - 7);
  const closesAt = vnDateAt(p.year, p.month, p.day + 30, 23, 59);

  if (APPLY) {
    await db.evalForm.upsert({
      where: { id: formId },
      update: { status: "ACTIVE" },
      create: {
        id: formId,
        title: "Phiếu đánh giá giáo viên — học kỳ 2/2026",
        scope: "TEACHER_EVAL",
        status: "ACTIVE",
      },
    });
    for (const [i, q] of TEACHER_QUESTIONS.entries()) {
      await db.evalQuestion.upsert({
        where: { id: `${P}q-gv-${i}` },
        update: {},
        create: {
          id: `${P}q-gv-${i}`,
          formId,
          type: q.type,
          label: q.label,
          options: (q.options ?? null) as unknown as Prisma.InputJsonValue,
          required: q.required ?? false,
          order: i,
        },
      });
    }
    await db.evaluationRound.upsert({
      where: { id: roundId },
      update: { status: "OPEN", opensAt, closesAt },
      create: {
        id: roundId,
        formId,
        scope: "TEACHER_EVAL",
        name: "Đợt đánh giá giáo viên — tháng 8/2026",
        centerId: CENTER_ID,
        orgUnitId: ctx.classes[0]?.orgUnitId ?? null,
        opensAt,
        closesAt,
        status: "OPEN",
      },
    });
  }

  // Cặp (ghi danh × GV) phụ huynh được đánh giá — đúng luật lib/eval/eligibility.
  const TAUGHT = ["ACTIVE", "CONFIRMED", "STUDYING", "PAUSED", "COMPLETED"];
  const pairs = ctx.enrollments
    .filter((e) => TAUGHT.includes(e.status))
    .map((e) => ({ e, cls: ctx.classes.find((c) => c.id === e.classId) }))
    .filter((x) => x.cls?.centerId === CENTER_ID && x.cls?.teacherId);
  note(`đánh giá GV: đợt MỞ tại CS1, ${pairs.length} cặp (lớp × giáo viên) đánh giá được`);

  // Gửi sẵn 1 phiếu để trang có cả "đã gửi" lẫn "chưa gửi".
  const first = pairs[0];
  if (first?.cls?.teacherId && APPLY) {
    const respId = `${P}tl-gv-0`;
    await db.evalResponse.upsert({
      where: {
        roundId_enrollmentId_teacherId: {
          roundId,
          enrollmentId: first.e.id,
          teacherId: first.cls.teacherId,
        },
      },
      update: {},
      create: {
        id: respId,
        roundId,
        enrollmentId: first.e.id,
        teacherId: first.cls.teacherId,
        parentUserId: ctx.parent.id,
        studentId: first.e.studentId,
      },
    });
    await db.evalAnswer.createMany({
      data: [
        { id: `${P}tla-0`, responseId: respId, questionId: `${P}q-gv-0`, valueNumber: 5 },
        { id: `${P}tla-1`, responseId: respId, questionId: `${P}q-gv-1`, valueNumber: 4 },
        {
          id: `${P}tla-2`,
          responseId: respId,
          questionId: `${P}q-gv-2`,
          valueOptions: ["Luôn luôn"] as unknown as Prisma.InputJsonValue,
        },
        {
          id: `${P}tla-3`,
          responseId: respId,
          questionId: `${P}q-gv-3`,
          valueOptions: [
            "Nhiệt tình với học viên",
            "Nhận xét chi tiết theo buổi",
          ] as unknown as Prisma.InputJsonValue,
        },
        {
          id: `${P}tla-4`,
          responseId: respId,
          questionId: `${P}q-gv-4`,
          valueText:
            "Cô dạy rất tận tâm, con nhà mình rất thích đi học. Mong cô gửi thêm ảnh hoạt động của lớp ạ.",
        },
      ],
      skipDuplicates: true,
    });
    note("đánh giá GV: 1 phiếu đã gửi sẵn (nghiệm thu cả trạng thái đã đánh giá)");
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 10 — PHIẾU ĐÁNH GIÁ BUỔI HỌC (SESSION_EVAL) — khối thứ 2 của trang Nhận xét
// ═════════════════════════════════════════════════════════════════════════════
const SESSION_QUESTIONS: {
  type: "STAR_RATING" | "TEXTBOX" | "PHOTO";
  label: string;
  group?: string;
}[] = [
  { type: "STAR_RATING", label: "Mức độ hoàn thành nhiệm vụ buổi học", group: "Kiến thức" },
  { type: "TEXTBOX", label: "Nhận xét của giáo viên về buổi học", group: "Thái độ học tập" },
  { type: "PHOTO", label: "Ảnh sản phẩm của con", group: "Sản phẩm" },
];

async function seedSessionEval(ctx: Ctx): Promise<void> {
  const formId = `${P}form-buoi`;
  const roundId = `${P}dot-buoi`;
  if (APPLY) {
    await db.evalForm.upsert({
      where: { id: formId },
      update: { status: "ACTIVE" },
      create: {
        id: formId,
        title: "Phiếu đánh giá buổi học",
        scope: "SESSION_EVAL",
        status: "ACTIVE",
      },
    });
    for (const [i, q] of SESSION_QUESTIONS.entries()) {
      await db.evalQuestion.upsert({
        where: { id: `${P}q-buoi-${i}` },
        update: {},
        create: {
          id: `${P}q-buoi-${i}`,
          formId,
          type: q.type,
          label: q.label,
          groupLabel: q.group ?? null,
          order: i,
        },
      });
    }
    await db.evaluationRound.upsert({
      where: { id: roundId },
      update: { status: "OPEN" },
      create: {
        id: roundId,
        formId,
        scope: "SESSION_EVAL",
        name: "Phiếu đánh giá buổi — khoá hè 2026",
        centerId: CENTER_ID,
        status: "OPEN",
      },
    });
  }

  let n = 0;
  for (const s of ctx.students) {
    const myClassIds = ctx.enrollments.filter((e) => e.studentId === s.id).map((e) => e.classId);
    const done = ctx.sessions
      .filter((x) => myClassIds.includes(x.classId) && x.status === "COMPLETED")
      .slice(-4); // 4 buổi gần nhất mỗi con
    for (const [i, sess] of done.entries()) {
      const r = rng(s.id.length * 311 + i * 41);
      const respId = `${P}tl-buoi-${sess.id}-${s.id}`;
      if (APPLY) {
        await db.evalResponse.upsert({
          where: { id: respId },
          update: {},
          create: {
            id: respId,
            roundId,
            studentId: s.id,
            classSessionId: sess.id,
            submittedAt: sess.date,
          },
        });
        await db.evalAnswer.createMany({
          data: [
            {
              id: `${P}tla-buoi-${sess.id}-${s.id}-0`,
              responseId: respId,
              questionId: `${P}q-buoi-0`,
              valueNumber: 3 + Math.round(r() * 2),
            },
            {
              id: `${P}tla-buoi-${sess.id}-${s.id}-1`,
              responseId: respId,
              questionId: `${P}q-buoi-1`,
              valueText: pick(OVERALL_TEXTS, r()),
            },
            {
              id: `${P}tla-buoi-${sess.id}-${s.id}-2`,
              responseId: respId,
              questionId: `${P}q-buoi-2`,
              valueOptions: [
                `https://picsum.photos/seed/uatph${i}${s.id.slice(-3)}/800/600`,
              ] as unknown as Prisma.InputJsonValue,
            },
          ],
          skipDuplicates: true,
        });
      }
      n++;
    }
  }
  note(`phiếu đánh giá buổi học: +${n} phiếu (kèm ảnh sản phẩm — gate theo consent)`);
}

// ═════════════════════════════════════════════════════════════════════════════
async function main(): Promise<void> {
  const host = currentDbHost();
  const direct = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "";
  console.log(`\n🎯 SEED UAT PHỤ HUYNH — ${PARENT_EMAIL}`);
  console.log(`   DB: ${host}`);
  console.log(`   Chế độ: ${APPLY ? "GHI THẬT (--apply)" : "DRY-RUN (thêm --apply để ghi)"}\n`);

  if (!direct.includes(EXPECTED_DB_REF) && !FORCE_HOST) {
    throw new Error(
      `DB không phải dev/test (mong đợi ref ${EXPECTED_DB_REF}). Thêm --force-host nếu CỐ Ý chạy nơi khác.`,
    );
  }

  // DỌN TRƯỚC khi nạp ngữ cảnh. Nạp trước rồi mới dọn thì ctx còn giữ các buổi
  // `uatph-buoi-*` vừa bị xoá ⇒ seedSchedule tưởng lớp đã đủ buổi sắp tới và bỏ
  // qua, lần chạy thứ hai lịch học teo lại (đã ăn thật ở lượt --apply đầu).
  console.log("── 0. Dọn dữ liệu uatph- lần trước ──────────────");
  if (APPLY) await cleanup();
  else note("(dry-run) bỏ qua");

  const ctx = await loadContext();
  console.log(
    `\n👨‍👩‍👧 ${ctx.parent.name} — ${ctx.students.length} con, ${ctx.enrollments.length} ghi danh, ${ctx.classes.length} lớp, ${ctx.sessions.length} buổi`,
  );
  for (const s of ctx.students) console.log(`   · ${s.name} (${s.studentCode})`);

  console.log("\n── 1. Lớp ───────────────────────────────────────");
  await seedClasses(ctx);
  console.log("\n── 2. Lịch học ──────────────────────────────────");
  await seedSchedule(ctx);
  console.log("\n── 3. Nhận xét ──────────────────────────────────");
  await seedFeedback(ctx);
  console.log("\n── 4. Hình ảnh lớp ──────────────────────────────");
  await seedPhotos(ctx);
  console.log("\n── 5. Kỹ năng robot ─────────────────────────────");
  await seedSkills(ctx);
  console.log("\n── 6. Bài tập của con ───────────────────────────");
  await seedHomework(ctx);
  console.log("\n── 7. Yêu cầu + học bù ──────────────────────────");
  await seedRequestsAndMakeup(ctx);
  console.log("\n── 8. Học bạ ────────────────────────────────────");
  await seedReportCards(ctx);
  console.log("\n── 9. Đánh giá giáo viên ────────────────────────");
  await seedTeacherEval(ctx);
  console.log("\n── 10. Phiếu đánh giá buổi học ──────────────────");
  await seedSessionEval(ctx);

  console.log(`\n${APPLY ? "✅ ĐÃ GHI" : "📋 DRY-RUN"} — ${plan.length} nhóm thao tác.`);
  if (!APPLY) console.log("   Chạy lại với --apply để ghi thật.\n");
  else console.log(`\n   Đăng nhập ${PARENT_EMAIL} → hocvien.satarobo.vn để nghiệm thu.\n`);
}

main()
  .catch((e) => {
    console.error("\n❌", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
