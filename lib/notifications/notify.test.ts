// lib/notifications/notify.test.ts — sự cố egress 05/09/2026: thông báo không đổi thì KHÔNG ghi,
// KHÔNG rung; chỉ rung khi tạo mới hoặc `reopen` kéo bản đã đọc về chưa đọc.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const findMany = vi.fn();
  const upsert = vi.fn();
  const update = vi.fn();
  const broadcastMessages = vi.fn(async () => true);
  // Dòng thứ ba của `notifyStaff` ghi `WebPushOutbox` (US-14b Đợt 4). Khai tường minh ở đây
  // thay vì để `ghiOutboxPush` nuốt một TypeError: nuốt được thì bộ này vẫn xanh, nhưng nó
  // xanh vì cái bẫy an toàn chứ không vì hàm chạy đúng — và console đầy cảnh báo giả.
  const outboxCreateMany = vi.fn(async (_a: { data: unknown[] }) => ({ count: 0 }));
  // 13/09 — `ghiOutboxPush` đọc `push.tienToDuocDay` để biết loại nào được đẩy. Không mock
  // thì lần đọc HỎNG ⇒ hàm giữ dòng ở `PENDING` (fail-safe có chủ đích) ⇒ ca 'ngoài danh
  // sách ⇒ SKIPPED' đỏ, còn ca 'lead.moi: ⇒ PENDING' XANH GIẢ vì lý do sai.
  const getGlobalSetting = vi.fn(async (_k: string) => ["lead.moi:"] as unknown);
  return {
    findMany,
    upsert,
    update,
    broadcastMessages,
    outboxCreateMany,
    getGlobalSetting,
    mockDb: {
      staffNotification: { findMany, upsert, update },
      webPushOutbox: { createMany: outboxCreateMany },
    },
  };
});

vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/settings/read-global", () => ({ getGlobalSetting: h.getGlobalSetting }));
vi.mock("@/lib/chat/broadcast", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/chat/broadcast")>();
  return { ...mod, broadcastMessages: h.broadcastMessages };
});

import { ghiThongBaoNhanSu, notifyStaff } from "@/lib/notifications/notify";
import { classifyNotification } from "@/lib/notifications/catalog";

const THAM_SO = {
  userIds: ["u1", "u2"],
  dedupeKey: "sla:SLA-1:lead1",
  title: "Cảnh báo SLA (SLA-1)",
  body: "Chưa bàn giao > 4h",
  href: "/leads/lead1",
  entityId: "lead1",
};

const PHAN_LOAI = classifyNotification(THAM_SO.dedupeKey);

/** Dòng đã có trong DB khớp y nguyên với THAM_SO sau khi classify. */
function dongCu(userId: string, extra: Partial<Record<string, unknown>> = {}) {
  return {
    userId,
    readAt: null,
    title: THAM_SO.title,
    body: THAM_SO.body,
    href: THAM_SO.href,
    groupKey: PHAN_LOAI.groupKey,
    priority: PHAN_LOAI.priority,
    entityType: PHAN_LOAI.entityType,
    entityId: "lead1",
    expiresAt: null,
    // Cột NOT NULL có `@default("ACTIVE")` trên DB thật — fixture thiếu nó thì
    // `cu.state` là undefined và code coi mọi dòng như đã bị thu hồi. Bẫy đúng loại
    // "fixture không mang hình dạng dữ liệu thật".
    state: "ACTIVE",
    ...extra,
  };
}

beforeEach(() => {
  h.findMany.mockReset();
  h.upsert.mockReset();
  h.update.mockReset();
  h.broadcastMessages.mockClear();
  h.outboxCreateMany.mockClear();
});

describe("ghiThongBaoNhanSu", () => {
  it("chưa có bản ghi ⇒ tạo + rung cho đúng người đó", async () => {
    h.findMany.mockResolvedValue([dongCu("u2")]); // u2 đã có, u1 chưa
    const kq = await ghiThongBaoNhanSu(THAM_SO);
    expect(h.upsert).toHaveBeenCalledTimes(1);
    expect(h.upsert.mock.calls[0][0].where.userId_dedupeKey.userId).toBe("u1");
    expect(h.update).not.toHaveBeenCalled();
    expect(kq).toEqual({ soNguoi: 2, canRung: ["u1"] });
  });

  it("bản ghi y nguyên ⇒ KHÔNG ghi, KHÔNG rung (đây là đường cron lặp)", async () => {
    h.findMany.mockResolvedValue([dongCu("u1"), dongCu("u2")]);
    const kq = await ghiThongBaoNhanSu(THAM_SO);
    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
    expect(kq.canRung).toEqual([]);
  });

  it("nội dung đổi nhưng đang chưa đọc ⇒ ghi lại, không rung (badge không đổi số)", async () => {
    h.findMany.mockResolvedValue([dongCu("u1", { body: "cũ" })]);
    const kq = await ghiThongBaoNhanSu({ ...THAM_SO, userIds: ["u1"] });
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.update.mock.calls[0][0].data.readAt).toBeUndefined();
    expect(kq.canRung).toEqual([]);
  });

  it("`reopen` trên bản đã đọc ⇒ kéo về chưa đọc + rung", async () => {
    h.findMany.mockResolvedValue([dongCu("u1", { readAt: new Date("2026-09-01") })]);
    const kq = await ghiThongBaoNhanSu({ ...THAM_SO, userIds: ["u1"], reopen: true });
    expect(h.update.mock.calls[0][0].data.readAt).toBeNull();
    expect(kq.canRung).toEqual(["u1"]);
  });

  it("`reopen` trên bản chưa đọc, nội dung y nguyên ⇒ không làm gì", async () => {
    h.findMany.mockResolvedValue([dongCu("u1")]);
    const kq = await ghiThongBaoNhanSu({ ...THAM_SO, userIds: ["u1"], reopen: true });
    expect(h.update).not.toHaveBeenCalled();
    expect(kq.canRung).toEqual([]);
  });

  it("lọc trùng + rỗng trong danh sách người nhận", async () => {
    h.findMany.mockResolvedValue([]);
    const kq = await ghiThongBaoNhanSu({ ...THAM_SO, userIds: ["u1", "", "u1"] });
    expect(kq.soNguoi).toBe(1);
    expect(h.upsert).toHaveBeenCalledTimes(1);
  });
});

describe("notifyStaff", () => {
  it("chỉ broadcast tới người cần rung; không ai cần thì KHÔNG gọi Realtime", async () => {
    h.findMany.mockResolvedValue([dongCu("u1"), dongCu("u2")]);
    expect(await notifyStaff(THAM_SO)).toBe(2);
    expect(h.broadcastMessages).not.toHaveBeenCalled();

    h.findMany.mockResolvedValue([dongCu("u2")]);
    await notifyStaff(THAM_SO);
    expect(h.broadcastMessages).toHaveBeenCalledTimes(1);
    const msgs = (h.broadcastMessages.mock.calls as unknown as Array<[Array<{ topic: string; event: string }>]>)[0][0];
    expect(msgs).toEqual([expect.objectContaining({ topic: "user:u1", event: "notification.bumped" })]);
  });
});

// ── Điểm móc Web Push (US-14b Đợt 4) ─────────────────────────────────────────────────────
//
// Cùng bộ dữ liệu với các ca trên là CÓ CHỦ ĐÍCH: `dedupeKey` ở đây là `sla:` — đúng loại
// NGOÀI allowlist — nên các ca này cũng chứng minh luôn rằng cổng lọc chạy ở đường ghi.
describe("[PUSH-D4-T28] notifyStaff ghi outbox theo canRung", () => {
  it("bám canRung, KHÔNG bám userIds: 2 người nhận nhưng chỉ 1 người có mục mới", async () => {
    // Bám `userIds` là đẻ lại đúng bão 05/09 mà khối chú thích ở `ghiThongBaoNhanSu` vừa vá,
    // với hệ quả nặng hơn: mỗi dòng ở đây là một lần rung điện thoại, không chỉ một POST.
    h.findMany.mockResolvedValue([dongCu("u2")]); // u2 y nguyên, u1 chưa có
    await notifyStaff(THAM_SO);
    const data = (h.outboxCreateMany.mock.calls[0]?.[0].data ?? []) as Record<string, unknown>[];
    expect(data.map((d) => d.userId)).toEqual(["u1"]);
  });

  it("không ai cần rung ⇒ KHÔNG ghi dòng outbox nào", async () => {
    h.findMany.mockResolvedValue([dongCu("u1"), dongCu("u2")]);
    await notifyStaff(THAM_SO);
    expect(h.outboxCreateMany).not.toHaveBeenCalled();
  });

  it("loại KHÔNG được bật đẩy ghi thẳng SKIPPED — có vết, không gửi", async () => {
    h.findMany.mockResolvedValue([]);
    await notifyStaff(THAM_SO);
    const data = (h.outboxCreateMany.mock.calls[0]?.[0].data ?? []) as Record<string, unknown>[];
    expect(data).toHaveLength(2);
    expect(data.every((d) => d.status === "SKIPPED")).toBe(true);
  });

  it("lead.moi: ghi PENDING", async () => {
    h.findMany.mockResolvedValue([]);
    await notifyStaff({ ...THAM_SO, userIds: ["u1"], dedupeKey: "lead.moi:lead_9" });
    const data = (h.outboxCreateMany.mock.calls[0]?.[0].data ?? []) as Record<string, unknown>[];
    expect(data[0]).toMatchObject({ userId: "u1", dedupeKey: "lead.moi:lead_9", status: "PENDING" });
  });

  it("ghi outbox chạy SAU khi chuông đã ghi xong", async () => {
    // Thứ tự này là một lựa chọn có ý thức: chết giữa hai bước thì mất một push nhưng giữ
    // được thông báo. Đảo lại là đẩy push cho một mục chưa chắc tồn tại.
    const thuTu: string[] = [];
    h.findMany.mockResolvedValue([]);
    h.upsert.mockImplementation(async () => {
      thuTu.push("upsert");
      return {};
    });
    h.outboxCreateMany.mockImplementation(async () => {
      thuTu.push("outbox");
      return { count: 1 };
    });
    await notifyStaff(THAM_SO);
    expect(thuTu.indexOf("outbox")).toBeGreaterThan(thuTu.lastIndexOf("upsert"));
  });

  it("outbox hỏng KHÔNG làm hỏng lượt ghi thông báo", async () => {
    h.findMany.mockResolvedValue([]);
    h.outboxCreateMany.mockRejectedValue(new Error("P2021 table does not exist"));
    await expect(notifyStaff(THAM_SO)).resolves.toBe(2);
  });
});

describe("[PUSH-D4-T29] ghiThongBaoNhanSu KHÔNG ghi outbox", () => {
  it("cron quét hàng loạt (sla-check) đi cửa này ⇒ không dòng push nào", async () => {
    // Ranh giới giữa hai hàm là cố ý: `lib/crm/sla.ts` đi qua `ghiThongBaoNhanSu` CHÍNH VÌ nó
    // không muốn rung, và nó chạm ~1.800 vi phạm mỗi lượt — đúng nguồn đã thổi Supabase vượt
    // trần egress ngày 05/09.
    h.findMany.mockResolvedValue([]);
    await ghiThongBaoNhanSu(THAM_SO);
    expect(h.outboxCreateMany).not.toHaveBeenCalled();
  });
});
