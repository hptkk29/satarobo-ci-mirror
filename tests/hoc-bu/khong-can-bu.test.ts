// tests/hoc-bu/khong-can-bu.test.ts — [KCD-*] NÚT "KHÔNG CẦN BÙ" Ở MÀN ĐIỂM DANH (chủ dự án 22/10/2026), Postgres THẬT.
//
// Chạy:  pnpm test:hoc-bu-db
//
// Gọi THẲNG `dongBoDongSauDiemDanh` (đúng hàm mà lưới admin và panel GV cùng gọi trong giao dịch lưu điểm danh) với `makeupStatus` đã qua `makeupStatusSauKhiLuu`.
// Mỗi ca tự dựng lại từ đầu (chạy MỘT MÌNH vẫn xanh — luật 18). Đối chứng dương: cùng buổi vắng với NEEDS_MAKEUP thì CÓ dòng (nếu không, "không tạo dòng" xanh vì không gì tạo được).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { docHocVienDaXepCaseO, dongBoDongSauDiemDanh, giaoDichDiemDanh, type BanGhiDiemDanhDaLuu } from "@/lib/hoc-bu/dong-diem-danh";
import { laChonKhongCanBuMoi, makeupStatusSauKhiLuu } from "@/lib/hoc-bu/giu-da-bu";

if (!RUN_DB_TESTS) console.warn(`[KCD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-kcd-";
const id = (s: string) => `${T}${s}`;
const CS = id("cs");
const KHOA = id("khoa");
const CUR = id("cur");
const BAI = id("bai");
const QL = id("ql");
const LOP = id("lop");
const HV = id("hv");
const BUOI = id("buoi");

async function don() {
  await db.auditLog.deleteMany({ where: { module: "hoc-bu", entityId: { startsWith: T } } });
  const need = await db.makeupNeed.findMany({ where: { studentId: HV }, select: { id: true } });
  await db.auditLog.deleteMany({ where: { entityId: { in: need.map((n) => n.id) } } });
  await db.parentRequest.deleteMany({ where: { studentId: HV } });
  await db.makeupNeed.deleteMany({ where: { studentId: HV } });
  await db.attendance.deleteMany({ where: { studentId: HV } });
  await db.classSession.deleteMany({ where: { classId: LOP } });
  await db.enrollment.deleteMany({ where: { studentId: HV } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.lesson.deleteMany({ where: { id: BAI } });
  await db.curriculum.deleteMany({ where: { id: CUR } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: HV } });
  await db.user.deleteMany({ where: { id: { in: [QL, id("ph")] } } });
  await db.center.deleteMany({ where: { id: CS } });
}

async function dung() {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở KCD", slug: `${T}cs`, address: "114 Hoàng Diệu" } });
  await db.user.create({ data: { id: QL, name: "QLCS KCD", email: `${QL}@test.local`, role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], centerId: CS } });
  await db.course.create({ data: { id: KHOA, name: "Khoá KCD", slug: `${T}khoa`, totalSessions: 12, price: 12_000_000 } });
  await db.curriculum.create({ data: { id: CUR, courseId: KHOA, name: "GT KCD" } });
  await db.lesson.create({ data: { id: BAI, curriculumId: CUR, order: 1, title: "Bài 1", moduleCode: "M1" } });
  await db.class.create({ data: { id: LOP, name: LOP, courseId: KHOA, centerId: CS, status: "ACTIVE", startTime: "18:00", endTime: "19:30" } });
  await db.student.create({ data: { id: HV, name: "Bé Không Cần Bù", centerId: CS, parentName: "PH KCD", parentPhone: "0900000055" } });
  await db.enrollment.create({ data: { id: id("gd"), studentId: HV, classId: LOP, courseId: KHOA, status: "ACTIVE" } });
  await db.classSession.create({ data: { id: BUOI, classId: LOP, date: new Date("2026-10-05T11:00:00.000Z"), lessonId: BAI, status: "COMPLETED", centerId: CS } });
}

/** Một lần "lưu điểm danh" cho HV: ghi bản ghi Attendance rồi gọi đúng hàm đồng bộ, với makeupStatus tính bằng luật thật. */
const LY_DO = "Phụ huynh báo con đã học trước ở cơ sở khác";

async function luu(p: { lyDo?: string; guiLen?: "NONE" | "NEEDS_MAKEUP" | "MADE_UP"; khongCanBu?: boolean; status?: "ABSENT" | "EXCUSED" | "PRESENT"; statusCu?: string }) {
  const truoc = await db.attendance.findUnique({ where: { sessionId_studentId: { sessionId: BUOI, studentId: HV } } });
  const status = p.status ?? "ABSENT";
  const makeupStatus = makeupStatusSauKhiLuu({ status, cu: truoc?.makeupStatus, guiLen: p.guiLen, khongCanBu: p.khongCanBu, statusCu: p.statusCu });
  const att = await db.attendance.upsert({
    where: { sessionId_studentId: { sessionId: BUOI, studentId: HV } },
    create: { sessionId: BUOI, studentId: HV, status, makeupStatus, centerId: CS },
    update: { status, makeupStatus },
    select: { id: true },
  });
  const ghi: BanGhiDiemDanhDaLuu[] = [
    {
      studentId: HV,
      attendanceId: att.id,
      status,
      makeupStatus,
      makeupStatusTruoc: truoc?.makeupStatus,
      absenceReason: "Con ốm",
      // đúng như `markAttendance`: chỉ lần chọn MỚI mang lý do
      lyDoKhongCanBu: laChonKhongCanBuMoi({ status, cu: truoc?.makeupStatus, sau: makeupStatus }) ? (p.lyDo ?? LY_DO) : null,
    },
  ];
  const kq = await giaoDichDiemDanh((tx) => dongBoDongSauDiemDanh(tx, { sessionId: BUOI, createdById: QL, ghi }));
  return { kq, makeupStatus };
}
const dong = () => db.makeupNeed.findUnique({ where: { studentId_missedSessionId: { studentId: HV, missedSessionId: BUOI } } });
// Đếm theo ĐÚNG bản ghi điểm danh của fixture (thực thể của nhật ký này là Attendance) — đếm toàn bảng là hỏng cách ly: dòng nhật ký mồ côi của lượt chạy trước làm ca "không nhật ký" đỏ giả.
const nhatKyHang = async () => {
  const ids = (await db.attendance.findMany({ where: { studentId: HV }, select: { id: true } })).map((n) => n.id);
  return db.auditLog.findMany({ where: { module: "hoc-bu", action: "hoc-bu.khong-can-bu", entityId: { in: ids } } });
};
const nhatKy = async () => (await nhatKyHang()).length;

describe.skipIf(!RUN_DB_TESTS)("[KCD] 'Không cần bù' ở màn điểm danh — Postgres thật", () => {
  beforeEach(dung);
  afterAll(don);

  it("[KCD-00] ĐỐI CHỨNG DƯƠNG: vắng với 'cần bù' (mặc định) ⇒ CÓ dòng PENDING — nếu không, các ca 'không tạo dòng' xanh vì không gì tạo được", async () => {
    const r = await luu({ guiLen: "NEEDS_MAKEUP" });
    expect(r.makeupStatus).toBe("NEEDS_MAKEUP");
    expect(r.kq.tao).toBe(1);
    expect((await dong())?.status).toBe("PENDING");
  });

  it("[KCD-01] vắng + 'Không cần bù' từ đầu ⇒ attendance NONE, KHÔNG có dòng cần bù, nhưng CÓ nhật ký mang lý do (quyết định đáng truy dù chưa có dòng nào để thu hồi)", async () => {
    const r = await luu({ guiLen: "NONE", khongCanBu: true });
    expect(r.makeupStatus).toBe("NONE");
    expect(r.kq).toMatchObject({ tao: 0, khongCanBu: 0 });
    expect(await dong()).toBeNull();
    const [a] = await nhatKyHang();
    expect(await nhatKy()).toBe(1);
    expect(a).toMatchObject({ entityType: "Attendance", reason: LY_DO });
    expect(JSON.stringify(a!.newValues)).toContain('"dongThuHoi":null');
    expect((await db.attendance.findFirstOrThrow({ where: { sessionId: BUOI, studentId: HV } })).makeupStatus).toBe("NONE");
  });

  it("[KCD-02] đã có dòng PENDING rồi đổi sang 'Không cần bù' ⇒ dòng CANCELLED (không waived*), một dòng nhật ký `hoc-bu.khong-can-bu`; lưu lại lần nữa không ghi thêm", async () => {
    await luu({ guiLen: "NEEDS_MAKEUP" });
    const id0 = (await dong())!.id;
    const r = await luu({ guiLen: "NONE", khongCanBu: true });
    expect(r.kq.khongCanBu).toBe(1);
    const d = await dong();
    expect(d).toMatchObject({ id: id0, status: "CANCELLED", waivedAt: null, waivedById: null, waivedReason: null });
    expect(await nhatKy()).toBe(1);
    const [a] = await nhatKyHang();
    expect(a).toMatchObject({ entityType: "Attendance", reason: LY_DO });
    expect(JSON.stringify(a!.newValues)).toContain(`"dongThuHoi":"${id0}"`); // nhật ký nói dòng nào đã được thu hồi
    // chạy lại ⇒ không có gì để thu hồi nữa
    expect((await luu({ guiLen: "NONE", khongCanBu: true })).kq.khongCanBu).toBe(0);
    expect(await nhatKy()).toBe(1);
  });

  it("[KCD-03] ĐỔI Ý: 'Không cần bù' rồi chọn lại 'Cần học bù' ⇒ dòng HỒI SINH về PENDING (không phải dòng mới)", async () => {
    await luu({ guiLen: "NEEDS_MAKEUP" });
    const id0 = (await dong())!.id;
    await luu({ guiLen: "NONE", khongCanBu: true });
    expect((await dong())?.status).toBe("CANCELLED");
    const r = await luu({ guiLen: "NEEDS_MAKEUP" });
    expect(r.kq.hoiSinh).toBe(1);
    expect(await dong()).toMatchObject({ id: id0, status: "PENDING" });
    expect(await db.makeupNeed.count({ where: { studentId: HV } })).toBe(1);
  });

  it("[KCD-04] GIỮ LỰA CHỌN khi nơi khác lưu lại mà không nói gì (panel GV): vẫn NONE, KHÔNG hồi sinh dòng; đối chứng — thiếu `statusCu` thì lại thành 'cần bù'", async () => {
    await luu({ guiLen: "NEEDS_MAKEUP" });
    await luu({ guiLen: "NONE", khongCanBu: true });
    expect(await nhatKy()).toBe(1);
    // panel GV: không gửi makeupStatus, truyền trạng thái cũ
    const gv = await luu({ guiLen: undefined, statusCu: "ABSENT" });
    expect(gv.makeupStatus).toBe("NONE");
    expect(gv.kq).toMatchObject({ tao: 0, hoiSinh: 0 });
    // giữ lựa chọn KHÔNG phải quyết định mới ⇒ không ghi thêm nhật ký, không đòi lý do
    expect(await nhatKy()).toBe(1);
    expect((await dong())?.status).toBe("CANCELLED");
    // đối chứng: cùng thao tác nhưng KHÔNG biết trạng thái cũ ⇒ cần bù trở lại (hành vi cũ, có chủ đích cho các đường khác)
    const khongBiet = await luu({ guiLen: undefined });
    expect(khongBiet.makeupStatus).toBe("NEEDS_MAKEUP");
    expect((await dong())?.status).toBe("PENDING");
  });

  it("[KCD-05] dòng ĐÃ XẾP CASE (SCHEDULED) không bị đụng, và `docHocVienDaXepCaseO` gọi đúng tên bé để màn điểm danh từ chối; đối chứng — dòng PENDING thì không bị gọi tên", async () => {
    await luu({ guiLen: "NEEDS_MAKEUP" });
    expect(await docHocVienDaXepCaseO(BUOI, [HV])).toEqual([]);
    await db.makeupNeed.update({ where: { studentId_missedSessionId: { studentId: HV, missedSessionId: BUOI } }, data: { status: "SCHEDULED" } });
    expect(await docHocVienDaXepCaseO(BUOI, [HV])).toEqual(["Bé Không Cần Bù"]);
    expect(await docHocVienDaXepCaseO(BUOI, [])).toEqual([]);
    const r = await luu({ guiLen: "NONE", khongCanBu: true });
    expect(r.kq.khongCanBu).toBe(0);
    expect((await dong())?.status).toBe("SCHEDULED");
    // (Chặn bé đã xếp case là việc của `markAttendance` — gọi `docHocVienDaXepCaseO` rồi từ chối TRƯỚC khi ghi; tầng đồng bộ này chỉ bảo đảm không đụng dòng.)
  });

  it("[KCD-06] đơn xin học bù của phụ huynh gắn dòng bị đóng ⇒ REJECTED với câu nói đúng ('không cần học bù'), cùng giao dịch", async () => {
    await luu({ guiLen: "NEEDS_MAKEUP" });
    const need = (await dong())!;
    const ph = await db.user.create({ data: { id: id("ph"), name: "PH KCD", email: `${id("ph")}@test.local`, role: "PARENT", roles: ["PARENT"] } });
    await db.parentRequest.create({
      data: { studentId: HV, parentUserId: ph.id, type: "MAKEUP", content: "Xin học bù buổi vắng", status: "PENDING", sessionId: BUOI, makeupNeedId: need.id },
    });
    await luu({ guiLen: "NONE", khongCanBu: true });
    const don1 = await db.parentRequest.findFirstOrThrow({ where: { studentId: HV } });
    expect(don1.status).toBe("REJECTED");
    expect(don1.response).toContain("không cần học bù");
  });

  it("[KCD-07] CÓ MẶT vẫn thu hồi dòng PENDING như cũ (không đổi hành vi của nhánh có mặt)", async () => {
    await luu({ guiLen: "NEEDS_MAKEUP" });
    const r = await luu({ status: "PRESENT" });
    expect(r.makeupStatus).toBe("NONE");
    expect(r.kq.thuHoi).toBe(1);
    expect(r.kq.khongCanBu).toBe(0);
    expect((await dong())?.status).toBe("CANCELLED");
  });
});
