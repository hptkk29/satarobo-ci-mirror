// tests/hoc-bu/yeu-cau-them-be.test.ts — [YCB] 24/10/2026: THÊM HỌC VIÊN KHÁC VÀO CASE CÓ SẴN PHẢI QUA QUẢN LÝ CƠ SỞ DUYỆT. Postgres THẬT.
//
// Chủ dự án: "mỗi lần thêm học viên khác vào case có sẵn cũng phải qua qlcs duyệt".
// Người gọi là Sale / quản lý cơ sở THẬT (không phải ADMIN siêu quản trị): `coQuyenDuyet` và phạm vi cơ sở là thứ bộ này canh — test dùng ADMIN cho mọi việc thì mọi cổng đều "đúng".
// Luật: case KHÔNG đổi một chữ khi gửi / từ chối / rút; chỉ khi DUYỆT mới chạy đúng đường xếp bé hiện có (kiểm lại luật ở thời điểm duyệt).
//
// Chạy:  pnpm test:hoc-bu-db      (`pnpm test:unit` trần sẽ SKIP — thiếu ALLOW_DB_RESET)
// Fixture: A vắng 5,6,7 · B vắng 6,7 · C vắng 7 · D vắng 8 (`_case-nhieu-bai-fixture.ts`). Case nền = QLCS tạo với A6 (bộ bài [6]).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import type { PermEntry } from "@/lib/auth/actor";
import { nguoiHocBu, type NguoiHocBu } from "@/lib/hoc-bu/pham-vi";
import { duyetYeuCauThemBe, goBeKhoiCase, huyCase, taoCaseVaXep, xepVaoCaseCoSan } from "@/lib/hoc-bu/case-db";
import { docLoChoDuyetThem, rutYeuCauThemBe, tuChoiYeuCauThemBe } from "@/lib/hoc-bu/yeu-cau-them-be-db";
import { docDanhSachCanBu, docDongTheoId } from "@/lib/hoc-bu/danh-sach-db";
import { LY_DO_DANG_CHO_DUYET_THEM } from "@/lib/hoc-bu/yeu-cau-them-be-thuan";
import { scopedDb } from "@/lib/db-scope";
import { dispatchPendingEvents } from "@/lib/events/dispatcher";
import { ensureHandlersRegistered } from "@/lib/events/register";
import { ADMIN, BAI, CS, HV, KHUNG, QL, SALE, beCua, don, dung, id, lyDoLoi, need, needId, sach, so } from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[YCB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const CS_KHAC = id("cs-khac");

const SALE_ACT = nguoiHocBu({ ...ADMIN, userId: SALE }, SALE);

const perm = (action: string, cs: string[]): PermEntry => ({ action, scopeType: "GLOBAL", orgUnitId: "org-test", roleCode: "CENTER_MANAGER", centerScope: cs });
const QUYEN_QLCS = [
  "makeup:view", "makeup:view-all", "makeup:manage", "makeup:waive",
  "classes:view-all", "sessions:view", "rooms:view", "students:view-all", "enrollments:view-all", "hr_attendance:view",
];
/** Quản lý cơ sở THẬT — chỉ thấy các cơ sở trong `cs` (không phải siêu quản trị, không HO). */
const qlcs = (cs: string[]) =>
  ({
    userId: QL,
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: QUYEN_QLCS.map((a) => perm(a, cs)),
    visibleCenterIds: cs,
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
    chiCuaSale: null,
  }) as unknown as NguoiHocBu;
const QL_CS = qlcs([CS]);
const QL_KHAC = qlcs([CS_KHAC]);

/** Case nền: QLCS tạo (lịch thật ngay) với A6 ⇒ bộ bài [6], bé A. */
const taoCaseNen = () => taoCaseVaXep(QL_CS, { ...KHUNG, needIds: [needId("A", 6)], coQuyenDuyet: true });
/** Sale xin thêm (không có quyền duyệt). */
const saleThem = (caseId: string, needIds: string[], moRongBai = false) => xepVaoCaseCoSan(SALE_ACT, { caseId, needIds, moRongBai, coQuyenDuyet: false });
const qlThem = (caseId: string, needIds: string[], moRongBai = false) => xepVaoCaseCoSan(QL_CS, { caseId, needIds, moRongBai, coQuyenDuyet: true });

const dongCase = (caseId: string) => db.makeupCase.findUniqueOrThrow({ where: { id: caseId } });
const soBe = (caseId: string) => db.makeupCaseParticipant.count({ where: { caseId, attendanceStatus: { not: "REMOVED" } } });
const baiCua = async (caseId: string) => (await db.makeupCaseLesson.findMany({ where: { caseId }, orderBy: { order: "asc" } })).map((l) => l.lessonId);
const yeuCau = (where: Record<string, unknown> = {}) => db.makeupCaseAddRequest.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const suKien = (loai: string) => db.domainEvent.count({ where: { type: loai } });
const nhatKy = (entityId: string, action: string) => db.auditLog.findFirst({ where: { entityId, action } });
const loDauTien = async () => (await yeuCau({ status: "PENDING" }))[0]!.batchId;

const chay = async () => {
  ensureHandlersRegistered();
  await dispatchPendingEvents({ flagOn: true, batchSize: 500 });
  await dispatchPendingEvents({ flagOn: true, batchSize: 500 });
};
const tinNS = (userId: string, tienTo: string) => db.staffNotification.findMany({ where: { userId, dedupeKey: { startsWith: tienTo } }, orderBy: { dedupeKey: "asc" } });

async function dungYc() {
  await dung();
  await db.user.create({ data: { id: SALE, name: "Sale xin thêm", email: `${SALE}@test.local`, role: "SALES_CSM", roles: ["SALES_CSM"], centerId: CS } });
  await db.user.create({ data: { id: QL, name: "QLCS duyệt", email: `${QL}@test.local`, role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], centerId: CS } });
  await db.enrollment.updateMany({ where: { studentId: { in: [HV.A, HV.B, HV.C] } }, data: { saleId: SALE } });
}

describe.skipIf(!RUN_DB_TESTS)("[YCB] thêm học viên khác vào case có sẵn — Sale xin, quản lý cơ sở duyệt", () => {
  beforeEach(dungYc);
  afterAll(don);

  it("[YCB-01] Sale thêm bé MỚI (B6) vào case có sẵn ⇒ CHỜ DUYỆT: case KHÔNG đổi (bé, bộ bài, version), dòng B6 vẫn chờ bù, lượt KHÔNG bị giữ, chỉ có 1 yêu cầu PENDING + 1 nhật ký + 1 sự kiện báo QLCS", async () => {
    const c = await taoCaseNen();
    const truoc = await dongCase(c);
    const suKienXepTruoc = await suKien("makeup.case.scheduled");
    const kq = await saleThem(c, [needId("B", 6)]);
    expect(kq).toEqual({ choDuyet: true });
    expect(await soBe(c)).toBe(1);
    expect(await baiCua(c)).toEqual([BAI[6]]);
    expect((await dongCase(c)).version).toBe(truoc.version);
    expect((await need("B", 6)).status).toBe("PENDING");
    expect(await so("B")).toEqual({ granted: 3, held: 0, consumed: 0, con: 3 });
    expect(await suKien("makeup.case.scheduled")).toBe(suKienXepTruoc); // phụ huynh / giáo viên CHƯA được báo
    const rows = await yeuCau();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "PENDING", caseId: c, makeupNeedId: needId("B", 6), studentId: HV.B, centerId: CS, proposedById: SALE, moRongBai: false, decidedById: null });
    expect(await suKien("makeup.case.add-request")).toBe(1);
    expect(await nhatKy(rows[0]!.batchId, "hoc-bu.gui-yeu-cau-them-be")).toMatchObject({ entityType: "MakeupCaseAddRequest" });
    await sach();
  });

  it("[YCB-02] ĐỐI CHỨNG DƯƠNG: quản lý cơ sở (có quyền duyệt) thêm đúng bé đó ⇒ vào case NGAY, không có yêu cầu nào (nếu cổng hỏng, YCB-01 xanh vì lý do sai)", async () => {
    const c = await taoCaseNen();
    expect(await qlThem(c, [needId("B", 6)])).toEqual({ choDuyet: false });
    expect(await soBe(c)).toBe(2);
    expect((await need("B", 6)).status).toBe("SCHEDULED");
    expect(await so("B")).toEqual({ granted: 3, held: 1, consumed: 0, con: 2 });
    expect(await yeuCau()).toHaveLength(0);
    expect(await suKien("makeup.case.add-request")).toBe(0);
  });

  it("[YCB-03] Sale thêm buổi vắng KHÁC cho bé ĐÃ trong case (A7, kèm bài 7) ⇒ thêm NGAY — đó không phải 'học viên khác'", async () => {
    const c = await taoCaseNen();
    expect(await saleThem(c, [needId("A", 7)], true)).toEqual({ choDuyet: false });
    expect(await baiCua(c)).toEqual([BAI[6], BAI[7]]);
    expect(await yeuCau()).toHaveLength(0);
    expect((await need("A", 7)).status).toBe("SCHEDULED");
  });

  it("[YCB-04] dòng đang có yêu cầu bị KHOÁ ở mọi cửa: danh sách cần bù, cổng xếp (Sale gửi lần hai · QLCS xếp thẳng), và DB (chỉ mục từng phần chặn dòng thứ hai)", async () => {
    const c = await taoCaseNen();
    await saleThem(c, [needId("B", 6)]);
    const [d] = await docDongTheoId(scopedDb(QL_CS), [needId("B", 6)], null);
    expect(d).toMatchObject({ yeuCauThemMo: true, xep: { ok: false, lyDo: LY_DO_DANG_CHO_DUYET_THEM } });
    const bang = (await docDanhSachCanBu(scopedDb(QL_CS), { trang: 1, soDong: 50, chiCuaSale: null })).dong.find((x) => x.id === needId("B", 6));
    expect(bang).toMatchObject({ yeuCauThemMo: true, xep: { ok: false } });
    expect(await lyDoLoi(saleThem(c, [needId("B", 6)]))).toContain("chờ quản lý cơ sở duyệt");
    expect(await lyDoLoi(qlThem(c, [needId("B", 6)]))).toContain("chờ quản lý cơ sở duyệt");
    await expect(
      db.makeupCaseAddRequest.create({
        data: { batchId: "b-trung", caseId: c, makeupNeedId: needId("B", 6), studentId: HV.B, centerId: CS, proposedById: SALE, proposedAt: new Date() },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(await yeuCau()).toHaveLength(1);
  });

  it("[YCB-05] DUYỆT: bé vào case qua đúng đường xếp (dòng SCHEDULED, lượt bị giữ, phụ huynh + giáo viên được báo), yêu cầu APPROVED có người duyệt, Sale được báo; duyệt lần hai bị từ chối", async () => {
    const c = await taoCaseNen();
    await saleThem(c, [needId("B", 6)]);
    const batchId = await loDauTien();
    // Tin báo QLCS được xử lý khi yêu cầu CÒN chờ (handler đọc lại: đã duyệt / từ chối / rút thì không còn gì để nhắc).
    await chay();
    expect((await tinNS(QL, "makeup.case.add-request:")).length).toBe(1);
    await duyetYeuCauThemBe(QL_CS, { batchId, ten: "QLCS" });
    expect(await soBe(c)).toBe(2);
    expect((await beCua(c, "B")).attendanceStatus).toBe("PENDING");
    expect((await need("B", 6)).status).toBe("SCHEDULED");
    expect(await so("B")).toEqual({ granted: 3, held: 1, consumed: 0, con: 2 });
    expect(await yeuCau()).toEqual([expect.objectContaining({ status: "APPROVED", decidedById: QL })]);
    expect((await yeuCau())[0]!.decidedAt).not.toBeNull();
    expect(await nhatKy(batchId, "hoc-bu.duyet-them-be")).toMatchObject({ entityType: "MakeupCaseAddRequest" });
    expect(await suKien("makeup.case.add-approved")).toBe(1);
    await chay();
    expect((await tinNS(SALE, "makeup.case.add-approved:")).length).toBe(1);
    expect(await lyDoLoi(duyetYeuCauThemBe(QL_CS, { batchId, ten: "QLCS" }))).toContain("không còn chờ duyệt");
    await sach();
  });

  it("[YCB-06] TỪ CHỐI: bắt buộc lý do ≥ 10 ký tự; case KHÔNG đổi, dòng cần bù tự do trở lại (gửi lại được); Sale nhận tin kèm lý do", async () => {
    const c = await taoCaseNen();
    await saleThem(c, [needId("B", 6)]);
    const batchId = await loDauTien();
    expect(await lyDoLoi(tuChoiYeuCauThemBe(QL_CS, { batchId, lyDo: "ngắn", ten: "QLCS" }))).toContain("ít nhất");
    expect((await yeuCau())[0]!.status).toBe("PENDING");
    await tuChoiYeuCauThemBe(QL_CS, { batchId, lyDo: "Case đã đủ người rồi", ten: "QLCS" });
    expect(await soBe(c)).toBe(1);
    expect((await yeuCau())[0]).toMatchObject({ status: "REJECTED", decidedById: QL, decisionReason: "Case đã đủ người rồi" });
    expect((await need("B", 6)).status).toBe("PENDING");
    const [d] = await docDongTheoId(scopedDb(QL_CS), [needId("B", 6)], null);
    expect(d).toMatchObject({ yeuCauThemMo: false, xep: { ok: true } });
    await chay();
    const tin = await tinNS(SALE, "makeup.case.add-rejected:");
    expect(tin).toHaveLength(1);
    expect(tin[0]!.body).toContain("Case đã đủ người rồi");
    expect(await saleThem(c, [needId("B", 6)])).toEqual({ choDuyet: true }); // gửi lại được
    expect(await yeuCau({ status: "PENDING" })).toHaveLength(1);
  });

  it("[YCB-07] RÚT: chỉ người đã gửi rút được; rút xong dòng tự do trở lại, không báo ai", async () => {
    const c = await taoCaseNen();
    await saleThem(c, [needId("B", 6)]);
    const batchId = await loDauTien();
    expect(await lyDoLoi(rutYeuCauThemBe(QL_CS, { batchId, ten: "QLCS" }))).toContain("Chỉ người đã gửi");
    expect((await yeuCau())[0]!.status).toBe("PENDING");
    await rutYeuCauThemBe(SALE_ACT, { batchId, ten: "Sale" });
    expect((await yeuCau())[0]).toMatchObject({ status: "CANCELLED", decidedById: SALE });
    expect(await nhatKy(batchId, "hoc-bu.rut-them-be")).not.toBeNull();
    expect((await docDongTheoId(scopedDb(QL_CS), [needId("B", 6)], null))[0]!.xep.ok).toBe(true);
    expect(await suKien("makeup.case.add-rejected")).toBe(0);
  });

  it("[YCB-08] DUYỆT KIỂM LẠI luật ở thời điểm duyệt: dòng vừa bị huỷ không bù ⇒ duyệt từ chối, lô GIỮ NGUYÊN chờ duyệt, case không đổi", async () => {
    const c = await taoCaseNen();
    await saleThem(c, [needId("B", 6)]);
    const batchId = await loDauTien();
    await db.makeupNeed.update({ where: { id: needId("B", 6) }, data: { waivedAt: new Date(), waivedReason: "phụ huynh báo không cần" } });
    expect(await lyDoLoi(duyetYeuCauThemBe(QL_CS, { batchId, ten: "QLCS" }))).toContain("đã được xếp/huỷ");
    expect(await yeuCau()).toEqual([expect.objectContaining({ status: "PENDING", decidedById: null })]);
    expect(await soBe(c)).toBe(1);
  });

  it("[YCB-09] HUỶ case ⇒ yêu cầu đang chờ của nó đóng cùng giao dịch (CANCELLED, lý do 'Case đã huỷ'), dòng cần bù tự do", async () => {
    const c = await taoCaseNen();
    await saleThem(c, [needId("B", 6)]);
    const batchId = await loDauTien();
    await huyCase(QL_CS, c);
    expect((await yeuCau())[0]).toMatchObject({ status: "CANCELLED", decisionReason: "Case đã huỷ", decidedById: QL });
    expect(await nhatKy(batchId, "hoc-bu.huy-yeu-cau-them-be")).not.toBeNull();
    expect((await need("B", 6)).status).toBe("PENDING");
    expect((await docDongTheoId(scopedDb(QL_CS), [needId("B", 6)], null))[0]!.xep.ok).toBe(true);
  });

  it("[YCB-10] PHẠM VI: quản lý cơ sở KHÁC không thấy, không duyệt, không từ chối được lô của cơ sở này (lô vẫn chờ)", async () => {
    const c = await taoCaseNen();
    await saleThem(c, [needId("B", 6)]);
    const batchId = await loDauTien();
    expect(await docLoChoDuyetThem(scopedDb(QL_KHAC), {})).toEqual([]);
    expect(await docLoChoDuyetThem(scopedDb(QL_CS), {})).toHaveLength(1);
    expect(await lyDoLoi(duyetYeuCauThemBe(QL_KHAC, { batchId, ten: "QL khác" }))).toContain("không còn chờ duyệt");
    expect(await lyDoLoi(tuChoiYeuCauThemBe(QL_KHAC, { batchId, lyDo: "không phải việc của tôi", ten: "QL khác" }))).toContain("không còn chờ duyệt");
    expect((await yeuCau())[0]!.status).toBe("PENDING");
  });

  it("[YCB-11] bé đã bị GỠ khỏi case rồi thêm lại là thêm học viên ⇒ phải qua duyệt (không lách bằng đường kích hoạt lại)", async () => {
    const c = await taoCaseNen();
    await qlThem(c, [needId("B", 6)]);
    await goBeKhoiCase(QL_CS, (await beCua(c, "B")).id);
    expect((await beCua(c, "B")).attendanceStatus).toBe("REMOVED");
    expect(await saleThem(c, [needId("B", 6)])).toEqual({ choDuyet: true });
    expect((await beCua(c, "B")).attendanceStatus).toBe("REMOVED"); // chưa kích hoạt lại
    await duyetYeuCauThemBe(QL_CS, { batchId: await loDauTien(), ten: "QLCS" });
    expect((await beCua(c, "B")).attendanceStatus).toBe("PENDING");
  });

  it("[YCB-12] 'thêm bài' đi theo yêu cầu: bộ bài của case KHÔNG đổi lúc xin; chỉ nới lúc DUYỆT (version tăng)", async () => {
    const c = await taoCaseNen();
    const v0 = (await dongCase(c)).version;
    expect(await saleThem(c, [needId("C", 7)], true)).toEqual({ choDuyet: true });
    expect(await baiCua(c)).toEqual([BAI[6]]);
    expect((await dongCase(c)).version).toBe(v0);
    expect((await yeuCau())[0]!.moRongBai).toBe(true);
    await duyetYeuCauThemBe(QL_CS, { batchId: await loDauTien(), ten: "QLCS" });
    expect(await baiCua(c)).toEqual([BAI[6], BAI[7]]);
    expect((await dongCase(c)).version).toBe(v0 + 1);
    expect(await soBe(c)).toBe(2);
    await sach();
  });

  it("[YCB-13] hai lượt xin trên CÙNG một case là hai sự việc: QLCS nhận hai tin riêng (khoá thông báo theo lô, không theo case)", async () => {
    const c = await taoCaseNen();
    await saleThem(c, [needId("B", 6)]);
    await saleThem(c, [needId("C", 7)], true);
    expect(await suKien("makeup.case.add-request")).toBe(2);
    await chay();
    expect(await tinNS(QL, "makeup.case.add-request:")).toHaveLength(2);
    expect((await docLoChoDuyetThem(scopedDb(QL_CS), { caseId: c })).map((l) => l.hocVien.map((h) => h.ten).join(","))).toHaveLength(2);
  });

  it("[YCB-14] cả lô cùng một lần bấm: chỉ MỘT bé mới trong lô cũng kéo cả lô vào chờ duyệt (không tách đôi), và duyệt xếp đủ cả lô", async () => {
    const c = await taoCaseNen();
    // A (đã trong case) + B (mới) cùng một lần bấm; A7 cần kèm bài 7.
    expect(await saleThem(c, [needId("A", 7), needId("B", 7)], true)).toEqual({ choDuyet: true });
    expect(await yeuCau({ status: "PENDING" })).toHaveLength(2);
    expect(new Set((await yeuCau()).map((r) => r.batchId)).size).toBe(1);
    expect(await soBe(c)).toBe(1);
    expect((await need("A", 7)).status).toBe("PENDING");
    await duyetYeuCauThemBe(QL_CS, { batchId: await loDauTien(), ten: "QLCS" });
    expect(await soBe(c)).toBe(2);
    expect((await need("A", 7)).status).toBe("SCHEDULED");
    expect((await need("B", 7)).status).toBe("SCHEDULED");
  });

  it("[YCB-15] hai quản lý bấm Duyệt CÙNG LÚC: đúng MỘT lượt thành công; bé vào case một lần, lượt giữ một lần, yêu cầu APPROVED một lần (không thêm đôi, không giữ đôi)", async () => {
    const c = await taoCaseNen();
    await saleThem(c, [needId("B", 6)]);
    const batchId = await loDauTien();
    const kq = await Promise.allSettled([duyetYeuCauThemBe(QL_CS, { batchId, ten: "QL1" }), duyetYeuCauThemBe(QL_CS, { batchId, ten: "QL2" })]);
    expect(kq.filter((k) => k.status === "fulfilled")).toHaveLength(1);
    expect(kq.filter((k) => k.status === "rejected")).toHaveLength(1);
    expect(await soBe(c)).toBe(2);
    expect(await so("B")).toEqual({ granted: 3, held: 1, consumed: 0, con: 2 });
    expect(await yeuCau()).toEqual([expect.objectContaining({ status: "APPROVED" })]);
    await sach();
  });
});
