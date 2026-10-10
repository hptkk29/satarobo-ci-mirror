// @vitest-environment node
//
// Server Action đăng ký/gỡ thiết bị nhận thông báo — Web Push Đợt 3.
//
// `@vitest-environment node` ở DÒNG ĐẦU là bắt buộc: môi trường mặc định của repo là jsdom
// (`vitest.config.ts`), mà `next-auth` không nạp được ở đó — đúng lý do đã ghi trong
// `lib/chat/_actions.test.ts`.
//
// Repo CHƯA có tiền lệ `vi.mock("next/headers")` (grep toàn bộ test ra 0). File này lập một cái;
// phần logic thật của việc suy origin đã tách sang `lib/push/origin.ts` và được test riêng ở đó,
// nên ở đây chỉ cần một `Headers` giả để chứng minh action KHÔNG lấy origin từ client.

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  const upsert = vi.fn(async (_a: unknown) => ({}));
  const updateMany = vi.fn(async (_a: unknown) => ({ count: 1 }));
  /** Dòng đang có cho endpoint được gửi lên — `null` = máy này chưa ai đăng ký. */
  const findUnique = vi.fn(
    async (_a: unknown) =>
      null as { userId: string; status: string; revokedReason: string | null } | null,
  );
  /** Tiền sử đăng ký của người này trên origin này — cổng 5 luật 1 của đường TỰ ĐỘNG. */
  const findFirst = vi.fn(async (_a: unknown) => null as { id: string } | null);
  const writeAudit = vi.fn(async (_a: Record<string, unknown>) => ({}) as unknown);
  const thuTu: string[] = [];
  const auth = vi.fn(async () => ({
    user: { id: "usr_toi", roles: ["SALES_CSM"], role: "SALES_CSM" },
  }) as unknown);
  const headerMap = new Map<string, string>([
    ["host", "admin.satarobo.vn"],
    ["x-forwarded-proto", "https"],
  ]);
  return {
    upsert,
    updateMany,
    findUnique,
    findFirst,
    writeAudit,
    thuTu,
    auth,
    headerMap,
    mockDb: { webPushSubscription: { upsert, updateMany, findUnique, findFirst } },
  };
});

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => h.headerMap.get(k.toLowerCase()) ?? null }),
}));
vi.mock("next/cache", () => ({
  // 16/09/2026 — bản `main` của `actions.ts` dùng `unstable_cache`; mock thiếu nó là
  // cả tệp test chết ngay lúc nạp, không phải một ca đỏ.
  unstable_cache: <T,>(fn: T) => fn, revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: vi.fn(async () => ({ userId: "usr_toi" })) }));
vi.mock("@/lib/db-scope", () => ({ scopedDb: vi.fn(() => h.mockDb) }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.writeAudit }));

import {
  dangKyThietBiAction,
  huyThietBiAction,
  huyThietBiTheoEndpointAction,
} from "./_push-actions";
import { taoCapKhoaVapid, vapidKeyIdTuKhoa } from "@/lib/push/vapid";

const CAP = taoCapKhoaVapid();
const P256DH = taoCapKhoaVapid().publicKey; // cũng là điểm P-256 65 byte
const AUTH = Buffer.alloc(16, 9).toString("base64url");
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";

function dauVao(ghiDe: Record<string, unknown> = {}) {
  return {
    subscription: { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH }, expirationTime: null },
    userAgent: "Mozilla/5.0 (iPhone)",
    displayMode: "standalone",
    ...ghiDe,
  };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", CAP.publicKey);
  // KHÔNG dùng `mockResolvedValue` cho những mock có ghi nhật ký thứ tự: nó ĐÈ
  // implementation, làm `thuTu` rỗng và mọi khẳng định về thứ tự thành `-1 < -1`.
  h.thuTu.length = 0;
  h.upsert.mockClear().mockImplementation(async () => {
    h.thuTu.push("upsert");
    return {};
  });
  h.updateMany.mockClear().mockImplementation(async () => {
    h.thuTu.push("updateMany");
    return { count: 1 };
  });
  h.findUnique.mockClear().mockImplementation(async () => null);
  // Mặc định: người này ĐÃ có tiền sử trên origin này. Ca nào cần "chưa từng bật" thì tự đặt
  // `mockImplementation(async () => null)` — bỏ mặc định này là mọi ca `tuDong` đỏ vì cổng 5.
  h.findFirst.mockClear().mockImplementation(async () => ({ id: "sub_cu" }));
  h.writeAudit.mockClear().mockImplementation(async () => {
    h.thuTu.push("audit");
    return {};
  });
  h.auth.mockClear().mockResolvedValue({
    user: { id: "usr_toi", roles: ["SALES_CSM"], role: "SALES_CSM" },
  } as unknown as never);
  h.headerMap.set("host", "admin.satarobo.vn");
  h.headerMap.set("x-forwarded-proto", "https");
});

/** Khối `create` của lượt upsert đầu tiên. */
function duLieuGhi() {
  const a = h.upsert.mock.calls[0]?.[0] as
    | { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }
    | undefined;
  if (!a) throw new Error("upsert chưa được gọi lần nào");
  return a;
}

describe("[PUSH-D3-T09] userId · origin · vapidKeyId KHÔNG bao giờ đến từ client", () => {
  it("userId lấy từ PHIÊN, kể cả khi client gửi kèm userId khác", async () => {
    const kq = await dangKyThietBiAction(dauVao({ userId: "usr_ke_tan_cong" }));
    expect(kq.ok).toBe(true);
    const g = duLieuGhi();
    expect(g.create.userId).toBe("usr_toi");
    expect(g.update.userId).toBe("usr_toi");
  });

  it("origin suy từ HEADER, kể cả khi client gửi kèm origin bịa", async () => {
    // Cột `origin` dùng để trả lời "người này bật thông báo ở host nào". Nhận từ client thì nó
    // thành lời kể chứ không còn là số đo.
    h.headerMap.set("host", "giaovien.satarobo.vn");
    const kq = await dangKyThietBiAction(dauVao({ origin: "https://ke-tan-cong.test" }));
    expect(kq.ok).toBe(true);
    expect(duLieuGhi().create.origin).toBe("https://giaovien.satarobo.vn");
  });

  it("vapidKeyId suy từ KHOÁ SERVER đang dùng, không nhận từ client", async () => {
    await dangKyThietBiAction(dauVao({ vapidKeyId: "gia-mao" }));
    expect(duLieuGhi().create.vapidKeyId).toBe(vapidKeyIdTuKhoa(CAP.publicKey));
  });

  it("khoá lạ trong payload bị BỎ, không lọt vào Prisma", async () => {
    // Schema là `z.object` chế độ STRIP — nó bỏ khoá lạ chứ không từ chối. Vì thế đường ghi
    // BẮT BUỘC chỉ dùng `parsed.data`; ghi từ input thô là mọi khoá lạ đi thẳng vào DB.
    await dangKyThietBiAction(dauVao({ status: "ACTIVE", failureCount: 999, id: "gia-mao" }));
    const g = duLieuGhi();
    expect(g.create.id).toBeUndefined();
    expect(g.create.failureCount).toBeUndefined();
    expect(g.update.failureCount).toBe(0); // giá trị của TA, không phải của client
  });
});

describe("[PUSH-D3-T10] upsert theo endpoint", () => {
  it("khoá upsert là endpoint — máy cũ bật lại không đẻ dòng thứ hai", async () => {
    await dangKyThietBiAction(dauVao());
    expect(duLieuGhi().where).toEqual({ endpoint: ENDPOINT });
  });

  it("nhánh update hồi sinh dòng đã gỡ: về ACTIVE, xoá vết hỏng cũ", async () => {
    await dangKyThietBiAction(dauVao());
    const u = duLieuGhi().update;
    expect(u.status).toBe("ACTIVE");
    expect(u.revokedAt).toBeNull();
    expect(u.failureCount).toBe(0);
    expect(u.lastErrorCode).toBeNull();
  });

  it("ghi displayMode và userAgent — cột chẩn đoán cho nhánh iOS", async () => {
    await dangKyThietBiAction(dauVao());
    expect(duLieuGhi().create.displayMode).toBe("standalone");
    expect(duLieuGhi().create.userAgent).toContain("iPhone");
  });
});

describe("[PUSH-D3-T11] từ chối khi không đủ điều kiện — KHÔNG chạm DB", () => {
  it("chưa đăng nhập", async () => {
    h.auth.mockResolvedValue(null as unknown as never);
    const kq = await dangKyThietBiAction(dauVao());
    expect(kq.ok).toBe(false);
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("PHỤ HUYNH không đăng ký được — phạm vi đã chốt là chỉ nhân viên", async () => {
    h.auth.mockResolvedValue({
      user: { id: "usr_ph", roles: ["PARENT"], role: "PARENT" },
    } as unknown as never);
    const kq = await dangKyThietBiAction(dauVao());
    expect(kq.ok).toBe(false);
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("tài khoản KHÔNG có vai nào cũng bị chặn — tách khỏi ca PARENT", async () => {
    h.auth.mockResolvedValue({ user: { id: "usr_trong", roles: [] } } as unknown as never);
    expect((await dangKyThietBiAction(dauVao())).ok).toBe(false);
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("ĐỐI CHỨNG DƯƠNG: GV kiêm phụ huynh VẪN đăng ký được", async () => {
    // Không có ca này thì một `hasStaffRole` viết hỏng thành `return false` vô điều kiện vẫn
    // làm mọi ca âm ở trên XANH — tức cổng siết đến mức không ai dùng được mà test không kêu.
    h.auth.mockResolvedValue({
      user: { id: "usr_gv", roles: ["TEACHER", "PARENT"], role: "TEACHER" },
    } as unknown as never);
    expect((await dangKyThietBiAction(dauVao())).ok).toBe(true);
    expect(h.upsert).toHaveBeenCalledTimes(1);
  });

  it("subscription hỏng → chặn ở Zod, và GHIM đúng cổng nào chặn", async () => {
    // Action có BỐN cổng nối tiếp (phiên → Zod → origin → khoá VAPID) và cả bốn đều trả
    // `{ok:false}` mà không chạm `upsert`. Chỉ khẳng định `ok === false` là ca vẫn XANH khi
    // payload chết ở một cổng KHÁC cổng nó định kiểm.
    const ca: [Record<string, unknown>, string][] = [
      [{ endpoint: "http://vi-du.test/x", keys: { p256dh: P256DH, auth: AUTH } }, "Endpoint"],
      [{ endpoint: "https://127.0.0.1/x", keys: { p256dh: P256DH, auth: AUTH } }, "Endpoint"],
      [{ endpoint: ENDPOINT, keys: { p256dh: "ngan", auth: AUTH } }, "p256dh"],
      [{ endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: "ngan" } }, "auth"],
    ];
    for (const [sub, mong] of ca) {
      const kq = await dangKyThietBiAction(dauVao({ subscription: sub }));
      expect(kq.ok).toBe(false);
      expect(String(kq.error)).toContain(mong);
    }
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("thiếu khoá VAPID trên server → nói thẳng, không ghi một dòng vô dụng", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "");
    const kq = await dangKyThietBiAction(dauVao());
    expect(kq.ok).toBe(false);
    expect(String(kq.error)).toContain("VAPID");
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("không dựng được origin (thiếu host) → dừng, không bịa một origin mặc định", async () => {
    h.headerMap.delete("host");
    const kq = await dangKyThietBiAction(dauVao());
    expect(kq.ok).toBe(false);
    expect(String(kq.error)).toContain("địa chỉ trang");
    expect(h.upsert).not.toHaveBeenCalled();
  });
});

describe("[PUSH-D3-T12] gỡ thiết bị — chốt chống IDOR", () => {
  it("where LUÔN kèm userId của phiên, không chỉ id", async () => {
    // `scopedDb` KHÔNG che đường GHI, và bảng này không có cột đơn vị — nên nếu chỉ lọc theo
    // `id` thì ai biết id là gỡ được thiết bị của người khác.
    const kq = await huyThietBiAction({ id: "sub_1" });
    expect(kq.ok).toBe(true);
    const a = h.updateMany.mock.calls[0]?.[0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(a.where).toEqual({ id: "sub_1", userId: "usr_toi", status: "ACTIVE" });
    expect(a.data.status).toBe("REVOKED");
  });

  it("không gỡ được dòng nào → báo lỗi, không im lặng nhận là xong", async () => {
    h.updateMany.mockResolvedValue({ count: 0 });
    expect((await huyThietBiAction({ id: "cua_nguoi_khac" })).ok).toBe(false);
  });

  it("tắt trên máy này: lọc theo endpoint + userId", async () => {
    const kq = await huyThietBiTheoEndpointAction({ endpoint: ENDPOINT });
    expect(kq.ok).toBe(true);
    const a = h.updateMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(a.where).toEqual({ endpoint: ENDPOINT, userId: "usr_toi", status: "ACTIVE" });
  });

  it("tắt trên máy này mà DB không còn dòng nào → VẪN coi là xong", async () => {
    // Người dùng vừa tắt ở máy này; DB không còn bản ghi tương ứng chính là kết quả họ muốn.
    // Bắt họ đọc một thông báo lỗi là nói sai về kết quả.
    h.updateMany.mockResolvedValue({ count: 0 });
    expect((await huyThietBiTheoEndpointAction({ endpoint: ENDPOINT })).ok).toBe(true);
  });
});

// ── ĐỢT 5: CHUYỂN CHỦ ĐĂNG KÝ (lỗ §13.8b(b)) ─────────────────────────────────────────────
//
// Trước bản vá, `upsert` khoá theo mỗi `endpoint` và nhánh `update` ghi đè `userId` thành người
// đang gọi, KHÔNG vế nào kiểm người gọi có sở hữu endpoint đó. Ai biết endpoint của người khác
// là chiếm được: nạn nhân mất push IM LẶNG, còn máy của họ rung cho việc của kẻ chiếm.

/** Tham số của lần `updateMany` gần nhất. */
function goiUpdateMany(): { where: Record<string, unknown>; data: Record<string, unknown> } {
  const c = h.updateMany.mock.calls.at(-1)?.[0];
  if (!c) throw new Error("updateMany chưa được gọi lần nào");
  return c as { where: Record<string, unknown>; data: Record<string, unknown> };
}

describe("[PUSH-D5-T07] endpoint đang thuộc NGƯỜI KHÁC ⇒ thu hồi rồi mới chuyển chủ", () => {
  beforeEach(() => {
    h.findUnique.mockImplementation(async () => ({ userId: "usr_nguoi_khac", status: "ACTIVE", revokedReason: null }));
  });

  it("THU HỒI TRƯỚC, ghi chủ mới SAU — fail-safe đúng chiều", async () => {
    // Nếu câu ghi chủ mới hỏng giữa đường (mạng, pooler chập) thì trạng thái còn lại phải là
    // "người cũ ĐÃ mất quyền", không phải "người cũ vẫn đang nhận".
    const kq = await dangKyThietBiAction(dauVao());
    expect(kq.ok).toBe(true);
    expect(h.thuTu.indexOf("updateMany")).toBeGreaterThanOrEqual(0);
    expect(h.thuTu.indexOf("updateMany")).toBeLessThan(h.thuTu.indexOf("upsert"));
  });

  it("câu thu hồi lọc theo endpoint + NGƯỜI KHÁC mình, ghi lý do rõ", async () => {
    await dangKyThietBiAction(dauVao());
    const w = goiUpdateMany().where;
    expect(w.endpoint).toBe(ENDPOINT);
    // Vế `userId: { not: me }` là chốt: thiếu nó thì câu này cũng thu hồi chính dòng mình vừa
    // bật ở một tab khác.
    expect(w.userId).toEqual({ not: "usr_toi" });
    const d = goiUpdateMany().data;
    expect(d.status).toBe("REVOKED");
    expect(d.revokedAt).toBeInstanceOf(Date);
    expect(String(d.revokedReason)).toContain("dùng chung");
  });

  it("dòng mới thuộc NGƯỜI ĐANG ĐĂNG NHẬP, lấy từ phiên — không bao giờ từ input", async () => {
    await dangKyThietBiAction({ ...dauVao(), userId: "usr_ke_chiem" } as never);
    const u = h.upsert.mock.calls[0]?.[0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(u.create.userId).toBe("usr_toi");
    expect(u.update.userId).toBe("usr_toi");
  });

  it("ĐỂ LẠI VẾT trong AuditLog: ai → ai, và CHỈ nhãn cắt, KHÔNG endpoint đầy đủ", async () => {
    // Bảng `WebPushSubscription` không giữ được vết (một dòng cho mỗi endpoint — `@unique` toàn
    // cục), nên AuditLog là nơi DUY NHẤT trả lời được "máy nào đổi từ ai sang ai, lúc nào".
    await dangKyThietBiAction(dauVao());
    expect(h.writeAudit).toHaveBeenCalledTimes(1);
    const a = h.writeAudit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(a.action).toBe("TAKEOVER");
    expect(a.oldValues).toMatchObject({ userId: "usr_nguoi_khac" });
    expect(a.newValues).toMatchObject({ userId: "usr_toi" });
    // Endpoint là một KHẢ NĂNG GỬI — không để nguyên ở bất kỳ đâu, kể cả AuditLog.
    expect(JSON.stringify(a)).not.toContain(ENDPOINT);
    expect(String(a.entityId)).toContain("fcm.googleapis.com");
  });

  it("câu thu hồi lọc `status: \"ACTIVE\"` — không ghi đè bằng chứng lần thu hồi TRƯỚC", async () => {
    // Bất biến này do `lib/push/thu-hoi.test.ts` pin ở nửa kia của cùng một đợt. Thiếu nó thì
    // `revokedAt`/`revokedReason` của lần thu hồi trước (vd "Tài khoản bị vô hiệu hoá") bị ghi
    // đè bằng lý do "máy dùng chung" — sổ nói sai về việc đã xảy ra.
    await dangKyThietBiAction(dauVao());
    expect(goiUpdateMany().where.status).toBe("ACTIVE");
  });

  it("dòng cũ đang REVOKED của NGƯỜI KHÁC ⇒ VẪN chuyển chủ và VẪN ghi sổ", async () => {
    // Đây là hình dạng PHỔ BIẾN NHẤT của dòng cũ: `logoutToGate` vừa đặt `REVOKED` khi người
    // trước đăng xuất. Nếu `chuyenChu` bị siết thêm `&& dongCu.status === "ACTIVE"` thì ca này
    // đổi chủ IM LẶNG — không thu hồi, không ghi sổ — và lỗ §13.8b(b) quay lại mà cổng vẫn xanh.
    // (Lăng kính đề xuất đúng phép cấy lỗi đó và bộ test cũ không bắt được.)
    h.findUnique.mockImplementation(async () => ({ userId: "usr_nguoi_khac", status: "REVOKED", revokedReason: "Tắt trên máy này" }));
    const kq = await dangKyThietBiAction(dauVao());
    expect(kq.ok).toBe(true);
    expect(h.writeAudit).toHaveBeenCalledTimes(1);
    expect(h.writeAudit.mock.calls[0]?.[0]).toMatchObject({ action: "TAKEOVER" });
  });

  it("ghi sổ SAU khi đã đổi chủ — sổ không được nói về việc chưa xảy ra", async () => {
    await dangKyThietBiAction(dauVao());
    expect(h.thuTu.indexOf("upsert")).toBeGreaterThanOrEqual(0);
    expect(h.thuTu.indexOf("audit")).toBeGreaterThan(h.thuTu.indexOf("upsert"));
  });

  it("sổ AuditLog hỏng ⇒ thao tác tự phục vụ VẪN thành công", async () => {
    h.writeAudit.mockRejectedValue(new Error("bảng audit đầy"));
    expect((await dangKyThietBiAction(dauVao())).ok).toBe(true);
    expect(h.upsert).toHaveBeenCalledTimes(1);
  });
});

describe("[PUSH-D5-T08] KHÔNG phải chuyển chủ thì không thu hồi, không ghi sổ", () => {
  it("máy chưa ai đăng ký ⇒ chỉ upsert", async () => {
    h.findUnique.mockImplementation(async () => null);
    await dangKyThietBiAction(dauVao());
    expect(h.updateMany).not.toHaveBeenCalled();
    expect(h.writeAudit).not.toHaveBeenCalled();
  });

  it("bật lại trên máy CỦA CHÍNH MÌNH ⇒ không thu hồi, không ghi sổ", async () => {
    // Ca thường gặp nhất (đổi trình duyệt cấp lại cùng endpoint, hoặc bấm bật hai lần). Thu hồi
    // ở đây là tự gỡ thiết bị của mình rồi bật lại — nhiễu sổ, và một nhịp không nhận được gì.
    h.findUnique.mockImplementation(async () => ({ userId: "usr_toi", status: "REVOKED", revokedReason: "Tắt trên máy này" }));
    await dangKyThietBiAction(dauVao());
    expect(h.updateMany).not.toHaveBeenCalled();
    expect(h.writeAudit).not.toHaveBeenCalled();
    expect(h.upsert).toHaveBeenCalledTimes(1);
  });

  it("câu tra dòng cũ KHÔNG lọc theo userId — lọc là mất đúng dòng cần chặn", async () => {
    // Bài học `lib/payments/method-lookup.ts`: câu tra dùng để CHẶN mà bị lọc mất đúng dòng cần
    // chặn thì nó trả null, và cổng đọc null thành "không có gì, cho qua" ⇒ mở toang đúng lúc
    // phải đóng. Ở đây nghĩa là kẻ chiếm sẽ không bao giờ bị phát hiện là đang chiếm.
    await dangKyThietBiAction(dauVao());
    const w = h.findUnique.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(w.where).toEqual({ endpoint: ENDPOINT });
  });
});

describe("[PUSH-D5-T13] huyThietBiTheoEndpointAction phải TRẢ VỀ số dòng đã thu hồi", () => {
  // Hợp đồng này KHÔNG có bộ nào khác canh: `lib/auth/logout-client.test.ts` mock chính action
  // này, nên gỡ `soDong` khỏi giá trị trả về vẫn để bộ đó xanh (đã đo: cấy lỗi ⇒ xanh giả).
  // Mà mất `soDong` là `logoutToGate` KHÔNG BAO GIỜ `unsubscribe()` nữa — im lặng trở thành
  // không-làm-gì, đúng loại hỏng câm mà cả Đợt 5 sinh ra để tránh.
  it("thu hồi được 1 dòng ⇒ { ok: true, soDong: 1 }", async () => {
    h.updateMany.mockImplementation(async () => {
      h.thuTu.push("updateMany");
      return { count: 1 };
    });
    expect(await huyThietBiTheoEndpointAction({ endpoint: ENDPOINT })).toEqual({
      ok: true,
      soDong: 1,
    });
  });

  it("không dòng nào khớp ⇒ VẪN ok:true nhưng soDong: 0 — nơi gọi phải phân biệt được", async () => {
    // `ok: true` khi 0 dòng là hành vi cố ý có từ Đợt 3 (người dùng vừa tắt máy này, DB không
    // còn bản ghi là kết quả họ muốn). Chính vì thế `ok` KHÔNG nói được "endpoint này của tôi".
    h.updateMany.mockImplementation(async () => {
      h.thuTu.push("updateMany");
      return { count: 0 };
    });
    expect(await huyThietBiTheoEndpointAction({ endpoint: ENDPOINT })).toEqual({
      ok: true,
      soDong: 0,
    });
  });
});

describe("[PUSH-D6-T13] CỔNG 5 — hai luật CHỈ áp cho đường TỰ ĐỘNG (`tuDong: true`)", () => {
  it("đường BẤM TAY (không có cờ) KHÔNG bị hai luật này chặn — đó là nơi tạo tiền sử", async () => {
    // Quan trọng nhất về hướng: nếu cổng 5 áp cả cho cú bấm thì người dùng MỚI không bao giờ
    // đăng ký được lần đầu (chưa có tiền sử) — tính năng chết ngay từ đầu.
    h.findFirst.mockImplementation(async () => null);
    const kq = await dangKyThietBiAction(dauVao());
    expect(kq.ok).toBe(true);
    expect(h.findFirst).not.toHaveBeenCalled();
    expect(h.upsert).toHaveBeenCalledTimes(1);
  });

  it("LUẬT 1 — tự động + CHƯA TỪNG bật trên origin này ⇒ TỪ CHỐI, không ghi gì", async () => {
    // Lỗ đã đo: quyền thông báo thuộc về ORIGIN, không thuộc về ai. Máy lễ tân dùng chung —
    // Sale A bấm "Bật" (quyền origin thành `granted` vĩnh viễn) rồi đăng xuất; Sale B đăng nhập
    // và lượt tải trang ĐẦU TIÊN tự ghi danh B. B chưa bao giờ được hỏi, mà từ đó mọi lead của B
    // nổ trên màn hình khoá của cái máy đặt ở sảnh, kèm tên phụ huynh, trước mắt khách đang chờ.
    h.findFirst.mockImplementation(async () => null);
    const kq = await dangKyThietBiAction(dauVao({ tuDong: true }));
    expect(kq.ok).toBe(false);
    expect(String(kq.error)).toContain("Chưa từng bật thông báo");
    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it("LUẬT 1 — tra tiền sử theo (userId CỦA PHIÊN, origin CỦA HEADER), không theo input", async () => {
    await dangKyThietBiAction(dauVao({ tuDong: true, userId: "usr_ke_tan_cong" }));
    const w = (h.findFirst.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where;
    expect(w).toEqual({ userId: "usr_toi", origin: "https://admin.satarobo.vn" });
  });

  it("LUẬT 1 — có tiền sử ⇒ cho ghi (ca chính mà Đợt 6 sinh ra để chữa)", async () => {
    // Cùng người, cùng máy: bật hôm qua → đăng xuất buổi tối (dòng về REVOKED) → hôm sau đăng
    // nhập lại. Tiền sử là chính dòng REVOKED đó, nên luật 1 cho qua.
    const kq = await dangKyThietBiAction(dauVao({ tuDong: true }));
    expect(kq.ok).toBe(true);
    expect(h.upsert).toHaveBeenCalledTimes(1);
  });

  it("LUẬT 2 — tự động KHÔNG hồi sinh dòng bị 'Người dùng tự gỡ' (nút Gỡ từ xa)", async () => {
    // Lỗ đã đo: nút "Gỡ" một thiết bị Ở XA không thể `unsubscribe()` — ta không với tới trình
    // duyệt đó. Trước Đợt 6 việc gỡ từ xa là DỨT ĐIỂM; với đường tự động, lượt tải trang kế tiếp
    // trên đúng máy đó thấy đăng ký cũ còn sống, khoá vẫn khớp, rồi nhánh `update` dọn
    // `revokedAt`/`revokedReason`/`failureCount` ⇒ HỒI SINH ĐÚNG DÒNG VỪA GỠ, và danh sách thiết
    // bị không có gì báo là nó đã quay lại (`createdAt` vẫn là ngày cũ).
    h.findUnique.mockImplementation(async () => ({
      userId: "usr_toi",
      status: "REVOKED",
      revokedReason: "Người dùng tự gỡ",
    }));
    const kq = await dangKyThietBiAction(dauVao({ tuDong: true }));
    expect(kq.ok).toBe(false);
    expect(String(kq.error)).toContain("đã bị gỡ");
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ["Tài khoản đã bị xoá"],
    ["Tài khoản bị vô hiệu hoá"],
    ["Máy dùng chung — người khác đăng nhập và bật thông báo trên máy này"],
  ])("LUẬT 2 — cũng KHÔNG hồi sinh dòng thu hồi vì '%s'", async (lyDo) => {
    // Cả ba đều là một quyết định của CON NGƯỜI (hoặc của lưới bảo vệ), mà máy không được tự lật.
    h.findUnique.mockImplementation(async () => ({
      userId: "usr_toi",
      status: "REVOKED",
      revokedReason: lyDo,
    }));
    expect((await dangKyThietBiAction(dauVao({ tuDong: true }))).ok).toBe(false);
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("LUẬT 2 — CHO hồi sinh dòng thu hồi vì 'Tắt trên máy này' (= vừa đăng xuất)", async () => {
    // Đây là lý do DUY NHẤT được hồi sinh, và là toàn bộ lý do Đợt 6 tồn tại. Nút "Tắt trên máy
    // này" cũng dùng lý do đó nhưng nó còn cắm cờ `da-tat-tay` ở trình duyệt, nên đường tự động
    // không tới được đây — phần còn lại là đăng xuất.
    h.findUnique.mockImplementation(async () => ({
      userId: "usr_toi",
      status: "REVOKED",
      revokedReason: "Tắt trên máy này",
    }));
    const kq = await dangKyThietBiAction(dauVao({ tuDong: true }));
    expect(kq.ok).toBe(true);
    expect(h.upsert).toHaveBeenCalledTimes(1);
  });

  it("LUẬT 2 — dòng đang ACTIVE của CHÍNH MÌNH thì cho ghi bình thường", async () => {
    h.findUnique.mockImplementation(async () => ({
      userId: "usr_toi",
      status: "ACTIVE",
      revokedReason: null,
    }));
    expect((await dangKyThietBiAction(dauVao({ tuDong: true }))).ok).toBe(true);
  });

  it("⚠️ cờ chỉ SIẾT: `tuDong: false` không mở thêm đường nào so với cú bấm", async () => {
    // Vì sao nhận cờ này từ client vẫn an toàn. Kẻ gửi `false` chỉ nhận đúng đường mà nút bấm tay
    // vốn đã có; mọi lưới cũ (`userId` từ phiên, `origin` từ header, ghi sổ khi chuyển chủ) không
    // đổi. Nếu ngày nào cờ này NỚI được điều gì thì lập luận đó sập.
    h.findFirst.mockImplementation(async () => null);
    expect((await dangKyThietBiAction(dauVao({ tuDong: false }))).ok).toBe(true);
    expect(h.findFirst).not.toHaveBeenCalled();
  });
});

describe("[PUSH-D6-T14] KHỚP MỐI: lý do mà đăng xuất GHI phải đúng lý do mà cổng 5 CHO qua", () => {
  it("lấy chuỗi THẬT từ `huyThietBiTheoEndpointAction` rồi nạp lại vào đường tự động ⇒ ok", async () => {
    // Ca này canh một mối nối mà không ca nào khác chạm tới, và nếu nó lệch thì VIỆC 1 thôi hoạt
    // động IM LẶNG: đăng xuất ghi một lý do, cổng 5 LUẬT 2 chờ một lý do khác ⇒ mọi lượt tự đăng
    // ký lại bị từ chối, và triệu chứng duy nhất là "hôm sau tôi không nhận được gì" — đúng cái
    // Đợt 6 sinh ra để chữa. Hai nơi đang dùng CHUNG một hằng, nhưng hằng dùng chung không tự
    // canh được việc ai đó thay một chỗ bằng chuỗi gõ tay (đã cấy lỗi đó và bộ test cũ vẫn xanh).
    //
    // Nên: KHÔNG gõ lại chuỗi ở đây. Đọc nó từ đúng câu ghi của đường đăng xuất.
    await huyThietBiTheoEndpointAction({ endpoint: ENDPOINT });
    const daGhi = h.updateMany.mock.calls.at(-1)?.[0] as { data: { revokedReason: string } };
    const lyDoThat = daGhi.data.revokedReason;
    expect(typeof lyDoThat).toBe("string");
    expect(lyDoThat.length).toBeGreaterThan(0);

    h.upsert.mockClear();
    h.findUnique.mockImplementation(async () => ({
      userId: "usr_toi",
      status: "REVOKED",
      revokedReason: lyDoThat,
    }));
    const kq = await dangKyThietBiAction(dauVao({ tuDong: true }));
    expect(kq.ok).toBe(true);
    expect(h.upsert).toHaveBeenCalledTimes(1);
  });

  it("một lý do KHÁC (dù chỉ khác một chữ) ⇒ cổng 5 vẫn TỪ CHỐI — vế đối chứng", async () => {
    // Vế này chứng minh ca trên không xanh vì cổng 5 cho qua mọi thứ.
    h.findUnique.mockImplementation(async () => ({
      userId: "usr_toi",
      status: "REVOKED",
      revokedReason: "Tắt máy này",
    }));
    expect((await dangKyThietBiAction(dauVao({ tuDong: true }))).ok).toBe(false);
  });
});
