/**
 * Seed buổi học + điểm danh cho lớp test (để Portal v2 hiển thị đầy đủ như SataUI).
 *   pnpm tsx prisma/seed-test-sessions.ts
 * Idempotent: xoá session/attendance cũ của lớp test rồi tạo lại. KHÔNG cho prod.
 */
import { db } from "../lib/db";

const CLASS_ID = "cmqqhcvoj00061ey49q5eqc20";
const CURRICULUM_ID = "cmqhwollz002v5z4dnja4uoks";

const TITLES = [
  "Làm quen robot & an toàn",
  "Cảm biến cơ bản",
  "Động cơ & bánh xe",
  "Lập trình di chuyển",
  "Cảm biến dò line",
  "Lắp ráp khung gầm",
  "Lắp ráp khung gầm nâng cao",
  "Cánh tay robot & servo",
  "Lập trình theo kịch bản",
  "Dự án nhóm: robot phân loại",
  "Xử lý lỗi & tối ưu",
  "Robot tránh vật cản",
  "Ôn tập & kiểm tra",
  "Tổng kết & trình diễn",
];

/**
 * QA 20/07 (Lỗi 2 + Lỗi A) — bản cũ seed mỗi 3 ngày lúc 12:00 bất chấp lịch lớp
 * → buổi rơi vào Chủ Nhật + giờ sai (lớp 15:38). Giờ sinh ngày theo ĐÚNG
 * scheduleDays + startTime của lớp: `pastCount` buổi gần nhất đã qua + phần còn
 * lại sắp tới, tính từ hôm nay.
 */
function sessionDatesAround(
  scheduleDays: number[],
  startTime: string,
  pastCount: number,
  futureCount: number,
): Date[] {
  const days = new Set(scheduleDays);
  const [hh, mm] = startTime.split(":").map((x) => parseInt(x, 10));
  const at = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh || 0, mm || 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const past: Date[] = [];
  const back = new Date(today);
  back.setDate(back.getDate() - 1);
  let guard = 0;
  while (past.length < pastCount && guard++ < 400) {
    if (days.has(back.getDay())) past.unshift(at(back));
    back.setDate(back.getDate() - 1);
  }

  const future: Date[] = [];
  const fwd = new Date(today);
  guard = 0;
  while (future.length < futureCount && guard++ < 400) {
    if (days.has(fwd.getDay())) future.push(at(fwd));
    fwd.setDate(fwd.getDate() + 1);
  }
  return [...past, ...future];
}

async function main() {
  const students = await db.student.findMany({
    where: { studentCode: { in: ["CS1-TEST-001", "CS1-TEST-002"] } },
    select: { id: true },
  });
  if (students.length === 0) throw new Error("Chưa có học viên test — chạy seed-test-parent trước.");

  const cls = await db.class.findUnique({
    where: { id: CLASS_ID },
    select: { scheduleDays: true, startTime: true, centerId: true },
  });
  if (!cls) throw new Error("Chưa có lớp test — chạy seed-test-parent trước.");
  const scheduleDays = cls.scheduleDays.length > 0 ? cls.scheduleDays : [1, 3];
  const startTime = cls.startTime ?? "18:00";
  // QA 21/07 (#C2/#C3) — ClassSession/Attendance ∈ SCOPED_MODELS: PHẢI set centerId,
  // thiếu → GV (center-scope) không thấy buổi ("Buổi không thuộc bạn", tab điểm danh trống).
  const centerId = cls.centerId;

  // 1) Lessons (upsert theo unique curriculumId+order)
  const lessons = [];
  for (let i = 0; i < TITLES.length; i++) {
    const l = await db.lesson.upsert({
      where: { curriculumId_order: { curriculumId: CURRICULUM_ID, order: i + 1 } },
      update: { title: TITLES[i] },
      create: { curriculumId: CURRICULUM_ID, order: i + 1, title: TITLES[i] },
      select: { id: true },
    });
    lessons.push(l.id);
  }

  // 2) Xoá session + attendance cũ của lớp (idempotent)
  const old = await db.classSession.findMany({ where: { classId: CLASS_ID }, select: { id: true } });
  const oldIds = old.map((s) => s.id);
  if (oldIds.length) {
    await db.attendance.deleteMany({ where: { sessionId: { in: oldIds } } });
    await db.classSession.deleteMany({ where: { id: { in: oldIds } } });
  }

  // 3) 14 buổi theo ĐÚNG lịch lớp (scheduleDays + startTime): 7 đã qua + 7 sắp tới
  const dates = sessionDatesAround(scheduleDays, startTime, 7, 7);
  const now = Date.now();
  const sessions: { id: string; idx: number; past: boolean }[] = [];
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    const past = d.getTime() < now;
    const s = await db.classSession.create({
      data: {
        classId: CLASS_ID,
        date: d,
        lessonId: lessons[i],
        status: past ? "COMPLETED" : "SCHEDULED",
        centerId,
      },
      select: { id: true },
    });
    sessions.push({ id: s.id, idx: i, past });
  }

  // 4) Điểm danh các buổi đã qua: ~83% có mặt (1 buổi vắng cần học bù)
  let att = 0;
  for (const st of students) {
    for (const s of sessions) {
      if (!s.past) continue;
      const absent = s.idx === 2; // 1/7 buổi vắng → ~86% chuyên cần
      await db.attendance.create({
        data: {
          sessionId: s.id,
          studentId: st.id,
          status: absent ? "ABSENT" : "PRESENT",
          makeupStatus: absent ? "NEEDS_MAKEUP" : "NONE",
          centerId,
        },
      });
      att++;
    }
  }

  console.log(`✅ Seed lịch học: ${lessons.length} lesson, ${sessions.length} buổi (7 đã qua + 7 sắp tới), ${att} điểm danh.`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error("❌", e);
    await db.$disconnect();
    process.exit(1);
  });
