// Engine gửi Web Push — phủ mọi nhánh mã lỗi và mọi cổng bỏ qua.
//
// KHÔNG chạm Postgres và KHÔNG mở socket nào: `@/lib/db` + `getSetting` mock, còn hàm gửi được
// TIÊM qua tham số `gui`.
//
// ⚠️ `web-push` KHÔNG bị mock. Cố ý: engine phân loại lỗi bằng `err instanceof WebPushError`, nên
// test phải ném LỚP THẬT. Một lớp tự chế cùng tên sẽ làm mọi lỗi rơi vào nhánh "lỗi lạ" (đọc
// `statusCode` = undefined ⇒ THU_LAI) và cả ma trận 410/400/403 xanh giả trong khi đường thật hỏng.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebPushError } from "web-push";

const h = vi.hoisted(() => {
  const goiUpdateMany: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  const goiOutboxUpdate: { where: { id: string }; data: Record<string, unknown> }[] = [];
  const goiSubUpdate: { where: { id: string }; data: Record<string, unknown> }[] = [];
  /** Thứ tự các câu ghi, để khẳng định được "ghi sổ TRƯỚC khi cập nhật thiết bị". */
  const thuTu: string[] = [];

  const trangThai = {
    reapCount: 0,
    claimCount: 1,
    purgeCount: 0,
    rows: [] as Record<string, unknown>[],
    chuong: null as Record<string, unknown> | null,
    thietBi: [] as Record<string, unknown>[],
    /** Giá trị `nextAttemptAt` THẬT trong DB lúc giành chỗ (khác ảnh chụp lúc quét). */
    hanThatTrongDb: null as Date | null,
  };

  const outboxFindMany = vi.fn(async (_a: unknown) => trangThai.rows);
  const outboxUpdateMany = vi.fn(
    async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      goiUpdateMany.push(a);
      // Reaper và giành-chỗ dùng chung `updateMany`; phân biệt bằng chính điều kiện lọc.
      if (a.where.status === "SENDING") return { count: trangThai.reapCount };

      // Mô phỏng Postgres cho câu GIÀNH CHỖ: dòng trong DB có thể đã đổi kể từ lúc quét (một
      // lượt cron khác vừa xử xong và đẩy `nextAttemptAt` ra tương lai). `hanThatTrongDb` là
      // giá trị THẬT ở thời điểm giành; điều kiện `nextAttemptAt: { lte: now }` phải lọc nó ra.
      const dieuKienHan = a.where.nextAttemptAt as { lte?: Date } | undefined;
      if (trangThai.hanThatTrongDb) {
        if (!dieuKienHan?.lte) return { count: trangThai.claimCount }; // câu giành KHÔNG hỏi hạn
        if (trangThai.hanThatTrongDb.getTime() > dieuKienHan.lte.getTime()) return { count: 0 };
      }
      return { count: trangThai.claimCount };
    },
  );
  const outboxUpdate = vi.fn(async (a: { where: { id: string }; data: Record<string, unknown> }) => {
    goiOutboxUpdate.push(a);
    thuTu.push("status" in a.data ? "outbox:chot" : "outbox:so");
    return {};
  });
  const outboxDeleteMany = vi.fn(async (_a: unknown) => ({ count: trangThai.purgeCount }));
  const notiFindUnique = vi.fn(async (_a: unknown) => trangThai.chuong);
  const subFindMany = vi.fn(async (_a: unknown) => trangThai.thietBi);
  const subUpdate = vi.fn(async (a: { where: { id: string }; data: Record<string, unknown> }) => {
    goiSubUpdate.push(a);
    thuTu.push("sub");
    return {};
  });

  const getSetting = vi.fn(async (_k: string) => true as unknown);
  /**
   * 13/09 — danh sách loại được đẩy nay đọc từ `push.tienToDuocDay` qua `getGlobalSetting`.
   * Mặc định của harness = đúng danh sách mặc định của hệ, để mọi ca cũ giữ nguyên nghĩa.
   */
  const getGlobalSetting = vi.fn(async (_k: string) => ["lead.moi:"] as unknown);

  return {
    trangThai,
    goiUpdateMany,
    goiOutboxUpdate,
    goiSubUpdate,
    thuTu,
    outboxFindMany,
    outboxUpdateMany,
    outboxUpdate,
    outboxDeleteMany,
    notiFindUnique,
    subFindMany,
    subUpdate,
    getSetting,
    getGlobalSetting,
    mockDb: {
      webPushOutbox: {
        findMany: outboxFindMany,
        updateMany: outboxUpdateMany,
        update: outboxUpdate,
        deleteMany: outboxDeleteMany,
      },
      staffNotification: { findUnique: notiFindUnique },
      webPushSubscription: { findMany: subFindMany, update: subUpdate },
    },
  };
});

vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/settings/service", () => ({ getSetting: h.getSetting }));
vi.mock("@/lib/settings/read-global", () => ({ getGlobalSetting: h.getGlobalSetting }));

import { backoffMs } from "./ket-qua";
import { LY_DO_NGOAI_DANH_SACH } from "./cau-hinh-allowlist";
import { chayLuotGuiPush, type HamGui } from "./engine";
import { taoCapKhoaVapid } from "./vapid";

const CAP = taoCapKhoaVapid();
/** Cặp khoá THỨ HAI — để dựng ca "khoá riêng mới ghép khoá công khai cũ". */
const CAP_KHAC = taoCapKhoaVapid();
const NOW = new Date("2026-09-08T10:00:00.000Z");
const EP1 = "https://fcm.googleapis.com/wp/may-dien-thoai-cua-sale";
const EP2 = "https://updates.push.services.mozilla.com/wp/may-ban-cua-sale";

function dongOutbox(x: Partial<Record<string, unknown>> = {}) {
  return {
    id: "ob_1",
    userId: "usr_sale",
    dedupeKey: "lead.moi:lead_1",
    attempts: 0,
    maxAttempts: 5,
    expiresAt: new Date("2026-09-08T16:00:00.000Z"),
    resultJson: null,
    ...x,
  };
}

function chuongThat(x: Partial<Record<string, unknown>> = {}) {
  return {
    title: "Bạn có lead mới",
    body: "Chị Lan — Cơ sở 1",
    href: "/leads/lead_1",
    // Cột NOT NULL có `@default("ACTIVE")` trên DB thật — fixture thiếu nó là code coi mọi
    // chuông như đã bị thu hồi, và mọi ca gửi sẽ xanh giả bằng nhánh SKIPPED.
    state: "ACTIVE",
    expiresAt: null,
    ...x,
  };
}

function thietBi(id: string, endpoint: string, origin = "https://admin.satarobo.vn") {
  return { id, endpoint, p256dh: "p256dh-gia", auth: "auth-gia", origin };
}

/** Lỗi ĐÚNG hình dạng gói `web-push` sinh ra: thông điệp là HẰNG, khoá header viết THƯỜNG. */
function loiHttp(statusCode: number, headers: Record<string, string> = {}, body = "") {
  return new WebPushError(
    "Received unexpected response code",
    statusCode,
    headers,
    body,
    "https://fcm.googleapis.com/wp/abc",
  );
}

/** Hàm gửi giả: tra kết quả theo endpoint. Giá trị là mã HTTP, hoặc một lỗi để ném. */
function guiGia(theo: Record<string, number | Error>): HamGui & { soLan: () => number } {
  let dem = 0;
  const f: HamGui = async (sub) => {
    dem++;
    const r = theo[sub.endpoint];
    // Fixture thiếu endpoint là LỖI CỦA TEST, không phải một ca nghiệp vụ — ném ra để nó lộ
    // ngay thay vì lặng lẽ đếm thành một cú gửi hỏng.
    if (r === undefined) throw new Error(`fixture thiếu endpoint ${sub.endpoint}`);
    if (r instanceof Error) throw r;
    return { statusCode: r };
  };
  return Object.assign(f, { soLan: () => dem });
}

function chay(gui: HamGui, opts: { now?: Date; nganSachMs?: number } = {}) {
  return chayLuotGuiPush({ now: opts.now ?? NOW, gui, nganSachMs: opts.nganSachMs });
}

/** Bản ghi `update` cuối cùng lên dòng outbox. */
function chotOutbox(): Record<string, unknown> {
  const cuoi = h.goiOutboxUpdate.at(-1);
  if (!cuoi) throw new Error("chưa lần nào update dòng outbox");
  return cuoi.data;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.goiUpdateMany.length = 0;
  h.goiOutboxUpdate.length = 0;
  h.goiSubUpdate.length = 0;
  h.thuTu.length = 0;
  h.trangThai.reapCount = 0;
  h.trangThai.claimCount = 1;
  h.trangThai.purgeCount = 0;
  h.trangThai.rows = [dongOutbox()];
  h.trangThai.chuong = chuongThat();
  h.trangThai.thietBi = [thietBi("sub_1", EP1)];
  h.trangThai.hanThatTrongDb = null;
  h.getSetting.mockResolvedValue(true);
  h.getGlobalSetting.mockResolvedValue(["lead.moi:"]);
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", CAP.publicKey);
  vi.stubEnv("VAPID_PRIVATE_KEY", CAP.privateKey);
  vi.stubEnv("VAPID_SUBJECT", "mailto:it@satarobo.vn");
});

// ── Hai cổng đầu lượt ────────────────────────────────────────────────────────────────────

describe("[PUSH-D4-T11] công tắc push.webPushEnabled", () => {
  it("TẮT ⇒ thoát sạch: không đọc bảng nào, không đánh dấu dòng nào, không gửi gì", () => {
    // Đây là cổng duy nhất canh việc engine có THẬT SỰ đọc key hay không — không có test CI
    // sẵn nào khoá `SETTING_KEYS`. Gỡ đường đọc thì chỉ ca này đỏ.
    h.getSetting.mockResolvedValue(false);
    const g = guiGia({});
    return chay(g).then((kq) => {
      expect(kq.skipped).toBe(true);
      expect(kq.reason).toBe("DISABLED");
      expect(h.outboxFindMany).not.toHaveBeenCalled();
      expect(h.outboxUpdateMany).not.toHaveBeenCalled();
      expect(h.outboxDeleteMany).not.toHaveBeenCalled();
      expect(g.soLan()).toBe(0);
    });
  });

  it("đọc cấu hình LỖI ⇒ coi như TẮT (fail-closed), không phải như bật", async () => {
    // `getSetting` NÉM khi khoá không có trong registry. "Không đọc được cấu hình" tuyệt đối
    // không được hiểu thành "cứ gửi đi".
    h.getSetting.mockRejectedValue(new Error("Unknown setting key"));
    const kq = await chay(guiGia({}));
    expect(kq.reason).toBe("DISABLED");
  });

  it("đọc đúng khoá push.webPushEnabled, KHÔNG truyền orgUnitId", async () => {
    // Key khai `centerOverridable: false` — kênh bật/tắt toàn hệ. Truyền orgUnitId ở đây là
    // mở đường cho một cơ sở tự tắt mà Hội sở không biết.
    await chay(guiGia({ [EP1]: 201 }));
    expect(h.getSetting).toHaveBeenCalledWith("push.webPushEnabled");
  });
});

describe("[PUSH-D4-T12] cổng khoá VAPID", () => {
  it("thiếu khoá riêng ⇒ bỏ CẢ LƯỢT, không dòng nào bị tiêu attempt", async () => {
    // Không có cổng này thì một lần dán nhầm env sẽ khiến mỗi dòng ăn một lỗi 400/403, cạn
    // `maxAttempts` và chuyển DEAD — tức một thao tác vận hành sai ĐỐT SẠCH hàng đợi, không
    // có đường nào lấy lại.
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const kq = await chay(guiGia({}));
    expect(kq.skipped).toBe(true);
    expect(kq.reason).toBe("NO_VAPID");
    expect(h.outboxUpdateMany).not.toHaveBeenCalled();
  });

  it("khoá công khai sai hình dạng ⇒ bỏ cả lượt", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "khong-phai-khoa");
    expect((await chay(guiGia({}))).reason).toBe("NO_VAPID");
  });

  it("VAPID_SUBJECT không phải mailto:/https: ⇒ bỏ cả lượt", async () => {
    vi.stubEnv("VAPID_SUBJECT", "it@satarobo.vn");
    expect((await chay(guiGia({}))).reason).toBe("NO_VAPID");
  });

  it("khoá được truyền theo TỪNG lượt gửi, không qua biến toàn cục", async () => {
    // `setVapidDetails` ghi vào biến module-scope của gói; lambda Vercel dùng lại tiến trình ấm
    // nên thứ tự nạp module trở thành một điều kiện ngầm.
    const goi: unknown[] = [];
    const g: HamGui = async (_s, _p, o) => {
      goi.push(o);
      return { statusCode: 201 };
    };
    await chay(g);
    expect(goi[0]).toMatchObject({
      vapidDetails: { subject: "mailto:it@satarobo.vn", publicKey: CAP.publicKey },
      urgency: "high",
    });
  });
});

// ── Ma trận mã trả về ────────────────────────────────────────────────────────────────────

describe("[PUSH-D4-T13] gửi thành công", () => {
  it("201 ⇒ outbox SENT + có sentAt + thiết bị ghi lastSuccessAt và reset failureCount", async () => {
    const kq = await chay(guiGia({ [EP1]: 201 }));
    expect(kq.sent).toBe(1);
    const d = chotOutbox();
    expect(d.status).toBe("SENT");
    expect(d.sentAt).toEqual(NOW);
    expect(d.claimedAt).toBeNull();
    expect(d.lastError).toBeNull();
    expect(h.goiSubUpdate[0]?.data).toMatchObject({
      lastSuccessAt: NOW,
      failureCount: 0,
      lastErrorCode: null,
    });
  });

  it("resultJson ghi theo TỪNG máy, KHÔNG chứa endpoint trần", async () => {
    // `resultJson` nằm trong một bảng mà ai đọc được cũng đọc được; endpoint là khả năng gửi
    // push vào máy nhân viên, nên nó phải ở dạng băm + nhãn cắt.
    await chay(guiGia({ [EP1]: 201 }));
    const json = JSON.stringify(chotOutbox().resultJson);
    expect(json).not.toContain(EP1);
    expect(json).toContain("fcm.googleapis.com");
    expect(json).toContain("THANH_CONG");
  });
});

describe("[PUSH-D4-T14] endpoint chết — 404 / 410", () => {
  it("410 ⇒ thiết bị sang EXPIRED, dòng DEAD (không máy nào nhận được)", async () => {
    const kq = await chay(
      guiGia({ [EP1]: loiHttp(410, {}, "push subscription has unsubscribed or expired") }),
    );
    expect(kq.dead).toBe(1);
    expect(chotOutbox().status).toBe("DEAD");
    expect(h.goiSubUpdate[0]?.data).toMatchObject({ status: "EXPIRED", lastErrorCode: 410 });
  });

  it("404 xử y hệt 410", async () => {
    await chay(guiGia({ [EP1]: loiHttp(404) }));
    expect(h.goiSubUpdate[0]?.data).toMatchObject({ status: "EXPIRED" });
  });

  it("thiết bị chết KHÔNG được hẹn thử lại", async () => {
    await chay(guiGia({ [EP1]: loiHttp(410) }));
    expect(chotOutbox().nextAttemptAt).toBeUndefined();
  });
});

describe("[PUSH-D4-T15] 429 — tôn trọng Retry-After", () => {
  it("có Retry-After (giây) ⇒ FAILED, hẹn đúng mốc push service xin", async () => {
    const kq = await chay(guiGia({ [EP1]: loiHttp(429, { "retry-after": "600" }) }));
    expect(kq.failed).toBe(1);
    const d = chotOutbox();
    expect(d.status).toBe("FAILED");
    expect((d.nextAttemptAt as Date).getTime()).toBe(NOW.getTime() + 600_000);
  });

  it("Retry-After dạng HTTP-date cũng đọc được", async () => {
    const moc = new Date(NOW.getTime() + 300_000).toUTCString();
    await chay(guiGia({ [EP1]: loiHttp(429, { "retry-after": moc }) }));
    expect((chotOutbox().nextAttemptAt as Date).getTime()).toBe(NOW.getTime() + 300_000);
  });

  it("KHÔNG có Retry-After ⇒ rơi về backoff, tuyệt đối không Invalid Date", async () => {
    // `Number(undefined)` = NaN và `new Date(now + NaN)` là Invalid Date — Prisma sẽ ném ở tận
    // đường ghi, cách xa chỗ sinh lỗi.
    await chay(guiGia({ [EP1]: loiHttp(429) }));
    const t = (chotOutbox().nextAttemptAt as Date).getTime();
    expect(Number.isNaN(t)).toBe(false);
    expect(t).toBe(NOW.getTime() + backoffMs(1));
  });

  it("thiết bị KHÔNG bị gỡ vì 429", async () => {
    await chay(guiGia({ [EP1]: loiHttp(429) }));
    expect(h.goiSubUpdate[0]?.data).not.toHaveProperty("status");
    expect(h.goiSubUpdate[0]?.data).toMatchObject({ lastErrorCode: 429 });
  });
});

describe("[PUSH-D4-T16] 5xx và lỗi mạng ⇒ thử lại", () => {
  it("503 ⇒ FAILED + backoff nhân đôi theo số lần đã thử", async () => {
    h.trangThai.rows = [dongOutbox({ attempts: 2 })];
    await chay(guiGia({ [EP1]: loiHttp(503) }));
    const d = chotOutbox();
    expect(d.status).toBe("FAILED");
    expect((d.nextAttemptAt as Date).getTime()).toBe(NOW.getTime() + backoffMs(3));
  });

  it("đứt mạng (Error THƯỜNG, không có statusCode) ⇒ vẫn thử lại, KHÔNG gỡ thiết bị", async () => {
    // Không phải mọi thất bại đều là `WebPushError`: lỗi mạng và socket timeout reject một
    // `Error` thường. Đọc `err.statusCode` mà không guard là so `undefined` với số rồi rơi vào
    // nhánh sai — và nhánh sai ở đây có nghĩa là gỡ mất thiết bị tốt vì mạng chập 5 phút.
    const loi = Object.assign(new Error("connect ECONNRESET"), { code: "ECONNRESET" });
    const kq = await chay(guiGia({ [EP1]: loi }));
    expect(kq.failed).toBe(1);
    expect(chotOutbox().status).toBe("FAILED");
    expect(h.goiSubUpdate[0]?.data).not.toHaveProperty("status");
  });

  it("socket timeout ⇒ thử lại", async () => {
    await chay(guiGia({ [EP1]: new Error("Socket timeout") }));
    expect(chotOutbox().status).toBe("FAILED");
  });

  it("cạn maxAttempts mà vẫn 5xx ⇒ DEAD", async () => {
    h.trangThai.rows = [dongOutbox({ attempts: 4, maxAttempts: 5 })];
    const kq = await chay(guiGia({ [EP1]: loiHttp(500) }));
    expect(kq.dead).toBe(1);
    expect(chotOutbox().status).toBe("DEAD");
  });
});

describe("[PUSH-D4-T17] 4xx khác ⇒ chết, nhưng KHÔNG gỡ thiết bị", () => {
  it("400 ⇒ DEAD ngay lượt đầu, không thử lại", async () => {
    await chay(guiGia({ [EP1]: loiHttp(400) }));
    expect(chotOutbox().status).toBe("DEAD");
  });

  it("403 VapidPkHashMismatch ⇒ DEAD nhưng thiết bị GIỮ NGUYÊN ACTIVE", async () => {
    // Mã này gần như luôn là "khoá server vừa xoay", máy người dùng vẫn tốt. Gỡ hàng loạt lúc
    // đó là bắt cả công ty bật lại thông báo bằng tay, trong khi việc phải làm là dán lại khoá.
    // Cột `vapidKeyId` sinh ra để phân biệt đúng ca này và chỉ có ích nếu ta không xoá bằng chứng.
    await chay(guiGia({ [EP1]: loiHttp(403, {}, "VapidPkHashMismatch") }));
    expect(chotOutbox().status).toBe("DEAD");
    expect(h.goiSubUpdate[0]?.data).not.toHaveProperty("status");
    expect(h.goiSubUpdate[0]?.data).toMatchObject({ lastErrorCode: 403 });
  });

  it("lastError giữ LÝ DO của push service, không giữ thông điệp hằng của gói", async () => {
    // `err.message` LUÔN là "Received unexpected response code" cho mọi mã 4xx/5xx — ghi nó vào
    // sổ là ghi một hằng số vô nghĩa. Lý do thật nằm ở `body`.
    await chay(guiGia({ [EP1]: loiHttp(403, {}, "VapidPkHashMismatch") }));
    const d = chotOutbox();
    expect(String(d.lastError)).toContain("VapidPkHashMismatch");
    expect(String(d.lastError)).not.toContain("Received unexpected response code");
    expect(d.lastErrorCode).toBe(403);
  });

  it("thông điệp lỗi KHÔNG chứa endpoint", async () => {
    // Cả 6 thuộc tính của `WebPushError` là own-enumerable, gồm `endpoint` — một
    // `JSON.stringify(err)` vô tình là rò nguyên khả năng gửi vào sổ.
    await chay(guiGia({ [EP1]: loiHttp(400, {}, "bad request") }));
    expect(String(chotOutbox().lastError)).not.toContain("fcm.googleapis.com/wp/abc");
  });
});

// ── Nhiều thiết bị ───────────────────────────────────────────────────────────────────────

describe("[PUSH-D4-T18] một người nhiều máy", () => {
  beforeEach(() => {
    h.trangThai.thietBi = [thietBi("sub_1", EP1), thietBi("sub_2", EP2)];
  });

  it("máy này 201, máy kia 410 ⇒ dòng SENT, và CHỈ máy 410 bị gỡ", async () => {
    // Người đó ĐÃ được báo. Đánh DEAD là nói dối trong sổ và kéo người trực đi xử lý một việc
    // không tồn tại.
    const kq = await chay(guiGia({ [EP1]: 201, [EP2]: loiHttp(410) }));
    expect(kq.sent).toBe(1);
    expect(chotOutbox().status).toBe("SENT");
    const gỡ = h.goiSubUpdate.filter((g) => "status" in g.data);
    expect(gỡ.map((g) => g.where.id)).toEqual(["sub_2"]);
  });

  it("máy này 201, máy kia 503 ⇒ vẫn FAILED để lượt sau gửi nốt máy còn lại", async () => {
    const kq = await chay(guiGia({ [EP1]: 201, [EP2]: loiHttp(503) }));
    expect(kq.failed).toBe(1);
    expect(chotOutbox().status).toBe("FAILED");
  });

  it("MÁY ĐÃ NHẬN KHÔNG BỊ BẮN LẠI Ở LƯỢT SAU", async () => {
    // Ca quan trọng nhất của cả `resultJson`: lượt trước máy EP1 nhận được (201) còn EP2 lỗi
    // 503. Lượt này CHỈ được gọi gửi cho EP2. Thiếu vế này là mỗi lần thử lại người ta lại ăn
    // một thông báo trùng trên máy đã nhận — và cái giá của gửi trùng là họ tắt quyền thông báo
    // ở cấp trình duyệt, mất kênh vĩnh viễn.
    const { bamEndpoint } = await import("./ket-qua");
    h.trangThai.rows = [
      dongOutbox({
        attempts: 1,
        resultJson: {
          [bamEndpoint(EP1)]: {
            may: "fcm.googleapis.com/…sale",
            code: 201,
            loai: "THANH_CONG",
            at: "2026-09-08T09:59:00.000Z",
          },
        },
      }),
    ];
    const goiToi: string[] = [];
    const g: HamGui = async (s) => {
      goiToi.push(s.endpoint);
      return { statusCode: 201 };
    };
    await chay(g);
    expect(goiToi).toEqual([EP2]);
    expect(chotOutbox().status).toBe("SENT");
  });
});

// ── Các cổng bỏ qua ──────────────────────────────────────────────────────────────────────

describe("[PUSH-D4-T19] đọc lại chuông NGAY LÚC GỬI", () => {
  it("chuông đã THU HỒI ⇒ SKIPPED, không gửi cú nào", async () => {
    // Ca có thật, xảy ra trong vài phút: lead chuyển A→B thì `thuHoiChuongLeadCu` đặt chuông
    // của A về REVOKED, nhưng dòng outbox của A vẫn nằm đó. Không đọc lại thì cron nổ "Bạn có
    // lead mới" trên màn hình khoá của A về một lead họ không còn giữ — và push đã nổ thì
    // KHÔNG thu hồi được.
    h.trangThai.chuong = chuongThat({ state: "REVOKED" });
    const g = guiGia({});
    const kq = await chay(g);
    expect(kq.skippedRows).toBe(1);
    expect(g.soLan()).toBe(0);
    expect(chotOutbox().status).toBe("SKIPPED");
  });

  it("chuông không còn tồn tại ⇒ SKIPPED", async () => {
    h.trangThai.chuong = null;
    const g = guiGia({});
    expect((await chay(g)).skippedRows).toBe(1);
    expect(g.soLan()).toBe(0);
  });

  it("chuông đã hết hạn ⇒ SKIPPED", async () => {
    h.trangThai.chuong = chuongThat({ expiresAt: new Date("2026-09-08T09:00:00.000Z") });
    const g = guiGia({});
    expect((await chay(g)).skippedRows).toBe(1);
    expect(g.soLan()).toBe(0);
  });

  it("lỗi khi DỰNG gói tin ⇒ vẫn ghi vào sổ, KHÔNG để thiết bị biến mất im lặng", async () => {
    // Đường thật chạm được: `href` chứa nửa cặp surrogate ⇒ `teacherHref` gọi
    // `encodeURIComponent` và ném `URIError`. Nếu phần dựng gói tin nằm NGOÀI `try` thì promise
    // bị reject, mà một promise reject không mang theo thiết bị nào — máy đó rơi khỏi sổ, và
    // với người chỉ có một máy thì dòng bị chốt `SKIPPED` ("không còn thiết bị nào") thay vì
    // lỗi: mất push, không có vết, không ai đi tìm vì sổ nói mọi thứ bình thường.
    h.trangThai.chuong = chuongThat({ href: "/classes/\uD800" });
    h.trangThai.thietBi = [thietBi("sub_gv", EP1, "https://giaovien.satarobo.vn")];
    const kq = await chay(guiGia({ [EP1]: 201 }));
    expect(kq.skippedRows).toBe(0);
    expect(kq.failed).toBe(1);
    expect(JSON.stringify(chotOutbox().resultJson)).toContain("THU_LAI");
  });

  it("nội dung gửi lấy từ chuông ĐỌC LÚC GỬI, không phải bản chụp lúc ghi", async () => {
    h.trangThai.chuong = chuongThat({ title: "Tiêu đề đã sửa", body: "Nội dung đã sửa" });
    const goi: string[] = [];
    const g: HamGui = async (_s, p) => {
      goi.push(p);
      return { statusCode: 201 };
    };
    await chay(g);
    expect(goi[0]).toContain("Tiêu đề đã sửa");
  });
});

describe("[PUSH-D4-T20] các cổng bỏ qua khác", () => {
  it("dòng quá hạn ⇒ SKIPPED, không đọc chuông, không gửi", async () => {
    // Bật lại kênh sau một đợt tắt KHÔNG được xả tin cũ hàng loạt.
    h.trangThai.rows = [dongOutbox({ expiresAt: new Date("2026-09-08T09:00:00.000Z") })];
    const g = guiGia({});
    const kq = await chay(g);
    expect(kq.skippedRows).toBe(1);
    expect(h.notiFindUnique).not.toHaveBeenCalled();
    expect(g.soLan()).toBe(0);
    expect(String(chotOutbox().lastError)).toContain("Quá hạn");
  });

  it("dòng thuộc loại KHÔNG được bật ⇒ SKIPPED dù trạng thái là PENDING", async () => {
    // Cổng thứ hai, sau cổng ở điểm móc: dòng có thể được ghi trước một lần đổi cấu hình,
    // được ghi lúc điểm móc chưa đọc nổi cấu hình, hoặc bị nhét bằng tay.
    h.trangThai.rows = [dongOutbox({ dedupeKey: "sla:SLA-1:lead_1" })];
    const g = guiGia({});
    expect((await chay(g)).skippedRows).toBe(1);
    expect(g.soLan()).toBe(0);
    expect(chotOutbox().lastError).toBe(LY_DO_NGOAI_DANH_SACH);
  });

  it("bật thêm loại đó trong cấu hình ⇒ CHÍNH dòng ấy được gửi", async () => {
    // Cặp đôi với ca trên: cùng một dòng, chỉ khác danh sách cấu hình, ra hai kết cục ngược
    // nhau. Không có ca này thì ca trên vẫn xanh kể cả khi engine bỏ qua cấu hình và luôn
    // dùng hằng số cũ.
    h.trangThai.rows = [dongOutbox({ dedupeKey: "sla:SLA-1:lead_1" })];
    h.getGlobalSetting.mockResolvedValue(["sla:"]);
    const g = guiGia({ [EP1]: 201 });
    expect((await chay(g)).sent).toBe(1);
    expect(g.soLan()).toBe(1);
  });

  it("danh sách RỖNG ⇒ không gửi gì, kể cả lead.moi:", async () => {
    h.getGlobalSetting.mockResolvedValue([]);
    const g = guiGia({});
    expect((await chay(g)).skippedRows).toBe(1);
    expect(g.soLan()).toBe(0);
  });

  it("⚠️ đọc cấu hình danh sách HỎNG ⇒ THOÁT sạch cả lượt, KHÔNG đụng dòng nào", async () => {
    // Nếu thay vào đó engine chạy tiếp với danh sách rỗng thì mọi dòng PENDING bị chốt
    // SKIPPED — trạng thái không quay lại được — và một cú chập DB xoá sổ toàn bộ hàng chờ.
    // Thoát ra thì lượt sau (một phút nữa) xử lại như chưa có gì xảy ra.
    h.getGlobalSetting.mockRejectedValue(new Error("P1001 không tới được DB"));
    const g = guiGia({});
    const kq = await chay(g);
    expect(kq.skipped).toBe(true);
    expect(kq.reason).toBe("NO_ALLOWLIST");
    expect(g.soLan()).toBe(0);
    // Không dòng nào bị đụng — đây mới là phần quan trọng, `skipped: true` chỉ là nhãn.
    expect(h.goiOutboxUpdate).toHaveLength(0);
    expect(h.outboxFindMany).not.toHaveBeenCalled();
  });

  it("lý do NO_ALLOWLIST phân biệt được với DISABLED", async () => {
    // Gộp hai thứ này làm một là để một sự cố DB nằm im nhiều ngày dưới lớp vỏ "đang tắt".
    h.getSetting.mockResolvedValue(false);
    expect((await chay(guiGia({}))).reason).toBe("DISABLED");
  });

  it("người nhận không còn thiết bị ACTIVE nào ⇒ SKIPPED, KHÔNG phải DEAD", async () => {
    // Họ chỉ là chưa bật thông báo trên máy nào — không có gì hỏng để ai đi xử lý.
    h.trangThai.thietBi = [];
    const kq = await chay(guiGia({}));
    expect(kq.skippedRows).toBe(1);
    expect(chotOutbox().status).toBe("SKIPPED");
  });

  it("máy lỗi ở lượt trước NAY ĐÃ BỊ GỠ ⇒ SKIPPED ngay, không treo thêm 5 lượt", async () => {
    // Sổ giữ cả kết quả lượt trước. Máy A ăn 503 rồi người dùng tự gỡ máy A: lượt này không có
    // gì để gửi, nhưng nếu vẫn đếm dòng THU_LAI cũ thì `chotKetCuc` tưởng "còn máy đáng thử" và
    // giữ dòng ở FAILED thêm ~31 phút rồi chốt DEAD — một việc hỏng KHÔNG CÓ THẬT nằm trong sổ
    // vận hành, và người trực sẽ đi tìm.
    const { bamEndpoint } = await import("./ket-qua");
    h.trangThai.thietBi = [];
    h.trangThai.rows = [
      dongOutbox({
        attempts: 1,
        resultJson: {
          [bamEndpoint(EP1)]: {
            may: "fcm.googleapis.com/…sale",
            code: 503,
            loai: "THU_LAI",
            at: "2026-09-08T09:59:00.000Z",
          },
        },
      }),
    ];
    const kq = await chay(guiGia({}));
    expect(kq.skippedRows).toBe(1);
    expect(kq.failed).toBe(0);
    expect(chotOutbox().status).toBe("SKIPPED");
  });

  it("máy ĐÃ NHẬN ở lượt trước rồi bị gỡ ⇒ vẫn SENT: việc 'đã báo' không mất đi", async () => {
    const { bamEndpoint } = await import("./ket-qua");
    h.trangThai.thietBi = [];
    h.trangThai.rows = [
      dongOutbox({
        attempts: 1,
        resultJson: {
          [bamEndpoint(EP1)]: {
            may: "fcm.googleapis.com/…sale",
            code: 201,
            loai: "THANH_CONG",
            at: "2026-09-08T09:59:00.000Z",
          },
        },
      }),
    ];
    const kq = await chay(guiGia({}));
    expect(kq.sent).toBe(1);
    expect(chotOutbox().status).toBe("SENT");
  });

  it("endpoint không an toàn (IP trần / http) ⇒ KHÔNG gửi, ghi CHẾT", async () => {
    // Cổng SSRF của đường GỬI. Cổng ở đường ghi chỉ chạy lúc đăng ký; engine tự POST vào chuỗi
    // đọc từ DB kèm header VAPID thật rồi ghi mã trả về vào `lastErrorCode` — tức có cả kênh
    // đọc kết quả. Đừng tin cột trong DB.
    h.trangThai.thietBi = [thietBi("sub_x", "http://169.254.169.254/latest/meta-data")];
    const g = guiGia({});
    const kq = await chay(g);
    expect(g.soLan()).toBe(0);
    expect(kq.dead).toBe(1);
    expect(JSON.stringify(chotOutbox().resultJson)).toContain("Endpoint không hợp lệ");
  });
});

// ── Giành chỗ, reaper, dọn ───────────────────────────────────────────────────────────────

describe("[PUSH-D4-T21] giành chỗ chống gửi đôi", () => {
  it("lượt cron khác đã giành trước (count = 0) ⇒ bỏ qua, KHÔNG gửi", async () => {
    h.trangThai.claimCount = 0;
    const g = guiGia({});
    const kq = await chay(g);
    expect(kq.claimed).toBe(0);
    expect(g.soLan()).toBe(0);
    expect(h.goiOutboxUpdate).toHaveLength(0);
  });

  it("lượt CHẬM không giành lại được dòng mà lượt NHANH vừa hẹn giờ", async () => {
    // Ứng viên là một ẢNH CHỤP. Hai lượt cron chồng nhau (chồng được: cron mỗi phút, một lượt
    // chạy tới 45 giây) cùng thấy dòng này ở PENDING. Lượt nhanh xử xong, ăn 429 và đẩy
    // `nextAttemptAt` ra 10 phút nữa. Nếu câu giành chỉ hỏi `status` thì `FAILED` vẫn khớp ⇒
    // lượt chậm giành lại NGAY và bắn tiếp, đúng lúc push service vừa bảo "khoan đã" — tức
    // toàn bộ luật thử-lại bị vô hiệu mỗi khi hai lượt chồng nhau.
    h.trangThai.hanThatTrongDb = new Date(NOW.getTime() + 600_000);
    const g = guiGia({ [EP1]: 201 });
    const kq = await chay(g);
    expect(kq.claimed).toBe(0);
    expect(g.soLan()).toBe(0);
    expect(h.goiOutboxUpdate).toHaveLength(0);
  });

  it("hạn đã tới thì VẪN giành được — bộ lọc không được chặt tay", async () => {
    // Đối chứng dương: thiếu ca này thì một `nextAttemptAt: { lte: <mốc quá khứ> }` viết sai
    // sẽ chặn MỌI dòng, kênh im lặng hoàn toàn, và ca âm ở trên vẫn xanh.
    h.trangThai.hanThatTrongDb = new Date(NOW.getTime() - 60_000);
    const kq = await chay(guiGia({ [EP1]: 201 }));
    expect(kq.claimed).toBe(1);
    expect(kq.sent).toBe(1);
  });

  it("câu giành chỗ đặt status + claimedAt + tăng attempts trong CÙNG một câu", async () => {
    // Tăng `attempts` lúc XONG (như `lib/events/dispatcher.ts`) thì tiến trình chết giữa chừng
    // để dòng độc quay vòng vô hạn: nó không bao giờ tiêu một lượt nào.
    await chay(guiGia({ [EP1]: 201 }));
    const gianh = h.goiUpdateMany.find((g) => "id" in g.where);
    expect(gianh?.data).toEqual({
      status: "SENDING",
      claimedAt: NOW,
      attempts: { increment: 1 },
    });
    expect(gianh?.where).toMatchObject({ status: { in: ["PENDING", "FAILED"] } });
  });
});

describe("[PUSH-D4-T22] reaper đo theo claimedAt", () => {
  it("lọc theo claimedAt, TUYỆT ĐỐI không theo createdAt", async () => {
    // `createdAt` là lúc SINH việc, không phải lúc bắt đầu gửi. Một dòng nằm chờ hơn 5 phút
    // rồi mới được giành sẽ bị reaper kéo về PENDING NGAY TRONG LÚC đang gửi ⇒ lượt sau giành
    // lại ⇒ GỬI ĐÔI. `lib/events/dispatcher.ts` đang mắc đúng lỗi này.
    h.trangThai.reapCount = 2;
    const kq = await chay(guiGia({ [EP1]: 201 }));
    expect(kq.reaped).toBe(2);
    const reap = h.goiUpdateMany.find((g) => g.where.status === "SENDING");
    expect(reap?.where).not.toHaveProperty("createdAt");
    expect(JSON.stringify(reap?.where)).toContain("claimedAt");
    expect(reap?.data).toMatchObject({ status: "PENDING" });
  });

  it("reaper KHÔNG động vào attempts — dòng chết đi chết lại vẫn cạn lượt đúng hạn", async () => {
    await chay(guiGia({ [EP1]: 201 }));
    const reap = h.goiUpdateMany.find((g) => g.where.status === "SENDING");
    expect(reap?.data).not.toHaveProperty("attempts");
  });

  it("dòng SENDING có claimedAt NULL cũng được cứu — nếu không nó kẹt vĩnh viễn", async () => {
    await chay(guiGia({ [EP1]: 201 }));
    const reap = h.goiUpdateMany.find((g) => g.where.status === "SENDING");
    expect(JSON.stringify(reap?.where)).toContain('"claimedAt":null');
  });
});

describe("[PUSH-D4-T24] câu quét ứng viên", () => {
  it("quét ĐÚNG PENDING + FAILED, tới hạn, cũ nhất trước, có trần lô", async () => {
    // Lăng kính đo được: trước ca này KHÔNG assertion nào chạm tham số của `findMany`, nên hạ
    // nó thành `{ in: ["PENDING"] }` vẫn xanh cả bộ — mà hậu quả là mọi dòng `FAILED` (tức mọi
    // dòng đã lỡ một lần thử) thành XÁC SỐNG vĩnh viễn: không ai quét, không ai chốt, và badge
    // vận hành nói mọi thứ bình thường.
    await chay(guiGia({ [EP1]: 201 }));
    const q = h.outboxFindMany.mock.calls[0]?.[0] as {
      where: { status: { in: string[] }; nextAttemptAt: { lte: Date } };
      orderBy: Record<string, string>;
      take: number;
    };
    expect(q.where.status.in.slice().sort()).toEqual(["FAILED", "PENDING"]);
    expect(q.where.nextAttemptAt.lte).toEqual(NOW);
    expect(q.orderBy).toEqual({ nextAttemptAt: "asc" });
    expect(q.take).toBeGreaterThan(0);
  });
});

describe("[PUSH-D4-T25] ngân sách thời gian của một lượt", () => {
  it("hết giờ ⇒ dừng TRƯỚC khi giành, dòng chưa xử còn nguyên PENDING", async () => {
    // Cổng này chưa từng chạy trong bộ test cũ. Bỏ nó thì lô 25 dòng × tối đa 10s/dòng vượt xa
    // `maxDuration = 60`, lambda bị giết GIỮA `xuLyMotDong` — và đó chính là ca làm mất
    // `resultJson` rồi bắn trùng vào máy đã nhận.
    h.trangThai.rows = [dongOutbox({ id: "ob_1" }), dongOutbox({ id: "ob_2" })];
    const g = guiGia({ [EP1]: 201 });
    const kq = await chay(g, { nganSachMs: -1 });
    expect(kq.hetGio).toBe(true);
    expect(kq.claimed).toBe(0);
    expect(g.soLan()).toBe(0);
    // Dừng TRƯỚC câu giành ⇒ không dòng nào bị tiêu attempt.
    expect(h.goiUpdateMany.filter((x) => "id" in x.where)).toHaveLength(0);
  });

  it("còn giờ ⇒ xử hết lô — đối chứng dương", async () => {
    h.trangThai.rows = [dongOutbox({ id: "ob_1" }), dongOutbox({ id: "ob_2" })];
    const kq = await chay(guiGia({ [EP1]: 201 }));
    expect(kq.hetGio).toBe(false);
    expect(kq.claimed).toBe(2);
  });
});

describe("[PUSH-D4-T26] ghi sổ kết quả SỚM, không đợi tới câu chốt", () => {
  it("resultJson được ghi ngay sau khi gửi, TRƯỚC khi cập nhật thiết bị", async () => {
    // Lá chắn duy nhất chống bắn lại vào máy đã nhận nằm trong `resultJson`. Nếu nó chỉ được
    // ghi ở câu chốt cuối hàm thì cửa sổ hở kéo dài suốt `capNhatThietBi` (N câu UPDATE tuần
    // tự) — lambda chạm `maxDuration` trong khoảng đó là XOÁ BẰNG CHỨNG điện thoại vừa rung,
    // reaper kéo dòng về PENDING và lượt sau POST lại vào đúng máy đó.
    await chay(guiGia({ [EP1]: 201 }));
    const dau = h.goiOutboxUpdate[0];
    expect(dau?.data).toHaveProperty("resultJson");
    expect(dau?.data).not.toHaveProperty("status"); // đây là câu GHI SỔ, không phải câu chốt
    expect(h.goiOutboxUpdate).toHaveLength(2); // ghi sổ + chốt
    expect(h.thuTu.indexOf("outbox:so")).toBeLessThan(h.thuTu.indexOf("sub"));
  });

  it("không gửi cú nào (đã bỏ qua ở cổng) ⇒ KHÔNG tốn câu ghi sổ thừa", async () => {
    h.trangThai.chuong = chuongThat({ state: "REVOKED" });
    await chay(guiGia({}));
    expect(h.goiOutboxUpdate).toHaveLength(1);
  });
});

describe("[PUSH-D4-T27] hai nửa cặp khoá VAPID phải KHỚP nhau", () => {
  it("khoá riêng mới ghép khoá công khai cũ ⇒ bỏ cả lượt, không đụng dòng nào", async () => {
    // `VAPID_PRIVATE_KEY` là biến RUNTIME; `NEXT_PUBLIC_VAPID_PUBLIC_KEY` bị Next thay bằng
    // CHUỖI LITERAL lúc BUILD (cho cả bundle server). Người vận hành xoay khoá trên Vercel rồi
    // KHÔNG deploy lại — thao tác trông hợp lý — sẽ có đúng cặp lệch này. Push service trả 403
    // cho MỌI thiết bị, mà 403 là CHẾT ngay lượt đầu ⇒ cả hàng đợi thành DEAD trong vài phút,
    // im lặng. Không có cổng này thì không gì phân biệt nổi ca đó với "kênh hoạt động bình thường".
    vi.stubEnv("VAPID_PRIVATE_KEY", CAP_KHAC.privateKey);
    const g = guiGia({});
    const kq = await chay(g);
    expect(kq.skipped).toBe(true);
    expect(kq.reason).toBe("NO_VAPID");
    expect(h.outboxUpdateMany).not.toHaveBeenCalled();
    expect(g.soLan()).toBe(0);
  });

  it("đúng cặp thì chạy bình thường — đối chứng dương", async () => {
    // Thiếu ca này thì một phép so viết sai (vd luôn trả false) sẽ chặn MỌI lượt, kênh im lặng
    // hoàn toàn, mà ca âm ở trên vẫn xanh.
    const kq = await chay(guiGia({ [EP1]: 201 }));
    expect(kq.skipped).toBe(false);
    expect(kq.sent).toBe(1);
  });
});

describe("[PUSH-D4-T23] dọn dòng cũ", () => {
  it("chỉ xoá DEAD/SKIPPED quá hạn lưu, không đụng dòng đang sống", async () => {
    h.trangThai.purgeCount = 12;
    const kq = await chay(guiGia({ [EP1]: 201 }));
    expect(kq.purged).toBe(12);
    const w = h.outboxDeleteMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(w.where.status).toEqual({ in: ["DEAD", "SKIPPED"] });
    expect(w.where).toHaveProperty("createdAt");
  });

  it("dọn lỗi KHÔNG làm hỏng lượt gửi", async () => {
    h.outboxDeleteMany.mockRejectedValueOnce(new Error("deadlock"));
    const kq = await chay(guiGia({ [EP1]: 201 }));
    expect(kq.sent).toBe(1);
    expect(kq.purged).toBe(0);
  });
});
