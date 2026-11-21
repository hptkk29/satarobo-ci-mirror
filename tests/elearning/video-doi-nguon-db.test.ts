// @vitest-environment node
/**
 * ĐỔI NGUỒN BÀI VIDEO (B2) — chụp bất biến + bắt đầu lại tiến độ, trên Postgres THẬT.
 *
 * Chính sách (owner 28/10/2026, D5 (a)): lượt ĐANG HỌC được chụp rồi bắt đầu lại ở phiên bản mới; lượt ĐÃ KẾT THÚC giữ
 * nguyên trạng thái/chứng nhận/hàng tiến độ (đóng băng ở phiên bản cũ). Metadata không bao giờ đổi phiên bản.
 *
 * Mỗi ca dựng KHOÁ RIÊNG (một khoá — 1–2 bài) nên `progressPercent` kiểm được chính xác. Lấy số đo TRƯỚC khi đổi, đổi,
 * rồi đối chiếu bằng `doiChieuTheoBai` (cùng phép đo với SQL ở tài liệu thiết kế, B5).
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; dọn theo tiền tố `CI_VDN_` ở beforeAll VÀ afterAll. Chạy: `pnpm test:elearning-db`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/security/signing-key", () => ({
  getSigningSecret: () => "secret-test-vdn-khong-dung-that-0123456789",
}));

import { db } from "../../lib/db";
import { resolveActorUncached } from "../../lib/auth/actor";
import { ghiNhipXem } from "../../lib/elearning/video-heartbeat";
import { kyVeMedia } from "../../lib/elearning/media-ticket";
import { currentPolicyVersion, ELEARNING_POLICY_KEY } from "../../lib/elearning/policy-acceptance";
import {
  docTacDongDoiNguon,
  doiChieuTheoBai,
  doiNguonBaiVideo,
  khoiPhucTienDoTuBanChup,
  LoiDoiNguon,
  xemTruocDoiNguon,
} from "../../lib/elearning/video-doi-nguon";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 90_000;
const P = "CI_VDN_";
const HAU_TO = "@vdn.test";
const T0 = new Date("2026-10-28T10:00:00.000Z");
const luc = (giay: number) => new Date(T0.getTime() + giay * 1000);

let C: { centerId: string; orgUnitId: string };
let dem = 0;

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

type Khoa = { courseId: string; baiA: string; baiB: string | null };

/** Một khoá riêng: bài A (video 600 giây, nguồn tệp) và tuỳ chọn bài B (để `progressPercent` có mẫu số 2). */
async function dungKhoa(o: { xuatBan?: boolean; coBaiB?: boolean; nguon?: "tep" | "khong" } = {}): Promise<Khoa> {
  dem += 1;
  const khoa = await db.trnCourse.create({
    data: {
      code: `${P}K${dem}`,
      slug: `${P.toLowerCase()}k${dem}`,
      title: `${P}Khoá ${dem}`,
      status: o.xuatBan ? "PUBLISHED" : "DRAFT",
      visibility: "ASSIGNED_ONLY",
      selfEnrollEnabled: false,
      sequential: false,
      securityLevel: "INTERNAL",
    },
    select: { id: true },
  });
  if (o.xuatBan) {
    await db.trnCourseVersion.create({ data: { courseId: khoa.id, major: 1, minor: 0, status: "PUBLISHED", publishedAt: new Date() } });
  }
  const mod = await db.trnModule.create({ data: { courseId: khoa.id, title: `${P}Mô-đun ${dem}`, orderIndex: 1 }, select: { id: true } });
  const baiA = await db.trnLesson.create({
    data: {
      moduleId: mod.id,
      title: `${P}Bài A ${dem}`,
      orderIndex: 1,
      kind: "VIDEO",
      durationSec: o.nguon === "khong" ? null : 600,
      ...(o.nguon === "khong" ? {} : { videoKey: `elearning/master/vdn/${dem}-a.mp4` }),
    },
    select: { id: true },
  });
  const baiB = o.coBaiB
    ? await db.trnLesson.create({
        data: {
          moduleId: mod.id,
          title: `${P}Bài B ${dem}`,
          orderIndex: 2,
          kind: "VIDEO",
          durationSec: 300,
          videoKey: `elearning/master/vdn/${dem}-b.mp4`,
        },
        select: { id: true },
      })
    : null;
  return { courseId: khoa.id, baiA: baiA.id, baiB: baiB?.id ?? null };
}

async function taoNguoi(ten: string) {
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
  return u.id;
}

type TrangThaiLuot = "NOT_STARTED" | "IN_PROGRESS" | "OVERDUE" | "COMPLETED" | "COMPLETED_LATE" | "REVOKED";

async function luotHoc(ten: string, khoa: Khoa, status: TrangThaiLuot, progressPercent = 0) {
  const userId = await taoNguoi(ten);
  const en = await db.trnEnrollment.create({
    data: {
      courseId: khoa.courseId,
      userId,
      cycle: 1,
      status,
      source: "SELF_ENROLL",
      centerId: C.centerId,
      orgUnitId: C.orgUnitId,
      snapJobTitle: "Nhân viên",
      progressPercent,
      ...(status === "COMPLETED" || status === "COMPLETED_LATE" ? { completedAt: luc(-500), verifiedAt: luc(-500) } : {}),
    },
    select: { id: true },
  });
  return { userId, enrollmentId: en.id };
}

async function tienDo(
  n: { userId: string; enrollmentId: string },
  baiId: string,
  o: { status: "NOT_STARTED" | "IN_PROGRESS" | "DONE"; coveredSec: number; seq?: number; cueLog?: object },
) {
  return db.trnLessonProgress.create({
    data: {
      enrollmentId: n.enrollmentId,
      userId: n.userId,
      lessonId: baiId,
      segmentBitmap: o.coveredSec > 0 ? Buffer.from([0xff, 0x0f]) : null,
      coveredSec: o.coveredSec,
      contentSec: 600,
      totalWatchSec: o.coveredSec + 7,
      maxPositionSec: o.coveredSec,
      seekCount: 2,
      blockedSeekCount: 1,
      attnAskedCount: 1,
      attnPassedCount: 1,
      seq: o.seq ?? 9,
      status: o.status,
      firstStartedAt: o.coveredSec > 0 ? luc(-900) : null,
      completedAt: o.status === "DONE" ? luc(-800) : null,
      verifiedAt: o.status === "DONE" ? luc(-800) : null,
      ...(o.cueLog ? { cueLogJson: o.cueLog } : {}),
    },
  });
}

/**
 * Gọi giao dịch đổi nguồn. `xacNhan` (mặc định `true`) ở ĐÂY là tuỳ chọn của test, không phải tham số của hàm thật: `true` ⇒ lấy
 * chuỗi xác nhận THẬT từ `xemTruocDoiNguon` trên trạng thái hiện tại (đúng đường form đi), `false` ⇒ không gửi chuỗi nào.
 * Muốn thử chuỗi hỏng/cũ/của người khác thì truyền thẳng `xacNhanToken`.
 */
const doi = async (
  baiId: string,
  moi: { youtubeId?: string | null; videoKey?: string | null; durationSec: number },
  o: Partial<Parameters<typeof doiNguonBaiVideo>[0]> & { xacNhan?: boolean } = {},
) => {
  const { xacNhan = true, ...rest } = o;
  const nguonMoi = { youtubeId: moi.youtubeId ?? null, videoKey: moi.videoKey ?? null, durationSec: moi.durationSec };
  let xacNhanToken: string | null = rest.xacNhanToken ?? null;
  if (xacNhan && rest.xacNhanToken === undefined) {
    const xt = await xemTruocDoiNguon({ lessonId: baiId, moi: nguonMoi, actorUserId: "u-doi", coQuyenXuatBan: true, now: luc(0) });
    xacNhanToken = xt.xacNhanToken;
  }
  return doiNguonBaiVideo({
    lessonId: baiId,
    moi: nguonMoi,
    duLieu: {
      title: `${P}Bài đã đổi`,
      youtubeId: moi.youtubeId ?? null,
      videoKey: moi.videoKey ?? null,
      durationSec: moi.durationSec,
    },
    actorUserId: "u-doi",
    actorName: "Đào tạo (thử)",
    coQuyenXuatBan: true,
    lyDo: "ca thử",
    now: luc(0),
    ...rest,
    xacNhanToken,
  });
};

const bai = (id: string) => db.trnLesson.findUniqueOrThrow({ where: { id } });
const hang = (n: { enrollmentId: string }, baiId: string) =>
  db.trnLessonProgress.findUniqueOrThrow({ where: { enrollmentId_lessonId: { enrollmentId: n.enrollmentId, lessonId: baiId } } });
const luotCua = (n: { enrollmentId: string }) => db.trnEnrollment.findUniqueOrThrow({ where: { id: n.enrollmentId } });

describe.skipIf(!RUN_DB_TESTS)("[VDN] đổi nguồn bài video — chụp + bắt đầu lại + giữ lượt đã kết thúc (Postgres thật)", () => {
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

  // ── Khi nào TĂNG phiên bản ────────────────────────────────────────────────────────────────────────────────

  it("[VDN-01] chỉ đổi TIÊU ĐỀ / phụ đề (cùng nguồn, cùng thời lượng) ⇒ KHÔNG tăng phiên bản, KHÔNG chụp, KHÔNG đặt lại", async () => {
    const k = await dungKhoa({ xuatBan: true });
    const n = await luotHoc("a1", k, "IN_PROGRESS");
    await tienDo(n, k.baiA, { status: "IN_PROGRESS", coveredSec: 120 });
    const a = await bai(k.baiA);
    const truoc = await hang(n, k.baiA);
    const kq = await doi(k.baiA, { videoKey: a.videoKey, durationSec: 600 }, { coQuyenXuatBan: false, xacNhan: false });
    expect(kq.doiNguon).toBe(false);
    expect((await bai(k.baiA)).mediaRevision).toBe(1);
    expect((await bai(k.baiA)).title).toBe(`${P}Bài đã đổi`); // metadata vẫn được ghi
    expect(await hang(n, k.baiA)).toEqual(truoc);
    expect(await db.trnLessonProgressRevision.count({ where: { lessonId: k.baiA } })).toBe(0);
  }, CASE_TIMEOUT);

  it("[VDN-02] đổi THỜI LƯỢNG (cùng nguồn) ⇒ tăng phiên bản; đổi nguồn sang link YouTube ⇒ tăng phiên bản", async () => {
    const k = await dungKhoa();
    const a = await bai(k.baiA);
    const kq1 = await doi(k.baiA, { videoKey: a.videoKey, durationSec: 601 });
    expect(kq1.doiNguon).toBe(true);
    expect(kq1.revMoi).toBe(2);
    const kq2 = await doi(k.baiA, { youtubeId: "aBcDeFg_H-1", durationSec: 601 });
    expect(kq2.doiNguon).toBe(true);
    expect((await bai(k.baiA)).mediaRevision).toBe(3);
  }, CASE_TIMEOUT);

  it("[VDN-03] bài CHƯA có nguồn nào, gắn lần đầu ⇒ KHÔNG tăng phiên bản (chưa có nội dung cũ để thay)", async () => {
    const k = await dungKhoa({ nguon: "khong" });
    const kq = await doi(k.baiA, { videoKey: "elearning/master/vdn/moi.mp4", durationSec: 400 });
    expect(kq.doiNguon).toBe(false);
    expect((await bai(k.baiA)).mediaRevision).toBe(1);
  }, CASE_TIMEOUT);

  // ── Cổng: quyền và xác nhận — từ chối = KHÔNG ghi gì ──────────────────────────────────────────────────────

  it("[VDN-04] khoá NHÁP, chưa ai học, không có quyền xuất bản ⇒ ĐƯỢC đổi (người soạn thường); phiên bản tăng, không có gì để chụp", async () => {
    const k = await dungKhoa({ xuatBan: false });
    const kq = await doi(k.baiA, { videoKey: "elearning/master/vdn/moi.mp4", durationSec: 700 }, { coQuyenXuatBan: false, xacNhan: false });
    expect(kq.doiNguon).toBe(true);
    expect(kq.daChup).toBe(0);
    expect((await bai(k.baiA)).mediaRevision).toBe(2);
  }, CASE_TIMEOUT);

  it("[VDN-05] khoá ĐÃ XUẤT BẢN mà không có quyền xuất bản ⇒ TỪ CHỐI CAN_QUYEN_XUAT_BAN, không ghi gì", async () => {
    const k = await dungKhoa({ xuatBan: true });
    const truoc = await bai(k.baiA);
    const e = await doi(k.baiA, { videoKey: "elearning/master/vdn/moi.mp4", durationSec: 700 }, { coQuyenXuatBan: false }).catch((x) => x);
    expect(e).toBeInstanceOf(LoiDoiNguon);
    expect((e as LoiDoiNguon).ma).toBe("CAN_QUYEN_XUAT_BAN");
    expect(await bai(k.baiA)).toEqual(truoc);
  }, CASE_TIMEOUT);

  it("[VDN-06] đã có người học, có quyền xuất bản nhưng CHƯA xác nhận ⇒ TỪ CHỐI CAN_XAC_NHAN_TAC_DONG kèm số liệu, không ghi gì; có xác nhận thì qua", async () => {
    const k = await dungKhoa({ xuatBan: true });
    const n = await luotHoc("a6", k, "IN_PROGRESS");
    await tienDo(n, k.baiA, { status: "IN_PROGRESS", coveredSec: 60 });
    const truoc = { bai: await bai(k.baiA), hang: await hang(n, k.baiA) };
    const e = await doi(k.baiA, { videoKey: "elearning/master/vdn/moi.mp4", durationSec: 700 }, { xacNhan: false }).catch((x) => x);
    expect(e).toBeInstanceOf(LoiDoiNguon);
    expect((e as LoiDoiNguon).ma).toBe("CAN_XAC_NHAN_TAC_DONG");
    expect((e as LoiDoiNguon).message).toMatch(/1 lượt học/);
    expect(await bai(k.baiA)).toEqual(truoc.bai);
    expect(await hang(n, k.baiA)).toEqual(truoc.hang);
    expect(await db.trnLessonProgressRevision.count({ where: { lessonId: k.baiA } })).toBe(0);
    const kq = await doi(k.baiA, { videoKey: "elearning/master/vdn/moi.mp4", durationSec: 700 }, { xacNhan: true });
    expect(kq.doiNguon).toBe(true);
  }, CASE_TIMEOUT);

  // ── Kịch bản đầy đủ: khoá xuất bản, lượt đang học + lượt đã kết thúc ──────────────────────────────────────

  describe("[VDN-07] khoá ĐÃ XUẤT BẢN, ghi danh ĐANG HỌC + ĐÃ HOÀN THÀNH + BỊ THU HỒI", () => {
    let k: Khoa;
    let dangHoc: { userId: string; enrollmentId: string };
    let quaHan: { userId: string; enrollmentId: string };
    let daXongBai: { userId: string; enrollmentId: string };
    let hoanThanh: { userId: string; enrollmentId: string };
    let thuHoi: { userId: string; enrollmentId: string };
    let tacDongTruoc: Awaited<ReturnType<typeof docTacDongDoiNguon>>;
    let kq: Awaited<ReturnType<typeof doiNguonBaiVideo>>;
    let tongTruoc: { soHang: number; tongCovered: number };

    beforeAll(async () => {
      k = await dungKhoa({ xuatBan: true, coBaiB: true });
      // đang học: A xem dở, B chưa
      dangHoc = await luotHoc("a7dh", k, "IN_PROGRESS", 0);
      await tienDo(dangHoc, k.baiA, { status: "IN_PROGRESS", coveredSec: 240, seq: 17 });
      // quá hạn: A xem dở, B đã DONE ⇒ 50%
      quaHan = await luotHoc("a7qh", k, "OVERDUE", 50);
      await tienDo(quaHan, k.baiA, { status: "IN_PROGRESS", coveredSec: 100 });
      await tienDo(quaHan, k.baiB!, { status: "DONE", coveredSec: 300 });
      // đang học nhưng A đã DONE, B chưa ⇒ 50%
      daXongBai = await luotHoc("a7dx", k, "IN_PROGRESS", 50);
      await tienDo(daXongBai, k.baiA, { status: "DONE", coveredSec: 600 });
      // đã hoàn thành khoá (A, B DONE) ⇒ 100%, đóng băng
      hoanThanh = await luotHoc("a7ht", k, "COMPLETED", 100);
      await tienDo(hoanThanh, k.baiA, { status: "DONE", coveredSec: 600 });
      await tienDo(hoanThanh, k.baiB!, { status: "DONE", coveredSec: 300 });
      // bị thu hồi giữa chừng
      thuHoi = await luotHoc("a7th", k, "REVOKED", 0);
      await tienDo(thuHoi, k.baiA, { status: "IN_PROGRESS", coveredSec: 55 });
      // phiên xem + ngân sách của một lượt (không được bị đụng)
      await db.trnVideoSession.create({
        data: { lessonId: k.baiA, enrollmentId: dangHoc.enrollmentId, userId: dangHoc.userId, totalWatchSec: 247, purgeAfter: luc(86400 * 90) },
      });
      await db.trnVideoBudget.create({ data: { userId: dangHoc.userId, lessonId: k.baiA, tat: luc(-5) } });

      tacDongTruoc = await docTacDongDoiNguon(db, k.baiA, 1);
      const rows = await db.trnLessonProgress.findMany({ where: { lessonId: k.baiA }, select: { coveredSec: true } });
      tongTruoc = { soHang: rows.length, tongCovered: rows.reduce((s, r) => s + r.coveredSec, 0) };
      kq = await doi(k.baiA, { youtubeId: "aBcDeFg_H-1", durationSec: 480 });
    }, HOOK_TIMEOUT);

    it("xem trước đếm đúng: đang học / đã kết thúc / đã xong bài", () => {
      expect(tacDongTruoc).toMatchObject({ ghiDanhDangHoc: 3, ghiDanhDongBang: 2, daXongDangHoc: 1, daXongDongBang: 1 });
    });

    it("bài sang phiên bản 2 với nguồn MỚI; kết quả báo đúng số chụp / đặt lại", () => {
      expect(kq).toMatchObject({ doiNguon: true, revCu: 1, revMoi: 2, daChup: 5, daDatLai: 3 });
    });

    it("🔴 CHỤP BẤT BIẾN đủ MỌI hàng ở phiên bản cũ (kể cả lượt đóng băng): số hàng và tổng giây phủ KHỚP lúc trước", async () => {
      const dc = await doiChieuTheoBai(db, k.baiA);
      expect(dc.banChup).toEqual([
        { rev: 1, soBan: tongTruoc.soHang, tongCoveredSec: tongTruoc.tongCovered, tongTotalWatchSec: tongTruoc.tongCovered + 7 * tongTruoc.soHang, soDone: 2 },
      ]);
      const b = await db.trnLessonProgressRevision.findFirstOrThrow({ where: { enrollmentId: dangHoc.enrollmentId, lessonId: k.baiA } });
      expect(b).toMatchObject({ coveredSec: 240, status: "IN_PROGRESS", seekCount: 2, attnAskedCount: 1, supersededByUserId: "u-doi", reason: "ca thử" });
      expect(b.segmentBitmap).not.toBeNull();
    });

    it("🔴 lượt ĐANG HỌC được đặt lại ở phiên bản MỚI: 0 giây phủ, NOT_STARTED, không bitmap; `seq` KHÔNG BAO GIỜ HẠ", async () => {
      for (const n of [dangHoc, quaHan, daXongBai]) {
        const h = await hang(n, k.baiA);
        expect(h, n.userId).toMatchObject({ mediaRevision: 2, coveredSec: 0, totalWatchSec: 0, maxPositionSec: 0, status: "NOT_STARTED", seekCount: 0, attnAskedCount: 0, contentSec: 480 });
        expect(h.segmentBitmap).toBeNull();
        expect(h.completedAt).toBeNull();
        expect(h.verifiedAt).toBeNull();
        expect(h.cueLogJson).toBeNull();
      }
      expect((await hang(dangHoc, k.baiA)).seq).toBe(17);
    });

    it("🔴 DONE cũ KHÔNG thành DONE của video mới: lượt đã xong bài A nay chưa xong", async () => {
      expect((await hang(daXongBai, k.baiA)).status).toBe("NOT_STARTED");
    });

    it("🔴 lượt ĐÃ KẾT THÚC giữ nguyên: hàng tiến độ ở phiên bản 1 (đóng băng), trạng thái khoá, chứng nhận, phần trăm", async () => {
      const h = await hang(hoanThanh, k.baiA);
      expect(h).toMatchObject({ mediaRevision: 1, status: "DONE", coveredSec: 600 });
      expect(await luotCua(hoanThanh)).toMatchObject({ status: "COMPLETED", progressPercent: 100 });
      expect((await luotCua(hoanThanh)).completedAt).not.toBeNull();
      expect((await luotCua(hoanThanh)).verifiedAt).not.toBeNull();
      expect(await hang(thuHoi, k.baiA)).toMatchObject({ mediaRevision: 1, coveredSec: 55 });
      expect((await luotCua(thuHoi)).status).toBe("REVOKED");
    });

    it("`progressPercent` của lượt đã đặt lại được làm mới — và CHỈ cột đó: OVERDUE không bị lật sang IN_PROGRESS", async () => {
      expect((await luotCua(daXongBai)).progressPercent).toBe(0); // A DONE mất, B chưa ⇒ 0
      expect((await luotCua(quaHan)).progressPercent).toBe(50); // A dở (không DONE), B DONE ⇒ vẫn 50
      expect((await luotCua(quaHan)).status).toBe("OVERDUE");
      expect((await luotCua(dangHoc)).status).toBe("IN_PROGRESS");
      expect(kq.daLamMoiPhanTram).toBe(1); // chỉ lượt `daXongBai` đổi phần trăm
    });

    it("phiên xem và ngân sách thời gian KHÔNG bị đụng (số liệu thống kê và xác minh giữ nguyên)", async () => {
      expect(await db.trnVideoSession.count({ where: { lessonId: k.baiA } })).toBe(1);
      expect(await db.trnVideoBudget.count({ where: { lessonId: k.baiA } })).toBe(1);
    });

    it("ĐỐI SOÁT sau đổi: không hàng đang học nào lệch phiên bản, không hàng mất bản chụp; lượt đóng băng được đếm", async () => {
      const dc = await doiChieuTheoBai(db, k.baiA);
      expect(dc).toMatchObject({ revHienTai: 2, hangDangHocLech: 0, hangDongBangOPhienBanCu: 2, hangMatBanChup: 0 });
    });

    it("🔴 nhịp xem sau khi đổi: vé phiên bản cũ ⇒ NOI_DUNG_DA_DOI; vé mới ghi vào hàng MỚI; lượt đóng băng ⇒ KHONG_GHI", async () => {
      const nhip = async (userId: string, enrollmentId: string, rev: number) =>
        ghiNhipXem({
          actor: await resolveActorUncached(userId),
          ve: kyVeMedia({ lessonId: k.baiA, userId, rev }, undefined, luc(0).getTime()),
          enrollmentId,
          lessonId: k.baiA,
          tuSec: 0,
          denSec: 15,
          seq: 100,
          tocDo: 1,
          tabHien: true,
          viTriSec: 15,
          traLoiThachThuc: null,
          now: luc(15),
        });
      const cu = await nhip(dangHoc.userId, dangHoc.enrollmentId, 1);
      expect(cu.ok).toBe(false);
      if (!cu.ok) expect(cu.code).toBe("NOI_DUNG_DA_DOI");
      const moi = await nhip(dangHoc.userId, dangHoc.enrollmentId, 2);
      expect(moi.ok).toBe(true);
      expect(await hang(dangHoc, k.baiA)).toMatchObject({ mediaRevision: 2, coveredSec: 15 });
      const dongBang = await nhip(hoanThanh.userId, hoanThanh.enrollmentId, 2);
      expect(dongBang.ok && dongBang.data.status).toBe("KHONG_GHI");
      expect(await hang(hoanThanh, k.baiA)).toMatchObject({ mediaRevision: 1, coveredSec: 600, status: "DONE" });
    });
  });

  // ── Câu hỏi chèn theo giây ────────────────────────────────────────────────────────────────────────────────

  it("[VDN-08] CÂU HỎI CHÈN theo giây: nhật ký trả lời của lượt đang học được xoá (sẽ hỏi lại ở video mới); chính các cue giữ nguyên", async () => {
    const k = await dungKhoa({ xuatBan: true });
    await db.trnLessonCue.createMany({
      data: [
        { lessonId: k.baiA, atSec: 30, inlineJson: { type: "single" }, orderIndex: 1 },
        { lessonId: k.baiA, atSec: 90, inlineJson: { type: "single" }, orderIndex: 2 },
      ],
    });
    const n = await luotHoc("a8", k, "IN_PROGRESS");
    await tienDo(n, k.baiA, { status: "IN_PROGRESS", coveredSec: 100, cueLog: { daXong: ["x"] } });
    expect((await docTacDongDoiNguon(db, k.baiA, 1)).soCauHoiChen).toBe(2);
    await doi(k.baiA, { videoKey: "elearning/master/vdn/moi.mp4", durationSec: 600 });
    expect((await hang(n, k.baiA)).cueLogJson).toBeNull();
    expect(await db.trnLessonCue.count({ where: { lessonId: k.baiA } })).toBe(2);
    // bản chụp GIỮ nhật ký cũ
    const b = await db.trnLessonProgressRevision.findFirstOrThrow({ where: { enrollmentId: n.enrollmentId } });
    expect(b.cueLogJson).toEqual({ daXong: ["x"] });
  }, CASE_TIMEOUT);

  // ── Khoá sao chép ─────────────────────────────────────────────────────────────────────────────────────────

  it("[VDN-09] KHOÁ SAO CHÉP (bài riêng, phiên bản 1, cùng nguồn): đổi nguồn bài gốc KHÔNG đụng bài/tiến độ của bản sao", async () => {
    const goc = await dungKhoa({ xuatBan: true });
    const sao = await dungKhoa({ xuatBan: true });
    // bản sao mang nguồn y hệt gốc (đúng thứ một lần sao chép tạo ra)
    const g = await bai(goc.baiA);
    await db.trnLesson.update({ where: { id: sao.baiA }, data: { videoKey: g.videoKey, durationSec: g.durationSec } });
    const nGoc = await luotHoc("a9g", goc, "IN_PROGRESS");
    const nSao = await luotHoc("a9s", sao, "IN_PROGRESS");
    await tienDo(nGoc, goc.baiA, { status: "IN_PROGRESS", coveredSec: 90 });
    await tienDo(nSao, sao.baiA, { status: "IN_PROGRESS", coveredSec: 150 });
    const truocSao = { bai: await bai(sao.baiA), hang: await hang(nSao, sao.baiA) };
    await doi(goc.baiA, { youtubeId: "aBcDeFg_H-1", durationSec: 480 });
    expect((await bai(goc.baiA)).mediaRevision).toBe(2);
    expect(await bai(sao.baiA)).toEqual(truocSao.bai);
    expect(await hang(nSao, sao.baiA)).toEqual(truocSao.hang);
    expect(await db.trnLessonProgressRevision.count({ where: { lessonId: sao.baiA } })).toBe(0);
  }, CASE_TIMEOUT);

  // ── Tranh chấp ────────────────────────────────────────────────────────────────────────────────────────────

  it("[VDN-10] hai yêu cầu đổi sang CÙNG nguồn song song ⇒ phiên bản tăng ĐÚNG MỘT lần, bản chụp không trùng", async () => {
    const k = await dungKhoa({ xuatBan: true });
    const n = await luotHoc("a10", k, "IN_PROGRESS");
    await tienDo(n, k.baiA, { status: "IN_PROGRESS", coveredSec: 77 });
    const kq = await Promise.all([
      doi(k.baiA, { youtubeId: "aBcDeFg_H-1", durationSec: 480 }),
      doi(k.baiA, { youtubeId: "aBcDeFg_H-1", durationSec: 480 }),
    ]);
    expect(kq.filter((x) => x.doiNguon)).toHaveLength(1);
    expect((await bai(k.baiA)).mediaRevision).toBe(2);
    expect(await db.trnLessonProgressRevision.count({ where: { lessonId: k.baiA, mediaRevision: 1 } })).toBe(1);
    expect(await hang(n, k.baiA)).toMatchObject({ mediaRevision: 2, coveredSec: 0 });
  }, CASE_TIMEOUT);

  it("[VDN-11] đổi RỒI ĐỔI LẠI (hai lần liên tiếp): mỗi phiên bản có bản chụp riêng; hàng hiện hành ở phiên bản 3", async () => {
    const k = await dungKhoa({ xuatBan: true });
    const n = await luotHoc("a11", k, "IN_PROGRESS");
    await tienDo(n, k.baiA, { status: "IN_PROGRESS", coveredSec: 200 });
    await doi(k.baiA, { youtubeId: "aBcDeFg_H-1", durationSec: 480 });
    // xem thêm ở phiên bản 2 rồi đổi nữa
    await db.trnLessonProgress.update({
      where: { enrollmentId_lessonId: { enrollmentId: n.enrollmentId, lessonId: k.baiA } },
      data: { coveredSec: 35, status: "IN_PROGRESS" },
    });
    await doi(k.baiA, { youtubeId: "zYxWvUtSrQp", durationSec: 480 });
    const dc = await doiChieuTheoBai(db, k.baiA);
    expect(dc.revHienTai).toBe(3);
    expect(dc.banChup.map((b) => [b.rev, b.tongCoveredSec])).toEqual([[1, 200], [2, 35]]);
    expect(dc).toMatchObject({ hangDangHocLech: 0, hangMatBanChup: 0 });
  }, CASE_TIMEOUT);

  // ── Phục hồi (dry-run mặc định) ───────────────────────────────────────────────────────────────────────────

  describe("[VDN-12] phục hồi từ bản chụp (đổi NHẦM rồi đổi lại)", () => {
    it("dry-run KHÔNG ghi gì và báo đúng kế hoạch; apply khôi phục tiến độ lượt đang học, không đụng lượt đã kết thúc", async () => {
      const k = await dungKhoa({ xuatBan: true });
      const dh = await luotHoc("a12dh", k, "IN_PROGRESS");
      const ht = await luotHoc("a12ht", k, "COMPLETED", 100);
      await tienDo(dh, k.baiA, { status: "IN_PROGRESS", coveredSec: 180, seq: 4 });
      await tienDo(ht, k.baiA, { status: "DONE", coveredSec: 600 });
      const nguon = await bai(k.baiA);
      await doi(k.baiA, { youtubeId: "aBcDeFg_H-1", durationSec: 480 }); // đổi nhầm
      await doi(k.baiA, { videoKey: nguon.videoKey, durationSec: 600 }); // đổi lại đúng video cũ ⇒ phiên bản 3
      const truoc = await hang(dh, k.baiA);
      const dry = await khoiPhucTienDoTuBanChup({ lessonId: k.baiA, tuRev: 1, apply: false });
      expect(dry).toMatchObject({ khoiPhuc: 1, daApDung: false });
      expect(dry.boQua.luotDaKetThuc).toBe(1);
      expect(await hang(dh, k.baiA)).toEqual(truoc); // dry-run không ghi gì
      const ap = await khoiPhucTienDoTuBanChup({ lessonId: k.baiA, tuRev: 1, apply: true });
      expect(ap).toMatchObject({ khoiPhuc: 1, daApDung: true });
      const sau = await hang(dh, k.baiA);
      expect(sau).toMatchObject({ coveredSec: 180, status: "IN_PROGRESS", mediaRevision: 3 });
      expect(sau.segmentBitmap).not.toBeNull();
      expect(sau.seq).toBe(4);
      expect(await hang(ht, k.baiA)).toMatchObject({ mediaRevision: 1, coveredSec: 600, status: "DONE" });
    }, CASE_TIMEOUT);

    it("KHÔNG ghi đè tiến độ học SAU khi đặt lại; bản chụp đã dọn bitmap thì không khôi phục được", async () => {
      const k = await dungKhoa({ xuatBan: true });
      const a = await luotHoc("a12a", k, "IN_PROGRESS");
      const b = await luotHoc("a12b", k, "IN_PROGRESS");
      await tienDo(a, k.baiA, { status: "IN_PROGRESS", coveredSec: 120 });
      await tienDo(b, k.baiA, { status: "IN_PROGRESS", coveredSec: 140 });
      const nguon = await bai(k.baiA);
      await doi(k.baiA, { youtubeId: "aBcDeFg_H-1", durationSec: 480 });
      await doi(k.baiA, { videoKey: nguon.videoKey, durationSec: 600 });
      // `a` đã học thêm sau khi đặt lại
      await db.trnLessonProgress.update({
        where: { enrollmentId_lessonId: { enrollmentId: a.enrollmentId, lessonId: k.baiA } },
        data: { coveredSec: 20, status: "IN_PROGRESS" },
      });
      // bản chụp của `b` đã bị cron dọn bitmap (đường duy nhất trigger cho phép)
      await db.trnLessonProgressRevision.updateMany({
        where: { enrollmentId: b.enrollmentId, mediaRevision: 1 },
        data: { segmentBitmap: null, bitmapPurgedAt: luc(1) },
      });
      const ke = await khoiPhucTienDoTuBanChup({ lessonId: k.baiA, tuRev: 1, apply: true });
      expect(ke.khoiPhuc).toBe(0);
      expect(ke.boQua).toMatchObject({ daCoTienDoMoi: 1, banChupDaDonBitmap: 1 });
      expect((await hang(a, k.baiA)).coveredSec).toBe(20);
    }, CASE_TIMEOUT);
  });

  // ── Lấp các ô ma trận mà rà soát độc lập (28/10) chỉ ra là chưa có ca HÀNH VI ────────────────────────────────

  it("[VDN-14] 🔴 lỗi ở phép ghi CUỐI (sau khi đã chụp + đặt lại) ⇒ CẢ giao dịch rollback: 0 bản chụp, hàng tiến độ nguyên, phiên bản không tăng", async () => {
    const k = await dungKhoa({ xuatBan: true });
    const n = await luotHoc("a14", k, "IN_PROGRESS", 0);
    await tienDo(n, k.baiA, { status: "IN_PROGRESS", coveredSec: 150, seq: 21 });
    const truoc = { bai: await bai(k.baiA), hang: await hang(n, k.baiA), luot: await luotCua(n) };
    // `title: null` hợp lệ với kiểu `duLieu` ở chỗ gọi nhưng Prisma ném khi ghi bài — phép ghi thứ TƯ trong giao dịch.
    const e = await doi(k.baiA, { videoKey: "elearning/master/vdn/moi.mp4", durationSec: 700 }, {
      duLieu: { title: null as unknown as string, videoKey: "elearning/master/vdn/moi.mp4", durationSec: 700 },
    }).catch((x) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(LoiDoiNguon); // lỗi hệ thống, không phải lỗi chính sách
    expect(await bai(k.baiA)).toEqual(truoc.bai);
    expect(await hang(n, k.baiA)).toEqual(truoc.hang);
    expect(await luotCua(n)).toEqual(truoc.luot);
    expect(await db.trnLessonProgressRevision.count({ where: { lessonId: k.baiA } })).toBe(0);
  }, CASE_TIMEOUT);

  it("[VDN-15] ghi danh COMPLETED_LATE: tiến độ KHÔNG bị đặt lại, trạng thái KHÔNG đổi; lượt đang học cùng khoá thì bị đặt lại", async () => {
    const k = await dungKhoa({ xuatBan: true, coBaiB: true });
    const tre = await luotHoc("a15tre", k, "COMPLETED_LATE", 100);
    await tienDo(tre, k.baiA, { status: "DONE", coveredSec: 600 });
    await tienDo(tre, k.baiB!, { status: "DONE", coveredSec: 300 });
    const dang = await luotHoc("a15dang", k, "IN_PROGRESS", 0);
    await tienDo(dang, k.baiA, { status: "IN_PROGRESS", coveredSec: 90 });
    const truocTre = { luot: await luotCua(tre), hang: await hang(tre, k.baiA) };
    const kq = await doi(k.baiA, { youtubeId: "aBcDeFg_H-1", durationSec: 480 });
    expect(kq.doiNguon).toBe(true);
    expect(kq.daDatLai).toBe(1); // CHỈ lượt đang học
    expect(await hang(tre, k.baiA)).toEqual(truocTre.hang); // còn nguyên ở phiên bản 1, DONE
    expect((await hang(tre, k.baiA)).mediaRevision).toBe(1);
    expect(await luotCua(tre)).toEqual(truocTre.luot);
    expect((await luotCua(tre)).status).toBe("COMPLETED_LATE");
    expect((await hang(dang, k.baiA)).mediaRevision).toBe(2);
    expect((await hang(dang, k.baiA)).coveredSec).toBe(0);
  }, CASE_TIMEOUT);

  it("[VDN-16] hàng tiến độ NOT_STARTED của lượt đang học: KHÔNG tính là 'đã học' (khoá nháp, không quyền xuất bản vẫn đổi được) nhưng được đưa sang phiên bản mới cho khớp bài", async () => {
    const k = await dungKhoa({ xuatBan: false });
    const n = await luotHoc("a16", k, "NOT_STARTED", 0);
    await tienDo(n, k.baiA, { status: "NOT_STARTED", coveredSec: 0 });
    const tac = await docTacDongDoiNguon(db, k.baiA, 1);
    expect(tac).toMatchObject({ ghiDanhDangHoc: 0, ghiDanhDongBang: 0, daXongDangHoc: 0, daXongDongBang: 0 });
    const kq = await doi(k.baiA, { videoKey: "elearning/master/vdn/moi.mp4", durationSec: 700 }, { coQuyenXuatBan: false, xacNhan: false });
    expect(kq.doiNguon).toBe(true);
    const h = await hang(n, k.baiA);
    expect(h.mediaRevision).toBe(2);
    expect(h.status).toBe("NOT_STARTED");
    expect(h.coveredSec).toBe(0);
  }, CASE_TIMEOUT);

  it("[VDN-17] 'khoá đã xuất bản' là HOẶC của hai vế, mỗi vế đủ một mình: chỉ `status = PUBLISHED` (không có phiên bản) hoặc chỉ có phiên bản PUBLISHED (status còn DRAFT) ⇒ thiếu quyền xuất bản đều bị từ chối", async () => {
    // vế 1: status PUBLISHED, KHÔNG có phiên bản nào
    const k1 = await dungKhoa({ xuatBan: true });
    await db.trnCourseVersion.deleteMany({ where: { courseId: k1.courseId } });
    const e1 = await doi(k1.baiA, { videoKey: "elearning/master/vdn/moi.mp4", durationSec: 700 }, { coQuyenXuatBan: false }).catch((x) => x);
    expect(e1).toBeInstanceOf(LoiDoiNguon);
    expect((e1 as LoiDoiNguon).ma).toBe("CAN_QUYEN_XUAT_BAN");
    // vế 2: status DRAFT nhưng có phiên bản PUBLISHED
    const k2 = await dungKhoa({ xuatBan: false });
    await db.trnCourseVersion.create({ data: { courseId: k2.courseId, major: 1, minor: 0, status: "PUBLISHED", publishedAt: new Date() } });
    const e2 = await doi(k2.baiA, { videoKey: "elearning/master/vdn/moi.mp4", durationSec: 700 }, { coQuyenXuatBan: false }).catch((x) => x);
    expect(e2).toBeInstanceOf(LoiDoiNguon);
    expect((e2 as LoiDoiNguon).ma).toBe("CAN_QUYEN_XUAT_BAN");
    // đối chứng dương: cả hai vế cùng vắng (nháp, không phiên bản) + không người học ⇒ ĐƯỢC (VDN-04 đã khoá, nhắc lại để ca này tự đủ)
    const k3 = await dungKhoa({ xuatBan: false });
    const ok = await doi(k3.baiA, { videoKey: "elearning/master/vdn/moi.mp4", durationSec: 700 }, { coQuyenXuatBan: false, xacNhan: false });
    expect(ok.doiNguon).toBe(true);
  }, CASE_TIMEOUT);

  it("[VDN-18] khoá NHÁP nhưng ĐÃ CÓ NGƯỜI HỌC: thiếu quyền xuất bản ⇒ từ chối; có quyền mà chưa xác nhận ⇒ đòi xác nhận; đủ cả hai ⇒ qua (D7: 'bài đã có người học' là điều kiện độc lập với trạng thái khoá)", async () => {
    const k = await dungKhoa({ xuatBan: false });
    const n = await luotHoc("a18", k, "IN_PROGRESS", 0);
    await tienDo(n, k.baiA, { status: "IN_PROGRESS", coveredSec: 75 });
    const moi = { videoKey: "elearning/master/vdn/moi.mp4", durationSec: 700 };
    const e1 = await doi(k.baiA, moi, { coQuyenXuatBan: false, xacNhan: true }).catch((x) => x);
    expect(e1).toBeInstanceOf(LoiDoiNguon);
    expect((e1 as LoiDoiNguon).ma).toBe("CAN_QUYEN_XUAT_BAN");
    const e2 = await doi(k.baiA, moi, { coQuyenXuatBan: true, xacNhan: false }).catch((x) => x);
    expect(e2).toBeInstanceOf(LoiDoiNguon);
    expect((e2 as LoiDoiNguon).ma).toBe("CAN_XAC_NHAN_TAC_DONG");
    expect((await bai(k.baiA)).mediaRevision).toBe(1);
    expect((await hang(n, k.baiA)).coveredSec).toBe(75);
    const ok = await doi(k.baiA, moi, { coQuyenXuatBan: true, xacNhan: true });
    expect(ok.doiNguon).toBe(true);
    expect((await hang(n, k.baiA)).coveredSec).toBe(0);
  }, CASE_TIMEOUT);

  // ── HARDENING (28/10): D7 luôn xác nhận cho khoá đã xuất bản · xác nhận ràng buộc nội dung + tập người học (chống TOCTOU) ·
  //    lý do bắt buộc · audit CÙNG giao dịch ───────────────────────────────────────────────────────────────────────────────

  const MOI = { videoKey: "elearning/master/vdn/moi.mp4", durationSec: 700 };
  const MOI_B = { youtubeId: "ZzZzZzZzZz9", durationSec: 700 };
  const xemTruoc = (baiId: string, moi: { youtubeId?: string | null; videoKey?: string | null; durationSec: number }, o: { user?: string; quyen?: boolean; giay?: number } = {}) =>
    xemTruocDoiNguon({
      lessonId: baiId,
      moi: { youtubeId: moi.youtubeId ?? null, videoKey: moi.videoKey ?? null, durationSec: moi.durationSec },
      actorUserId: o.user ?? "u-doi",
      coQuyenXuatBan: o.quyen ?? true,
      now: luc(o.giay ?? 0),
    });
  const maLoi = async (f: Promise<unknown>) => ((await f.catch((x) => x)) as LoiDoiNguon).ma;
  const nguyenVen = async (k: Khoa, n?: { enrollmentId: string }) => ({
    bai: await bai(k.baiA),
    ...(n ? { hang: await hang(n, k.baiA) } : {}),
    banChup: await db.trnLessonProgressRevision.count({ where: { lessonId: k.baiA } }),
    audit: await db.auditLog.count({ where: { entityType: "TrnLesson", entityId: k.baiA } }),
  });

  it("[HDN-01] 🔴 D7: khoá ĐÃ XUẤT BẢN, có quyền xuất bản, CHƯA AI HỌC ⇒ vẫn cần xác nhận; có chuỗi từ xem trước thì qua", async () => {
    const k = await dungKhoa({ xuatBan: true });
    const truoc = await nguyenVen(k);
    expect(await maLoi(doi(k.baiA, MOI, { xacNhan: false }))).toBe("CAN_XAC_NHAN_TAC_DONG");
    expect(await nguyenVen(k)).toEqual(truoc);
    const xt = await xemTruoc(k.baiA, MOI);
    expect(xt).toMatchObject({ doiNguon: true, khoaDaXuatBan: true, yeuCauXacNhan: true });
    expect(xt.xacNhanToken).toEqual(expect.any(String));
    expect(xt.thongBao).toContain("chưa có ai xem");
    const kq = await doi(k.baiA, MOI, { xacNhanToken: xt.xacNhanToken });
    expect(kq.doiNguon).toBe(true);
    expect((await bai(k.baiA)).mediaRevision).toBe(2);
  }, CASE_TIMEOUT);

  it("[HDN-02] 🔴 TOCTOU: có NGƯỜI MỚI bắt đầu học sau khi xem trước ⇒ chuỗi cũ bị từ chối TAC_DONG_DA_DOI, KHÔNG ghi gì; xem trước lại + xác nhận lại thì qua", async () => {
    const k = await dungKhoa({ xuatBan: true });
    const a = await luotHoc("h2a", k, "IN_PROGRESS");
    await tienDo(a, k.baiA, { status: "IN_PROGRESS", coveredSec: 60 });
    const xt = await xemTruoc(k.baiA, MOI);
    const truoc = await nguyenVen(k, a);
    // người mới vào học SAU lúc xem trước
    const b = await luotHoc("h2b", k, "IN_PROGRESS");
    await tienDo(b, k.baiA, { status: "IN_PROGRESS", coveredSec: 30 });
    const e = await doi(k.baiA, MOI, { xacNhanToken: xt.xacNhanToken }).catch((x) => x);
    expect(e).toBeInstanceOf(LoiDoiNguon);
    expect((e as LoiDoiNguon).ma).toBe("TAC_DONG_DA_DOI");
    expect((e as LoiDoiNguon).message).toContain("xác nhận lại");
    expect(await nguyenVen(k, a)).toEqual(truoc);
    expect((await hang(b, k.baiA)).coveredSec).toBe(30); // người mới CHƯA bị đặt lại — họ chưa từng được hỏi
    const xt2 = await xemTruoc(k.baiA, MOI);
    expect(xt2.tacDong.ghiDanhDangHoc).toBe(2);
    expect(xt2.xacNhanToken).not.toBe(xt.xacNhanToken);
    const kq = await doi(k.baiA, MOI, { xacNhanToken: xt2.xacNhanToken });
    expect(kq).toMatchObject({ doiNguon: true, daDatLai: 2 });
  }, CASE_TIMEOUT);

  it("[HDN-03] 🔴 TOCTOU: người học XONG BÀI sau khi xem trước (IN_PROGRESS → DONE) ⇒ TAC_DONG_DA_DOI; người học chuyển lớp (hoàn thành khoá) cũng vậy", async () => {
    const k = await dungKhoa({ xuatBan: true, coBaiB: true });
    const a = await luotHoc("h3a", k, "IN_PROGRESS");
    await tienDo(a, k.baiA, { status: "IN_PROGRESS", coveredSec: 500 });
    const xt = await xemTruoc(k.baiA, MOI);
    await db.trnLessonProgress.update({
      where: { enrollmentId_lessonId: { enrollmentId: a.enrollmentId, lessonId: k.baiA } },
      data: { status: "DONE", coveredSec: 600 },
    });
    expect(await maLoi(doi(k.baiA, MOI, { xacNhanToken: xt.xacNhanToken }))).toBe("TAC_DONG_DA_DOI");
    const xt2 = await xemTruoc(k.baiA, MOI);
    expect(xt2.tacDong).toMatchObject({ daXongDangHoc: 1 });
    // hoàn thành khoá sau lần xem trước thứ hai
    await db.trnEnrollment.update({ where: { id: a.enrollmentId }, data: { status: "COMPLETED", completedAt: luc(-1) } });
    expect(await maLoi(doi(k.baiA, MOI, { xacNhanToken: xt2.xacNhanToken }))).toBe("TAC_DONG_DA_DOI");
  }, CASE_TIMEOUT);

  it("[HDN-04] ĐỐI CHỨNG: tiến độ đổi vài giây (nhịp xem bình thường) KHÔNG làm chuỗi hỏng — ta hỏi 'AI bị ảnh hưởng', không hỏi 'bao nhiêu giây'", async () => {
    const k = await dungKhoa({ xuatBan: true });
    const a = await luotHoc("h4a", k, "IN_PROGRESS");
    await tienDo(a, k.baiA, { status: "IN_PROGRESS", coveredSec: 60 });
    const xt = await xemTruoc(k.baiA, MOI);
    await db.trnLessonProgress.update({
      where: { enrollmentId_lessonId: { enrollmentId: a.enrollmentId, lessonId: k.baiA } },
      data: { coveredSec: 75, totalWatchSec: 90, maxPositionSec: 75, seq: 40 },
    });
    const kq = await doi(k.baiA, MOI, { xacNhanToken: xt.xacNhanToken });
    expect(kq.doiNguon).toBe(true);
  }, CASE_TIMEOUT);

  it("[HDN-05] 🔴 chuỗi GẮN với nội dung: xem trước nguồn A rồi lưu nguồn B · người khác dùng chuỗi · bài đã đổi phiên bản · hết hạn · bị sửa ⇒ đều CAN_XAC_NHAN_TAC_DONG, không ghi gì", async () => {
    const k = await dungKhoa({ xuatBan: true });
    const xt = await xemTruoc(k.baiA, MOI);
    const truoc = await nguyenVen(k);
    // nguồn khác
    expect(await maLoi(doi(k.baiA, MOI_B, { xacNhanToken: xt.xacNhanToken }))).toBe("CAN_XAC_NHAN_TAC_DONG");
    // thời lượng khác
    expect(await maLoi(doi(k.baiA, { ...MOI, durationSec: 701 }, { xacNhanToken: xt.xacNhanToken }))).toBe("CAN_XAC_NHAN_TAC_DONG");
    // người khác
    expect(await maLoi(doi(k.baiA, MOI, { xacNhanToken: xt.xacNhanToken, actorUserId: "u-ke-khac" }))).toBe("CAN_XAC_NHAN_TAC_DONG");
    // hết hạn (15 phút)
    expect(await maLoi(doi(k.baiA, MOI, { xacNhanToken: xt.xacNhanToken, now: luc(16 * 60) }))).toBe("CAN_XAC_NHAN_TAC_DONG");
    // bị sửa
    const gia = xt.xacNhanToken!.slice(0, -2) + (xt.xacNhanToken!.endsWith("AA") ? "BB" : "AA");
    expect(await maLoi(doi(k.baiA, MOI, { xacNhanToken: gia }))).toBe("CAN_XAC_NHAN_TAC_DONG");
    // chuỗi rỗng
    expect(await maLoi(doi(k.baiA, MOI, { xacNhanToken: "" }))).toBe("CAN_XAC_NHAN_TAC_DONG");
    expect(await nguyenVen(k)).toEqual(truoc);
    // phiên bản đã đổi (ai đó đổi nguồn trước) ⇒ chuỗi xem trước ở rev 1 vô hiệu
    const xtB = await xemTruoc(k.baiA, MOI_B);
    await doi(k.baiA, MOI_B, { xacNhanToken: xtB.xacNhanToken });
    expect(await maLoi(doi(k.baiA, MOI, { xacNhanToken: xt.xacNhanToken }))).toBe("CAN_XAC_NHAN_TAC_DONG");
    // đối chứng dương: chuỗi mới cho phiên bản mới
    const xtMoi = await xemTruoc(k.baiA, MOI);
    expect((await doi(k.baiA, MOI, { xacNhanToken: xtMoi.xacNhanToken })).doiNguon).toBe(true);
  }, CASE_TIMEOUT);

  it("[HDN-06] 🔴 chuỗi KHÔNG thay được quyền: có chuỗi hợp lệ mà thiếu quyền xuất bản ⇒ CAN_QUYEN_XUAT_BAN; xem trước thiếu quyền không phát chuỗi", async () => {
    const k = await dungKhoa({ xuatBan: true });
    const xtCoQuyen = await xemTruoc(k.baiA, MOI);
    expect(await maLoi(doi(k.baiA, MOI, { xacNhanToken: xtCoQuyen.xacNhanToken, coQuyenXuatBan: false }))).toBe("CAN_QUYEN_XUAT_BAN");
    const xtThieu = await xemTruoc(k.baiA, MOI, { quyen: false });
    expect(xtThieu).toMatchObject({ yeuCauXacNhan: true, yeuCauQuyenXuatBan: true, coQuyenXuatBan: false, xacNhanToken: null, hetHanLuc: null });
    // 🔴 người thiếu quyền KHÔNG nhận số liệu người học (đường lưu giấu số đó; xem trước không được làm hỏng điều ấy)
    expect(xtThieu.tacDong).toEqual({ ghiDanhDangHoc: 0, ghiDanhDongBang: 0, daXongDangHoc: 0, daXongDongBang: 0, soCauHoiChen: 0 });
    expect(xtThieu.thongBao).toBeNull();
    expect((await bai(k.baiA)).mediaRevision).toBe(1);
  }, CASE_TIMEOUT);

  it("[HDN-07] xem trước CHỈ ĐỌC: không đổi bài, tiến độ, bản chụp, audit; bài chưa có nguồn / metadata thì báo không đổi và không phát chuỗi", async () => {
    const k = await dungKhoa({ xuatBan: true });
    const a = await luotHoc("h7a", k, "IN_PROGRESS");
    await tienDo(a, k.baiA, { status: "IN_PROGRESS", coveredSec: 60 });
    const truoc = await nguyenVen(k, a);
    await xemTruoc(k.baiA, MOI);
    await xemTruoc(k.baiA, MOI_B);
    expect(await nguyenVen(k, a)).toEqual(truoc);
    const cu = await bai(k.baiA);
    const khongDoi = await xemTruoc(k.baiA, { videoKey: cu.videoKey, durationSec: 600 });
    expect(khongDoi).toMatchObject({ doiNguon: false, yeuCauXacNhan: false, xacNhanToken: null, thongBao: null });
    const trong = await dungKhoa({ nguon: "khong" });
    expect(await xemTruoc(trong.baiA, MOI)).toMatchObject({ doiNguon: false, xacNhanToken: null });
  }, CASE_TIMEOUT);

  it("[HDN-08] 🔴 LÝ DO bắt buộc khi nội dung thật sự đổi: thiếu / rỗng / dưới 5 / trên 500 ký tự ⇒ CAN_LY_DO, không ghi gì; đúng 5 và đúng 500 thì qua; gắn nguồn lần đầu và metadata KHÔNG cần lý do", async () => {
    const k = await dungKhoa({ xuatBan: false });
    const truoc = await nguyenVen(k);
    for (const lyDo of [null, "", "    ", "abcd", "x".repeat(501)]) {
      expect(await maLoi(doi(k.baiA, MOI, { lyDo, coQuyenXuatBan: true, xacNhan: false })), String(lyDo).slice(0, 8)).toBe("CAN_LY_DO");
    }
    expect(await nguyenVen(k)).toEqual(truoc);
    expect((await doi(k.baiA, MOI, { lyDo: "abcde" })).doiNguon).toBe(true);
    const k2 = await dungKhoa({ xuatBan: false });
    expect((await doi(k2.baiA, MOI, { lyDo: "x".repeat(500) })).doiNguon).toBe(true);
    // gắn lần đầu: không có nội dung cũ để thay ⇒ không cần lý do
    const trong = await dungKhoa({ nguon: "khong" });
    expect((await doi(trong.baiA, MOI, { lyDo: null })).doiNguon).toBe(false);
    // chỉ đổi tiêu đề (cùng nguồn) ⇒ không cần lý do
    const k3 = await dungKhoa({ xuatBan: true });
    const goc = await bai(k3.baiA);
    expect((await doi(k3.baiA, { videoKey: goc.videoKey, durationSec: 600 }, { lyDo: null, xacNhan: false })).doiNguon).toBe(false);
  }, CASE_TIMEOUT);

  it("[HDN-09] 🔴 AUDIT CÙNG GIAO DỊCH: đổi nguồn ghi ĐÚNG MỘT dòng audit đủ actor · lý do · phạm vi cơ sở · phiên bản cũ→mới · số lượt, và KHÔNG chứa mã YouTube / khoá tệp / chuỗi xác nhận", async () => {
    const k = await dungKhoa({ xuatBan: true });
    await db.trnCourse.update({ where: { id: k.courseId }, data: { orgUnitId: C.orgUnitId, centerId: C.centerId } });
    const a = await luotHoc("h9a", k, "IN_PROGRESS");
    await tienDo(a, k.baiA, { status: "IN_PROGRESS", coveredSec: 60 });
    const cu = await bai(k.baiA);
    const xt = await xemTruoc(k.baiA, MOI_B);
    const kq = await doi(k.baiA, MOI_B, { xacNhanToken: xt.xacNhanToken, lyDo: "  thay bằng bản đã kiểm duyệt  " });
    expect(kq.daGhiAudit).toBe(true);
    const dong = await db.auditLog.findMany({ where: { entityType: "TrnLesson", entityId: k.baiA } });
    expect(dong).toHaveLength(1);
    const d = dong[0]!;
    expect(d).toMatchObject({ action: "UPDATE", actorName: "Đào tạo (thử)", reason: "thay bằng bản đã kiểm duyệt", orgUnitId: C.orgUnitId });
    expect(d.actorId).toBe("u-doi");
    expect(d.newValues).toMatchObject({ mediaRevision: 2, nguon: "YOUTUBE", doiNguon: true, khoaDaXuatBan: true, daXacNhanTacDong: true, ghiDanhDangHoc: 1, daChup: 1, daDatLai: 1 });
    expect(d.oldValues).toMatchObject({ mediaRevision: 1, nguon: "TEP" });
    const sach = JSON.stringify(d);
    expect(sach).not.toContain(MOI_B.youtubeId);
    expect(sach).not.toContain(cu.videoKey!);
    expect(sach).not.toContain(xt.xacNhanToken!);
    expect(sach).not.toMatch(/elearning\/master/);
  }, CASE_TIMEOUT);

  it("[HDN-10] đổi nguồn BỊ TỪ CHỐI (thiếu quyền / thiếu lý do / thiếu xác nhận / tập đã đổi) KHÔNG để lại dòng audit nào (không có gì xảy ra)", async () => {
    const k = await dungKhoa({ xuatBan: true });
    const dem0 = await db.auditLog.count({ where: { entityType: "TrnLesson", entityId: k.baiA } });
    await maLoi(doi(k.baiA, MOI, { xacNhan: false }));
    await maLoi(doi(k.baiA, MOI, { coQuyenXuatBan: false }));
    await maLoi(doi(k.baiA, MOI, { lyDo: null }));
    expect(await db.auditLog.count({ where: { entityType: "TrnLesson", entityId: k.baiA } })).toBe(dem0);
  }, CASE_TIMEOUT);

  it("[HDN-11] 🔴 xem trước KHÔNG lộ số lượt học cho người thiếu quyền xuất bản — cả khoá đã xuất bản lẫn khoá nháp đã có người học; người CÓ quyền thì thấy", async () => {
    const k = await dungKhoa({ xuatBan: false });
    const a = await luotHoc("h11a", k, "IN_PROGRESS");
    await tienDo(a, k.baiA, { status: "IN_PROGRESS", coveredSec: 60 });
    const thieu = await xemTruoc(k.baiA, MOI, { quyen: false });
    expect(thieu).toMatchObject({ yeuCauQuyenXuatBan: true, coQuyenXuatBan: false, xacNhanToken: null, thongBao: null });
    expect(thieu.tacDong.ghiDanhDangHoc).toBe(0);
    const co = await xemTruoc(k.baiA, MOI);
    expect(co.tacDong.ghiDanhDangHoc).toBe(1);
    expect(co.thongBao).toContain("1 lượt");
    // khoá nháp CHƯA ai học + thiếu quyền ⇒ không đòi quyền, không có gì để giấu
    const nhap = await dungKhoa({ xuatBan: false });
    expect(await xemTruoc(nhap.baiA, MOI, { quyen: false })).toMatchObject({ yeuCauQuyenXuatBan: false, yeuCauXacNhan: false });
  }, CASE_TIMEOUT);

  it("[HDN-12] 🔴 LÝ DO không chứa link/đường dẫn video: dán mã YouTube / khoá tệp vào lý do ⇒ CAN_LY_DO, không ghi gì (lý do vào sổ audit + bản chụp BẤT BIẾN)", async () => {
    const k = await dungKhoa({ xuatBan: false });
    const truoc = await nguyenVen(k);
    for (const lyDo of ["đổi sang https://youtu.be/AbCdEfGhIjK vì bản cũ lỗi", "tệp elearning/master/vdn/moi.mp4 mới", "xem youtube.com/watch?v=AbCdEfGhIjK"]) {
      expect(await maLoi(doi(k.baiA, MOI, { lyDo, xacNhan: false })), lyDo).toBe("CAN_LY_DO");
    }
    expect(await nguyenVen(k)).toEqual(truoc);
    expect((await doi(k.baiA, MOI, { lyDo: "Bản cũ sai tiếng, thay bằng bản đã lồng lại" })).doiNguon).toBe(true);
  }, CASE_TIMEOUT);

  it("[HDN-13] 🔴 PHẠM VI CƠ SỞ của audit: khoá nhập bằng SQL thô chỉ có `centerId` (orgUnitId NULL) vẫn ghi audit có phạm vi (quy về OrgUnit của cơ sở đó), không rơi về NULL", async () => {
    const k = await dungKhoa({ xuatBan: true });
    await db.trnCourse.update({ where: { id: k.courseId }, data: { orgUnitId: null, centerId: C.centerId } });
    const xt = await xemTruoc(k.baiA, MOI_B);
    await doi(k.baiA, MOI_B, { xacNhanToken: xt.xacNhanToken });
    const d = await db.auditLog.findFirstOrThrow({ where: { entityType: "TrnLesson", entityId: k.baiA } });
    expect(d.orgUnitId).toBe(C.orgUnitId);
  }, CASE_TIMEOUT);

  it("[VDN-13] SQL của lượt đang học / đã kết thúc khớp hằng số của luật thuần (một nguồn sự thật)", async () => {
    const { LUOT_DAT_LAI, LUOT_DONG_BANG } = await import("../../lib/elearning/video-doi-nguon-rule");
    const fs = await import("node:fs");
    const src = fs.readFileSync("lib/elearning/video-doi-nguon.ts", "utf8");
    const dat = `(${LUOT_DAT_LAI.map((x) => `'${x}'`).join(",")})`;
    const dong = `(${LUOT_DONG_BANG.map((x) => `'${x}'`).join(",")})`;
    expect(src.split(dat).length - 1).toBeGreaterThanOrEqual(5);
    expect(src.split(dong).length - 1).toBeGreaterThanOrEqual(3);
    // không có bộ trạng thái nào khác lọt vào SQL
    const bo = src.match(/IN \('[A-Z_]+'(?:,'[A-Z_]+')*\)/g) ?? [];
    for (const b of bo) expect([dat, dong], b).toContain(b.replace("IN ", ""));
  }, CASE_TIMEOUT);
});
