// prisma/seed-uat-giaovien.ts — dựng dữ liệu NGHIỆM THU cho màn "Học viên Trial"
// của tài khoản giáo viên UAT.
//
// Vì sao cần: tài khoản `uat.giaovien@satarobo.vn` đang phụ trách 50 lớp trải nghiệm
// nhưng **cả 50 lớp đều 0 buổi**. Bảng Trial của site GV ghép học viên qua
// `TrialEnrollment.scheduledSessionId` → không có buổi thì không có dòng nào, và người
// nghiệm thu 26/08 đọc màn trống thành "chưa làm" cho NT-17/18/20/21.
//
// Seed dựng đủ CẢ 7 TRẠNG THÁI mà `lib/lms/trial-row-status.ts` sinh ra, để mỗi nhãn
// trên bảng đều có một dòng thật đối chiếu.
//
// Chạy:
//   pnpm exec dotenv -e .env -- tsx prisma/seed-uat-giaovien.ts
//   pnpm exec dotenv -e .env -- tsx prisma/seed-uat-giaovien.ts --clean   # dọn rồi dựng lại
//
// IDEMPOTENT: mọi bản ghi mang tiền tố `UAT-GV·` ở tên/ghi chú và id cố định, chạy lại
// là ghi đè chính nó chứ không sinh bản sao. `--clean` xoá sạch phần seed này trước.
//
// ⚠️ CHỈ chạy trên DB dev/test. Không có cơ chế nào chặn bạn trỏ vào prod ngoài việc
// đọc kỹ `.env` trước khi gõ lệnh — cùng luật với mọi seed khác trong thư mục này.
import { db } from "../lib/db";
import {
  ensureCommissionStatement,
  recordTrialTeacherCommission,
} from "../lib/crm/trial-teacher-commission";

const EMAIL = "uat.giaovien@satarobo.vn";
const MARK = "UAT-GV";
const CLEAN = process.argv.includes("--clean");

/** Mốc UTC 00:00 của NGÀY hôm nay theo giờ VN — khớp cột `@db.Date` của Trial. */
function vnToday(): Date {
  const vn = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()));
}
const DAY = 24 * 60 * 60 * 1000;
function dayOffset(n: number): Date {
  return new Date(vnToday().getTime() + n * DAY);
}

/** id cố định để chạy lại là ghi đè, không đẻ bản sao. */
const id = (kind: string, n: number | string) => `uatgv-${kind}-${n}`;

type Kid = {
  n: number;
  child: string;
  parent: string;
  birthYear: number;
  courseSlug: string;
  /** Buổi được xếp: offset ngày so với hôm nay. */
  dayAt: number;
  /** Trạng thái muốn dựng ra trên bảng. */
  want:
    | "upcoming"
    | "rescheduled"
    | "awaiting-eval"
    | "evaluated"
    | "enrolled"
    | "lost"
    | "withdrawn";
};

// Mỗi dòng = một nhãn trên bảng Trial. Ngày chọn sao cho 4 dòng đầu rơi vào cửa sổ
// "7 ngày tới" (bảng trên), 3 dòng sau rơi xuống bảng "Đã Trial".
const KIDS: Kid[] = [
  { n: 1, child: "Hoàng Gia Bảo", parent: "Hoàng Văn Sơn", birthYear: 2016, courseSlug: "sata3", dayAt: 1, want: "upcoming" },
  { n: 2, child: "Nguyễn Khánh An", parent: "Nguyễn Thị Hoà", birthYear: 2017, courseSlug: "sata3", dayAt: 3, want: "upcoming" },
  { n: 3, child: "Trần Minh Quân", parent: "Trần Quốc Việt", birthYear: 2015, courseSlug: "sata4", dayAt: 5, want: "rescheduled" },
  { n: 4, child: "Lê Bảo Ngọc", parent: "Lê Thị Thu", birthYear: 2016, courseSlug: "sata3", dayAt: 6, want: "upcoming" },
  { n: 5, child: "Phạm Gia Hân", parent: "Phạm Văn Dũng", birthYear: 2015, courseSlug: "sata4", dayAt: -3, want: "awaiting-eval" },
  { n: 6, child: "Đỗ Nhật Minh", parent: "Đỗ Trung Kiên", birthYear: 2014, courseSlug: "sata5", dayAt: -7, want: "evaluated" },
  { n: 7, child: "Vũ Thanh Trúc", parent: "Vũ Đình Nam", birthYear: 2016, courseSlug: "sata3", dayAt: -10, want: "enrolled" },
  { n: 8, child: "Bùi Anh Khoa", parent: "Bùi Hữu Phước", birthYear: 2015, courseSlug: "sata4", dayAt: -14, want: "lost" },
  { n: 9, child: "Ngô Diệu Linh", parent: "Ngô Văn Hải", birthYear: 2017, courseSlug: "sata3", dayAt: -18, want: "withdrawn" },
];

async function clean(teacherId: string): Promise<void> {
  const classes = await db.trialClassV2.findMany({
    where: { teacherId, name: { startsWith: MARK } },
    select: { id: true },
  });
  const classIds = classes.map((c) => c.id);
  if (classIds.length) {
    const enrs = await db.trialEnrollment.findMany({
      where: { trialClassId: { in: classIds } },
      select: { id: true },
    });
    const enrIds = enrs.map((e) => e.id);
    await db.trialRubricEval.deleteMany({ where: { trialEnrollmentId: { in: enrIds } } });
    await db.trialAttendance.deleteMany({ where: { trialEnrollmentId: { in: enrIds } } });
    await db.leadTrialHistory.deleteMany({ where: { trialClassId: { in: classIds } } });
    await db.trialEnrollment.deleteMany({ where: { trialClassId: { in: classIds } } });
    await db.trialClassSession.deleteMany({ where: { trialClassId: { in: classIds } } });
    await db.trialClassV2.deleteMany({ where: { id: { in: classIds } } });
  }
  // Lead seed mang tiền tố ở `source` → xoá con trước (FK Cascade lo, nhưng nói rõ ý).
  await db.lead.deleteMany({ where: { source: MARK } });
  const wiped = await db.commissionLine.deleteMany({
    where: { note: { startsWith: MARK } },
  });
  if (wiped.count) console.log(`  🧹 đã dọn ${wiped.count} dòng hoa hồng seed cũ`);
  console.log(`  🧹 đã dọn ${classIds.length} lớp Trial + lead của lần seed trước`);
}

async function main() {
  const teacher = await db.user.findFirst({
    where: { email: EMAIL },
    select: { id: true, name: true, centerId: true },
  });
  if (!teacher) throw new Error(`Không tìm thấy tài khoản ${EMAIL}`);
  if (!teacher.centerId) throw new Error(`${EMAIL} chưa gắn cơ sở (centerId)`);
  const centerId = teacher.centerId;
  console.log(`\n🌱 Seed nghiệm thu Trial cho ${teacher.name} <${EMAIL}>`);
  console.log(`   Cơ sở: ${centerId}\n`);

  if (CLEAN) await clean(teacher.id);

  // Khoá học để hiện cột "Khoá học" — dùng chính 9 khoá Sata đã nạp giáo trình.
  const courses = await db.course.findMany({
    where: { slug: { in: [...new Set(KIDS.map((k) => k.courseSlug))] } },
    select: { id: true, slug: true, name: true },
  });
  const courseBySlug = new Map(courses.map((c) => [c.slug, c]));

  // ── Lớp trải nghiệm riêng cho UAT ────────────────────────────────────────────
  const trialClassId = id("class", 1);
  await db.trialClassV2.upsert({
    where: { id: trialClassId },
    update: { teacherId: teacher.id, centerId, status: "OPEN" },
    create: {
      id: trialClassId,
      code: `${MARK}-01`,
      name: `${MARK} · Lớp trải nghiệm nghiệm thu`,
      centerId,
      teacherId: teacher.id,
      startTime: "09:00",
      endTime: "10:30",
      capacity: 20,
      sessionCount: 1,
      status: "OPEN",
    },
  });

  // ── Buổi: đủ cả tương lai lẫn quá khứ ────────────────────────────────────────
  // `seq` để ô chọn "Dời lịch" ở /admin/trial-classes/[id] in ra "Buổi N".
  const offsets = [...new Set(KIDS.map((k) => k.dayAt))].sort((a, b) => a - b);
  // Thêm 2 buổi tương lai TRỐNG để NT-20 có chỗ dời tới.
  for (const extra of [8, 10]) if (!offsets.includes(extra)) offsets.push(extra);

  const sessionIdByOffset = new Map<number, string>();
  let seq = 0;
  for (const off of offsets) {
    seq += 1;
    const sid = id("ses", off);
    sessionIdByOffset.set(off, sid);
    await db.trialClassSession.upsert({
      where: { id: sid },
      update: {
        date: dayOffset(off),
        teacherId: teacher.id,
        status: off < 0 ? "COMPLETED" : "SCHEDULED",
      },
      create: {
        id: sid,
        trialClassId,
        seq,
        date: dayOffset(off),
        startTime: "09:00",
        endTime: "10:30",
        teacherId: teacher.id,
        status: off < 0 ? "COMPLETED" : "SCHEDULED",
      },
    });
  }
  console.log(`  ✓ ${offsets.length} buổi trải nghiệm (${offsets.filter((o) => o >= 0).length} sắp tới)`);

  // ── Học viên + phụ huynh + ghi danh ──────────────────────────────────────────
  let done = 0;
  for (const k of KIDS) {
    const course = courseBySlug.get(k.courseSlug);
    const leadId = id("lead", k.n);
    const childId = id("child", k.n);
    const enrId = id("enr", k.n);
    const sesId = sessionIdByOffset.get(k.dayAt)!;

    await db.lead.upsert({
      where: { id: leadId },
      // "DA_HEN_HOC_THU" chứ không "TRIAL_SCHEDULED": GĐ5 rút enum LeadStatus còn 10 giá trị.
      update: { parentName: k.parent, centerId, status: "DA_HEN_HOC_THU" },
      create: {
        id: leadId,
        parentName: k.parent,
        phone: `0900${String(100000 + k.n).slice(-6)}`,
        centerId,
        source: MARK,
        status: "DA_HEN_HOC_THU",
      },
    });

    await db.leadChild.upsert({
      where: { id: childId },
      update: {
        fullName: k.child,
        dob: new Date(Date.UTC(k.birthYear, 5, 15)),
        interestedCourseId: course?.id ?? null,
      },
      create: {
        id: childId,
        leadId,
        fullName: k.child,
        dob: new Date(Date.UTC(k.birthYear, 5, 15)),
        interestedCourseId: course?.id ?? null,
        trialStatus: k.dayAt < 0 ? "ATTENDED" : "SCHEDULED",
      },
    });

    // Dời lịch: ghi buổi CŨ để bảng in "Bị dời lịch".
    const movedFrom =
      k.want === "rescheduled" ? (sessionIdByOffset.get(1) ?? null) : null;

    await db.trialEnrollment.upsert({
      where: { id: enrId },
      update: {
        scheduledSessionId: sesId,
        status: k.want === "withdrawn" ? "WITHDRAWN" : k.dayAt < 0 ? "COMPLETED" : "ACTIVE",
        rescheduledFromSessionId: movedFrom,
        rescheduledAt: movedFrom ? new Date() : null,
        rescheduleReason: movedFrom ? `${MARK} · phụ huynh xin đổi buổi` : null,
      },
      create: {
        id: enrId,
        trialClassId,
        leadChildId: childId,
        scheduledSessionId: sesId,
        status: k.want === "withdrawn" ? "WITHDRAWN" : k.dayAt < 0 ? "COMPLETED" : "ACTIVE",
        rescheduledFromSessionId: movedFrom,
        rescheduledAt: movedFrom ? new Date() : null,
        rescheduleReason: movedFrom ? `${MARK} · phụ huynh xin đổi buổi` : null,
      },
    });

    // Buổi đã qua ⇒ có điểm danh CÓ MẶT. Đây cũng là điều kiện cứng để tính hoa hồng
    // GV dạy Trial (lib/crm/trial-teacher-commission.ts) — thiếu nó thì NT-21 không ra.
    if (k.dayAt < 0 && k.want !== "withdrawn") {
      await db.trialAttendance.upsert({
        where: { trialSessionId_trialEnrollmentId: { trialSessionId: sesId, trialEnrollmentId: enrId } },
        update: { status: "PRESENT" },
        create: { trialSessionId: sesId, trialEnrollmentId: enrId, status: "PRESENT" },
      });
    }

    // Phiếu rubric ⇒ nhãn "Đã đánh giá". Chỉ dựng cho đúng dòng muốn thế.
    if (k.want === "evaluated") {
      // GĐ4 — khoá phiếu là CẶP (ca, buổi), `trialEnrollmentId` một mình thôi duy nhất.
      await db.trialRubricEval.upsert({
        where: {
          trialEnrollmentId_trialClassSessionId: {
            trialEnrollmentId: enrId,
            trialClassSessionId: sesId,
          },
        },
        update: {},
        create: {
          trialEnrollmentId: enrId,
          trialClassSessionId: sesId,
          scores: { focus: 1.5, interact: 1.5, keyboard: 1, experience: 1, absorb: 1.5, logic: 1.5 },
          totalScore: 8,
          rank: "Tốt",
          generalComment: `${MARK} · con tiếp thu nhanh, hợp lộ trình Sata.`,
          evaluatedById: teacher.id,
          evaluatedByName: teacher.name ?? "GV",
        },
      });
    }

    // Sổ học thử: ENROLLED / LOST là thứ bảng đọc để in "Đã nhập học · +1% HH" và "Bị rớt".
    const outcome =
      k.want === "enrolled" ? "ENROLLED" : k.want === "lost" ? "LOST" : "PENDING";
    await db.leadTrialHistory.upsert({
      where: { leadChildId_trialClassId: { leadChildId: childId, trialClassId } },
      update: { outcome, attendedCount: k.dayAt < 0 ? 1 : 0 },
      create: {
        leadChildId: childId,
        trialClassId,
        centerId,
        totalSessions: 1,
        attendedCount: k.dayAt < 0 ? 1 : 0,
        outcome,
      },
    });

    if (k.want === "enrolled" || k.want === "lost") {
      await db.lead.update({
        where: { id: leadId },
        // GĐ5: ENROLLED gộp vào DA_DANG_KY, LOST thành DA_MAT.
        data: { status: k.want === "enrolled" ? "DA_DANG_KY" : "DA_MAT" },
      });
    }

    done += 1;
  }

  console.log(`  ✓ ${done} học viên trải nghiệm — đủ 7 trạng thái của bảng`);

  // ── Hoa hồng GV dạy Trial (NT-21) ───────────────────────────────────────────
  //
  // Nhãn "Đã nhập học · +1% HH" ở bảng GV đọc `LeadTrialHistory.outcome` (đã dựng ở
  // trên), nhưng SỐ TIỀN thì nằm ở `CommissionLine` và chỉ sinh ra khi convert thật.
  // Người nghiệm thu không có đường nào để convert trên UAT, nên dựng sẵn một dòng —
  // và dựng bằng CHÍNH hai hàm sản phẩm dùng, để cái được nghiệm thu là đường thật
  // chứ không phải một bản sao chép tay chỉ đúng ở màn hình.
  const enrolledKid = KIDS.find((k) => k.want === "enrolled");
  if (enrolledKid) {
    const now = new Date();
    const statement = await ensureCommissionStatement(now);
    const res = await recordTrialTeacherCommission(db, {
      statement,
      teacherUserId: teacher.id,
      // `CommissionLine.enrollmentId` là cột TRẦN (không FK) — id tổng hợp ở đây chỉ
      // đóng vai khoá chống ghi trùng, không trỏ tới Enrollment thật nào.
      enrollmentId: id("enrollment", enrolledKid.n),
      finalPrice: 7_920_000, // học phí ưu đãi Sata3 — khớp bảng giá thật
      leadId: id("lead", enrolledKid.n),
      note: `${MARK} · Trial → nhập học: ${enrolledKid.child}`,
    });
    if (res?.ok) {
      console.log(
        `  ✓ Hoa hồng GV dạy Trial: ${res.amount.toLocaleString("vi-VN")}đ ` +
          `(kỳ ${statement.period}) — xem /admin/crm/commission`,
      );
    } else if (res) {
      console.log(
        `  ⚠️  Kỳ ${res.period} ĐÃ DUYỆT nên không ghi được dòng hoa hồng. ` +
          `Kế toán mở lại kỳ rồi chạy lại seed.`,
      );
    }
  }
  console.log(`\n   Bảng Trial GV:  https://test.satarobo.vn/teacher/trial`);
  console.log(`   Hoa hồng (admin): https://test.satarobo.vn/admin/crm/commission\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
