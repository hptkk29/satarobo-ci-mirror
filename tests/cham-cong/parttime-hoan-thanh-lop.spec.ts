// tests/cham-cong/parttime-hoan-thanh-lop.spec.ts — HOÀN THÀNH LỚP SỚM ⇒ đóng buổi tương lai + phân công (chốt 13/10/2026),
// Postgres THẬT. Chạy đúng hàm mà `completeClassAction` gọi trong giao dịch (`dongBuoiTuongLaiKhiHoanThanh`) rồi đồng bộ
// sau commit như action. Dây nối action ↔ hàm ghim ở `lib/parttime/dong-bo-wiring.test.ts` `[P4-PRE-W]`.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/parttime-hoan-thanh-lop] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const ctl = vi.hoisted(() => ({ bat: true }));
vi.mock("../../lib/settings/service", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/settings/service")>();
  return {
    ...goc,
    getSetting: (async (key: string, opts?: { orgUnitId?: string | null }) =>
      /^shift\.parttime\w+Enabled$/.test(key) ? ctl.bat : goc.getSetting(key as never, opts)) as typeof goc.getSetting,
  };
});
// Cổng RBAC v2 của Parttime giả BẬT (prod/test chạy v2); `checkPermission` vẫn chạy theo cờ thật của môi trường test.
vi.mock("../../lib/parttime/cong-tac-doc", async (o) => ({ ...(await o<typeof import("../../lib/parttime/cong-tac-doc")>()), rbacV2ChoParttime: () => true }));

const TAG = "p4pre";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);
const NOW = vn("2026-11-05", "10:00");

d("[P4-PRE] hoàn thành lớp sớm — Postgres thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let svc: typeof import("../../lib/parttime/phan-cong-db");
  let dongBo: typeof import("../../lib/parttime/dong-bo");
  let hoanThanh: typeof import("../../lib/classes/dong-buoi-hoan-thanh");
  let cs = "";
  let gv = "";
  let khoa = "";
  const actor = { id: null as string | null, name: "QLCS p4pre" };

  async function damBaoChinhSach() {
    const sql = readFileSync(resolve(process.cwd(), "prisma/migrations/20261026090000_cong_parttime_nen/migration.sql"), "utf8");
    const m = /'(\{"loai":"SR_QD_238".*?\})'::jsonb/.exec(sql);
    if (!m) throw new Error("không thấy paramsJson SR.QD.238 trong migration");
    await db.compensationPolicyVersion.upsert({
      where: { code: "LEGACY" },
      update: {},
      create: { id: "cpv_legacy_truoc_15_10_2026", code: "LEGACY", name: "Cách tính cũ (trước SR.QD.238)", documentNo: "SR.QD.230", appliesTo: "PARTTIME", effectiveFrom: new Date("2000-01-01T00:00:00Z"), effectiveTo: new Date("2026-10-14T00:00:00Z"), paramsJson: { loai: "LEGACY" } },
    });
    await db.compensationPolicyVersion.upsert({
      where: { code: "SR.QD.238" },
      update: {},
      create: { id: "cpv_sr_qd_238", code: "SR.QD.238", name: "Chính sách thù lao Nhân sự Parttime", documentNo: "SR.QD.238", appliesTo: "PARTTIME", effectiveFrom: new Date("2026-10-15T00:00:00Z"), paramsJson: JSON.parse(m[1]) },
    });
  }

  async function cleanup() {
    await db.domainEvent.deleteMany({ where: { type: "parttime.staffing_dirty" } });
    const users = await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    const pcs = await db.sessionStaffAssignment.findMany({ where: { userId: { in: ids } }, select: { id: true } });
    if (pcs.length) {
      await db.$transaction([
        db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" DISABLE TRIGGER "StaffAssignmentAcceptance_bat_bien"`,
        db.staffAssignmentAcceptance.deleteMany({ where: { assignmentId: { in: pcs.map((p) => p.id) } } }),
        db.$executeRaw`ALTER TABLE "StaffAssignmentAcceptance" ENABLE TRIGGER "StaffAssignmentAcceptance_bat_bien"`,
      ]);
      await db.auditLog.deleteMany({ where: { entityType: "SessionStaffAssignment", entityId: { in: pcs.map((p) => p.id) } } });
    }
    await db.sessionStaffAssignment.deleteMany({ where: { userId: { in: ids } } });
    const cls = await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    const sessions = await db.classSession.findMany({ where: { classId: { in: cls.map((c) => c.id) } }, select: { id: true } });
    await db.auditLog.deleteMany({ where: { entityType: "ClassSession", entityId: { in: sessions.map((s) => s.id) } } });
    await db.classSession.deleteMany({ where: { classId: { in: cls.map((c) => c.id) } } });
    await db.class.deleteMany({ where: { id: { in: cls.map((c) => c.id) } } });
    await db.course.deleteMany({ where: { slug: { startsWith: TAG } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    await damBaoChinhSach();
    svc = await import("../../lib/parttime/phan-cong-db");
    dongBo = await import("../../lib/parttime/dong-bo");
    hoanThanh = await import("../../lib/classes/dong-buoi-hoan-thanh");
    cs = (await db.center.upsert({ where: { slug: `${TAG}-cs` }, update: {}, create: { slug: `${TAG}-cs`, name: "CS p4pre", address: "x", code: `${TAG}-cs` }, select: { id: true } })).id;
    await db.orgUnit.upsert({ where: { code: `${TAG}-cs` }, update: {}, create: { type: "CENTER", code: `${TAG}-cs`, name: "ĐV p4pre", path: `/${TAG}-cs/`, depth: 0, centerId: cs } });
    await cleanup();
    gv = (await db.user.create({ data: { email: `gv@${TAG}.test`, name: "GV p4pre", role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs }, select: { id: true } })).id;
    khoa = (await db.course.create({ data: { name: "Sata 3 p4pre", slug: `${TAG}-k` }, select: { id: true } })).id;
  });

  afterAll(async () => {
    await cleanup();
    await db.orgUnit.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.center.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });
    await db.$disconnect();
  });

  /** Lớp có: 1 buổi ĐÃ HỌC (03/11, COMPLETED, phân công COMPLETED), 1 buổi hôm nay chiều, 2 buổi tương lai. */
  async function dungLop() {
    const L = (
      await db.class.create({
        data: { name: `${TAG} L${Date.now() % 100000}`, courseId: khoa, centerId: cs, teacherId: gv, startTime: "17:30", endTime: "19:30", status: "ACTIVE" },
        select: { id: true },
      })
    ).id;
    const tao = (ymd: string, status: "SCHEDULED" | "COMPLETED" | "IN_PROGRESS" = "SCHEDULED", gio = "17:30") =>
      db.classSession.create({ data: { classId: L, centerId: cs, status, date: vn(ymd, gio) }, select: { id: true } });
    const qua = await tao("2026-11-03");
    // Hôm nay 05/11, hoàn thành lúc 10:00: buổi 08:00 đã dạy mà CHƯA bấm hoàn tất + một buổi đang IN_PROGRESS ⇒ KHÔNG đóng.
    const sangNay = await tao("2026-11-05", "SCHEDULED", "08:00");
    const dangDay = await tao("2026-11-05", "IN_PROGRESS", "09:30");
    const homNay = await tao("2026-11-05");
    const t1 = await tao("2026-11-07");
    const t2 = await tao("2026-11-09");
    await dongBo.dongBoNgay([qua, homNay, t1, t2].map((s) => ({ sourceType: "CLASS_SESSION" as const, sourceId: s.id })), "TAO_BUOI", actor);
    // Phân công dựng ra đã gán (ĐẢO 20/10/2026). Bản ghi xác nhận bất biến chỉ còn sinh từ LỜI MỜI CŨ trước 20/10 ⇒ hai buổi
    // dưới dựng đúng hình dạng đó để canh "đóng lớp không xoá bằng chứng xác nhận".
    const nhanLoiMoiCu = async (id: string) => {
      await db.sessionStaffAssignment.update({ where: { id }, data: { status: "WAITING_ACCEPTANCE" } }); // lời mời cũ trước 20/10
      const r = await db.$transaction((tx) => svc.quyetDinhNhanLop(tx, { assignmentId: id, nguoiBam: { id: gv, name: "x" }, quyetDinh: "ACCEPTED", phienBanDaXem: 1 }));
      if (!r.ok) throw new Error(r.loi);
    };
    // Buổi đã học: GV đã nhận, buổi chốt, phân công chốt (lịch sử).
    const pcQua = await db.sessionStaffAssignment.findFirstOrThrow({ where: { sourceId: qua.id } });
    await nhanLoiMoiCu(pcQua.id);
    await db.classSession.update({ where: { id: qua.id }, data: { status: "COMPLETED" } });
    await db.sessionStaffAssignment.update({ where: { id: pcQua.id }, data: { status: "COMPLETED" } });
    // Buổi tương lai t1: GV đã nhận (xác nhận bất biến phải còn sau khi đóng).
    const pcT1 = await db.sessionStaffAssignment.findFirstOrThrow({ where: { sourceId: t1.id } });
    await nhanLoiMoiCu(pcT1.id);
    return { L, qua: qua.id, sangNay: sangNay.id, dangDay: dangDay.id, homNay: homNay.id, t1: t1.id, t2: t2.id, pcQua: pcQua.id, pcT1: pcT1.id };
  }

  /** Đúng thứ `completeClassAction` làm: lớp → COMPLETED + đóng buổi trong MỘT giao dịch, rồi đồng bộ sau commit. */
  async function hoanThanhLop(L: string) {
    const r = await db.$transaction(async (tx) => {
      await tx.class.update({ where: { id: L }, data: { status: "COMPLETED" } });
      return hoanThanh.dongBuoiTuongLaiKhiHoanThanh(tx, { classId: L, now: NOW, actor, lyDo: "Hoàn thành lớp sớm (test)" });
    });
    if (r.canDongBo) await dongBo.dongBoNgay(r.nguonDongBo, "HOAN_THANH_LOP", actor);
    return r;
  }

  it("[P4-PRE-01..05] hoàn thành sớm: buổi CHƯA BẮT ĐẦU CANCELLED + audit; buổi sáng nay đã dạy / đang dạy KHÔNG đụng; phân công không còn sống; xác nhận cũ còn; buổi + phân công đã chốt nguyên vẹn", async () => {
    const x = await dungLop();
    const r = await hoanThanhLop(x.L);
    // 01 — buổi từ hôm nay trở đi đóng, buổi quá khứ không.
    expect(r.daDong.sort()).toEqual([x.homNay, x.t1, x.t2].sort());
    const tt = Object.fromEntries((await db.classSession.findMany({ where: { classId: x.L }, select: { id: true, status: true } })).map((s) => [s.id, s.status]));
    expect(tt).toEqual({ [x.qua]: "COMPLETED", [x.sangNay]: "SCHEDULED", [x.dangDay]: "IN_PROGRESS", [x.homNay]: "CANCELLED", [x.t1]: "CANCELLED", [x.t2]: "CANCELLED" });
    expect(await db.auditLog.count({ where: { entityType: "ClassSession", entityId: { in: r.daDong }, action: "CANCEL_SESSION" } })).toBe(3);
    // 02 — phân công của buổi tương lai không còn WAITING / ACCEPTED / ACTIVE; mỗi phân công một audit huỷ.
    const pcTuongLai = await db.sessionStaffAssignment.findMany({ where: { sourceId: { in: [x.homNay, x.t1, x.t2] } } });
    expect(pcTuongLai.map((p) => p.status)).toEqual(["CANCELLED", "CANCELLED", "CANCELLED"]);
    expect(await db.auditLog.count({ where: { entityId: { in: pcTuongLai.map((p) => p.id) }, action: "PT_ASSIGNMENT_CANCELLED" } })).toBe(3);
    // 03 — xác nhận nhận lớp (bất biến, lời mời cũ) của buổi đã đóng vẫn truy vấn được.
    expect(await db.staffAssignmentAcceptance.count({ where: { assignmentId: x.pcT1 } })).toBe(1);
    // 04 + 05 — buổi đã học và phân công đã chốt không bị viết lại.
    expect((await db.sessionStaffAssignment.findUniqueOrThrow({ where: { id: x.pcQua } })).status).toBe("COMPLETED");
    expect(await db.staffAssignmentAcceptance.count({ where: { assignmentId: x.pcQua } })).toBe(1);
    // Không ai nhận được phân công của buổi đã đóng nữa.
    const pcT2 = pcTuongLai.find((p) => p.sourceId === x.t2)!;
    const nhan = await db.$transaction((tx) => svc.quyetDinhNhanLop(tx, { assignmentId: pcT2.id, nguoiBam: { id: gv, name: "x" }, quyetDinh: "ACCEPTED", phienBanDaXem: pcT2.assignmentVersion }));
    expect(nhan.ok).toBe(false);
  });

  it("[P4-PRE-06] chạy lần hai: KHÔNG thêm buổi đóng, KHÔNG thêm audit, KHÔNG dấu đồng bộ mới", async () => {
    const x = await dungLop();
    await hoanThanhLop(x.L);
    const audit = await db.auditLog.count({ where: { OR: [{ entityType: "ClassSession" }, { entityType: "SessionStaffAssignment" }], entityId: { in: [x.homNay, x.t1, x.t2, x.qua] } } });
    const dau = await db.domainEvent.count({ where: { type: "parttime.staffing_dirty" } });
    const r2 = await db.$transaction((tx) => hoanThanh.dongBuoiTuongLaiKhiHoanThanh(tx, { classId: x.L, now: NOW, actor, lyDo: "lần hai" }));
    expect(r2).toEqual({ daDong: [], nguonDongBo: [], canDongBo: false });
    expect(await db.auditLog.count({ where: { OR: [{ entityType: "ClassSession" }, { entityType: "SessionStaffAssignment" }], entityId: { in: [x.homNay, x.t1, x.t2, x.qua] } } })).toBe(audit);
    expect(await db.domainEvent.count({ where: { type: "parttime.staffing_dirty" } })).toBe(dau);
  });

  it("[P4-PRE-07] công tắc TẮT: buổi vẫn đóng VÀ phân công đã có vẫn bị huỷ (đóng không phụ thuộc công tắc)", async () => {
    const x = await dungLop();
    ctl.bat = false;
    try {
      await hoanThanhLop(x.L);
    } finally {
      ctl.bat = true;
    }
    expect((await db.sessionStaffAssignment.findMany({ where: { sourceId: { in: [x.homNay, x.t1, x.t2] } } })).every((p) => p.status === "CANCELLED")).toBe(true);
  });
});
