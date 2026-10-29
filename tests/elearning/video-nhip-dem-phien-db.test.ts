// @vitest-environment node
/**
 * NHỊP DÀY (HEARTBEAT_FLOOD) ĐẾM THEO PHIÊN — Postgres THẬT.
 *
 * Trước: luật lấy `TrnLessonProgress.seq` (số nhịp LUỸ KẾ của cả đời bài) và chỉ dùng khi phiên đang xét là phiên ĐẦU TIÊN của
 * bài. Phiên về sau ⇒ null ⇒ luật im lặng bỏ qua. Đặt lại tiến độ khi bài đổi nguồn còn xoá `firstStartedAt`, nên đúng nhóm
 * người bị bắt đầu lại không bao giờ bị xét. Nay mỗi nhịp NHẬN +1 vào `TrnVideoSession.soNhip` ngay trong giao dịch ghi nhịp.
 *
 * Phủ: nhịp bị từ chối KHÔNG đếm · tải lại trang (vé mới, seq tiếp) cùng phiên · im lặng quá cửa sổ ⇒ phiên mới đếm lại từ 1 ·
 * nhiều tab xen kẽ · gửi dồn · người vừa bị đặt lại vẫn bị xét · nhịp bình thường không sinh cờ oan.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_HBD_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/security/signing-key", () => ({
  getSigningSecret: () => "secret-test-hbd-khong-dung-that-0123456789",
}));

import { db } from "../../lib/db";
import { resolveActorUncached } from "../../lib/auth/actor";
import { ghiNhipXem } from "../../lib/elearning/video-heartbeat";
import { kyVeMedia } from "../../lib/elearning/media-ticket";
import { currentPolicyVersion, ELEARNING_POLICY_KEY } from "../../lib/elearning/policy-acceptance";
import { doiNguonBaiVideo, xemTruocDoiNguon } from "../../lib/elearning/video-doi-nguon";
import { quetMoCo } from "../../lib/elearning/watch-flag-scan";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 120_000;
const P = "CI_HBD_";
const HAU_TO = "@hbd.test";
const T0 = new Date("2026-10-20T10:00:00.000Z");
const luc = (giay: number) => new Date(T0.getTime() + giay * 1000);

let C: { centerId: string; orgUnitId: string };
let dem = 0;

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { endsWith: HAU_TO } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.trnWatchFlag.deleteMany({ where: { userId: { in: ids } } });
  await db.trnVideoBudget.deleteMany({ where: { userId: { in: ids } } });
  await db.trnVideoSession.deleteMany({ where: { userId: { in: ids } } });
  await db.trnLessonProgress.deleteMany({ where: { userId: { in: ids } } });
  await db.trnEnrollment.deleteMany({ where: { userId: { in: ids } } });
  await db.trnLesson.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnModule.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnCourseVersion.deleteMany({ where: { course: { code: { startsWith: P } } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
  if (ids.length > 0) {
    await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
}

async function gan(userId: string, orgUnitId: string, vai: string) {
  const rd = await db.roleDef.findUniqueOrThrow({ where: { code: vai }, select: { id: true } });
  await db.userOrgRole.create({ data: { userId, orgUnitId, roleId: rd.id, status: "ACTIVE", grantedById: userId } });
}

/** Một khoá riêng đã xuất bản, MỘT bài video 600 giây, một người học đang học (chưa có hàng tiến độ). */
async function dung(ten: string) {
  dem += 1;
  const khoa = await db.trnCourse.create({
    data: {
      code: `${P}K${dem}`,
      slug: `${P.toLowerCase()}k${dem}`,
      title: `${P}Khoá ${ten}`,
      status: "PUBLISHED",
      visibility: "ASSIGNED_ONLY",
      selfEnrollEnabled: false,
      sequential: false,
      securityLevel: "INTERNAL",
    },
    select: { id: true },
  });
  await db.trnCourseVersion.create({ data: { courseId: khoa.id, major: 1, minor: 0, status: "PUBLISHED", publishedAt: new Date() } });
  const mod = await db.trnModule.create({ data: { courseId: khoa.id, title: `${P}Mô-đun ${dem}`, orderIndex: 1 }, select: { id: true } });
  const bai = await db.trnLesson.create({
    data: { moduleId: mod.id, title: `${P}Bài ${dem}`, orderIndex: 1, kind: "VIDEO", durationSec: 600, videoKey: `elearning/master/hbd/${dem}.mp4` },
    select: { id: true },
  });
  const u = await seedUser({ email: `${P.toLowerCase()}${ten}${HAU_TO}`, role: "TEACHER", name: `${P}${ten}` });
  await db.userOrgRole.deleteMany({ where: { userId: u.id } });
  await gan(u.id, C.orgUnitId, "TEACHER");
  await db.trnPolicyAcceptance.upsert({
    where: { userId_policyKey_policyVersion: { userId: u.id, policyKey: ELEARNING_POLICY_KEY, policyVersion: currentPolicyVersion() } },
    update: { revokedAt: null },
    create: { userId: u.id, policyKey: ELEARNING_POLICY_KEY, policyVersion: currentPolicyVersion() },
  });
  const en = await db.trnEnrollment.create({
    data: {
      courseId: khoa.id,
      userId: u.id,
      cycle: 1,
      status: "IN_PROGRESS",
      source: "SELF_ENROLL",
      centerId: C.centerId,
      orgUnitId: C.orgUnitId,
      snapJobTitle: "Nhân viên",
      progressPercent: 0,
    },
    select: { id: true },
  });
  return { baiId: bai.id, userId: u.id, enrollmentId: en.id };
}
type Nguoi = Awaited<ReturnType<typeof dung>>;

/** Một nhịp. `ve` ký lúc `veLuc` (giây tính từ T0) — vé mới = tải lại trang / tab khác. */
async function nhip(n: Nguoi, o: { seq: number; tu: number; den: number; luc: number; rev?: number; veLuc?: number }) {
  return ghiNhipXem({
    actor: await resolveActorUncached(n.userId),
    ve: kyVeMedia({ lessonId: n.baiId, userId: n.userId, rev: o.rev ?? 1 }, undefined, luc(o.veLuc ?? 0).getTime()),
    enrollmentId: n.enrollmentId,
    lessonId: n.baiId,
    tuSec: o.tu,
    denSec: o.den,
    seq: o.seq,
    tocDo: 1,
    tabHien: true,
    viTriSec: o.den,
    traLoiThachThuc: null,
    now: luc(o.luc),
  });
}

const cacPhien = (n: Nguoi) => db.trnVideoSession.findMany({ where: { lessonId: n.baiId, userId: n.userId }, orderBy: { startedAt: "asc" } });
const hang = (n: Nguoi) =>
  db.trnLessonProgress.findUniqueOrThrow({ where: { enrollmentId_lessonId: { enrollmentId: n.enrollmentId, lessonId: n.baiId } } });
const maCo = async (n: Nguoi) => (await db.trnWatchFlag.findMany({ where: { userId: n.userId, lessonId: n.baiId } })).map((c) => c.ruleCode);

describe.skipIf(!RUN_DB_TESTS)("[HBD] nhịp dày đếm THEO PHIÊN (Postgres thật)", () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    const cs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true, centerId: true } });
    C = { centerId: cs1.centerId as string, orgUnitId: cs1.id };
    // người xử cờ: vai Đào tạo ở đơn vị của ghi danh (không có thì `quetMoCo` KHÔNG mở cờ, chỉ đếm `thieuNguoiXu`)
    const dt = await seedUser({ email: `${P.toLowerCase()}daotao${HAU_TO}`, role: "TRAINING", name: `${P}ĐT` });
    await db.userOrgRole.deleteMany({ where: { userId: dt.id } });
    await gan(dt.id, C.orgUnitId, "TRAINING");
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } catch {
      /* dọn lại ở lượt sau nhờ tiền tố */
    }
  }, HOOK_TIMEOUT);

  it("[HBD-01] mỗi nhịp NHẬN +1 vào phiên: 3 nhịp đều đặn ⇒ một phiên, soNhip = 3", async () => {
    const n = await dung("a1");
    for (let i = 1; i <= 3; i++) {
      const r = await nhip(n, { seq: i, tu: (i - 1) * 15, den: i * 15, luc: i * 15 });
      expect(r.ok, JSON.stringify(r)).toBe(true);
    }
    const ph = await cacPhien(n);
    expect(ph).toHaveLength(1);
    expect(ph[0]!.soNhip).toBe(3);
  }, CASE_TIMEOUT);

  it("[HBD-02] 🔴 nhịp BỊ TỪ CHỐI không đếm: seq cũ (đến trễ/đảo thứ tự), vé phiên bản cũ", async () => {
    const n = await dung("a2");
    await nhip(n, { seq: 5, tu: 0, den: 15, luc: 15 });
    await nhip(n, { seq: 6, tu: 15, den: 30, luc: 30 });
    expect((await cacPhien(n))[0]!.soNhip).toBe(2);
    // seq không lớn hơn seq đã nhận ⇒ bỏ (không ghi gì)
    await nhip(n, { seq: 6, tu: 30, den: 45, luc: 45 });
    await nhip(n, { seq: 4, tu: 30, den: 45, luc: 46 });
    // vé của phiên bản nội dung khác ⇒ bị từ chối trước khi đụng phiên
    const cu = await nhip(n, { seq: 7, tu: 30, den: 45, luc: 47, rev: 9 });
    expect(cu.ok).toBe(false);
    expect((await cacPhien(n))[0]!.soNhip).toBe(2);
    // đối chứng dương: nhịp hợp lệ kế tiếp lại đếm
    await nhip(n, { seq: 7, tu: 30, den: 45, luc: 48 });
    expect((await cacPhien(n))[0]!.soNhip).toBe(3);
  }, CASE_TIMEOUT);

  it("[HBD-03] tải lại trang (VÉ MỚI, seq tiếp) trong cửa sổ 5 phút ⇒ CÙNG phiên, đếm tiếp; im lặng quá 5 phút ⇒ phiên MỚI đếm lại từ 1", async () => {
    const n = await dung("a3");
    await nhip(n, { seq: 1, tu: 0, den: 15, luc: 15 });
    await nhip(n, { seq: 2, tu: 15, den: 30, luc: 30 });
    // tải lại: vé ký lại lúc 36 s, nhịp tiếp theo seq 3 đến 15 s sau vé (ngân sách thời gian cấp đủ cho đoạn 15 s)
    await nhip(n, { seq: 3, tu: 30, den: 45, luc: 51, veLuc: 36 });
    let ph = await cacPhien(n);
    expect(ph).toHaveLength(1);
    expect(ph[0]!.soNhip).toBe(3);
    // mất mạng 10 phút rồi gửi lại
    const r4 = await nhip(n, { seq: 4, tu: 45, den: 60, luc: 51 + 600, veLuc: 36 });
    expect(r4.ok, JSON.stringify(r4)).toBe(true);
    ph = await cacPhien(n);
    expect(ph).toHaveLength(2);
    expect(ph.map((p) => p.soNhip)).toEqual([3, 1]);
  }, CASE_TIMEOUT);

  it("[HBD-04] nhiều tab: hai vé khác nhau gửi xen kẽ vẫn chung MỘT phiên, tổng nhịp = tổng hai tab", async () => {
    const n = await dung("a4");
    let seq = 0;
    for (let i = 0; i < 6; i++) {
      seq += 1;
      await nhip(n, { seq, tu: i * 15, den: (i + 1) * 15, luc: (i + 1) * 15, veLuc: i % 2 === 0 ? 0 : 5 });
    }
    const ph = await cacPhien(n);
    expect(ph).toHaveLength(1);
    expect(ph[0]!.soNhip).toBe(6);
  }, CASE_TIMEOUT);

  it("[HBD-05] 🔴 gửi dồn (150 nhịp trong ~70 giây đồng hồ) ⇒ soNhip = 150 và quét cờ gắn HEARTBEAT_FLOOD; nhịp đều đặn cùng thời lượng thì KHÔNG", async () => {
    const dan = await dung("a5dan");
    // Luật bỏ qua phiên dưới 60 giây đồng hồ (mẫu số quá nhỏ) ⇒ dồn 150 nhịp trong ~70 giây (trần 3 × 70/15 = 14).
    for (let i = 1; i <= 150; i++) {
      await nhip(dan, { seq: i, tu: 0, den: 15, luc: 1 + (i * 69) / 150 });
    }
    expect((await cacPhien(dan))[0]!.soNhip).toBe(150);

    const deu = await dung("a5deu");
    // Đều đặn 15 giây một nhịp, mỗi nhịp 5 giây nội dung: tổng phủ 220 s < 240 s nên chưa tới câu hỏi tập trung.
    for (let i = 1; i <= 44; i++) {
      const r = await nhip(deu, { seq: i, tu: (i - 1) * 5, den: i * 5, luc: i * 15 });
      expect(r.ok, JSON.stringify(r)).toBe(true);
    }
    expect((await cacPhien(deu))[0]!.soNhip).toBe(44);

    const ket = await quetMoCo(luc(3 * 3600));
    expect(ket.daXet).toBeGreaterThanOrEqual(2);
    expect(await maCo(dan)).toContain("HEARTBEAT_FLOOD");
    expect(await maCo(deu)).not.toContain("HEARTBEAT_FLOOD");
  }, CASE_TIMEOUT);

  it("[HBD-06] 🔴 người vừa bị ĐẶT LẠI tiến độ (bài đổi nguồn) vẫn bị xét nhịp dày; nhịp đầu sau đặt lại điền lại firstStartedAt", async () => {
    const n = await dung("a6");
    // xem một đoạn ở phiên bản 1
    await nhip(n, { seq: 1, tu: 0, den: 15, luc: 15 });
    expect((await hang(n)).firstStartedAt).not.toBeNull();
    // đổi nguồn: lượt đang học bị chụp + đặt lại (firstStartedAt = NULL)
    const moi = { youtubeId: "aBcDeFg_H-1", videoKey: null, durationSec: 480 };
    const xt = await xemTruocDoiNguon({ lessonId: n.baiId, moi, actorUserId: "u-doi", coQuyenXuatBan: true, now: luc(100) });
    await doiNguonBaiVideo({
      lessonId: n.baiId,
      moi,
      duLieu: { title: `${P}Bài đã đổi`, youtubeId: "aBcDeFg_H-1", videoKey: null, durationSec: 480 },
      actorUserId: "u-doi",
      actorName: "Đào tạo (thử)",
      coQuyenXuatBan: true,
      xacNhanToken: xt.xacNhanToken,
      lyDo: "đổi để thử nhịp dày",
      now: luc(100),
    });
    expect((await hang(n)).firstStartedAt).toBeNull();
    // phiên mới sau 10 phút: nhịp đầu ở phiên bản 2 điền lại firstStartedAt
    const t = 1000;
    const dau = await nhip(n, { seq: 2, tu: 0, den: 15, luc: t, rev: 2, veLuc: t - 5 });
    expect(dau.ok, JSON.stringify(dau)).toBe(true);
    expect((await hang(n)).firstStartedAt).not.toBeNull();
    // rồi gửi dồn
    for (let i = 0; i < 150; i++) {
      await nhip(n, { seq: 3 + i, tu: 0, den: 15, luc: t + 1 + (i * 69) / 150, rev: 2, veLuc: t - 5 });
    }
    const ph = await cacPhien(n);
    expect(ph[ph.length - 1]!.soNhip).toBe(151);
    const ket6 = await quetMoCo(luc(4 * 3600));
    expect(ket6.daXet).toBeGreaterThanOrEqual(1);
    expect(ket6.thieuNguoiXu).toBe(0);
    expect(await maCo(n)).toContain("HEARTBEAT_FLOOD");
  }, CASE_TIMEOUT);

  // [HBD-07] số nhịp CỦA PHIÊN thắng `seq` luỹ kế (đường lùi chỉ cho phiên cũ). Nằm TRONG khối chung để dùng người xử cờ
  // do `beforeAll` dựng: khối riêng thì `afterAll` của khối trước đã dọn mất người xử cờ ⇒ cờ không mở được ⇒ ca xanh vì RỖNG.
  it("🔴 phiên ĐẦU TIÊN của bài (cách cũ sẽ dùng seq) mà seq luỹ kế = 500 nhưng phiên chỉ có 4 nhịp thật ⇒ KHÔNG cờ nhịp dày", async () => {
    const n = await dung("a7");
    // Tiến độ đã có sẵn `seq = 496` (người học xem nhiều lần), `firstStartedAt` trùng mốc mở phiên ⇒ cách cũ coi đây là 'phiên đầu' và
    // lấy seq làm số nhịp của phiên: 500 > 3 × 75 / 15 = 15 ⇒ cờ OAN. Số nhịp thật của phiên là 4.
    await db.trnLessonProgress.create({
      data: {
        enrollmentId: n.enrollmentId,
        userId: n.userId,
        lessonId: n.baiId,
        segmentBitmap: Buffer.from([0x0f]),
        coveredSec: 10,
        contentSec: 600,
        totalWatchSec: 10,
        maxPositionSec: 10,
        seq: 496,
        status: "IN_PROGRESS",
        firstStartedAt: luc(25),
        mediaRevision: 1,
      },
    });
    for (let i = 0; i < 4; i++) {
      const r = await nhip(n, { seq: 497 + i, tu: 10 + i * 5, den: 15 + i * 5, luc: 25 + i * 25, veLuc: 0 });
      expect(r.ok, JSON.stringify(r)).toBe(true);
    }
    const ph = await cacPhien(n);
    expect(ph).toHaveLength(1);
    expect(ph[0]!.soNhip).toBe(4);
    expect((await hang(n)).seq).toBe(500);
    const ket7 = await quetMoCo(luc(3 * 3600));
    expect(ket7.daXet).toBeGreaterThanOrEqual(1);
    expect(ket7.thieuNguoiXu).toBe(0); // có người xử ⇒ nếu luật bắn thì cờ SẼ được mở (đối chứng: không thì ca này xanh vì rỗng)
    expect(await maCo(n)).not.toContain("HEARTBEAT_FLOOD");
  }, CASE_TIMEOUT);
});
