// tests/finance/bao-luu-p6.test.ts — PHIÊN 6 trên POSTGRES THẬT: ảnh chụp quyền lợi · phục học · chuyển Trung tâm · tạm dừng cả lớp · yêu cầu hoàn · dời hạn đợt thu.
//
// Chạy:  pnpm test:finance-db
// Kịch bản §K: khoá 48 buổi, An đã học 20/48, học phí thực 12.000.000đ (250.000đ/buổi). Đồng hồ ĐÓNG BĂNG (luật 19): NOW = 07/10/2026 10:00 VN.
// Chat giả (spy): chứng minh lời gọi đồng bộ nằm TRONG giao dịch (ca rollback) và đếm số lần.
import { describe, it, expect, afterAll, vi } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";

const h = vi.hoisted(() => ({ sync: vi.fn(async (_tx: unknown, _classId: string) => {}) }));
vi.mock("@/lib/chat/sync-membership", () => ({ syncConversationMembership: h.sync }));

import { lapHoSo, duyetHoSo, type PhuThuoc } from "@/lib/bao-luu/dich-vu";
import { goiYLopPhucHoc, baoPhucHoc, phucHoc, chuyenSangTrungTam } from "@/lib/bao-luu/phuc-hoc-db";
import { tamDungLop } from "@/lib/bao-luu/tam-dung-lop";
import { sinhYeuCauHoan } from "@/lib/bao-luu/yeu-cau-hoan";
import { laBaoLuuBat } from "@/lib/bao-luu/feature";
import { apDungDoiHanBaoLuu } from "@/lib/finance/bao-luu-tien";
import { dungAnhChupKhiBatDau } from "@/lib/bao-luu/anh-chup-db";
import { docDongTheoId } from "@/lib/hoc-bu/danh-sach-db";

if (!RUN_DB_TESTS) console.warn(`[BL6-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-bl6-";
const CS = `${T}cs`;
const OU = `${T}ou`;
const KHOA = `${T}khoa`;
const GIAO_TRINH = `${T}gt`;
const LOP_A = `${T}lop-a`; // lớp bé đang học (đã dừng ở bài 20)
const LOP_B = `${T}lop-b`; // đi SAU: buổi sắp tới là bài 19 ⇒ học lại 19–20
const LOP_C = `${T}lop-c`; // đi TRƯỚC: buổi sắp tới là bài 23 ⇒ bù 21, 22
const LOP_D = `${T}lop-d`; // quá xa: bài 30
const HV = `${T}hv-an`;
const GD = `${T}gd-an`;
const RID = `${T}r`;
const DON = `${T}don`;
const OI = `${T}oi`;
const SALE = { id: `${T}sale`, name: "Sale fixture" };
const QLCS = { id: `${T}qlcs`, name: "QLCS fixture" };
const NOW = new Date("2026-10-07T03:00:00Z");
const NGAY = 86_400_000;
const bay = (n: number) => new Date(NOW.getTime() - n * NGAY);
const KHOA_DON = "bao-luu/2026-10/aaaaaaaa11111111.pdf";
const DEPS: PhuThuoc = { xacMinhTep: async () => ({ ok: true }), khoDaCauHinh: () => true };
const LOP_TAT_CA = [LOP_A, LOP_B, LOP_C, LOP_D];
const HOC_VIEN_LOP = Array.from({ length: 12 }, (_, i) => `${T}hv-l${String(i + 1).padStart(2, "0")}`);
const LOP_CENTER = `${T}lop-center`;

async function don() {
  await db.refundRequest.deleteMany({ where: { enrollmentId: { startsWith: T } } });
  await db.payment.deleteMany({ where: { enrollmentId: { startsWith: T } } });
  await db.paymentRequest.deleteMany({ where: { orderId: DON } });
  await db.orderItem.deleteMany({ where: { orderId: DON } });
  await db.order.deleteMany({ where: { id: DON } });
  await db.domainEvent.deleteMany({ where: { type: { startsWith: "bao-luu." }, payloadJson: { path: ["centerId"], equals: CS } } });
  await db.auditLog.deleteMany({ where: { entityId: { startsWith: T } } });
  await db.makeupNeed.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.attendance.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.studentReserveEvent.deleteMany({ where: { reserve: { studentId: { startsWith: T } } } });
  await db.studentReserve.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.enrollmentAuditLog.deleteMany({ where: { enrollmentId: { startsWith: T } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: T } } });
  await db.classSession.deleteMany({ where: { classId: { startsWith: T } } });
  await db.class.deleteMany({ where: { id: { startsWith: T } } });
  await db.lesson.deleteMany({ where: { curriculumId: GIAO_TRINH } });
  await db.curriculum.deleteMany({ where: { id: GIAO_TRINH } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: { startsWith: T } } });
  await db.user.deleteMany({ where: { id: { in: [SALE.id, QLCS.id] } } });
  await db.orgUnit.deleteMany({ where: { id: OU } });
  await db.center.deleteMany({ where: { id: CS } });
  await db.systemSetting.deleteMany({ where: { key: { in: ["pause.enabled", "billing.flexV1Enabled"] } } });
}

async function batCongTac(bat: boolean, khoa = "pause.enabled") {
  await db.systemSetting.upsert({ where: { key: khoa }, create: { key: khoa, valueJson: bat }, update: { valueJson: bat } });
}

const lessonId = (order: number) => `${T}ls-${order}`;
let phien = 0;
async function buoi(classId: string, order: number | null, date: Date) {
  await db.classSession.create({ data: { id: `${T}s-${classId.slice(T.length)}-${++phien}`, classId, date, centerId: CS, ...(order ? { lessonId: lessonId(order) } : {}) } });
}

/** Dựng trường: giáo trình 30 bài; lớp A (An học bài 1–20 đã qua + bài 21 sắp tới), B (bài 19 sắp tới), C (bài 21,22 đã qua + bài 23 sắp tới), D (bài 30). */
async function dung() {
  await don();
  phien = 0;
  h.sync.mockReset();
  h.sync.mockImplementation(async () => {});
  await db.center.create({ data: { id: CS, name: "CS BL6", slug: CS, address: "x" } });
  await db.orgUnit.create({ data: { id: OU, type: "CENTER", code: `${T}OU`, name: "ĐV BL6", centerId: CS } });
  for (const u of [SALE, QLCS]) {
    await db.user.create({ data: { id: u.id, name: u.name, email: `${u.id}@example.test`, role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], centerId: CS } });
  }
  await db.course.create({ data: { id: KHOA, name: "Sata 3 BL6", slug: KHOA, totalSessions: 48 } });
  await db.curriculum.create({ data: { id: GIAO_TRINH, courseId: KHOA, name: "GT BL6" } });
  for (let o = 1; o <= 30; o++) await db.lesson.create({ data: { id: lessonId(o), curriculumId: GIAO_TRINH, order: o, title: `Bài ${o}` } });
  for (const id of LOP_TAT_CA) await db.class.create({ data: { id, name: `Lớp ${id.slice(T.length)}`, courseId: KHOA, centerId: CS, status: "ACTIVE", maxStudents: 12 } });

  for (let o = 1; o <= 20; o++) await buoi(LOP_A, o, bay(150 - o * 7));
  await buoi(LOP_A, 21, new Date(NOW.getTime() + 3 * NGAY));
  await buoi(LOP_B, 19, new Date(NOW.getTime() + 3 * NGAY));
  await buoi(LOP_C, 21, bay(14));
  await buoi(LOP_C, 22, bay(7));
  await buoi(LOP_C, 23, new Date(NOW.getTime() + 3 * NGAY));
  await buoi(LOP_D, 30, new Date(NOW.getTime() + 3 * NGAY));

  await db.student.create({ data: { id: HV, name: "An BL6", centerId: CS, orgUnitId: OU, status: "ACTIVE" } });
  await db.enrollment.create({ data: { id: GD, studentId: HV, classId: LOP_A, courseId: KHOA, status: "ACTIVE", centerId: CS, finalPrice: 12_000_000 } });
  // An có mặt ở 20 buổi đầu của lớp A.
  const bs = await db.classSession.findMany({ where: { classId: LOP_A, date: { lt: NOW } }, select: { id: true } });
  for (const b of bs) await db.attendance.create({ data: { studentId: HV, sessionId: b.id, status: "PRESENT" } });
  await batCongTac(true);
}

type TaoHoSo = { status?: "ACTIVE" | "RESUME_PENDING" | "OVERDUE"; type?: "PARENT" | "CENTER"; extra?: object };
/** Hồ sơ đang bảo lưu có sẵn ảnh chụp (bài dừng 20), ghi danh + học viên PAUSED. */
async function hoSoDangNghi(o: TaoHoSo = {}) {
  await db.enrollment.update({ where: { id: GD }, data: { status: "PAUSED" } });
  await db.student.update({ where: { id: HV }, data: { status: "PAUSED" } });
  await db.studentReserve.create({
    data: {
      id: RID, studentId: HV, enrollmentId: GD, reason: "fx", createdByName: SALE.name, createdByUserId: SALE.id, centerId: CS, type: o.type ?? "PARENT",
      status: o.status ?? "ACTIVE", isActive: true, approvedAt: bay(30), startedAt: bay(30), standardEndDate: new Date(NOW.getTime() + 60 * NGAY),
      snapTuitionNet: 12_000_000, snapSoBuoiMua: 48, snapSessionsRemaining: 28, snapUnitPrice: 250_000, snapStoppedAtLessonOrder: 20, ...o.extra,
    },
  });
  await db.studentReserveEvent.create({ data: { reserveId: RID, kind: "START", centerId: CS, after: { status: "ACTIVE", enrollmentStatusTruoc: "ACTIVE" } } });
}

const loi = (r: { ok: boolean; loi?: string[] }) => (r.ok ? "" : (r.loi ?? []).join(" | "));
const nguoi = { id: QLCS.id, name: QLCS.name };

describe.skipIf(!RUN_DB_TESTS)("[BL6-AC] ảnh chụp quyền lợi qua luồng THẬT lập → duyệt", () => {
  afterAll(don);

  it("[BL6-AC-DB-01] TC-17: An học 20/48, học phí thực 12tr ⇒ ảnh chụp còn 28 buổi, 250.000đ/buổi, dừng ở bài 20, cờ 'suy ra' (đơn không khai số buổi mua)", async () => {
    await dung();
    const lap = await lapHoSo(
      { studentId: HV, enrollmentIds: [GD], reasonCode: "FAMILY", reasonNote: "", expectedReturnDate: null, firstAbsentDate: null, applicationFileKey: KHOA_DON, evidenceFileKeys: [], vuotTran: null },
      SALE, NOW, DEPS,
    );
    expect(lap.ok).toBe(true);
    const id = lap.ok ? lap.data.reserveIds[0]! : "";
    expect((await duyetHoSo({ reserveId: id, lui: false }, QLCS, NOW)).ok).toBe(true);
    const x = await db.studentReserve.findUniqueOrThrow({ where: { id } });
    expect(x).toMatchObject({
      status: "ACTIVE", snapTuitionNet: 12_000_000, snapSoBuoiMua: 48, snapSoBuoiSuyRa: true, snapSessionsRemaining: 28, snapUnitPrice: 250_000, snapStoppedAtLessonOrder: 20,
    });
    expect(x.snapPricing).toMatchObject({ nguonSoBuoi: "tong-buoi-khoa", nguonHocPhi: "enrollment.finalPrice", soBuoiDaDung: 20 });
    // Điểm móc ZNS "đã duyệt" (Phiên 7): đúng MỘT sự kiện, phát cùng giao dịch với duyệt.
    expect(await db.domainEvent.count({ where: { type: "bao-luu.da-duyet", dedupeKey: `bao-luu.approve:${id}` } })).toBe(1);
  });

  it("[BL6-AC-DB-02] đơn KHAI số buổi mua (24) ⇒ lấy số khai, không đặt cờ suy ra; vắng KHÔNG tính là đã dùng", async () => {
    await dung();
    await db.order.create({ data: { id: DON, code: "ORD-BL6-1", type: "COURSE", status: "PENDING_PAYMENT", customerName: "PH", customerPhone: "0900000006", totalAmount: 12_000_000, centerId: CS } });
    await db.orderItem.create({
      data: { id: OI, orderId: DON, type: "COURSE_ENROLLMENT", itemName: "Sata 3", quantity: 1, unitPrice: 12_000_000, totalPrice: 12_000_000, enrollmentId: GD, metadata: { soBuoi: 24 } },
    });
    // Buổi 20 An VẮNG ⇒ đã dùng chỉ còn 19.
    const b20 = await db.classSession.findFirstOrThrow({ where: { classId: LOP_A, lessonId: lessonId(20) } });
    await db.attendance.updateMany({ where: { studentId: HV, sessionId: b20.id }, data: { status: "ABSENT" } });
    const a = await db.$transaction((tx) => dungAnhChupKhiBatDau(tx, { enrollmentId: GD, studentId: HV, startedAt: NOW }));
    expect(a).toMatchObject({ snapSoBuoiMua: 24, snapSoBuoiSuyRa: false, snapSessionsRemaining: 5, snapUnitPrice: 500_000, snapStoppedAtLessonOrder: 19 });
  });
});

describe.skipIf(!RUN_DB_TESTS)("[BL6-PH] phục học (BR-21/22) và chuyển Trung tâm (BR-24)", () => {
  afterAll(don);

  it("[BL6-PH-DB-01] gợi ý lớp: B (đi sau 2 bài ⇒ học lại) và C (đi trước 2 bài ⇒ bù) phù hợp, A khớp, D (bài 30) bị loại", async () => {
    await dung();
    await hoSoDangNghi();
    const r = await goiYLopPhucHoc(RID, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ dungOBai: 20, dungSai: 2 });
    const theo = new Map(r.data.lop.map((l) => [l.classId, l]));
    expect(theo.get(LOP_A)).toMatchObject({ huong: "KHOP", lech: 0 });
    expect(theo.get(LOP_B)).toMatchObject({ huong: "HOC_LAI", lech: -2, hocLaiTu: 19, hocLaiDen: 20 });
    expect(theo.get(LOP_C)).toMatchObject({ huong: "BU", lech: 2, soBuoiBu: 2 });
    expect(theo.has(LOP_D)).toBe(false);
  });

  it("[BL6-PH-DB-02] TC-13: phục học vào lớp ĐI SAU (B) ⇒ chuyển ghi danh sang B, học lại 19–20, KHÔNG buổi bù; ghi danh về ACTIVE; hồ sơ ENDED/RESUMED; chat đồng bộ cả lớp cũ lẫn lớp mới", async () => {
    await dung();
    await hoSoDangNghi();
    const r = await phucHoc({ reserveId: RID, lopMoiId: LOP_B, ghiChu: "PH báo quay lại" }, nguoi, NOW);
    expect(r).toMatchObject({ ok: true, data: { huong: "HOC_LAI", soBuoiBuDaSinh: 0 } });
    expect(await db.enrollment.findUniqueOrThrow({ where: { id: GD } })).toMatchObject({ classId: LOP_B, status: "ACTIVE" });
    expect((await db.student.findUniqueOrThrow({ where: { id: HV } })).status).toBe("ACTIVE");
    expect(await db.studentReserve.findUniqueOrThrow({ where: { id: RID } })).toMatchObject({ status: "ENDED", isActive: false, endKind: "RESUMED", resumeClassId: LOP_B });
    expect(await db.makeupNeed.count({ where: { studentId: HV } })).toBe(0);
    // Điểm móc ZNS "đã xếp phục học" (Phiên 7): đúng MỘT sự kiện cho hồ sơ này.
    expect(await db.domainEvent.count({ where: { type: "bao-luu.phuc-hoc", dedupeKey: `bao-luu.resume:${RID}` } })).toBe(1);
    const goi = h.sync.mock.calls.map((c) => c[1]);
    expect(goi).toContain(LOP_A);
    expect(goi).toContain(LOP_B);
  });

  it("[BL6-PH-DB-03] TC-14: phục học vào lớp ĐI TRƯỚC (C) ⇒ sinh ĐÚNG 2 buổi bù PHUC_HOC cho bài 21, 22 (PENDING); không động tới lớp cũ", async () => {
    await dung();
    await hoSoDangNghi();
    const r = await phucHoc({ reserveId: RID, lopMoiId: LOP_C }, nguoi, NOW);
    expect(r).toMatchObject({ ok: true, data: { huong: "BU", soBuoiBuDaSinh: 2, thieuBuoiBu: 0 } });
    const bu = await db.makeupNeed.findMany({ where: { studentId: HV }, select: { nguon: true, status: true, classId: true, missedLessonId: true } });
    expect(bu).toHaveLength(2);
    expect(bu.every((b) => b.nguon === "PHUC_HOC" && b.status === "PENDING" && b.classId === LOP_C)).toBe(true);
    expect(bu.map((b) => b.missedLessonId).sort()).toEqual([lessonId(21), lessonId(22)]);
  });

  it("[BL6-PH-DB-03b] BR-22: buổi bù PHUC_HOC ĐỌC RA là MIEN_PHI và KHÔNG dùng lượt (đo qua docDongTheoId, không chỉ cột nguon); đối chứng: cùng dòng mà nguon rỗng thì KHÔNG miễn phí", async () => {
    await dung();
    await hoSoDangNghi();
    await phucHoc({ reserveId: RID, lopMoiId: LOP_C }, nguoi, NOW);
    const ids = (await db.makeupNeed.findMany({ where: { studentId: HV }, select: { id: true } })).map((x) => x.id);
    expect(ids).toHaveLength(2);
    const doc = () => docDongTheoId(db as unknown as Parameters<typeof docDongTheoId>[0], ids, null);
    const dong = await doc();
    expect(dong).toHaveLength(2);
    for (const d of dong) {
      expect(d.phi).toEqual({ loai: "MIEN_PHI" });
      expect(d.xep).toEqual({ ok: true, dungLuot: false });
    }
    // Đối chứng dương: gỡ nguồn PHUC_HOC ⇒ dòng KHÔNG còn miễn phí (nếu không, ca trên xanh vì lý do khác).
    await db.makeupNeed.updateMany({ where: { id: { in: ids } }, data: { nguon: null } });
    for (const d of await doc()) expect(d.phi.loai).not.toBe("MIEN_PHI");
  });

  it("[BL6-PH-DB-04] BR-21: còn nợ quá hạn ⇒ CHẶN; trả đủ ⇒ qua. (Ngưỡng 0 ngày, khác BR-06)", async () => {
    await dung();
    await hoSoDangNghi();
    await db.order.create({ data: { id: DON, code: "ORD-BL6-2", type: "COURSE", status: "PENDING_PAYMENT", customerName: "PH", customerPhone: "0900000007", totalAmount: 5_000_000, centerId: CS } });
    await db.orderItem.create({ data: { id: OI, orderId: DON, type: "COURSE_ENROLLMENT", itemName: "Sata 3", quantity: 1, unitPrice: 5_000_000, totalPrice: 5_000_000, enrollmentId: GD } });
    const dot = await db.paymentRequest.create({
      data: { orderId: DON, orderItemId: OI, centerId: CS, installmentNo: 1, amountDue: 1_000_000, dueDate: bay(1), status: "PENDING" },
    });
    expect(loi(await phucHoc({ reserveId: RID, lopMoiId: LOP_B }, nguoi, NOW))).toMatch(/quá 1 ngày.*Thu đủ/);
    expect((await db.studentReserve.findUniqueOrThrow({ where: { id: RID } })).status).toBe("ACTIVE");
    await db.paymentRequest.update({ where: { id: dot.id }, data: { status: "PAID" } });
    expect((await phucHoc({ reserveId: RID, lopMoiId: LOP_B }, nguoi, NOW)).ok).toBe(true);
  });

  it("[BL6-PH-DB-05] lớp ngoài dung sai (D, bài 30) bị từ chối, không đổi gì; học viên đã có ghi danh ở lớp đích bị từ chối", async () => {
    await dung();
    await hoSoDangNghi();
    expect(loi(await phucHoc({ reserveId: RID, lopMoiId: LOP_D }, nguoi, NOW))).toMatch(/không phù hợp/);
    await db.enrollment.create({ data: { id: `${T}gd-trung`, studentId: HV, classId: LOP_B, courseId: KHOA, status: "ACTIVE", centerId: CS } });
    expect(loi(await phucHoc({ reserveId: RID, lopMoiId: LOP_B }, nguoi, NOW))).toMatch(/đã có ghi danh/);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: GD } })).classId).toBe(LOP_A);
    expect((await db.studentReserve.findUniqueOrThrow({ where: { id: RID } })).status).toBe("ACTIVE");
  });

  it("[BL6-PH-DB-06] ROLLBACK: chat ném giữa chừng ⇒ ghi danh VẪN ở lớp A/PAUSED, hồ sơ VẪN ACTIVE, KHÔNG nhu cầu bù, không sự kiện RESUME", async () => {
    await dung();
    await hoSoDangNghi();
    let lan = 0;
    h.sync.mockImplementation(async () => {
      if (++lan === 2) throw new Error("chat down");
    });
    await expect(phucHoc({ reserveId: RID, lopMoiId: LOP_C }, nguoi, NOW)).rejects.toThrow("chat down");
    expect(await db.enrollment.findUniqueOrThrow({ where: { id: GD } })).toMatchObject({ classId: LOP_A, status: "PAUSED" });
    expect((await db.studentReserve.findUniqueOrThrow({ where: { id: RID } })).status).toBe("ACTIVE");
    expect(await db.makeupNeed.count({ where: { studentId: HV } })).toBe(0);
    expect(await db.studentReserveEvent.count({ where: { reserveId: RID, kind: "RESUME" } })).toBe(0);
    expect(await db.domainEvent.count({ where: { type: "bao-luu.phuc-hoc", dedupeKey: `bao-luu.resume:${RID}` } })).toBe(0); // rollback kéo theo cả sự kiện
  });

  it("[BL6-PH-DB-07] báo phục học: ACTIVE ⇒ RESUME_PENDING (+ liên hệ); OVERDUE/NOTICE_SENT cũng được; hồ sơ đã chờ thì chặn", async () => {
    await dung();
    await hoSoDangNghi({ status: "OVERDUE" });
    expect(loi(await baoPhucHoc({ reserveId: RID, ghiChu: "ko" }, nguoi, NOW))).toMatch(/ít nhất 5/);
    expect((await baoPhucHoc({ reserveId: RID, ghiChu: "PH gọi báo muốn học lại" }, nguoi, NOW)).ok).toBe(true);
    const x = await db.studentReserve.findUniqueOrThrow({ where: { id: RID } });
    expect(x).toMatchObject({ status: "RESUME_PENDING", isActive: true });
    expect(x.lastContactAt?.toISOString()).toBe(NOW.toISOString());
    expect(loi(await baoPhucHoc({ reserveId: RID, ghiChu: "gọi lần nữa" }, nguoi, NOW))).toMatch(/đã ở trạng thái chờ/);
  });

  it("[BL6-PH-DB-08] BR-24: còn lớp phù hợp ⇒ KHÔNG chuyển sang Trung tâm; hết lớp phù hợp ⇒ loại CENTER + sự kiện CONVERT_CENTER; chỉ khi đã chờ phục học", async () => {
    await dung();
    await hoSoDangNghi();
    expect(loi(await chuyenSangTrungTam({ reserveId: RID, lyDo: "không có lớp" }, nguoi, NOW))).toMatch(/chờ xếp lớp/); // chưa báo phục học
    await baoPhucHoc({ reserveId: RID, ghiChu: "PH báo muốn học lại" }, nguoi, NOW);
    expect(loi(await chuyenSangTrungTam({ reserveId: RID, lyDo: "không có lớp" }, nguoi, NOW))).toMatch(/Còn \d+ lớp phù hợp/);
    for (const id of [LOP_A, LOP_B, LOP_C]) await db.class.update({ where: { id }, data: { status: "COMPLETED" } });
    expect((await chuyenSangTrungTam({ reserveId: RID, lyDo: "không có lớp phù hợp trong thời hạn" }, nguoi, NOW)).ok).toBe(true);
    expect(await db.studentReserve.findUniqueOrThrow({ where: { id: RID } })).toMatchObject({ type: "CENTER", status: "RESUME_PENDING" });
    expect((await db.studentReserveEvent.findMany({ where: { reserveId: RID } })).map((e) => e.kind)).toContain("CONVERT_CENTER");
  });
});

describe.skipIf(!RUN_DB_TESTS)("[BL6-CT] Trung tâm tạm dừng cả lớp (BR-23)", () => {
  afterAll(don);

  async function dungLopDong(soHv = 12) {
    await dung();
    await db.class.create({ data: { id: LOP_CENTER, name: "Lớp CENTER", courseId: KHOA, centerId: CS, status: "ACTIVE", maxStudents: 20 } });
    for (const id of HOC_VIEN_LOP.slice(0, soHv)) {
      await db.student.create({ data: { id, name: `HV ${id.slice(-3)}`, centerId: CS, orgUnitId: OU, status: "ACTIVE" } });
      await db.enrollment.create({ data: { id: id.replace("hv", "gd"), studentId: id, classId: LOP_CENTER, courseId: KHOA, status: "ACTIVE", centerId: CS, finalPrice: 12_000_000 } });
    }
  }

  it("[BL6-CT-DB-01] tạm dừng lớp 12 HV: 12 hồ sơ CENTER ACTIVE (không đơn, có ảnh chụp), 12 ghi danh PAUSED, 12 học viên PAUSED, MỘT sự kiện hệ thống", async () => {
    await dungLopDong();
    const r = await tamDungLop({ classId: LOP_CENTER, ngayMoLai: new Date(NOW.getTime() + 30 * NGAY), lyDo: "Giáo viên nghỉ đột xuất, tạm dừng lớp" }, nguoi, NOW);
    expect(r).toMatchObject({ ok: true, data: { soHocVien: 12, boQua: [] } });
    const hs = await db.studentReserve.findMany({ where: { studentId: { in: HOC_VIEN_LOP } } });
    expect(hs).toHaveLength(12);
    expect(hs.every((x) => x.type === "CENTER" && x.status === "ACTIVE" && x.isActive && x.applicationFileKey === null && x.approvedAt !== null)).toBe(true);
    expect(hs.every((x) => x.snapSoBuoiMua === 48 && x.snapSessionsRemaining === 48 && x.snapUnitPrice === 250_000)).toBe(true);
    expect(await db.enrollment.count({ where: { classId: LOP_CENTER, status: "PAUSED" } })).toBe(12);
    expect(await db.student.count({ where: { id: { in: HOC_VIEN_LOP }, status: "PAUSED" } })).toBe(12);
    expect(await db.domainEvent.count({ where: { type: "bao-luu.tam-dung-lop", payloadJson: { path: ["classId"], equals: LOP_CENTER } } })).toBe(1);
  });

  it("[BL6-CT-DB-02] TC-16: hỏng ở HV thứ 7 ⇒ ROLLBACK CẢ 12 — không hồ sơ, không ghi danh PAUSED, không học viên PAUSED, không sự kiện", async () => {
    await dungLopDong();
    let lan = 0;
    h.sync.mockImplementation(async () => {
      if (++lan === 7) throw new Error("chat down ở em thứ 7");
    });
    await expect(tamDungLop({ classId: LOP_CENTER, ngayMoLai: null, lyDo: "Giáo viên nghỉ đột xuất" }, nguoi, NOW)).rejects.toThrow("em thứ 7");
    expect(lan).toBe(7);
    expect(await db.studentReserve.count({ where: { studentId: { in: HOC_VIEN_LOP } } })).toBe(0);
    expect(await db.enrollment.count({ where: { classId: LOP_CENTER, status: "ACTIVE" } })).toBe(12);
    expect(await db.student.count({ where: { id: { in: HOC_VIEN_LOP }, status: "ACTIVE" } })).toBe(12);
    expect(await db.domainEvent.count({ where: { type: "bao-luu.tam-dung-lop", payloadJson: { path: ["classId"], equals: LOP_CENTER } } })).toBe(0);
  });

  it("[BL6-CT-DB-03] em đã có hồ sơ mở bị BỎ QUA và LIỆT KÊ (không làm hỏng cả lô); khoá allowPause=false / cờ TẮT ⇒ từ chối cả lớp", async () => {
    await dungLopDong(3);
    const [a] = HOC_VIEN_LOP;
    await db.studentReserve.create({
      data: { studentId: a!, enrollmentId: a!.replace("hv", "gd"), reason: "fx", createdByName: "x", centerId: CS, status: "PENDING", isActive: false },
    });
    const r = await tamDungLop({ classId: LOP_CENTER, ngayMoLai: null, lyDo: "Mất điện cả khu" }, nguoi, NOW);
    expect(r).toMatchObject({ ok: true, data: { soHocVien: 2 } });
    expect(r.ok && r.data.boQua.map((b) => b.studentId)).toEqual([a]);

    await dungLopDong(2);
    await db.course.update({ where: { id: KHOA }, data: { allowPause: false } });
    expect(loi(await tamDungLop({ classId: LOP_CENTER, ngayMoLai: null, lyDo: "Mất điện cả khu" }, nguoi, NOW))).toMatch(/không áp dụng bảo lưu/);
    await db.course.update({ where: { id: KHOA }, data: { allowPause: true } });
    await batCongTac(false);
    expect(loi(await tamDungLop({ classId: LOP_CENTER, ngayMoLai: null, lyDo: "Mất điện cả khu" }, nguoi, NOW))).toMatch(/chưa được bật/);
    expect(await db.studentReserve.count({ where: { studentId: { in: HOC_VIEN_LOP } } })).toBe(0);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[BL6-HOAN] yêu cầu hoàn của hồ sơ CENTER (BR-23)", () => {
  afterAll(don);

  async function dungHoan(o: { daThu?: number; type?: "PARENT" | "CENTER"; extra?: object } = {}) {
    await dung();
    await hoSoDangNghi({ type: o.type ?? "CENTER", extra: o.extra });
    await db.order.create({ data: { id: DON, code: "ORD-BL6-3", type: "COURSE", status: "CONFIRMED", customerName: "PH", customerPhone: "0900000008", totalAmount: 12_000_000, centerId: CS } });
    await db.orderItem.create({ data: { id: OI, orderId: DON, type: "COURSE_ENROLLMENT", itemName: "Sata 3", quantity: 1, unitPrice: 12_000_000, totalPrice: 12_000_000, enrollmentId: GD } });
    const daThu = o.daThu ?? 12_000_000;
    if (daThu > 0) {
      await db.payment.create({
        data: { orderId: DON, orderItemId: OI, enrollmentId: GD, amount: daThu, method: "BANK_TRANSFER", centerId: CS, saleStatus: "COLLECT_CONFIRMED", accountantStatus: "CONFIRMED", paidDate: bay(60) },
      });
    }
  }

  it("[BL6-HOAN-DB-01] TC-17: CENTER còn 28/48 buổi, 12tr/48 ⇒ yêu cầu hoàn PENDING 28 × 250.000 = 7.000.000; hồ sơ ENDED/REFUNDED, ghi danh WITHDREW; KHÔNG chi tiền (không dòng Payment âm)", async () => {
    await dungHoan();
    const r = await sinhYeuCauHoan({ reserveId: RID, lyDo: "Lớp ngừng hẳn, không mở lại" }, nguoi, NOW);
    expect(r).toMatchObject({ ok: true, data: { soTien: 7_000_000, biKepVeSoDaThu: false } });
    const yc = await db.refundRequest.findFirstOrThrow({ where: { enrollmentId: GD } });
    expect(yc).toMatchObject({ trigger: "MANUAL", status: "PENDING", proposedAmount: 7_000_000, paidConfirmed: 12_000_000, sessionsTotal: 48, sessionsLearned: 20, unitPrice: 250_000, orderItemId: OI });
    expect(await db.studentReserve.findUniqueOrThrow({ where: { id: RID } })).toMatchObject({ status: "ENDED", isActive: false, endKind: "REFUNDED" });
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: GD } })).status).toBe("WITHDREW");
    expect(await db.payment.count({ where: { enrollmentId: GD, amount: { lt: 0 } } })).toBe(0); // không chi
    expect(await db.domainEvent.count({ where: { type: "bao-luu.yeu-cau-hoan", payloadJson: { path: ["reserveId"], equals: RID } } })).toBe(1);
  });

  it("[BL6-HOAN-DB-02] BR-20: hồ sơ PARENT KHÔNG sinh yêu cầu hoàn; thiếu ảnh chụp giá ⇒ từ chối (không 0, không đoán); chưa thu đồng nào ⇒ không có gì để hoàn", async () => {
    await dungHoan({ type: "PARENT" });
    expect(loi(await sinhYeuCauHoan({ reserveId: RID, lyDo: "thử hoàn cho phụ huynh" }, nguoi, NOW))).toMatch(/Chỉ hồ sơ do Trung tâm/);
    expect(await db.refundRequest.count({ where: { enrollmentId: GD } })).toBe(0);

    await dungHoan({ extra: { snapUnitPrice: null, snapTuitionNet: null } });
    expect(loi(await sinhYeuCauHoan({ reserveId: RID, lyDo: "Lớp ngừng hẳn" }, nguoi, NOW))).toMatch(/thiếu học phí hoặc số buổi/);

    await dungHoan({ daThu: 0 });
    expect(loi(await sinhYeuCauHoan({ reserveId: RID, lyDo: "Lớp ngừng hẳn" }, nguoi, NOW))).toMatch(/Chưa thu đồng nào/);
    expect((await db.studentReserve.findUniqueOrThrow({ where: { id: RID } })).status).toBe("ACTIVE");
  });

  it("[BL6-HOAN-DB-03] KHÔNG hoàn quá số đã thu: đã thu 3tr < đề xuất 7tr ⇒ kẹp về 3.000.000 và ghi rõ; hai lần ⇒ lần hai bị chặn (hồ sơ đã ENDED)", async () => {
    await dungHoan({ daThu: 3_000_000 });
    const r = await sinhYeuCauHoan({ reserveId: RID, lyDo: "Lớp ngừng hẳn" }, nguoi, NOW);
    expect(r).toMatchObject({ ok: true, data: { soTien: 3_000_000, biKepVeSoDaThu: true } });
    expect((await db.refundRequest.findFirstOrThrow({ where: { enrollmentId: GD } })).reason).toMatch(/kẹp về số đã thu/);
    expect(loi(await sinhYeuCauHoan({ reserveId: RID, lyDo: "Lớp ngừng hẳn" }, nguoi, NOW))).toMatch(/không còn ở trạng thái đang tạm dừng/);
    expect(await db.refundRequest.count({ where: { enrollmentId: GD } })).toBe(1);
  });

  it("[BL6-HOAN-DB-05] học phí KHÔNG chia hết: 10.000.000đ / 48 buổi, còn 28 ⇒ tiền hoàn tính từ CẶP chưa chia, làm tròn ĐẾN ĐỒNG ở kết quả cuối = 5.833.333đ (K13) — không phải 5.833.000 (làm tròn nghìn) hay 5.824.000 (đơn giá làm tròn × 28)", async () => {
    await dungHoan({ extra: { snapTuitionNet: 10_000_000, snapSoBuoiMua: 48, snapSessionsRemaining: 28, snapUnitPrice: 208_000 } });
    const r = await sinhYeuCauHoan({ reserveId: RID, lyDo: "Lớp ngừng hẳn" }, nguoi, NOW);
    expect(r).toMatchObject({ ok: true, data: { soTien: 5_833_333, biKepVeSoDaThu: false } });
    expect((await db.refundRequest.findFirstOrThrow({ where: { enrollmentId: GD } })).proposedAmount).toBe(5_833_333);
  });

  it("[BL6-HOAN-DB-04] ROLLBACK: chat ném sau khi đã tạo yêu cầu hoàn ⇒ KHÔNG RefundRequest, hồ sơ VẪN ACTIVE, ghi danh VẪN PAUSED", async () => {
    await dungHoan();
    h.sync.mockRejectedValueOnce(new Error("chat down"));
    await expect(sinhYeuCauHoan({ reserveId: RID, lyDo: "Lớp ngừng hẳn" }, nguoi, NOW)).rejects.toThrow("chat down");
    expect(await db.refundRequest.count({ where: { enrollmentId: GD } })).toBe(0);
    expect((await db.studentReserve.findUniqueOrThrow({ where: { id: RID } })).status).toBe("ACTIVE");
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: GD } })).status).toBe("PAUSED");
  });
});

describe.skipIf(!RUN_DB_TESTS)("[BL6-DH] dời hạn đợt thu theo bảo lưu (BR-15) — đi theo pause.enabled", () => {
  afterAll(don);

  async function dungDot() {
    await dung();
    await hoSoDangNghi({ extra: { startedAt: bay(1), expectedEndAt: new Date(bay(1).getTime() + 30 * NGAY) } });
    await db.order.create({ data: { id: DON, code: "ORD-BL6-4", type: "COURSE", status: "PENDING_PAYMENT", customerName: "PH", customerPhone: "0900000009", totalAmount: 6_000_000, centerId: CS } });
    await db.orderItem.create({ data: { id: OI, orderId: DON, type: "COURSE_ENROLLMENT", itemName: "Sata 3", quantity: 1, unitPrice: 6_000_000, totalPrice: 6_000_000, enrollmentId: GD } });
    for (const [no, ngay] of [[1, 20], [2, 50]] as const) {
      await db.paymentRequest.create({
        data: { id: `${T}pr-${no}`, orderId: DON, orderItemId: OI, centerId: CS, installmentNo: no, amountDue: 3_000_000, dueDate: new Date(NOW.getTime() + ngay * NGAY), status: "PENDING" },
      });
    }
  }
  const hanDot = async (no: number) => (await db.paymentRequest.findUniqueOrThrow({ where: { id: `${T}pr-${no}` } }));
  const chay = () => apDungDoiHanBaoLuu({ reserveId: RID, actor: { id: QLCS.id, name: QLCS.name }, now: NOW, coChoPhep: laBaoLuuBat });

  it("[BL6-DH-DB-01] TC-06: hai đợt chưa tới hạn dời ĐÚNG 30 ngày, TỔNG phải thu không đổi — dù cờ `billing.flexV1Enabled` TẮT (chỉ cần pause.enabled)", async () => {
    await dungDot();
    await batCongTac(false, "billing.flexV1Enabled");
    const goc = [(await hanDot(1)).dueDate!.getTime(), (await hanDot(2)).dueDate!.getTime()];
    const r = await chay();
    expect(r).toMatchObject({ ok: true, soDotDaDoi: 2, soNgay: 30 });
    const [d1, d2] = [await hanDot(1), await hanDot(2)];
    expect(d1.dueDate!.getTime()).toBe(goc[0]! + 30 * NGAY);
    expect(d2.dueDate!.getTime()).toBe(goc[1]! + 30 * NGAY);
    expect(d1).toMatchObject({ pauseShiftReserveId: RID, pauseShiftDays: 30, amountDue: 3_000_000 });
    expect(d1.amountDue + d2.amountDue).toBe(6_000_000);
    // Hạn CŨ nằm ở nhật ký audit (nơi duy nhất nhớ nó).
    const au = await db.auditLog.findFirstOrThrow({ where: { action: "DOI_HAN_DOT_BAO_LUU", entityId: DON } });
    expect(JSON.stringify(au.oldValues)).toContain(new Date(goc[0]!).toISOString());
  });

  it("[BL6-DH-DB-02] chạy lại ⇒ KHÔNG dời thêm (khoá theo số ngày); GIA HẠN 15 ngày ⇒ dời thêm ĐÚNG phần chênh 15 (tổng 45), rồi chạy lại vẫn 45", async () => {
    await dungDot();
    await chay();
    expect(await chay()).toMatchObject({ ok: true, soDotDaDoi: 0 });
    expect((await hanDot(1)).pauseShiftDays).toBe(30);

    const hanMoi = new Date(bay(1).getTime() + 45 * NGAY);
    await db.studentReserve.update({ where: { id: RID }, data: { extendedEndDate: hanMoi } });
    expect(await chay()).toMatchObject({ ok: true, soDotDaDoi: 2 });
    const d1 = await hanDot(1);
    expect(d1.pauseShiftDays).toBe(45);
    expect(d1.dueDate!.getTime()).toBe(NOW.getTime() + 20 * NGAY + 45 * NGAY);
    expect(await chay()).toMatchObject({ ok: true, soDotDaDoi: 0 });
    expect((await hanDot(2)).pauseShiftDays).toBe(45);
  });

  it("[BL6-DH-DB-03] cờ pause.enabled TẮT ⇒ KHÔNG dời (đếm donCoChuaBatCo); đợt ĐÃ quá hạn trước lúc bảo lưu không dời; đợt đã PAID không dời", async () => {
    await dungDot();
    await batCongTac(false);
    expect(await chay()).toMatchObject({ ok: true, soDotDaDoi: 0, donCoChuaBatCo: 1 });
    expect((await hanDot(1)).pauseShiftDays).toBeNull();

    await batCongTac(true);
    await db.paymentRequest.update({ where: { id: `${T}pr-1` }, data: { dueDate: bay(5) } }); // quá hạn trước
    await db.paymentRequest.update({ where: { id: `${T}pr-2` }, data: { status: "PAID" } });
    expect(await chay()).toMatchObject({ ok: true, soDotDaDoi: 0 });
  });

  it("[BL6-DH-DB-04] bảo lưu KHÔNG khai ngày quay lại ⇒ không dời gì (soNgay 0) — cả khi sau đó được gia hạn (không có mốc để 'dời tiếp')", async () => {
    await dungDot();
    await db.studentReserve.update({ where: { id: RID }, data: { expectedEndAt: null, extendedEndDate: new Date(NOW.getTime() + 40 * NGAY) } });
    expect(await chay()).toMatchObject({ ok: true, soNgay: 0, soDotDaDoi: 0 });
    expect((await hanDot(2)).pauseShiftReserveId).toBeNull();
  });
});
