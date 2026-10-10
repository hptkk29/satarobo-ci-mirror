// tests/hoc-bu/_case-nhieu-bai-fixture.ts — thế giới dùng chung cho các bộ T07/T08 (case nhiều bài, mô hình đọc kết quả bù).
//
// Kịch bản nghiệm thu của chủ dự án: bé A vắng bài 5,6,7 · B vắng 6,7 · C vắng 7 · D vắng 8, cùng khoá + cùng cơ sở; lưới ca của hai giáo viên ngày 15 và
// 16/10 để `taoCaseVaXep` / `suaCase` chạy ĐẦU-CUỐI (không đi vòng qua `ghiBeVaoCase`). Mỗi bộ test gọi `dung()` ở `beforeEach` và `don()` ở `afterAll`.
import { db } from "@/lib/db";
import type { NguoiHocBu } from "@/lib/hoc-bu/pham-vi";
import { LoiHocBu, diemDanhBe, taoCaseVaXep, type KetQuaMucNhapDay } from "@/lib/hoc-bu/case-db";
import { docSnapshot } from "@/lib/hoc-bu/toan-ven-db";
import { chayToanVen, type Finding } from "@/lib/hoc-bu/toan-ven";
import { vnDateAt } from "@/lib/time/vn";
import { expect } from "vitest";

export const T = "fx-t07-";
export const id = (s: string) => `${T}${s}`;
export const CS = id("cs");
export const KHOA = id("khoa");
export const KHOA2 = id("khoa2");
export const CUR = id("cur");
export const CUR2 = id("cur2");
export const GV = id("gv");
export const GV2 = id("gv2");
/** T13 — người nhận thông báo: Sale của học viên và quản lý cơ sở. Chỉ dựng khi ca test cần (xem `dungNguoiNhan`). */
export const SALE = id("sale");
export const QL = id("ql");
export const PHONG = id("phong");
export const LOP = id("lop");
export const LOP2 = id("lop2");
export const CA_MAU = id("ca");
export const BAI = { 5: id("bai5"), 6: id("bai6"), 7: id("bai7"), 8: id("bai8") } as const;
export const BAI_KHAC = id("bai-khac");
export const HV = { A: id("hvA"), B: id("hvB"), C: id("hvC"), D: id("hvD") } as const;
export type Be = keyof typeof HV;
export type Bai = keyof typeof BAI;
/** Buổi vắng gốc của bài n: 21/09 + (n−5) ngày. */
export const NGAY_GOC: Record<Bai, string> = { 5: "2026-09-21", 6: "2026-09-22", 7: "2026-09-23", 8: "2026-09-24" };
export const buoiGoc = (b: Bai) => id(`s${b}`);
export const needId = (hv: Be, b: Bai) => id(`need-${hv}-${b}`);
export const MA_HP = "T07HP1";

/** Ai vắng bài nào — kịch bản nghiệm thu. */
export const VANG: Record<Be, Bai[]> = { A: [5, 6, 7], B: [6, 7], C: [7], D: [8] };

/** Case 15/10/2026 18:00–19:30 giờ VN. */
export const luc = (d: number, h: number, mi: number) => vnDateAt(2026, 9, d, h, mi);
export const NOW = luc(15, 18, 30); // giữa buổi dạy

/** Quản trị tối cao — `scopedDb` không cách ly; quyền do server action hỏi, không ở tầng này. */
export const ADMIN = {
  userId: GV,
  isSuperAdmin: true,
  isHoLevel: true,
  orgRoles: [],
  permissions: [],
  visibleCenterIds: [],
  visibleOrgUnitIds: [],
  grantsAllow: new Set<string>(),
  assignedClassIds: new Set<string>(),
  chiCuaSale: null, // T10: phạm vi Sale — null = thấy hết trong tầm nhìn cơ sở
} as unknown as NguoiHocBu;

export const ngayDb = (d: number) => new Date(Date.UTC(2026, 9, d));

export async function don() {
  // T13: thông báo + sự kiện do chính các luồng học bù sinh ra. Sự kiện xoá THEO LOẠI `makeup.*` (id case là cuid, không mang tiền tố fixture).
  await db.domainEvent.deleteMany({ where: { type: { startsWith: "makeup." } } });
  await db.notification.deleteMany({ where: { studentId: { in: Object.values(HV) } } });
  await db.staffNotification.deleteMany({ where: { userId: { in: [GV, GV2, SALE, QL] } } });
  const cases = await db.makeupCase.findMany({ where: { centerId: CS }, select: { id: true } });
  const caseIds = cases.map((c) => c.id);
  const be = await db.makeupCaseParticipant.findMany({ where: { caseId: { in: caseIds } }, select: { id: true } });
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...caseIds, ...be.map((b) => b.id)] } }, { entityId: { startsWith: T } }] } });
  const items = await db.orderItem.findMany({ where: { studentId: { in: Object.values(HV) } }, select: { orderId: true } });
  const orderIds = [...new Set(items.map((i) => i.orderId))];
  // T14: khoản thu của đơn phí (test hoàn tiền) — khoản hoàn trỏ khoản gốc nên xoá dòng hoàn trước.
  await db.payment.deleteMany({ where: { orderId: { in: orderIds }, adjustmentOfId: { not: null } } });
  await db.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.order.deleteMany({ where: { id: { in: orderIds } } });
  await db.makeupCase.deleteMany({ where: { centerId: CS } });
  await db.makeupNeed.deleteMany({ where: { studentId: { in: Object.values(HV) } } });
  await db.makeupCreditAccount.deleteMany({ where: { studentId: { in: Object.values(HV) } } });
  await db.courseModuleMakeupQuota.deleteMany({ where: { courseId: { in: [KHOA, KHOA2] } } });
  // T12: kỳ công do test chốt (lockPeriod ghi StaffAttendanceDay + AttendancePeriod). Ngày công trỏ kỳ ⇒ xoá ngày trước, kỳ sau.
  await db.staffAttendanceDay.deleteMany({ where: { centerId: CS } });
  await db.attendancePeriod.deleteMany({ where: { centerId: CS } });
  await db.shiftAssignment.deleteMany({ where: { userId: { in: [GV, GV2] } } });
  await db.shiftTemplate.deleteMany({ where: { id: { in: [CA_MAU, `${CA_MAU}-off`] } } });
  await db.classSession.deleteMany({ where: { classId: { in: [LOP, LOP2] } } });
  await db.enrollment.deleteMany({ where: { classId: { in: [LOP, LOP2] } } });
  await db.class.deleteMany({ where: { id: { in: [LOP, LOP2] } } });
  await db.lesson.deleteMany({ where: { id: { in: [...Object.values(BAI), BAI_KHAC] } } });
  await db.curriculum.deleteMany({ where: { id: { in: [CUR, CUR2] } } });
  await db.course.deleteMany({ where: { id: { in: [KHOA, KHOA2] } } });
  await db.student.deleteMany({ where: { id: { in: Object.values(HV) } } });
  await db.room.deleteMany({ where: { id: PHONG } });
  await db.user.deleteMany({ where: { id: { in: [GV, GV2, SALE, QL] } } });
  await db.center.deleteMany({ where: { id: CS } });
}

export async function dung(soLuot: Record<Be, number> = { A: 3, B: 3, C: 3, D: 3 }) {
  await don();
  // Sự kiện PENDING còn lại lúc này KHÔNG phải của ca test (sự kiện `makeup.*` đã xoá ở `don()`, ca chưa kịp tạo gì). Ở CI các bộ DB chạy trước dùng chung `ci_test` và để lại
  // hàng nghìn sự kiện chờ; `dispatchPendingEvents` rút MỌI sự kiện PENDING theo thứ tự cũ nhất trước (500/lượt) nên sự kiện của ca nằm sau chúng, không được xử lý kịp ⇒
  // "expected [] to have a length of 1" và chạy handler của người khác chậm tới trần thời gian. Đo 10/10 ở CI gương + vòng tái hiện bơm 1.200 sự kiện rác vào DB cục bộ.
  // Gạt sang DONE (không chạy handler): đó là dữ liệu tồn của bộ khác, không thuộc phạm vi ca này.
  await db.domainEvent.updateMany({ where: { status: "PENDING" }, data: { status: "DONE" } });
  await db.center.create({ data: { id: CS, name: "Cơ sở T07", slug: `${T}cs`, address: "114 Hoàng Diệu" } });
  for (const [u, ten] of [[GV, "GV T07"], [GV2, "GV T07 hai"]] as const) {
    await db.user.create({ data: { id: u, name: ten, email: `${u}@test.local`, role: "TEACHER", roles: ["TEACHER"], centerId: CS } });
  }
  await db.course.create({ data: { id: KHOA, name: "Khoá T07", slug: `${T}khoa`, totalSessions: 12, price: 12_000_000 } });
  await db.course.create({ data: { id: KHOA2, name: "Khoá T07 khác", slug: `${T}khoa2`, totalSessions: 12, price: 12_000_000 } });
  await db.curriculum.create({ data: { id: CUR, courseId: KHOA, name: "Giáo trình T07" } });
  await db.curriculum.create({ data: { id: CUR2, courseId: KHOA2, name: "Giáo trình T07 khác" } });
  for (const b of [5, 6, 7, 8] as const) {
    await db.lesson.create({ data: { id: BAI[b], curriculumId: CUR, order: b, title: `Bài ${b}`, moduleCode: MA_HP } });
  }
  await db.lesson.create({ data: { id: BAI_KHAC, curriculumId: CUR2, order: 1, title: "Bài khoá khác" } });
  await db.room.create({ data: { id: PHONG, code: `${T}p`, name: "Phòng T07", centerId: CS } });
  await db.class.create({ data: { id: LOP, name: "Lớp T07", courseId: KHOA, centerId: CS, status: "ACTIVE", startTime: "18:00", endTime: "19:30" } });
  await db.class.create({ data: { id: LOP2, name: "Lớp T07 khác", courseId: KHOA, centerId: CS, status: "ACTIVE", startTime: "19:00", endTime: "20:30", teacherId: GV } });
  // Lưới ca: cả hai giáo viên có ca 13:45–21:00 ngày 15/10 và 16/10 — `gvTrongCa` đòi ca phủ TRỌN khung giờ bù.
  await db.shiftTemplate.create({
    data: { id: CA_MAU, code: `${T}CT`, name: "Ca T07", kind: "TIMED", segments: [{ start: "13:45", end: "21:00", kind: "WORK" }] },
  });
  for (const u of [GV, GV2]) {
    for (const d of [15, 16]) {
      await db.shiftAssignment.create({
        data: {
          userId: u, centerId: CS, workDate: ngayDb(d), templateId: CA_MAU, templateCode: `${T}CT`,
          segments: [{ start: "13:45", end: "21:00", kind: "WORK" }], placeMode: "AT_UNITS", attendanceMode: "REQUIRED", dayCredit: 1, source: "MANUAL",
        },
      });
    }
  }
  for (const b of [5, 6, 7, 8] as const) {
    await db.classSession.create({
      data: { id: buoiGoc(b), classId: LOP, date: new Date(`${NGAY_GOC[b]}T11:00:00.000Z`), lessonId: BAI[b], status: "COMPLETED", centerId: CS },
    });
  }
  for (const hv of Object.keys(HV) as Be[]) {
    await db.student.create({ data: { id: HV[hv], name: `Bé T07 ${hv}`, centerId: CS } });
    await db.enrollment.create({ data: { id: id(`gd-${hv}`), studentId: HV[hv], classId: LOP, courseId: KHOA, status: "ACTIVE" } });
    // Sổ mở với một bút toán GRANT khớp số dư (checker TV-32 đòi số trên tài khoản = tổng bút toán).
    const tk = await db.makeupCreditAccount.create({ data: { studentId: HV[hv], courseId: KHOA, granted: soLuot[hv] } });
    // Sổ 0 lượt: DB cấm bút toán GRANT 0 (CHECK `dang`) — tài khoản rỗng không cần bút toán nào.
    if (soLuot[hv] > 0) {
      await db.makeupCreditEntry.create({
        data: { accountId: tk.id, type: "GRANT", grantedDelta: soLuot[hv], reason: "Mở sổ cho fixture", idemKey: "GRANT:khoi-tao" },
      });
    }
    for (const b of VANG[hv]) {
      await db.attendance.create({
        data: { id: `${buoiGoc(b)}-${hv}`, sessionId: buoiGoc(b), studentId: HV[hv], status: "ABSENT_EXCUSED", makeupStatus: "NEEDS_MAKEUP", absenceReason: "Con ốm", centerId: CS },
      });
      await db.makeupNeed.create({
        data: {
          id: needId(hv, b), studentId: HV[hv], classId: LOP, centerId: CS, courseId: KHOA, sourceType: "ABSENCE", originalAttendanceId: `${buoiGoc(b)}-${hv}`,
          missedSessionId: buoiGoc(b), missedLessonId: BAI[b], status: "PENDING", createdAt: new Date("2026-10-01T00:00:00.000Z"),
        },
      });
    }
  }
}

export const KHUNG = { ymd: "2026-10-15", startTime: "18:00", endTime: "19:30", roomId: PHONG, teacherId: GV, note: null };
/** Mỗi case trong MỘT ca test phải khác (giáo viên | phòng | ngày) với case khác — lõi trùng lịch T09 chặn hai case chồng giờ. */
export const tao = (needIds: string[], them: { lessonIds?: string[]; ymd?: string; teacherId?: string; roomId?: string | null } = {}) =>
  taoCaseVaXep(ADMIN, { ...KHUNG, needIds, ...them });
export const tatCa = (hv: Be) => VANG[hv].map((b) => needId(hv, b));
export const taiKhoan = (hv: Be) => db.makeupCreditAccount.findUniqueOrThrow({ where: { studentId_courseId: { studentId: HV[hv], courseId: KHOA } } });
export const so = async (hv: Be) => {
  const t = await taiKhoan(hv);
  return { granted: t.granted, held: t.held, consumed: t.consumed, con: t.granted - t.held - t.consumed };
};
export const beCua = (caseId: string, hv: Be) => db.makeupCaseParticipant.findUniqueOrThrow({ where: { caseId_studentId: { caseId, studentId: HV[hv] } } });
export const mucCua = (caseId: string, hv: Be, b: Bai) =>
  db.makeupCaseStudent.findFirstOrThrow({ where: { caseId, makeupNeedId: needId(hv, b) }, orderBy: { createdAt: "desc" } });
export const need = (hv: Be, b: Bai) => db.makeupNeed.findUniqueOrThrow({ where: { id: needId(hv, b) } });
export const dongAtt = (hv: Be, b: Bai) =>
  db.attendance.findUniqueOrThrow({ where: { sessionId_studentId: { sessionId: buoiGoc(b), studentId: HV[hv] } } });
export const lyDoLoi = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof LoiHocBu ? e.message : `LOI-KHAC: ${String(e)}`;
  }
};

/** Kết quả nhập cho một bé: map bài → kết quả (kèm đánh giá mặc định). */
export async function ketQua(caseId: string, hv: Be, kq: Partial<Record<Bai, "COMPLETED" | "NOT_COMPLETED">>): Promise<KetQuaMucNhapDay> {
  const ra: KetQuaMucNhapDay = {};
  for (const b of VANG[hv]) {
    const k = kq[b];
    if (!k) continue;
    const m = await mucCua(caseId, hv, b);
    ra[m.id] = { ketQua: k, danhGia: `Đánh giá ${hv}${b}` };
  }
  return ra;
}
export const diemDanh = async (caseId: string, hv: Be, coMat: boolean, kq: Partial<Record<Bai, "COMPLETED" | "NOT_COMPLETED">> = {}, nowDd = NOW) =>
  diemDanhBe(null, {
    participantId: (await beCua(caseId, hv)).id,
    coMat,
    ketQuaMuc: coMat ? await ketQua(caseId, hv, kq) : {},
    nhanXetChung: coMat ? "Con học tốt" : null,
    chiGiaoVien: GV,
    now: nowDd,
  });

/** Chạy checker T01 như script (chỉ-đọc). Trả các phát hiện NHẮC TỚI fixture này. */
export async function kiem(now: Date = luc(15, 18, 45)): Promise<Finding[]> {
  const o = { now, tuNgayYmd: "2026-09-20" };
  const r = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
      return chayToanVen(await docSnapshot(tx, o), o);
    },
    { timeout: 60_000, isolationLevel: "RepeatableRead" },
  );
  return r.findings.filter((f) => f.id.includes(T) || Object.values(f.lienQuan ?? {}).some((v) => v.includes(T)));
}
export const sach = async (now?: Date) => expect(await kiem(now)).toEqual([]);
