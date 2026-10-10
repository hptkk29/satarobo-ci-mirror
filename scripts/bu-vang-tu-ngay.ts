/**
 * scripts/bu-vang-tu-ngay.ts — TẠO dòng chờ học bù cho buổi vắng CHƯA có MakeupNeed (02/10/2026).
 *
 *   DATABASE_URL=… pnpm exec tsx scripts/bu-vang-tu-ngay.ts                       # CHẠY THỬ (chỉ đếm)
 *   DATABASE_URL=… pnpm exec tsx scripts/bu-vang-tu-ngay.ts --ghi --expect=<N>    # GHI
 *     --tu=YYYY-MM-DD   buổi từ ngày này (giờ VN), mặc định 2026-09-20
 *
 * Vì sao có: chủ dự án chốt 02/10 "mọi buổi vắng (kể cả có phép) đều cần học bù" và "lấy data từ
 * 20/9". Luật mới chỉ áp cho lượt điểm danh SAU khi deploy; buổi vắng đã điểm danh trước đó (chủ
 * yếu vắng CÓ PHÉP — luật cũ không tạo dòng) vẫn thiếu MakeupNeed nên không lên màn /hoc-bu.
 *
 * Làm đúng việc đường điểm danh thật làm (`lib/lms/attendance-record.ts`): MakeupNeed PENDING
 * mang `missedLessonId` của buổi + Attendance.makeupStatus NONE → NEEDS_MAKEUP. KHÔNG đụng
 * dòng đã có MakeupNeed (dù trạng thái gì — kể cả đã huỷ/đã bù), KHÔNG đụng MADE_UP.
 *
 * Hai cổng ghi: `--expect=N` phải bằng đúng số "SẼ TẠO" của chính lượt chạy (lệch ⇒ không ghi
 * gì), và mọi phép ghi trong MỘT transaction. Chạy thử đọc trong transaction READ ONLY.
 */
import "./_cho-phep-server-only";
import { db } from "../lib/db";

const GHI = process.argv.includes("--ghi");
const EXPECT = process.argv
  .find((a) => a.startsWith("--expect="))
  ?.split("=")[1];
const TU =
  process.argv.find((a) => a.startsWith("--tu="))?.split("=")[1] ??
  "2026-09-20";
const NHAN = "[bu-vang-tu-ngay]";

if (!/^\d{4}-\d{2}-\d{2}$/.test(TU)) throw new Error(`--tu sai dạng: ${TU}`);
const TU_NGAY = new Date(`${TU}T00:00:00+07:00`);

type Dong = {
  attendanceId: string;
  studentId: string;
  sessionId: string;
  classId: string;
  centerId: string | null;
  courseId: string;
  lessonId: string | null;
  makeupStatus: string;
  ngay: string;
  lop: string;
  ten: string;
  trangThai: string;
};

async function lapKeHoach(
  tx: Pick<typeof db, "attendance" | "makeupNeed">,
): Promise<Dong[]> {
  const vang = await tx.attendance.findMany({
    where: {
      status: { notIn: ["PRESENT", "LATE"] },
      makeupStatus: { not: "MADE_UP" },
      session: {
        date: { gte: TU_NGAY },
        status: { not: "CANCELLED" },
        class: { deletedAt: null },
      },
      student: { deletedAt: null },
    },
    select: {
      id: true,
      studentId: true,
      sessionId: true,
      status: true,
      makeupStatus: true,
      student: { select: { name: true } },
      session: {
        select: {
          date: true,
          lessonId: true,
          classId: true,
          class: { select: { name: true, centerId: true, courseId: true } },
        },
      },
    },
    orderBy: { session: { date: "asc" } },
  });
  // Bỏ cặp (học viên, buổi) ĐÃ có MakeupNeed — bất kể trạng thái (đã huỷ/đã bù là chủ ý).
  const coSan = vang.length
    ? await tx.makeupNeed.findMany({
        where: {
          OR: vang.map((v) => ({
            studentId: v.studentId,
            missedSessionId: v.sessionId,
          })),
        },
        select: { studentId: true, missedSessionId: true },
      })
    : [];
  const daCo = new Set(coSan.map((n) => `${n.studentId}|${n.missedSessionId}`));
  return vang
    .filter((v) => !daCo.has(`${v.studentId}|${v.sessionId}`))
    .map((v) => ({
      attendanceId: v.id,
      studentId: v.studentId,
      sessionId: v.sessionId,
      classId: v.session.classId,
      centerId: v.session.class.centerId,
      courseId: v.session.class.courseId,
      lessonId: v.session.lessonId,
      makeupStatus: v.makeupStatus,
      ngay: v.session.date.toISOString().slice(0, 10),
      lop: v.session.class.name,
      ten: v.student.name,
      trangThai: v.status,
    }));
}

async function main() {
  console.log(`[bu-vang] buổi từ ${TU} · chế độ ${GHI ? "GHI" : "CHẠY THỬ"}`);
  const ketQua = await db.$transaction(
    async (tx) => {
      if (!GHI) await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const ke = await lapKeHoach(tx);
      console.log(`SẼ TẠO ${ke.length} dòng chờ học bù:`);
      for (const d of ke)
        console.log(
          `  ${d.ngay} · ${d.lop} · ${d.ten} · ${d.trangThai}/${d.makeupStatus}`,
        );
      if (!GHI) return { tao: 0, du: ke.length };

      if (EXPECT === undefined || Number(EXPECT) !== ke.length) {
        throw new Error(
          `--expect=${EXPECT ?? "(thiếu)"} khác số SẼ TẠO ${ke.length} — KHÔNG ghi gì. Chạy thử lại rồi điền đúng số.`,
        );
      }
      const tao = await tx.makeupNeed.createMany({
        data: ke.map((d) => ({
          studentId: d.studentId,
          classId: d.classId,
          centerId: d.centerId,
          courseId: d.courseId,
          missedSessionId: d.sessionId,
          missedLessonId: d.lessonId,
          // T05: script vá — nguồn SYSTEM_MIGRATION, nhưng ĐÃ biết điểm danh gốc nên liên kết luôn.
          sourceType: "SYSTEM_MIGRATION" as const,
          originalAttendanceId: d.attendanceId,
          note: NHAN,
        })),
        skipDuplicates: true,
      });
      await tx.attendance.updateMany({
        where: {
          id: { in: ke.map((d) => d.attendanceId) },
          makeupStatus: "NONE",
        },
        data: { makeupStatus: "NEEDS_MAKEUP" },
      });
      return { tao: tao.count, du: ke.length };
    },
    // Runner ↔ DB qua tunnel: trần 5 giây mặc định của Prisma cắt giữa chừng (P2028).
    { timeout: 120_000, maxWait: 20_000 },
  );
  console.log(
    GHI
      ? `[xong] đã tạo ${ketQua.tao}/${ketQua.du} dòng.`
      : "CHẠY THỬ — không ghi gì.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
