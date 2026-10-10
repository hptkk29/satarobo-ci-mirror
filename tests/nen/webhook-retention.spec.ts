// @vitest-environment node
/**
 * S9-B7 — CRON DỌN `WebhookDelivery` / `DomainEvent` trên Postgres thật.
 *
 * Vì sao phải chạm DB thật: thứ cần chứng minh không phải "hàm trả về số mấy" mà là
 * "dòng nào còn nằm trong bảng sau khi cron chạy". Bản mock chỉ chứng minh được hình
 * dạng của `where`, còn đúng cái sai đắt nhất — lọc nhầm trạng thái rồi xoá mất sự
 * kiện đang chờ xử lý — thì phải hỏi chính bảng mới biết.
 *
 * VÌ SAO ĐẶT Ở `tests/nen/` chứ không phải `tests/zalocrm/`:
 * `vitest.config.ts` include là bộ lọc CỨNG. Thư mục mới không khai vào đó thì
 * `vitest run <thư mục>` in "No test files found" và THOÁT MÃ 0 ⇒ CI xanh giả.
 * `tests/nen/**` vừa đã khai sẵn (vitest.config.ts), vừa ĐÃ có job CI gọi thật
 * (`pnpm test:nen-db`, `.github/workflows/ci.yml`) — khác `tests/inbox/**` vốn
 * chưa job nào gọi. Và hai bảng này là hạ tầng nền, không phải hộp thư.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`, không TRUNCATE. `assertTestDb()` chặn chạy ngoài
 * Postgres local; dọn theo tiền tố `ZCRM_RET_` ở beforeAll/beforeEach/afterAll.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";

import { db } from "../../lib/db";
import { assertTestDb, disconnectDb } from "../e2e/_helpers/seed";
import { RUN_DB_TESTS } from "../_helpers/db-gate";

// 28/09/2026 — gỡ nốt bản chép tay `HAS_LOCAL_DB`/`ALLOW_REMOTE` còn sót ở đây (không ai đọc,
// nhưng là một bản thứ hai của phép nhận diện DB local — đúng thứ vừa phải vá cho tunnel VPS).
// 16/09/2026 — dùng CỔNG DUY NHẤT `RUN_DB_TESTS` (tests/_helpers/db-gate.ts) thay cho
// biểu thức chép tay. Bản chép tay chỉ hỏi "URL có trỏ Postgres cục bộ không" nên BỎ MẤT
// cờ `ALLOW_DB_RESET` — đúng cái chốt dựng sau sự cố mất DB 04/09/2026. Hệ quả đo được:
// trên máy dev (DATABASE_URL = 127.0.0.1/satarobo_local) các bộ này CHẠY THẬT trên DB
// đang làm việc, nên `pnpm test:unit` lúc xanh lúc đỏ tuỳ thứ tự, còn `assertTestDb()`
// thì từ chối dọn ⇒ đỏ câm không liên quan gì tới mã.
const RUN = RUN_DB_TESTS;

if (!RUN) {
  console.warn("[webhook-retention] SKIP: DATABASE_URL không trỏ Postgres local.");
}

const CASE_TIMEOUT = 60_000;
const HOOK_TIMEOUT = 120_000;

/** Tiền tố riêng của bộ này — đừng dùng lại `HTDK_` (hộp thư) hay `CI_POS_` (vị trí). */
const P = "ZCRM_RET_";
const NGAY = 24 * 60 * 60 * 1_000;

/**
 * "Bây giờ" GIẢ, cố định. Mọi dòng gieo đều mang mốc tuyệt đối quanh nó, nên số đếm
 * trả về là con số CHÍNH XÁC chứ không phải "ít nhất bằng": dòng thật của các bộ test
 * khác đều mang `receivedAt` ≈ hôm nay (2026-09…), nằm SAU mốc cắt 2026-05-16 nên
 * không bao giờ lọt vào lượt xoá này.
 */
const BAY_GIO = new Date("2026-06-15T00:00:00.000Z");
const MOC_CAT = new Date(BAY_GIO.getTime() - 30 * NGAY); // 2026-05-16
const QUA_HAN = new Date("2026-01-10T00:00:00.000Z");
const CON_HAN = new Date("2026-06-10T00:00:00.000Z");

/**
 * Xoá SẠCH mọi dòng lẽ ra thuộc diện bị dọn, để số đếm của từng ca là tuyệt đối.
 *
 * Điều kiện ở đây được VIẾT LẠI BẰNG TAY, cố ý không gọi hàm đang đi kiểm: test phải
 * tự phát biểu kỳ vọng của nó, không mượn lời của mã bị kiểm.
 */
async function xoaSachDongQuaHan() {
  await db.webhookDelivery.deleteMany({ where: { receivedAt: { lt: MOC_CAT } } });
  await db.domainEvent.deleteMany({
    where: { status: "DONE", createdAt: { lt: MOC_CAT } },
  });
}

async function cleanup() {
  await db.webhookDelivery.deleteMany({ where: { source: { startsWith: P } } });
  await db.domainEvent.deleteMany({ where: { type: { startsWith: P } } });
}

async function gieoWebhook(ten: string, receivedAt: Date, status: "RECEIVED" | "PROCESSED" | "FAILED" | "DUPLICATE" = "PROCESSED") {
  return db.webhookDelivery.create({
    data: {
      source: `${P}${ten}`,
      externalId: `${P}${ten}`,
      payload: { parentName: "Nguyễn Văn A", phone: "0912345678" },
      status,
      receivedAt,
    },
    select: { id: true },
  });
}

async function gieoSuKien(ten: string, status: string, createdAt: Date) {
  return db.domainEvent.create({
    data: {
      type: `${P}${ten}`,
      payloadJson: { phone: "0912345678" },
      status,
      dedupeKey: `${P}${ten}`,
      createdAt,
    },
    select: { id: true },
  });
}

async function conSong(bang: "webhook" | "suKien", id: string): Promise<boolean> {
  const row =
    bang === "webhook"
      ? await db.webhookDelivery.findUnique({ where: { id }, select: { id: true } })
      : await db.domainEvent.findUnique({ where: { id }, select: { id: true } });
  return row !== null;
}

describe.skipIf(!RUN)("S9-B7 · cron dọn WebhookDelivery/DomainEvent (Postgres thật)", () => {
  beforeAll(async () => {
    assertTestDb();
    await cleanup();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await cleanup();
    await xoaSachDongQuaHan();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectDb();
    }
  }, HOOK_TIMEOUT);

  it(
    "[ZC-18a] dòng quá 30 ngày bị xoá, dòng mới giữ nguyên",
    async () => {
      const { donWebhookDelivery } = await import("@/lib/compliance/webhook-retention");

      const cu = await gieoWebhook("cu", QUA_HAN);
      const moi = await gieoWebhook("moi", CON_HAN);
      const cuXong = await gieoSuKien("sk-cu", "DONE", QUA_HAN);
      const moiXong = await gieoSuKien("sk-moi", "DONE", CON_HAN);

      await donWebhookDelivery({ now: BAY_GIO });

      expect(await conSong("webhook", cu.id)).toBe(false);
      expect(await conSong("webhook", moi.id)).toBe(true);
      expect(await conSong("suKien", cuXong.id)).toBe(false);
      expect(await conSong("suKien", moiXong.id)).toBe(true);
    },
    CASE_TIMEOUT,
  );

  it(
    "[ZC-18b] chỉ xoá DomainEvent đã xử lý xong — KHÔNG đụng PENDING/PROCESSING/FAILED",
    async () => {
      const { donWebhookDelivery } = await import("@/lib/compliance/webhook-retention");

      const xong = await gieoSuKien("b-done", "DONE", QUA_HAN);
      const cho = await gieoSuKien("b-pending", "PENDING", QUA_HAN);
      const dangChay = await gieoSuKien("b-processing", "PROCESSING", QUA_HAN);
      const hong = await gieoSuKien("b-failed", "FAILED", QUA_HAN);

      const kq = await donWebhookDelivery({ now: BAY_GIO });

      expect(await conSong("suKien", xong.id)).toBe(false);
      // Ba dòng dưới là lý do bài test này tồn tại: một sự kiện PENDING bị dọn nhầm
      // là một side-effect (email/ZNS/đồng bộ) biến mất vĩnh viễn mà không ai biết,
      // còn một dòng FAILED bị dọn là mất luôn bằng chứng để điều tra.
      expect(await conSong("suKien", cho.id)).toBe(true);
      expect(await conSong("suKien", dangChay.id)).toBe(true);
      expect(await conSong("suKien", hong.id)).toBe(true);
      expect(kq.domainEvent).toBe(1);
    },
    CASE_TIMEOUT,
  );

  it(
    "[ZC-18c] chạy hai lần cho cùng kết quả (idempotent) — lượt hai không còn gì để xoá",
    async () => {
      const { donWebhookDelivery } = await import("@/lib/compliance/webhook-retention");

      await gieoWebhook("c-cu", QUA_HAN);
      const moi = await gieoWebhook("c-moi", CON_HAN);
      await gieoSuKien("c-sk-cu", "DONE", QUA_HAN);
      const choLai = await gieoSuKien("c-sk-cho", "PENDING", QUA_HAN);

      const lan1 = await donWebhookDelivery({ now: BAY_GIO });
      const lan2 = await donWebhookDelivery({ now: BAY_GIO });

      expect(lan1.webhookDelivery).toBe(1);
      expect(lan1.domainEvent).toBe(1);
      expect(lan2.webhookDelivery).toBe(0);
      expect(lan2.domainEvent).toBe(0);

      // Trạng thái bảng SAU lượt hai phải y hệt sau lượt một.
      expect(await conSong("webhook", moi.id)).toBe(true);
      expect(await conSong("suKien", choLai.id)).toBe(true);
    },
    CASE_TIMEOUT,
  );

  it(
    "[ZC-18d] trả về số dòng đã xoá TỪNG BẢNG + mốc cắt, đủ để ghi nhật ký",
    async () => {
      const { donWebhookDelivery } = await import("@/lib/compliance/webhook-retention");

      await gieoWebhook("d1", QUA_HAN);
      await gieoWebhook("d2", QUA_HAN, "FAILED");
      await gieoWebhook("d3", CON_HAN);
      await gieoSuKien("d-sk1", "DONE", QUA_HAN);
      await gieoSuKien("d-sk2", "DONE", QUA_HAN);
      await gieoSuKien("d-sk3", "DONE", CON_HAN);

      const kq = await donWebhookDelivery({ now: BAY_GIO });

      expect(kq.webhookDelivery).toBe(2);
      expect(kq.domainEvent).toBe(2);
      expect(kq.ngayGiuLai).toBe(30);
      expect(kq.cutoff).toBe(MOC_CAT.toISOString());
      expect(kq.daChamTran).toBe(false);
    },
    CASE_TIMEOUT,
  );

  it(
    "[ZC-18e] số ngày giữ lại tuỳ biến được, và 0 ngày bị TỪ CHỐI (không xoá gì)",
    async () => {
      const { donWebhookDelivery } = await import("@/lib/compliance/webhook-retention");

      const vuaGhi = await gieoWebhook("e-vua-ghi", new Date(BAY_GIO.getTime() - 60_000));
      const batNgay = await gieoWebhook("e-8-ngay", new Date(BAY_GIO.getTime() - 8 * NGAY));

      await expect(donWebhookDelivery({ now: BAY_GIO, ngayGiuLai: 0 })).rejects.toThrow();
      expect(await conSong("webhook", vuaGhi.id)).toBe(true);

      const kq = await donWebhookDelivery({ now: BAY_GIO, ngayGiuLai: 7 });
      expect(kq.ngayGiuLai).toBe(7);
      expect(await conSong("webhook", batNgay.id)).toBe(false);
      expect(await conSong("webhook", vuaGhi.id)).toBe(true);
    },
    CASE_TIMEOUT,
  );
});
