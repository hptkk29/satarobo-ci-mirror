// @vitest-environment node
/**
 * AI LEAD GATEWAY — BỘ ĐẾM YÊU CẦU BỊ TỪ CHỐI (Postgres THẬT).
 *
 * Những thứ KHÔNG test thuần nào chứng minh được: upsert tăng dần trên khoá ghép thật, hàng được ghi sau một yêu cầu bị từ chối đi qua ROUTE thật,
 * agentId KHÔNG BAO GIỜ là id do kẻ gọi tự khai, cron dọn theo `ai.rejectLogRetentionDays`.
 *
 * Mã ca: [AIL-RC-DB-*]. ⚠️ Bộ này TỰ SKIP khi không có Postgres test (db-gate) — thấy SKIP nghĩa là CHƯA KIỂM ĐƯỢC GÌ.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertTenDbTest, RUN_DB_TESTS } from "../_helpers/db-gate";

const mk = vi.hoisted(() => ({ bat: true, giu: 30 }));
vi.mock("@/lib/rate-limit", async () => {
  const that = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return { ...that, rateLimit: (a: { key: string; max: number; windowMs: number }) => that.rateLimit({ ...a, key: `${a.key}:${Math.random()}` }) };
});
vi.mock("@/lib/ai-lead/cai-dat", async (goc) => {
  const that = await goc<typeof import("@/lib/ai-lead/cai-dat")>();
  return {
    ...that,
    congProd: async () => ({ allowed: true, reason: "OK", thieu: [] }),
    docCaiDat: async () => ({ ...(await that.docCaiDat()), rejectLogEnabled: mk.bat, rejectLogRetentionDays: mk.giu }),
  };
});
vi.mock("@/lib/ai-lead/dich-vu/thong-bao", async (goc) => {
  const that = await goc<typeof import("@/lib/ai-lead/dich-vu/thong-bao")>();
  return { ...that, baoHoSoCanXuLy: vi.fn(), baoQuaHan: vi.fn(), baoSuCoAgent: vi.fn() };
});

import { db } from "@/lib/db";
import { docFixture } from "@/lib/ai-lead/ho-tro-test";
import { chayDonDep } from "@/lib/ai-lead/dich-vu/don-dep";
import { docTrungTamKetNoi } from "@/lib/ai-lead/dich-vu/ket-noi";
import { choTest, docTuChoiGanDay, xaBoDem } from "@/lib/ai-lead/tu-choi";
import { ngayVnLaDate } from "@/lib/ai-lead/ngay-vn";
import { AGENT_KHAC, AGENT_TEST, batMoiTruong, don, dung, goi } from "./_nen";

const RUN = RUN_DB_TESTS;
const NGAY_MS = 24 * 3_600_000;
const thanIntake = () => docFixture("10").request.body as Record<string, unknown>;
const hang = () => db.aiLeadRejectCounter.findMany({ orderBy: [{ code: "asc" }, { agentId: "asc" }] });

describe.skipIf(!RUN)("AI Lead Gateway — bộ đếm yêu cầu bị từ chối (Postgres thật)", () => {
  let khoiPhuc: () => void;
  beforeAll(async () => {
    assertTenDbTest();
    khoiPhuc = batMoiTruong();
    await dung();
  });
  afterAll(async () => {
    await db.aiLeadRejectCounter.deleteMany({});
    await db.orgUnit.deleteMany({ where: { code: { startsWith: "AILTG_" } } });
    await don();
    khoiPhuc();
    await db.$disconnect();
  });
  beforeEach(async () => {
    mk.bat = true;
    mk.giu = 30;
    choTest.datLai();
    await db.aiLeadRejectCounter.deleteMany({});
  });

  it("[AIL-RC-DB-01] qua ROUTE thật: chữ ký sai ⇒ agentId TRỐNG (kể cả khi kẻ gọi khai id của agent thật); chữ ký đúng + lỗi sau chữ ký ⇒ agentId = id agent", async () => {
    // (a) kẻ lạ khai id của agent THẬT nhưng ký sai
    expect((await goi("leadIntakes", { than: thanIntake(), agentId: AGENT_KHAC, sigGhiDe: "0".repeat(64) })).status).toBe(401);
    // (b) agent LẠ hoàn toàn
    expect((await goi("leadIntakes", { than: thanIntake(), agentId: "ailtgagentkhongco0001", khoa: "khoa-bat-ky-cua-ke-la" })).status).toBe(401);
    // (c) chữ ký ĐÚNG nhưng thân sai
    expect((await goi("leadIntakes", { than: { ...thanIntake(), khoaLa: 1 } })).status).toBe(400);
    // (d) chữ ký ĐÚNG nhưng lệch giờ
    expect((await goi("leadIntakes", { than: thanIntake(), ts: Date.now() - 3_600_000 })).status).toBe(401);
    expect(await xaBoDem()).toBeGreaterThan(0);
    const dong = await hang();
    expect(dong.map((d) => [d.endpoint, d.code, d.agentId, d.count]).sort()).toEqual(
      [
        ["leadIntakes", "BAD_SIGNATURE", "", 2],
        ["leadIntakes", "CLOCK_SKEW", AGENT_TEST, 1],
        ["leadIntakes", "PAYLOAD_INVALID", AGENT_TEST, 1],
      ].sort(),
    );
    expect(dong.some((d) => d.agentId === AGENT_KHAC || d.agentId === "ailtgagentkhongco0001"), "id do kẻ gọi tự khai không bao giờ được lưu").toBe(false);
    for (const d of dong) expect(d.day.getTime()).toBe(ngayVnLaDate(d.lastAt.getTime()).getTime());
  });

  it("[AIL-RC-DB-02] xả nhiều lần ⇒ count CỘNG DỒN trên cùng khoá, firstAt giữ nguyên, lastAt tiến lên", async () => {
    for (let i = 0; i < 3; i++) await goi("leadIntakes", { than: thanIntake(), sigGhiDe: "1".repeat(64) });
    await xaBoDem();
    const [dau] = await hang();
    expect(dau!.count).toBe(3);
    await new Promise((r) => setTimeout(r, 15));
    for (let i = 0; i < 2; i++) await goi("leadIntakes", { than: thanIntake(), sigGhiDe: "2".repeat(64) });
    await xaBoDem();
    const dong = await hang();
    expect(dong).toHaveLength(1);
    expect(dong[0]!.count).toBe(5);
    expect(dong[0]!.firstAt.getTime()).toBe(dau!.firstAt.getTime());
    expect(dong[0]!.lastAt.getTime()).toBeGreaterThan(dau!.lastAt.getTime());
  });

  it("[AIL-RC-DB-03] cờ TẮT ⇒ hàng nghìn yêu cầu hỏng KHÔNG sinh dòng nào", async () => {
    mk.bat = false;
    for (let i = 0; i < 10; i++) await goi("leadIntakes", { than: thanIntake(), sigGhiDe: "3".repeat(64) });
    expect(await xaBoDem()).toBe(0);
    expect(await db.aiLeadRejectCounter.count()).toBe(0);
  });

  it("[AIL-RC-DB-04] 200 yêu cầu hỏng cùng khoá ⇒ MỘT dòng (không phải 200 phép ghi)", async () => {
    const tra = await Promise.all(Array.from({ length: 200 }, () => goi("leadIntakes", { than: thanIntake(), sigGhiDe: "4".repeat(64) })));
    expect(tra.every((r) => r.status === 401)).toBe(true);
    await xaBoDem();
    const dong = await hang();
    expect(dong).toHaveLength(1);
    expect(dong[0]!.count).toBe(200);
  });

  it("[AIL-RC-DB-05] cron: xả phần còn đệm + XOÁ dòng quá ai.rejectLogRetentionDays, giữ dòng còn hạn; chạy lặp ⇒ 0", async () => {
    const homNay = ngayVnLaDate(Date.now());
    const mau = (soNgayTruoc: number) => ({ day: new Date(homNay.getTime() - soNgayTruoc * NGAY_MS), endpoint: "leadIntakes", code: "BAD_SIGNATURE", agentId: "", count: 7, firstAt: new Date(), lastAt: new Date() });
    await db.aiLeadRejectCounter.createMany({ data: [mau(40), mau(31), { ...mau(30), code: "CLOCK_SKEW" }, { ...mau(5), code: "RATE_LIMITED" }] });
    await goi("leadIntakes", { than: thanIntake(), sigGhiDe: "5".repeat(64) }); // còn trong bộ đệm
    mk.giu = 30;
    const kq = await chayDonDep({ dongHo: () => new Date() });
    expect(kq.ok, JSON.stringify(kq.loi)).toBe(true);
    expect(kq.tuChoiXoa).toBe(2); // 40 và 31 ngày trước; đúng 30 ngày CÒN GIỮ
    const con = (await hang()).map((d) => [d.code, d.day.getTime() === homNay.getTime() ? "homnay" : Math.round((homNay.getTime() - d.day.getTime()) / NGAY_MS)]);
    expect(con).toEqual(expect.arrayContaining([["CLOCK_SKEW", 30], ["RATE_LIMITED", 5], ["BAD_SIGNATURE", "homnay"]]));
    expect(con).toHaveLength(3);
    expect((await chayDonDep({ dongHo: () => new Date() })).tuChoiXoa).toBe(0);
  });

  it("[AIL-RC-DB-06] đọc: gộp theo agent, phần agentId '' là CHƯA xác thực; chỉ lấy hôm nay + hôm qua", async () => {
    const homNay = ngayVnLaDate(Date.now());
    const d = (soNgayTruoc: number, code: string, agentId: string, count: number) => ({ day: new Date(homNay.getTime() - soNgayTruoc * NGAY_MS), endpoint: "leadIntakes", code, agentId, count, firstAt: new Date(), lastAt: new Date() });
    await db.aiLeadRejectCounter.createMany({
      data: [d(0, "BAD_SIGNATURE", "", 4), d(1, "BAD_SIGNATURE", "", 6), d(2, "BAD_SIGNATURE", "", 100), d(0, "CLOCK_SKEW", AGENT_TEST, 3), d(1, "RATE_LIMITED", AGENT_TEST, 2)],
    });
    const r = await docTuChoiGanDay(Date.now());
    expect(r.chuaXacThuc).toEqual({ tong: 10, theoMa: [{ ma: "BAD_SIGNATURE", n: 10 }] });
    expect(r.theoAgent.get(AGENT_TEST)).toEqual({ tong: 5, theoMa: [{ ma: "CLOCK_SKEW", n: 3 }, { ma: "RATE_LIMITED", n: 2 }] });
  });
  it("[AIL-RC-DB-07] Trung tâm kết nối: cờ BẬT ⇒ số thật theo Agent + phần chưa xác thực; cờ TẮT ⇒ null/«chưa đo» DÙ trong bảng có dòng (không in 0 thay cho «chưa đo»)", async () => {
    const homNay = ngayVnLaDate(Date.now());
    const d = (code: string, agentId: string, count: number) => ({ day: homNay, endpoint: "leadIntakes", code, agentId, count, firstAt: new Date(), lastAt: new Date() });
    await db.aiLeadRejectCounter.createMany({ data: [d("BAD_SIGNATURE", "", 9), d("CLOCK_SKEW", AGENT_TEST, 4)] });
    const actor = { userId: "ailtg-actor", isSuperAdmin: true, isHoLevel: true, orgRoles: [], permissions: [], visibleCenterIds: [], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>() } as unknown as import("@/lib/auth/actor").Actor;
    mk.bat = true;
    const bat = await docTrungTamKetNoi(actor, new Date());
    expect(bat.tuChoiChuaXacThuc).toEqual({ bat: true, chuaXacThuc: { tong: 9, theoMa: [{ ma: "BAD_SIGNATURE", n: 9 }] } });
    expect(bat.agents.find((a) => a.agent.id === AGENT_TEST)!.tuChoi).toEqual({ tong: 4, theoMa: [{ ma: "CLOCK_SKEW", n: 4 }] });
    expect(bat.agents.find((a) => a.agent.id === AGENT_KHAC)!.tuChoi, "agent không có dòng nào nhưng cờ bật ⇒ 0 đã đo").toEqual({ tong: 0, theoMa: [] });
    mk.bat = false;
    const tat = await docTrungTamKetNoi(actor, new Date());
    expect(tat.tuChoiChuaXacThuc).toEqual({ bat: false, chuaXacThuc: null });
    expect(tat.agents.every((a) => a.tuChoi === null)).toBe(true);
  });
});
