// tests/hoc-bu/phan-quyen-action.test.ts — NGHIỆM THU VAI trên SERVER ACTION THẬT (08/10/2026): AC35 "quyền được enforce ở máy chủ".
//
// Trước đây AC35 chỉ có lưới ghim mã nguồn (`[PVW-*]`, `[GDW-*]`: "action hỏi quyền ở đầu hàm") — chứng minh CÂU CHỮ, không chứng minh HÀNH VI.
// Ở đây gọi chính các action (admin + site giáo viên) với phiên của từng vai, trên Postgres thật, với quyền v2 ĐỌC TỪ DB như prod
// (`RBAC_V2_ENABLED=true`, vai nạp từ `RoleDef` bằng `seed-roles`, vị trí qua `UserOrgRole`). Mỗi ca "KHÔNG được" đi cùng một ca "vai kia ĐƯỢC"
// (CLAUDE.md #11: ca chỉ khẳng định sự vắng mặt luôn đạt khi tính năng hỏng hoàn toàn).
//
// Đồng hồ ĐÓNG BĂNG (luật 19): `Date` được đặt về giữa buổi dạy của fixture; timer thật vẫn chạy để Prisma không treo.
//
// Chạy:  pnpm test:hoc-bu-db  (cần `prisma/seed-roles.ts` đã chạy trên DB — CI đã làm ở bước trước).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
// `unstable_cache` bọc thẳng hàm (không bộ nhớ đệm) — vài module đọc cấu hình dùng nó; `revalidate*` là no-op.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...a: never[]) => unknown>(fn: T) => fn,
}));

import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import * as admin from "@/app/(admin)/admin/hoc-bu/_actions";
import * as gv from "@/app/(teacher)/teacher/hoc-bu/_actions";
import { docChiTietCaseV2, docChiTietCaseV2ChoGv } from "@/lib/hoc-bu/case-chi-tiet";
import { getStudentMakeup } from "@/lib/portal/makeup";
import { CS, GV, GV2, HV, NOW, QL, SALE, beCua, don, dung, id, needId, tao, tatCa, PHONG } from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[PQA] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const GVU = id("gvu"); // giáo vụ = CENTER_CLASS_MANAGER
const PH = id("ph-pq");
const QL2 = id("ql2"); // quản lý của cơ sở KHÁC
const CS2 = id("cs2");
const DV1 = "FX-T07-OU1";
const DV2 = "FX-T07-OU2";
const NGUOI = [GVU, PH, QL2];
const VAI: Record<string, string> = {};

const KHUNG = { ymd: "2026-10-15", startTime: "18:00", endTime: "19:30", roomId: PHONG, teacherId: GV, note: null };

type Role = "CENTER_MANAGER" | "SALES_CSM" | "TEACHER" | "PARENT";
const dangNhap = (userId: string | null, role: Role = "CENTER_MANAGER") =>
  vi.mocked(auth).mockResolvedValue((userId ? { user: { id: userId, name: "Người thử", email: `${userId}@test.local`, role, roles: [role] } } : null) as never);

async function lamSach() {
  await db.userOrgRole.deleteMany({ where: { userId: { in: [...NGUOI, QL, SALE, GV, GV2] } } });
  await db.user.deleteMany({ where: { id: { in: NGUOI } } });
  await db.orgUnit.deleteMany({ where: { code: { in: [DV1, DV2] } } });
  await db.center.deleteMany({ where: { id: CS2 } });
}

async function dungVai() {
  await db.center.create({ data: { id: CS2, name: "Cơ sở T07 hai", slug: `${id("cs2")}-s`, address: "x" } });
  const [ou1, ou2] = await Promise.all([
    db.orgUnit.create({ data: { type: "CENTER", code: DV1, name: "Đơn vị T07", path: "/fx-t07-ou1/", depth: 0, centerId: CS }, select: { id: true } }),
    db.orgUnit.create({ data: { type: "CENTER", code: DV2, name: "Đơn vị T07 hai", path: "/fx-t07-ou2/", depth: 0, centerId: CS2 }, select: { id: true } }),
  ]);
  const roleDef = new Map((await db.roleDef.findMany({ select: { id: true, code: true } })).map((r) => [r.code, r.id]));
  for (const ma of ["CENTER_MANAGER", "CENTER_CLASS_MANAGER", "CENTER_SALES_CSM", "TEACHER", "PARENT"]) {
    if (!roleDef.get(ma)) throw new Error(`Thiếu RoleDef ${ma} — chạy prisma/seed-roles.ts trên DB test trước`);
    VAI[ma] = roleDef.get(ma)!;
  }
  const mk = (uid: string, ten: string, role: "CENTER_MANAGER" | "TEACHER" | "PARENT") =>
    db.user.create({ data: { id: uid, name: ten, email: `${uid}@test.local`, role, roles: [role], centerId: role === "PARENT" ? null : uid === QL2 ? CS2 : CS, isActive: true } });
  await mk(QL, "QL T07", "CENTER_MANAGER");
  await mk(SALE, "Sale T07", "CENTER_MANAGER").then(() => db.user.update({ where: { id: SALE }, data: { role: "SALES_CSM", roles: ["SALES_CSM"] } }));
  await mk(GVU, "Giáo vụ T07", "CENTER_MANAGER").then(() => db.user.update({ where: { id: GVU }, data: { role: "CENTER_MANAGER" } }));
  await mk(QL2, "QL cơ sở khác", "CENTER_MANAGER");
  await mk(PH, "Phụ huynh T07", "PARENT");
  const gan = (userId: string, orgUnitId: string, ma: string) => db.userOrgRole.create({ data: { userId, orgUnitId, roleId: VAI[ma]!, grantedById: QL } });
  await gan(QL, ou1.id, "CENTER_MANAGER");
  await gan(GVU, ou1.id, "CENTER_CLASS_MANAGER");
  await gan(SALE, ou1.id, "CENTER_SALES_CSM");
  await gan(GV, ou1.id, "TEACHER");
  await gan(GV2, ou1.id, "TEACHER");
  await gan(QL2, ou2.id, "CENTER_MANAGER");
  // Sale chỉ sở hữu A, B (qua ghi danh); C, D thuộc người khác.
  await db.enrollment.updateMany({ where: { studentId: { in: [HV.A, HV.B] } }, data: { saleId: SALE } });
  await db.student.updateMany({ where: { id: HV.A }, data: { parentUserId: PH } });
}

const loi = (r: { ok: boolean }) => (r.ok ? null : (r as unknown as { error: string }).error);

describe.skipIf(!RUN_DB_TESTS)("[PQA] phân quyền học bù trên server action thật (RBAC v2 từ DB)", () => {
  beforeAll(() => {
    process.env.RBAC_V2_ENABLED = "true";
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterAll(async () => {
    vi.useRealTimers();
    delete process.env.RBAC_V2_ENABLED;
    await lamSach();
    await don();
  });
  beforeEach(async () => {
    vi.setSystemTime(NOW);
    await lamSach();
    await dung();
    await dungVai();
  });
  afterEach(() => {
    vi.mocked(auth).mockReset();
  });

  it("[PQA-01] SALE: thấy / xếp đúng bé CỦA MÌNH; bé của người khác như không tồn tại; không điểm danh, không huỷ, không miễn phí", async () => {
    dangNhap(SALE, "SALES_CSM");
    // Đối chứng dương: bé của mình.
    expect((await admin.layLuaChonCaseAction([needId("A", 5)])).ok).toBe(true);
    expect((await admin.layBienLaiLuotAction(needId("A", 5))).ok).toBe(true);
    // Bé NGOÀI phạm vi: như không có dòng ấy.
    expect(loi(await admin.layLuaChonCaseAction([needId("C", 7)]))).toMatch(/đã được xếp|huỷ|tải lại/i);
    expect(loi(await admin.layBienLaiLuotAction(needId("C", 7)))).toMatch(/Không tìm thấy/);
    expect((await admin.taoCaseAction({ ...KHUNG, needIds: [needId("C", 7)], teacherId: GV })).ok).toBe(false);
    // Bé của mình xếp được (đối chứng dương cho `taoCaseAction`).
    const taoA = await admin.taoCaseAction({ ...KHUNG, needIds: tatCa("A") });
    expect(taoA.ok).toBe(true);
    // Sale không có `makeup:attend` / `makeup:waive`.
    const caseId = taoA.ok ? taoA.caseId : "";
    const be = await beCua(caseId, "A");
    expect(loi(await admin.diemDanhBeAction({ caseId, participantId: be.id, coMat: false, ketQuaMuc: {}, nhanXetChung: null }))).toMatch(/quản lý|giáo viên|quyền/i);
    expect(loi(await admin.huyBuoiCanBuAction({ id: needId("B", 6), lyDo: "Phụ huynh xin nghỉ hẳn buổi này" }))).toMatch(/Quản lý cơ sở|Admin|quyền/i);
    expect(loi(await admin.mienPhiBuAction({ needId: needId("B", 6), lyDo: "Miễn phí ngoại lệ do chủ dự án" }))).toMatch(/Quản lý cơ sở|Admin|quyền/i);
  });

  it("[PQA-02] QUẢN LÝ cơ sở (đối chứng dương của PQA-01): xếp được bé BẤT KỲ của cơ sở, điểm danh được, huỷ được", async () => {
    dangNhap(QL);
    expect((await admin.layLuaChonCaseAction([needId("C", 7)])).ok).toBe(true);
    const tao1 = await admin.taoCaseAction({ ...KHUNG, needIds: [needId("C", 7)] });
    expect(tao1.ok).toBe(true);
    const caseId = tao1.ok ? tao1.caseId : "";
    const be = await beCua(caseId, "C");
    expect((await admin.diemDanhBeAction({ caseId, participantId: be.id, coMat: false, ketQuaMuc: {}, nhanXetChung: null })).ok).toBe(true);
    expect((await admin.huyBuoiCanBuAction({ id: needId("D", 8), lyDo: "Phụ huynh xin nghỉ hẳn buổi này" })).ok).toBe(true);
  });

  it("[PQA-03] GIÁO VỤ (CENTER_CLASS_MANAGER): xếp + điểm danh được, nhưng KHÔNG huỷ / miễn phí (quyền `makeup:waive` chỉ của Quản lý cơ sở)", async () => {
    dangNhap(GVU, "CENTER_MANAGER");
    const t = await admin.taoCaseAction({ ...KHUNG, needIds: [needId("C", 7)] });
    expect(t.ok).toBe(true);
    const caseId = t.ok ? t.caseId : "";
    const be = await beCua(caseId, "C");
    expect((await admin.diemDanhBeAction({ caseId, participantId: be.id, coMat: false, ketQuaMuc: {}, nhanXetChung: null })).ok).toBe(true);
    expect(loi(await admin.huyBuoiCanBuAction({ id: needId("D", 8), lyDo: "Phụ huynh xin nghỉ hẳn buổi này" }))).toMatch(/Quản lý cơ sở|Admin|quyền/i);
    // Đối chứng dương: cùng việc, phiên Quản lý ⇒ được.
    dangNhap(QL);
    expect((await admin.huyBuoiCanBuAction({ id: needId("D", 8), lyDo: "Phụ huynh xin nghỉ hẳn buổi này" })).ok).toBe(true);
  });

  it("[PQA-04] GIÁO VIÊN: điểm danh case MÌNH dạy; case của giáo viên khác bị từ chối cả ở action site GV lẫn action admin; không xếp case", async () => {
    const caseId = await tao([needId("B", 6)]); // dạy bởi GV
    const be = await beCua(caseId, "B");
    const goi = (p: { caseId: string; participantId: string }) => ({ ...p, coMat: false, ketQuaMuc: {}, nhanXetChung: null });
    // Giáo viên KHÁC (không dạy case này).
    dangNhap(GV2, "TEACHER");
    expect(loi(await gv.diemDanhBeGvAction(goi({ caseId, participantId: be.id })))).toMatch(/giáo viên|dạy/i);
    expect(loi(await admin.diemDanhBeAction(goi({ caseId, participantId: be.id })))).toMatch(/giáo viên|dạy/i);
    expect(await docChiTietCaseV2ChoGv(GV2, caseId)).toBeNull();
    // Giáo viên không có quyền xếp case.
    expect((await admin.taoCaseAction({ ...KHUNG, needIds: [needId("C", 7)], teacherId: GV2, ymd: "2026-10-16" })).ok).toBe(false);
    // Đối chứng dương: ĐÚNG giáo viên của case.
    dangNhap(GV, "TEACHER");
    expect((await gv.diemDanhBeGvAction(goi({ caseId, participantId: be.id }))).ok).toBe(true);
  });

  it("[PQA-05] PHỤ HUYNH: không gọi được action nào của máy chủ học bù; vẫn ĐỌC được lịch / kết quả của CON MÌNH qua cổng", async () => {
    const caseId = await tao(tatCa("A"));
    const be = await beCua(caseId, "A");
    dangNhap(PH, "PARENT");
    expect(loi(await admin.layLuaChonCaseAction([needId("A", 5)]))).toBeTruthy();
    expect(loi(await admin.layBienLaiLuotAction(needId("A", 5)))).toBeTruthy();
    expect((await admin.taoCaseAction({ ...KHUNG, needIds: [needId("D", 8)] })).ok).toBe(false);
    expect((await admin.diemDanhBeAction({ caseId, participantId: be.id, coMat: false, ketQuaMuc: {}, nhanXetChung: null })).ok).toBe(false);
    expect((await gv.diemDanhBeGvAction({ caseId, participantId: be.id, coMat: false, ketQuaMuc: {}, nhanXetChung: null })).ok).toBe(false);
    // Đối chứng dương: dữ liệu cổng của con mình có lịch case.
    const cong = await getStudentMakeup(HV.A);
    const m5 = [...cong.needList, ...cong.history].find((m) => m.id === needId("A", 5));
    expect(m5?.ketQua.trangThai).toBe("DA_XEP");
    expect(m5?.ketQua.hienTai).toMatchObject({ ngay: "15/10/2026", gio: "18:00–19:30" });
  });

  it("[PQA-06] CHƯA ĐĂNG NHẬP: mọi action trả 'Chưa đăng nhập', không chạm dữ liệu", async () => {
    dangNhap(null);
    const caseId = await tao([needId("B", 6)]);
    const be = await beCua(caseId, "B");
    const dich = [
      await admin.layLuaChonCaseAction([needId("A", 5)]),
      await admin.taoCaseAction({ ...KHUNG, needIds: [needId("C", 7)] }),
      await admin.diemDanhBeAction({ caseId, participantId: be.id, coMat: false, ketQuaMuc: {}, nhanXetChung: null }),
      await gv.diemDanhBeGvAction({ caseId, participantId: be.id, coMat: false, ketQuaMuc: {}, nhanXetChung: null }),
    ];
    for (const r of dich) expect(loi(r)).toBe("Chưa đăng nhập");
    expect((await db.makeupCaseParticipant.findUniqueOrThrow({ where: { id: be.id } })).attendanceStatus).toBe("PENDING");
  });

  it("[PQA-07] KHÁC CƠ SỞ: quản lý cơ sở khác không thấy, không huỷ, không đọc sổ lượt của case / bé này (đối chứng dương: quản lý đúng cơ sở)", async () => {
    const caseId = await tao(tatCa("A"));
    dangNhap(QL2);
    expect((await admin.huyCaseAction(caseId)).ok).toBe(false);
    // Dòng cần bù còn CHỜ XẾP (B6) — dòng đã xếp vào case không còn trong danh sách nên không dùng làm bằng chứng.
    expect(loi(await admin.layBienLaiLuotAction(needId("B", 6)))).toMatch(/Không tìm thấy/);
    expect(await docChiTietCaseV2(scopedDb(await resolveActor(QL2)), { caseId, chiCuaSale: null })).toBeNull();
    expect((await db.makeupCase.findUniqueOrThrow({ where: { id: caseId } })).status).toBe("SCHEDULED");
    dangNhap(QL);
    expect((await docChiTietCaseV2(scopedDb(await resolveActor(QL)), { caseId, chiCuaSale: null }))?.id).toBe(caseId);
    expect((await admin.layBienLaiLuotAction(needId("B", 6))).ok).toBe(true);
  });
});

