// @vitest-environment node
/**
 * PHIÊN BẢN NỘI DUNG BÀI VIDEO (B1 — nền) — trên Postgres THẬT.
 *
 * B1 dựng nền cho việc đổi nguồn video không làm tiến độ của video cũ "thành" tiến độ của video mới:
 *   · `TrnLesson.mediaRevision` + `TrnLessonProgress.mediaRevision` (mặc định 1 — đúng với mọi dòng hiện có);
 *   · vé phát mang `rev`; nhịp xem mang vé của phiên bản CŨ bị từ chối (`NOI_DUNG_DA_DOI`);
 *   · lượt có tiến độ ở phiên bản cũ là lượt ĐÓNG BĂNG: nhịp trả `KHONG_GHI`, không ghi gì;
 *   · bảng `TrnLessonProgressRevision` là lịch sử BẤT BIẾN, ép bằng trigger ở tầng DB.
 * Việc chụp + bắt đầu lại tiến độ khi bài đổi nguồn là của B2 (`video-doi-nguon-db.test.ts`).
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_VPB_` ở beforeAll VÀ afterAll. Mỗi ca một người học riêng.
 * Chạy: `pnpm test:elearning-db`. Không có DB ⇒ SKIP, không phải xanh.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/security/signing-key", () => ({
  getSigningSecret: () => "secret-test-vpb-khong-dung-that-0123456789",
}));

import { db } from "../../lib/db";
import { resolveActorUncached } from "../../lib/auth/actor";
import { ghiNhipXem } from "../../lib/elearning/video-heartbeat";
import { kyVeMedia } from "../../lib/elearning/media-ticket";
import { currentPolicyVersion, ELEARNING_POLICY_KEY } from "../../lib/elearning/policy-acceptance";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 90_000;
const P = "CI_VPB_";
const HAU_TO = "@vpb.test";
const T0 = new Date("2026-10-28T10:00:00.000Z");
const luc = (giay: number) => new Date(T0.getTime() + giay * 1000);

type Nguoi = { id: string; enrollmentId: string };
let C: { courseId: string; centerId: string; orgUnitId: string };

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { endsWith: HAU_TO } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.trnVideoBudget.deleteMany({ where: { userId: { in: ids } } });
  await db.trnVideoSession.deleteMany({ where: { userId: { in: ids } } });
  await db.trnLessonProgress.deleteMany({ where: { userId: { in: ids } } });
  await db.trnEnrollment.deleteMany({ where: { userId: { in: ids } } });
  await db.trnLesson.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnModule.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnCourseVersion.deleteMany({ where: { course: { code: { startsWith: P } } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
}

let dem = 0;
async function taoBai(durationSec = 600) {
  dem += 1;
  const mod = await db.trnModule.create({
    data: { courseId: C.courseId, title: `${P}Mô-đun ${dem}`, orderIndex: dem },
    select: { id: true },
  });
  const b = await db.trnLesson.create({
    data: {
      moduleId: mod.id,
      title: `${P}Bài ${dem}`,
      orderIndex: 1,
      kind: "VIDEO",
      durationSec,
      videoKey: `elearning/master/vpb/${dem}.mp4`,
    },
    select: { id: true },
  });
  return b.id;
}

async function taoNguoi(ten: string): Promise<Nguoi> {
  const u = await seedUser({ email: `${P.toLowerCase()}${ten}${HAU_TO}`, role: "TEACHER", name: `${P}${ten}` });
  await db.userOrgRole.deleteMany({ where: { userId: u.id } });
  const donVi = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true } });
  const r = await db.roleDef.findUniqueOrThrow({ where: { code: "TEACHER" }, select: { id: true } });
  await db.userOrgRole.create({ data: { userId: u.id, orgUnitId: donVi.id, roleId: r.id, grantedById: u.id } });
  await db.trnPolicyAcceptance.upsert({
    where: {
      userId_policyKey_policyVersion: { userId: u.id, policyKey: ELEARNING_POLICY_KEY, policyVersion: currentPolicyVersion() },
    },
    update: { revokedAt: null },
    create: { userId: u.id, policyKey: ELEARNING_POLICY_KEY, policyVersion: currentPolicyVersion() },
  });
  const en = await db.trnEnrollment.create({
    data: {
      courseId: C.courseId,
      userId: u.id,
      cycle: 1,
      status: "NOT_STARTED",
      source: "SELF_ENROLL",
      centerId: C.centerId,
      orgUnitId: C.orgUnitId,
      snapJobTitle: "Nhân viên",
    },
    select: { id: true },
  });
  return { id: u.id, enrollmentId: en.id };
}

/** Một nhịp 15 giây đầu của bài; vé mang `rev` (bỏ trống = vé kiểu cũ, không có `rev`). */
async function nhip(n: Nguoi, baiId: string, o: { rev?: number; seq?: number; tu?: number; den?: number; giay?: number } = {}) {
  const actor = await resolveActorUncached(n.id);
  return ghiNhipXem({
    actor,
    ve: kyVeMedia({ lessonId: baiId, userId: n.id, ...(o.rev !== undefined ? { rev: o.rev } : {}) }, undefined, luc(0).getTime()),
    enrollmentId: n.enrollmentId,
    lessonId: baiId,
    tuSec: o.tu ?? 0,
    denSec: o.den ?? 15,
    seq: o.seq ?? 1,
    tocDo: 1,
    tabHien: true,
    viTriSec: o.den ?? 15,
    traLoiThachThuc: null,
    now: luc(o.giay ?? 15),
  });
}

const datRev = (baiId: string, rev: number) => db.trnLesson.update({ where: { id: baiId }, data: { mediaRevision: rev } });
const tienDo = (n: Nguoi, baiId: string) =>
  db.trnLessonProgress.findUnique({ where: { enrollmentId_lessonId: { enrollmentId: n.enrollmentId, lessonId: baiId } } });

describe.skipIf(!RUN_DB_TESTS)("[VPB] phiên bản nội dung bài video (B1) — Postgres thật", () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    const cs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true, centerId: true } });
    const khoa = await db.trnCourse.create({
      data: {
        code: `${P}KHOA`,
        slug: `${P.toLowerCase()}khoa`,
        title: `${P}Khoá`,
        status: "PUBLISHED",
        visibility: "ASSIGNED_ONLY",
        selfEnrollEnabled: false,
        sequential: false,
        securityLevel: "INTERNAL",
      },
      select: { id: true },
    });
    await db.trnCourseVersion.create({ data: { courseId: khoa.id, major: 1, minor: 0, status: "PUBLISHED", publishedAt: new Date() } });
    C = { courseId: khoa.id, centerId: cs1.centerId as string, orgUnitId: cs1.id };
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } catch {
      /* dọn lại ở lượt sau nhờ tiền tố */
    }
  }, HOOK_TIMEOUT);

  // ── Mặc định: không backfill, mọi thứ hiện có = phiên bản 1 ───────────────────────────────────────────────

  it("[VPB-01] bài và tiến độ tạo KHÔNG khai `mediaRevision` đều mang 1 (đúng với mọi dòng hiện có — không backfill)", async () => {
    const bai = await taoBai();
    const n = await taoNguoi("m1");
    expect((await db.trnLesson.findUniqueOrThrow({ where: { id: bai }, select: { mediaRevision: true } })).mediaRevision).toBe(1);
    const r = await nhip(n, bai, { rev: 1 });
    expect(r.ok).toBe(true);
    expect((await tienDo(n, bai))?.mediaRevision).toBe(1);
  }, CASE_TIMEOUT);

  // ── Vé mang phiên bản ─────────────────────────────────────────────────────────────────────────────────────

  it("[VPB-02] vé KIỂU CŨ (không có `rev`) coi là phiên bản 1: nhịp được nhận khi bài còn ở phiên bản 1", async () => {
    const bai = await taoBai();
    const n = await taoNguoi("m2");
    const r = await nhip(n, bai); // không rev
    expect(r.ok).toBe(true);
    expect((await tienDo(n, bai))?.coveredSec).toBe(15);
  }, CASE_TIMEOUT);

  it("[VPB-03] bài đã đổi sang phiên bản 2 ⇒ nhịp mang vé phiên bản 1 bị TỪ CHỐI (409 NOI_DUNG_DA_DOI), không ghi gì", async () => {
    const bai = await taoBai();
    const n = await taoNguoi("m3");
    await nhip(n, bai, { rev: 1 });
    const truoc = await tienDo(n, bai);
    await datRev(bai, 2);
    const r = await nhip(n, bai, { rev: 1, seq: 2, tu: 15, den: 30, giay: 30 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOI_DUNG_DA_DOI");
    expect(await tienDo(n, bai)).toEqual(truoc);
    expect(await db.trnVideoBudget.count({ where: { userId: n.id, lessonId: bai } })).toBe(1); // chỉ nhịp đầu đã ghi
  }, CASE_TIMEOUT);

  it("[VPB-03b] vé KIỂU CŨ (không `rev` ⇒ 1) cũng bị từ chối khi bài đã ở phiên bản 2", async () => {
    const bai = await taoBai();
    const n = await taoNguoi("m3b");
    await datRev(bai, 2);
    const r = await nhip(n, bai);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOI_DUNG_DA_DOI");
    expect(await tienDo(n, bai)).toBeNull();
  }, CASE_TIMEOUT);

  it("[VPB-04] ĐỐI CHỨNG: vé mang đúng phiên bản 2 ⇒ nhịp được nhận, và dòng tiến độ MỚI mang phiên bản 2 (không phải mặc định 1)", async () => {
    const bai = await taoBai();
    const n = await taoNguoi("m4");
    await datRev(bai, 2);
    const r = await nhip(n, bai, { rev: 2 });
    expect(r.ok).toBe(true);
    const t = await tienDo(n, bai);
    expect(t?.coveredSec).toBe(15);
    expect(t?.mediaRevision).toBe(2);
  }, CASE_TIMEOUT);

  // ── Lượt đóng băng ────────────────────────────────────────────────────────────────────────────────────────

  it("[VPB-05] lượt có tiến độ ở phiên bản CŨ (đóng băng) ⇒ nhịp trả KHONG_GHI: không bitmap, không ngân sách, không phiên, không đổi trạng thái", async () => {
    const bai = await taoBai();
    const n = await taoNguoi("m5");
    // Lượt đã xem xong ở phiên bản 1 (DONE), rồi bài đổi sang phiên bản 2 mà KHÔNG chụp lại (đóng băng).
    await db.trnLessonProgress.create({
      data: {
        enrollmentId: n.enrollmentId,
        userId: n.id,
        lessonId: bai,
        coveredSec: 600,
        contentSec: 600,
        totalWatchSec: 700,
        maxPositionSec: 600,
        seq: 41,
        status: "DONE",
        completedAt: luc(-1000),
        verifiedAt: luc(-1000),
        mediaRevision: 1,
      },
    });
    await datRev(bai, 2);
    const truoc = await tienDo(n, bai);
    const r = await nhip(n, bai, { rev: 2, seq: 42, tu: 0, den: 15 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.status).toBe("KHONG_GHI");
      expect(r.data.coveredSec).toBe(600);
    }
    expect(await tienDo(n, bai)).toEqual(truoc);
    expect(await db.trnVideoBudget.count({ where: { userId: n.id, lessonId: bai } })).toBe(0);
    expect(await db.trnVideoSession.count({ where: { userId: n.id, lessonId: bai } })).toBe(0);
  }, CASE_TIMEOUT);

  // ── Khoá: nhịp xem và đổi nguồn không deadlock, và không có đường thứ ba ─────────────────────────────────────

  it("[VPB-06] nhịp xem (vé phiên bản 1) CHẠY SONG SONG với giao dịch đổi phiên bản (khoá bài FOR UPDATE → hàng tiến độ), lặp 12 lần: không deadlock; nhịp hoặc ghi xong TRƯỚC đổi hoặc bị từ chối — KHÔNG BAO GIỜ ghi sau đổi", async () => {
    for (let vong = 0; vong < 12; vong += 1) {
      const bai = await taoBai();
      const n = await taoNguoi(`m6v${vong}`);
      await nhip(n, bai, { rev: 1 }); // có sẵn một dòng tiến độ để giao dịch đổi phải khoá nó
      // Giao dịch đổi phiên bản: khoá bài (GHI) → ĐỌC tiến độ → giữ một lúc → đổi. Phần "giữ một lúc" mở rộng cửa sổ để một nhịp
      // KHÔNG có khoá chia sẻ chen vào giữa; `thayLucDoi` là số giây nội dung bản chụp (B2) sẽ thấy tại thời điểm đổi.
      let thayLucDoi = -1;
      const doi = db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "mediaRevision" FROM "TrnLesson" WHERE "id" = ${bai} FOR UPDATE`;
          thayLucDoi = (await tx.trnLessonProgress.findFirstOrThrow({ where: { lessonId: bai }, select: { coveredSec: true } })).coveredSec;
          await tx.$executeRaw`SELECT pg_sleep(0.15)`;
          await tx.trnLessonProgress.updateMany({ where: { lessonId: bai }, data: { updatedAt: new Date() } });
          await tx.trnLesson.update({ where: { id: bai }, data: { mediaRevision: { increment: 1 } } });
        },
        { timeout: 15_000 },
      );
      const [kq] = await Promise.all([
        nhip(n, bai, { rev: 1, seq: 2, tu: 15, den: 30, giay: 30 }),
        doi,
      ]);
      // Sau khi đổi đã commit, mọi nhịp phiên bản 1 đều bị từ chối.
      const sau = await nhip(n, bai, { rev: 1, seq: 3, tu: 30, den: 45, giay: 45 });
      expect(sau.ok, `vòng ${vong}`).toBe(false);
      if (!sau.ok) expect(sau.code).toBe("NOI_DUNG_DA_DOI");
      const t = await tienDo(n, bai);
      // ⚠️ BẤT BIẾN CHÍNH: thứ giao dịch đổi đã THẤY (thứ bản chụp sẽ chụp) PHẢI bằng thứ còn lại sau cùng — không nhịp nào
      // của video cũ ghi vào giữa lúc đổi đang giữ khoá. Bỏ khoá chia sẻ thì nhịp chen vào và hai con số này lệch nhau.
      expect(t?.coveredSec, `vòng ${vong}: tiến độ cuối khác thứ giao dịch đổi đã thấy`).toBe(thayLucDoi);
      if (kq.ok) expect(t?.coveredSec, `vòng ${vong}: nhịp được nhận thì phải đã ghi`).toBe(30);
      else {
        expect(kq.code, `vòng ${vong}`).toBe("NOI_DUNG_DA_DOI");
        expect(t?.coveredSec, `vòng ${vong}: nhịp bị từ chối thì không ghi`).toBe(15);
      }
    }
  }, 240_000);

  // ── Bản chụp bất biến ─────────────────────────────────────────────────────────────────────────────────────

  describe("[VPB-07] TrnLessonProgressRevision — lịch sử bất biến (trigger)", () => {
    const chup = async (n: Nguoi, bai: string, rev = 1) =>
      db.trnLessonProgressRevision.create({
        data: {
          enrollmentId: n.enrollmentId,
          lessonId: bai,
          userId: n.id,
          mediaRevision: rev,
          segmentBitmap: Buffer.from([0b00000111]),
          coveredSec: 15,
          contentSec: 600,
          totalWatchSec: 15,
          status: "IN_PROGRESS",
          lastActivityAt: luc(0),
          supersededByUserId: n.id,
          reason: "ca thử",
        },
      });

    it("ghi mới được; ghi lại cùng (lượt, bài, phiên bản) bị chặn bởi khoá duy nhất (chụp đúng MỘT lần)", async () => {
      const bai = await taoBai();
      const n = await taoNguoi("m7a");
      await chup(n, bai);
      await expect(chup(n, bai)).rejects.toThrow();
      await chup(n, bai, 2); // phiên bản khác thì được
    }, CASE_TIMEOUT);

    it("UPDATE một cột tầng 1 (số giây phủ, trạng thái, mốc hoàn thành…) bị TỪ CHỐI ở tầng DB", async () => {
      const bai = await taoBai();
      const n = await taoNguoi("m7b");
      const b = await chup(n, bai);
      await expect(db.trnLessonProgressRevision.update({ where: { id: b.id }, data: { coveredSec: 600 } })).rejects.toThrow(/bất biến/);
      await expect(db.trnLessonProgressRevision.update({ where: { id: b.id }, data: { status: "DONE" } })).rejects.toThrow(/bất biến/);
      await expect(db.trnLessonProgressRevision.update({ where: { id: b.id }, data: { completedAt: luc(5) } })).rejects.toThrow(/bất biến/);
      await expect(db.trnLessonProgressRevision.update({ where: { id: b.id }, data: { reason: "sửa lén" } })).rejects.toThrow(/bất biến/);
      expect((await db.trnLessonProgressRevision.findUniqueOrThrow({ where: { id: b.id } })).coveredSec).toBe(15);
    }, CASE_TIMEOUT);

    it("DELETE trực tiếp bị TỪ CHỐI", async () => {
      const bai = await taoBai();
      const n = await taoNguoi("m7c");
      const b = await chup(n, bai);
      await expect(db.trnLessonProgressRevision.delete({ where: { id: b.id } })).rejects.toThrow(/bất biến/);
      await expect(db.trnLessonProgressRevision.deleteMany({ where: { id: b.id } })).rejects.toThrow(/bất biến/);
      expect(await db.trnLessonProgressRevision.count({ where: { id: b.id } })).toBe(1);
    }, CASE_TIMEOUT);

    it("dọn BITMAP tầng 2 (có → NULL kèm bitmapPurgedAt) được phép — đó là đường duy nhất của cron; đặt bitmap KHÁC thì không", async () => {
      const bai = await taoBai();
      const n = await taoNguoi("m7d");
      const b = await chup(n, bai);
      await expect(
        db.trnLessonProgressRevision.update({ where: { id: b.id }, data: { segmentBitmap: Buffer.from([0xff]) } }),
      ).rejects.toThrow(/bất biến/);
      await db.trnLessonProgressRevision.update({
        where: { id: b.id },
        data: { segmentBitmap: null, bitmapPurgedAt: luc(1) },
      });
      const sau = await db.trnLessonProgressRevision.findUniqueOrThrow({ where: { id: b.id } });
      expect(sau.segmentBitmap).toBeNull();
      expect(sau.bitmapPurgedAt).not.toBeNull();
      expect(sau.coveredSec).toBe(15); // tầng 1 ở lại
    }, CASE_TIMEOUT);

    it("xoá do khoá ngoại CASCADE (ghi danh bị xoá thật) vẫn chạy — trigger không chặn việc dọn cha", async () => {
      const bai = await taoBai();
      const n = await taoNguoi("m7e");
      await chup(n, bai);
      await db.trnEnrollment.delete({ where: { id: n.enrollmentId } });
      expect(await db.trnLessonProgressRevision.count({ where: { enrollmentId: n.enrollmentId } })).toBe(0);
    }, CASE_TIMEOUT);
  });
});
