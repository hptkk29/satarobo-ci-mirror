// tests/finance/bao-luu-vong-doi.test.ts — VÒNG ĐỜI SAU KHI BẮT ĐẦU + CRON bảo lưu, trên POSTGRES THẬT. PHIÊN 5.
//
// Chạy:  pnpm test:finance-db
// Đồng hồ ĐÓNG BĂNG (luật 19): hồ sơ bắt đầu 10/01/2026, trần 3 tháng ⇒ hạn 10/04/2026 (= +90 ngày). Mỗi ca tịnh tiến `now`.
// Chat giả (spy) để chứng minh lời gọi nằm TRONG giao dịch (ca rollback). KHÔNG ghi dòng tiền — ca `[BL5-VD-CD]` còn đo `RefundRequest` = 0.
import { describe, it, expect, afterAll, vi } from "vitest";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";

const h = vi.hoisted(() => ({ sync: vi.fn(async (_tx: unknown, _classId: string) => {}) }));
vi.mock("@/lib/chat/sync-membership", () => ({ syncConversationMembership: h.sync }));

import { ghiLienHe, ghiThongBaoChinhThuc, deNghiGiaHan, duyetGiaHan, tuChoiGiaHan, quaHan, chamDut, khoiPhuc, batDauKhiDenNgay } from "@/lib/bao-luu/vong-doi";
import { chayCronBaoLuu } from "@/lib/bao-luu/cron-chay";
import { findExpiredReserves } from "@/lib/students/reserve-service";
import { hanToiDaBaoLuu } from "@/lib/bao-luu/tran-bao-luu";
import { vnDateAt } from "@/lib/time/vn";

if (!RUN_DB_TESTS) console.warn(`[BL5-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-bl5-";
const CS = `${T}cs`;
const OU = `${T}ou`;
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const HV = `${T}hv`;
const GD = `${T}gd`;
const SALE = { id: `${T}sale`, name: "Sale fixture" };
const QLCS = { id: `${T}qlcs`, name: "QLCS fixture" };
const QLCS2 = { id: `${T}qlcs2`, name: "QLCS 2 fixture" };
const ADMIN = { id: `${T}admin`, name: "Admin fixture" };
const RID = `${T}r`;

const BAT_DAU = vnDateAt(2026, 0, 10);
const HAN = hanToiDaBaoLuu(BAT_DAU, 3); // 10/04/2026
const lich = (n: number) => new Date(BAT_DAU.getTime() + n * 86_400_000 + 3 * 3_600_000); // 03:00 sáng VN, +n ngày kể từ ngày bắt đầu

async function don() {
  await db.domainEvent.deleteMany({ where: { dedupeKey: { startsWith: "bao-luu." }, payloadJson: { path: ["reserveId"], equals: RID } } });
  await db.staffNotification.deleteMany({ where: { dedupeKey: { contains: RID } } });
  await db.refundRequest.deleteMany({ where: { enrollmentId: GD } });
  await db.auditLog.deleteMany({ where: { entityId: { startsWith: T } } });
  await db.studentReserveEvent.deleteMany({ where: { reserveId: RID } });
  await db.studentReserve.deleteMany({ where: { studentId: HV } });
  await db.enrollmentAuditLog.deleteMany({ where: { enrollmentId: GD } });
  await db.enrollment.deleteMany({ where: { id: GD } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: HV } });
  await db.user.deleteMany({ where: { id: { in: [SALE.id, QLCS.id, QLCS2.id, ADMIN.id] } } });
  await db.orgUnit.deleteMany({ where: { id: OU } });
  await db.center.deleteMany({ where: { id: CS } });
  await db.systemSetting.deleteMany({ where: { key: "pause.enabled" } });
}

async function batCongTac(bat: boolean) {
  await db.systemSetting.upsert({ where: { key: "pause.enabled" }, create: { key: "pause.enabled", valueJson: bat }, update: { valueJson: bat } });
}

type TaoHoSo = { status?: "ACTIVE" | "OVERDUE" | "NOTICE_SENT" | "TERMINATED" | "APPROVED"; type?: "PARENT" | "CENTER" | "LEGACY"; extra?: object; enrollment?: "PAUSED" | "WITHDREW"; student?: "PAUSED" | "INACTIVE" };

async function dung(o: TaoHoSo = {}) {
  await don();
  h.sync.mockReset();
  h.sync.mockImplementation(async () => {});
  await db.center.create({ data: { id: CS, name: "CS BL5", slug: CS, address: "x" } });
  await db.orgUnit.create({ data: { id: OU, type: "CENTER", code: `${T}OU`, name: "ĐV BL5", centerId: CS } });
  for (const u of [SALE, QLCS, QLCS2, ADMIN]) {
    await db.user.create({ data: { id: u.id, name: u.name, email: `${u.id}@example.test`, role: u === SALE ? "SALES_CSM" : "CENTER_MANAGER", roles: [u === SALE ? "SALES_CSM" : "CENTER_MANAGER"], centerId: CS } });
  }
  await db.course.create({ data: { id: KHOA, name: "Sata 3 BL5", slug: KHOA, totalSessions: 48 } });
  await db.class.create({ data: { id: LOP, name: "Lớp T7 BL5", courseId: KHOA, centerId: CS, status: "ACTIVE" } });
  await db.student.create({ data: { id: HV, name: "An BL5", centerId: CS, orgUnitId: OU, status: o.student ?? "PAUSED" } });
  await db.enrollment.create({ data: { id: GD, studentId: HV, classId: LOP, courseId: KHOA, status: o.enrollment ?? "PAUSED", centerId: CS } });
  await db.studentReserve.create({
    data: {
      id: RID, studentId: HV, enrollmentId: GD, reason: "fx", createdByName: SALE.name, createdByUserId: SALE.id, centerId: CS,
      type: o.type ?? "PARENT", status: o.status ?? "ACTIVE", isActive: (o.status ?? "ACTIVE") !== "TERMINATED" && (o.status ?? "ACTIVE") !== "APPROVED",
      approvedAt: BAT_DAU, startedAt: BAT_DAU, standardEndDate: HAN, expectedEndAt: HAN, ...o.extra,
    },
  });
  await batCongTac(true);
}

const hs = () => db.studentReserve.findUniqueOrThrow({ where: { id: RID } });
const kinds = async () => (await db.studentReserveEvent.findMany({ where: { reserveId: RID }, orderBy: { at: "asc" } })).map((e) => e.kind);
const loi = (r: { ok: boolean; loi?: string[] }) => (r.ok ? "" : (r.loi ?? []).join(" | "));
const dem = (like: string) => db.staffNotification.count({ where: { dedupeKey: { startsWith: like, contains: RID } } });

import { vnStartOfDay } from "@/lib/time/vn";

describe.skipIf(!RUN_DB_TESTS)("[BL5-VD] liên hệ · thông báo chính thức", () => {
  afterAll(don);

  it("[BL5-VD-01] liên hệ: ghi lastContactAt + sự kiện CONTACT; ghi chú ngắn / trạng thái không hợp lệ bị chặn", async () => {
    await dung();
    expect(loi(await ghiLienHe({ reserveId: RID, ghiChu: "ko", henNgay: null }, SALE, lich(95)))).toMatch(/ít nhất 5/);
    const r = await ghiLienHe({ reserveId: RID, ghiChu: "Gọi PH, hẹn trả lời thứ Sáu", henNgay: lich(99) }, SALE, lich(95));
    expect(r.ok).toBe(true);
    expect((await hs()).lastContactAt?.toISOString()).toBe(lich(95).toISOString());
    expect(await kinds()).toEqual(["CONTACT"]);
    await db.studentReserve.update({ where: { id: RID }, data: { status: "ENDED", isActive: false } });
    expect(loi(await ghiLienHe({ reserveId: RID, ghiChu: "gọi lại lần nữa", henNgay: null }, SALE, lich(96)))).toMatch(/đang bảo lưu/);
  });

  it("[BL5-VD-02] thông báo chính thức: chỉ khi QUÁ HẠN ⇒ NOTICE_SENT + hạn phản hồi = ngày gửi +7 (lịch VN) + sự kiện hệ thống; ACTIVE / CENTER bị chặn", async () => {
    await dung({ status: "ACTIVE" });
    expect(loi(await ghiThongBaoChinhThuc({ reserveId: RID, kenh: "ZNS" }, QLCS, lich(95)))).toMatch(/QUÁ HẠN/);
    await db.studentReserve.update({ where: { id: RID }, data: { status: "OVERDUE" } });
    const r = await ghiThongBaoChinhThuc({ reserveId: RID, kenh: "ZNS" }, QLCS, lich(100));
    expect(r.ok).toBe(true);
    const x = await hs();
    expect(x).toMatchObject({ status: "NOTICE_SENT", isActive: true, officialNoticeChannel: "ZNS" });
    expect(x.officialNoticeSentAt?.toISOString()).toBe(lich(100).toISOString());
    expect(x.responseDeadline?.toISOString()).toBe(vnStartOfDay(lich(107)).toISOString());
    expect(await kinds()).toEqual(["NOTICE"]);
    expect(await db.domainEvent.count({ where: { type: "bao-luu.thong-bao-chinh-thuc", payloadJson: { path: ["reserveId"], equals: RID } } })).toBe(1);

    await dung({ status: "OVERDUE", type: "CENTER" });
    expect(loi(await ghiThongBaoChinhThuc({ reserveId: RID, kenh: "ZNS" }, QLCS, lich(100)))).toMatch(/Trung tâm/);
  });

  it("[BL5-VD-03] cờ TẮT ⇒ mọi thao tác vòng đời từ chối, không ghi gì", async () => {
    await dung({ status: "OVERDUE" });
    await batCongTac(false);
    expect(loi(await ghiLienHe({ reserveId: RID, ghiChu: "gọi phụ huynh", henNgay: null }, SALE, lich(95)))).toMatch(/chưa được bật/);
    expect(loi(await ghiThongBaoChinhThuc({ reserveId: RID, kenh: "EMAIL" }, QLCS, lich(95)))).toMatch(/chưa được bật/);
    expect(loi(await deNghiGiaHan({ reserveId: RID, denNgay: lich(100), lyDo: "xin thêm tháng" }, SALE, lich(95)))).toMatch(/chưa được bật/);
    expect(await kinds()).toEqual([]);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[BL5-GH] gia hạn: đề nghị → duyệt (hai người khác nhau)", () => {
  afterAll(don);
  // Hạn 10/04: một tháng lịch ⇒ 10/05 (30 ngày). 31 ngày ⇒ 11/05.
  const ngayHan = (n: number) => new Date(HAN.getTime() + n * 86_400_000);

  it("[BL5-GH-01] TC-08: đề nghị 31 ngày ⇒ chặn; 30 ngày ⇒ vào hàng chờ, KHÔNG đổi hạn", async () => {
    await dung();
    expect(loi(await deNghiGiaHan({ reserveId: RID, denNgay: ngayHan(31), lyDo: "xin thêm một tháng" }, SALE, lich(80)))).toMatch(/tối đa 1 tháng/);
    const ok = await deNghiGiaHan({ reserveId: RID, denNgay: ngayHan(30), lyDo: "xin thêm một tháng" }, SALE, lich(80));
    expect(ok.ok).toBe(true);
    const x = await hs();
    expect(x.extendedEndDate).toBeNull();
    expect(x.extendRequest).toMatchObject({ requestedById: SALE.id });
    expect(await kinds()).toEqual(["EXTEND_REQUEST"]);
    expect(loi(await deNghiGiaHan({ reserveId: RID, denNgay: ngayHan(20), lyDo: "xin thêm một tháng" }, SALE, lich(81)))).toMatch(/đang chờ duyệt/);
  });

  it("[BL5-GH-02] maker–checker: chính người đề nghị duyệt ⇒ TỪ CHỐI ở server; người khác duyệt ⇒ extendedEndDate + extendCount=1 + sự kiện EXTEND, đề nghị được xoá", async () => {
    await dung();
    await deNghiGiaHan({ reserveId: RID, denNgay: ngayHan(30), lyDo: "xin thêm một tháng" }, SALE, lich(80));
    expect(loi(await duyetGiaHan({ reserveId: RID }, SALE, lich(81)))).toMatch(/chính mình/);
    expect((await hs()).extendCount).toBe(0);
    const r = await duyetGiaHan({ reserveId: RID }, QLCS, lich(81));
    expect(r.ok).toBe(true);
    const x = await hs();
    expect(x).toMatchObject({ status: "ACTIVE", extendCount: 1, extendedById: QLCS.id });
    expect(x.extendedEndDate?.toISOString()).toBe(ngayHan(30).toISOString());
    expect(x.extendRequest).toBeNull();
    expect(await kinds()).toEqual(["EXTEND_REQUEST", "EXTEND"]);
  });

  it("[BL5-GH-03] TC-09: gia hạn LẦN HAI ⇒ từ chối (extendTimes mặc định 1)", async () => {
    await dung({ extra: { extendCount: 1, extendedEndDate: ngayHan(30) } });
    expect(loi(await deNghiGiaHan({ reserveId: RID, denNgay: ngayHan(40), lyDo: "xin thêm lần nữa" }, SALE, lich(85)))).toMatch(/hết 1 lần gia hạn/);
  });

  it("[BL5-GH-04] gia hạn từ ĐÃ GỬI THÔNG BÁO ⇒ về ACTIVE và dừng đồng hồ phản hồi (cron không chấm dứt một hồ sơ đã gia hạn)", async () => {
    await dung({ status: "NOTICE_SENT", extra: { officialNoticeSentAt: lich(95), officialNoticeChannel: "ZNS", responseDeadline: vnStartOfDay(lich(102)) } });
    await deNghiGiaHan({ reserveId: RID, denNgay: ngayHan(30), lyDo: "PH hẹn quay lại tháng sau" }, SALE, lich(96));
    expect((await duyetGiaHan({ reserveId: RID }, QLCS, lich(97))).ok).toBe(true);
    expect(await hs()).toMatchObject({ status: "ACTIVE", isActive: true, responseDeadline: null });
    const kq = await chamDut({ reserveId: RID }, lich(150));
    expect(kq.ok).toBe(false);
    expect((await hs()).status).toBe("ACTIVE");
  });

  it("[BL5-GH-05] từ chối đề nghị: hồ sơ không đổi, hạn không đổi; không còn đề nghị để duyệt", async () => {
    await dung();
    await deNghiGiaHan({ reserveId: RID, denNgay: ngayHan(30), lyDo: "xin thêm một tháng" }, SALE, lich(80));
    expect(loi(await tuChoiGiaHan({ reserveId: RID, lyDo: "ko" }, QLCS, lich(81)))).toMatch(/ít nhất 5/);
    expect((await tuChoiGiaHan({ reserveId: RID, lyDo: "chưa đủ minh chứng" }, QLCS, lich(81))).ok).toBe(true);
    const x = await hs();
    expect(x).toMatchObject({ status: "ACTIVE", extendCount: 0 });
    expect(x.extendRequest).toBeNull();
    expect(x.extendedEndDate).toBeNull();
    expect(loi(await duyetGiaHan({ reserveId: RID }, QLCS2, lich(82)))).toMatch(/không có đề nghị/);
  });
});

describe.skipIf(!RUN_DB_TESTS)("[BL5-CD] quá hạn · chấm dứt · khôi phục", () => {
  afterAll(don);

  it("[BL5-CD-01] quá hạn: chỉ khi hạn < hôm nay ⇒ OVERDUE (isActive vẫn true) + sự kiện EXPIRE; CENTER không bao giờ", async () => {
    await dung();
    expect(loi(await quaHan({ reserveId: RID }, lich(90)))).toMatch(/chưa quá hạn/);
    expect((await quaHan({ reserveId: RID }, lich(91))).ok).toBe(true);
    expect(await hs()).toMatchObject({ status: "OVERDUE", isActive: true });
    expect(await kinds()).toEqual(["EXPIRE"]);
    expect(loi(await quaHan({ reserveId: RID }, lich(92)))).toMatch(/không còn ở trạng thái đang bảo lưu/);
    expect(await kinds()).toEqual(["EXPIRE"]);

    await dung({ type: "CENTER" });
    expect(loi(await quaHan({ reserveId: RID }, lich(200)))).toMatch(/Trung tâm/);
  });

  it("[BL5-CD-02] chấm dứt: chỉ NOTICE_SENT + hết hạn phản hồi ⇒ TERMINATED, ghi danh WITHDREW, học viên INACTIVE, KHÔNG yêu cầu hoàn, có sự kiện hệ thống", async () => {
    await dung({ status: "NOTICE_SENT", extra: { officialNoticeSentAt: lich(100), officialNoticeChannel: "ZNS", responseDeadline: vnStartOfDay(lich(107)) } });
    expect(loi(await chamDut({ reserveId: RID }, lich(107)))).toMatch(/Chưa hết hạn phản hồi/);
    const r = await chamDut({ reserveId: RID }, lich(108));
    expect(r.ok).toBe(true);
    const x = await hs();
    expect(x).toMatchObject({ status: "TERMINATED", isActive: false, endKind: "TERMINATED", endedByName: "Hệ thống" });
    expect(x.endedAt?.toISOString()).toBe(lich(108).toISOString());
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: GD } })).status).toBe("WITHDREW");
    expect((await db.student.findUniqueOrThrow({ where: { id: HV } })).status).toBe("INACTIVE");
    expect(await db.refundRequest.count({ where: { enrollmentId: GD } })).toBe(0);
    expect(await db.domainEvent.count({ where: { type: "bao-luu.cham-dut", payloadJson: { path: ["reserveId"], equals: RID } } })).toBe(1);
    expect(h.sync).toHaveBeenCalledWith(expect.anything(), LOP);
    const sk = await db.studentReserveEvent.findFirstOrThrow({ where: { reserveId: RID, kind: "TERMINATE" } });
    expect(sk.after).toMatchObject({ studentTruoc: "PAUSED", enrollmentTruoc: "PAUSED", khongSinhYeuCauHoan: true });
    expect((await chamDut({ reserveId: RID }, lich(109))).ok).toBe(false);
  });

  it("[BL5-CD-03] TC-11: OVERDUE, chưa gửi thông báo chính thức ⇒ KHÔNG chấm dứt dù quá hạn rất lâu", async () => {
    await dung({ status: "OVERDUE" });
    expect(loi(await chamDut({ reserveId: RID }, lich(220)))).toMatch(/đã gửi thông báo/);
    expect((await hs()).status).toBe("OVERDUE");
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: GD } })).status).toBe("PAUSED");
  });

  it("[BL5-CD-04] ROLLBACK: đồng bộ chat ném giữa chừng ⇒ hồ sơ VẪN NOTICE_SENT, ghi danh VẪN PAUSED, học viên VẪN PAUSED, không sự kiện, không DomainEvent", async () => {
    await dung({ status: "NOTICE_SENT", extra: { responseDeadline: vnStartOfDay(lich(107)) } });
    h.sync.mockRejectedValueOnce(new Error("chat down"));
    await expect(chamDut({ reserveId: RID }, lich(108))).rejects.toThrow("chat down");
    expect((await hs()).status).toBe("NOTICE_SENT");
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: GD } })).status).toBe("PAUSED");
    expect((await db.student.findUniqueOrThrow({ where: { id: HV } })).status).toBe("PAUSED");
    expect(await kinds()).toEqual([]);
    expect(await db.domainEvent.count({ where: { type: "bao-luu.cham-dut", payloadJson: { path: ["reserveId"], equals: RID } } })).toBe(0);
  });

  it("[BL5-CD-05] cờ TẮT ⇒ chấm dứt từ chối (cron cũng không tự huỷ quyền lợi khi người vận hành đã rút cờ)", async () => {
    await dung({ status: "NOTICE_SENT", extra: { responseDeadline: vnStartOfDay(lich(107)) } });
    await batCongTac(false);
    expect(loi(await chamDut({ reserveId: RID }, lich(120)))).toMatch(/chưa được bật/);
    expect((await hs()).status).toBe("NOTICE_SENT");
  });

  it("[BL5-CD-06] khôi phục (bao-luu:exception): TERMINATED ⇒ ACTIVE, ghi danh WITHDREW→PAUSED, học viên về PAUSED, thông báo/hạn phản hồi bị xoá; lý do ≥10 ký tự, hạn mới hợp lệ", async () => {
    await dung({ status: "NOTICE_SENT", extra: { responseDeadline: vnStartOfDay(lich(107)) } });
    await chamDut({ reserveId: RID }, lich(108));
    expect(loi(await khoiPhuc({ reserveId: RID, denNgay: lich(150), lyDo: "ngắn" }, ADMIN, lich(120)))).toMatch(/ít nhất 10/);
    expect(loi(await khoiPhuc({ reserveId: RID, denNgay: lich(100), lyDo: "BGĐ cho phép khôi phục" }, ADMIN, lich(120)))).toMatch(/sau hôm nay/);
    expect(loi(await khoiPhuc({ reserveId: RID, denNgay: lich(500), lyDo: "BGĐ cho phép khôi phục" }, ADMIN, lich(120)))).toMatch(/tối đa 6 tháng/);
    const r = await khoiPhuc({ reserveId: RID, denNgay: lich(150), lyDo: "BGĐ cho phép khôi phục" }, ADMIN, lich(120));
    expect(r.ok).toBe(true);
    const x = await hs();
    expect(x).toMatchObject({ status: "ACTIVE", isActive: true, endedAt: null, endKind: null, responseDeadline: null, officialNoticeSentAt: null });
    expect(x.extendedEndDate?.toISOString()).toBe(lich(150).toISOString());
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: GD } })).status).toBe("PAUSED");
    expect((await db.student.findUniqueOrThrow({ where: { id: HV } })).status).toBe("PAUSED");
    expect((await kinds()).slice(-1)).toEqual(["RESTORE"]);
  });

  it("[BL5-CD-07] khôi phục KHÔNG mở lại ghi danh của lớp đã kết thúc — nói rõ phải ghi danh lại, và không đổi gì", async () => {
    await dung({ status: "NOTICE_SENT", extra: { responseDeadline: vnStartOfDay(lich(107)) } });
    await chamDut({ reserveId: RID }, lich(108));
    await db.class.update({ where: { id: LOP }, data: { status: "COMPLETED" } });
    expect(loi(await khoiPhuc({ reserveId: RID, denNgay: lich(150), lyDo: "BGĐ cho phép khôi phục" }, ADMIN, lich(120)))).toMatch(/Lớp đã kết thúc/);
    expect((await hs()).status).toBe("TERMINATED");
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: GD } })).status).toBe("WITHDREW");
  });
});

describe.skipIf(!RUN_DB_TESTS)("[BL5-CR] cron /api/cron/bao-luu — tịnh tiến đồng hồ, chạy hai lần", () => {
  afterAll(don);
  const tong = (k: Awaited<ReturnType<typeof chayCronBaoLuu>>) => k.viec;

  it("[BL5-CR-DB-01] TC-10: mốc −14 / đúng hạn / +1 quá hạn — mỗi mốc ĐÚNG MỘT thông báo dù cron chạy 2 lần", async () => {
    await dung();
    expect(tong(await chayCronBaoLuu(lich(76))).NHAC_TRUOC_HAN).toBe(1);
    await chayCronBaoLuu(lich(76));
    expect(await dem("pause.nhac-truoc-han:")).toBe(1);
    await chayCronBaoLuu(lich(90));
    await chayCronBaoLuu(lich(90));
    expect(await dem("pause.nhac-het-han:")).toBe(1);
    expect(tong(await chayCronBaoLuu(lich(91))).QUA_HAN).toBe(1);
    expect(tong(await chayCronBaoLuu(lich(91))).QUA_HAN).toBe(0);
    expect((await hs()).status).toBe("OVERDUE");
    expect(await dem("pause.qua-han:")).toBe(1);
    expect((await kinds()).filter((k) => k === "EXPIRE")).toHaveLength(1);
  });

  it("[BL5-CR-DB-02] +93 leo thang QLCS một lần (không lặp mỗi sáng); TC-11 quá hạn rất lâu chưa gửi TB ⇒ KHÔNG chấm dứt", async () => {
    await dung({ status: "OVERDUE" });
    expect(tong(await chayCronBaoLuu(lich(92))).LEO_THANG).toBe(0);
    expect(tong(await chayCronBaoLuu(lich(93))).LEO_THANG).toBe(1);
    expect(tong(await chayCronBaoLuu(lich(94))).LEO_THANG).toBe(0);
    expect((await kinds()).filter((k) => k === "ESCALATE")).toHaveLength(1);
    expect(await dem("pause.leo-thang:")).toBeGreaterThan(0);
    for (const n of [120, 130]) {
      const k = await chayCronBaoLuu(lich(n));
      expect(k.viec.CHAM_DUT, `+${n}`).toBe(0);
    }
    expect((await hs()).status).toBe("OVERDUE");
  });

  it("[BL5-CR-DB-03] TC-12: thông báo chính thức +100 ⇒ hạn phản hồi +107; cron +107 chưa chấm dứt, +108 TERMINATED một lần, KHÔNG yêu cầu hoàn, +130 không làm gì thêm", async () => {
    await dung({ status: "OVERDUE" });
    expect((await ghiThongBaoChinhThuc({ reserveId: RID, kenh: "ZNS" }, QLCS, lich(100))).ok).toBe(true);
    expect(tong(await chayCronBaoLuu(lich(107))).CHAM_DUT).toBe(0);
    expect(tong(await chayCronBaoLuu(lich(108))).CHAM_DUT).toBe(1);
    expect(tong(await chayCronBaoLuu(lich(108))).CHAM_DUT).toBe(0);
    expect(tong(await chayCronBaoLuu(lich(130))).CHAM_DUT).toBe(0);
    expect(await hs()).toMatchObject({ status: "TERMINATED", isActive: false });
    expect(await db.refundRequest.count({ where: { enrollmentId: GD } })).toBe(0);
    expect(await dem("pause.cham-dut:")).toBeGreaterThan(0);
    expect(await dem("pause.thu-hoi-kit:")).toBeGreaterThan(0);
  });

  it("[BL5-CR-DB-04] loại CENTER: không bao giờ OVERDUE / leo thang / chấm dứt; chỉ NHẮC quản lý khi quá ngày dự kiến mở lại", async () => {
    await dung({ type: "CENTER", extra: { expectedEndAt: lich(60) } });
    const k = await chayCronBaoLuu(lich(130));
    expect(k.viec).toMatchObject({ QUA_HAN: 0, LEO_THANG: 0, CHAM_DUT: 0, CENTER_NHAC: 1 });
    expect((await hs()).status).toBe("ACTIVE");
    expect(await dem("pause.center-qua-ngay:")).toBeGreaterThan(0);
  });

  it("[BL5-CR-DB-05] cơ sở TẮT cờ ⇒ cron BỎ QUA (đếm boQuaCoTat), không đổi trạng thái, không chấm dứt", async () => {
    await dung({ status: "NOTICE_SENT", extra: { responseDeadline: vnStartOfDay(lich(107)) } });
    await batCongTac(false);
    const k = await chayCronBaoLuu(lich(130));
    expect(k.boQuaCoTat).toBe(1);
    expect(k.viec.CHAM_DUT).toBe(0);
    expect((await hs()).status).toBe("NOTICE_SENT");
  });

  it("[BL5-CR-DB-06] hồ sơ CŨ (approvedAt NULL) không bị cron đụng", async () => {
    await dung({ extra: { approvedAt: null } });
    const k = await chayCronBaoLuu(lich(130));
    expect(k.quet).toBe(0);
    expect((await hs()).status).toBe("ACTIVE");
  });

  it("[BL5-CR-DB-08] cron CŨ `reserve-expiry` KHÔNG quét hồ sơ đời mới (tránh báo trùng một hồ sơ hai lần); hồ sơ cũ quá `expectedEndAt` vẫn được quét", async () => {
    await dung({ extra: { expectedEndAt: lich(60) } });
    expect((await findExpiredReserves(lich(130))).map((r) => r.id)).not.toContain(RID);
    await db.studentReserve.update({ where: { id: RID }, data: { approvedAt: null } });
    expect((await findExpiredReserves(lich(130))).map((r) => r.id)).toContain(RID);
  });

  it("[BL5-CR-DB-07] START lưới an toàn: APPROVED có ngày bắt đầu ≤ hôm nay ⇒ ACTIVE + ghi danh PAUSED; chưa tới ngày thì không", async () => {
    await dung({ status: "APPROVED", enrollment: "PAUSED", extra: { startedAt: lich(5) } });
    await db.enrollment.update({ where: { id: GD }, data: { status: "ACTIVE" } });
    await db.student.update({ where: { id: HV }, data: { status: "ACTIVE" } });
    expect((await batDauKhiDenNgay({ reserveId: RID }, lich(4))).ok).toBe(false);
    expect(tong(await chayCronBaoLuu(lich(5))).START).toBe(1);
    expect(await hs()).toMatchObject({ status: "ACTIVE", isActive: true });
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: GD } })).status).toBe("PAUSED");
    expect((await db.student.findUniqueOrThrow({ where: { id: HV } })).status).toBe("PAUSED");
  });
});
