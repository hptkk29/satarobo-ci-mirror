// @vitest-environment node
/**
 * [MQ-DB] Quyền truy cập media mỗi lượt — câu SQL thật (`docQuyenMedia`) + luật thuần (`quyetDinhMedia`) trên Postgres THẬT.
 *
 * Đo đúng chuỗi sự kiện nguy hiểm: người học có vé → bài ĐỔI NGUỒN (B2) → vé cũ xin tệp cũ còn nằm trên R2 → phải bị từ chối. Và:
 * ghi danh bị thu hồi giữa chừng · bài/khoá bị xoá mềm · ghi danh của NGƯỜI KHÁC không thay được ghi danh của mình.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_MQD_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/security/signing-key", () => ({
  getSigningSecret: () => "secret-test-mqd-khong-dung-that-0123456789",
}));

import { db } from "../../lib/db";
import { docQuyenMedia } from "../../lib/elearning/media-quyen";
import { quyetDinhMedia } from "../../lib/elearning/media-quyen-rule";
import { doiNguonBaiVideo, xemTruocDoiNguon } from "../../lib/elearning/video-doi-nguon";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 60_000;
const P = "CI_MQD_";
const HAU_TO = "@mqd.test";

let C: { centerId: string; orgUnitId: string };
let dem = 0;

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { endsWith: HAU_TO } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.trnLessonProgress.deleteMany({ where: { userId: { in: ids } } });
  await db.trnEnrollment.deleteMany({ where: { userId: { in: ids } } });
  await db.trnLesson.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnModule.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
  if (ids.length > 0) await db.user.deleteMany({ where: { id: { in: ids } } });
}

async function dung(ten: string, o: { trangThai?: "IN_PROGRESS" | "REVOKED" | "COMPLETED" } = {}) {
  dem += 1;
  const khoa = await db.trnCourse.create({
    data: {
      code: `${P}K${dem}`,
      slug: `${P.toLowerCase()}k${dem}`,
      title: `${P}Khoá ${ten}`,
      status: "DRAFT",
      visibility: "ASSIGNED_ONLY",
      selfEnrollEnabled: false,
      sequential: false,
      securityLevel: "INTERNAL",
    },
    select: { id: true },
  });
  const mod = await db.trnModule.create({ data: { courseId: khoa.id, title: `${P}Mô-đun ${dem}`, orderIndex: 1 }, select: { id: true } });
  const bai = await db.trnLesson.create({
    data: {
      moduleId: mod.id,
      title: `${P}Bài ${dem}`,
      orderIndex: 1,
      kind: "VIDEO",
      durationSec: 600,
      videoKey: `elearning/master/mqd${dem}/cu.mp4`,
      captionKey: `elearning/caption/mqd${dem}/cu.vtt`,
    },
    select: { id: true },
  });
  const u = await seedUser({ email: `${P.toLowerCase()}${ten}${HAU_TO}`, role: "TEACHER", name: `${P}${ten}` });
  await db.trnEnrollment.create({
    data: {
      courseId: khoa.id,
      userId: u.id,
      cycle: 1,
      status: o.trangThai ?? "IN_PROGRESS",
      source: "SELF_ENROLL",
      centerId: C.centerId,
      orgUnitId: C.orgUnitId,
      snapJobTitle: "Nhân viên",
      progressPercent: 0,
    },
  });
  return { courseId: khoa.id, moduleId: mod.id, baiId: bai.id, userId: u.id };
}

const ve = (baiId: string, userId: string, rev = 1) => ({ lessonId: baiId, userId, exp: 9e15, rev });
const hoi = async (b: Awaited<ReturnType<typeof dung>>, khoa: string, rev = 1, userId = b.userId) => {
  const r = await docQuyenMedia(userId, b.baiId);
  return quyetDinhMedia({ ve: ve(b.baiId, userId, rev), khoa, bai: r?.bai ?? null, coGhiDanhHopLe: r?.coGhiDanh ?? false });
};

describe.skipIf(!RUN_DB_TESTS)("[MQ-DB] quyền media mỗi lượt (Postgres thật)", () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    const cs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true, centerId: true } });
    C = { centerId: cs1.centerId as string, orgUnitId: cs1.id };
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } catch {
      /* dọn lại ở lượt sau nhờ tiền tố */
    }
  }, HOOK_TIMEOUT);

  it("[MQ-DB-01] đối chứng dương: người đang học, vé đúng phiên bản, khoá là tệp hiện hành ⇒ qua (cả video lẫn phụ đề)", async () => {
    const b = await dung("a1");
    const bai = await db.trnLesson.findUniqueOrThrow({ where: { id: b.baiId } });
    expect(await hoi(b, bai.videoKey!)).toEqual({ ok: true });
    expect(await hoi(b, bai.captionKey!)).toEqual({ ok: true });
  }, CASE_TIMEOUT);

  it("[MQ-DB-02] 🔴 BÀI ĐỔI NGUỒN: vé phiên bản 1 xin tệp CŨ (còn trên R2) ⇒ 409; vé phiên bản 2 xin tệp cũ ⇒ 404; xin tệp mới bằng vé mới ⇒ qua", async () => {
    const b = await dung("a2");
    const cu = (await db.trnLesson.findUniqueOrThrow({ where: { id: b.baiId } })).videoKey!;
    const moi = { youtubeId: null, videoKey: `elearning/master/mqd${dem}/moi.mp4`, durationSec: 480 };
    const xt = await xemTruocDoiNguon({ lessonId: b.baiId, moi, actorUserId: "u-doi", coQuyenXuatBan: true });
    await doiNguonBaiVideo({
      lessonId: b.baiId,
      moi,
      duLieu: { title: `${P}Bài đã đổi`, videoKey: moi.videoKey, durationSec: 480 },
      actorUserId: "u-doi",
      actorName: "Đào tạo (thử)",
      coQuyenXuatBan: true,
      xacNhanToken: xt.xacNhanToken,
      lyDo: "đổi sang tệp mới để thử quyền media",
    });
    // sự cố cần chặn: tệp CŨ vẫn còn trên R2 (không ai xoá nó lúc đổi nguồn)
    expect(await hoi(b, cu, 1)).toMatchObject({ ok: false, status: 409, code: "NOI_DUNG_DA_DOI" });
    expect(await hoi(b, cu, 2)).toMatchObject({ ok: false, status: 404, code: "NOT_FOUND" });
    expect(await hoi(b, moi.videoKey, 2)).toEqual({ ok: true });
  }, CASE_TIMEOUT);

  it("[MQ-DB-03] 🔴 ghi danh bị THU HỒI sau khi cấp vé ⇒ 403; ghi danh đã HOÀN THÀNH vẫn xem được (cùng điều kiện với trang học)", async () => {
    const thuHoi = await dung("a3", { trangThai: "REVOKED" });
    const k1 = (await db.trnLesson.findUniqueOrThrow({ where: { id: thuHoi.baiId } })).videoKey!;
    expect(await hoi(thuHoi, k1)).toMatchObject({ ok: false, status: 403, code: "FORBIDDEN" });
    const xong = await dung("a3b", { trangThai: "COMPLETED" });
    const k2 = (await db.trnLesson.findUniqueOrThrow({ where: { id: xong.baiId } })).videoKey!;
    expect(await hoi(xong, k2)).toEqual({ ok: true });
  }, CASE_TIMEOUT);

  it("[MQ-DB-04] 🔴 ghi danh của NGƯỜI KHÁC vào cùng khoá không thay được ghi danh của mình: người cầm vé không có ghi danh ⇒ 403", async () => {
    const chu = await dung("a4");
    const nguoiLa = await seedUser({ email: `${P.toLowerCase()}la${HAU_TO}`, role: "TEACHER", name: `${P}Lạ` });
    const k = (await db.trnLesson.findUniqueOrThrow({ where: { id: chu.baiId } })).videoKey!;
    // `nguoiLa` cầm một vé hợp lệ về chữ ký cho bài này (giả định bị lộ/xin nhầm) nhưng KHÔNG có ghi danh vào khoá
    expect(await hoi(chu, k, 1, nguoiLa.id)).toMatchObject({ ok: false, status: 403, code: "FORBIDDEN" });
    expect(await hoi(chu, k)).toEqual({ ok: true });
  }, CASE_TIMEOUT);

  it("[MQ-DB-05] bài bị xoá mềm, hoặc khoá chứa bài bị xoá mềm ⇒ 404 (không phát media của thứ đã xoá)", async () => {
    const b1 = await dung("a5");
    const k1 = (await db.trnLesson.findUniqueOrThrow({ where: { id: b1.baiId } })).videoKey!;
    await db.trnLesson.update({ where: { id: b1.baiId }, data: { deletedAt: new Date() } });
    expect(await hoi(b1, k1)).toMatchObject({ ok: false, status: 404 });
    const b2 = await dung("a5b");
    const k2 = (await db.trnLesson.findUniqueOrThrow({ where: { id: b2.baiId } })).videoKey!;
    await db.trnCourse.update({ where: { id: b2.courseId }, data: { deletedAt: new Date() } });
    expect(await hoi(b2, k2)).toMatchObject({ ok: false, status: 404 });
  }, CASE_TIMEOUT);

  it("[MQ-DB-06] câu SQL đọc ĐÚNG phiên bản hiện hành và đúng bốn cột khoá tệp (không thiếu cột nào)", async () => {
    const b = await dung("a6");
    const r = await docQuyenMedia(b.userId, b.baiId);
    expect(r).not.toBeNull();
    expect(r!.bai).toMatchObject({ mediaRevision: 1, videoKey: expect.stringContaining("/cu.mp4"), captionKey: expect.stringContaining("/cu.vtt"), videoKey360: null, audioKey: null });
    await db.trnLesson.update({ where: { id: b.baiId }, data: { videoKey360: `elearning/master/mqd${dem}/cu-360.mp4`, audioKey: `elearning/audio/mqd${dem}/a.m4a`, mediaRevision: 7 } });
    const r2 = await docQuyenMedia(b.userId, b.baiId);
    expect(r2!.bai).toMatchObject({ mediaRevision: 7, videoKey360: expect.stringContaining("360"), audioKey: expect.stringContaining("a.m4a") });
    expect(await docQuyenMedia(b.userId, "bai-khong-ton-tai")).toBeNull();
  }, CASE_TIMEOUT);
});
