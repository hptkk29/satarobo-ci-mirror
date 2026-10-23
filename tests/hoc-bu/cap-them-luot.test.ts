// tests/hoc-bu/cap-them-luot.test.ts — [CTD-*] QLCS CẤP THÊM LƯỢT HỌC BÙ (chủ dự án 22/10/2026), Postgres THẬT.
//
// Chạy:  pnpm test:hoc-bu-db
//
// Gọi THẲNG `capThemLuot` / `docDongTheoId`. Mỗi ca tự dựng lại từ đầu (chạy MỘT MÌNH vẫn xanh — luật 18).
// Khoá có hạn mức học bù 0 lượt/học phần ⇒ dòng vắng THƯỜNG hết lượt (CAN_THU) cho tới khi QLCS cấp thêm.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import type { NguoiHocBu } from "@/lib/hoc-bu/pham-vi";
import { LoiHocBu } from "@/lib/hoc-bu/case-db";
import { docDongTheoId } from "@/lib/hoc-bu/danh-sach-db";
import { capThemLuot } from "@/lib/hoc-bu/cap-them-luot-db";
import { scopedDb } from "@/lib/db-scope";

if (!RUN_DB_TESTS) console.warn(`[CTD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-ctd-";
const id = (s: string) => `${T}${s}`;
const CS = id("cs");
const CS_KHAC = id("cs-khac");
const KHOA = id("khoa");
const CUR = id("cur");
const BAI1 = id("bai1");
const QL = id("ql");
const LOP = id("lop");
const HV = id("hv");
const B = [id("b0"), id("b1"), id("b2")] as const; // đã qua
const LY_DO = "Học vượt các buổi lớp đã dạy";
const NOW = new Date("2026-10-22T05:00:00.000Z");

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
// QLCS của MỘT CƠ SỞ KHÁC: không thấy dòng cần bù của cơ sở `CS`.
const QL_CO_SO_KHAC = {
  userId: QL,
  isSuperAdmin: false,
  isHoLevel: false,
  orgRoles: [],
  permissions: [],
  visibleCenterIds: [CS_KHAC],
  visibleOrgUnitIds: [],
  grantsAllow: new Set<string>(),
  assignedClassIds: new Set<string>(),
  chiCuaSale: null,
} as unknown as NguoiHocBu;

async function don() {
  const items = await db.orderItem.findMany({ where: { studentId: HV }, select: { orderId: true } });
  const orderIds = [...new Set(items.map((i) => i.orderId))];
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: T } }, { entityId: { in: orderIds } }] } });
  await db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.order.deleteMany({ where: { id: { in: orderIds } } });
  await db.makeupNeed.deleteMany({ where: { studentId: HV } });
  await db.makeupCreditAccount.deleteMany({ where: { studentId: HV } });
  await db.courseModuleMakeupQuota.deleteMany({ where: { courseId: KHOA } });
  await db.attendance.deleteMany({ where: { studentId: HV } });
  await db.classSession.deleteMany({ where: { classId: LOP } });
  await db.enrollment.deleteMany({ where: { studentId: HV } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.lesson.deleteMany({ where: { id: BAI1 } });
  await db.curriculum.deleteMany({ where: { id: CUR } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: HV } });
  await db.user.deleteMany({ where: { id: QL } });
  await db.center.deleteMany({ where: { id: { in: [CS, CS_KHAC] } } });
}

async function dung() {
  await don();
  await db.center.create({ data: { id: CS, name: "Cơ sở CTD", slug: `${T}cs`, address: "114 Hoàng Diệu" } });
  await db.center.create({ data: { id: CS_KHAC, name: "Cơ sở CTD khác", slug: `${T}cs-khac`, address: "211 Nguyễn Hữu Thọ" } });
  await db.user.create({ data: { id: QL, name: "QLCS CTD", email: `${QL}@test.local`, role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], centerId: CS } });
  await db.course.create({ data: { id: KHOA, name: "Khoá CTD", slug: `${T}khoa`, totalSessions: 12, price: 12_000_000 } });
  await db.curriculum.create({ data: { id: CUR, courseId: KHOA, name: "GT CTD" } });
  await db.lesson.create({ data: { id: BAI1, curriculumId: CUR, order: 1, title: "Bài 1", moduleCode: "M1" } });
  // Hạn mức 0 lượt/học phần ⇒ bé hết lượt ngay từ đầu; chỉ lượt QLCS cấp thêm mới giúp được.
  await db.courseModuleMakeupQuota.create({ data: { courseId: KHOA, moduleCode: "M1", luotBu: 0 } });
  await db.class.create({ data: { id: LOP, name: LOP, courseId: KHOA, centerId: CS, status: "ACTIVE", startTime: "18:00", endTime: "19:30" } });
  await db.student.create({ data: { id: HV, name: `Bé ${HV}`, centerId: CS, parentName: "PH CTD", parentPhone: "0900000000" } });
  await db.enrollment.create({ data: { id: id("gd"), studentId: HV, classId: LOP, courseId: KHOA, status: "ACTIVE" } });
  for (const [i, b] of B.entries()) {
    await db.classSession.create({ data: { id: b, classId: LOP, date: new Date(`2026-09-0${i + 1}T11:00:00.000Z`), lessonId: BAI1, status: "COMPLETED", centerId: CS } });
  }
}

/** Dòng cần bù do VẮNG THƯỜNG (đường chính của lượt). */
const dongVang = (sessionId: string) =>
  db.makeupNeed.create({
    data: { studentId: HV, classId: LOP, centerId: CS, courseId: KHOA, sourceType: "ABSENCE", missedSessionId: sessionId, missedLessonId: BAI1, status: "PENDING" },
  });
const cap = (needId: string, over: Partial<Parameters<typeof capThemLuot>[1]> = {}, actor: NguoiHocBu = ADMIN) =>
  capThemLuot(actor, { needId, delta: 1, lyDo: LY_DO, maLanCap: `lan-cap-${Math.random().toString(36).slice(2, 12)}`, ten: "QLCS CTD", ...over });
const bat = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e;
  }
};
const doc = async (needId: string) => (await docDongTheoId(scopedDb(ADMIN), [needId], null))[0]!;
const tk = () => db.makeupCreditAccount.findUnique({ where: { studentId_courseId: { studentId: HV, courseId: KHOA } }, include: { entries: { orderBy: { createdAt: "asc" } } } });

describe.skipIf(!RUN_DB_TESTS)("[CTD] QLCS cấp thêm lượt học bù — Postgres thật", () => {
  beforeEach(dung);
  afterAll(don);

  it("[CTD-00] FIXTURE: bé vắng thường với hạn mức 0 ⇒ hết lượt và phải thu phí (nếu không, các ca dưới xanh vì không có gì để cứu)", async () => {
    const n = await dongVang(B[0]);
    const d = await doc(n.id);
    expect(d.luot.con).toBe(0);
    expect(d.phi.loai).toBe("CAN_THU");
    expect(await tk()).toBeNull();
  });

  it("[CTD-01] cấp thêm ⇒ bé có lượt và dòng vắng thường thành bù MIỄN PHÍ; sổ có đúng một bút toán ADJUSTMENT mang lý do", async () => {
    const n = await dongVang(B[0]);
    const kq = await cap(n.id, { delta: 2 });
    expect(kq.daDoi).toBe(true);
    const d = await doc(n.id);
    expect(d.luot.con).toBe(2);
    expect(d.phi.loai).toBe("LUOT");
    const t = await tk();
    expect(t).toMatchObject({ granted: 2, held: 0, consumed: 0 });
    const dieuChinh = t!.entries.filter((e) => e.type === "ADJUSTMENT");
    expect(dieuChinh).toHaveLength(1);
    expect(dieuChinh[0]).toMatchObject({ grantedDelta: 2, heldDelta: 0, consumedDelta: 0 });
    expect(dieuChinh[0]!.reason).toContain(LY_DO);
    // khoá bút toán là `ADJUSTMENT:qlcs:<mã>` — KHÔNG phải `ADJUSTMENT:don:*` (phần lượt theo đơn khoá học, bị thu hồi khi đơn huỷ)
    expect(dieuChinh[0]!.idemKey).toMatch(/^ADJUSTMENT:qlcs:/);
  });

  it("[CTD-02] CỘNG DỒN: hai lần cấp (mã khác nhau) ⇒ 2 + 3 = 5 lượt, hai bút toán, hai dòng nhật ký", async () => {
    const n = await dongVang(B[0]);
    expect((await cap(n.id, { delta: 2, maLanCap: "lan-cap-dau-tien" })).daDoi).toBe(true);
    expect((await cap(n.id, { delta: 3, maLanCap: "lan-cap-thu-hai" })).daDoi).toBe(true);
    expect((await doc(n.id)).luot.con).toBe(5);
    const t = await tk();
    expect(t!.granted).toBe(5);
    expect(t!.entries.filter((e) => e.type === "ADJUSTMENT").map((e) => e.grantedDelta).sort()).toEqual([2, 3]);
    expect(await db.auditLog.count({ where: { module: "hoc-bu", action: "hoc-bu.cap-them-luot", entityId: n.id } })).toBe(2);
  });

  it("[CTD-03] CHỐNG BẤM ĐÚP: gửi lại CÙNG mã lần cấp ⇒ không cấp lần hai, không thêm bút toán, không thêm nhật ký", async () => {
    const n = await dongVang(B[0]);
    const ma = "lan-cap-bam-dup-0001";
    expect((await cap(n.id, { delta: 2, maLanCap: ma })).daDoi).toBe(true);
    expect((await cap(n.id, { delta: 2, maLanCap: ma })).daDoi).toBe(false);
    expect((await doc(n.id)).luot.con).toBe(2);
    const t = await tk();
    expect(t!.granted).toBe(2);
    expect(t!.entries.filter((e) => e.type === "ADJUSTMENT")).toHaveLength(1);
    expect(await db.auditLog.count({ where: { module: "hoc-bu", action: "hoc-bu.cap-them-luot", entityId: n.id } })).toBe(1);
  });

  it("[CTD-04] nhật ký: một dòng `hoc-bu.cap-them-luot` mang lý do, người cấp và số lượt đã áp", async () => {
    const n = await dongVang(B[0]);
    await cap(n.id, { delta: 4 });
    const a = await db.auditLog.findFirstOrThrow({ where: { module: "hoc-bu", action: "hoc-bu.cap-them-luot", entityId: n.id } });
    expect(a.entityType).toBe("MakeupNeed");
    expect(a.reason).toBe(LY_DO);
    expect(JSON.stringify(a.newValues)).toContain('"thayDoi":4');
  });

  it("[CTD-05] đầu vào sai bị chặn TRƯỚC khi chạm sổ: 0 · âm · vượt trần · lý do ngắn · mã lỗi ⇒ LoiHocBu, sổ không đổi", async () => {
    const n = await dongVang(B[0]);
    for (const over of [{ delta: 0 }, { delta: 13 }, { delta: -13 }, { delta: 1.5 }, { lyDo: "ngắn" }, { maLanCap: "x" }]) {
      expect(await bat(cap(n.id, over)), JSON.stringify(over)).toBeInstanceOf(LoiHocBu);
    }
    expect(await tk()).toBeNull();
    expect(await db.auditLog.count({ where: { action: "hoc-bu.cap-them-luot", entityId: n.id } })).toBe(0);
  });

  it("[CTD-06] PHẠM VI CƠ SỞ: QLCS của cơ sở khác không cấp được cho bé ngoài tầm nhìn (như không tồn tại); đối chứng — người thấy cơ sở thì cấp được", async () => {
    const n = await dongVang(B[0]);
    const loi = await bat(cap(n.id, { delta: 2 }, QL_CO_SO_KHAC));
    expect(loi).toBeInstanceOf(LoiHocBu);
    expect((loi as Error).message).toContain("Không tìm thấy");
    expect(await tk()).toBeNull();
    // đối chứng dương: cùng lệnh, người thấy cơ sở ⇒ cấp được
    expect((await cap(n.id, { delta: 2 })).daDoi).toBe(true);
  });

  it("[CTD-07] dòng không tồn tại hoặc đã huỷ không bù ⇒ LoiHocBu, sổ không đổi", async () => {
    expect(await bat(cap(id("khong-co")))).toBeInstanceOf(LoiHocBu);
    const n = await dongVang(B[0]);
    await db.makeupNeed.update({ where: { id: n.id }, data: { waivedAt: new Date(), waivedReason: "đã huỷ" } });
    expect(await bat(cap(n.id))).toBeInstanceOf(LoiHocBu);
    expect(await tk()).toBeNull();
  });

  it("[CTD-09] GIẢM: cấp 3 rồi giảm 2 ⇒ còn 1; giảm nốt ⇒ dòng quay về CAN_THU; hai bút toán ADJUSTMENT (+3, −2) và nhật ký `hoc-bu.giam-luot` có lý do", async () => {
    const n = await dongVang(B[0]);
    await cap(n.id, { delta: 3 });
    const g = await cap(n.id, { delta: -2, lyDo: "Cấp nhầm, phụ huynh không học vượt nữa" });
    expect(g).toEqual({ daDoi: true, apThucTe: -2 });
    expect((await doc(n.id)).luot.con).toBe(1);
    const t = await tk();
    expect(t!.granted).toBe(1);
    expect(t!.entries.filter((e) => e.type === "ADJUSTMENT").map((e) => e.grantedDelta).sort((a, b) => a - b)).toEqual([-2, 3]);
    const bt = t!.entries.find((e) => e.grantedDelta === -2)!;
    expect(bt.reason).toContain("QLCS giảm 2 lượt");
    expect(bt.idemKey).toMatch(/^ADJUSTMENT:qlcs:/);
    const a = await db.auditLog.findFirstOrThrow({ where: { action: "hoc-bu.giam-luot", entityId: n.id } });
    expect(a.reason).toBe("Cấp nhầm, phụ huynh không học vượt nữa");
    expect(JSON.stringify(a.newValues)).toContain('"thayDoi":-2');
    // đối chứng dương: cấp thêm KHÔNG sinh dòng `giam-luot`
    expect(await db.auditLog.count({ where: { action: "hoc-bu.giam-luot", entityId: n.id } })).toBe(1);
    // giảm nốt ⇒ hết lượt ⇒ buổi vắng thường lại phải thu phí
    await cap(n.id, { delta: -1 });
    expect((await doc(n.id)).phi.loai).toBe("CAN_THU");
  });

  it("[CTD-10] GIẢM CHỈ PHẦN CÒN TRỐNG: cấp 2, một lượt đang GIỮ trong case ⇒ giảm 2 chỉ rút được 1; lý do bút toán ghi rõ phần không rút được", async () => {
    const n = await dongVang(B[0]);
    await cap(n.id, { delta: 2 });
    await db.makeupCreditAccount.update({ where: { studentId_courseId: { studentId: HV, courseId: KHOA } }, data: { held: 1 } });
    const g = await cap(n.id, { delta: -2 });
    expect(g).toEqual({ daDoi: true, apThucTe: -1 });
    const t = await tk();
    expect(t).toMatchObject({ granted: 1, held: 1, consumed: 0 });
    expect(t!.entries.find((e) => e.grantedDelta === -1)!.reason).toMatch(/chỉ áp được -?1/);
  });

  it("[CTD-11] KHÔNG CÒN LƯỢT TRỐNG ĐỂ GIẢM ⇒ LoiHocBu nói rõ, sổ không đổi, không nhật ký; bé chưa có tài khoản sổ ⇒ giao dịch rollback, KHÔNG tạo tài khoản", async () => {
    const n = await dongVang(B[0]);
    const loi = await bat(cap(n.id, { delta: -1 }));
    expect(loi).toBeInstanceOf(LoiHocBu);
    expect((loi as Error).message).toContain("không còn lượt trống");
    expect(await tk()).toBeNull();
    // có tài khoản nhưng lượt đã được GIỮ hết
    await cap(n.id, { delta: 1 });
    await db.makeupCreditAccount.update({ where: { studentId_courseId: { studentId: HV, courseId: KHOA } }, data: { held: 1 } });
    expect(await bat(cap(n.id, { delta: -1 }))).toBeInstanceOf(LoiHocBu);
    expect(await tk()).toMatchObject({ granted: 1, held: 1 });
    expect(await db.auditLog.count({ where: { action: "hoc-bu.giam-luot", entityId: n.id } })).toBe(0);
  });

  it("[CTD-12] CHỐNG BẤM ĐÚP CHO GIẢM: gửi lại cùng mã ⇒ không giảm lần hai (không lỗi, không nhật ký thêm)", async () => {
    const n = await dongVang(B[0]);
    await cap(n.id, { delta: 3 });
    const ma = "lan-giam-bam-dup-0001";
    expect((await cap(n.id, { delta: -1, maLanCap: ma })).daDoi).toBe(true);
    expect(await cap(n.id, { delta: -1, maLanCap: ma })).toEqual({ daDoi: false, apThucTe: 0 });
    expect((await tk())!.granted).toBe(2);
    expect(await db.auditLog.count({ where: { action: "hoc-bu.giam-luot", entityId: n.id } })).toBe(1);
  });

  it("[CTD-13] PHẠM VI CƠ SỞ cho GIẢM: QLCS cơ sở khác không giảm được lượt của bé này; đối chứng dương — người thấy cơ sở thì giảm được", async () => {
    const n = await dongVang(B[0]);
    await cap(n.id, { delta: 2 });
    const loi = await bat(cap(n.id, { delta: -1 }, QL_CO_SO_KHAC));
    expect(loi).toBeInstanceOf(LoiHocBu);
    expect((loi as Error).message).toContain("Không tìm thấy");
    expect((await tk())!.granted).toBe(2);
    expect((await cap(n.id, { delta: -1 })).apThucTe).toBe(-1);
  });
});
