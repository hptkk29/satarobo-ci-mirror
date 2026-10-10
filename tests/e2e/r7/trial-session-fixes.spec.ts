/**
 * TRIAL-SESSION-FIXES — mở thông luồng BOOK LỊCH HỌC THỬ (Sale book → GV nhận & xem).
 * Postgres LOCAL (.env.test). Test service-level (mẫu bulk-convert): gọi thẳng
 * lib/trial/service + lib/lms/teacher-schedule, không dựng HTTP.
 *
 * Phủ:
 *  1. Tạo lớp slot (không startDate) → addTrialSession tạo buổi đúng ngày/giờ/GV (#1).
 *  2. enroll KHÔNG truyền sessionId → auto-gán buổi SCHEDULED gần nhất; lớp không
 *     có buổi → lỗi rõ (#2).
 *  3. Sau (1)+(2): getTeacherTrialRoster của GV TRẢ VỀ học viên (điều đang chết).
 *  4. getTeacherTrialSessions ≡ getTeacherTrialRoster về tập buổi (chống lệch #5),
 *     kể cả buổi teacherId null thuộc lớp GV chính + buổi gán riêng ở lớp người khác.
 *  5. Thêm buổi với GV KHÁC cơ sở → bị từ chối (R2-RBAC-3).
 *  6. Enrollment cũ scheduledSessionId null → hiện ở nhóm "Chưa xếp buổi" (không tàng hình).
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedUser } from "../_helpers/seed";
import {
  createTrialClass,
  addTrialSession,
  enrollLeadChild,
  vnTodayUtc,
} from "../../../lib/trial/service";
import {
  getTeacherTrialRoster,
  getTeacherTrialSessions,
} from "../../../lib/lms/teacher-schedule";

const DAY_MS = 24 * 60 * 60 * 1000;
/** UTC 00:00 của (hôm nay VN + n ngày) — khớp @db.Date của TrialClassSession. */
const plusDays = (n: number) => new Date(vnTodayUtc().getTime() + n * DAY_MS);

// Cửa sổ roster như trang /teacher/trial dùng thật.
const FROM = () => plusDays(-30);
const TO = () => plusDays(31);

test.describe("[TRIAL] Book lịch học thử: thêm buổi → auto-gán → GV thấy", () => {
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

  async function seedTeacher(centerId: string, tag = "gv") {
    return seedUser({
      email: `${tag}-${uniq()}@test.com`,
      role: "TEACHER",
      name: `GV ${tag}`,
      centerId,
    });
  }

  async function seedSale(centerId: string) {
    return seedUser({
      email: `sale-${uniq()}@test.com`,
      role: "SALES_CSM",
      name: "Sale Trial",
      centerId,
    });
  }

  async function seedLeadChild(centerId: string, childName: string) {
    const lead = await db.lead.create({
      data: { parentName: "PH Trial", phone: `090${String(seq++).padStart(7, "0")}`, centerId },
    });
    const child = await db.leadChild.create({
      data: { leadId: lead.id, fullName: childName },
    });
    return { lead, child };
  }

  /**
   * Lớp trải nghiệm slot tái sử dụng. 28/08 — `createTrialClass` chỉ còn nhận cơ sở +
   * khoá; tên tự sinh, và giờ/phòng/GV/sĩ số nay là thuộc tính của TỪNG BUỔI.
   *
   * `teacherId` giữ trong chữ ký helper cho các ca bên dưới đọc dễ, nhưng KHÔNG truyền
   * xuống lớp nữa — buổi tự mang giáo viên của nó (`addTrialSession`).
   */
  async function seedTrialClass(centerId: string, _teacherId: string | null, actorId: string) {
    const res = await createTrialClass({ centerId, actorId });
    expect(res.ok).toBe(true);
    return res.trialClassId!;
  }

  test("[TRIAL-01] thêm buổi cho lớp slot → TrialClassSession đúng ngày/giờ, GV mặc định = GV lớp, có báo GV", async () => {
    const center = await seedCenter();
    const teacher = await seedTeacher(center.id);
    const sale = await seedSale(center.id);
    const classId = await seedTrialClass(center.id, teacher.id, sale.id);

    // Lớp slot: chưa có buổi nào (đây chính là blocker cũ).
    expect(await db.trialClassSession.count({ where: { trialClassId: classId } })).toBe(0);

    const date = plusDays(2);
    const res = await addTrialSession({
      trialClassId: classId,
      date,
      startTime: "18:00",
      endTime: "19:30",
      // 28/08 — lớp KHÔNG còn giáo viên cấp lớp nên không còn gì để "kế thừa";
      // giáo viên nay chọn ngay khi thêm buổi.
      teacherId: teacher.id,
      actorId: sale.id,
    });
    expect(res.ok).toBe(true);
    expect(res.sessionId).toBeTruthy();

    const sess = await db.trialClassSession.findUniqueOrThrow({ where: { id: res.sessionId! } });
    expect(sess.trialClassId).toBe(classId);
    expect(sess.seq).toBe(1);
    expect(sess.date.getTime()).toBe(date.getTime());
    expect(sess.startTime).toBe("18:00");
    expect(sess.endTime).toBe("19:30");
    expect(sess.teacherId).toBe(teacher.id);
    expect(sess.status).toBe("SCHEDULED");

    // #6 — GV được báo qua chuông StaffNotification (actor là sale ≠ GV).
    const notif = await db.staffNotification.findFirst({
      where: { userId: teacher.id, dedupeKey: `trial-session.assigned:${res.sessionId}` },
    });
    expect(notif).not.toBeNull();
  });

  // 28/08 — ĐẢO hợp đồng của ca này. Chủ dự án chốt: xếp con vào lớp là con học TOÀN BỘ
  // buổi của lớp, nên enroll không kèm `sessionId` KHÔNG còn auto-gán một buổi nữa.
  //
  // Bản trước khoá đúng hành vi ngược lại, và có lý do chính đáng của nó: hồi ấy roster
  // giáo viên ghép học viên CHỈ qua `scheduledSessionId`, nên ghi danh không buổi là học
  // viên tàng hình. Nay roster đã rải ghi danh không-buổi vào mọi buổi của lớp
  // (`lib/lms/teacher-schedule.ts`), nên điều kiện sinh ra nếp cũ không còn.
  test("[TRIAL-02] enroll KHÔNG sessionId → học TOÀN BỘ buổi (scheduledSessionId null), kể cả lớp chưa có buổi", async () => {
    const center = await seedCenter();
    const teacher = await seedTeacher(center.id);
    const sale = await seedSale(center.id);
    const classId = await seedTrialClass(center.id, teacher.id, sale.id);

    // Lớp CHƯA có buổi vẫn xếp được: Sale nhận khách trước, xếp lịch sau. Bản cũ chặn ở
    // đây vì auto-gán không có gì để gán.
    const { child: childSom } = await seedLeadChild(center.id, "Bé Xếp Sớm");
    const som = await enrollLeadChild({
      trialClassId: classId,
      leadChildId: childSom.id,
      addedById: sale.id,
    });
    expect(som.ok).toBe(true);
    const enrSom = await db.trialEnrollment.findFirstOrThrow({
      where: { leadChildId: childSom.id },
    });
    expect(enrSom.scheduledSessionId).toBeNull();

    // Thêm hai buổi SAU khi đã xếp người: ghi danh cũ KHÔNG bị gán vào buổi nào — em đó
    // học cả hai, và roster phải trả về em ở CẢ HAI buổi (khoá ở TRIAL-06).
    const far = await addTrialSession({
      trialClassId: classId, date: plusDays(3), startTime: "18:00", endTime: "19:30",
      teacherId: teacher.id, actorId: sale.id,
    });
    const near = await addTrialSession({
      trialClassId: classId, date: plusDays(1), startTime: "18:00", endTime: "19:30",
      teacherId: teacher.id, actorId: sale.id,
    });
    expect(far.ok && near.ok).toBe(true);
    expect(
      (await db.trialEnrollment.findFirstOrThrow({ where: { leadChildId: childSom.id } }))
        .scheduledSessionId,
    ).toBeNull();

    // Xếp người khi lớp ĐÃ có buổi: vẫn không gán buổi nào.
    const { child } = await seedLeadChild(center.id, "Bé Học Cả Lớp");
    const res = await enrollLeadChild({
      trialClassId: classId,
      leadChildId: child.id,
      addedById: sale.id,
    });
    expect(res.ok).toBe(true);
    const enr = await db.trialEnrollment.findFirstOrThrow({ where: { leadChildId: child.id } });
    expect(enr.scheduledSessionId).toBeNull();

    // Muốn xếp RIÊNG một buổi thì phải nói rõ — đường đó không bị gỡ.
    const { child: childRieng } = await seedLeadChild(center.id, "Bé Xếp Riêng");
    const rieng = await enrollLeadChild({
      trialClassId: classId,
      leadChildId: childRieng.id,
      addedById: sale.id,
      sessionId: near.sessionId,
    });
    expect(rieng.ok).toBe(true);
    expect(
      (await db.trialEnrollment.findFirstOrThrow({ where: { leadChildId: childRieng.id } }))
        .scheduledSessionId,
    ).toBe(near.sessionId);
  });

  test("[TRIAL-03] luồng đầy đủ Sale book → roster GV TRẢ VỀ học viên", async () => {
    const center = await seedCenter();
    const teacher = await seedTeacher(center.id);
    const sale = await seedSale(center.id);
    const classId = await seedTrialClass(center.id, teacher.id, sale.id);

    const added = await addTrialSession({
      trialClassId: classId, date: plusDays(1), startTime: "18:00", endTime: "19:30",
      // 28/08 — lớp KHÔNG còn giáo viên cấp lớp, nên buổi phải tự mang GV của nó.
      teacherId: teacher.id, actorId: sale.id,
    });
    expect(added.ok).toBe(true);

    const { child } = await seedLeadChild(center.id, "Bé Roster");
    const enrolled = await enrollLeadChild({
      trialClassId: classId,
      leadChildId: child.id,
      addedById: sale.id,
    });
    expect(enrolled.ok).toBe(true);

    const roster = await getTeacherTrialRoster(teacher.id, FROM(), TO());
    expect(roster.slots.length).toBe(1);
    expect(roster.slots[0]!.sessionId).toBe(added.sessionId);
    expect(roster.slots[0]!.students.map((s) => s.studentName)).toContain("Bé Roster");
    expect(roster.unassigned).toHaveLength(0);
  });

  test("[TRIAL-04] getTeacherTrialSessions ≡ getTeacherTrialRoster về tập buổi (kể cả buổi teacherId null / buổi gán riêng)", async () => {
    const center = await seedCenter();
    const teacher = await seedTeacher(center.id, "gv-chinh");
    const other = await seedTeacher(center.id, "gv-khac");
    const sale = await seedSale(center.id);

    // Lớp A: GV chính = teacher; 1 buổi KHÔNG gán GV riêng (teacherId null) —
    // trước fix: hiện ở roster (/teacher/trial) nhưng MẤT ở lịch (/teacher/lich).
    const classA = await seedTrialClass(center.id, teacher.id, sale.id);
    // 28/08 — buổi KHÔNG gán giáo viên nay thật sự không thuộc lịch của ai: lớp đã hết
    // cột giáo viên để "kế thừa". Ý của ca này là hai đường đọc trả về CÙNG tập buổi,
    // nên gán thẳng GV cho buổi.
    const sesNull = await addTrialSession({
      trialClassId: classA, date: plusDays(1), startTime: "18:00", endTime: "19:30",
      teacherId: teacher.id, actorId: sale.id,
    });
    expect(sesNull.ok).toBe(true);

    // Lớp B: GV chính = other; 1 buổi gán RIÊNG cho teacher (dạy thay).
    const classB = await seedTrialClass(center.id, other.id, sale.id);
    const sesAssigned = await addTrialSession({
      trialClassId: classB, date: plusDays(2), startTime: "09:00", endTime: "10:30",
      teacherId: teacher.id, actorId: sale.id,
    });
    expect(sesAssigned.ok).toBe(true);

    const lich = await getTeacherTrialSessions(teacher.id, FROM(), TO());
    const roster = await getTeacherTrialRoster(teacher.id, FROM(), TO());

    const lichIds = lich.map((s) => s.id).sort();
    const rosterIds = roster.slots.map((s) => s.sessionId).sort();
    expect(lichIds).toEqual(rosterIds);
    expect(lichIds).toEqual([sesNull.sessionId, sesAssigned.sessionId].sort());
  });

  // 07/08 — CHÍNH SÁCH ĐỔI: GV là nguồn lực chung (Hội sở điều đi mọi cơ sở), gắn
  // được cho lớp / lịch trial ở BẤT KỲ cơ sở nào. Ca này trước đây khoá luật cũ
  // "GV khác cơ sở → từ chối"; nay đảo lại thành PHẢI CHẤP NHẬN.
  // Gỡ hàng rào có chủ ý, không phải hạ chuẩn test.
  test("[TRIAL-05] thêm buổi với GV khác cơ sở → CHẤP NHẬN (chính sách mới 07/08)", async () => {
    const cs1 = await seedCenter("CS1");
    const cs2 = await seedCenter("CS2");
    const teacherCs2 = await seedTeacher(cs2.id, "gv-cs2");
    const sale = await seedSale(cs1.id);
    const classId = await seedTrialClass(cs1.id, null, sale.id);

    const res = await addTrialSession({
      trialClassId: classId,
      date: plusDays(1),
      startTime: "18:00",
      endTime: "19:30",
      teacherId: teacherCs2.id,
      actorId: sale.id,
    });
    expect(res.ok).toBe(true);
    expect(await db.trialClassSession.count({ where: { trialClassId: classId } })).toBe(1);
    // GV được gán đúng là người ở cơ sở khác — không bị thay thầm bằng GV lớp.
    const buoi = await db.trialClassSession.findFirstOrThrow({
      where: { trialClassId: classId },
      select: { teacherId: true },
    });
    expect(buoi.teacherId).toBe(teacherCs2.id);
  });

  test("[TRIAL-06] enrollment cũ scheduledSessionId null → hiện nhóm 'Chưa xếp buổi' của roster GV", async () => {
    const center = await seedCenter();
    const teacher = await seedTeacher(center.id);
    const sale = await seedSale(center.id);
    const classId = await seedTrialClass(center.id, teacher.id, sale.id);
    const { child } = await seedLeadChild(center.id, "Bé Data Cũ");

    // Ghi danh KHÔNG gắn buổi. 28/08 đây là MẶC ĐỊNH (học cả lớp), không còn là "data
    // cũ"; lớp lại chưa có buổi nào nên em phải rơi vào nhóm "Chưa xếp buổi".
    // `gvPhanCongId` là đường duy nhất nối em này với giáo viên, vì lớp không còn GV.
    await db.trialEnrollment.create({
      data: {
        trialClassId: classId,
        leadChildId: child.id,
        addedById: sale.id,
        gvPhanCongId: teacher.id,
      },
    });

    const roster = await getTeacherTrialRoster(teacher.id, FROM(), TO());
    expect(roster.unassigned.map((s) => s.studentName)).toContain("Bé Data Cũ");
  });
});
