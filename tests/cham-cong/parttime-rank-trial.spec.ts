// [RT-DB-*] — đổi Rank (chốt 25/10/2026: áp ngay, không đề xuất / chờ duyệt), chứng nhận Trial, chính sách hỗ trợ Trial trên Postgres THẬT (lưới phân công GV · PR4).
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
  let cs2 = "";
  let gv = "";
  let qlcs = "";
  let bld = "";

  async function cleanup() {
    const ids = (await db.user.findMany({ where: { email: { endsWith: `@${TAG}.test` } }, select: { id: true } })).map((u) => u.id);
    await db.auditLog.deleteMany({ where: { entityType: { in: ["TeacherRankProposal", "TeacherRankHistory", "TrialCertificate", "TrialSupportPolicy"] }, actorId: { in: ids } } });
    await db.teacherRankProposal.deleteMany({ where: { userId: { in: ids } } });
    await db.teacherRankHistory.deleteMany({ where: { userId: { in: ids } } });
    await db.trialCertificate.deleteMany({ where: { userId: { in: ids } } });
    await db.trialSupportPolicy.deleteMany({ where: { approvedById: { in: ids } } });
    if (cs) await db.attendancePeriod.deleteMany({ where: { centerId: cs } });
    if (cs2) await db.attendancePeriod.deleteMany({ where: { centerId: cs2 } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    rt = await import("../../lib/parttime/rank-trial-db");
    appDb = (await import("../../lib/db")).db;
    cs = (await db.center.upsert({ where: { slug: `${TAG}-cs` }, update: {}, create: { slug: `${TAG}-cs`, name: "CS rt", address: "x", code: `${TAG}-cs` }, select: { id: true } })).id;
    await db.orgUnit.upsert({ where: { code: `${TAG}-cs` }, update: {}, create: { type: "CENTER", code: `${TAG}-cs`, name: "ĐV rt", path: `/${TAG}-cs/`, depth: 0, centerId: cs } });
    cs2 = (await db.center.upsert({ where: { slug: `${TAG}-cs2` }, update: {}, create: { slug: `${TAG}-cs2`, name: "CS2 rt", address: "x", code: `${TAG}-cs2` }, select: { id: true } })).id;
    await cleanup();
    const mk = (e: string) => db.user.create({ data: { email: `${e}@${TAG}.test`, name: e, role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs }, select: { id: true } });
    gv = (await mk("gv")).id;
    qlcs = (await mk("qlcs")).id;
    bld = (await mk("bld")).id;
  });
  afterAll(async () => {
    await cleanup();
    await db.orgUnit.deleteMany({ where: { code: `${TAG}-cs` } });
    await db.center.deleteMany({ where: { slug: { in: [`${TAG}-cs`, `${TAG}-cs2`] } } });
    await db.$disconnect();
  });

  const tx = <T>(fn: (t: import("@prisma/client").Prisma.TransactionClient) => Promise<T>) => appDb.$transaction(fn);
  const A = (id: string) => ({ id, name: id });

  it("[RT-DB-01] đổi Rank ÁP NGAY ⇒ THÊM TeacherRankHistory từ ngày chọn; đề xuất đời cũ còn CHỜ bị đóng; audit 1 dòng; trùng Rank ⇒ từ chối", async () => {
    // Đề xuất đời cũ (trước 25/10) còn treo — đổi Rank trực tiếp phải đóng nó, không để ai "duyệt" nó sau này.
    const cu = await appDb.teacherRankProposal.create({
      data: { userId: gv, centerId: cs, currentRank: 1, proposedRank: 2, effectiveFrom: new Date("2026-11-20T00:00:00Z"), basis: "đề xuất đời cũ", proposedById: qlcs },
      select: { id: true },
    });
    const r = await tx((t) => rt.doiRank(t, { userId: gv, rank: 3, effectiveFrom: "2026-11-02", lyDo: "26 tháng · 96% · đạt năng lực", coSoIds: [cs], actor: A(bld), now: NOW }));
    expect(r).toMatchObject({ ok: true });
    const h = await db.teacherRankHistory.findMany({ where: { userId: gv } });
    expect(h.map((x) => ({ rank: x.rank, tu: x.effectiveFrom.toISOString().slice(0, 10), boi: x.decidedById }))).toEqual([{ rank: 3, tu: "2026-11-02", boi: bld }]);
    expect(await db.teacherRankProposal.findUniqueOrThrow({ where: { id: cu.id } })).toMatchObject({ status: "CANCELLED", decidedById: bld });
    expect(await db.auditLog.count({ where: { entityType: "TeacherRankHistory", entityId: h[0]!.id, action: "PT_RANK_CHANGED" } })).toBe(1);
    // Đổi sang ĐÚNG Rank đang áp tại ngày đó ⇒ từ chối, không thêm dòng.
    expect(await tx((t) => rt.doiRank(t, { userId: gv, rank: 3, effectiveFrom: "2026-11-10", lyDo: "đổi trùng Rank hiện tại", coSoIds: [cs], actor: A(bld), now: NOW }))).toMatchObject({ ok: false });
    expect(await db.teacherRankHistory.count({ where: { userId: gv } })).toBe(1);
  });

  it("[RT-DB-02] hồi tố ⇒ từ chối; ngày rơi vào kỳ đã khoá ở cơ sở CỦA GV ⇒ từ chối; lên lịch ngày sau ⇒ được (Rank đang áp chưa đổi)", async () => {
    expect(await tx((t) => rt.doiRank(t, { userId: gv, rank: 4, effectiveFrom: "2026-11-01", lyDo: "hồi tố ngày hôm qua", coSoIds: [cs], actor: A(bld), now: NOW }))).toMatchObject({ ok: false });
    await db.attendancePeriod.create({ data: { centerId: cs, periodKey: "2026-12", status: "LOCKED" } });
    expect(await tx((t) => rt.doiRank(t, { userId: gv, rank: 4, effectiveFrom: "2026-12-05", lyDo: "rơi vào kỳ đã khoá", coSoIds: [cs], actor: A(bld), now: NOW }))).toMatchObject({
      ok: false,
      loi: expect.stringMatching(/khoá/),
    });
    // Kỳ khoá chỉ chặn khi thuộc cơ sở của chính GV — cơ sở GV không dạy thì không liên quan.
    expect(await tx((t) => rt.doiRank(t, { userId: gv, rank: 4, effectiveFrom: "2026-12-05", lyDo: "cơ sở khác đã khoá kỳ", coSoIds: [], actor: A(bld), now: NOW }))).toMatchObject({ ok: true });
    expect((await db.teacherRankHistory.findMany({ where: { userId: gv }, orderBy: { effectiveFrom: "asc" } })).map((x) => x.rank)).toEqual([3, 4]);
  });

  it("[RT-DB-02b] đã có Rank khác CÙNG ngày hiệu lực ⇒ từ chối, không thêm / sửa lịch sử", async () => {
    const ngay = new Date("2027-01-04T00:00:00Z");
    await db.teacherRankHistory.create({ data: { userId: gv, rank: 2, effectiveFrom: ngay, reason: "đã có" } });
    expect(await tx((t) => rt.doiRank(t, { userId: gv, rank: 1, effectiveFrom: "2027-01-04", lyDo: "trùng ngày với dòng có sẵn", coSoIds: [cs], actor: A(bld), now: NOW }))).toMatchObject({
      ok: false,
      loi: expect.stringMatching(/đúng ngày/),
    });
    expect(await db.teacherRankHistory.findMany({ where: { userId: gv, effectiveFrom: ngay }, select: { rank: true } })).toEqual([{ rank: 2 }]);
  });

  it("[RT-DB-02c] GV dạy NHIỀU cơ sở: kỳ khoá ở cơ sở THỨ HAI cũng chặn (Rank đổi tiền tiết ở mọi nơi người đó dạy)", async () => {
    const g = (await db.user.create({ data: { email: `gvn@${TAG}.test`, name: "gvn", role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs }, select: { id: true } })).id;
    await db.attendancePeriod.create({ data: { centerId: cs2, periodKey: "2027-02", status: "LOCKED" } });
    expect(await tx((t) => rt.doiRank(t, { userId: g, rank: 2, effectiveFrom: "2027-02-10", lyDo: "khoá ở cơ sở thứ hai", coSoIds: [cs, cs2], actor: A(bld), now: NOW }))).toMatchObject({
      ok: false,
      loi: expect.stringMatching(/2027-02.*khoá/),
    });
    // Chỉ cơ sở gốc (chưa khoá) ⇒ được — chứng minh chính cơ sở thứ hai là thứ chặn.
    expect(await tx((t) => rt.doiRank(t, { userId: g, rank: 2, effectiveFrom: "2027-02-10", lyDo: "chỉ cơ sở gốc chưa khoá", coSoIds: [cs], actor: A(bld), now: NOW }))).toMatchObject({ ok: true });
    // Cơ sở của GV đọc ở máy chủ: luôn gồm cơ sở gốc (User.centerId) dù chưa có buổi nào.
    const rd = await import("../../lib/parttime/rank-don-gia-db");
    expect(await rd.coSoCuaGiaoVien(g, NOW)).toContain(cs);
    expect(await rd.coSoCuaGiaoVien("khong-ton-tai", NOW)).toBeNull();
  });

  it("[RT-DB-02d] HAI lệnh đổi Rank CÙNG ngày chạy đồng thời ⇒ đúng MỘT mốc được ghi, lệnh kia thất bại; lịch sử không mâu thuẫn", async () => {
    const g = (await db.user.create({ data: { email: `gvd@${TAG}.test`, name: "gvd", role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs }, select: { id: true } })).id;
    const kq = await Promise.allSettled([
      tx((t) => rt.doiRank(t, { userId: g, rank: 2, effectiveFrom: "2026-11-20", lyDo: "lệnh thứ nhất đồng thời", coSoIds: [cs], actor: A(bld), now: NOW })),
      tx((t) => rt.doiRank(t, { userId: g, rank: 3, effectiveFrom: "2026-11-20", lyDo: "lệnh thứ hai đồng thời", coSoIds: [cs], actor: A(qlcs), now: NOW })),
    ]);
    const thanhCong = kq.filter((k) => k.status === "fulfilled" && (k.value as { ok: boolean }).ok).length;
    expect(thanhCong).toBe(1);
    const h = await db.teacherRankHistory.findMany({ where: { userId: g } });
    expect(h).toHaveLength(1);
    expect(await db.auditLog.count({ where: { entityType: "TeacherRankHistory", entityId: h[0]!.id } })).toBe(1);
  });

  it("[RT-DB-02e] đơn giá TRƯỚC ngày hiệu lực giữ Rank cũ; TỪ ngày hiệu lực mới đổi (không hồi tố)", async () => {
    const g = (await db.user.create({ data: { email: `gve@${TAG}.test`, name: "gve", role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs }, select: { id: true } })).id;
    expect(await tx((t) => rt.doiRank(t, { userId: g, rank: 3, effectiveFrom: "2026-11-10", lyDo: "lên lịch từ 10/11", coSoIds: [cs], actor: A(bld), now: NOW }))).toMatchObject({ ok: true });
    const rd = await import("../../lib/parttime/rank-don-gia-db");
    const truoc = await rd.rankHomNayCua([g], vn("2026-11-09", "23:00"));
    const tu = await rd.rankHomNayCua([g], vn("2026-11-10", "08:00"));
    expect(truoc.get(g)).toMatchObject({ rank: 1, nguon: "MAC_DINH" });
    expect(tu.get(g)).toEqual({ rank: 3, nguon: "LICH_SU" });
    const hoSo = await rd.docRankCuaGv({ userId: g, now: NOW });
    expect(hoSo).toMatchObject({ rank: 1, rankSapToi: { rank: 3, tuNgay: "2026-11-10" } });
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

  it("[RT-DB-05] hồ sơ GV đọc Rank: đang áp = mốc gần nhất ≤ hôm nay; mốc tương lai = đã lên lịch; danh sách GV dùng CÙNG luật (theo lô); chưa có quyết định ⇒ mặc định", async () => {
    // GV riêng của ca này — không mượn lịch sử của RT-DB-01 (luật 18: chạy một mình vẫn xanh).
    const g5 = (await db.user.create({ data: { email: `gv5@${TAG}.test`, name: "gv5", role: "TEACHER", roles: ["TEACHER"], password: "x", centerId: cs }, select: { id: true } })).id;
    await appDb.teacherRankHistory.createMany({
      data: [
        { userId: g5, rank: 2, effectiveFrom: new Date("2026-10-20T00:00:00Z"), reason: "duyệt đề xuất tháng 10", decidedById: bld },
        { userId: g5, rank: 3, effectiveFrom: new Date("2026-12-01T00:00:00Z"), reason: "duyệt đề xuất tháng 11", decidedById: bld },
      ],
    });
    expect(await tx((t) => rt.capChungNhan(t, { userId: g5, code: "TR-05", effectiveFrom: "2026-11-02", note: null, actor: A(bld), now: NOW }))).toMatchObject({ ok: true });
    const rd = await import("../../lib/parttime/rank-don-gia-db");
    const r = await rd.docRankCuaGv({ userId: g5, now: NOW });
    expect(r).toMatchObject({ rank: 2, nguonRank: "LICH_SU", rankTuNgay: "2026-10-20", rankSapToi: { rank: 3, tuNgay: "2026-12-01" } });
    // Bỏ luồng đề xuất (25/10/2026): hồ sơ không còn đọc / trả đề xuất chờ duyệt.
    expect("deXuatDangCho" in r).toBe(false);
    expect(r.lichSu.map((l) => [l.rank, l.tuNgay, l.tuongLai, l.nguoiDuyet])).toEqual([
      [3, "2026-12-01", true, "bld"],
      [2, "2026-10-20", false, "bld"],
    ]);
    expect(r.chungNhan).toMatchObject([{ code: "TR-05", tuNgay: "2026-11-02", hieuLucHomNay: true, daThuHoi: false, nguoiCap: "bld" }]);
    const ds = await rd.rankHomNayCua([g5, qlcs], NOW);
    expect(ds.get(g5)).toEqual({ rank: 2, nguon: "LICH_SU" });
    expect(ds.get(qlcs)).toMatchObject({ nguon: "MAC_DINH" });
  });
});
