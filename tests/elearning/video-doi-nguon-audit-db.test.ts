// @vitest-environment node
/**
 * [AUD] AUDIT CÙNG GIAO DỊCH với đổi nguồn — Postgres THẬT.
 *
 * Trước: factory ghi audit SAU khi giao dịch đổi nguồn đã commit. Audit lỗi (DB chập, bảng đầy, hạn mức) để lại bài đã đổi nguồn,
 * tiến độ đã bị chụp + đặt lại, mà KHÔNG có dòng audit nào — đúng thứ sổ audit sinh ra để không bao giờ xảy ra.
 * Nay `writeAudit({ tx })` nằm TRONG giao dịch: audit lỗi ⇒ ném ⇒ cả đổi nguồn, bản chụp, đặt lại rollback.
 *
 * Tệp riêng vì phải `vi.mock` module audit cho cả tệp (chèn lỗi có điều khiển); mọi thứ khác là mã thật.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_AUD_` ở beforeAll VÀ afterAll.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** `hong`: false = chạy thật · true = ném TRƯỚC khi ghi · "sau" = ghi THẬT rồi mới ném (chứng minh dòng audit đi cùng giao dịch). */
const dieuKhien = vi.hoisted(() => ({ hong: false as boolean | "sau", daGoi: 0, coTx: [] as boolean[] }));

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/security/signing-key", () => ({
  getSigningSecret: () => "secret-test-aud-khong-dung-that-0123456789",
}));
vi.mock("@/lib/audit/audit-log", async (goc) => {
  const that = await goc<typeof import("@/lib/audit/audit-log")>();
  return {
    ...that,
    writeAudit: (p: Parameters<typeof that.writeAudit>[0]) => {
      dieuKhien.daGoi += 1;
      dieuKhien.coTx.push(Boolean(p.tx));
      if (dieuKhien.hong === "sau") {
        // Ghi THẬT bằng đúng client mà lời gọi truyền vào (tx hay db), rồi ném: nếu audit đi qua `tx` thì giao dịch rollback kéo theo cả
        // dòng này; nếu ai đó bỏ `tx` thì dòng audit nằm lại dù đổi nguồn đã rollback.
        return that.writeAudit(p).then(() => Promise.reject(new Error("audit hỏng SAU KHI ghi (chèn lỗi có điều khiển)")));
      }
      if (dieuKhien.hong) return Promise.reject(new Error("audit hỏng (chèn lỗi có điều khiển)"));
      return that.writeAudit(p);
    },
  };
});

import { db } from "../../lib/db";
import { doiNguonBaiVideo, xemTruocDoiNguon } from "../../lib/elearning/video-doi-nguon";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 60_000;
const P = "CI_AUD_";
const HAU_TO = "@aud.test";

let C: { centerId: string; orgUnitId: string };

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { endsWith: HAU_TO } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.trnLessonProgress.deleteMany({ where: { userId: { in: ids } } });
  await db.trnEnrollment.deleteMany({ where: { userId: { in: ids } } });
  await db.trnLesson.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnModule.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnCourseVersion.deleteMany({ where: { course: { code: { startsWith: P } } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
  if (ids.length > 0) await db.user.deleteMany({ where: { id: { in: ids } } });
}

async function dung(ten: string) {
  const khoa = await db.trnCourse.create({
    data: {
      code: `${P}K${ten}`,
      slug: `${P.toLowerCase()}k${ten}`,
      title: `${P}Khoá ${ten}`,
      status: "PUBLISHED",
      visibility: "ASSIGNED_ONLY",
      selfEnrollEnabled: false,
      sequential: false,
      securityLevel: "INTERNAL",
      centerId: C.centerId,
      orgUnitId: C.orgUnitId,
    },
    select: { id: true },
  });
  await db.trnCourseVersion.create({ data: { courseId: khoa.id, major: 1, minor: 0, status: "PUBLISHED", publishedAt: new Date() } });
  const mod = await db.trnModule.create({ data: { courseId: khoa.id, title: `${P}Mô-đun ${ten}`, orderIndex: 1 }, select: { id: true } });
  const bai = await db.trnLesson.create({
    data: { moduleId: mod.id, title: `${P}Bài ${ten}`, orderIndex: 1, kind: "VIDEO", durationSec: 600, videoKey: "elearning/master/aud/goc.mp4" },
    select: { id: true },
  });
  const u = await seedUser({ email: `${P.toLowerCase()}hv${ten}${HAU_TO}`, role: "TEACHER", name: `${P}HV ${ten}` });
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
  await db.trnLessonProgress.create({
    data: {
      enrollmentId: en.id,
      userId: u.id,
      lessonId: bai.id,
      segmentBitmap: Buffer.from([0xff, 0x0f]),
      coveredSec: 120,
      contentSec: 600,
      totalWatchSec: 127,
      maxPositionSec: 120,
      seq: 9,
      status: "IN_PROGRESS",
      firstStartedAt: new Date("2026-10-28T09:00:00.000Z"),
    },
  });
  return { baiId: bai.id, enrollmentId: en.id };
}

describe.skipIf(!RUN_DB_TESTS)("[AUD] audit và đổi nguồn sống/chết cùng nhau (Postgres thật)", () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    const cs1 = await db.orgUnit.findUniqueOrThrow({ where: { code: "CS1" }, select: { id: true, centerId: true } });
    C = { centerId: cs1.centerId as string, orgUnitId: cs1.id };
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    dieuKhien.hong = false;
    try {
      await cleanup();
    } catch {
      /* dọn lại ở lượt sau nhờ tiền tố */
    }
  }, HOOK_TIMEOUT);

  it("[AUD-01] 🔴 audit LỖI ⇒ toàn bộ rollback: bài giữ nguồn + phiên bản cũ, tiến độ nguyên, 0 bản chụp, 0 dòng audit; hết lỗi thì chạy lại thành công và có ĐÚNG một dòng audit", async () => {
    const b = await dung("a1");
    const moi = { youtubeId: "aBcDeFg_H-1", videoKey: null, durationSec: 480 };
    const xt = await xemTruocDoiNguon({ lessonId: b.baiId, moi, actorUserId: "u-doi", coQuyenXuatBan: true });
    const chay = () =>
      doiNguonBaiVideo({
        lessonId: b.baiId,
        moi,
        duLieu: { title: `${P}Bài đã đổi`, youtubeId: "aBcDeFg_H-1", videoKey: null, durationSec: 480 },
        actorUserId: "u-doi",
        actorName: "Đào tạo (thử)",
        coQuyenXuatBan: true,
        xacNhanToken: xt.xacNhanToken,
        lyDo: "đổi sang link để thử audit lỗi",
      });
    const truoc = {
      bai: await db.trnLesson.findUniqueOrThrow({ where: { id: b.baiId } }),
      hang: await db.trnLessonProgress.findUniqueOrThrow({ where: { enrollmentId_lessonId: { enrollmentId: b.enrollmentId, lessonId: b.baiId } } }),
    };

    dieuKhien.hong = true;
    dieuKhien.daGoi = 0;
    dieuKhien.coTx = [];
    const e = await chay().catch((x) => x);
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).toContain("audit hỏng");
    expect(dieuKhien.daGoi).toBe(1); // audit ĐÃ được thử TRONG giao dịch (không phải bỏ qua)
    expect(dieuKhien.coTx).toEqual([true]); // và được GỌI BẰNG client của giao dịch (`tx`), không phải `db` trần

    const sau = {
      bai: await db.trnLesson.findUniqueOrThrow({ where: { id: b.baiId } }),
      hang: await db.trnLessonProgress.findUniqueOrThrow({ where: { enrollmentId_lessonId: { enrollmentId: b.enrollmentId, lessonId: b.baiId } } }),
    };
    expect(sau.bai).toEqual(truoc.bai);
    expect(sau.bai.mediaRevision).toBe(1);
    expect(sau.bai.videoKey).toBe("elearning/master/aud/goc.mp4");
    expect(sau.hang).toEqual(truoc.hang);
    expect(sau.hang.coveredSec).toBe(120);
    expect(await db.trnLessonProgressRevision.count({ where: { lessonId: b.baiId } })).toBe(0);
    expect(await db.auditLog.count({ where: { entityType: "TrnLesson", entityId: b.baiId } })).toBe(0);

    // Hết lỗi ⇒ chạy lại với CÙNG chuỗi xác nhận (tập người học không đổi) ⇒ thành công, đủ cả bốn thứ.
    dieuKhien.hong = false;
    const kq = await chay();
    expect(kq).toMatchObject({ doiNguon: true, daGhiAudit: true, daChup: 1, daDatLai: 1 });
    expect((await db.trnLesson.findUniqueOrThrow({ where: { id: b.baiId } })).mediaRevision).toBe(2);
    expect(await db.trnLessonProgressRevision.count({ where: { lessonId: b.baiId } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityType: "TrnLesson", entityId: b.baiId } })).toBe(1);
  }, CASE_TIMEOUT);

  it("[AUD-02] nhánh KHÔNG đổi nguồn (chỉ metadata) không gọi audit trong giao dịch — factory ghi như mọi action khác", async () => {
    const b = await dung("a2");
    dieuKhien.hong = false;
    dieuKhien.daGoi = 0;
    const cu = await db.trnLesson.findUniqueOrThrow({ where: { id: b.baiId } });
    const kq = await doiNguonBaiVideo({
      lessonId: b.baiId,
      moi: { youtubeId: null, videoKey: cu.videoKey, durationSec: 600 },
      duLieu: { title: `${P}Chỉ đổi tên` },
      actorUserId: "u-doi",
      actorName: "Đào tạo (thử)",
      coQuyenXuatBan: false,
      xacNhanToken: null,
      lyDo: null,
    });
    expect(kq).toMatchObject({ doiNguon: false, daGhiAudit: false });
    expect(dieuKhien.daGoi).toBe(0);
  }, CASE_TIMEOUT);
});

describe.skipIf(!RUN_DB_TESTS)("[AUD-03] dòng audit đi CÙNG giao dịch với đổi nguồn (chứng minh bằng hành vi, không bằng tham số)", () => {
  it("🔴 audit ghi THẬT rồi lỗi ⇒ dòng audit vừa ghi bị rollback cùng giao dịch (bỏ `tx` ⇒ dòng nằm lại dù bài không đổi)", async () => {
    const b = await dung("a3");
    const moi = { youtubeId: "aBcDeFg_H-1", videoKey: null, durationSec: 480 };
    const xt = await xemTruocDoiNguon({ lessonId: b.baiId, moi, actorUserId: "u-doi", coQuyenXuatBan: true });
    dieuKhien.hong = "sau";
    dieuKhien.coTx = [];
    try {
      const e = await doiNguonBaiVideo({
        lessonId: b.baiId,
        moi,
        duLieu: { title: `${P}Bài đã đổi`, youtubeId: "aBcDeFg_H-1", videoKey: null, durationSec: 480 },
        actorUserId: "u-doi",
        actorName: "Đào tạo (thử)",
        coQuyenXuatBan: true,
        xacNhanToken: xt.xacNhanToken,
        lyDo: "đổi sang link để thử audit ghi rồi lỗi",
      }).catch((x) => x);
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toContain("SAU KHI ghi");
    } finally {
      dieuKhien.hong = false;
    }
    expect(dieuKhien.coTx).toEqual([true]);
    expect((await db.trnLesson.findUniqueOrThrow({ where: { id: b.baiId } })).mediaRevision).toBe(1);
    expect(await db.trnLessonProgressRevision.count({ where: { lessonId: b.baiId } })).toBe(0);
    // dòng audit ĐÃ ĐƯỢC GHI THẬT trong giao dịch — nó phải biến mất cùng giao dịch
    expect(await db.auditLog.count({ where: { entityType: "TrnLesson", entityId: b.baiId } })).toBe(0);
  }, CASE_TIMEOUT);
});
