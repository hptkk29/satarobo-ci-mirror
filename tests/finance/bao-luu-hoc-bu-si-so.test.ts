// tests/finance/bao-luu-hoc-bu-si-so.test.ts — [BL6B] học bù × bảo lưu: SĨ SỐ lớp đích không đếm bé đang bảo lưu (no-roster #5), POSTGRES THẬT.
//
// `suggestMakeupSessions` (capacityOk) và `scheduleMakeup` (re-check sức chứa trong giao dịch) đếm ghi danh bằng `ENROLLMENT_ACTIVE_STATUS_LIST`
// — danh sách cố ý gồm `PAUSED`. Hồ sơ bảo lưu ĐỜI MỚI (đã duyệt, đang hiệu lực) rút bé khỏi lớp (BR-13): bé không ngồi ghế nào, nên lớp đích
// "đầy" vì một bé đang nghỉ là TỪ CHỐI NHẦM một bé khác cần bù. Ca đỏ trước bản vá (`trongLop(..., now)` ở cả hai chỗ + lọc lớp của chính bé).
//
// Đồng hồ ĐÓNG BĂNG (luật 19): NOW truyền vào `suggestMakeupSessions(…, now)` / `scheduleMakeup({ now })`.
import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { suggestMakeupSessions, scheduleMakeup } from "@/lib/makeup/service";

if (!RUN_DB_TESTS) console.warn(`[BL6B] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-bl6b-";
const CS = `${T}cs`;
const KHOA = `${T}khoa`;
const LOP_NHA = `${T}lop-nha`; // lớp bé cần bù đang học (đã lỡ buổi)
const LOP_DICH = `${T}lop-dich`; // lớp đích, sĩ số tối đa 2
const BAI = `${T}bai`;
const GT = `${T}gt`;
const NOW = new Date("2026-03-10T03:00:00Z"); // cố ý XA đồng hồ thật: nếu mã quên truyền `now`, buổi bù (NOW+4 ngày) đã nằm trong quá khứ và ca đỏ
const NGAY = 86_400_000;
const SIEU: Actor = {
  userId: `${T}sa`,
  isSuperAdmin: true,
  isHoLevel: true,
  orgRoles: [],
  permissions: [],
  visibleCenterIds: [CS],
  visibleOrgUnitIds: [],
  grantsAllow: new Set<string>(),
  assignedClassIds: new Set<string>(),
};

async function don() {
  // `scheduleMakeup` phát `makeup.confirmed:<needId>` TRONG giao dịch; sự kiện của lượt chạy trước còn lại ⇒ P2002 ⇒ giao dịch hỏng (nền `main` chưa có bản sửa
  // publishEvent 24bbe6b30 của `test`). Dọn theo tiền tố để mỗi lượt sạch.
  await db.domainEvent.deleteMany({ where: { dedupeKey: { startsWith: `makeup.confirmed:${T}` } } });
  await db.makeupNeed.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.studentReserve.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: T } } });
  await db.classSession.deleteMany({ where: { classId: { startsWith: T } } });
  await db.class.deleteMany({ where: { id: { startsWith: T } } });
  await db.lesson.deleteMany({ where: { curriculumId: GT } });
  await db.curriculum.deleteMany({ where: { id: GT } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: { startsWith: T } } });
  await db.center.deleteMany({ where: { id: CS } });
}

/** Lớp đích 2 chỗ: Q (học thường) + P (đang bảo lưu theo quy chế, ghi danh PAUSED); bé S cần bù buổi bài 5 đã lỡ ở lớp nhà. */
async function dung(o: { themR?: boolean; hoSoP?: "DANG_NGHI" | "DA_KET_THUC" | "CHUA_DUYET" | "KHONG" } = {}) {
  await don();
  await db.center.create({ data: { id: CS, name: "CS 6B", slug: CS, address: "x" } });
  await db.course.create({ data: { id: KHOA, name: "Sata 3 6B", slug: KHOA, totalSessions: 48 } });
  await db.curriculum.create({ data: { id: GT, courseId: KHOA, name: "GT 6B" } });
  await db.lesson.create({ data: { id: BAI, curriculumId: GT, order: 5, title: "Bài 5" } });
  await db.class.create({ data: { id: LOP_NHA, name: "Lớp nhà", courseId: KHOA, centerId: CS, status: "ACTIVE", maxStudents: 12 } });
  await db.class.create({ data: { id: LOP_DICH, name: "Lớp đích", courseId: KHOA, centerId: CS, status: "ACTIVE", maxStudents: 2 } });
  const homQua = new Date(NOW.getTime() - 3 * NGAY);
  const maiSau = new Date(NOW.getTime() + 4 * NGAY);
  await db.classSession.create({ data: { id: `${T}s-lo`, classId: LOP_NHA, date: homQua, centerId: CS, lessonId: BAI } });
  await db.classSession.create({ data: { id: `${T}s-bu`, classId: LOP_DICH, date: maiSau, centerId: CS, lessonId: BAI } });

  const hv = async (k: string) => db.student.create({ data: { id: `${T}hv-${k}`, name: `HV ${k}`, centerId: CS, status: "ACTIVE" } });
  for (const k of ["s", "q", "p", ...(o.themR ? ["r"] : [])]) await hv(k);
  await db.enrollment.create({ data: { id: `${T}gd-s`, studentId: `${T}hv-s`, classId: LOP_NHA, courseId: KHOA, status: "ACTIVE", centerId: CS } });
  await db.enrollment.create({ data: { id: `${T}gd-q`, studentId: `${T}hv-q`, classId: LOP_DICH, courseId: KHOA, status: "ACTIVE", centerId: CS } });
  if (o.themR) await db.enrollment.create({ data: { id: `${T}gd-r`, studentId: `${T}hv-r`, classId: LOP_DICH, courseId: KHOA, status: "ACTIVE", centerId: CS } });
  await db.enrollment.create({ data: { id: `${T}gd-p`, studentId: `${T}hv-p`, classId: LOP_DICH, courseId: KHOA, status: "PAUSED", centerId: CS } });
  const ho = o.hoSoP ?? "DANG_NGHI";
  if (ho !== "KHONG") {
    await db.studentReserve.create({
      data: {
        studentId: `${T}hv-p`, enrollmentId: `${T}gd-p`, reason: "fx", createdByName: "x", centerId: CS, type: "PARENT",
        status: ho === "DA_KET_THUC" ? "ENDED" : ho === "CHUA_DUYET" ? "PENDING" : "ACTIVE",
        isActive: ho === "DANG_NGHI",
        approvedAt: ho === "CHUA_DUYET" ? null : new Date(NOW.getTime() - 20 * NGAY),
        startedAt: new Date(NOW.getTime() - 20 * NGAY),
        endedAt: ho === "DA_KET_THUC" ? new Date(NOW.getTime() - 5 * NGAY) : null,
      },
    });
  }
  const need = await db.makeupNeed.create({
    data: { id: `${T}need`, studentId: `${T}hv-s`, classId: LOP_NHA, centerId: CS, missedSessionId: `${T}s-lo`, missedLessonId: BAI },
  });
  return need.id;
}

const conCho = async (needId: string) => (await suggestMakeupSessions(needId, SIEU, NOW)).filter((x) => x.classId === LOP_DICH);

describe.skipIf(!RUN_DB_TESTS)("[BL6B] học bù × bảo lưu: sĩ số lớp đích", () => {
  afterAll(don);

  it("[BL6B-DB-01] gợi ý buổi bù: bé P đang bảo lưu (hồ sơ đã duyệt) KHÔNG chiếm chỗ — lớp 2 chỗ có Q + P ⇒ còn 1 chỗ, lớp đích HIỆN", async () => {
    const id = await dung();
    const r = await conCho(id);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ classId: LOP_DICH, capacityLeft: 1 });
  });

  it("[BL6B-DB-02] ĐỐI CHỨNG DƯƠNG: thêm bé R học thường ⇒ Q + R = 2 chỗ ⇒ lớp đích đầy, KHÔNG hiện (bé P vẫn không được tính)", async () => {
    const id = await dung({ themR: true });
    expect(await conCho(id)).toHaveLength(0);
  });

  it("[BL6B-DB-03] hồ sơ KHÔNG có hiệu lực theo quy chế thì bé P vẫn chiếm chỗ như hôm nay: hồ sơ đã KẾT THÚC, chưa DUYỆT, hoặc không có hồ sơ (PAUSED dán tay) ⇒ lớp đầy", async () => {
    for (const ho of ["DA_KET_THUC", "CHUA_DUYET", "KHONG"] as const) {
      const id = await dung({ hoSoP: ho });
      expect(await conCho(id), ho).toHaveLength(0);
    }
  });

  it("[BL6B-DB-04] xếp buổi bù: lớp Q + P(bảo lưu) còn chỗ ⇒ xếp ĐƯỢC (SCHEDULED); thêm bé R ⇒ đầy ⇒ từ chối 'đã đầy chỗ'", async () => {
    const id = await dung();
    const ok = await scheduleMakeup({ makeupNeedId: id, makeupSessionId: `${T}s-bu`, actor: SIEU, now: NOW });
    expect(ok).toMatchObject({ ok: true });
    expect((await db.makeupNeed.findUniqueOrThrow({ where: { id } })).status).toBe("SCHEDULED");

    const id2 = await dung({ themR: true });
    const day = await scheduleMakeup({ makeupNeedId: id2, makeupSessionId: `${T}s-bu`, actor: SIEU, now: NOW });
    expect(day).toMatchObject({ ok: false, error: expect.stringContaining("đầy chỗ") });
    expect((await db.makeupNeed.findUniqueOrThrow({ where: { id: id2 } })).status).toBe("PENDING");
  });

  it("[BL6B-DB-05] bé CẦN BÙ đang bảo lưu ở lớp khác không bị coi là 'bận' vì lớp ấy: nhưng bé học thường thì ngày học của lớp đó vẫn chặn trùng lịch", async () => {
    // Bé S học ở lớp nhà; lớp nhà có buổi cùng NGÀY với buổi bù ⇒ trùng ⇒ lớp đích bị loại (hành vi cũ, phải giữ).
    const id = await dung();
    const ngayBu = new Date(NOW.getTime() + 4 * NGAY);
    await db.classSession.create({ data: { id: `${T}s-trung`, classId: LOP_NHA, date: ngayBu, centerId: CS, lessonId: BAI } });
    expect(await conCho(id)).toHaveLength(0);
    // Nay bé S có hồ sơ bảo lưu đang hiệu lực ở chính lớp nhà ⇒ lớp nhà không còn là lớp bé "đang theo" ⇒ ngày đó KHÔNG còn bận.
    await db.enrollment.update({ where: { id: `${T}gd-s` }, data: { status: "PAUSED" } });
    await db.studentReserve.create({
      data: {
        studentId: `${T}hv-s`, enrollmentId: `${T}gd-s`, reason: "fx", createdByName: "x", centerId: CS, type: "PARENT", status: "ACTIVE", isActive: true,
        approvedAt: new Date(NOW.getTime() - 20 * NGAY), startedAt: new Date(NOW.getTime() - 20 * NGAY),
      },
    });
    expect(await conCho(id)).toHaveLength(1);
  });
});
