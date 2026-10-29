// @vitest-environment node
/**
 * ĐỔI NGUỒN BÀI VIDEO — CÁCH LY CƠ SỞ trên Postgres THẬT (`runAction` thật + `scopedDb` thật).
 *
 * Vì sao phải đo trên DB thật: `TrnLesson`/`TrnModule` KHÔNG nằm trong `SCOPED_MODELS`, nên `db.trnLesson.findFirst` trả bài của MỌI
 * cơ sở, và `can("elearning:content:publish")` không mang target (quyền seed là GLOBAL). Cổng cách ly DUY NHẤT là lượt đọc KHOÁ qua
 * `scopedDb` (`chanPhamViKhoa` trong `lib/elearning/video-lesson.ts`). Test mock (`video-lesson.test.ts` `[CS-DOI-NGUON]`) chỉ chứng
 * minh handler GỌI cổng; ca này chứng minh cổng THẬT SỰ lọc — khai thiếu `getModelPrefixes()`/`centerId` của `TrnCourse` thì mock vẫn xanh.
 *
 * Kịch bản xấu nhất được thử: vai `TRAINING` (có CẢ quyền soạn lẫn xuất bản) bị NEO Ở MỘT CƠ SỞ (CS1), khoá riêng của CS2 đã xuất bản,
 * có lượt đang học, kèm cờ xác nhận tác động ⇒ nếu cổng hỏng thì nguồn bị đổi, tiến độ bị chụp và đặt lại, không lỗi nào báo.
 *
 * ĐỐI CHỨNG DƯƠNG (luật 11): cùng vai, cùng lệnh, bài của CS1 ⇒ ĐƯỢC; người neo ở Hội sở đổi được bài của CS2. Không có hai ca này thì
 * "bị từ chối" cũng xanh khi quyền soạn hỏng hoàn toàn.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`, không TRUNCATE; dọn theo tiền tố `CI_VDC_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));

import { db } from "../../lib/db";
import { assertTestDb, disconnectDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";
import { resolveActorUncached } from "../../lib/auth/actor";
import { runAction } from "../../lib/actions/factory";
import { cauHinhLuuBaiVideo, cauHinhLuuBaiVideoYoutube, cauHinhXemTruocDoiNguon } from "../../lib/elearning/video-lesson";
import { RUN_DB_TESTS as RUN } from "../_helpers/db-gate";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 60_000;
const P = "CI_VDC_";
const HAU_TO = "@ci.test";

type Co = { id: string; centerId: string | null };
type Bai = { courseId: string; lessonId: string; enrollmentId: string; userId: string };

let CS1: Co;
let CS2: Co;
let F: { nguoiCs1: string; nguoiHo: string };
let BAI_CS1: Bai;
let BAI_CS2: Bai;

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { startsWith: P.toLowerCase() } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  // KHÔNG xoá `TrnLessonProgressRevision` trực tiếp: trigger bất biến của B1 chặn xoá trực tiếp (chỉ cho xoá theo CASCADE khi
  // xoá bài, `pg_trigger_depth() > 1`). Xoá bài ở dưới kéo theo bản chụp.
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

/** Khoá RIÊNG của một cơ sở (centerId + orgUnitId), ĐÃ XUẤT BẢN, một bài video có nguồn tệp + một lượt đang học xem dở. */
async function dungBai(ten: string, cs: { id: string; centerId: string | null }): Promise<Bai> {
  const khoa = await db.trnCourse.create({
    data: {
      code: `${P}${ten}`,
      slug: `${P.toLowerCase()}${ten.toLowerCase()}`,
      title: `${P}Khoá ${ten}`,
      status: "PUBLISHED",
      visibility: "ASSIGNED_ONLY",
      selfEnrollEnabled: false,
      sequential: false,
      securityLevel: "INTERNAL",
      centerId: cs.centerId,
      orgUnitId: cs.id,
    },
    select: { id: true },
  });
  await db.trnCourseVersion.create({ data: { courseId: khoa.id, major: 1, minor: 0, status: "PUBLISHED", publishedAt: new Date() } });
  const mod = await db.trnModule.create({ data: { courseId: khoa.id, title: `${P}Mô-đun ${ten}`, orderIndex: 1 }, select: { id: true } });
  const bai = await db.trnLesson.create({
    data: {
      moduleId: mod.id,
      title: `${P}Bài ${ten}`,
      orderIndex: 1,
      kind: "VIDEO",
      durationSec: 600,
      videoKey: `elearning/master/${P}${ten}/goc.mp4`,
    },
    select: { id: true },
  });
  const hv = await seedUser({ email: `${P.toLowerCase()}hv${ten.toLowerCase()}${HAU_TO}`, name: `${P}HV ${ten}`, role: "TEACHER" });
  const en = await db.trnEnrollment.create({
    data: {
      courseId: khoa.id,
      userId: hv.id,
      cycle: 1,
      status: "IN_PROGRESS",
      source: "SELF_ENROLL",
      centerId: cs.centerId as string,
      orgUnitId: cs.id,
      snapJobTitle: "Nhân viên",
      progressPercent: 0,
    },
    select: { id: true },
  });
  await db.trnLessonProgress.create({
    data: {
      enrollmentId: en.id,
      userId: hv.id,
      lessonId: bai.id,
      segmentBitmap: Buffer.from([0xff, 0x0f]),
      coveredSec: 120,
      contentSec: 600,
      totalWatchSec: 127,
      maxPositionSec: 120,
      seekCount: 2,
      blockedSeekCount: 1,
      attnAskedCount: 1,
      attnPassedCount: 1,
      seq: 9,
      status: "IN_PROGRESS",
      firstStartedAt: new Date(Date.now() - 3600_000),
    },
  });
  return { courseId: khoa.id, lessonId: bai.id, enrollmentId: en.id, userId: hv.id };
}

const trangThaiBai = async (b: Bai) => ({
  bai: await db.trnLesson.findUniqueOrThrow({ where: { id: b.lessonId } }),
  hang: await db.trnLessonProgress.findUniqueOrThrow({ where: { enrollmentId_lessonId: { enrollmentId: b.enrollmentId, lessonId: b.lessonId } } }),
  luot: await db.trnEnrollment.findUniqueOrThrow({ where: { id: b.enrollmentId } }),
  soBanChup: await db.trnLessonProgressRevision.count({ where: { lessonId: b.lessonId } }),
});

type Actor = Awaited<ReturnType<typeof resolveActorUncached>>;
const TEN = { actorName: "Đào tạo (thử)" };

/** Đúng đường form đi: XEM TRƯỚC (lấy chuỗi xác nhận ký) rồi mới LƯU kèm chuỗi đó. */
const xemTruocYoutube = (actor: Actor, lessonId: string) =>
  runAction(cauHinhXemTruocDoiNguon, actor, { lessonId, loai: "YOUTUBE", url: "https://youtu.be/aBcDeFg_H-1", durationSec: 480 }, TEN);
const xemTruocMp4 = (actor: Actor, lessonId: string) =>
  runAction(cauHinhXemTruocDoiNguon, actor, { lessonId, loai: "TEP", videoKey: `elearning/master/${lessonId}/moi.mp4`, durationSec: 480 }, TEN);

const luuYoutube = async (actor: Actor, lessonId: string) => {
  const xt = await xemTruocYoutube(actor, lessonId);
  const token = xt.res.ok ? (xt.res.data.xacNhanToken ?? undefined) : undefined;
  return runAction(
    cauHinhLuuBaiVideoYoutube,
    actor,
    { lessonId, title: `${P}Đổi sang YouTube`, url: "https://youtu.be/aBcDeFg_H-1", durationSec: 480, coPhuDe: false, ...(token ? { xacNhanToken: token } : {}) },
    { ...TEN, reason: "ca cách ly cơ sở" },
  );
};

const luuMp4 = async (actor: Actor, lessonId: string) => {
  const xt = await xemTruocMp4(actor, lessonId);
  const token = xt.res.ok ? (xt.res.data.xacNhanToken ?? undefined) : undefined;
  return runAction(
    cauHinhLuuBaiVideo,
    actor,
    { lessonId, title: `${P}Đổi MP4`, videoKey: `elearning/master/${lessonId}/moi.mp4`, durationSec: 480, ...(token ? { xacNhanToken: token } : {}) },
    { ...TEN, reason: "ca cách ly cơ sở" },
  );
};

describe.skipIf(!RUN)("đổi nguồn bài video — cách ly CƠ SỞ (Postgres thật)", () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    const [ho, cs1, cs2] = await Promise.all(
      ["HO", "CS1", "CS2"].map((code) => db.orgUnit.findUniqueOrThrow({ where: { code }, select: { id: true, centerId: true } })),
    );
    CS1 = cs1;
    CS2 = cs2;
    // vai TRAINING (soạn + xuất bản) neo ở CS1 — KHÔNG phải cấp Hội sở
    const nguoiCs1 = await seedUser({ email: `${P.toLowerCase()}dt1${HAU_TO}`, name: `${P}ĐT CS1`, role: "TRAINING" });
    await gan(nguoiCs1.id, cs1.id, "TRAINING");
    // cùng vai neo ở Hội sở
    const nguoiHo = await seedUser({ email: `${P.toLowerCase()}dtho${HAU_TO}`, name: `${P}ĐT HO`, role: "TRAINING" });
    await gan(nguoiHo.id, ho.id, "TRAINING");
    F = { nguoiCs1: nguoiCs1.id, nguoiHo: nguoiHo.id };
    BAI_CS1 = await dungBai("CS1", CS1);
    BAI_CS2 = await dungBai("CS2", CS2);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectDb();
    }
  }, HOOK_TIMEOUT);

  it("[CSV-00] nền: người TRAINING neo ở CS1 KHÔNG phải cấp Hội sở; người neo ở HO thì có", async () => {
    const a1 = await resolveActorUncached(F.nguoiCs1);
    const aHo = await resolveActorUncached(F.nguoiHo);
    expect(a1.isHoLevel).toBe(false);
    expect(aHo.isHoLevel).toBe(true);
  }, CASE_TIMEOUT);

  it("[CSV-01] ĐỐI CHỨNG DƯƠNG: người neo CS1 đổi nguồn bài của khoá CS1 ⇒ ĐƯỢC (quyền soạn + xuất bản đủ; không thì các ca 'bị từ chối' dưới đây vô nghĩa)", async () => {
    const a = await resolveActorUncached(F.nguoiCs1);
    const { res } = await luuYoutube(a, BAI_CS1.lessonId);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const t = await trangThaiBai(BAI_CS1);
    expect(t.bai.youtubeId).toBe("aBcDeFg_H-1");
    expect(t.bai.mediaRevision).toBe(2);
    expect(t.soBanChup).toBe(1); // lượt đang học của CS1 được chụp
    expect(t.hang.coveredSec).toBe(0); // và bắt đầu lại
    // 🔴 qua ACTION thật: đúng MỘT dòng audit (giao dịch ghi, factory KHÔNG ghi lần hai) và nó mang phạm vi cơ sở của khoá
    const audit = await db.auditLog.findMany({ where: { entityType: "TrnLesson", entityId: BAI_CS1.lessonId } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.orgUnitId).toBe(CS1.id);
  }, CASE_TIMEOUT);

  it("[CSV-02] 🔴 người neo CS1 đổi nguồn (YouTube) bài của khoá CS2 ⇒ NOT_FOUND; nguồn, phiên bản, tiến độ, bản chụp NGUYÊN VẸN", async () => {
    const a = await resolveActorUncached(F.nguoiCs1);
    const truoc = await trangThaiBai(BAI_CS2);
    const { res } = await luuYoutube(a, BAI_CS2.lessonId);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
    const sau = await trangThaiBai(BAI_CS2);
    expect(sau).toEqual(truoc);
    expect(sau.bai.mediaRevision).toBe(1);
    expect(sau.bai.youtubeId).toBeNull();
    expect(sau.soBanChup).toBe(0);
    expect(sau.hang.coveredSec).toBe(120);
  }, CASE_TIMEOUT);

  it("[CSV-03] 🔴 như CSV-02 nhưng đường TẢI MP4", async () => {
    const a = await resolveActorUncached(F.nguoiCs1);
    const truoc = await trangThaiBai(BAI_CS2);
    const { res } = await luuMp4(a, BAI_CS2.lessonId);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
    expect(await trangThaiBai(BAI_CS2)).toEqual(truoc);
  }, CASE_TIMEOUT);

  it("[CSV-04] khoá của cơ sở khác trả CÙNG lỗi với bài không tồn tại (không cho dò id nào có thật)", async () => {
    const a = await resolveActorUncached(F.nguoiCs1);
    const ngoaiPhamVi = await luuYoutube(a, BAI_CS2.lessonId);
    const khongCo = await luuYoutube(a, "bai-khong-ton-tai");
    expect(ngoaiPhamVi.res.ok).toBe(false);
    expect(khongCo.res.ok).toBe(false);
    if (ngoaiPhamVi.res.ok || khongCo.res.ok) return;
    expect(ngoaiPhamVi.res.error.code).toBe(khongCo.res.error.code);
    expect(ngoaiPhamVi.res.error.message).toBe(khongCo.res.error.message);
  }, CASE_TIMEOUT);

  it("[CSV-06] 🔴 XEM TRƯỚC cũng cách ly cơ sở: người neo CS1 xem trước bài của khoá CS2 ⇒ NOT_FOUND, KHÔNG phát chuỗi xác nhận, KHÔNG lộ số người học", async () => {
    const a = await resolveActorUncached(F.nguoiCs1);
    const truoc = await trangThaiBai(BAI_CS2);
    for (const xt of [await xemTruocYoutube(a, BAI_CS2.lessonId), await xemTruocMp4(a, BAI_CS2.lessonId)]) {
      expect(xt.res.ok).toBe(false);
      if (xt.res.ok) return;
      expect(xt.res.error.code).toBe("NOT_FOUND");
      expect(JSON.stringify(xt.res)).not.toMatch(/xacNhanToken|ghiDanhDangHoc|người học|lượt học/);
    }
    expect(await trangThaiBai(BAI_CS2)).toEqual(truoc);
  }, CASE_TIMEOUT);

  it("[CSV-05] ĐỐI CHỨNG DƯƠNG: người neo Hội sở đổi nguồn bài của khoá CS2 ⇒ ĐƯỢC, và lượt đang học của CS2 được chụp + bắt đầu lại", async () => {
    const a = await resolveActorUncached(F.nguoiHo);
    const { res } = await luuYoutube(a, BAI_CS2.lessonId);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const t = await trangThaiBai(BAI_CS2);
    expect(t.bai.mediaRevision).toBe(2);
    expect(t.bai.youtubeId).toBe("aBcDeFg_H-1");
    expect(t.soBanChup).toBe(1);
    expect(t.hang.coveredSec).toBe(0);
  }, CASE_TIMEOUT);
});
