// tests/hoc-bu/lich-su-luot.test.ts — [LSD-*] LỊCH SỬ CẤP LƯỢT + QLCS SỬA (17/11/2026), Postgres THẬT.
//
// Chạy:  pnpm test:hoc-bu-db
//
// Gọi THẲNG `capThemLuot` (để có bút toán QLCS thật) rồi `suaLuotQlcs` / `suaLuotHocVuot` / `docLichSuLuot`. Mỗi ca tự dựng lại từ đầu (chạy MỘT MÌNH vẫn xanh — luật 18).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import type { NguoiHocBu } from "@/lib/hoc-bu/pham-vi";
import { LoiHocBu } from "@/lib/hoc-bu/loi";
import { capThemLuot } from "@/lib/hoc-bu/cap-them-luot-db";
import { docLichSuLuot, suaLuotHocVuot, suaLuotQlcs } from "@/lib/hoc-bu/lich-su-luot-db";
import { dieuChinhLuot } from "@/lib/hoc-bu/so-luot";

if (!RUN_DB_TESTS) console.warn(`[LSD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-lsd-";
const id = (s: string) => `${T}${s}`;
const CS = id("cs");
const CS_KHAC = id("cs-khac");
const KHOA = id("khoa");
const CUR = id("cur");
const BAI1 = id("bai1");
const QL = id("ql");
const LOP = id("lop");
const HV = id("hv");
const BUOI = id("b0");
const YC = id("yc");
const LY_DO = "Cấp nhầm một lượt do chọn sai lớp";

const actorCoBan = { userId: QL, orgRoles: [], permissions: [], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(), chiCuaSale: null };
const ADMIN = { ...actorCoBan, isSuperAdmin: true, isHoLevel: true, visibleCenterIds: [] } as unknown as NguoiHocBu;
const QL_CO_SO_KHAC = { ...actorCoBan, isSuperAdmin: false, isHoLevel: false, visibleCenterIds: [CS_KHAC] } as unknown as NguoiHocBu;

async function don() {
  // Nhật ký mang entityId là id bút toán / dòng cần bù (cuid, không tiền tố) ⇒ dọn theo NGƯỜI LÀM (QL có tiền tố) — nếu không, đếm toàn cục ở ca sau dính rác ca trước.
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: T } }, { actorId: QL }] } });
  await db.enrollmentCatchUpRequest.deleteMany({ where: { studentId: HV } });
  await db.makeupNeed.deleteMany({ where: { studentId: HV } });
  await db.makeupCreditAccount.deleteMany({ where: { studentId: HV } });
  await db.courseModuleMakeupQuota.deleteMany({ where: { courseId: KHOA } });
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
  await db.center.create({ data: { id: CS, name: "Cơ sở LSD", slug: `${T}cs`, address: "114 Hoàng Diệu" } });
  await db.center.create({ data: { id: CS_KHAC, name: "Cơ sở LSD khác", slug: `${T}cs-khac`, address: "211 Nguyễn Hữu Thọ" } });
  await db.user.create({ data: { id: QL, name: "QLCS LSD", email: `${QL}@test.local`, role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], centerId: CS } });
  await db.course.create({ data: { id: KHOA, name: "Khoá LSD", slug: `${T}khoa`, totalSessions: 12, price: 12_000_000 } });
  await db.curriculum.create({ data: { id: CUR, courseId: KHOA, name: "GT LSD" } });
  await db.lesson.create({ data: { id: BAI1, curriculumId: CUR, order: 1, title: "Bài 1", moduleCode: "M1" } });
  // Hạn mức 0 lượt/học phần ⇒ sổ khởi tạo 0; mọi lượt trong các ca dưới là lượt QLCS cấp / duyệt (số liệu không lẫn lượt theo công thức).
  await db.courseModuleMakeupQuota.create({ data: { courseId: KHOA, moduleCode: "M1", luotBu: 0 } });
  await db.class.create({ data: { id: LOP, name: LOP, courseId: KHOA, centerId: CS, status: "ACTIVE", startTime: "18:00", endTime: "19:30" } });
  await db.student.create({ data: { id: HV, name: `Bé ${HV}`, centerId: CS, parentName: "PH LSD", parentPhone: "0900000000" } });
  await db.enrollment.create({ data: { id: id("gd"), studentId: HV, classId: LOP, courseId: KHOA, status: "ACTIVE" } });
  await db.classSession.create({ data: { id: BUOI, classId: LOP, date: new Date("2026-09-01T11:00:00.000Z"), lessonId: BAI1, status: "COMPLETED", centerId: CS } });
}

const dongVang = () =>
  db.makeupNeed.create({
    data: { studentId: HV, classId: LOP, centerId: CS, courseId: KHOA, sourceType: "ABSENCE", missedSessionId: BUOI, missedLessonId: BAI1, status: "PENDING" },
  });
let dem = 0;
const ma = () => `lan-lsd-${Date.now().toString(36)}-${++dem}`;
const capTay = (needId: string, delta: number) => capThemLuot(ADMIN, { needId, delta, lyDo: "Học vượt các buổi lớp đã dạy", maLanCap: ma(), ten: "QLCS LSD" });
const bat = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e;
  }
};
const tk = () => db.makeupCreditAccount.findUnique({ where: { studentId_courseId: { studentId: HV, courseId: KHOA } }, include: { entries: { orderBy: { createdAt: "asc" } } } });
const dongGoc = async () => (await tk())!.entries.find((e) => e.idemKey?.startsWith("ADJUSTMENT:qlcs:") && !e.idemKey.includes(":sua:"))!;
const lichSu = async (actor: NguoiHocBu = ADMIN) => (await docLichSuLuot(actor, { trang: 1, soDong: 50 })).dong;

/** Yêu cầu học vượt đã DUYỆT + bút toán cộng b lượt như `duyetYeuCauHocVuot` làm. */
async function yeuCauDaDuyet(b: number, phaiBu = 4, status: "APPROVED" | "CANCELLED" = "APPROVED") {
  await db.enrollmentCatchUpRequest.create({
    data: {
      id: YC, status, orderId: id("don"), orderItemId: id("item"), enrollmentId: id("gd"), studentId: HV, classId: LOP, courseId: KHOA, centerId: CS,
      startLesson: 5, sessionsToCatchUp: phaiBu, makeupSessions: b, proposedById: QL, proposedAt: new Date("2026-11-10T03:00:00Z"), decidedById: QL, decidedAt: new Date("2026-11-10T04:00:00Z"),
      creditEntryKey: `ADJUSTMENT:hocvuot:${YC}`,
    },
  });
  await db.$transaction((tx) =>
    dieuChinhLuot(tx, { studentId: HV, courseId: KHOA, classId: LOP, delta: b, nguon: `hocvuot:${YC}`, lyDo: `Học vượt bù: QLCS duyệt cộng ${b} lượt`, actorId: QL }),
  );
}

describe.skipIf(!RUN_DB_TESTS)("[LSD] lịch sử cấp lượt + QLCS sửa — Postgres thật", () => {
  beforeEach(dung);
  afterAll(don);

  it("[LSD-00] FIXTURE: cấp thêm 3 lượt ⇒ lịch sử có đúng một dòng QLCS_CAP +3, hiệu lực 3, sửa được; sổ còn 3", async () => {
    const n = await dongVang();
    await capTay(n.id, 3);
    const ds = await lichSu();
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ nhom: "QLCS_CAP", delta: 3, hieuLuc: 3, suaDuoc: true, hocVien: `Bé ${HV}` });
    expect(ds[0]!.so).toMatchObject({ tong: 3, con: 3 });
  });

  it("[LSD-01] SỬA GIẢM 3 → 1: bút toán gốc GIỮ NGUYÊN (+3), thêm một bút toán bù trừ −2, sổ còn 1, lịch sử hiện hiệu lực 1 + một dòng 'Sửa bút toán QLCS', nhật ký ghi lý do", async () => {
    const n = await dongVang();
    await capTay(n.id, 3);
    const goc = await dongGoc();
    const kq = await suaLuotQlcs(ADMIN, { entryId: goc.id, soMoi: 1, lyDo: LY_DO, maLan: ma(), ten: "QLCS LSD" });
    expect(kq).toEqual({ daDoi: true, thayDoi: -2 });
    const t = await tk();
    expect(t!.granted).toBe(1);
    const dieuChinh = t!.entries.filter((e) => e.type === "ADJUSTMENT").map((e) => e.grantedDelta);
    expect(dieuChinh.sort()).toEqual([-2, 3]); // gốc còn nguyên
    expect((await db.makeupCreditEntry.findUniqueOrThrow({ where: { id: goc.id } })).grantedDelta).toBe(3);
    const ds = await lichSu();
    expect(ds.find((d) => d.id === goc.id)).toMatchObject({ nhom: "QLCS_CAP", delta: 3, hieuLuc: 1 });
    expect(ds.filter((d) => d.nhom === "QLCS_SUA")).toHaveLength(1);
    expect(ds.find((d) => d.nhom === "QLCS_SUA")).toMatchObject({ delta: -2, suaDuoc: false });
    const a = await db.auditLog.findFirstOrThrow({ where: { module: "hoc-bu", action: "hoc-bu.sua-luot-qlcs", entityId: goc.id } });
    expect(a.reason).toBe(LY_DO);
  });

  it("[LSD-02] SỬA hai lần liên tiếp tính trên số HIỆU LỰC: 3 → 1 → 4 ⇒ bù trừ −2 rồi +3, sổ còn 4", async () => {
    const n = await dongVang();
    await capTay(n.id, 3);
    const goc = await dongGoc();
    await suaLuotQlcs(ADMIN, { entryId: goc.id, soMoi: 1, lyDo: LY_DO, maLan: ma(), ten: "x" });
    const kq = await suaLuotQlcs(ADMIN, { entryId: goc.id, soMoi: 4, lyDo: LY_DO, maLan: ma(), ten: "x" });
    expect(kq.thayDoi).toBe(3);
    expect((await tk())!.granted).toBe(4);
    expect((await lichSu()).find((d) => d.id === goc.id)!.hieuLuc).toBe(4);
  });

  it("[LSD-03] CHỐNG BẤM ĐÚP: cùng mã lần sửa ⇒ lần hai không ghi gì (sổ, bút toán, nhật ký đều không đổi)", async () => {
    const n = await dongVang();
    await capTay(n.id, 3);
    const goc = await dongGoc();
    const m = ma();
    expect((await suaLuotQlcs(ADMIN, { entryId: goc.id, soMoi: 1, lyDo: LY_DO, maLan: m, ten: "x" })).daDoi).toBe(true);
    expect((await suaLuotQlcs(ADMIN, { entryId: goc.id, soMoi: 1, lyDo: LY_DO, maLan: m, ten: "x" })).daDoi).toBe(false);
    expect((await tk())!.granted).toBe(1);
    expect(await db.auditLog.count({ where: { action: "hoc-bu.sua-luot-qlcs", entityId: goc.id } })).toBe(1);
  });

  it("[LSD-04] GIẢM QUÁ PHẦN TRỐNG bị từ chối và HOÀN TÁC hết: lượt đang giữ chỗ không rút lại được — sổ không đổi, không bút toán, không nhật ký", async () => {
    const n = await dongVang();
    await capTay(n.id, 3);
    await db.makeupCreditAccount.update({ where: { studentId_courseId: { studentId: HV, courseId: KHOA } }, data: { held: 2 } }); // 2 lượt đang giữ chỗ trong case
    const goc = await dongGoc();
    const truoc = await tk();
    const loi = await bat(suaLuotQlcs(ADMIN, { entryId: goc.id, soMoi: 0, lyDo: LY_DO, maLan: ma(), ten: "x" })); // muốn rút 3, chỉ còn 1 trống
    expect(loi).toBeInstanceOf(LoiHocBu);
    expect((loi as Error).message).toMatch(/Chỉ rút được 1\/3/);
    const sau = await tk();
    expect(sau!.granted).toBe(truoc!.granted);
    expect(sau!.entries).toHaveLength(truoc!.entries.length);
    expect(await db.auditLog.count({ where: { action: "hoc-bu.sua-luot-qlcs", entityId: goc.id } })).toBe(0);
  });

  it("[LSD-05] đầu vào sai bị chặn: trùng số cũ · lý do ngắn · chênh quá 12 · không phải bút toán QLCS ⇒ LoiHocBu, sổ không đổi", async () => {
    const n = await dongVang();
    await capTay(n.id, 3);
    const goc = await dongGoc();
    for (const over of [{ soMoi: 3 }, { lyDo: "ngắn" }, { soMoi: 40 }]) {
      expect(await bat(suaLuotQlcs(ADMIN, { entryId: goc.id, soMoi: 1, lyDo: LY_DO, maLan: ma(), ten: "x", ...over })), JSON.stringify(over)).toBeInstanceOf(LoiHocBu);
    }
    // bút toán bù trừ KHÔNG sửa trực tiếp được
    await suaLuotQlcs(ADMIN, { entryId: goc.id, soMoi: 1, lyDo: LY_DO, maLan: ma(), ten: "x" });
    const buTru = (await tk())!.entries.find((e) => e.idemKey?.includes(":sua:"))!;
    expect(await bat(suaLuotQlcs(ADMIN, { entryId: buTru.id, soMoi: 0, lyDo: LY_DO, maLan: ma(), ten: "x" }))).toBeInstanceOf(LoiHocBu);
    expect((await tk())!.granted).toBe(1);
  });

  it("[LSD-06] PHẠM VI CƠ SỞ: QLCS cơ sở khác không THẤY dòng trong lịch sử và không SỬA được (như không tồn tại); đối chứng dương — người thấy cơ sở thì cả hai đều được", async () => {
    const n = await dongVang();
    await capTay(n.id, 3);
    const goc = await dongGoc();
    expect(await lichSu(QL_CO_SO_KHAC)).toHaveLength(0);
    const loi = await bat(suaLuotQlcs(QL_CO_SO_KHAC, { entryId: goc.id, soMoi: 1, lyDo: LY_DO, maLan: ma(), ten: "x" }));
    expect(loi).toBeInstanceOf(LoiHocBu);
    expect((loi as Error).message).toContain("Không tìm thấy");
    expect((await tk())!.granted).toBe(3);
    expect(await lichSu(ADMIN)).toHaveLength(1);
    expect((await suaLuotQlcs(ADMIN, { entryId: goc.id, soMoi: 1, lyDo: LY_DO, maLan: ma(), ten: "x" })).daDoi).toBe(true);
  });

  it("[LSD-07] HỌC VƯỢT: dòng 'Duyệt học vượt' hiện số Sale xin + số hiệu lực; sửa 3 → 2 trừ ĐÚNG 1 lượt VÀ đổi `makeupSessions` của yêu cầu cùng giao dịch; nhật ký ghi lý do", async () => {
    await yeuCauDaDuyet(3);
    const [d0] = await lichSu();
    expect(d0).toMatchObject({ nhom: "HOC_VUOT_DUYET", delta: 3, hieuLuc: 3, suaDuoc: true });
    expect(d0!.yeuCau).toMatchObject({ phaiBu: 4, xin: 3, trangThai: "APPROVED", buoiBatDau: 5 });
    const kq = await suaLuotHocVuot(ADMIN, { requestId: YC, bMoi: 2, lyDo: "Phụ huynh chỉ đồng ý bù 2 buổi", maLan: ma(), ten: "x" });
    expect(kq).toEqual({ daDoi: true, thayDoi: -1 });
    expect((await tk())!.granted).toBe(2);
    expect((await db.enrollmentCatchUpRequest.findUniqueOrThrow({ where: { id: YC } })).makeupSessions).toBe(2);
    const ds = await lichSu();
    expect(ds.find((d) => d.nhom === "HOC_VUOT_SUA")).toMatchObject({ delta: -1, suaDuoc: false });
    expect(ds.find((d) => d.nhom === "HOC_VUOT_DUYET")).toMatchObject({ delta: 3, hieuLuc: 2 });
    expect(await db.auditLog.count({ where: { action: "hoc-bu.sua-luot-hoc-vuot", entityId: YC } })).toBe(1);
  });

  it("[LSD-08] HỌC VƯỢT sửa sai bị chặn: ngoài 1..số buổi phải bù · trùng số cũ · lý do ngắn · yêu cầu không còn APPROVED · cơ sở khác ⇒ LoiHocBu, sổ + yêu cầu không đổi", async () => {
    await yeuCauDaDuyet(3);
    for (const over of [{ bMoi: 0 }, { bMoi: 5 }, { bMoi: 3 }, { lyDo: "ngắn" }]) {
      expect(await bat(suaLuotHocVuot(ADMIN, { requestId: YC, bMoi: 2, lyDo: LY_DO, maLan: ma(), ten: "x", ...over })), JSON.stringify(over)).toBeInstanceOf(LoiHocBu);
    }
    expect(await bat(suaLuotHocVuot(QL_CO_SO_KHAC, { requestId: YC, bMoi: 2, lyDo: LY_DO, maLan: ma(), ten: "x" }))).toBeInstanceOf(LoiHocBu);
    expect((await tk())!.granted).toBe(3);
    expect((await db.enrollmentCatchUpRequest.findUniqueOrThrow({ where: { id: YC } })).makeupSessions).toBe(3);
    // yêu cầu đã bị huỷ (đổi buổi bắt đầu) ⇒ không còn số để sửa; lịch sử cũng không bày nút Sửa
    await db.enrollmentCatchUpRequest.update({ where: { id: YC }, data: { status: "CANCELLED" } });
    expect(await bat(suaLuotHocVuot(ADMIN, { requestId: YC, bMoi: 2, lyDo: LY_DO, maLan: ma(), ten: "x" }))).toBeInstanceOf(LoiHocBu);
    expect((await lichSu()).find((d) => d.nhom === "HOC_VUOT_DUYET")!.suaDuoc).toBe(false);
  });
});
