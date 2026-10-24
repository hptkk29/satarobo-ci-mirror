// tests/hoc-bu/duyet-case.test.ts — [DC] 20/10/2026: CASE DO SALE TẠO Ở TRẠNG THÁI "CHỜ DUYỆT"; quản lý cơ sở duyệt thì MỚI thành lịch thật, giáo viên MỚI thấy. Postgres THẬT.
//
// Chủ dự án: "màn tổng quan các case bù được sale tạo ở trạng thái chờ duyệt, qlcs duyệt thì mới thành lịch thật, giáo viên mới thấy".
// Người gọi là Sale / quản lý cơ sở THẬT (không phải ADMIN siêu quản trị): `chiCuaSale` và phạm vi cơ sở là thứ bộ này canh — test dùng ADMIN cho mọi việc thì mọi cổng đều "đúng" vì ADMIN qua hết.
//
// Chạy:  pnpm test:hoc-bu-db      (`pnpm test:unit` trần sẽ SKIP — thiếu ALLOW_DB_RESET)
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import type { PermEntry } from "@/lib/auth/actor";
import { nguoiHocBu, type NguoiHocBu } from "@/lib/hoc-bu/pham-vi";
import { LoiTrungLich, duyetCase, huyCase, suaCase, taoCaseVaXep, xepVaoCaseCoSan } from "@/lib/hoc-bu/case-db";
import { caseCuaGiaoVien, danhSachCaseGv, docCaseChoDuyet } from "@/lib/hoc-bu/case-doc";
import { scopedDb } from "@/lib/db-scope";
import { docChiTietCaseV2ChoGv } from "@/lib/hoc-bu/case-chi-tiet";
import { docKetQuaBuoi } from "@/lib/hoc-bu/ket-qua-buoi-db";
import { dispatchPendingEvents } from "@/lib/events/dispatcher";
import { ensureHandlersRegistered } from "@/lib/events/register";
import { ADMIN, BAI, CS, GV, GV2, HV, KHUNG, LOP2, QL, SALE, beCua, buoiGoc, don, dung, diemDanh, id, lyDoLoi, luc, mucCua, need, needId, ngayDb, sach, so } from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[DC] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const CS_KHAC = id("cs-khac");

/** Sale thật: `chiCuaSale` = chính họ; học viên A, B do họ phụ trách (xem `dungDuyet`). */
// `userId` = SALE (ADMIN của fixture mang userId của GV): người tạo case là Sale thật, nên tin "được duyệt / bị từ chối" tìm tới ĐÚNG người đó.
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

/** Giờ XEM xét: sáng ngày 14/10 — trước giờ kết thúc của case 15/10 18:00–19:30. */
const SANG_14 = luc(14, 9, 0);

const taoChoDuyet = (needIds: string[], them: { teacherId?: string; roomId?: string | null } = {}) =>
  taoCaseVaXep(SALE_ACT, { ...KHUNG, needIds, ...them, coQuyenDuyet: false });
const trangThai = async (caseId: string) => (await db.makeupCase.findUniqueOrThrow({ where: { id: caseId } })).status;
const dongCase = (caseId: string) => db.makeupCase.findUniqueOrThrow({ where: { id: caseId } });
const suKien = (loai: string) => db.domainEvent.count({ where: { type: loai } });
const nhatKy = (caseId: string, action: string) => db.auditLog.findFirst({ where: { entityId: caseId, action } });

const chay = async () => {
  ensureHandlersRegistered();
  await dispatchPendingEvents({ flagOn: true, batchSize: 500 });
  await dispatchPendingEvents({ flagOn: true, batchSize: 500 });
};
const tinNS = (userId: string) =>
  db.staffNotification.findMany({ where: { userId, dedupeKey: { startsWith: "makeup." } }, orderBy: { dedupeKey: "asc" } });
const tinPH = (hv: keyof typeof HV) => db.notification.findMany({ where: { studentId: HV[hv], dedupeKey: { startsWith: "makeup." } }, orderBy: { dedupeKey: "asc" } });

async function dungDuyet() {
  await dung();
  await db.user.create({ data: { id: SALE, name: "Sale duyệt", email: `${SALE}@test.local`, role: "SALES_CSM", roles: ["SALES_CSM"], centerId: CS } });
  await db.user.create({ data: { id: QL, name: "QLCS duyệt", email: `${QL}@test.local`, role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], centerId: CS } });
  await db.enrollment.updateMany({ where: { studentId: { in: [HV.A, HV.B] } }, data: { saleId: SALE } });
}

describe.skipIf(!RUN_DB_TESTS)("[DC] case chờ duyệt — Sale tạo, quản lý cơ sở duyệt", () => {
  beforeEach(dungDuyet);
  afterAll(don);

  it("[DC-01] Sale tạo case ⇒ CHỜ DUYỆT: vẫn GIỮ CHỖ (bé trong case, dòng cần bù SCHEDULED, lượt bị giữ) nhưng KHÔNG phát tin nào cho phụ huynh / giáo viên; checker sạch", async () => {
    const c = await taoChoDuyet([needId("A", 5), needId("B", 6)]);
    expect(await trangThai(c)).toBe("PENDING_APPROVAL");
    expect(await dongCase(c)).toMatchObject({ approvedById: null, approvedAt: null, rejectReason: null });
    expect(await db.makeupCaseParticipant.count({ where: { caseId: c, attendanceStatus: "PENDING" } })).toBe(2);
    expect((await need("A", 5)).status).toBe("SCHEDULED");
    // Bộ bài 5+6 (A5 + B6): HB-GOP kéo luôn dòng A6 của chính A vào case ⇒ A giữ 2 lượt, B giữ 1.
    expect(await so("A")).toEqual({ granted: 3, held: 2, consumed: 0, con: 1 });
    expect(await so("B")).toEqual({ granted: 3, held: 1, consumed: 0, con: 2 });
    expect(await suKien("makeup.case.scheduled")).toBe(0);
    await sach();
  });

  it("[DC-02] đối chứng DƯƠNG: người có quyền duyệt tạo ⇒ lịch thật ngay và tin ĐƯỢC phát (nếu cổng tin hỏng thì DC-01 xanh vì lý do sai)", async () => {
    const c = await taoCaseVaXep(QL_CS, { ...KHUNG, needIds: [needId("C", 7)], coQuyenDuyet: true });
    expect(await trangThai(c)).toBe("SCHEDULED");
    expect(await suKien("makeup.case.scheduled")).toBe(1);
  });

  it("[DC-03] giáo viên CHƯA thấy: lịch GV, danh sách Học bù của GV, chi tiết GV, kết quả buổi (phụ huynh) — đều không có case chờ duyệt; duyệt xong thì thấy cả bốn", async () => {
    const c = await taoChoDuyet([needId("A", 5)]);
    const tu = ngayDb(1);
    const den = ngayDb(31);
    const homNay = ngayDb(14);
    expect((await caseCuaGiaoVien(GV, tu, den)).map((x) => x.id)).toEqual([]);
    const ds = await danhSachCaseGv(GV, homNay);
    expect([...ds.sapToi, ...ds.daDay].map((x) => x.id)).toEqual([]);
    expect(await docChiTietCaseV2ChoGv(GV, c)).toBeNull();
    const kqTruoc = (await docKetQuaBuoi(db, [{ sessionId: buoiGoc(5), studentId: HV.A }])).get(`${buoiGoc(5)}|${HV.A}`)!;
    // Người ngoài chưa được biết lịch: vẫn "chờ xếp" và KHÔNG có lần bù nào trong lịch sử.
    expect(kqTruoc.trangThai).toBe("CHO_XEP");
    expect(kqTruoc.lichSu).toEqual([]);
    expect(kqTruoc.hienTai).toBeNull();

    await duyetCase(QL_CS, { caseId: c, phienBan: (await dongCase(c)).version, ten: "QLCS", now: SANG_14 });
    expect((await caseCuaGiaoVien(GV, tu, den)).map((x) => x.id)).toEqual([c]);
    expect((await danhSachCaseGv(GV, homNay)).sapToi.map((x) => x.id)).toEqual([c]);
    expect((await docChiTietCaseV2ChoGv(GV, c))?.status).toBe("SCHEDULED");
    const kqSau = (await docKetQuaBuoi(db, [{ sessionId: buoiGoc(5), studentId: HV.A }])).get(`${buoiGoc(5)}|${HV.A}`)!;
    expect(kqSau.trangThai).toBe("DA_XEP");
    expect(kqSau.lichSu).toHaveLength(1);
  });

  it("[DC-04] case chờ duyệt vẫn GIỮ CHỖ: không tạo được case thứ hai trùng giáo viên cùng giờ (nếu không thì lúc duyệt hai case chồng nhau)", async () => {
    await taoChoDuyet([needId("A", 5)]);
    await expect(taoCaseVaXep(QL_CS, { ...KHUNG, needIds: [needId("C", 7)], roomId: null, coQuyenDuyet: true })).rejects.toBeInstanceOf(LoiTrungLich);
    expect(await db.makeupCase.count({ where: { centerId: CS } })).toBe(1);
  });

  it("[DC-05] DUYỆT: ⇒ SCHEDULED, ghi người duyệt + lúc duyệt, version tăng, phụ huynh từng bé + giáo viên được báo đúng MỘT lần, nhật ký `hoc-bu.duyet-case`; bé / lượt không đổi", async () => {
    const c = await taoChoDuyet([needId("A", 5), needId("B", 6)]);
    const v = (await dongCase(c)).version;
    await duyetCase(QL_CS, { caseId: c, phienBan: v, ten: "QLCS", now: SANG_14 });
    expect(await dongCase(c)).toMatchObject({ status: "SCHEDULED", approvedById: QL, version: v + 1, rejectReason: null });
    expect((await dongCase(c)).approvedAt?.getTime()).toBe(SANG_14.getTime());
    expect(await suKien("makeup.case.scheduled")).toBe(2); // mỗi bé một sự kiện (cùng cách một case thường được xếp)
    expect(await nhatKy(c, "hoc-bu.duyet-case")).toMatchObject({ entityType: "MakeupCase" });
    expect(await so("A")).toEqual({ granted: 3, held: 2, consumed: 0, con: 1 }); // A5 + A6 (HB-GOP) — duyệt không đổi lượt
    expect((await need("A", 5)).status).toBe("SCHEDULED");
    await sach();
  });

  it("[DC-06] duyệt có thể ĐỔI giáo viên + bỏ phòng NGAY LÚC DUYỆT; giáo viên mới có ca thì được, người không có ca phủ khung giờ thì từ chối và case vẫn chờ duyệt", async () => {
    const c = await taoChoDuyet([needId("A", 5)]);
    const v = (await dongCase(c)).version;
    await db.shiftAssignment.deleteMany({ where: { userId: GV2, workDate: ngayDb(15) } });
    expect(await lyDoLoi(duyetCase(QL_CS, { caseId: c, phienBan: v, teacherId: GV2, ten: "QLCS", now: SANG_14 }))).toContain("không có ca làm");
    expect(await dongCase(c)).toMatchObject({ status: "PENDING_APPROVAL", teacherId: GV, version: v });
    await duyetCase(QL_CS, { caseId: c, phienBan: v, roomId: null, ten: "QLCS", now: SANG_14 }); // giữ GV, bỏ phòng
    expect(await dongCase(c)).toMatchObject({ status: "SCHEDULED", teacherId: GV, roomId: null });
  });

  it("[DC-07] từ chối duyệt: đã qua giờ KẾT THÚC · phiên bản cũ · duyệt lần hai · case đã huỷ ⇒ không đổi gì", async () => {
    const c = await taoChoDuyet([needId("A", 5)]);
    const v = (await dongCase(c)).version;
    expect(await lyDoLoi(duyetCase(QL_CS, { caseId: c, phienBan: v, ten: "QLCS", now: luc(15, 19, 30) }))).toContain("đã qua giờ");
    expect(await lyDoLoi(duyetCase(QL_CS, { caseId: c, phienBan: v + 7, ten: "QLCS", now: SANG_14 }))).toContain("vừa được người khác sửa");
    expect(await dongCase(c)).toMatchObject({ status: "PENDING_APPROVAL", version: v, approvedById: null });
    await duyetCase(QL_CS, { caseId: c, phienBan: v, ten: "QLCS", now: SANG_14 });
    expect(await lyDoLoi(duyetCase(QL_CS, { caseId: c, phienBan: v + 1, ten: "QLCS", now: SANG_14 }))).toContain("không ở trạng thái chờ duyệt");
    const c2 = await taoChoDuyet([needId("B", 6)], { teacherId: GV2, roomId: null });
    await huyCase(SALE_ACT, c2);
    expect(await lyDoLoi(duyetCase(QL_CS, { caseId: c2, phienBan: (await dongCase(c2)).version, ten: "QLCS", now: SANG_14 }))).toContain("không ở trạng thái chờ duyệt");
  });

  it("[DC-08] duyệt rồi mới phát hiện TRÙNG LỊCH (GV vừa được xếp lớp chính cùng giờ) ⇒ LoiTrungLich, ROLLBACK cả lượt: vẫn chờ duyệt, không tin, không người duyệt", async () => {
    const c = await taoChoDuyet([needId("A", 5)]);
    // GV có lớp LOP2 19:00–20:30 ngày 15/10 — chồng với 18:00–19:30.
    await db.classSession.create({ data: { id: id("lop2-15"), classId: LOP2, date: new Date("2026-10-15T12:00:00.000Z"), lessonId: BAI[5], status: "SCHEDULED", centerId: CS } });
    const v = (await dongCase(c)).version;
    await expect(duyetCase(QL_CS, { caseId: c, phienBan: v, ten: "QLCS", now: SANG_14 })).rejects.toBeInstanceOf(LoiTrungLich);
    expect(await dongCase(c)).toMatchObject({ status: "PENDING_APPROVAL", version: v, approvedById: null, approvedAt: null });
    expect(await suKien("makeup.case.scheduled")).toBe(0);
    expect(await nhatKy(c, "hoc-bu.duyet-case")).toBeNull();
  });

  it("[DC-09] TỪ CHỐI (có lý do): case huỷ, lý do lưu trên case, các bé về danh sách cần bù, lượt nhả; phụ huynh / giáo viên KHÔNG nhận tin huỷ (chưa từng được báo); nhật ký `hoc-bu.tu-choi-case` kèm lý do", async () => {
    const c = await taoChoDuyet([needId("A", 5), needId("B", 6)]);
    await huyCase(QL_CS, c, SANG_14, { lyDo: "Giáo viên đã kín lịch hôm đó", ten: "QLCS" });
    expect(await dongCase(c)).toMatchObject({ status: "CANCELLED", rejectReason: "Giáo viên đã kín lịch hôm đó" });
    expect((await need("A", 5)).status).toBe("PENDING");
    expect((await need("B", 6)).status).toBe("PENDING");
    expect(await so("A")).toEqual({ granted: 3, held: 0, consumed: 0, con: 3 });
    expect(await suKien("makeup.case.cancelled")).toBe(0);
    expect(await suKien("makeup.case.scheduled")).toBe(0);
    expect(await nhatKy(c, "hoc-bu.tu-choi-case")).toMatchObject({ reason: "Giáo viên đã kín lịch hôm đó" });
    await sach();
  });

  it("[DC-10] người tạo RÚT LẠI (Sale huỷ case còn chờ duyệt): huỷ + lý do mặc định, nhật ký `hoc-bu.rut-case`, không tin; còn case ĐÃ DUYỆT thì `tuChoi` bị từ chối (chỉ có nghĩa với case chờ duyệt)", async () => {
    const c = await taoChoDuyet([needId("A", 5)]);
    await huyCase(SALE_ACT, c);
    expect(await dongCase(c)).toMatchObject({ status: "CANCELLED", rejectReason: "Người tạo rút lại" });
    expect(await nhatKy(c, "hoc-bu.rut-case")).not.toBeNull();
    expect(await suKien("makeup.case.cancelled")).toBe(0);
    const c2 = await taoCaseVaXep(QL_CS, { ...KHUNG, needIds: [needId("C", 7)], coQuyenDuyet: true });
    expect(await lyDoLoi(huyCase(QL_CS, c2, SANG_14, { lyDo: "Không muốn", ten: "QLCS" }))).toContain("không còn chờ duyệt");
    expect(await trangThai(c2)).toBe("SCHEDULED");
  });

  it("[DC-11] PHẠM VI cơ sở: quản lý cơ sở KHÁC không duyệt / từ chối được case này (không thấy nó) và không đổi gì; đối chứng dương: quản lý ĐÚNG cơ sở duyệt được", async () => {
    const c = await taoChoDuyet([needId("A", 5)]);
    const v = (await dongCase(c)).version;
    expect(await lyDoLoi(duyetCase(QL_KHAC, { caseId: c, phienBan: v, ten: "QL khác", now: SANG_14 }))).toBe("Không tìm thấy case dạy bù");
    expect(await lyDoLoi(huyCase(QL_KHAC, c, SANG_14, { lyDo: "Từ chối bừa bãi", ten: "QL khác" }))).toBe("Không tìm thấy case dạy bù");
    expect(await dongCase(c)).toMatchObject({ status: "PENDING_APPROVAL", version: v, rejectReason: null });
    await duyetCase(QL_CS, { caseId: c, phienBan: v, ten: "QLCS", now: SANG_14 });
    expect(await trangThai(c)).toBe("SCHEDULED");
  });

  it("[DC-13] THÔNG BÁO qua đường thật: chờ duyệt ⇒ CHỈ quản lý cơ sở biết (phụ huynh, giáo viên, Sale chưa); duyệt ⇒ phụ huynh + giáo viên + người tạo; từ chối ⇒ người tạo (kèm lý do), phụ huynh KHÔNG; rút lại ⇒ không báo ai", async () => {
    const c = await taoChoDuyet([needId("A", 5)]);
    await chay();
    const ql = await tinNS(QL);
    expect(ql.map((t) => t.dedupeKey)).toEqual([`makeup.case.pending-approval:${c}`]);
    expect(ql[0]!.title).toBe("Case học bù chờ duyệt");
    expect(await tinNS(GV)).toEqual([]);
    expect(await tinNS(SALE)).toEqual([]);
    expect(await tinPH("A")).toEqual([]);

    await duyetCase(QL_CS, { caseId: c, phienBan: (await dongCase(c)).version, ten: "QLCS", now: SANG_14 });
    await chay();
    expect((await tinNS(SALE)).map((t) => t.dedupeKey)).toEqual([`makeup.case.approved:${c}`]);
    expect((await tinNS(GV)).map((t) => t.dedupeKey)).toEqual([`makeup.case.scheduled:gv:${c}`]);
    expect((await tinPH("A")).map((t) => t.title)).toEqual(["Đã xếp lịch học bù"]);

    // Từ chối một case khác: người tạo được báo kèm lý do; phụ huynh của bé không nhận gì.
    const c2 = await taoChoDuyet([needId("B", 7)], { teacherId: GV2, roomId: null });
    await huyCase(QL_CS, c2, SANG_14, { lyDo: "Giáo viên đã kín lịch hôm đó", ten: "QLCS" });
    await chay();
    const tuChoi = (await tinNS(SALE)).filter((t) => t.dedupeKey === `makeup.case.rejected:${c2}`);
    expect(tuChoi).toHaveLength(1);
    expect(tuChoi[0]!.body).toContain("Giáo viên đã kín lịch hôm đó");
    expect(await tinPH("B")).toEqual([]);
    expect((await tinNS(GV2))).toEqual([]);

    // Người tạo tự RÚT LẠI: không báo ai (chính họ vừa bấm).
    const c3 = await taoChoDuyet([needId("B", 6)], { teacherId: GV2, roomId: null });
    await huyCase(SALE_ACT, c3);
    await chay();
    expect((await tinNS(SALE)).filter((t) => t.dedupeKey.includes(c3) && !t.dedupeKey.startsWith("makeup.case.pending"))).toEqual([]);
    expect(await suKien("makeup.case.rejected")).toBe(1);
  });

  it("[DC-14] màn Duyệt case đọc ĐÚNG: chỉ case CHỜ DUYỆT trong tầm nhìn người xem (không case đã duyệt / đã huỷ / của cơ sở khác), kèm người tạo · học viên · lớp · số buổi · phiên bản", async () => {
    const c1 = await taoChoDuyet([needId("A", 5), needId("B", 6)]);
    // Do QUẢN LÝ tạo nhưng với `coQuyenDuyet: false` (vai không có quyền duyệt, vd. giáo vụ) — cũng là case chờ duyệt.
    const c2 = await taoCaseVaXep(QL_CS, { ...KHUNG, needIds: [needId("C", 7)], teacherId: GV2, roomId: null, coQuyenDuyet: false });
    const c3 = await taoCaseVaXep(QL_CS, { ...KHUNG, ymd: "2026-10-16", needIds: [needId("D", 8)], coQuyenDuyet: true }); // đã duyệt (lịch thật)
    const c4 = await taoCaseVaXep(SALE_ACT, { ...KHUNG, ymd: "2026-10-16", needIds: [needId("B", 7)], teacherId: GV2, roomId: null, coQuyenDuyet: false });
    await huyCase(SALE_ACT, c4); // rút lại ⇒ CANCELLED
    const ds = await docCaseChoDuyet(scopedDb(QL_CS), {});
    expect(ds.map((d) => d.id).sort()).toEqual([c1, c2].sort());
    expect(ds.map((d) => d.id)).not.toContain(c3);
    expect(ds.map((d) => d.id)).not.toContain(c4);
    const d1 = ds.find((d) => d.id === c1)!;
    expect(d1).toMatchObject({ nguoiTao: "Sale duyệt", giaoVien: "GV T07", phong: "Phòng T07", version: (await dongCase(c1)).version });
    expect(d1.hocVien).toEqual([{ ten: "Bé T07 A", lop: "Lớp T07", soBuoi: 2 }, { ten: "Bé T07 B", lop: "Lớp T07", soBuoi: 1 }]); // A5 + A6 (HB-GOP)
    expect(ds.find((d) => d.id === c2)).toMatchObject({ nguoiTao: "QLCS duyệt", phong: null });
    // Quản lý cơ sở KHÁC không thấy case nào của cơ sở này.
    expect(await docCaseChoDuyet(scopedDb(QL_KHAC), {})).toEqual([]);
  });

  it("[DC-12] case chờ duyệt ĐÓNG BĂNG: không sửa, không thêm bé, không điểm danh được (chỉ duyệt / từ chối / rút lại)", async () => {
    const c = await taoChoDuyet([needId("A", 5)]);
    const v = (await dongCase(c)).version;
    expect(await lyDoLoi(suaCase(QL_CS, { caseId: c, phienBan: v, note: "đổi", ten: "QLCS", now: SANG_14 }))).toContain("không sửa được");
    // B vắng bài 6 (chưa nằm trong bộ bài): với `moRongBai` đây là đường thêm bé + thêm bài — case chờ duyệt phải từ chối ĐÚNG vì trạng thái, không vì lý do nào khác.
    expect(await lyDoLoi(xepVaoCaseCoSan(QL_CS, { coQuyenDuyet: true, caseId: c, needIds: [needId("B", 6)], moRongBai: true }))).toContain("đã điểm danh hoặc đã huỷ");
    expect(await lyDoLoi(diemDanh(c, "A", true, { 5: "COMPLETED" }, luc(15, 18, 30)))).toContain("đã chốt hoặc đã huỷ");
    expect(await dongCase(c)).toMatchObject({ status: "PENDING_APPROVAL", version: v });
    expect((await beCua(c, "A")).attendanceStatus).toBe("PENDING");
    expect((await mucCua(c, "A", 5)).result).toBe("PLANNED");
  });
});
