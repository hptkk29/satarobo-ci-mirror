// @vitest-environment node
/**
 * [KP] KHÔI PHỤC tiến độ từ bản chụp (`khoiPhucTienDoTuBanChup`) — Postgres THẬT, DB CÔ LẬP (`ci_test`/`satarobo_test` của bộ test).
 *
 * Phủ bốn bất biến của kịch bản đối soát/phục hồi dùng cho UAT TEST:
 *  1. CHẠY THỬ LÀ CHỈ ĐỌC THẬT: không ghi, và quan trọng hơn — KHÔNG đứng chờ khoá ghi của người khác và không giữ khoá nào (dry-run
 *     cũ lấy `FOR UPDATE` nên chặn nhịp xem của mọi người đang học bài đó và không chạy được bằng vai chỉ-đọc).
 *  2. GHI THẬT khôi phục đúng lượt đang học, đúng giây phủ, không đụng thứ khác.
 *  3. THỜI LƯỢNG PHẢI KHỚP: bản chụp mang `contentSec`; nạp bitmap của video khác độ dài vào bài hiện hành là sai mẫu số.
 *  4. ROLLBACK NGUYÊN KHỐI: một câu ghi sau khi đã nạp tiến độ mà lỗi ⇒ KHÔNG còn nửa vời; chạy lại sau khi hết lỗi thì thành công.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_KPH_` ở beforeAll VÀ afterAll. Trigger thử (ca 4) tạo và gỡ ngay trong ca.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/security/signing-key", () => ({
  getSigningSecret: () => "secret-test-kph-khong-dung-that-0123456789",
}));

import { db } from "../../lib/db";
import { doiChieuTheoBai, doiNguonBaiVideo, khoiPhucTienDoTuBanChup, LoiDoiNguon, xemTruocDoiNguon } from "../../lib/elearning/video-doi-nguon";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 90_000;
const P = "CI_KPH_";
const HAU_TO = "@kph.test";
const T0 = new Date("2026-10-28T10:00:00.000Z");
const luc = (giay: number) => new Date(T0.getTime() + giay * 1000);
const nghi = (ms: number) => new Promise((r) => setTimeout(r, ms));

let C: { centerId: string; orgUnitId: string };
let dem = 0;

async function cleanup() {
  await db.$executeRaw`DROP TRIGGER IF EXISTS "ci_kph_chan" ON "TrnEnrollment"`;
  await db.$executeRaw`DROP FUNCTION IF EXISTS ci_kph_chan()`;
  const users = await db.user.findMany({ where: { email: { endsWith: HAU_TO } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.trnLessonProgress.deleteMany({ where: { userId: { in: ids } } });
  await db.trnEnrollment.deleteMany({ where: { userId: { in: ids } } });
  await db.trnLesson.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnModule.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
  if (ids.length > 0) await db.user.deleteMany({ where: { id: { in: ids } } });
}

/**
 * Khoá riêng: MỘT bài video (600 s) nguồn tệp + một lượt IN_PROGRESS đã xem `coveredSec` giây (hoặc DONE). Tiến độ nằm ở phiên bản 1.
 */
async function dung(ten: string, o: { trangThai?: "IN_PROGRESS" | "DONE"; covered?: number } = {}) {
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
  const goc = `elearning/master/kph/${dem}-goc.mp4`;
  const bai = await db.trnLesson.create({
    data: { moduleId: mod.id, title: `${P}Bài ${dem}`, orderIndex: 1, kind: "VIDEO", durationSec: 600, videoKey: goc },
    select: { id: true },
  });
  const u = await seedUser({ email: `${P.toLowerCase()}${ten}${HAU_TO}`, role: "TEACHER", name: `${P}${ten}` });
  const dong = o.trangThai === "DONE";
  const covered = o.covered ?? (dong ? 600 : 120);
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
      progressPercent: dong ? 100 : 0,
    },
    select: { id: true },
  });
  await db.trnLessonProgress.create({
    data: {
      enrollmentId: en.id,
      userId: u.id,
      lessonId: bai.id,
      segmentBitmap: Buffer.from([0xff, 0x0f]),
      coveredSec: covered,
      contentSec: 600,
      totalWatchSec: covered + 7,
      maxPositionSec: covered,
      seekCount: 2,
      blockedSeekCount: 1,
      seq: 9,
      status: dong ? "DONE" : "IN_PROGRESS",
      firstStartedAt: luc(-900),
      completedAt: dong ? luc(-800) : null,
      verifiedAt: dong ? luc(-800) : null,
    },
  });
  return { baiId: bai.id, enrollmentId: en.id, courseId: khoa.id, userId: u.id, goc };
}
type Bai = Awaited<ReturnType<typeof dung>>;

/** Đổi nguồn qua ĐÚNG đường chính thức (xem trước → lấy chuỗi → lưu), khỏi giả cờ. */
async function doi(b: Bai, moi: { youtubeId?: string | null; videoKey?: string | null; durationSec: number }, giay: number) {
  const nguon = { youtubeId: moi.youtubeId ?? null, videoKey: moi.videoKey ?? null, durationSec: moi.durationSec };
  const xt = await xemTruocDoiNguon({ lessonId: b.baiId, moi: nguon, actorUserId: "u-doi", coQuyenXuatBan: true, now: luc(giay) });
  return doiNguonBaiVideo({
    lessonId: b.baiId,
    moi: nguon,
    duLieu: { title: `${P}Bài đã đổi`, youtubeId: nguon.youtubeId, videoKey: nguon.videoKey, durationSec: nguon.durationSec },
    actorUserId: "u-doi",
    actorName: "Đào tạo (thử)",
    coQuyenXuatBan: true,
    xacNhanToken: xt.xacNhanToken,
    lyDo: "ca thử khôi phục",
    now: luc(giay),
  });
}

const hang = (b: Bai) => db.trnLessonProgress.findUniqueOrThrow({ where: { enrollmentId_lessonId: { enrollmentId: b.enrollmentId, lessonId: b.baiId } } });

/** Đổi A → B (rev 2) rồi B → A' cùng độ dài 600 (rev 3): hàng hiện hành ở rev 3 đã bị đặt lại, bản chụp rev 1 giữ tiến độ gốc. */
async function doiRoiDoiLai(b: Bai) {
  await doi(b, { youtubeId: "aBcDeFg_H-1", durationSec: 480 }, 100);
  await doi(b, { videoKey: b.goc, youtubeId: null, durationSec: 600 }, 200);
}

describe.skipIf(!RUN_DB_TESTS)("[KP] khôi phục tiến độ từ bản chụp (Postgres thật, DB cô lập)", () => {
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

  it("[KP-01] 🔴 CHẠY THỬ không đứng chờ khoá ghi của người khác (không `FOR UPDATE`); GHI THẬT thì có chờ — đối chứng", async () => {
    const b = await dung("a1");
    await doiRoiDoiLai(b);
    // Người khác giữ khoá GHI dòng bài (đúng thứ giao dịch đổi nguồn / nhịp xem làm) trong lúc ta chạy kịch bản.
    let nha!: () => void;
    const giu = new Promise<void>((r) => (nha = r));
    let daKhoa!: () => void;
    const khoaXong = new Promise<void>((r) => (daKhoa = r));
    const holder = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "TrnLesson" WHERE "id" = ${b.baiId} FOR UPDATE`;
        daKhoa();
        await giu;
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
    await khoaXong;
    try {
      const thu = await Promise.race([
        khoiPhucTienDoTuBanChup({ lessonId: b.baiId, tuRev: 1, apply: false }),
        nghi(5_000).then(() => "KET_CHO" as const),
      ]);
      expect(thu, "chạy thử bị chặn bởi khoá của người khác ⇒ nó đang lấy khoá").not.toBe("KET_CHO");
      expect(thu).toMatchObject({ khoiPhuc: 1, daApDung: false });

      // Đối chứng: GHI THẬT phải đứng chờ khoá đó (nếu không thì thí nghiệm này không chứng minh gì về dry-run).
      const ghi = Promise.race([
        khoiPhucTienDoTuBanChup({ lessonId: b.baiId, tuRev: 1, apply: true }),
        nghi(1_500).then(() => "DANG_CHO" as const),
      ]);
      expect(await ghi).toBe("DANG_CHO");
    } finally {
      nha();
      await holder;
    }
    // Khoá nhả ⇒ lệnh ghi thật còn treo ở trên đã chạy xong ngầm hoặc chưa — dọn bằng một lượt ghi tường minh để trạng thái xác định.
    await khoiPhucTienDoTuBanChup({ lessonId: b.baiId, tuRev: 1, apply: true });
  }, CASE_TIMEOUT);

  it("[KP-02] CHẠY THỬ không ghi gì: hàng tiến độ, lượt học, số bản chụp nguyên vẹn; kế hoạch nói đúng số sẽ khôi phục", async () => {
    const b = await dung("a2");
    await doiRoiDoiLai(b);
    const truoc = { hang: await hang(b), luot: await db.trnEnrollment.findUniqueOrThrow({ where: { id: b.enrollmentId } }), banChup: await db.trnLessonProgressRevision.count({ where: { lessonId: b.baiId } }) };
    const ke = await khoiPhucTienDoTuBanChup({ lessonId: b.baiId, tuRev: 1, apply: false });
    expect(ke).toMatchObject({ khoiPhuc: 1, daApDung: false });
    expect(await hang(b)).toEqual(truoc.hang);
    expect(await db.trnEnrollment.findUniqueOrThrow({ where: { id: b.enrollmentId } })).toEqual(truoc.luot);
    expect(await db.trnLessonProgressRevision.count({ where: { lessonId: b.baiId } })).toBe(truoc.banChup);
  }, CASE_TIMEOUT);

  it("[KP-03] GHI THẬT khôi phục đúng lượt đang học từ bản chụp rev 1: giây phủ + bitmap + trạng thái trở lại; phiên bản hiện hành giữ nguyên", async () => {
    const b = await dung("a3");
    await doiRoiDoiLai(b);
    expect((await hang(b)).coveredSec).toBe(0);
    const ke = await khoiPhucTienDoTuBanChup({ lessonId: b.baiId, tuRev: 1, apply: true });
    expect(ke).toMatchObject({ khoiPhuc: 1, daApDung: true });
    const sau = await hang(b);
    expect(sau).toMatchObject({ coveredSec: 120, status: "IN_PROGRESS", mediaRevision: 3, contentSec: 600 });
    expect(Buffer.from(sau.segmentBitmap!).equals(Buffer.from([0xff, 0x0f]))).toBe(true);
    // 🔴 ghi đè tiến độ học PHẢI để lại vết: đúng MỘT dòng audit (người chạy = kịch bản vận hành), không chứa mã nguồn
    const dong = await db.auditLog.findMany({ where: { entityType: "TrnLesson", entityId: b.baiId, actorName: { contains: "khôi phục" } } });
    expect(dong).toHaveLength(1);
    expect(dong[0]!.actorId).toBeNull();
    expect(dong[0]!.newValues).toMatchObject({ khoiPhucTuPhienBan: 1, phienBanHienTai: 3, daKhoiPhuc: 1 });
    expect(JSON.stringify(dong[0])).not.toMatch(/elearning\/master|youtube/i);
    // chạy lại: hàng đã có tiến độ ⇒ bỏ qua, không ghi đè
    const lai = await khoiPhucTienDoTuBanChup({ lessonId: b.baiId, tuRev: 1, apply: true });
    expect(lai.khoiPhuc).toBe(0);
    expect(lai.boQua.daCoTienDoMoi).toBe(1);
    // không khôi phục gì ⇒ không thêm dòng audit
    expect(await db.auditLog.count({ where: { entityType: "TrnLesson", entityId: b.baiId, actorName: { contains: "khôi phục" } } })).toBe(1);
  }, CASE_TIMEOUT);

  it("[KP-04] 🔴 THỜI LƯỢNG LỆCH: bản chụp 600 s mà bài hiện hành dài 480 s ⇒ KHÔNG khôi phục (kể cả --apply), đếm vào `khacThoiLuong`", async () => {
    const b = await dung("a4");
    // A(600) → B(480) rồi dừng ở B: rev 2, hàng hiện hành bị đặt lại; bản chụp rev 1 mang contentSec 600.
    await doi(b, { youtubeId: "aBcDeFg_H-1", durationSec: 480 }, 100);
    const truoc = await hang(b);
    const thu = await khoiPhucTienDoTuBanChup({ lessonId: b.baiId, tuRev: 1, apply: false });
    expect(thu.khoiPhuc).toBe(0);
    expect(thu.boQua.khacThoiLuong).toBe(1);
    const ghi = await khoiPhucTienDoTuBanChup({ lessonId: b.baiId, tuRev: 1, apply: true });
    expect(ghi).toMatchObject({ khoiPhuc: 0 });
    expect(await hang(b)).toEqual(truoc);
    expect((await hang(b)).coveredSec).toBe(0);
  }, CASE_TIMEOUT);

  it("[KP-05] 🔴 ROLLBACK NGUYÊN KHỐI: câu cuối (làm mới phần trăm khoá) lỗi ⇒ hàng tiến độ KHÔNG bị nạp nửa vời; hết lỗi thì chạy lại thành công", async () => {
    const b = await dung("a5", { trangThai: "DONE" });
    await doiRoiDoiLai(b);
    // sau đổi: hàng NOT_STARTED, progressPercent của lượt về 0
    expect((await hang(b)).status).toBe("NOT_STARTED");
    expect((await db.trnEnrollment.findUniqueOrThrow({ where: { id: b.enrollmentId } })).progressPercent).toBe(0);
    // Khôi phục rev 1 đưa bài về DONE ⇒ phần trăm khoá 0 → 100 ⇒ UPDATE TrnEnrollment. Chặn đúng UPDATE đó bằng trigger thử.
    await db.$executeRaw`CREATE OR REPLACE FUNCTION ci_kph_chan() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN RAISE EXCEPTION 'ci_kph_chan: chặn thử ghi phần trăm khoá'; END $f$`;
    await db.$executeRaw(
      Prisma.sql`CREATE TRIGGER "ci_kph_chan" BEFORE UPDATE ON "TrnEnrollment" FOR EACH ROW
        WHEN (NEW."id" = ${Prisma.raw(`'${b.enrollmentId}'`)} AND NEW."progressPercent" = 100) EXECUTE FUNCTION ci_kph_chan()`,
    );
    try {
      const e = await khoiPhucTienDoTuBanChup({ lessonId: b.baiId, tuRev: 1, apply: true }).catch((x) => x);
      expect(e).toBeInstanceOf(Error);
      expect(String((e as Error).message)).toContain("ci_kph_chan");
      // KHÔNG nửa vời: hàng tiến độ vẫn ở trạng thái đặt lại, không bị nạp DONE
      expect(await hang(b)).toMatchObject({ coveredSec: 0, status: "NOT_STARTED", mediaRevision: 3 });
      expect((await db.trnEnrollment.findUniqueOrThrow({ where: { id: b.enrollmentId } })).progressPercent).toBe(0);
    } finally {
      await db.$executeRaw`DROP TRIGGER IF EXISTS "ci_kph_chan" ON "TrnEnrollment"`;
      await db.$executeRaw`DROP FUNCTION IF EXISTS ci_kph_chan()`;
    }
    // hết lỗi ⇒ chạy lại được, và lần này khôi phục đủ
    const ok = await khoiPhucTienDoTuBanChup({ lessonId: b.baiId, tuRev: 1, apply: true });
    expect(ok).toMatchObject({ khoiPhuc: 1, daApDung: true });
    expect(await hang(b)).toMatchObject({ coveredSec: 600, status: "DONE" });
    expect((await db.trnEnrollment.findUniqueOrThrow({ where: { id: b.enrollmentId } })).progressPercent).toBe(100);
  }, CASE_TIMEOUT);
});

describe.skipIf(!RUN_DB_TESTS)("[KP-06] đối soát: gõ nhầm mã bài KHÔNG được báo 'khớp'", () => {
  it("🔴 bài không tồn tại ⇒ ném NOT_FOUND (trước đây: rev 1, 0 hàng, 'ĐỐI SOÁT: KHỚP' mã thoát 0 — kết quả xanh giả)", async () => {
    const e = await doiChieuTheoBai(db, "bai-khong-ton-tai").catch((x) => x);
    expect(e).toBeInstanceOf(LoiDoiNguon);
    expect((e as LoiDoiNguon).ma).toBe("NOT_FOUND");
  });
});
