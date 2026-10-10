import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { detectIntakeAlerts } from "../../lib/lead/intake/health";
import { RUN_DB_TESTS } from "../_helpers/db-gate";

// =============================================================================
// P4 · CANH SỨC KHOẺ ĐƯỜNG NHẬN LEAD — tầng DB thật (Postgres LOCAL).
//
// Điều đáng test nhất KHÔNG phải "có kêu không" mà là "có kêu SAI không":
// lưu lượng thật chỉ ~2 lead/ngày, nên một bộ dò đặt ngưỡng cứng sẽ kêu suốt,
// bị phớt lờ, rồi lần hỏng thật cũng bị phớt lờ theo.
// =============================================================================

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
// 16/09/2026 — dùng CỔNG DUY NHẤT `RUN_DB_TESTS` (tests/_helpers/db-gate.ts) thay cho
// biểu thức chép tay. Bản chép tay chỉ hỏi "URL có trỏ Postgres cục bộ không" nên BỎ MẤT
// cờ `ALLOW_DB_RESET` — đúng cái chốt dựng sau sự cố mất DB 04/09/2026. Hệ quả đo được:
// trên máy dev (DATABASE_URL = 127.0.0.1/satarobo_local) các bộ này CHẠY THẬT trên DB
// đang làm việc, nên `pnpm test:unit` lúc xanh lúc đỏ tuỳ thứ tự, còn `assertTestDb()`
// thì từ chối dọn ⇒ đỏ câm không liên quan gì tới mã.
const RUN = RUN_DB_TESTS;

if (!RUN) {
  console.warn("[intake-health] SKIP: DATABASE_URL không trỏ Postgres local.");
}

const db = new PrismaClient();
const P = "ITHL_";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Mốc "bây giờ" cố định — KHÔNG dùng Date.now() trôi nổi để test khỏi flake. */
const NOW = new Date("2026-08-16T10:00:00.000Z");

async function purge() {
  await db.webhookDelivery.deleteMany({ where: { source: { startsWith: P } } });
  // ⚠️ Lọc theo `parentName` chứ KHÔNG theo `source`: các ca "im lặng" buộc phải
  // dùng tên nguồn THẬT (`sale-form`) vì bộ dò chỉ xét `MONITORED_SOURCES`. Lọc
  // theo tiền tố nguồn sẽ bỏ sót chúng ⇒ lead của ca trước rò sang ca sau và
  // đẩy nền vượt ngưỡng. Đúng cái bẫy này đã làm 1 ca đỏ lúc viết.
  const leads = await db.lead.findMany({
    where: { parentName: { startsWith: P } },
    select: { id: true },
  });
  const ids = leads.map((l) => l.id);
  if (ids.length) {
    await db.leadActivity.deleteMany({ where: { leadId: { in: ids } } });
    await db.leadAuditLog.deleteMany({ where: { leadId: { in: ids } } });
    await db.leadChild.deleteMany({ where: { leadId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } });
  }
}

/** Tạo N lead của một nguồn, đặt `createdAt` lùi về quá khứ. */
async function seedLeads(source: string, count: number, agoMs: number) {
  for (let i = 0; i < count; i++) {
    await db.lead.create({
      data: {
        parentName: `${P}PH ${source} ${i}`,
        phone: `849${String(10_000_000 + i).slice(0, 8)}`,
        source,
        createdAt: new Date(NOW.getTime() - agoMs),
      },
    });
  }
}

async function seedFailed(source: string, count: number, agoMs: number) {
  for (let i = 0; i < count; i++) {
    await db.webhookDelivery.create({
      data: {
        source,
        payload: {},
        status: "FAILED",
        errorMessage: "lỗi giả lập",
        receivedAt: new Date(NOW.getTime() - agoMs),
      },
    });
  }
}

describe.skipIf(!RUN)("Canh sức khoẻ đường nhận lead", () => {
  beforeAll(async () => {
    await purge();
  }, 120_000);

  beforeEach(async () => {
    await purge();
  }, 120_000);

  afterAll(async () => {
    await purge();
    await db.$disconnect();
  }, 120_000);

  it("cụm lỗi trong 1 giờ ⇒ kêu, nêu đúng nguồn", async () => {
    await seedFailed(`${P}sale-form`, 4, 10 * 60_000);
    const alerts = await detectIntakeAlerts(NOW);
    const failing = alerts.filter((a) => a.kind === "failing" && a.source === `${P}sale-form`);
    expect(failing).toHaveLength(1);
    expect(failing[0]!.body).toContain("4 phiếu lỗi");
  }, 60_000);

  it("dưới ngưỡng ⇒ IM, không báo động giả", async () => {
    await seedFailed(`${P}sale-form`, 2, 10 * 60_000);
    const alerts = await detectIntakeAlerts(NOW);
    expect(alerts.filter((a) => a.source === `${P}sale-form`)).toHaveLength(0);
  }, 60_000);

  it("lỗi CŨ hơn 1 giờ ⇒ không kêu lại (cửa sổ trượt)", async () => {
    await seedFailed(`${P}sale-form`, 10, 3 * HOUR);
    const alerts = await detectIntakeAlerts(NOW);
    expect(alerts.filter((a) => a.source === `${P}sale-form`)).toHaveLength(0);
  }, 60_000);

  it("🔴 nguồn ĐÃ KHAI TỬ (sale-form) tịt hẳn ⇒ KHÔNG kêu", async () => {
    // Biểu mẫu tĩnh công khai nghỉ 22/08/2026, nên nó im là ĐÚNG. Để nó trong
    // `MONITORED_SOURCES` là kêu mỗi ngày suốt ~7 ngày — báo động giả bị phớt lờ
    // thì lần hỏng thật cũng bị phớt lờ theo.
    for (let d = 2; d <= 8; d++) await seedLeads("sale-form", 2, d * DAY);
    const alerts = await detectIntakeAlerts(NOW);
    expect(alerts.filter((a) => a.kind === "silent" && a.source === "sale-form")).toHaveLength(0);
  }, 60_000);

  it("nguồn CHẠY ĐỀU rồi tịt hẳn ⇒ kêu im lặng", async () => {
    // 14 lead rải trong 7 ngày trước cửa sổ, 0 lead trong 24h gần nhất.
    for (let d = 2; d <= 8; d++) await seedLeads("quatang", 2, d * DAY);
    const alerts = await detectIntakeAlerts(NOW);
    const silent = alerts.filter((a) => a.kind === "silent" && a.source === "quatang");
    expect(silent).toHaveLength(1);
    expect(silent[0]!.body).toContain("KHÔNG có lead nào");
  }, 60_000);

  it("nguồn lưu lượng THẤP im 1 ngày ⇒ KHÔNG kêu (đây là chỗ báo động giả hay sinh ra)", async () => {
    // 3 lead trong 7 ngày = dưới 1/ngày ⇒ im một ngày là chuyện thường.
    for (let d = 2; d <= 4; d++) await seedLeads("quatang", 1, d * DAY);
    const alerts = await detectIntakeAlerts(NOW);
    expect(alerts.filter((a) => a.kind === "silent" && a.source === "quatang")).toHaveLength(0);
  }, 60_000);

  it("nguồn vẫn đang về lead ⇒ KHÔNG kêu dù nền dày", async () => {
    for (let d = 2; d <= 8; d++) await seedLeads("quatang", 2, d * DAY);
    await seedLeads("quatang", 1, 2 * HOUR); // vừa có lead 2 giờ trước
    const alerts = await detectIntakeAlerts(NOW);
    expect(alerts.filter((a) => a.kind === "silent" && a.source === "quatang")).toHaveLength(0);
  }, 60_000);

  it("nguồn KHÔNG nằm trong danh sách canh ⇒ bỏ qua, không kêu bừa", async () => {
    for (let d = 2; d <= 8; d++) await seedLeads(`${P}nguon-la`, 3, d * DAY);
    const alerts = await detectIntakeAlerts(NOW);
    expect(alerts.filter((a) => a.kind === "silent")).toHaveLength(0);
  }, 60_000);

  it("khoá dedupe theo giờ/ngày VN để không spam lại cùng một cảnh báo", async () => {
    await seedFailed(`${P}sale-form`, 5, 5 * 60_000);
    const a1 = await detectIntakeAlerts(NOW);
    const a2 = await detectIntakeAlerts(new Date(NOW.getTime() + 10 * 60_000));
    const k1 = a1.find((a) => a.source === `${P}sale-form`)?.dedupeKey;
    const k2 = a2.find((a) => a.source === `${P}sale-form`)?.dedupeKey;
    expect(k1).toBeDefined();
    // Cùng giờ VN ⇒ cùng khoá ⇒ upsert đè, không đẻ thông báo mới.
    expect(k2).toBe(k1);
    // 17:00 giờ VN = 10:00Z ⇒ khoá phải mang ngày/giờ VN, không phải UTC.
    expect(k1).toContain("-17");
  }, 60_000);
});
