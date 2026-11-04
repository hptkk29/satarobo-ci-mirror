// tests/cham-cong/parttime-control-tower.spec.ts — Công Parttime SR.QD.238 · P3b trên Postgres THẬT: lớp đọc của Control
// Tower (QLCS) + "Công việc của tôi" (GV), nhắc lại xác nhận, nhận kèm phiên bản đã xem.
//
// `db` được BỌC một extension ĐẾM mọi câu tra (vi.mock "lib/db") — ca `[PT3B-Q*]` đòi số câu tra không đổi khi số buổi
// tăng 10 lần (không N+1). Bốn công tắc `shift.parttime*Enabled` giả lập trong file, không ghi SystemSetting.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/parttime-control-tower] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const ctl = vi.hoisted(() => ({ bat: true, dem: 0 }));
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
vi.mock("../../lib/db", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../../lib/db")>();
  const dem = goc.db.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }: { args: unknown; query: (a: unknown) => Promise<unknown> }) {
          ctl.dem++;
          return query(args);
        },
      },
    },
  });
  return { ...goc, db: dem };
});

const TAG = "pt3bct";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);

d("[PT3B] Control Tower + Công việc của tôi — Postgres thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let svc: typeof import("../../lib/parttime/phan-cong-db");
  let dongBo: typeof import("../../lib/parttime/dong-bo");
  let bang: typeof import("../../lib/parttime/bang-phan-cong");
  let buoiGhi: typeof import("../../lib/classes/buoi-ghi");
  let cs1 = "";
  let cs2 = "";
  let gv = "";
  let gv2 = "";
  let ta = "";
  let khoa = "";
  const actor = { id: "", name: "QLCS pt3b" };

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
    await db.staffTimeLog.deleteMany({ where: { userId: { in: ids } } });
    const cls = await db.class.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
    const classIds = cls.map((c) => c.id);
    for (const id of classIds) {
      await db.domainEvent.deleteMany({ where: { type: "class.session_changed", payloadJson: { path: ["classId"], equals: id } } });
    }
    const sessions = await db.classSession.findMany({ where: { classId: { in: classIds } }, select: { id: true } });
    await db.auditLog.deleteMany({ where: { entityType: "ClassSession", entityId: { in: sessions.map((s) => s.id) } } });
    await db.classSession.deleteMany({ where: { classId: { in: classIds } } });
    await db.class.deleteMany({ where: { id: { in: classIds } } });
    await db.room.deleteMany({ where: { name: { startsWith: TAG } } });
    await db.course.deleteMany({ where: { slug: { startsWith: TAG } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    await damBaoChinhSach();
    svc = await import("../../lib/parttime/phan-cong-db");
    dongBo = await import("../../lib/parttime/dong-bo");
    bang = await import("../../lib/parttime/bang-phan-cong");
    buoiGhi = await import("../../lib/classes/buoi-ghi");
    const mkCs = (s: string) =>
      db.center.upsert({ where: { slug: `${TAG}-${s}` }, update: {}, create: { slug: `${TAG}-${s}`, name: `CS ${s}`, address: "x", code: `${TAG}-${s}` }, select: { id: true } });
    cs1 = (await mkCs("cs1")).id;
    cs2 = (await mkCs("cs2")).id;
    for (const [s, id] of [["cs1", cs1], ["cs2", cs2]] as const) {
      await db.orgUnit.upsert({ where: { code: `${TAG}-${s}` }, update: {}, create: { type: "CENTER", code: `${TAG}-${s}`, name: `ĐV ${s}`, path: `/${TAG}-${s}/`, depth: 0, centerId: id } });
    }
    await cleanup();
    const mk = (email: string, name: string, centerId = cs1) =>
      db.user.create({ data: { email: `${email}@${TAG}.test`, name, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId }, select: { id: true } });
    gv = (await mk("gv", "GV pt3b")).id;
    gv2 = (await mk("gv2", "GV2 pt3b")).id;
    ta = (await mk("ta", "TA pt3b")).id;
    actor.id = (await mk("ql", "QL pt3b")).id;
    khoa = (await db.course.create({ data: { name: "Sata 3 pt3b", slug: `${TAG}-k` }, select: { id: true } })).id;
  });

  afterAll(async () => {
    await cleanup();
    await db.orgUnit.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await db.center.deleteMany({ where: { slug: { startsWith: `${TAG}-` } } });
    await db.$disconnect();
  });

  let soLop = 0;
  const lopMoi = async (p: { centerId?: string; teacherId?: string; assistantId?: string | null; roomId?: string | null } = {}) => {
    soLop++;
    return (
      await db.class.create({
        data: { name: `${TAG} L${soLop}`, courseId: khoa, centerId: p.centerId ?? cs1, teacherId: p.teacherId ?? gv, assistantId: p.assistantId ?? null, roomId: p.roomId ?? null, startTime: "17:30", endTime: "19:30" },
        select: { id: true },
      })
    ).id;
  };
  const buoiMoi = (classId: string, ymd: string, p: { gio?: string; centerId?: string; substituteTeacherId?: string | null; actualTeacherId?: string | null; status?: "SCHEDULED" | "COMPLETED" } = {}) =>
    db.classSession.create({
      data: { classId, centerId: p.centerId ?? cs1, status: p.status ?? "SCHEDULED", date: vn(ymd, p.gio ?? "17:30"), substituteTeacherId: p.substituteTeacherId ?? null, actualTeacherId: p.actualTeacherId ?? null },
      select: { id: true, date: true },
    });
  const lop = (id: string) => ({ sourceType: "CLASS_SESSION" as const, sourceId: id });
  const dong = (ids: string[]) => dongBo.dongBoNgay(ids.map(lop), "TAO_BUOI", actor);
  const quyet = (assignmentId: string, userId: string, phienBanDaXem: number) =>
    db.$transaction((tx) => svc.quyetDinhNhanLop(tx, { assignmentId, nguoiBam: { id: userId, name: "x" }, quyetDinh: "ACCEPTED", phienBanDaXem }));
  const pcMain = (sourceId: string) => db.sessionStaffAssignment.findFirstOrThrow({ where: { sourceId, role: "MAIN_TEACHER", status: { in: ["WAITING_ACCEPTANCE", "ACCEPTED"] } } });
  /** Lời mời cũ trước 20/10 (ĐẢO 20/10/2026: phân công tạo ra đã gán) — nhắc / nhận chỉ còn cho dòng WAITING_ACCEPTANCE cũ. */
  const moiCu = (id: string) => db.sessionStaffAssignment.update({ where: { id }, data: { status: "WAITING_ACCEPTANCE" } });

  it("[PT3B-Q1] Control Tower: số câu tra KHÔNG đổi khi số buổi tăng 10 lần (3 buổi ở CS1 vs 30 buổi ở CS2)", async () => {
    const L1 = await lopMoi({ assistantId: ta });
    const L2 = await lopMoi({ centerId: cs2, teacherId: gv2, assistantId: ta });
    const ngay = (i: number) => `2026-11-0${2 + (i % 7)}`;
    const nho = await Promise.all([0, 1, 2].map((i) => buoiMoi(L1, ngay(i))));
    const lon = await Promise.all(Array.from({ length: 30 }, (_, i) => buoiMoi(L2, ngay(i), { centerId: cs2, gio: `${String(8 + Math.floor(i / 7) * 2).padStart(2, "0")}:00` })));
    await dong([...nho, ...lon].map((s) => s.id));
    await db.staffTimeLog.createMany({
      data: [cs1, cs2].map((c) => ({ userId: c === cs1 ? gv : gv2, centerId: c, direction: "CHECK_IN" as const, loggedAt: vn("2026-11-02", "17:00"), workDate: new Date("2026-11-02T00:00:00Z") })),
    });
    const doDem = async (centerId: string) => {
      ctl.dem = 0;
      const r = await bang.docTuanPhanCong({ centerId, tu: "2026-11-02", den: "2026-11-08" });
      return { soCau: ctl.dem, soBuoi: r.length };
    };
    const a = await doDem(cs1);
    const b = await doDem(cs2);
    expect(a.soBuoi).toBe(3);
    expect(b.soBuoi).toBe(30);
    expect(a.soCau).toBeGreaterThan(5); // bộ đếm thật sự đếm (không phải 0 == 0)
    expect(b.soCau).toBe(a.soCau);
  });

  it("[PT3B-Q2] Công việc của tôi: số câu tra KHÔNG đổi theo số phân công", async () => {
    const doDem = async (userId: string) => {
      ctl.dem = 0;
      const r = await bang.docCongViecCuaToi({ userId, homNay: "2026-11-02", soNgayDaQua: 30, soNgaySapToi: 14 });
      return { soCau: ctl.dem, so: r.length };
    };
    const a = await doDem(gv); // 3 MAIN
    const b = await doDem(gv2); // 30 MAIN
    expect(a.so).toBe(3);
    expect(b.so).toBe(30);
    expect(a.soCau).toBeGreaterThan(3);
    expect(b.soCau).toBe(a.soCau);
  });

  it("[PT3B-02] lớp ĐÃ HUỶ mà buổi vẫn SCHEDULED ⇒ màn đọc nói 'đã đóng' như bộ đồng bộ; người dạy thay là MAIN mặc định ở CẢ HAI nơi", async () => {
    const L = await lopMoi();
    const s = await buoiMoi(L, "2026-11-03", { substituteTeacherId: gv2 });
    const tu = "2026-11-03";
    let r = (await bang.docTuanPhanCong({ centerId: cs1, tu, den: tu })).find((b) => b.sourceId === s.id)!;
    const dongBoThay = await db.$transaction((tx) => svc.docBuoi(tx, lop(s.id)));
    expect(r.macDinhMainId).toBe(gv2);
    expect(r.macDinhMainKieu).toBe("SUBSTITUTE");
    expect(dongBoThay).toMatchObject({ macDinhMainId: r.macDinhMainId, macDinhMainKieu: r.macDinhMainKieu, tinhTrang: r.tinhTrang });
    await db.class.update({ where: { id: L }, data: { status: "CANCELLED" } });
    r = (await bang.docTuanPhanCong({ centerId: cs1, tu, den: tu })).find((b) => b.sourceId === s.id)!;
    expect(r).toMatchObject({ tinhTrang: "DA_DONG", lyDoDong: "Lớp đã huỷ", daDong: true });
    expect((await db.$transaction((tx) => svc.docBuoi(tx, lop(s.id))))?.tinhTrang).toBe("DA_DONG");
  });

  it("[PT3B-03] phòng hiệu lực + kế hoạch chạy thử (công tắc tắt: TẠO hiện trong xem trước, KHÔNG ghi gì)", async () => {
    const phong = await db.room.create({ data: { name: `${TAG} P302`, code: `${TAG}-P302`, centerId: cs1 }, select: { id: true } });
    const L = await lopMoi({ roomId: phong.id, assistantId: ta });
    const s = await buoiMoi(L, "2026-11-04");
    ctl.bat = false;
    try {
      const r = (await bang.docTuanPhanCong({ centerId: cs1, tu: "2026-11-04", den: "2026-11-04" })).find((b) => b.sourceId === s.id)!;
      expect(r.phong).toBe(`${TAG} P302`);
      expect(r.keHoach.filter((x) => x.loai === "TAO").map((x) => (x.loai === "TAO" ? x.role : "")).sort()).toEqual(["MAIN_TEACHER", "TEACHING_ASSISTANT"]);
      expect(await db.sessionStaffAssignment.count({ where: { sourceId: s.id } })).toBe(0);
    } finally {
      ctl.bat = true;
    }
  });

  it("[PT3B-04] nhắc lại: chỉ lời mời CŨ đang chờ (phân công đã gán thì không nhắc); khoá thông báo mang phiên bản; có audit", async () => {
    const L = await lopMoi();
    const s = await buoiMoi(L, "2026-11-05");
    await dong([s.id]);
    const pc = await pcMain(s.id);
    // Phân công mới đã gán ⇒ không có gì để nhắc, không audit.
    expect((await db.$transaction((tx) => svc.nhacXacNhan(tx, { id: pc.id, actor }))).ok).toBe(false);
    expect(await db.auditLog.count({ where: { entityId: pc.id, action: "PT_ACCEPTANCE_REMINDED" } })).toBe(0);
    await moiCu(pc.id); // lời mời cũ trước 20/10
    const r = await db.$transaction((tx) => svc.nhacXacNhan(tx, { id: pc.id, actor }));
    expect(r).toMatchObject({ ok: true, thongBao: [{ userId: gv, dedupeKey: `parttime.nhac:${pc.id}:v1` }] });
    expect(await db.auditLog.count({ where: { entityId: pc.id, action: "PT_ACCEPTANCE_REMINDED" } })).toBe(1);
    expect((await quyet(pc.id, gv, 1)).ok).toBe(true);
    const r2 = await db.$transaction((tx) => svc.nhacXacNhan(tx, { id: pc.id, actor }));
    expect(r2.ok).toBe(false);
  });

  it("[PT3B-05] lời mời CŨ nhận kèm phiên bản: lịch đổi giữa lúc xem (v1) và lúc bấm ⇒ TỪ CHỐI; nhận đúng phiên bản mới ⇒ được", async () => {
    const L = await lopMoi();
    const s = await buoiMoi(L, "2026-11-06");
    await dong([s.id]);
    const pc = await pcMain(s.id);
    await moiCu(pc.id); // lời mời cũ trước 20/10 — đổi lịch giữ nguyên trạng thái chờ của nó
    await db.$transaction((tx) =>
      buoiGhi.dichNgayBuoi(tx, { classId: L, moves: [{ id: s.id, oldDate: s.date, newDate: new Date(s.date.getTime() + 86_400_000) }], xoaSuaTay: false }),
    );
    await dong([s.id]);
    expect(await db.sessionStaffAssignment.findUniqueOrThrow({ where: { id: pc.id } })).toMatchObject({ assignmentVersion: 2, status: "WAITING_ACCEPTANCE" });
    const cu = await quyet(pc.id, gv, 1);
    expect(cu.ok).toBe(false);
    expect(await db.staffAssignmentAcceptance.count({ where: { assignmentId: pc.id } })).toBe(0);
    expect((await quyet(pc.id, gv, 2)).ok).toBe(true);
  });

  it("[PT3B-06] Công việc của tôi: có mặt trước = giờ bắt đầu − chuẩn bị (10'); đổi lịch ⇒ phiên bản 2, vẫn đã gán; đối soát người đứng lớp", async () => {
    const L = await lopMoi({ teacherId: gv });
    const sap = await buoiMoi(L, "2026-11-07");
    const qua = await buoiMoi(L, "2026-10-28");
    await dong([sap.id, qua.id]);
    const pcQua = await pcMain(qua.id);
    expect(pcQua.status).toBe("ACCEPTED");
    // Người khác thực dạy buổi đã qua.
    await db.classSession.update({ where: { id: qua.id }, data: { actualTeacherId: gv2, status: "COMPLETED" } });
    await db.$transaction((tx) =>
      buoiGhi.dichNgayBuoi(tx, { classId: L, moves: [{ id: sap.id, oldDate: sap.date, newDate: new Date(sap.date.getTime() + 86_400_000) }], xoaSuaTay: false }),
    );
    await dong([sap.id]);
    const ds = await bang.docCongViecCuaToi({ userId: gv, homNay: "2026-11-02", soNgayDaQua: 30, soNgaySapToi: 14 });
    const moi = ds.find((x) => x.sourceType === "CLASS_SESSION" && x.ngay === "2026-11-08")!;
    expect(moi).toMatchObject({ coMatTruoc: "17:20", phienBan: 2, status: "ACCEPTED" });
    const daQua = ds.find((x) => x.id === pcQua.id)!;
    expect(daQua.nguoiDungLop).toEqual({ id: gv2, ten: "GV2 pt3b" });
  });

  // GHIM (it.fails — CHƯA QUYẾT, báo chủ dự án): trước 20/10 phân công đổi lịch về WAITING_ACCEPTANCE nên "Công việc của tôi" in
  // nhãn "đổi lịch" + trước/sau (đọc từ audit). `bang-phan-cong.ts` vẫn chỉ dựng hai trường đó cho `status === "WAITING_ACCEPTANCE"
  // && assignmentVersion > 1` ⇒ từ ĐẢO 20/10 phân công đã gán bị dời lịch KHÔNG còn hiện trước/sau cho giáo viên (chỉ còn chuông).
  // Nếu chủ dự án chốt "vẫn phải hiện" ⇒ vá rồi ca này ĐỎ, buộc gỡ `.fails`. Chốt "không cần" ⇒ xoá ca.
  it("[PT3B-06b] phân công ĐÃ GÁN bị dời lịch ⇒ Công việc của tôi vẫn hiện nhãn đổi lịch + trước/sau", async () => {
    const L = await lopMoi({ teacherId: gv });
    const sap = await buoiMoi(L, "2026-11-09");
    await dong([sap.id]);
    await db.$transaction((tx) =>
      buoiGhi.dichNgayBuoi(tx, { classId: L, moves: [{ id: sap.id, oldDate: sap.date, newDate: new Date(sap.date.getTime() + 86_400_000) }], xoaSuaTay: false }),
    );
    await dong([sap.id]);
    const ds = await bang.docCongViecCuaToi({ userId: gv, homNay: "2026-11-02", soNgayDaQua: 30, soNgaySapToi: 14 });
    const moi = ds.find((x) => x.sourceType === "CLASS_SESSION" && x.ngay === "2026-11-10")!;
    expect(moi).toMatchObject({ phienBan: 2, status: "ACCEPTED", doiLich: true });
    expect(moi.thayDoi).toEqual({ truoc: { ngay: "2026-11-09", gioBatDau: "17:30", gioKetThuc: "19:30" }, sau: { ngay: "2026-11-10", gioBatDau: "17:30", gioKetThuc: "19:30" } });
  });
});
