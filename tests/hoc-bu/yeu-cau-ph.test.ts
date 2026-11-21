// tests/hoc-bu/yeu-cau-ph.test.ts — [YCP-*] QLCS TẠO DÒNG CẦN BÙ THEO YÊU CẦU PHỤ HUYNH + CHỌN TÍNH PHÍ / KHÔNG TÍNH PHÍ (chủ dự án 21/10/2026), Postgres THẬT.
//
// Chạy:  pnpm test:hoc-bu-db
//
// Gọi THẲNG `taoDongBuTheoYeuCau` / `docBuoiDeBu` / `docDongTheoId` / `taoPhiBu`. Mỗi ca tự dựng lại từ đầu (chạy MỘT MÌNH vẫn xanh — luật 18).
// Khoá có hạn mức học bù 2 lượt/học phần ⇒ dòng vắng THƯỜNG còn lượt (đối chứng dương); dòng "tính phí theo yêu cầu" vẫn phải đòi phí.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import type { NguoiHocBu } from "@/lib/hoc-bu/pham-vi";
import { LoiHocBu, taoPhiBu } from "@/lib/hoc-bu/case-db";
import { docDongTheoId } from "@/lib/hoc-bu/danh-sach-db";
import { docBuoiDeBu, taoDongBuTheoYeuCau } from "@/lib/hoc-bu/yeu-cau-ph-db";
import { scopedDb } from "@/lib/db-scope";

if (!RUN_DB_TESTS) console.warn(`[YCP] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-ycp-";
const id = (s: string) => `${T}${s}`;
const CS = id("cs");
const KHOA = id("khoa");
const CUR = id("cur");
const BAI1 = id("bai1");
const QL = id("ql");
const LOP = id("lop");
const LOP_KHAC = id("lop-khac");
const HV = id("hv");
const HV_NGOAI = id("hv-ngoai");
const B = [id("b0"), id("b1"), id("b2")] as const; // đã qua
const B_TUONG_LAI = id("b-tl");
const B_HUY = id("b-huy");
const B_LOP_KHAC = id("b-lk");
const NOW = new Date("2026-10-21T05:00:00.000Z");
const LY_DO = "Phụ huynh xin bù các buổi vào lớp muộn";

const ADMIN = {
  userId: QL,
  isSuperAdmin: true,
  isHoLevel: true,
  orgRoles: [],
  permissions: [],
  visibleCenterIds: [],
  visibleOrgUnitIds: [],
  grantsAllow: new Set<string>(),
  assignedClassIds: new Set<string>(),
  chiCuaSale: null,
} as unknown as NguoiHocBu;

async function don() {
  const items = await db.orderItem.findMany({ where: { studentId: { in: [HV, HV_NGOAI] } }, select: { orderId: true } });
  const orderIds = [...new Set(items.map((i) => i.orderId))];
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: T } }, { entityId: { in: orderIds } }] } });
  await db.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.paymentRequest.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.order.deleteMany({ where: { id: { in: orderIds } } });
  await db.makeupNeed.deleteMany({ where: { studentId: { in: [HV, HV_NGOAI] } } });
  await db.makeupCreditAccount.deleteMany({ where: { studentId: { in: [HV, HV_NGOAI] } } });
  await db.courseModuleMakeupQuota.deleteMany({ where: { courseId: KHOA } });
  await db.attendance.deleteMany({ where: { studentId: { in: [HV, HV_NGOAI] } } });
  await db.classSession.deleteMany({ where: { classId: { in: [LOP, LOP_KHAC] } } });
  await db.enrollment.deleteMany({ where: { studentId: { in: [HV, HV_NGOAI] } } });
  await db.class.deleteMany({ where: { id: { in: [LOP, LOP_KHAC] } } });
  await db.lesson.deleteMany({ where: { id: BAI1 } });
  await db.curriculum.deleteMany({ where: { id: CUR } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: { in: [HV, HV_NGOAI] } } });
  await db.user.deleteMany({ where: { id: QL } });
  await db.center.deleteMany({ where: { id: CS } });
}

async function dung() {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở YCP", slug: `${T}cs`, address: "114 Hoàng Diệu" } });
  await db.user.create({ data: { id: QL, name: "QLCS YCP", email: `${QL}@test.local`, role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], centerId: CS } });
  await db.course.create({ data: { id: KHOA, name: "Khoá YCP", slug: `${T}khoa`, totalSessions: 12, price: 12_000_000 } });
  await db.curriculum.create({ data: { id: CUR, courseId: KHOA, name: "GT YCP" } });
  await db.lesson.create({ data: { id: BAI1, curriculumId: CUR, order: 1, title: "Bài 1", moduleCode: "M1" } });
  await db.courseModuleMakeupQuota.create({ data: { courseId: KHOA, moduleCode: "M1", luotBu: 2 } });
  await db.class.create({ data: { id: LOP, name: LOP, courseId: KHOA, centerId: CS, status: "ACTIVE", startTime: "18:00", endTime: "19:30" } });
  await db.class.create({ data: { id: LOP_KHAC, name: LOP_KHAC, courseId: KHOA, centerId: CS, status: "ACTIVE", startTime: "18:00", endTime: "19:30" } });
  for (const h of [HV, HV_NGOAI]) await db.student.create({ data: { id: h, name: `Bé ${h}`, centerId: CS, parentName: "PH YCP", parentPhone: "0900000000" } });
  await db.enrollment.create({ data: { id: id("gd"), studentId: HV, classId: LOP, courseId: KHOA, status: "ACTIVE" } });
  await db.enrollment.create({ data: { id: id("gd2"), studentId: HV_NGOAI, classId: LOP_KHAC, courseId: KHOA, status: "ACTIVE" } });
  for (const [i, b] of B.entries()) {
    await db.classSession.create({ data: { id: b, classId: LOP, date: new Date(`2026-09-0${i + 1}T11:00:00.000Z`), lessonId: BAI1, status: "COMPLETED", centerId: CS } });
  }
  await db.classSession.create({ data: { id: B_TUONG_LAI, classId: LOP, date: new Date("2026-12-01T11:00:00.000Z"), lessonId: BAI1, status: "SCHEDULED", centerId: CS } });
  await db.classSession.create({ data: { id: B_HUY, classId: LOP, date: new Date("2026-09-10T11:00:00.000Z"), lessonId: BAI1, status: "CANCELLED", centerId: CS } });
  await db.classSession.create({ data: { id: B_LOP_KHAC, classId: LOP_KHAC, date: new Date("2026-09-04T11:00:00.000Z"), lessonId: BAI1, status: "COMPLETED", centerId: CS } });
}

const dongCua = (sessionId: string, studentId = HV) => db.makeupNeed.findUniqueOrThrow({ where: { studentId_missedSessionId: { studentId, missedSessionId: sessionId } } });
const yeuCau = (over: Partial<Parameters<typeof taoDongBuTheoYeuCau>[1]> = {}) =>
  taoDongBuTheoYeuCau(ADMIN, { studentId: HV, sessionIds: [B[0]], chonPhi: "KHONG_TINH_PHI", lyDo: LY_DO, ten: "QLCS YCP", now: NOW, ...over });
const bat = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e;
  }
};
const trangThai = async (needId: string) => (await docDongTheoId(scopedDb(ADMIN), [needId], null))[0]!;

describe.skipIf(!RUN_DB_TESTS)("[YCP] QLCS tạo dòng cần bù theo yêu cầu phụ huynh — Postgres thật", () => {
  beforeEach(dung);
  afterAll(don);

  it("[YCP-01] KHÔNG TÍNH PHÍ: dòng MANUAL/YEU_CAU_PH được miễn phí ngay (có lý do, người duyệt), không dùng lượt; có nhật ký mỗi dòng", async () => {
    const kq = await yeuCau({ sessionIds: [B[0], B[1]] });
    expect(kq).toEqual({ tao: 2, boQua: [] });
    const d = await dongCua(B[0]);
    expect(d).toMatchObject({ sourceType: "MANUAL", nguon: "YEU_CAU_PH", status: "PENDING", freeApprovedById: QL, freeReason: LY_DO, createdById: QL });
    expect(d.freeApprovedAt).not.toBeNull();
    const t = await trangThai(d.id);
    expect(t.phi.loai).toBe("MIEN_PHI");
    expect(t.xep).toEqual({ ok: true, dungLuot: false });
    expect(await db.auditLog.count({ where: { module: "hoc-bu", action: "hoc-bu.tao-theo-yeu-cau", entityId: { in: [d.id, (await dongCua(B[1])).id] } } })).toBe(2);
  });

  it("[YCP-02] TÍNH PHÍ: dòng LUÔN đòi phí DÙ CÒN LƯỢT (đối chứng: dòng vắng thường cùng bé còn lượt thì xếp được bằng lượt); tạo phí bù được", async () => {
    await db.makeupNeed.create({
      data: { studentId: HV, classId: LOP, centerId: CS, courseId: KHOA, sourceType: "ABSENCE", missedSessionId: B[2], missedLessonId: BAI1, status: "PENDING" },
    });
    const thuong = await trangThai((await dongCua(B[2])).id);
    expect(thuong.luot.con).toBeGreaterThan(0); // tiền đề: còn lượt
    expect(thuong.phi.loai).toBe("LUOT");

    await yeuCau({ sessionIds: [B[0]], chonPhi: "TINH_PHI" });
    const d = await dongCua(B[0]);
    expect(d).toMatchObject({ sourceType: "MANUAL", nguon: "YEU_CAU_PH", freeApprovedAt: null });
    const t = await trangThai(d.id);
    expect(t.luot.con).toBeGreaterThan(0); // số lượt hiển thị vẫn là số thật…
    expect(t.phi.loai).toBe("CAN_THU"); // …nhưng dòng này không tiêu lượt
    expect(t.xep.ok).toBe(false);

    const { orderId } = await taoPhiBu(ADMIN, d.id);
    expect(orderId).toBeTruthy();
    expect((await trangThai(d.id)).phi.loai).toBe("CHO_THU");
  });

  it("[YCP-03] từ chối và KHÔNG ghi gì: buổi tương lai · buổi huỷ · buổi lớp khác · đã có mặt · lý do ngắn · chọn phí sai · quá trần", async () => {
    await db.attendance.create({ data: { sessionId: B[1], studentId: HV, status: "PRESENT", centerId: CS } });
    const hong: [string, Parameters<typeof yeuCau>[0]][] = [
      ["chưa diễn ra", { sessionIds: [B_TUONG_LAI] }],
      ["đã huỷ", { sessionIds: [B_HUY] }],
      ["không đang học lớp", { sessionIds: [B_LOP_KHAC] }],
      ["đã có mặt", { sessionIds: [B[1]] }],
      ["lý do ngắn", { lyDo: "ngắn" }],
      ["chọn phí sai", { chonPhi: "" as never }],
      ["quá trần", { sessionIds: Array.from({ length: 13 }, (_, i) => `${T}x${i}`) }],
    ];
    for (const [ten, over] of hong) {
      const e = await bat(yeuCau(over));
      expect(e, ten).toBeInstanceOf(LoiHocBu);
    }
    expect(await db.makeupNeed.count({ where: { studentId: HV } })).toBe(0);
  });

  it("[YCP-04] idempotent: buổi đã có dòng thì KHÔNG đổi gì (không đè lựa chọn phí cũ) và được báo trong boQua", async () => {
    await yeuCau({ sessionIds: [B[0]], chonPhi: "KHONG_TINH_PHI" });
    const truoc = await dongCua(B[0]);
    const lai = await yeuCau({ sessionIds: [B[0], B[1]], chonPhi: "TINH_PHI" });
    expect(lai.tao).toBe(1);
    expect(lai.boQua).toHaveLength(1);
    expect(lai.boQua[0]!.sessionId).toBe(B[0]);
    const sau = await dongCua(B[0]);
    expect(sau.freeApprovedAt?.getTime()).toBe(truoc.freeApprovedAt?.getTime()); // vẫn miễn phí
    expect((await dongCua(B[1])).freeApprovedAt).toBeNull(); // dòng mới theo lựa chọn mới
  });

  it("[YCP-05] phạm vi Sale: người chỉ thấy học viên của mình bị chặn với học viên không phải của mình", async () => {
    const sale = { ...ADMIN, chiCuaSale: "sale-khong-ton-tai" } as unknown as NguoiHocBu;
    expect(await bat(taoDongBuTheoYeuCau(sale, { studentId: HV, sessionIds: [B[0]], chonPhi: "KHONG_TINH_PHI", lyDo: LY_DO, ten: "x", now: NOW }))).toBeInstanceOf(LoiHocBu);
    expect(await bat(docBuoiDeBu(sale, HV, NOW))).toBeInstanceOf(LoiHocBu);
    expect(await db.makeupNeed.count({ where: { studentId: HV } })).toBe(0);
  });

  it("[YCP-06] docBuoiDeBu: chỉ buổi ĐÃ QUA của lớp bé đang học, trừ buổi huỷ và buổi bé đã có mặt; đánh dấu buổi đã có dòng", async () => {
    await db.attendance.create({ data: { sessionId: B[2], studentId: HV, status: "LATE", centerId: CS } });
    await yeuCau({ sessionIds: [B[0]] });
    const ds = await docBuoiDeBu(ADMIN, HV, NOW);
    expect(ds.map((b) => b.sessionId).sort()).toEqual([B[0], B[1]].sort());
    expect(ds.find((b) => b.sessionId === B[0])!.daCoDong).toBe(true);
    expect(ds.find((b) => b.sessionId === B[1])!.daCoDong).toBe(false);
  });
});
