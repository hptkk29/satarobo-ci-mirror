// tests/finance/bao-luu-nhap-legacy.test.ts — [BL8-DB] NHẬP CA LEGACY (K14) trên POSTGRES THẬT: ứng viên 3 nhóm · xem trước không ghi · ghi một giao dịch tất-cả-hoặc-không.
//
// Chạy: pnpm test:finance-db. Đồng hồ ĐÓNG BĂNG (luật 19): NOW truyền vào mọi hàm. Chat giả (spy) để chứng minh lời gọi đồng bộ nằm TRONG giao dịch.
import { describe, it, expect, afterAll, vi } from "vitest";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";

const h = vi.hoisted(() => ({ sync: vi.fn(async (_tx: unknown, _classId: string) => {}) }));
vi.mock("@/lib/chat/sync-membership", () => ({ syncConversationMembership: h.sync }));

import { docUngVienLegacy, nhapLegacy, xemTruocLegacy } from "@/lib/bao-luu/legacy-nhap-db";
import { trongLop } from "@/lib/bao-luu/roster";
import type { CaNhap } from "@/lib/bao-luu/legacy-nhap";
import type { PhuThuoc } from "@/lib/bao-luu/dich-vu";

if (!RUN_DB_TESTS) console.warn(`[BL8-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const T = "fx-bl8-";
const CS = `${T}cs`;
const OU = `${T}ou`;
const KHOA = `${T}khoa`;
const LOP = `${T}lop`;
const NOW = new Date("2026-10-08T03:00:00Z");
const NGAY = 86_400_000;
const bay = (n: number) => new Date(NOW.getTime() - n * NGAY);
const ymd = (n: number) => bay(n).toISOString().slice(0, 10);
const NGUOI = { id: `${T}qlcs`, name: "QLCS fixture" };
const DEPS: PhuThuoc = { xacMinhTep: async () => ({ ok: true }), khoDaCauHinh: () => true };
const SIEU: Actor = {
  userId: NGUOI.id, isSuperAdmin: true, isHoLevel: true, orgRoles: [], permissions: [], visibleCenterIds: [CS], visibleOrgUnitIds: [],
  grantsAllow: new Set<string>(), assignedClassIds: new Set<string>(),
};
const don = (k: number) => `bao-luu/2026-10/${String(k).padStart(8, "a")}1111.pdf`;
const hv = (k: string) => `${T}hv-${k}`;
const gd = (k: string) => `${T}gd-${k}`;

async function datCauHinh(o: { effectiveDate?: string; bat?: boolean } = {}) {
  const up = (key: string, v: unknown) => db.systemSetting.upsert({ where: { key }, create: { key, valueJson: v as never }, update: { valueJson: v as never } });
  await up("pause.enabled", o.bat ?? true);
  await up("pause.effectiveDate", o.effectiveDate ?? "2026-09-01");
}

async function dọn() {
  await db.auditLog.deleteMany({ where: { entityId: { startsWith: T } } });
  await db.makeupNeed.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.attendance.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.studentReserveEvent.deleteMany({ where: { reserve: { studentId: { startsWith: T } } } });
  await db.studentReserve.deleteMany({ where: { studentId: { startsWith: T } } });
  await db.enrollmentAuditLog.deleteMany({ where: { enrollmentId: { startsWith: T } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: T } } });
  await db.classSession.deleteMany({ where: { classId: LOP } });
  await db.class.deleteMany({ where: { id: LOP } });
  await db.course.deleteMany({ where: { id: KHOA } });
  await db.student.deleteMany({ where: { id: { startsWith: T } } });
  await db.orgUnit.deleteMany({ where: { id: OU } });
  await db.center.deleteMany({ where: { id: CS } });
}

/**
 * Nền: lớp có 4 buổi đã qua (-30, -23, -16, -9 ngày).
 *  B — hvB PAUSED không hồ sơ · C — hvC ACTIVE, vắng cả 4 buổi, có 2 nhu cầu bù PENDING (buổi -16, -9)
 *  A — hvA PAUSED + dòng cũ cả-học-viên · N — hvN học bình thường (có mặt cả 4 buổi: KHÔNG là ứng viên)
 */
async function dung(o: { effectiveDate?: string; bat?: boolean } = {}) {
  await dọn();
  h.sync.mockReset();
  h.sync.mockImplementation(async () => {});
  await datCauHinh(o);
  await db.center.create({ data: { id: CS, name: "CS 8", slug: CS, address: "x" } });
  await db.orgUnit.create({ data: { id: OU, type: "CENTER", code: `${T}OU`, name: "ĐV 8", centerId: CS } });
  await db.course.create({ data: { id: KHOA, name: "Sata 3 B8", slug: KHOA, totalSessions: 48 } });
  await db.class.create({ data: { id: LOP, name: "Lớp B8", courseId: KHOA, centerId: CS, status: "ACTIVE", maxStudents: 20 } });
  const buoi: string[] = [];
  for (const [i, n] of [30, 23, 16, 9].entries()) {
    const id = `${T}s-${i}`;
    buoi.push(id);
    await db.classSession.create({ data: { id, classId: LOP, date: bay(n), centerId: CS } });
  }
  const mk = async (k: string, status: "ACTIVE" | "PAUSED") => {
    await db.student.create({ data: { id: hv(k), name: `HV ${k}`, centerId: CS, orgUnitId: OU, status } });
    await db.enrollment.create({ data: { id: gd(k), studentId: hv(k), classId: LOP, courseId: KHOA, status, centerId: CS } });
  };
  await mk("B", "PAUSED");
  await mk("C", "ACTIVE");
  await mk("A", "PAUSED");
  await mk("N", "ACTIVE");
  for (const s of buoi) {
    await db.attendance.create({ data: { studentId: hv("C"), sessionId: s, status: "ABSENT" } });
    await db.attendance.create({ data: { studentId: hv("N"), sessionId: s, status: "PRESENT" } });
  }
  await db.makeupNeed.create({ data: { id: `${T}n1`, studentId: hv("C"), classId: LOP, centerId: CS, missedSessionId: buoi[2]!, status: "PENDING" } });
  await db.makeupNeed.create({ data: { id: `${T}n2`, studentId: hv("C"), classId: LOP, centerId: CS, missedSessionId: buoi[3]!, status: "PENDING" } });
  await db.makeupNeed.create({ data: { id: `${T}n0`, studentId: hv("C"), classId: LOP, centerId: CS, missedSessionId: buoi[0]!, status: "PENDING" } });
  // Dòng CŨ cả-học-viên của hvA (đường cũ: không enrollmentId, chưa duyệt theo quy chế).
  await db.studentReserve.create({
    data: { id: `${T}r-cu`, studentId: hv("A"), enrollmentId: null, reason: "đường cũ", createdByName: "x", isActive: true, startedAt: bay(40), centerId: CS, type: "LEGACY" },
  });
}

const caB = (o: Partial<CaNhap> = {}): CaNhap => ({ nhom: "B", studentId: hv("B"), enrollmentId: gd("B"), reserveId: null, ngayBatDau: ymd(20), applicationFileKey: don(1), ...o });
const caC = (o: Partial<CaNhap> = {}): CaNhap => ({ nhom: "C", studentId: hv("C"), enrollmentId: gd("C"), reserveId: null, ngayBatDau: ymd(20), applicationFileKey: don(2), ...o });
const caA = (o: Partial<CaNhap> = {}): CaNhap => ({ nhom: "A", studentId: hv("A"), enrollmentId: gd("A"), reserveId: `${T}r-cu`, ngayBatDau: ymd(35), applicationFileKey: don(3), ...o });
const dem = async () => ({
  hoSo: await db.studentReserve.count({ where: { studentId: { startsWith: T } } }),
  suKien: await db.studentReserveEvent.count({ where: { reserve: { studentId: { startsWith: T } } } }),
  chuaXuLy: await db.studentReserve.count({ where: { studentId: { startsWith: T }, approvedAt: null } }),
  paused: await db.enrollment.count({ where: { id: { startsWith: T }, status: "PAUSED" } }),
  needPending: await db.makeupNeed.count({ where: { studentId: { startsWith: T }, status: "PENDING" } }),
});
const loi = (r: { ok: boolean; loi?: string[] }) => (r.ok ? "" : (r.loi ?? []).join(" | "));

describe.skipIf(!RUN_DB_TESTS)("[BL8-DB] nhập ca LEGACY", () => {
  afterAll(dọn);

  it("[BL8-DB-01] ứng viên: A = dòng cũ còn mở · B = PAUSED không hồ sơ (hvA đã được dòng cũ phủ nên KHÔNG ở B) · C = đúng bé vắng 4/4 (hvN có mặt thì không)", async () => {
    await dung();
    const u = await docUngVienLegacy(scopedDb(SIEU), NOW);
    expect(u.A.map((x) => x.reserveId)).toEqual([`${T}r-cu`]);
    expect(u.A[0]!.ghiDanhChon.map((g) => g.id)).toEqual([gd("A")]);
    expect(u.B.filter((x) => x.enrollmentId.startsWith(T)).map((x) => x.enrollmentId)).toEqual([gd("B")]);
    expect(u.C.filter((x) => x.enrollmentId.startsWith(T)).map((x) => x.enrollmentId)).toEqual([gd("C")]);
  });

  it("[BL8-DB-02] XEM TRƯỚC không ghi gì (đếm hồ sơ/sự kiện/PAUSED/nhu cầu bù trước = sau) và trả kế hoạch + cảnh báo cho cả ba nhóm", async () => {
    await dung();
    const truoc = await dem();
    const r = await xemTruocLegacy([caB(), caC(), caA()], NOW);
    expect(await dem()).toEqual(truoc);
    expect(r.ok, JSON.stringify(r.cac.map((c) => c.loi))).toBe(true);
    expect(r.cac.map((c) => c.ke!.hanhDong)).toEqual(["TAO_MOI", "TAO_MOI", "CAP_NHAT_DONG_CU"]);
    expect(r.cac[1]!.ke!.chuyenGhiDanhSangPaused).toBe(true);
    // hạn = 01/09/2026 + 6 tháng lịch = 01/03/2027 00:00 VN — chung cho cả ba, không phụ thuộc ngày bắt đầu
    for (const c of r.cac) expect(c.ke!.han.toISOString()).toBe("2027-02-28T17:00:00.000Z");
  });

  it("[BL8-DB-03] CHƯA khai ngày hiệu lực ⇒ cả xem trước lẫn ghi đều CHẶN, không ghi gì", async () => {
    await dung({ effectiveDate: "" });
    const truoc = await dem();
    const xt = await xemTruocLegacy([caB()], NOW);
    expect(xt.ok).toBe(false);
    expect(xt.cac[0]!.loi.join(" ")).toMatch(/Ngày hiệu lực quy chế/);
    const r = await nhapLegacy([caB()], NGUOI, NOW, DEPS);
    expect(r.ok).toBe(false);
    expect(loi(r)).toMatch(/Ngày hiệu lực quy chế/);
    expect(await dem()).toEqual(truoc);
  });

  it("[BL8-DB-04] cờ cơ sở TẮT ⇒ chặn, không ghi gì", async () => {
    await dung({ bat: false });
    const truoc = await dem();
    expect(loi(await nhapLegacy([caB()], NGUOI, NOW, DEPS))).toMatch(/chưa bật bảo lưu/);
    expect(await dem()).toEqual(truoc);
  });

  it("[BL8-DB-05] nhóm B: tạo hồ sơ LEGACY ACTIVE đời mới (approvedAt, hạn, đơn, ảnh chụp), sự kiện START, audit; ghi danh vẫn PAUSED; bé RỜI roster; nhu cầu bù PENDING của buổi trong khoảng bị thu hồi", async () => {
    await dung();
    const r = await nhapLegacy([caB()], NGUOI, NOW, DEPS);
    expect(r, loi(r)).toMatchObject({ ok: true, data: { soCa: 1 } });
    const hs = await db.studentReserve.findFirstOrThrow({ where: { studentId: hv("B") } });
    expect(hs).toMatchObject({ type: "LEGACY", status: "ACTIVE", isActive: true, enrollmentId: gd("B"), applicationFileKey: don(1), approvedById: NGUOI.id, centerId: CS });
    expect(hs.approvedAt?.toISOString()).toBe(NOW.toISOString());
    expect(vnNgay(hs.startedAt)).toBe(ymd(20));
    expect(hs.standardEndDate?.toISOString()).toBe("2027-02-28T17:00:00.000Z");
    expect(hs.policySnapshot).toBeTruthy();
    expect(await db.studentReserveEvent.count({ where: { reserveId: hs.id, kind: "START" } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: hs.id, action: "BAO_LUU_NHAP_LEGACY" } })).toBe(1);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: gd("B") } })).status).toBe("PAUSED");
    const trong = (await db.enrollment.findMany({ where: trongLop({ classId: LOP }, NOW), select: { id: true } })).map((e) => e.id);
    expect(trong).not.toContain(gd("B"));
    expect(trong).toContain(gd("N")); // đối chứng dương
    // Chat (luật 5): đổi roster ⇒ đồng bộ nhóm lớp TRONG CÙNG giao dịch — nhóm B không đi qua `datPausedKhiBatDau`, nên chỉ vòng đồng bộ cuối lo việc này.
    expect(h.sync.mock.calls.map((c) => c[1])).toContain(LOP);
  });

  it("[BL8-DB-06] nhóm C: ghi danh ACTIVE → PAUSED (nhật ký ghi danh), học viên PAUSED, hồ sơ LEGACY; nhu cầu bù PENDING từ ngày bắt đầu bị CANCELLED, buổi TRƯỚC ngày bắt đầu giữ nguyên PENDING; chat lớp được đồng bộ", async () => {
    await dung();
    const r = await nhapLegacy([caC({ ngayBatDau: ymd(20) })], NGUOI, NOW, DEPS);
    expect(r, loi(r)).toMatchObject({ ok: true });
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: gd("C") } })).status).toBe("PAUSED");
    expect((await db.student.findUniqueOrThrow({ where: { id: hv("C") } })).status).toBe("PAUSED");
    expect(await db.enrollmentAuditLog.count({ where: { enrollmentId: gd("C"), fromStatus: "ACTIVE", toStatus: "PAUSED" } })).toBe(1);
    const need = Object.fromEntries((await db.makeupNeed.findMany({ where: { studentId: hv("C") } })).map((n) => [n.id, n.status]));
    expect(need).toEqual({ [`${T}n0`]: "PENDING", [`${T}n1`]: "CANCELLED", [`${T}n2`]: "CANCELLED" });
    expect(h.sync.mock.calls.map((c) => c[1])).toContain(LOP);
  });

  it("[BL8-DB-07] nhóm A: CẬP NHẬT dòng cũ tại chỗ (không đẻ dòng mới): gắn ghi danh, LEGACY, ACTIVE, approvedAt, đơn, hạn", async () => {
    await dung();
    const r = await nhapLegacy([caA()], NGUOI, NOW, DEPS);
    expect(r, loi(r)).toMatchObject({ ok: true });
    expect(await db.studentReserve.count({ where: { studentId: hv("A") } })).toBe(1);
    const hs = await db.studentReserve.findUniqueOrThrow({ where: { id: `${T}r-cu` } });
    expect(hs).toMatchObject({ type: "LEGACY", status: "ACTIVE", isActive: true, enrollmentId: gd("A"), applicationFileKey: don(3), approvedById: NGUOI.id });
    expect(hs.approvedAt).not.toBeNull();
    expect(hs.standardEndDate?.toISOString()).toBe("2027-02-28T17:00:00.000Z");
    expect(vnNgay(hs.startedAt)).toBe(ymd(35));
  });

  it("[BL8-DB-08] TẤT CẢ HOẶC KHÔNG (lỗi nghiệp vụ): lô có một ca sai (thiếu đơn) ⇒ KHÔNG ca nào được ghi", async () => {
    await dung();
    const truoc = await dem();
    const r = await nhapLegacy([caB(), caC({ applicationFileKey: null })], NGUOI, NOW, DEPS);
    expect(r.ok).toBe(false);
    expect(loi(r)).toMatch(/Ca 2.*Thiếu đơn/);
    expect(await dem()).toEqual(truoc);
  });

  it("[BL8-DB-09] TẤT CẢ HOẶC KHÔNG (lỗi hạ tầng giữa chừng): chat ném khi đồng bộ ⇒ cuộn ngược CẢ lô — không hồ sơ, không PAUSED, nhu cầu bù còn PENDING", async () => {
    await dung();
    const truoc = await dem();
    h.sync.mockRejectedValue(new Error("chat down"));
    await expect(nhapLegacy([caB(), caC()], NGUOI, NOW, DEPS)).rejects.toThrow("chat down");
    expect(await dem()).toEqual(truoc);
    expect((await db.enrollment.findUniqueOrThrow({ where: { id: gd("C") } })).status).toBe("ACTIVE");
  });

  it("[BL8-DB-09b] rollback cũng đúng với nhóm KHÔNG đổi trạng thái ghi danh (A + B): chat ném ở vòng đồng bộ cuối ⇒ hồ sơ vừa ghi và dòng cũ vừa cập nhật đều cuộn ngược", async () => {
    await dung();
    const truoc = await dem();
    h.sync.mockRejectedValue(new Error("chat down"));
    await expect(nhapLegacy([caB(), caA()], NGUOI, NOW, DEPS)).rejects.toThrow("chat down");
    expect(await dem()).toEqual(truoc);
    expect((await db.studentReserve.findUniqueOrThrow({ where: { id: `${T}r-cu` } })).approvedAt).toBeNull();
  });

  it("[BL8-DB-10] nhập lần hai cùng ca bị chặn (đã có hồ sơ mở / đã xử lý) — không đẻ hồ sơ thứ hai", async () => {
    await dung();
    expect((await nhapLegacy([caB(), caA()], NGUOI, NOW, DEPS)).ok).toBe(true);
    const truoc = await dem();
    expect(loi(await nhapLegacy([caB({ applicationFileKey: don(11) })], NGUOI, NOW, DEPS))).toMatch(/đã có hồ sơ bảo lưu đang mở/);
    expect(loi(await nhapLegacy([caA({ applicationFileKey: don(12) })], NGUOI, NOW, DEPS))).toMatch(/đã được xử lý theo quy chế|đã có hồ sơ/);
    expect(await dem()).toEqual(truoc);
  });

  it("[BL8-DB-11] tệp đơn: kho chưa cấu hình / tệp không xác minh được ⇒ từ chối TRƯỚC giao dịch, không ghi gì; một tệp cho hai ca ⇒ từ chối", async () => {
    await dung();
    const truoc = await dem();
    expect(loi(await nhapLegacy([caB()], NGUOI, NOW, { ...DEPS, khoDaCauHinh: () => false }))).toMatch(/Kho tệp bảo lưu chưa cấu hình/);
    expect(loi(await nhapLegacy([caB()], NGUOI, NOW, { ...DEPS, xacMinhTep: async () => ({ ok: false, thongDiep: "Không thấy tệp trên kho — tải lên lại" }) }))).toMatch(/Không thấy tệp/);
    expect(loi(await nhapLegacy([caB({ applicationFileKey: don(5) }), caC({ applicationFileKey: don(5) })], NGUOI, NOW, DEPS))).toMatch(/hai ca/);
    expect(await dem()).toEqual(truoc);
  });

  it("[BL8-DB-12] sau khi nhập, ứng viên biến mất khỏi ba nhóm (không nhập đôi qua màn hình)", async () => {
    await dung();
    expect((await nhapLegacy([caB(), caC(), caA()], NGUOI, NOW, DEPS)).ok).toBe(true);
    const u = await docUngVienLegacy(scopedDb(SIEU), NOW);
    expect(u.A).toEqual([]);
    expect(u.B.filter((x) => x.enrollmentId.startsWith(T))).toEqual([]);
    expect(u.C.filter((x) => x.enrollmentId.startsWith(T))).toEqual([]);
  });
});

/** Ngày `yyyy-MM-dd` giờ VN của một thời điểm. */
function vnNgay(d: Date): string {
  return new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}
