// tests/hoc-bu/dong-hoc-bu.test.ts — T05: dòng cần bù (MakeupNeed = MakeupLine) trên Postgres THẬT.
//
// Chạy:  pnpm test:hoc-bu-db      (`pnpm test:unit` trần sẽ SKIP — thiếu ALLOW_DB_RESET)
//
// Mỗi ca là MỘT lỗ T05 bịt (số đo ở bản khảo sát 07/10/2026):
//   · tạo dòng KHÔNG nguyên tử với điểm danh (dòng tạo SAU commit, lỗi bị nuốt ⇒ điểm danh "cần bù" mà không có dòng — TV-08)
//   · tạo dòng không idempotent dưới đua (hai lượt cùng tạo ⇒ P2002 hoặc giao dịch hỏng 25P02)
//   · chuyển trạng thái không có điều kiện trạng thái cũ (4 trong 10 chỗ)
//   · hồi sinh đè dòng quản lý huỷ tay
//   · huỷ lớp cascade huỷ dòng (đảo theo quyết định 10)
//   · dòng không biết mình từ đâu tới (nguồn), từ điểm danh nào, và khoá nào
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { LoiDong, chuyenTrangThaiDong, taoDongHocBu, thuHoiDongKhiCoMat } from "@/lib/hoc-bu/dong-service";
import { dongBoDongSauDiemDanh, giaoDichDiemDanh, type BanGhiDiemDanhDaLuu } from "@/lib/hoc-bu/dong-diem-danh";
import { danhGiaHocBuKhiHuyLop } from "@/lib/hoc-bu/huy-lop";

if (!RUN_DB_TESTS) console.warn(`[DHB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-t05-";
const id = (s: string) => `${T}${s}`;
const CS = id("cs");
const KHOA = id("khoa");
const KHOA2 = id("khoa2");
const LOP = id("lop");
const LOP2 = id("lop2");
const LOP_KHAC = id("lop-khac");
const GV = id("gv");
const HV = [id("hv0"), id("hv1"), id("hv2")] as const;
const BUOI = [id("b0"), id("b1")] as const;
const BAI = id("bai");
const CUR = id("cur");

async function don() {
  const needs = await db.makeupNeed.findMany({ where: { studentId: { in: [...HV] } }, select: { id: true } });
  await db.domainEvent.deleteMany({ where: { dedupeKey: { in: needs.map((n) => `makeup.requested:${n.id}`) } } });
  await db.makeupNeed.deleteMany({ where: { studentId: { in: [...HV] } } });
  await db.attendance.deleteMany({ where: { studentId: { in: [...HV] } } });
  await db.classSession.deleteMany({ where: { classId: { in: [LOP, LOP2, LOP_KHAC] } } });
  await db.enrollment.deleteMany({ where: { studentId: { in: [...HV] } } });
  await db.class.deleteMany({ where: { id: { in: [LOP, LOP2, LOP_KHAC] } } });
  await db.lesson.deleteMany({ where: { id: BAI } });
  await db.curriculum.deleteMany({ where: { id: CUR } });
  await db.course.deleteMany({ where: { id: { in: [KHOA, KHOA2] } } });
  await db.student.deleteMany({ where: { id: { in: [...HV] } } });
  await db.user.deleteMany({ where: { id: GV } });
  await db.center.deleteMany({ where: { id: CS } });
}

/** Lớp LOP (khoá KHOA) có hai buổi đã qua; HV[0..2] ghi danh ACTIVE; LOP_KHAC cùng khoá KHOA để thử "còn học khoá đó ở lớp khác". */
async function dung() {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở T05", slug: `${T}cs`, address: "114 Hoàng Diệu" } });
  await db.user.create({ data: { id: GV, name: "GV T05", email: `${GV}@test.local`, role: "TEACHER", roles: ["TEACHER"], centerId: CS } });
  await db.course.create({ data: { id: KHOA, name: "Khoá T05", slug: `${T}khoa`, totalSessions: 12, price: 12_000_000 } });
  await db.course.create({ data: { id: KHOA2, name: "Khoá T05 B", slug: `${T}khoa2`, totalSessions: 12, price: 12_000_000 } });
  await db.curriculum.create({ data: { id: CUR, courseId: KHOA, name: "GT T05" } });
  await db.lesson.create({ data: { id: BAI, curriculumId: CUR, order: 1, title: "Bài 1" } });
  const lop = (lid: string, khoa: string) => ({ id: lid, name: lid, courseId: khoa, centerId: CS, status: "ACTIVE" as const, startTime: "18:00", endTime: "19:30" });
  await db.class.create({ data: lop(LOP, KHOA) });
  await db.class.create({ data: lop(LOP2, KHOA2) });
  await db.class.create({ data: lop(LOP_KHAC, KHOA) });
  for (const [i, hv] of HV.entries()) {
    await db.student.create({ data: { id: hv, name: `Bé T05 ${i}`, centerId: CS } });
    await db.enrollment.create({ data: { id: id(`gd${i}`), studentId: hv, classId: LOP, courseId: KHOA, status: "ACTIVE" } });
  }
  await db.classSession.create({ data: { id: BUOI[0], classId: LOP, date: new Date("2026-09-10T11:00:00.000Z"), lessonId: BAI, status: "COMPLETED", centerId: CS } });
  await db.classSession.create({ data: { id: BUOI[1], classId: LOP, date: new Date("2026-09-17T11:00:00.000Z"), lessonId: BAI, status: "COMPLETED", centerId: CS } });
}

const dong = (hv: string, buoi: string) => db.makeupNeed.findUnique({ where: { studentId_missedSessionId: { studentId: hv, missedSessionId: buoi } } });
const demDong = (hv: string) => db.makeupNeed.count({ where: { studentId: hv } });
const taoAtt = (hv: string, buoi: string, status: "ABSENT_EXCUSED" | "PRESENT" = "ABSENT_EXCUSED", makeupStatus: "NEEDS_MAKEUP" | "NONE" | "MADE_UP" = "NEEDS_MAKEUP") =>
  db.attendance.create({ data: { sessionId: buoi, studentId: hv, status, makeupStatus, centerId: CS }, select: { id: true } });
const lyDo = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof LoiDong ? e.ma : `LOI-KHAC: ${String(e)}`;
  }
};
const tao = (p: Partial<Parameters<typeof taoDongHocBu>[1]> = {}) =>
  db.$transaction((tx) => taoDongHocBu(tx, { studentId: HV[0], missedSessionId: BUOI[0], nguon: "ABSENCE", ...p }));

describe.skipIf(!RUN_DB_TESTS)("[DHB] dòng cần bù — T05", () => {
  beforeEach(dung);
  afterAll(don);

  // ── tạo ────────────────────────────────────────────────────────────────────────────────
  it("[DHB-01] tạo dòng: mang NGUỒN, điểm danh gốc, khoá của lớp, trạng thái PENDING; báo PH một sự kiện (nguồn ABSENCE)", async () => {
    const att = await taoAtt(HV[0], BUOI[0]);
    const r = await tao({ originalAttendanceId: att.id, createdById: GV, note: "Con ốm" });
    expect(r).toMatchObject({ ket: "TAO", status: "PENDING" });
    const d = (await dong(HV[0], BUOI[0]))!;
    expect(d).toMatchObject({
      sourceType: "ABSENCE",
      originalAttendanceId: att.id,
      courseId: KHOA,
      classId: LOP,
      centerId: CS,
      missedLessonId: BAI,
      createdById: GV,
      note: "Con ốm",
      status: "PENDING",
    });
    expect(await db.domainEvent.count({ where: { dedupeKey: `makeup.requested:${d.id}` } })).toBe(1);
  });

  it("[DHB-02] nguồn khác ABSENCE KHÔNG phát 'đã ghi nhận yêu cầu học bù' (quyết định 9: không báo mọi buổi vắng); ORDER_CONVERSION không cần điểm danh gốc", async () => {
    const r = await tao({ nguon: "ORDER_CONVERSION" });
    expect(r.ket).toBe("TAO");
    const d = (await dong(HV[0], BUOI[0]))!;
    expect(d).toMatchObject({ sourceType: "ORDER_CONVERSION", originalAttendanceId: null });
    expect(await db.domainEvent.count({ where: { dedupeKey: `makeup.requested:${d.id}` } })).toBe(0);
  });

  it("[DHB-03] IDEMPOTENT: tạo lần hai ⇒ DA_CO, MỘT dòng, nguồn GỐC không bị đè; ghi chú mới được cập nhật; điểm danh gốc được liên kết thêm nếu trước đó chưa có", async () => {
    await tao({ nguon: "MANUAL", note: "tay" });
    const att = await taoAtt(HV[0], BUOI[0]);
    const r2 = await tao({ nguon: "ABSENCE", originalAttendanceId: att.id, note: "Con ốm" });
    expect(r2.ket).toBe("DA_CO");
    expect(await demDong(HV[0])).toBe(1);
    const d = (await dong(HV[0], BUOI[0]))!;
    expect(d.sourceType).toBe("MANUAL"); // nguồn không suy lại — dòng ĐÃ có thì giữ chuyện cũ
    expect(d.note).toBe("Con ốm");
    expect(d.originalAttendanceId).toBe(att.id);
  });

  it("[DHB-04] ĐUA: 3 lượt tạo CÙNG (học viên, buổi) song song ⇒ đúng MỘT 'TAO', hai 'DA_CO', không lượt nào ném (không P2002, không 25P02), một dòng", async () => {
    // 3 chứ không 6: lượt thua BỊ CHẶN bên trong `INSERT … ON CONFLICT` cho tới khi lượt thắng commit, mỗi lượt giữ một kết nối của hồ
    // (và phần mở rộng ghi kép `orgUnitId` cần thêm kết nối NGOÀI giao dịch) — 6 lượt làm cạn hồ và lượt thắng hết hạn 5 giây (đo
    // 07/10: lỗi là "Transaction already closed", không phải lỗi logic). Cùng bài học với DDB-07 của T02.
    const chay = () => db.$transaction((tx) => taoDongHocBu(tx, { studentId: HV[0], missedSessionId: BUOI[0], nguon: "ABSENCE" }), { timeout: 30_000, maxWait: 15_000 });
    const kq = await Promise.allSettled([chay(), chay(), chay()]);
    expect(kq.filter((k) => k.status === "rejected").map((k) => String((k as PromiseRejectedResult).reason))).toEqual([]);
    const ket = kq.map((k) => (k as PromiseFulfilledResult<{ ket: string }>).value.ket).sort();
    expect(ket).toEqual(["DA_CO", "DA_CO", "TAO"]);
    expect(await demDong(HV[0])).toBe(1);
  }, 60_000);

  it("[DHB-05] buổi không tồn tại ⇒ LoiDong BUOI_KHONG_TON_TAI, không dòng nào", async () => {
    expect(await lyDo(tao({ missedSessionId: id("khong-co") }))).toBe("BUOI_KHONG_TON_TAI");
    expect(await demDong(HV[0])).toBe(0);
  });

  // ── hồi sinh ───────────────────────────────────────────────────────────────────────────
  it("[DHB-06] HỒI SINH: dòng CANCELLED (không waivedAt) + hoiSinh ⇒ PENDING và xoá buổi bù/ngày xong; KHÔNG bật hoiSinh ⇒ vẫn CANCELLED", async () => {
    await tao();
    const d0 = (await dong(HV[0], BUOI[0]))!;
    await db.makeupNeed.update({ where: { id: d0.id }, data: { status: "CANCELLED", makeupSessionId: BUOI[1], completedAt: new Date("2026-09-30T00:00:00Z") } });
    expect((await tao({ hoiSinh: false })).ket).toBe("DA_CO");
    expect((await dong(HV[0], BUOI[0]))!.status).toBe("CANCELLED");
    const r = await tao({ hoiSinh: true, now: new Date("2026-10-07T03:00:00Z") });
    expect(r).toMatchObject({ ket: "HOI_SINH", status: "PENDING" });
    const sau = (await dong(HV[0], BUOI[0]))!;
    expect(sau).toMatchObject({ status: "PENDING", makeupSessionId: null, completedAt: null });
    // Lần hồi sinh là SỰ KIỆN MỚI (khoá theo ngày) — không bị outbox nuốt vì trùng khoá cũ.
    expect(await db.domainEvent.count({ where: { dedupeKey: `makeup.requested:${d0.id}:revived-2026-10-07` } })).toBe(1);
  });

  it("[DHB-07] KHÔNG BAO GIỜ hồi sinh dòng quản lý HUỶ TAY (waivedAt) — dù hoiSinh = true", async () => {
    await tao();
    const d0 = (await dong(HV[0], BUOI[0]))!;
    await db.makeupNeed.update({ where: { id: d0.id }, data: { status: "CANCELLED", waivedAt: new Date("2026-10-01T00:00:00Z"), waivedReason: "PH xin thôi" } });
    expect((await tao({ hoiSinh: true })).ket).toBe("DA_CO");
    expect((await dong(HV[0], BUOI[0]))!).toMatchObject({ status: "CANCELLED", waivedReason: "PH xin thôi" });
  });

  it("[DHB-08] dòng SCHEDULED / COMPLETED giữ nguyên khi tạo lại (đã hẹn buổi bù thì không đặt lại sau lưng người xếp lịch)", async () => {
    for (const st of ["SCHEDULED", "COMPLETED"] as const) {
      await db.makeupNeed.deleteMany({ where: { studentId: HV[1] } });
      await tao({ studentId: HV[1] });
      await db.makeupNeed.updateMany({ where: { studentId: HV[1] }, data: { status: st } });
      expect((await tao({ studentId: HV[1], hoiSinh: true })).ket, st).toBe("DA_CO");
      expect((await dong(HV[1], BUOI[0]))!.status).toBe(st);
    }
  });

  // ── chuyển trạng thái ──────────────────────────────────────────────────────────────────
  it("[DHB-09] `chuyenTrangThaiDong`: ghi CÓ ĐIỀU KIỆN — sai trạng thái cũ ⇒ DONG_DA_DOI và KHÔNG ghi; cạnh ngoài bảng ⇒ CANH_KHONG_HOP_LE", async () => {
    await tao();
    const d = (await dong(HV[0], BUOI[0]))!;
    // Dòng đang PENDING mà người gọi tưởng SCHEDULED:
    expect(await lyDo(db.$transaction((tx) => chuyenTrangThaiDong(tx, { ids: [d.id], tu: "SCHEDULED", sang: "COMPLETED", lyDo: "BE_CO_MAT_HOAN_THANH" })))).toBe("DONG_DA_DOI");
    expect((await dong(HV[0], BUOI[0]))!.status).toBe("PENDING");
    // PENDING → COMPLETED không có cạnh nào:
    expect(await lyDo(db.$transaction((tx) => chuyenTrangThaiDong(tx, { ids: [d.id], tu: "PENDING", sang: "COMPLETED", lyDo: "BE_CO_MAT_HOAN_THANH" })))).toBe("CANH_KHONG_HOP_LE");
    // Lý do của cạnh khác:
    expect(await lyDo(db.$transaction((tx) => chuyenTrangThaiDong(tx, { ids: [d.id], tu: "PENDING", sang: "CANCELLED", lyDo: "KHOI_PHUC" })))).toBe("CANH_KHONG_HOP_LE");
    expect((await dong(HV[0], BUOI[0]))!.status).toBe("PENDING");
  });

  it("[DHB-10] lô nhiều dòng: một dòng lệch ⇒ ném và CẢ LÔ rollback (không để lại nửa chừng); `chiNeuCo` thì trả số dòng đổi được, không ném", async () => {
    await tao({ studentId: HV[0] });
    await tao({ studentId: HV[1] });
    const a = (await dong(HV[0], BUOI[0]))!;
    const b = (await dong(HV[1], BUOI[0]))!;
    await db.makeupNeed.update({ where: { id: b.id }, data: { status: "SCHEDULED" } }); // b đã bị người khác xếp
    expect(await lyDo(db.$transaction((tx) => chuyenTrangThaiDong(tx, { ids: [a.id, b.id], tu: "PENDING", sang: "SCHEDULED", lyDo: "XEP_CASE" })))).toBe("DONG_DA_DOI");
    expect((await dong(HV[0], BUOI[0]))!.status).toBe("PENDING"); // a KHÔNG bị kéo theo
    const n = await db.$transaction((tx) => chuyenTrangThaiDong(tx, { ids: [a.id, b.id], tu: "PENDING", sang: "SCHEDULED", lyDo: "XEP_CASE", chiNeuCo: true }));
    expect(n).toBe(1);
    expect((await dong(HV[0], BUOI[0]))!.status).toBe("SCHEDULED");
  });

  it("[DHB-11] `ngoai` + `them`: điều kiện thêm chặn dòng đã huỷ tay; cột đi kèm được ghi cùng phép chuyển", async () => {
    await tao();
    const d = (await dong(HV[0], BUOI[0]))!;
    await db.makeupNeed.update({ where: { id: d.id }, data: { waivedAt: new Date("2026-10-01T00:00:00Z") } });
    expect(
      await lyDo(db.$transaction((tx) => chuyenTrangThaiDong(tx, { ids: [d.id], tu: "PENDING", sang: "SCHEDULED", lyDo: "XEP_CASE", ngoai: { waivedAt: null } }))),
    ).toBe("DONG_DA_DOI");
    await db.makeupNeed.update({ where: { id: d.id }, data: { waivedAt: null } });
    const luc = new Date("2026-10-07T03:00:00Z");
    await db.$transaction(async (tx) => {
      await chuyenTrangThaiDong(tx, { ids: [d.id], tu: "PENDING", sang: "SCHEDULED", lyDo: "XEP_CASE" });
      await chuyenTrangThaiDong(tx, { ids: [d.id], tu: "SCHEDULED", sang: "COMPLETED", lyDo: "BE_CO_MAT_HOAN_THANH", them: { completedAt: luc, usedQuota: true } });
    });
    expect(await dong(HV[0], BUOI[0])).toMatchObject({ status: "COMPLETED", usedQuota: true });
  });

  // ── điểm danh → dòng, NGUYÊN TỬ ────────────────────────────────────────────────────────
  const ghi = (hv: string, attendanceId: string, o: Partial<BanGhiDiemDanhDaLuu> = {}): BanGhiDiemDanhDaLuu => ({
    studentId: hv,
    attendanceId,
    status: "ABSENT_EXCUSED",
    makeupStatus: "NEEDS_MAKEUP",
    makeupStatusTruoc: undefined,
    absenceReason: null,
    ...o,
  });

  it("[DHB-12] điểm danh vắng ⇒ dòng ABSENCE mang điểm danh gốc; có mặt ⇒ thu hồi dòng PENDING; MADE_UP/SCHEDULED/COMPLETED/đã huỷ tay KHÔNG bị đụng", async () => {
    const a0 = await taoAtt(HV[0], BUOI[0]);
    const a1 = await taoAtt(HV[1], BUOI[0]);
    const a2 = await taoAtt(HV[2], BUOI[0]);
    await giaoDichDiemDanh((tx) =>
      dongBoDongSauDiemDanh(tx, { sessionId: BUOI[0], createdById: GV, ghi: [ghi(HV[0], a0.id, { absenceReason: "ốm" }), ghi(HV[1], a1.id), ghi(HV[2], a2.id)] }),
    );
    expect(await dong(HV[0], BUOI[0])).toMatchObject({ sourceType: "ABSENCE", originalAttendanceId: a0.id, note: "ốm", status: "PENDING" });
    // HV[1]: dòng đã SCHEDULED; HV[2]: dòng đã huỷ tay.
    await db.makeupNeed.updateMany({ where: { studentId: HV[1] }, data: { status: "SCHEDULED" } });
    await db.makeupNeed.updateMany({ where: { studentId: HV[2] }, data: { status: "CANCELLED", waivedAt: new Date("2026-10-01T00:00:00Z") } });
    // Cả ba quay lại CÓ MẶT:
    const kq = await giaoDichDiemDanh((tx) =>
      dongBoDongSauDiemDanh(tx, {
        sessionId: BUOI[0],
        createdById: GV,
        ghi: HV.map((h, i) => ghi(h, [a0, a1, a2][i]!.id, { status: "PRESENT", makeupStatus: "NONE", makeupStatusTruoc: "NEEDS_MAKEUP" })),
      }),
    );
    expect(kq.thuHoi).toBe(1); // chỉ HV[0] (PENDING)
    expect((await dong(HV[0], BUOI[0]))!.status).toBe("CANCELLED");
    expect((await dong(HV[1], BUOI[0]))!.status).toBe("SCHEDULED");
    expect((await dong(HV[2], BUOI[0]))!).toMatchObject({ status: "CANCELLED" });
  });

  it("[DHB-13] vắng LẠI sau khi tự huỷ vì có mặt ⇒ hồi sinh (chuyển trạng thái thật); lưu lại buổi ĐÃ NEEDS_MAKEUP thì KHÔNG dựng dậy dòng vừa huỷ tay", async () => {
    const a = await taoAtt(HV[0], BUOI[0]);
    await giaoDichDiemDanh((tx) => dongBoDongSauDiemDanh(tx, { sessionId: BUOI[0], createdById: GV, ghi: [ghi(HV[0], a.id)] }));
    await giaoDichDiemDanh((tx) => dongBoDongSauDiemDanh(tx, { sessionId: BUOI[0], createdById: GV, ghi: [ghi(HV[0], a.id, { status: "PRESENT", makeupStatus: "NONE", makeupStatusTruoc: "NEEDS_MAKEUP" })] }));
    expect((await dong(HV[0], BUOI[0]))!.status).toBe("CANCELLED");
    // Đánh vắng lại: trước đó là NONE ⇒ chuyển trạng thái THẬT ⇒ hồi sinh.
    const kq = await giaoDichDiemDanh((tx) => dongBoDongSauDiemDanh(tx, { sessionId: BUOI[0], createdById: GV, ghi: [ghi(HV[0], a.id, { makeupStatusTruoc: "NONE" })] }));
    expect(kq.hoiSinh).toBe(1);
    expect((await dong(HV[0], BUOI[0]))!.status).toBe("PENDING");
    // Quản lý huỷ tay, rồi giáo viên mở buổi cũ bấm Lưu lại (trước đó ĐÃ NEEDS_MAKEUP) ⇒ KHÔNG hồi sinh.
    const d = (await dong(HV[0], BUOI[0]))!;
    await db.makeupNeed.update({ where: { id: d.id }, data: { status: "CANCELLED" } });
    const kq2 = await giaoDichDiemDanh((tx) => dongBoDongSauDiemDanh(tx, { sessionId: BUOI[0], createdById: GV, ghi: [ghi(HV[0], a.id, { makeupStatusTruoc: "NEEDS_MAKEUP" })] }));
    expect(kq2.hoiSinh).toBe(0);
    expect((await dong(HV[0], BUOI[0]))!.status).toBe("CANCELLED");
  });

  it("[DHB-14] NGUYÊN TỬ: một bản ghi hỏng giữa lô ⇒ ĐIỂM DANH LẪN DÒNG cùng rollback (không còn 'điểm danh cần bù mà không có dòng' — TV-08)", async () => {
    const loi = await giaoDichDiemDanh(async (tx) => {
      const att = await tx.attendance.upsert({
        where: { sessionId_studentId: { sessionId: BUOI[0], studentId: HV[0] } },
        create: { sessionId: BUOI[0], studentId: HV[0], status: "ABSENT_EXCUSED", makeupStatus: "NEEDS_MAKEUP", centerId: CS },
        update: {},
        select: { id: true },
      });
      await dongBoDongSauDiemDanh(tx, {
        sessionId: BUOI[0],
        createdById: GV,
        // HV thứ hai KHÔNG tồn tại ⇒ khoá ngoại làm cả giao dịch hỏng.
        ghi: [ghi(HV[0], att.id), ghi(id("hoc-vien-khong-co"), att.id)],
      });
    }).then(
      () => null,
      (e: unknown) => String(e),
    );
    expect(loi).not.toBeNull();
    expect(await db.attendance.count({ where: { studentId: HV[0], sessionId: BUOI[0] } })).toBe(0);
    expect(await demDong(HV[0])).toBe(0);
  });

  it("[DHB-15] `thuHoiDongKhiCoMat`: không có dòng ⇒ 0, không lỗi", async () => {
    expect(await db.$transaction((tx) => thuHoiDongKhiCoMat(tx, { studentId: HV[0], missedSessionId: BUOI[0] }))).toBe(0);
  });

  // ── huỷ lớp ────────────────────────────────────────────────────────────────────────────
  it("[DHB-16] huỷ lớp KHÔNG đụng dòng; `danhGiaHocBuKhiHuyLop` chỉ liệt kê dòng ĐANG MỞ theo từng học viên, kèm cờ 'còn học khoá đó ở lớp khác'", async () => {
    await tao({ studentId: HV[0] });
    await tao({ studentId: HV[0], missedSessionId: BUOI[1] });
    await tao({ studentId: HV[1] });
    await tao({ studentId: HV[2] });
    // HV[1] đã bù xong, HV[2] đã huỷ — không còn là nghĩa vụ mở.
    await db.makeupNeed.updateMany({ where: { studentId: HV[1] }, data: { status: "COMPLETED" } });
    await db.makeupNeed.updateMany({ where: { studentId: HV[2] }, data: { status: "CANCELLED" } });
    // HV[0] còn ghi danh ĐANG HỌC cùng khoá ở lớp khác; ghi danh ở LOP (đang bị huỷ) đã WITHDREW:
    await db.enrollment.updateMany({ where: { studentId: HV[0], classId: LOP }, data: { status: "WITHDREW" } });
    await db.enrollment.create({ data: { id: id("gd-khac"), studentId: HV[0], classId: LOP_KHAC, courseId: KHOA, status: "ACTIVE" } });
    const truoc = await db.makeupNeed.count({ where: { classId: LOP } });
    const r = await db.$transaction((tx) => danhGiaHocBuKhiHuyLop(tx, LOP));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ studentId: HV[0], conGhiDanKhoaKhac: true });
    expect(r[0]!.needIds).toHaveLength(2);
    expect(await db.makeupNeed.count({ where: { classId: LOP } })).toBe(truoc); // chỉ ĐỌC
    // Ghi danh ở lớp KHÁC nhưng KHOÁ KHÁC không tính:
    await db.enrollment.deleteMany({ where: { id: id("gd-khac") } });
    await db.enrollment.create({ data: { id: id("gd-khoa2"), studentId: HV[0], classId: LOP2, courseId: KHOA2, status: "ACTIVE" } });
    const r2 = await db.$transaction((tx) => danhGiaHocBuKhiHuyLop(tx, LOP));
    expect(r2[0]).toMatchObject({ studentId: HV[0], conGhiDanKhoaKhac: false });
    // Ghi danh ĐANG HỌC ở chính lớp bị huỷ (chưa kịp chuyển WITHDREW) không phải "lớp khác":
    await db.enrollment.deleteMany({ where: { id: id("gd-khoa2") } });
    await db.enrollment.updateMany({ where: { studentId: HV[0], classId: LOP }, data: { status: "ACTIVE" } });
    const r3 = await db.$transaction((tx) => danhGiaHocBuKhiHuyLop(tx, LOP));
    expect(r3[0]).toMatchObject({ studentId: HV[0], conGhiDanKhoaKhac: false });
  });

  // ── ràng buộc DB ───────────────────────────────────────────────────────────────────────
  it("[DHB-17] ràng buộc: courseId NOT NULL + FK; xoá điểm danh gốc ⇒ originalAttendanceId về NULL và dòng CÒN NGUYÊN (nghĩa vụ bù không mất theo điểm danh)", async () => {
    const att = await taoAtt(HV[0], BUOI[0]);
    await tao({ originalAttendanceId: att.id });
    const d = (await dong(HV[0], BUOI[0]))!;
    expect(d.originalAttendanceId).toBe(att.id);
    await db.attendance.delete({ where: { id: att.id } });
    const sau = (await dong(HV[0], BUOI[0]))!;
    expect(sau.originalAttendanceId).toBeNull();
    expect(sau.status).toBe("PENDING");
    // courseId trỏ khoá không tồn tại ⇒ khoá ngoại từ chối.
    const hong = await db.makeupNeed
      .create({ data: { studentId: HV[1], classId: LOP, centerId: CS, courseId: id("khoa-khong-co"), sourceType: "OTHER", missedSessionId: BUOI[1] } })
      .then(
        () => null,
        (e: unknown) => String(e),
      );
    expect(hong).not.toBeNull();
    expect(await demDong(HV[1])).toBe(0);
  });

  it("[DHB-18] khoá của dòng LUÔN bằng khoá của lớp lúc tạo (nhóm case ghép theo cột này — lệch là xếp nhầm khoá)", async () => {
    await tao({ studentId: HV[0] });
    const d = (await dong(HV[0], BUOI[0]))!;
    const lop = await db.class.findUniqueOrThrow({ where: { id: d.classId }, select: { courseId: true } });
    expect(d.courseId).toBe(lop.courseId);
  });
});
