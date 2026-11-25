// tests/hoc-bu/rut-don-nghi.test.ts — [RDN-*] PHỤ HUYNH RÚT ĐƠN XIN NGHỈ ĐÃ ĐƯỢC TIẾP NHẬN (chủ dự án 13/11/2026), Postgres THẬT.
//
// Chạy:  pnpm test:hoc-bu-db
//
// Luật: đơn xin nghỉ được Sale/QLCS tiếp nhận ⇒ buổi đó có bản ghi VẮNG CÓ PHÉP (lý do = lời phụ huynh) + dòng cần bù chờ xếp. Phụ huynh rút đơn ⇒ đơn CANCELLED, bản ghi điểm danh bị gỡ,
// dòng cần bù được thu hồi. Rút KHÔNG được làm gì khi buổi đã diễn ra, thầy cô đã sửa điểm danh, hay trung tâm đã xếp/xử lý dòng bù — và khi từ chối thì KHÔNG đổi một byte nào.
// Mỗi ca tự dựng lại từ đầu (chạy MỘT MÌNH vẫn xanh — luật 18). Dựng đúng bằng đường THẬT: `dongBoDongSauDiemDanh` (cùng hàm `resolveAbsence` gọi) — không gõ tay dòng cần bù.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { dongBoDongSauDiemDanh, giaoDichDiemDanh } from "@/lib/hoc-bu/dong-diem-danh";
import { lyDoDiemDanhTuDon, rutDonXinNghiDaTiepNhan } from "@/lib/hoc-bu/rut-don-nghi";

if (!RUN_DB_TESTS) console.warn(`[RDN] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-rdn-";
const id = (s: string) => `${T}${s}`;
const CS = id("cs");
const KHOA = id("khoa");
const CUR = id("cur");
const BAI = id("bai");
const QL = id("ql");
const PH = id("ph");
const LOP = id("lop");
const HV = id("hv");
const HV2 = id("hv2");
const BUOI = id("buoi");
const DON = id("don");
const NOI_DUNG = "Lý do: Con ốm. Ghi chú: Xin cho con nghỉ buổi này, cảm ơn thầy cô.";

const NGAY_TUONG_LAI = new Date(Date.now() + 3 * 86_400_000);
const NGAY_DA_QUA = new Date(Date.now() - 3 * 86_400_000);

// Nhật ký rút đơn có entityId = id bản ghi điểm danh (cuid, KHÔNG mang tiền tố fixture) và bản ghi đó bị gỡ ngay trong ca ⇒ lọc/dọn theo `requestId` trong newValues.
const theoDon = { module: "hoc-bu", action: "hoc-bu.ph-rut-don-nghi", newValues: { path: ["requestId"], equals: DON } } as const;

async function don() {
  await db.auditLog.deleteMany({ where: theoDon });
  await db.auditLog.deleteMany({ where: { module: "hoc-bu", entityId: { startsWith: T } } });
  const need = await db.makeupNeed.findMany({ where: { studentId: { in: [HV, HV2] } }, select: { id: true } });
  await db.auditLog.deleteMany({ where: { entityId: { in: need.map((n) => n.id) } } });
  await db.parentRequest.deleteMany({ where: { studentId: { in: [HV, HV2] } } });
  await db.makeupNeed.deleteMany({ where: { studentId: { in: [HV, HV2] } } });
  await db.attendance.deleteMany({ where: { studentId: { in: [HV, HV2] } } });
  await db.classSession.deleteMany({ where: { classId: LOP } });
  await db.enrollment.deleteMany({ where: { studentId: { in: [HV, HV2] } } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.lesson.deleteMany({ where: { id: BAI } });
  await db.curriculum.deleteMany({ where: { id: CUR } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: { in: [HV, HV2] } } });
  await db.user.deleteMany({ where: { id: { in: [QL, PH] } } });
  await db.center.deleteMany({ where: { id: CS } });
}

/** Dựng tới trạng thái SAU KHI Sale/QLCS đã tiếp nhận đơn: đơn APPROVED + điểm danh EXCUSED (lý do = lời phụ huynh) + dòng cần bù PENDING — đúng như `resolveAbsence`. */
async function dung(p: { ngayBuoi?: Date } = {}) {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở RDN", slug: `${T}cs`, address: "114 Hoàng Diệu" } });
  await db.user.create({ data: { id: QL, name: "QLCS RDN", email: `${QL}@test.local`, role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], centerId: CS } });
  await db.user.create({ data: { id: PH, name: "Phụ huynh RDN", email: `${PH}@test.local`, role: "PARENT", roles: ["PARENT"] } });
  await db.course.create({ data: { id: KHOA, name: "Khoá RDN", slug: `${T}khoa`, totalSessions: 12, price: 12_000_000 } });
  await db.curriculum.create({ data: { id: CUR, courseId: KHOA, name: "GT RDN" } });
  await db.lesson.create({ data: { id: BAI, curriculumId: CUR, order: 1, title: "Bài 1", moduleCode: "M1" } });
  await db.class.create({ data: { id: LOP, name: LOP, courseId: KHOA, centerId: CS, status: "ACTIVE", startTime: "18:00", endTime: "19:30" } });
  for (const [hv, ten] of [[HV, "Bé Rút Đơn"], [HV2, "Bé Khác"]] as const) {
    await db.student.create({ data: { id: hv, name: ten, centerId: CS, parentName: "PH RDN", parentPhone: hv === HV ? "0900000071" : "0900000072" } });
    await db.enrollment.create({ data: { id: id(`gd-${hv}`), studentId: hv, classId: LOP, courseId: KHOA, status: "ACTIVE" } });
  }
  await db.classSession.create({ data: { id: BUOI, classId: LOP, date: p.ngayBuoi ?? NGAY_TUONG_LAI, lessonId: BAI, status: "SCHEDULED", centerId: CS } });
  await db.parentRequest.create({ data: { id: DON, studentId: HV, parentUserId: PH, type: "ABSENCE", content: NOI_DUNG, sessionId: BUOI, status: "APPROVED", handledByName: "QLCS RDN", handledAt: new Date() } });
  const att = await db.attendance.create({
    data: { sessionId: BUOI, studentId: HV, status: "EXCUSED", makeupStatus: "NEEDS_MAKEUP", absenceReason: lyDoDiemDanhTuDon(NOI_DUNG), centerId: CS },
    select: { id: true },
  });
  await giaoDichDiemDanh((tx) =>
    dongBoDongSauDiemDanh(tx, {
      sessionId: BUOI,
      createdById: QL,
      soCai: null,
      ghi: [{ studentId: HV, attendanceId: att.id, status: "EXCUSED", makeupStatus: "NEEDS_MAKEUP", makeupStatusTruoc: undefined, absenceReason: lyDoDiemDanhTuDon(NOI_DUNG) }],
    }),
  );
}

const donNay = () => db.parentRequest.findUniqueOrThrow({ where: { id: DON } });
const diemDanh = () => db.attendance.findUnique({ where: { sessionId_studentId: { sessionId: BUOI, studentId: HV } } });
const dongBu = () => db.makeupNeed.findUnique({ where: { studentId_missedSessionId: { studentId: HV, missedSessionId: BUOI } } });
const nhatKy = async () => db.auditLog.findMany({ where: theoDon });

/** Khẳng định rút bị TỪ CHỐI và KHÔNG đổi gì: đơn vẫn APPROVED, điểm danh còn, dòng bù còn nguyên trạng thái. */
async function khongDoiGi(kq: Awaited<ReturnType<typeof rutDonXinNghiDaTiepNhan>>, trangThaiBu: string = "PENDING") {
  expect(kq.ok).toBe(false);
  expect((await donNay()).status).toBe("APPROVED");
  expect(await diemDanh()).not.toBeNull();
  expect((await dongBu())?.status).toBe(trangThaiBu);
  expect(await nhatKy()).toHaveLength(0);
}

describe.skipIf(!RUN_DB_TESTS)("[RDN] phụ huynh rút đơn xin nghỉ đã tiếp nhận — Postgres thật", () => {
  beforeEach(() => dung());
  afterAll(don);

  it("[RDN-00] ĐỐI CHỨNG DƯƠNG: fixture đúng như sau khi tiếp nhận — đơn APPROVED, điểm danh EXCUSED mang lời phụ huynh, dòng cần bù PENDING (nếu không, các ca 'không đổi gì' xanh vì chẳng có gì để đổi)", async () => {
    expect((await donNay()).status).toBe("APPROVED");
    expect(await diemDanh()).toMatchObject({ status: "EXCUSED", absenceReason: lyDoDiemDanhTuDon(NOI_DUNG) });
    expect(await dongBu()).toMatchObject({ status: "PENDING", sourceType: "ABSENCE" });
  });

  it("[RDN-01] rút khi buổi còn ở tương lai ⇒ đơn CANCELLED, điểm danh vắng có phép BỊ GỠ, dòng cần bù CANCELLED, một dòng nhật ký", async () => {
    const kq = await rutDonXinNghiDaTiepNhan({ requestId: DON, studentId: HV });
    expect(kq).toEqual({ ok: true, goDiemDanh: true });
    expect(await donNay()).toMatchObject({ status: "CANCELLED", response: "Phụ huynh đã rút đơn xin nghỉ." });
    expect(await diemDanh()).toBeNull();
    expect(await dongBu()).toMatchObject({ status: "CANCELLED", waivedAt: null });
    expect(await nhatKy()).toHaveLength(1);
  });

  it("[RDN-02] đơn XIN HỌC BÙ đang chờ của chính dòng đó cũng được đóng (REJECTED, nói rõ vì phụ huynh đã rút đơn nghỉ) — không để chiếm trần đơn mở", async () => {
    const need = (await dongBu())!;
    await db.parentRequest.create({ data: { id: id("bu"), studentId: HV, parentUserId: PH, type: "MAKEUP", content: "Xin học bù", sessionId: BUOI, makeupNeedId: need.id, status: "PENDING" } });
    expect((await rutDonXinNghiDaTiepNhan({ requestId: DON, studentId: HV })).ok).toBe(true);
    expect(await db.parentRequest.findUniqueOrThrow({ where: { id: id("bu") } })).toMatchObject({ status: "REJECTED", response: expect.stringContaining("rút đơn xin nghỉ") });
  });

  it("[RDN-03] ĐÃ ĐẾN GIỜ / ĐÃ QUA buổi ⇒ từ chối, không đổi gì", async () => {
    await dung({ ngayBuoi: NGAY_DA_QUA });
    const kq = await rutDonXinNghiDaTiepNhan({ requestId: DON, studentId: HV });
    await khongDoiGi(kq);
    expect(!kq.ok && kq.error).toMatch(/đã đến giờ hoặc đã diễn ra/);
  });

  it("[RDN-04] thầy cô ĐÃ SỬA điểm danh (đổi trạng thái hoặc lý do) ⇒ từ chối — không đè lên việc của giáo viên", async () => {
    await db.attendance.updateMany({ where: { sessionId: BUOI, studentId: HV }, data: { status: "ABSENT" } });
    await khongDoiGi(await rutDonXinNghiDaTiepNhan({ requestId: DON, studentId: HV }));
    await db.attendance.updateMany({ where: { sessionId: BUOI, studentId: HV }, data: { status: "EXCUSED", absenceReason: "Thầy cô ghi lại lý do khác" } });
    const kq = await rutDonXinNghiDaTiepNhan({ requestId: DON, studentId: HV });
    await khongDoiGi(kq);
    expect(!kq.ok && kq.error).toMatch(/thầy cô cập nhật điểm danh/);
  });

  it("[RDN-05] dòng cần bù ĐÃ XẾP (SCHEDULED) hoặc quản lý đã miễn/huỷ tay (waivedAt) ⇒ từ chối, không đổi gì", async () => {
    await db.makeupNeed.updateMany({ where: { studentId: HV, missedSessionId: BUOI }, data: { status: "SCHEDULED" } });
    const kq = await rutDonXinNghiDaTiepNhan({ requestId: DON, studentId: HV });
    await khongDoiGi(kq, "SCHEDULED");
    expect(!kq.ok && kq.error).toMatch(/đã xếp hoặc đang xử lý/);
    await db.makeupNeed.updateMany({ where: { studentId: HV, missedSessionId: BUOI }, data: { status: "PENDING", waivedAt: new Date(), waivedReason: "Quản lý đã chốt miễn bù" } });
    await khongDoiGi(await rutDonXinNghiDaTiepNhan({ requestId: DON, studentId: HV }));
  });

  it("[RDN-06] đơn của học viên KHÁC (sai studentId) ⇒ không tìm thấy, không đổi gì; đơn CHƯA tiếp nhận (PENDING) không đi đường này", async () => {
    const khac = await rutDonXinNghiDaTiepNhan({ requestId: DON, studentId: HV2 });
    await khongDoiGi(khac);
    expect(!khac.ok && khac.error).toBe("Không tìm thấy yêu cầu");
    await db.parentRequest.update({ where: { id: DON }, data: { status: "PENDING" } });
    const cho = await rutDonXinNghiDaTiepNhan({ requestId: DON, studentId: HV });
    expect(cho.ok).toBe(false);
    expect((await donNay()).status).toBe("PENDING");
    expect(await diemDanh()).not.toBeNull();
  });

  it("[RDN-07] rút HAI lần ⇒ lần hai bị từ chối, không ghi thêm nhật ký (đơn đã CANCELLED)", async () => {
    expect((await rutDonXinNghiDaTiepNhan({ requestId: DON, studentId: HV })).ok).toBe(true);
    expect((await rutDonXinNghiDaTiepNhan({ requestId: DON, studentId: HV })).ok).toBe(false);
    expect(await nhatKy()).toHaveLength(1);
  });

  it("[RDN-08] chỉ gỡ ĐÚNG học viên của đơn: điểm danh của bạn cùng lớp ở buổi đó giữ nguyên", async () => {
    await db.attendance.create({ data: { sessionId: BUOI, studentId: HV2, status: "EXCUSED", makeupStatus: "NEEDS_MAKEUP", absenceReason: "Việc khác", centerId: CS } });
    expect((await rutDonXinNghiDaTiepNhan({ requestId: DON, studentId: HV })).ok).toBe(true);
    expect(await db.attendance.findUnique({ where: { sessionId_studentId: { sessionId: BUOI, studentId: HV2 } } })).not.toBeNull();
  });
});
