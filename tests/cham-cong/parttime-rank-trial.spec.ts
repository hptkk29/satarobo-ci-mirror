// [RT-DB-*] — đề xuất / duyệt Rank, chứng nhận Trial, chính sách hỗ trợ Trial trên Postgres THẬT (lưới phân công GV · PR4).
// Thuần: lib/parttime/rank-trial-luat.test.ts. Chạy: TEST_DATABASE_URL=postgresql://…/satarobo_test… pnpm test:cham-cong-db
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { laDbCucBo, laTenDbTest } from "../../lib/security/url-db-cuc-bo";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const isLocal = laDbCucBo(DB_URL) && laTenDbTest(DB_URL);
const d = isLocal ? describe : describe.skip;
if (!isLocal) console.warn(`[cham-cong/parttime-rank-trial] SKIP: DATABASE_URL không trỏ Postgres local satarobo_test`);

const TAG = "ptrt";
const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);
const NOW = vn("2026-11-02", "09:00"); // hôm nay = 02/11/2026

d("[RT-DB] Rank · chứng nhận Trial · chính sách hỗ trợ Trial — Postgres thật", () => {
  const db = new PrismaClient({ datasourceUrl: DB_URL });
  let rt: typeof import("../../lib/parttime/rank-trial-db");
  // Ghi qua CLIENT ỨNG DỤNG (`lib/db`, có ghi kép orgUnitId) — PrismaClient trần của test sẽ đi vòng qua lớp đó.
  let appDb: typeof import("../../lib/db").db;
  let cs = "";
  let gv = "";
  let qlcs = "";
  let bld = "";

  async function cleanup() {
    const ids = (await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } })).map((u) => u.id);
    await db.auditLog.deleteMany({ where: { entityType: { in: ["TeacherRankProposal", "TrialCertificate", "TrialSupportPolicy"] }, actorId: { in: ids } } });
    await db.teacherRankProposal.deleteMany({ where: { userId: { in: ids } } });
    await db.teacherRankHistory.deleteMany({ where: { userId: { in: ids } } });
    await db.trialCertificate.deleteMany({ where: { userId: { in: ids } } });
    await db.trialSupportPolicy.deleteMany({ where: { approvedById: { in: ids } } });
    if (cs) await db.attendancePeriod.deleteMany({ where: { centerId: cs } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    rt = await import("../../lib/parttime/rank-trial-db");
    appDb = (await import("../../lib/db")).db;
    cs = (await db.center.upsert({ where: { slug: `${TAG}-cs` }, update: {}, create: { slug: `${TAG}-cs`, name: "CS rt", address: "x", code: `${TAG}-cs` }, select: { id: true } })).id;
    await db.orgUnit.upsert({ where: { code: `${TAG}-cs` }, update: {}, create: { type: "CENTER", code: `${TAG}-cs`, name: "ĐV rt", path: `/${TAG}-cs/`, depth: 0, centerId: cs } });
    await cleanup();
    const mk = (e: string) => db.user.create({ data: { email: `${e}@${TAG}.test`, name: e, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs }, select: { id: true } });
    gv = (await mk("gv")).id;
    qlcs = (await mk("qlcs")).id;
    bld = (await mk("bld")).id;
  });
  afterAll(async () => {
    await cleanup();
    await db.orgUnit.deleteMany({ where: { code: `${TAG}-cs` } });
    await db.center.deleteMany({ where: { slug: `${TAG}-cs` } });
    await db.$disconnect();
  });

  const tx = <T>(fn: (t: import("@prisma/client").Prisma.TransactionClient) => Promise<T>) => appDb.$transaction(fn);
  const A = (id: string) => ({ id, name: id });

  it("[RT-DB-01] đề xuất → duyệt ⇒ THÊM TeacherRankHistory từ ngày đề xuất; Rank cũ giữ cho ngày trước; orgUnitId tự điền; audit 2 dòng", async () => {
    const r = await tx((t) => rt.deXuatRank(t, { userId: gv, centerId: cs, proposedRank: 3, effectiveFrom: "2026-11-15", basis: "26 tháng · 96% · đạt năng lực", actor: A(qlcs), now: NOW }));
    expect(r).toMatchObject({ ok: true });
    const id = (r as { id: string }).id;
    expect(await db.teacherRankProposal.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "PROPOSED", currentRank: 1, proposedRank: 3 });
    expect((await db.teacherRankProposal.findUniqueOrThrow({ where: { id } })).orgUnitId).not.toBeNull();
    // Người lập không tự duyệt.
    expect(await tx((t) => rt.quyetRank(t, { id, duyet: true, ghiChu: null, actor: A(qlcs), now: NOW }))).toMatchObject({ ok: false });
    expect(await tx((t) => rt.quyetRank(t, { id, duyet: true, ghiChu: "ok", actor: A(bld), now: NOW }))).toEqual({ ok: true });
    const h = await db.teacherRankHistory.findMany({ where: { userId: gv } });
    expect(h.map((x) => ({ rank: x.rank, tu: x.effectiveFrom.toISOString().slice(0, 10) }))).toEqual([{ rank: 3, tu: "2026-11-15" }]);
    expect(await db.teacherRankProposal.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "APPROVED", decidedById: bld, rankHistoryId: h[0]!.id });
    expect(await db.auditLog.count({ where: { entityType: "TeacherRankProposal", entityId: id } })).toBe(2);
    // Duyệt lần hai (đề xuất không còn chờ) ⇒ từ chối, không thêm lịch sử.
    expect(await tx((t) => rt.quyetRank(t, { id, duyet: true, ghiChu: null, actor: A(bld), now: NOW }))).toMatchObject({ ok: false });
    expect(await db.teacherRankHistory.count({ where: { userId: gv } })).toBe(1);
  });

  it("[RT-DB-02] một GV tối đa một đề xuất CHỜ (chỉ mục từng phần ở DB chặn cả khi luật ứng dụng bị vượt); hồi tố / kỳ khoá ⇒ từ chối", async () => {
    const r1 = await tx((t) => rt.deXuatRank(t, { userId: gv, centerId: cs, proposedRank: 4, effectiveFrom: "2026-12-01", basis: "36 tháng · 97% · R&D", actor: A(qlcs), now: NOW }));
    expect(r1).toMatchObject({ ok: true });
    expect(await tx((t) => rt.deXuatRank(t, { userId: gv, centerId: cs, proposedRank: 2, effectiveFrom: "2026-12-01", basis: "đề xuất thứ hai", actor: A(qlcs), now: NOW }))).toMatchObject({ ok: false });
    await expect(
      db.teacherRankProposal.create({ data: { userId: gv, centerId: cs, currentRank: 3, proposedRank: 2, effectiveFrom: new Date("2026-12-01T00:00:00Z"), basis: "vượt luật", proposedById: qlcs } }),
    ).rejects.toThrow();
    expect(await tx((t) => rt.quyetRank(t, { id: (r1 as { id: string }).id, duyet: false, ghiChu: "chưa đủ 36 tháng", actor: A(bld), now: NOW }))).toEqual({ ok: true });
    expect(await tx((t) => rt.deXuatRank(t, { userId: gv, centerId: cs, proposedRank: 4, effectiveFrom: "2026-11-01", basis: "hồi tố ngày hôm qua", actor: A(qlcs), now: NOW }))).toMatchObject({ ok: false });
    await db.attendancePeriod.create({ data: { centerId: cs, periodKey: "2026-12", status: "LOCKED" } });
    expect(await tx((t) => rt.deXuatRank(t, { userId: gv, centerId: cs, proposedRank: 4, effectiveFrom: "2026-12-05", basis: "rơi vào kỳ đã khoá", actor: A(qlcs), now: NOW }))).toMatchObject({
      ok: false,
      loi: expect.stringMatching(/khoá/),
    });
  });

  it("[RT-DB-02b] duyệt khi đã có Rank khác CÙNG ngày hiệu lực ⇒ NÉM RANK_TRUNG_NGAY và ROLLBACK (đề xuất vẫn CHỜ, không thêm lịch sử)", async () => {
    const ngay = new Date("2027-01-04T00:00:00Z");
    await db.teacherRankHistory.create({ data: { userId: gv, rank: 2, effectiveFrom: ngay, reason: "đã có" } });
    const r = await tx((t) => rt.deXuatRank(t, { userId: gv, centerId: cs, proposedRank: 4, effectiveFrom: "2027-01-04", basis: "trùng ngày với dòng có sẵn", actor: A(qlcs), now: NOW }));
    const id = (r as { id: string }).id;
    await expect(tx((t) => rt.quyetRank(t, { id, duyet: true, ghiChu: null, actor: A(bld), now: NOW }))).rejects.toThrow("RANK_TRUNG_NGAY");
    expect(await db.teacherRankProposal.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "PROPOSED", decidedById: null });
    expect(await db.teacherRankHistory.count({ where: { userId: gv, effectiveFrom: ngay } })).toBe(1);
    await tx((t) => rt.quyetRank(t, { id, duyet: false, ghiChu: "trùng ngày, đề xuất lại", actor: A(bld), now: NOW }));
  });

  it("[RT-DB-03] chứng nhận: cấp → thu hồi từ ngày D ⇒ effectiveTo = D−1, dòng giữ nguyên; cấp chồng ⇒ từ chối; thu hồi lùi quá khứ ⇒ từ chối", async () => {
    const c = await tx((t) => rt.capChungNhan(t, { userId: gv, code: "TR-01", effectiveFrom: "2026-11-02", note: null, actor: A(bld), now: NOW }));
    expect(c).toMatchObject({ ok: true });
    const id = (c as { id: string }).id;
    expect(await tx((t) => rt.capChungNhan(t, { userId: gv, code: "TR-02", effectiveFrom: "2026-11-20", note: null, actor: A(bld), now: NOW }))).toMatchObject({ ok: false });
    expect(await tx((t) => rt.thuHoiChungNhan(t, { id, tuNgay: "2026-11-01", lyDo: "lùi quá khứ", actor: A(bld), now: NOW }))).toMatchObject({ ok: false });
    expect(await tx((t) => rt.thuHoiChungNhan(t, { id, tuNgay: "2026-11-10", lyDo: "nghỉ việc", actor: A(bld), now: NOW }))).toEqual({ ok: true });
    const row = await db.trialCertificate.findUniqueOrThrow({ where: { id } });
    expect(row.effectiveTo?.toISOString().slice(0, 10)).toBe("2026-11-09");
    expect(row.revokedById).toBe(bld);
    const n = await rt.docNguonHoTroTrial([gv]);
    expect([n.chungNhanTai(gv, "2026-11-09"), n.chungNhanTai(gv, "2026-11-10")]).toEqual([true, false]);
  });

  it("[RT-DB-04] chính sách: đặt chung từ 05/11 rồi riêng cơ sở TẮT từ 20/11 ⇒ ngày 10/11 bật 30k, ngày 25/11 tắt; đặt chung mới ⇒ dòng chung cũ đóng ở F−1", async () => {
    expect(await tx((t) => rt.datChinhSachTrial(t, { centerId: null, enabled: true, amountPerStudent: 30000, effectiveFrom: "2026-11-05", reason: "SR.QD.238 §6 áp từ 05/11", actor: A(bld), now: NOW }))).toMatchObject({ ok: true });
    expect(await tx((t) => rt.datChinhSachTrial(t, { centerId: cs, enabled: false, amountPerStudent: 30000, effectiveFrom: "2026-11-20", reason: "tạm dừng ở cơ sở này", actor: A(bld), now: NOW }))).toMatchObject({ ok: true });
    let n = await rt.docNguonHoTroTrial([]);
    expect(n.chinhSachTai(cs, "2026-11-10")).toEqual({ bat: true, mucMoiHocVien: 30000 });
    expect(n.chinhSachTai(cs, "2026-11-25")).toEqual({ bat: false, mucMoiHocVien: 30000 });
    expect(n.chinhSachTai(cs, "2026-11-01")).toBeNull();
    expect(await tx((t) => rt.datChinhSachTrial(t, { centerId: null, enabled: true, amountPerStudent: 40000, effectiveFrom: "2026-12-01", reason: "nâng mức từ tháng 12", actor: A(bld), now: NOW }))).toMatchObject({ ok: true });
    n = await rt.docNguonHoTroTrial([]);
    expect(n.chinhSachTai("cs-khac", "2026-11-30")).toEqual({ bat: true, mucMoiHocVien: 30000 });
    expect(n.chinhSachTai("cs-khac", "2026-12-01")).toEqual({ bat: true, mucMoiHocVien: 40000 });
    expect(await tx((t) => rt.datChinhSachTrial(t, { centerId: null, enabled: false, amountPerStudent: 0, effectiveFrom: "2026-10-30", reason: "hồi tố bị chặn", actor: A(bld), now: NOW }))).toMatchObject({ ok: false });
  });
});
