// @vitest-environment node
/**
 * NHỊP XEM VIDEO — ghi tiến độ trên Postgres THẬT (không mock `db`).
 *
 * Bối cảnh (27–28/10/2026): nghiệm thu bài VIDEO (MP4 + YouTube). Rà đường `ghiNhipXem` cho thấy server kiểm vé,
 * tua tới, trần mỗi nhịp, trần tốc độ — nhưng KHÔNG đối chiếu số giây khai với thời gian thật trôi qua, giữ hai
 * request song song không tiêu chung một phần ngân sách, và `seq` ở trình phát đếm lại từ 0 mỗi lần tải trang
 * trong khi server bỏ nhịp có `seq <= seq đã lưu`. Thiết kế: docs/elearning/video/THIET-KE-xac-thuc-thoi-gian-xem-
 * va-phien-ban-noi-dung.md (mục A5). Bộ này là CỔNG CHẤP NHẬN của bản sửa:
 *   · ca DƯƠNG [VNX-P*]: hành vi ĐÚNG phải giữ (không hồi quy MP4/YouTube, người xem trung thực không bị cắt);
 *   · ca ÂM [VNX-N*]: gian lận/nhầm lẫn mà bản sửa phải chặn. Ba ca N1/N2/N3 từng là `it.fails` (ghim ở #1029);
 *     nay là ca THƯỜNG — xem chú thích từng ca về điều gì ĐÃ ĐỔI trong khẳng định và vì sao;
 *   · ca [VNX-G*]: video NGẮN không hoàn thành được sớm hơn thời gian thật — dung sai không đủ mua cả bài;
 *   · ca [VNX-S*]: video NGẮN / DÀI, nguồn MP4 và YouTube (nhịp xem không biết nguồn — ca chứng minh điều đó);
 *   · ca [VNX-PH*]: phiên xem (thống kê, cửa sổ 5 phút) KHÔNG đổi định nghĩa.
 * Thời gian đi qua tham số `now` của `ghiNhipXem` nên mô phỏng được "cùng một giây" / "nghỉ 4 phút" mà không ngủ thật.
 *
 * ── Mô hình thời gian ───────────────────────────────────────────────────────────────────────────────────────
 * Ngân sách thời gian thật NEO VÀO LÚC PHÁT VÉ (`video-time-budget.ts`), nên bộ này mô phỏng đúng trang học: một
 * TAB mở trang tại `moTrang(…, tMo)` (vé ký tại đó), mọi nhịp của tab dùng vé ấy. Tải lại trang = tab MỚI = vé MỚI.
 * Ca nào gọi `nhip()` trực tiếp thì vé mặc định được ký tại `T0` (người học mở trang đúng lúc bắt đầu).
 *
 * `Tab` mô phỏng đúng các hàm thuần mà trang học + trình phát dùng (`seqKhoiDau`, `seqSauPhanHoi`): bộ đếm khởi tạo
 * từ `seq` đã lưu, đồng bộ lại sau mỗi phản hồi, KHÔNG nhích mốc khi nhịp bị server bỏ (`BO_QUA`), và đặt mốc nhịp
 * sau tại `meta.denNhan` khi server giữ lại một phần.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`, không TRUNCATE (CI chạy các bộ DB tuần tự trên CÙNG một database). Dọn theo
 * tiền tố `CI_VNX_` ở beforeAll VÀ afterAll. Người dùng giữ lại (`seedUser` upsert theo email).
 * Mỗi ca dùng MỘT người học riêng (luật 18: chạy một mình vẫn xanh, không mượn trạng thái ca trước).
 *
 * Chạy: `pnpm test:elearning-db`. Không có DB ⇒ SKIP, không phải xanh.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/security/signing-key", () => ({
  getSigningSecret: () => "secret-test-vnx-khong-dung-that-0123456789",
}));

import { db } from "../../lib/db";
import { resolveActorUncached } from "../../lib/auth/actor";
import { ghiNhipXem } from "../../lib/elearning/video-heartbeat";
import { kyVeMedia, VE_TTL_GIAY } from "../../lib/elearning/media-ticket";
import { currentPolicyVersion, ELEARNING_POLICY_KEY } from "../../lib/elearning/policy-acceptance";
import { seqKhoiDau, seqSauPhanHoi } from "../../lib/elearning/video-seq";
import { CUA_SO_GIAY, dungSaiNoiDung } from "../../lib/elearning/video-time-budget";
import { TRAN_DELTA_GIAY } from "../../lib/elearning/segment-bitmap";
import { TOC_DO_TOI_DA } from "../../lib/elearning/video-heartbeat-contract";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedRoles, seedUser } from "../e2e/_helpers/seed";

const HOOK_TIMEOUT = 180_000;
const CASE_TIMEOUT = 90_000;
const CASE_DAI = 240_000;
const P = "CI_VNX_";
const HAU_TO = "@vnx.test";

const T0 = new Date("2026-10-27T10:00:00.000Z");
/** Thời điểm máy chủ nhận nhịp, tính bằng giây kể từ T0. */
const luc = (giay: number) => new Date(T0.getTime() + giay * 1000);

type Nguoi = { id: string; enrollmentId: string };
type Bai = { id: string; durationSec: number };
let C: {
  courseId: string;
  centerId: string;
  orgUnitId: string;
  /** Bài video 600 giây — bài dùng chung của hầu hết ca. */
  bai: Bai;
  /** Bài ngắn 19 giây: nguồn YouTube / nguồn MP4 (không chia hết cho 5). */
  b19y: Bai;
  b19m: Bai;
  /** 35 giây YouTube. */
  b35y: Bai;
  /** Bài DÀI 903 giây MP4 (không chia hết cho 5) — xem trọn ở 1.5x = 41 nhịp. */
  bDai: Bai;
};

async function cleanup() {
  const users = await db.user.findMany({ where: { email: { endsWith: HAU_TO } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.trnVideoBudget.deleteMany({ where: { userId: { in: ids } } });
  await db.trnVideoSession.deleteMany({ where: { userId: { in: ids } } });
  await db.trnLessonProgress.deleteMany({ where: { userId: { in: ids } } });
  await db.trnEnrollment.deleteMany({ where: { userId: { in: ids } } });
  await db.trnAssignment.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnLesson.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnModule.deleteMany({ where: { title: { startsWith: P } } });
  await db.trnCourseVersion.deleteMany({ where: { course: { code: { startsWith: P } } } });
  await db.trnCourse.deleteMany({ where: { code: { startsWith: P } } });
}

/**
 * @param tocDoToiDa  Có ⇒ lượt học thuộc một lượt giao khoá tốc độ ở mức đó (mặc định: không có lượt giao ⇒ 1.5x).
 */
async function taoNguoi(ten: string, tocDoToiDa?: number): Promise<Nguoi> {
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
  let assignmentId: string | undefined;
  if (tocDoToiDa !== undefined) {
    const a = await db.trnAssignment.create({
      data: {
        contentType: "COURSE",
        contentId: C.courseId,
        title: `${P}giao-${ten}`,
        completionRuleJson: {},
        notifyChannels: [],
        reminderSchedule: [],
        maxPlaybackRate: tocDoToiDa,
        centerId: C.centerId,
        orgUnitId: C.orgUnitId,
      },
      select: { id: true },
    });
    assignmentId = a.id;
  }
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
      ...(assignmentId ? { assignmentId } : {}),
    },
    select: { id: true },
  });
  return { id: u.id, enrollmentId: en.id };
}

/** Một lượt học THỨ HAI (chu kỳ 2) của cùng người + cùng khoá ⇒ cùng bài, tiến độ riêng, và CÙNG ngân sách. */
async function themLuotHoc(n: Nguoi): Promise<Nguoi> {
  const en = await db.trnEnrollment.create({
    data: {
      courseId: C.courseId,
      userId: n.id,
      cycle: 2,
      status: "NOT_STARTED",
      source: "SELF_ENROLL",
      centerId: C.centerId,
      orgUnitId: C.orgUnitId,
      snapJobTitle: "Nhân viên",
    },
    select: { id: true },
  });
  return { id: n.id, enrollmentId: en.id };
}

type Nhip = {
  tu: number;
  den: number;
  seq: number;
  luc: number;
  tocDo?: number;
  /** Vé phát; mặc định ký tại `mo` (giây kể từ T0, mặc định 0 = người học mở trang đúng lúc bắt đầu). */
  ve?: string;
  mo?: number;
  bai?: Bai;
  /** Trả lời thách thức đang treo (câu hỏi tập trung). */
  traLoi?: { id: string };
};

const veMo = (n: Nguoi, bai: Bai, tMo: number) =>
  kyVeMedia({ lessonId: bai.id, userId: n.id }, undefined, luc(tMo).getTime());

/** Gửi một nhịp như route `video-heartbeat` làm: vé ký lúc mở trang, `now` là đồng hồ máy chủ giả lập. */
async function nhip(n: Nguoi, o: Nhip) {
  const bai = o.bai ?? C.bai;
  const actor = await resolveActorUncached(n.id);
  return ghiNhipXem({
    actor,
    ve: o.ve ?? veMo(n, bai, o.mo ?? 0),
    enrollmentId: n.enrollmentId,
    lessonId: bai.id,
    tuSec: o.tu,
    denSec: o.den,
    seq: o.seq,
    tocDo: o.tocDo ?? 1,
    tabHien: true,
    viTriSec: o.den,
    traLoiThachThuc: o.traLoi ?? null,
    now: luc(o.luc),
  });
}

const tienDo = (n: Nguoi, bai: Bai = C.bai) =>
  db.trnLessonProgress.findUnique({
    where: { enrollmentId_lessonId: { enrollmentId: n.enrollmentId, lessonId: bai.id } },
    select: {
      coveredSec: true,
      totalWatchSec: true,
      maxPositionSec: true,
      seq: true,
      blockedSeekCount: true,
      status: true,
      contentSec: true,
    },
  });

const phienCua = (n: Nguoi, bai: Bai = C.bai) =>
  db.trnVideoSession.findMany({
    where: { userId: n.id, lessonId: bai.id },
    orderBy: { startedAt: "asc" },
    select: { startedAt: true, lastBeatAt: true, totalWatchSec: true },
  });

const nganSachCua = (n: Nguoi, bai: Bai = C.bai) =>
  db.trnVideoBudget.findMany({ where: { userId: n.id, lessonId: bai.id }, select: { tat: true, updatedAt: true } });

/** `tat` tính bằng giây kể từ T0. */
const tatGiay = (d: Date) => (d.getTime() - T0.getTime()) / 1000;

/**
 * Một TAB của trình phát — dùng đúng các hàm thuần mà trang học và trình phát dùng.
 *
 * `moTrang` = trang học đọc `seq` + `maxPositionSec` từ DB, ký vé tại `tMo`, rồi truyền xuống (đúng `page.tsx`); trình
 * phát đi tiếp từ đó. `gui` = `guiNhip`: tăng bộ đếm, gửi, đồng bộ lại bộ đếm với `meta.seq`, và CHỈ nhích mốc khi
 * server NHẬN — tới `meta.denNhan` nếu server giữ lại một phần.
 */
class Tab {
  seq: number;
  batDau: number;
  constructor(
    private n: Nguoi,
    private bai: Bai,
    seqBanDau: number | null | undefined,
    batDauBanDau: number,
    private ve: string,
  ) {
    this.seq = seqKhoiDau(seqBanDau);
    this.batDau = batDauBanDau;
  }
  static async moTrang(n: Nguoi, bai: Bai = C.bai, tMo = 0) {
    const t = await tienDo(n, bai);
    return new Tab(n, bai, t?.seq, t?.maxPositionSec ?? 0, veMo(n, bai, tMo));
  }
  async gui(den: number, thoiDiem: number, o: Partial<Nhip> = {}) {
    this.seq += 1;
    const tu = this.batDau;
    const r = await nhip(this.n, { tu, den, seq: this.seq, luc: thoiDiem, bai: this.bai, ve: this.ve, ...o });
    if (r.ok) {
      this.seq = seqSauPhanHoi(this.seq, r.data.meta.seq);
      if (r.data.status !== "BO_QUA" && !r.data.thachThuc) {
        const nhan = r.data.meta.denNhan;
        this.batDau = typeof nhan === "number" && nhan < den ? Math.max(tu, nhan) : den;
      }
    }
    return r;
  }
}

/**
 * Gửi một nhịp; nếu server bung câu hỏi TẬP TRUNG thì trả lời NGAY như người học thật (nếu không, mọi nhịp sau bị
 * `PAUSED_ATTENTION`). Câu hỏi bung sau mỗi 240 giây phủ, nên mọi ca xem trên 4 phút phải đi qua đây.
 */
async function guiVaTraLoi(tab: Tab, den: number, thoiDiem: number, o: Partial<Nhip> = {}) {
  const r = await tab.gui(den, thoiDiem, o);
  if (r.ok && r.data.thachThuc) {
    const tl = await tab.gui(den, thoiDiem + 1, { traLoi: { id: r.data.thachThuc.id } });
    expect(tl.ok).toBe(true);
  }
  return r;
}

describe.skipIf(!RUN_DB_TESTS)("[VNX] nhịp xem video — Postgres thật", () => {
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
    const mod = await db.trnModule.create({ data: { courseId: khoa.id, title: `${P}Mô-đun`, orderIndex: 1 }, select: { id: true } });
    const baiMoi = async (ten: string, thuTu: number, durationSec: number, nguon: { videoKey?: string; youtubeId?: string }): Promise<Bai> => {
      const b = await db.trnLesson.create({
        data: { moduleId: mod.id, title: `${P}${ten}`, orderIndex: thuTu, kind: "VIDEO", durationSec, ...nguon },
        select: { id: true },
      });
      return { id: b.id, durationSec };
    };
    C = {
      courseId: khoa.id,
      centerId: cs1.centerId as string,
      orgUnitId: cs1.id,
      bai: await baiMoi("Bài video 600", 1, 600, { videoKey: "elearning/master/vnx/600.mp4" }),
      b19y: await baiMoi("Bài 19 YouTube", 2, 19, { youtubeId: "dQw4w9WgXcQ" }),
      b19m: await baiMoi("Bài 19 MP4", 3, 19, { videoKey: "elearning/master/vnx/19.mp4" }),
      b35y: await baiMoi("Bài 35 YouTube", 4, 35, { youtubeId: "9bZkp7q19f0" }),
      bDai: await baiMoi("Bài dài 903", 5, 903, { videoKey: "elearning/master/vnx/903.mp4" }),
    };
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } catch {
      /* dọn lại ở lượt sau nhờ tiền tố */
    }
  }, HOOK_TIMEOUT);

  // ══ DƯƠNG: hành vi đúng đang chạy — phải giữ nguyên ═══════════════════════════════════════════════════════

  it("[VNX-P1] xem đều tay, đúng nhịp 15 giây một lần ⇒ cộng đủ phần đã xem", async () => {
    const n = await taoNguoi("p1");
    const r1 = await nhip(n, { tu: 0, den: 15, seq: 1, luc: 15 });
    const r2 = await nhip(n, { tu: 15, den: 30, seq: 2, luc: 30 });
    expect(r1.ok && r2.ok).toBe(true);
    expect(await tienDo(n)).toMatchObject({ coveredSec: 30, totalWatchSec: 30, maxPositionSec: 30, seq: 2 });
  }, CASE_TIMEOUT);

  it("[VNX-P2] xem LẠI đoạn đã xem không tạo thêm phần trăm chưa xem, và không đẩy mốc ngân sách", async () => {
    const n = await taoNguoi("p2");
    await nhip(n, { tu: 0, den: 15, seq: 1, luc: 15 });
    await nhip(n, { tu: 15, den: 30, seq: 2, luc: 30 });
    const truoc = await tienDo(n);
    const tatTruoc = (await nganSachCua(n))[0]!.tat;
    const r = await nhip(n, { tu: 0, den: 30, seq: 3, luc: 60 }); // tua lùi xem lại, mất 30 giây thật
    expect(r.ok).toBe(true);
    const sau = await tienDo(n);
    expect(sau?.coveredSec).toBe(truoc?.coveredSec);
    expect(sau?.totalWatchSec).toBe(truoc?.totalWatchSec);
    // Nhịp không ghi gì thì KHÔNG đụng mốc: ghi lại sẽ đẩy mốc theo nhịp này mà không có lý do.
    expect((await nganSachCua(n))[0]!.tat.getTime()).toBe(tatTruoc.getTime());
  }, CASE_TIMEOUT);

  it("[VNX-P3] tua TỚI vùng chưa xem bị chặn: không cộng, có đếm lượt chặn", async () => {
    const n = await taoNguoi("p3");
    await nhip(n, { tu: 0, den: 15, seq: 1, luc: 15 });
    const truoc = await tienDo(n);
    const r = await nhip(n, { tu: 300, den: 315, seq: 2, luc: 30 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SEEK_BLOCKED");
    const sau = await tienDo(n);
    expect(sau?.coveredSec).toBe(truoc?.coveredSec);
    expect(sau?.blockedSeekCount).toBe((truoc?.blockedSeekCount ?? 0) + 1);
  }, CASE_TIMEOUT);

  it("[VNX-P4] nhịp TRÙNG (cùng seq gửi hai lần) không cộng hai lần", async () => {
    const n = await taoNguoi("p4");
    await nhip(n, { tu: 0, den: 15, seq: 1, luc: 15 });
    const truoc = await tienDo(n);
    const r = await nhip(n, { tu: 0, den: 15, seq: 1, luc: 16 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.status).toBe("BO_QUA");
    expect(await tienDo(n)).toEqual(truoc);
  }, CASE_TIMEOUT);

  it("[VNX-P5] nhịp ĐẾN MUỘN (seq cũ tới sau seq mới) không ghi đè, không cộng", async () => {
    const n = await taoNguoi("p5");
    await nhip(n, { tu: 0, den: 15, seq: 1, luc: 15 });
    await nhip(n, { tu: 15, den: 30, seq: 2, luc: 30 });
    const truoc = await tienDo(n);
    const tatTruoc = (await nganSachCua(n))[0]!.tat;
    const r = await nhip(n, { tu: 0, den: 15, seq: 1, luc: 31 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.status).toBe("BO_QUA");
    expect(await tienDo(n)).toEqual(truoc);
    // Nhịp bị bỏ không tiêu ngân sách.
    expect((await nganSachCua(n))[0]!.tat.getTime()).toBe(tatTruoc.getTime());
  }, CASE_TIMEOUT);

  it("[VNX-P6] MẤT MẠNG 5 phút rồi nhịp sau mang cả khoảng ⇒ chỉ cộng tối đa MỘT trần nhịp (25 giây), có cờ cắt, và server báo điểm đã nhận", async () => {
    // Trần mỗi nhịp 20 → 25 (owner duyệt 28/10): người xem 1.5x gửi 22.5 giây/nhịp không còn bị cắt. Khẳng định
    // ở đây đổi theo: tối đa 15 + 25 thay vì 15 + 20. Phần chưa nhận KHÔNG mất: `meta.denNhan` cho trình phát biết
    // để xin lại ở nhịp sau — nhưng nó cũng không được cộng nhanh hơn thời gian thật (xem [VNX-N8]).
    const n = await taoNguoi("p6");
    await nhip(n, { tu: 0, den: 15, seq: 1, luc: 15 });
    const r = await nhip(n, { tu: 15, den: 315, seq: 2, luc: 315 }); // 300 giây không gửi được
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.biCatTran).toBe(true);
      expect(r.data.meta.denNhan).toBe(15 + TRAN_DELTA_GIAY);
    }
    const sau = await tienDo(n);
    expect(sau?.coveredSec).toBeLessThanOrEqual(15 + TRAN_DELTA_GIAY);
    expect(sau?.coveredSec).toBeGreaterThan(15);
  }, CASE_TIMEOUT);

  it("[VNX-P7] tốc độ vượt trần bị từ chối và KHÔNG ghi gì", async () => {
    const n = await taoNguoi("p7");
    const r = await nhip(n, { tu: 0, den: 15, seq: 1, luc: 15, tocDo: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("RATE_TOO_HIGH");
    expect(await tienDo(n)).toBeNull();
    expect(await nganSachCua(n)).toHaveLength(0);
  }, CASE_TIMEOUT);

  it("[VNX-P8] ĐỐI CHỨNG của tải lại trang: nếu client tiếp tục seq từ số đã lưu thì phần xem lại được ghi", async () => {
    const n = await taoNguoi("p8");
    for (let i = 1; i <= 3; i += 1) await nhip(n, { tu: (i - 1) * 15, den: i * 15, seq: i, luc: i * 15 });
    const r = await nhip(n, { tu: 45, den: 60, seq: 4, luc: 75 });
    expect(r.ok).toBe(true);
    expect((await tienDo(n))?.coveredSec).toBe(60);
  }, CASE_TIMEOUT);

  it("[VNX-P9] người xem TRUNG THỰC ở đúng 1.5x suốt 5 phút + nhịp cuối lúc rời trang: KHÔNG nhịp nào bị cắt", async () => {
    // Đối chứng dương bắt buộc của cổng thời gian: bản "chặn tất cả" cũng làm mọi ca âm xanh. 20 nhịp, mỗi nhịp mang
    // 22.5 giây nội dung (15 giây × 1.5), thời điểm tới lệch ngẫu nhiên trong 0–2 giây sau lịch 15 giây, rồi một nhịp
    // `pagehide` sau 10 giây (= 15 giây nội dung).
    const n = await taoNguoi("p9");
    const tab = await Tab.moTrang(n);
    const lech = [2.0, 0.4, 1.9, 0.2, 1.1, 0.0, 1.7, 0.6, 1.3, 0.9, 1.8, 0.1, 1.5, 0.3, 1.2, 0.8, 1.6, 0.5, 1.4, 0.7];
    let den = 0;
    for (let k = 0; k < 20; k += 1) {
      den += 22.5;
      const r = await guiVaTraLoi(tab, den, 15 * (k + 1) + lech[k]!, { tocDo: 1.5 });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.data.biCatThoiGian, `nhịp ${k}`).toBeUndefined();
        expect(r.data.biCatTran).toBeUndefined();
        expect(r.data.meta.denNhan).toBeUndefined();
      }
    }
    den += 15; // 10 giây đồng hồ × 1.5
    const cuoi = await guiVaTraLoi(tab, den, 15 * 20 + lech[19]! + 10, { tocDo: 1.5 });
    expect(cuoi.ok).toBe(true);
    if (cuoi.ok) expect(cuoi.data.biCatThoiGian).toBeUndefined();
    // 20 × 22.5 + 15 = 465 giây nội dung, chia hết cho 5 ⇒ phủ ĐÚNG 465.
    expect((await tienDo(n))?.coveredSec).toBe(465);
  }, CASE_DAI);

  // ══ ÂM: gian lận / nhầm lẫn mà bản sửa phải chặn ══════════════════════════════════════════════════════════

  it("[VNX-N1] ba nhịp 20 giây trong CÙNG MỘT GIÂY KHÔNG được cộng đủ 60 giây — tổng ≤ tốc độ × thời gian thật + dung sai", async () => {
    // ĐÃ ĐỔI so với bản ghim #1029 (`it.fails`, `toBeLessThan(30)`): ngưỡng "< 30" là con số tôi phác trước khi chốt
    // tham số; bất biến thật là  tổng ≤ tốc độ tối đa × (now − lúc phát vé) + dung sai,  và  tổng < số đã khai (60).
    // Ở đây: mở trang lúc T0, ba nhịp cùng giây thứ 10 ⇒ tối đa 1.5 × 10 + 3 = 18 giây nội dung.
    const n = await taoNguoi("n1");
    const tab = await Tab.moTrang(n);
    await tab.gui(20, 10);
    await tab.gui(40, 10);
    const r3 = await tab.gui(60, 10);
    const tong = (await tienDo(n))?.coveredSec ?? 0;
    expect(tong).toBeLessThan(60);
    expect(tong).toBeLessThanOrEqual(TOC_DO_TOI_DA * 10 + dungSaiNoiDung(TOC_DO_TOI_DA));
    expect(tong).toBeGreaterThan(0); // không "chặn tất cả"
    expect(r3.ok && r3.data.biCatThoiGian).toBe(true);
    // Điểm đã nhận được báo lại: trình phát xin lại phần chưa nhận thay vì coi nó đã gửi.
    expect(r3.ok && r3.data.meta.denNhan).toBeDefined();
  }, CASE_TIMEOUT);

  it("[VNX-N2] HAI TAB nhảy cóc nhau suốt 2 phút KHÔNG được nhân đôi tiến độ theo thời gian thật", async () => {
    // ĐÃ ĐỔI so với bản ghim (`it.fails`, hai nhịp cách nhau 1 giây, `< 30`): kịch bản hai nhịp chỉ đo được dung
    // sai khởi đầu, không đo được việc HAI TAB chia chung MỘT ngân sách. Nay: hai tab thay phiên nhau nhận nội dung
    // liền kề (A: 0→15, B: 15→30, A: 30→45 …), mỗi tab một nhịp/15 giây, lệch nhau 1 giây — nghĩa là 2x tốc độ
    // thực — bằng client TỰ VIẾT (không theo giao thức `denNhan`). Ngân sách theo (người, bài) ⇒ chung cho cả hai tab.
    const n = await taoNguoi("n2");
    let seq = 0;
    let den = 0;
    let lanCuoi = 0;
    for (let k = 0; k < 8; k += 1) {
      for (const lech of [0, 1]) {
        const thoiDiem = 15 * (k + 1) + lech;
        // Nhận (ghi một phần) hoặc cổng chặn-tua từ chối vì khoảng đã nhảy quá điểm đã nhận — cả hai đều là phòng thủ
        // đúng; điều KHÔNG được xảy ra là ghi nhiều hơn thời gian thật cho phép.
        const r = await nhip(n, { tu: den, den: den + 15, seq: (seq += 1), luc: thoiDiem });
        if (!r.ok) expect(r.code).toBe("SEEK_BLOCKED");
        den += 15;
        lanCuoi = thoiDiem;
      }
    }
    const daKhai = den; // 240 giây nội dung trong ~121 giây thật
    const tong = (await tienDo(n))?.coveredSec ?? 0;
    expect(await phienCua(n)).toHaveLength(1); // một phiên chung, không phải một phiên mỗi tab
    expect(await nganSachCua(n)).toHaveLength(1); // một ngân sách chung
    expect(tong).toBeLessThan(daKhai);
    expect(tong).toBeLessThanOrEqual(TOC_DO_TOI_DA * lanCuoi + dungSaiNoiDung(TOC_DO_TOI_DA) + 1e-6);
    expect(tong).toBeGreaterThan(0);
  }, CASE_DAI);

  it("[VNX-N2b] hai LƯỢT HỌC của cùng người + cùng bài (chu kỳ 1 và 2) dùng CHUNG một ngân sách — không nhân đôi bằng cách đổi lượt học", async () => {
    // Ngân sách khoá theo (người, bài) như khoá tư vấn. Khoá theo lượt học thì người học có hai lượt học của cùng khoá
    // nhận hai ngân sách và xem nhanh gấp đôi mà mọi cổng vẫn xanh.
    const a = await taoNguoi("n2b");
    const b = await themLuotHoc(a);
    const ta = await Tab.moTrang(a);
    const tb = await Tab.moTrang(b);
    await ta.gui(20, 10); // lượt học A: tới 18 giây nội dung ⇒ ghi 15
    const rb = await tb.gui(20, 10); // lượt học B, cùng giây, cùng vé: ngân sách của (người, bài) đã tiêu
    expect(rb.ok).toBe(true);
    const cuaA = (await tienDo(a))?.coveredSec ?? 0;
    const cuaB = (await tienDo(b))?.coveredSec ?? 0;
    expect(cuaA).toBeGreaterThan(0);
    expect(cuaA + cuaB).toBeLessThanOrEqual(TOC_DO_TOI_DA * 10 + dungSaiNoiDung(TOC_DO_TOI_DA));
    expect(await nganSachCua(a)).toHaveLength(1);
  }, CASE_TIMEOUT);

  it("[VNX-N3] TẢI LẠI TRANG rồi xem tiếp: trang học truyền seq đã lưu ⇒ nhịp của lượt mới được GHI, không bị coi là 'đến muộn'", async () => {
    // ĐÃ ĐỔI so với bản ghim (`it.fails`, gửi thẳng `seq: 1` lên server sau khi đã lưu 3): bản ghim kiểm một client
    // KHÔNG tồn tại sau bản sửa. Server giữ nguyên cổng `seq <= seq đã lưu` (không gỡ — chống nhịp trùng/muộn); thứ
    // sửa là tầng BÀN GIAO: trang học đọc `seq` từ DB và trình phát đi tiếp từ đó. Ca này lái đúng hai hàm thuần mà
    // trang + trình phát gọi (`Tab.moTrang` = `seqKhoiDau(progress.seq)`), nên bàn giao đứt thì ca ĐỎ.
    // Lưới ghim mã nguồn `[VNX-W3]` canh việc trang thật SỬ DỤNG đúng hàm đó.
    const n = await taoNguoi("n3");
    const truoc = await Tab.moTrang(n);
    for (let i = 1; i <= 3; i += 1) await truoc.gui(i * 15, i * 15);
    expect((await tienDo(n))?.coveredSec).toBe(45);
    // Tải lại lúc t=75 (vé MỚI ký tại 75): trình phát MỚI, bộ đếm lấy từ DB; nhịp đầu tới sau 15 giây phát.
    const sau = await Tab.moTrang(n, C.bai, 75);
    expect(sau.seq).toBe(3);
    const r = await sau.gui(60, 90);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.status).toBe("GHI_NHAN");
    expect((await tienDo(n))?.coveredSec).toBe(60);
  }, CASE_TIMEOUT);

  it("[VNX-N3b] tải lại SAU NHIỀU nhịp (12 nhịp = 3 phút): lượt mới không mất k nhịp đầu", async () => {
    // Đúng ca mô tả ở thiết kế ("đã xem k nhịp rồi tải lại: k nhịp đầu của lượt sau không được ghi"). 12 nhịp để còn
    // DƯỚI ngưỡng 240 giây — quá ngưỡng đó server bung câu hỏi tập trung, một cơ chế khác không thuộc ca này.
    const n = await taoNguoi("n3b");
    const a = await Tab.moTrang(n);
    for (let i = 1; i <= 12; i += 1) await a.gui(i * 15, i * 15);
    expect((await tienDo(n))?.seq).toBe(12);
    const b = await Tab.moTrang(n, C.bai, 200);
    expect(b.seq).toBe(12);
    // 3 nhịp kế tiếp của trang mới (cách nhau 15 giây thật): MỌI nhịp phải được nhận (bản cũ mất 12 nhịp đầu).
    for (let i = 13; i <= 15; i += 1) {
      const r = await b.gui(i * 15, 200 + (i - 12) * 15);
      expect(r.ok && r.data.status).toBe("GHI_NHAN");
    }
    expect((await tienDo(n))?.coveredSec).toBe(15 * 15);
  }, CASE_DAI);

  it("[VNX-N3c] XEM QUA NHIỀU PHIÊN (nghỉ 6 phút giữa các lần) và tải lại mỗi lần: tiến độ cộng dồn đúng, không mất, không thừa", async () => {
    const n = await taoNguoi("n3c");
    let t = 0;
    let den = 0;
    for (let phien = 0; phien < 3; phien += 1) {
      t += 360; // nghỉ 6 phút — vượt cửa sổ phiên 5 phút ⇒ phiên mới
      const tab = await Tab.moTrang(n, C.bai, t); // tải lại: vé mới
      expect(tab.batDau).toBe(den); // trang mới đứng đúng chỗ đã xem tới
      for (let k = 0; k < 4; k += 1) {
        t += 15;
        den += 15;
        const r = await tab.gui(den, t);
        expect(r.ok && r.data.status).toBe("GHI_NHAN");
      }
    }
    expect((await tienDo(n))?.coveredSec).toBe(3 * 4 * 15);
    expect((await phienCua(n)).length).toBe(3);
  }, CASE_DAI);

  it("[VNX-N3d] client CŨ chưa có bản vá (đếm lại từ 0) KHÔNG làm kẹt vĩnh viễn: bị bỏ một nhịp rồi đồng bộ lại và ghi tiếp", async () => {
    const n = await taoNguoi("n3d");
    const a = await Tab.moTrang(n);
    for (let i = 1; i <= 3; i += 1) await a.gui(i * 15, i * 15);
    // Trang mở bằng gói JS cũ trong bộ nhớ đệm: bộ đếm về 0, KHÔNG biết số đã lưu.
    const cu = new Tab(n, C.bai, 0, 45, veMo(n, C.bai, 0));
    const r1 = await cu.gui(60, 75);
    expect(r1.ok && r1.data.status).toBe("BO_QUA");
    expect((await tienDo(n))?.coveredSec).toBe(45); // nhịp bị bỏ không ghi gì
    expect(cu.batDau).toBe(45); // mốc KHÔNG nhích — khoảng 45→60 chưa mất
    expect(cu.seq).toBe(3); // đã đồng bộ lại với số server giữ
    const r2 = await cu.gui(75, 90);
    expect(r2.ok && r2.data.status).toBe("GHI_NHAN");
    // Nhịp thứ hai mang cả khoảng 45→75 (30 giây): tối đa 25 giây được nhận ⇒ vẫn tiến lên, không kẹt.
    expect((await tienDo(n))?.coveredSec).toBeGreaterThan(45);
  }, CASE_TIMEOUT);

  it("[VNX-N3e] HAI TAB cùng lấy seq khởi đầu: tab chậm hơn bị bỏ MỘT nhịp, đồng bộ lại, KHÔNG cộng hai lần cùng một khoảng", async () => {
    const n = await taoNguoi("n3e");
    const khoiDau = await Tab.moTrang(n);
    for (let i = 1; i <= 3; i += 1) await khoiDau.gui(i * 15, i * 15);
    // Hai tab mở cùng lúc (t=60, cùng vé), cùng đọc seq = 3.
    const A = await Tab.moTrang(n, C.bai, 60);
    const B = await Tab.moTrang(n, C.bai, 60);
    expect([A.seq, B.seq]).toEqual([3, 3]);
    const ra = await A.gui(60, 75); // A thắng seq 4
    const rb = await B.gui(60, 76); // B cùng seq 4 ⇒ bị bỏ
    expect(ra.ok && ra.data.status).toBe("GHI_NHAN");
    expect(rb.ok && rb.data.status).toBe("BO_QUA");
    const sauA = await tienDo(n);
    expect(sauA?.coveredSec).toBe(60);
    expect(B.seq).toBe(4); // đồng bộ lại với server
    expect(B.batDau).toBe(45); // mốc không nhích: khoảng 45→60 của B còn nguyên để gửi lại
    // B gửi lại ở nhịp kế tiếp (seq 5), mang khoảng 45→70 (25 giây): 45→60 đã có ⇒ không cộng lại, chỉ 60→70 là mới.
    const rb2 = await B.gui(70, 91);
    expect(rb2.ok && rb2.data.status).toBe("GHI_NHAN");
    const sau = await tienDo(n);
    expect(sau?.coveredSec).toBe(70);
    // `totalWatchSec` (số đếm lũy kế) chỉ tăng đúng phần MỚI: 45 + 15 + 10 = 70 — khoảng 45→60 KHÔNG bị cộng hai lần.
    expect(sau?.totalWatchSec).toBe(70);
  }, CASE_TIMEOUT);

  it("[VNX-N4] NGHỈ 4 phút rồi bắn 10 nhịp 25 giây trong MỘT giây KHÔNG được tiêu 'ngân sách tích' của 4 phút nghỉ", async () => {
    // Ca bắt buộc của yêu cầu "mất mạng rồi kết nối lại không được tự phát sinh thời gian xem không chứng minh
    // được". Nếu ngân sách cứ tích suốt thời gian im lặng thì 4 phút nghỉ = 1.5 × 240 + 3 = 363 giây nội dung bắn ra
    // trong một giây. Cửa sổ ngân sách (`CUA_SO_GIAY`) chặn mức tích ở tốc độ × cửa sổ + dung sai.
    // ⚠️ Phiên xem (thống kê) KHÔNG đứt ở đây: 4 phút < cửa sổ phiên 5 phút — định nghĩa phiên không đổi vì ngân sách.
    const n = await taoNguoi("n4");
    const tab = await Tab.moTrang(n);
    await tab.gui(15, 15);
    await tab.gui(30, 30);
    const truoc = (await tienDo(n))?.coveredSec ?? 0;
    const sauNghi = 30 + 240;
    let den = 30;
    for (let k = 0; k < 10; k += 1) {
      den += TRAN_DELTA_GIAY;
      // Client TỰ VIẾT: không theo giao thức `denNhan`. Một số nhịp bị cổng chặn-tua từ chối — cũng là phòng thủ đúng.
      const nn = await nhip(n, { tu: den - TRAN_DELTA_GIAY, den, seq: 3 + k, luc: sauNghi });
      if (!nn.ok) expect(nn.code).toBe("SEEK_BLOCKED");
    }
    const them = ((await tienDo(n))?.coveredSec ?? 0) - truoc;
    expect(them).toBeLessThanOrEqual(TOC_DO_TOI_DA * CUA_SO_GIAY + dungSaiNoiDung(TOC_DO_TOI_DA));
    expect(them).toBeGreaterThan(0);
    expect((await phienCua(n)).length).toBe(1); // phiên xem giữ định nghĩa 5 phút
  }, CASE_DAI);

  it("[VNX-N4b] ĐỐI CHỨNG: nghỉ 50 giây rồi một nhịp 25 giây ⇒ được nhận đủ (người học dừng lại nghĩ một chút không bị phạt)", async () => {
    const n = await taoNguoi("n4b");
    const tab = await Tab.moTrang(n);
    await tab.gui(15, 15);
    const r = await tab.gui(40, 15 + 50); // 25 giây nội dung sau 50 giây im lặng
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.biCatThoiGian).toBeUndefined();
      expect(r.data.meta.denNhan).toBeUndefined();
    }
    expect((await tienDo(n))?.coveredSec).toBe(40);
  }, CASE_TIMEOUT);

  it("[VNX-N5] HAI REQUEST SONG SONG không cùng tiêu MỘT phần ngân sách: 8 nhịp cùng khoảng, cùng giây ⇒ chỉ cộng một lần", async () => {
    // Không có khoá tư vấn, 8 giao dịch cùng đọc "chưa có bitmap / chưa có mốc ngân sách" rồi cùng cộng — số đếm lũy
    // kế phồng lên ~8 lần và mốc ngân sách bị ghi chồng. Chạy 3 vòng, mỗi vòng một người học mới, để cuộc đua gần như
    // chắc chắn xảy ra.
    for (let vong = 0; vong < 3; vong += 1) {
      const n = await taoNguoi(`n5v${vong}`);
      const kq = await Promise.all(
        Array.from({ length: 8 }, (_, i) => nhip(n, { tu: 0, den: 25, seq: i + 1, luc: 25 })),
      );
      expect(kq.every((r) => r.ok)).toBe(true);
      const t = await tienDo(n);
      expect(t?.coveredSec).toBe(25);
      expect(t?.totalWatchSec).toBe(25); // số đếm lũy kế = phần MỚI thật, không phải 8 × 25
      const phien = await phienCua(n);
      expect(phien).toHaveLength(1);
      expect(phien[0]?.totalWatchSec).toBe(25);
      // Mốc ngân sách bị tiêu ĐÚNG MỘT LẦN: 25 giây nội dung / 1.5 = 16.667 giây (làm tròn mili giây).
      const ns = await nganSachCua(n);
      expect(ns).toHaveLength(1);
      expect(Math.abs(tatGiay(ns[0]!.tat) - 25 / TOC_DO_TOI_DA)).toBeLessThan(0.002);
    }
  }, CASE_DAI);

  it("[VNX-N6] VÉ HẾT HẠN giữa buổi xem: nhịp bị từ chối, tiến độ KHÔNG lùi; tải lại (vé mới + seq đã lưu) ghi tiếp bình thường", async () => {
    const n = await taoNguoi("n6");
    const tab = await Tab.moTrang(n);
    await tab.gui(15, 15);
    await tab.gui(30, 30);
    const truoc = await tienDo(n);
    // Vé ký lúc t=30 sống 30 phút; nhịp tới lúc t=30+31 phút ⇒ hết hạn.
    const veCu = kyVeMedia({ lessonId: C.bai.id, userId: n.id }, VE_TTL_GIAY, luc(30).getTime());
    const hetHan = 30 + (VE_TTL_GIAY + 60);
    const r = await nhip(n, { tu: 30, den: 45, seq: tab.seq + 1, luc: hetHan, ve: veCu });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("TICKET_INVALID");
    expect(await tienDo(n)).toEqual(truoc);
    // Người học tải lại: vé MỚI (ký tại thời điểm tải) + bộ đếm từ DB; nhịp đầu tới sau 15 giây phát.
    const moi = await Tab.moTrang(n, C.bai, hetHan);
    const r2 = await moi.gui(45, hetHan + 15);
    expect(r2.ok && r2.data.status).toBe("GHI_NHAN");
    expect((await tienDo(n))?.coveredSec).toBe(45);
  }, CASE_TIMEOUT);

  it("[VNX-N7] TẠM DỪNG / TAB ẨN 3 phút (không có nhịp nào) rồi xem tiếp: thời gian dừng KHÔNG được cộng, và xem tiếp vẫn ghi bình thường", async () => {
    const n = await taoNguoi("n7");
    const tab = await Tab.moTrang(n);
    await tab.gui(15, 15);
    await tab.gui(19, 19); // nhịp bù lúc ẩn tab / tạm dừng (trình phát gửi nốt khoảng đã xem)
    const truoc = (await tienDo(n))?.coveredSec ?? 0;
    expect(truoc).toBe(15); // 19 giây: đoạn thứ 4 (15–20) chưa xem trọn ⇒ chưa tính
    // 3 phút im lặng (video dừng, không nhịp). Xem tiếp lúc t=200: nhịp đầu sau 15 giây phát.
    const r = await tab.gui(34, 215);
    expect(r.ok && r.data.status).toBe("GHI_NHAN");
    const sau = await tienDo(n);
    // Chỉ phần xem THẬT (19→34) được cộng; 3 phút dừng không đổi thành nội dung.
    expect(sau?.coveredSec).toBe(30);
    expect(sau?.coveredSec).toBeLessThan(truoc + 180);
  }, CASE_TIMEOUT);

  it("[VNX-N8] MẤT MẠNG 5 phút rồi kết nối lại: nhịp sau không tự phát sinh thời gian chưa chứng minh, và trình phát KHÔNG kẹt", async () => {
    const n = await taoNguoi("n8");
    const tab = await Tab.moTrang(n);
    await tab.gui(15, 15);
    // 300 giây không gửi được; video vẫn chạy tới 315.
    const r = await tab.gui(315, 315);
    expect(r.ok).toBe(true);
    const sau = await tienDo(n);
    expect(sau?.coveredSec).toBeLessThanOrEqual(15 + TRAN_DELTA_GIAY);
    // Mốc nhịp sau nằm đúng chỗ server đã nhận (không phải 315): phần chưa nhận được xin lại, không mất.
    expect(tab.batDau).toBe(15 + TRAN_DELTA_GIAY);
    // Nhịp kế tiếp tiếp tục từ đó và được nhận bình thường.
    const r2 = await tab.gui(330, 330);
    expect(r2.ok && r2.data.status).toBe("GHI_NHAN");
    expect((await tienDo(n))?.coveredSec).toBeGreaterThan(sau?.coveredSec ?? 0);
  }, CASE_TIMEOUT);

  // ══ VIDEO NGẮN: dung sai KHÔNG đủ mua cả bài ═══════════════════════════════════════════════════════════════

  for (const [ten, key] of [
    ["YouTube", "b19y"],
    ["MP4", "b19m"],
  ] as const) {
    it(`[VNX-G19-${ten}] video 19 giây (${ten}): khai 0→19 ở giây 1, 10, rồi 11 sau khi mở trang ⇒ CHỈ giây 11 mới DONE (19 ≤ 1.5 × 11 + 3); trước đó chưa đủ thời gian thật`, async () => {
      const n = await taoNguoi(`g19${ten.toLowerCase()}`);
      const bai = C[key];
      const tab = await Tab.moTrang(n, bai);
      // Giây 1: ngân sách 1.5 + 3 = 4.5 < một đoạn ⇒ không ghi gì.
      const r1 = await tab.gui(19, 1);
      expect(r1.ok && r1.data.coveragePercent).toBe(0);
      // Giây 10: 1.5 × 10 + 3 = 18 < 19 ⇒ ghi tối đa 15 (đoạn đuôi 15–19 cần 4 giây nữa) ⇒ 75%, CHƯA xong.
      const r2 = await tab.gui(19, 10);
      expect(r2.ok && r2.data.coveragePercent).toBe(75);
      expect(await tienDo(n, bai)).toMatchObject({ coveredSec: 15, status: "IN_PROGRESS" });
      // Giây 11: còn 19.5 − 15 = 4.5 ≥ 4 ⇒ đoạn đuôi vào ⇒ DONE. Sớm nhất là (19 − 3) / 1.5 = 10.67 giây.
      const r3 = await tab.gui(19, 11);
      expect(r3.ok && r3.data.coveragePercent).toBe(100);
      expect(await tienDo(n, bai)).toMatchObject({ coveredSec: 19, status: "DONE" });
    }, CASE_TIMEOUT);
  }

  it("[VNX-G19-1x] lượt giao KHOÁ 1x: video 19 giây ⇒ giây 16 chưa xong (19 > 1 × 16 + 2), giây 17 mới DONE — dung sai của lượt giao chứ không phải mặc định 1.5x", async () => {
    const n = await taoNguoi("g19x1", 1);
    const tab = await Tab.moTrang(n, C.b19y);
    const r1 = await tab.gui(19, 16);
    expect(r1.ok && r1.data.coveragePercent).toBe(75);
    expect((await tienDo(n, C.b19y))?.status).toBe("IN_PROGRESS");
    const r2 = await tab.gui(19, 17);
    expect(r2.ok && r2.data.coveragePercent).toBe(100);
    expect((await tienDo(n, C.b19y))?.status).toBe("DONE");
  }, CASE_TIMEOUT);

  it("[VNX-G19-BUI] 'nhịp bụi': khoảng 0.02 giây vắt qua từng ranh giới đoạn (mỗi nhịp bật cả đoạn 5 giây) KHÔNG hoàn thành được video 19 giây sau 1 giây", async () => {
    // Đo ngân sách theo ĐỘ DÀI KHOẢNG KHAI là để lọt kiểu này: 4 nhịp bụi = 4 đoạn = cả bài, mà khai có 0.08 giây.
    // Xen giữa mỗi nhịp bụi là một nhịp "nền" đi tới sát ranh giới — để cổng chặn-tua (tua tới ≤ mốc + 2 giây) KHÔNG
    // là thứ chặn ca này: chỉ ngân sách thời gian được phép là thứ chặn nó.
    const n = await taoNguoi("g19bui");
    let seq = 0;
    for (const ranh of [5, 10, 15, 19]) {
      await nhip(n, { tu: ranh - 4.98, den: ranh - 0.1, seq: (seq += 1), luc: 1, bai: C.b19y });
      await nhip(n, { tu: ranh - 0.01, den: Math.min(19, ranh + 0.01), seq: (seq += 1), luc: 1, bai: C.b19y });
    }
    const t = await tienDo(n, C.b19y);
    expect(t?.status).not.toBe("DONE");
    expect(t?.coveredSec ?? 0).toBeLessThanOrEqual(TOC_DO_TOI_DA * 1 + dungSaiNoiDung(TOC_DO_TOI_DA));
  }, CASE_TIMEOUT);

  it("[VNX-G-VECU] vé CŨ mua được đúng MỘT cửa sổ: mở trang 10 phút trước rồi mới xem ⇒ tối đa tốc độ × cửa sổ + dung sai, không phải 10 phút", async () => {
    const n = await taoNguoi("gvecu");
    // Vé ký tại T0, nhịp tới lúc T0+600: ba nhịp 25 giây cùng giây (client tự viết).
    const kq = [];
    for (let i = 0; i < 3; i += 1) {
      kq.push(await nhip(n, { tu: i * 25, den: (i + 1) * 25, seq: i + 1, luc: 600, mo: 0 }));
    }
    const tong = (await tienDo(n))?.coveredSec ?? 0;
    expect(tong).toBeLessThanOrEqual(TOC_DO_TOI_DA * CUA_SO_GIAY + dungSaiNoiDung(TOC_DO_TOI_DA));
    expect(tong).toBeGreaterThan(25); // cửa sổ vẫn bao được nhịp đầu sau khi mở trang lâu
  }, CASE_TIMEOUT);

  it("[VNX-FUZZ] 2 hạt giống × 60 nhịp ngẫu nhiên trên DB thật: sau MỌI nhịp, tiến độ ≤ tốc độ × (now − phát vé) + dung sai và không bao giờ lùi", async () => {
    // Bản thuần của cùng bất biến chạy 300 chuỗi ở `video-time-budget.test.ts` [VTB-06]; ở đây chạy chính đường ghi
    // thật (giao dịch, khoá, bảng ngân sách) để bắt lệch giữa mô hình và mã.
    const prng = (seed: number) => () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (const hat of [11, 29]) {
      const rnd = prng(hat * 7919);
      const n = await taoNguoi(`fuzz${hat}`);
      let now = 0;
      let truoc = 0;
      let seq = 0;
      for (let k = 0; k < 60; k += 1) {
        now += rnd() < 0.3 ? 0 : rnd() * 20;
        const da = (await tienDo(n))?.coveredSec ?? 0;
        const tu = rnd() < 0.5 ? Math.floor(rnd() * 600) : Math.max(0, da - rnd() * 10);
        const den = tu + rnd() * 90;
        // Mỗi nhịp một `seq` mới và tăng dần, để cổng bỏ-nhịp-muộn không nuốt ca.
        const r = await nhip(n, { tu, den, seq: (seq += 1), luc: now });
        if (!r.ok) expect(["SEEK_BLOCKED", "PAUSED_ATTENTION"]).toContain(r.code);
        const t = (await tienDo(n))?.coveredSec ?? 0;
        expect(t, `hạt ${hat} nhịp ${k}`).toBeLessThanOrEqual(TOC_DO_TOI_DA * now + dungSaiNoiDung(TOC_DO_TOI_DA) + 1e-6);
        expect(t, `hạt ${hat} nhịp ${k}`).toBeGreaterThanOrEqual(truoc);
        truoc = t;
      }
    }
  }, CASE_DAI * 2);

  // ══ PHIÊN XEM (thống kê) — định nghĩa KHÔNG đổi vì ngân sách ═══════════════════════════════════════════════

  it("[VNX-PH1] phiên xem giữ cửa sổ 5 PHÚT: nghỉ 2 phút vẫn cùng phiên, nghỉ 6 phút mới là phiên mới (số liệu 'số lần xem' không đổi)", async () => {
    const n = await taoNguoi("ph1");
    const tab = await Tab.moTrang(n);
    await tab.gui(15, 15);
    await tab.gui(30, 15 + 15 + 120); // nghỉ 2 phút (> 60 giây của bản trước, < 5 phút)
    expect(await phienCua(n)).toHaveLength(1);
    const tiep = await Tab.moTrang(n, C.bai, 300);
    await tiep.gui(45, 300 + 15 + 360); // nghỉ 6 phút kể từ nhịp cuối
    expect(await phienCua(n)).toHaveLength(2);
  }, CASE_TIMEOUT);

  // ══ VIDEO NGẮN / DÀI · MP4 / YOUTUBE — nhịp xem không biết nguồn ═══════════════════════════════════════════

  for (const [ten, key] of [
    ["YouTube", "b19y"],
    ["MP4", "b19m"],
  ] as const) {
    it(`[VNX-S19-${ten}] video 19 giây (${ten}) xem HẾT ở 1x (một nhịp lúc rời trang, 19 giây sau khi mở) ⇒ 19/19 giây, 100%, DONE`, async () => {
      const n = await taoNguoi(`s19${ten.toLowerCase()}`);
      const bai = C[key];
      const tab = await Tab.moTrang(n, bai);
      const r = await tab.gui(19, 19); // một nhịp duy nhất mang cả bài
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.coveragePercent).toBe(100);
      expect(await tienDo(n, bai)).toMatchObject({ coveredSec: 19, contentSec: 19, status: "DONE" });
    }, CASE_TIMEOUT);

    it(`[VNX-S19-${ten}-15x] video 19 giây (${ten}) xem HẾT ở 1.5x (hết bài sau 13 giây thật) ⇒ DONE, không bị cắt`, async () => {
      const n = await taoNguoi(`s15${ten.toLowerCase()}`);
      const bai = C[key];
      const tab = await Tab.moTrang(n, bai);
      const r = await tab.gui(19, 13);
      expect(r.ok && r.data.biCatThoiGian).toBeFalsy();
      expect(await tienDo(n, bai)).toMatchObject({ coveredSec: 19, status: "DONE" });
    }, CASE_TIMEOUT);

    it(`[VNX-S19-${ten}-17s] video 19 giây (${ten}) dừng ở giây 17 ⇒ CHƯA hoàn thành (không nới ngưỡng cho xanh)`, async () => {
      const n = await taoNguoi(`s17${ten.toLowerCase()}`);
      const bai = C[key];
      const tab = await Tab.moTrang(n, bai);
      const r = await tab.gui(17, 17);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.coveragePercent).toBe(75);
      expect(await tienDo(n, bai)).toMatchObject({ coveredSec: 15, status: "IN_PROGRESS" });
    }, CASE_TIMEOUT);
  }

  it("[VNX-S35-YouTube] video 35 giây xem hết qua 2 nhịp ⇒ 35/35, DONE", async () => {
    const n = await taoNguoi("s35");
    const tab = await Tab.moTrang(n, C.b35y);
    await tab.gui(20, 20);
    await tab.gui(35, 35);
    expect(await tienDo(n, C.b35y)).toMatchObject({ coveredSec: 35, status: "DONE" });
  }, CASE_TIMEOUT);

  it("[VNX-SDAI] video DÀI 903 giây xem trọn ở 1.5x (41 nhịp, đoạn đuôi lẻ 3 giây) ⇒ 903/903, DONE, không nhịp nào bị cắt", async () => {
    const n = await taoNguoi("sdai");
    const tab = await Tab.moTrang(n, C.bDai);
    let den = 0;
    let t = 0;
    while (den < C.bDai.durationSec) {
      den = Math.min(den + 22.5, C.bDai.durationSec);
      t += 15;
      // Câu hỏi tập trung bung ra giữa chừng (mỗi 240 giây phủ): `guiVaTraLoi` trả lời ngay như người học thật.
      const r = await guiVaTraLoi(tab, den, t, { tocDo: 1.5 });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.biCatThoiGian).toBeUndefined();
    }
    expect(await tienDo(n, C.bDai)).toMatchObject({ coveredSec: 903, contentSec: 903, status: "DONE" });
  }, CASE_DAI * 2);
});
