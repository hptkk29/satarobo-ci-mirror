// @vitest-environment node
/**
 * US-16 AC2 — `GET /api/chat/realtime-token` là **cửa thứ hai** vào nội dung chat.
 *
 * Vì sao phải test riêng: cổng chính sách ở `layout.tsx` + 4 page RSC chỉ chặn được đường
 * HTML. Vé realtime cho phép client nghe THẲNG broadcast của nhóm — tức đọc tin MỚI mà
 * không đi qua trang nào. Chặn HTML mà quên chỗ này thì màn "Tôi đã đọc và đồng ý" chỉ là
 * một tấm rèm.
 *
 * Bất biến pin ở đây:
 *  • Tài khoản THUẦN phụ huynh chưa đồng ý → 403 `CHAT_POLICY_REQUIRED`, **không cấp vé**.
 *  • Nhân viên (GV/QLCS/Admin) KHÔNG bị chặn: họ không bao giờ thấy màn chính sách của phụ
 *    huynh, chặn họ ở đây là tắt chat của chính người vận hành. Người vừa là GV vừa là PH
 *    tính là nhân viên (`isParentOnly` = mọi vai đều PARENT).
 *  • Lỗi đọc DB khi tra sổ đồng ý → coi như CHƯA đồng ý (fail-closed). Đây là cổng nội
 *    dung: DB lung lay thì đóng, không mở.
 *  • Thứ tự: rate limit TRƯỚC, cổng chính sách SAU. Client hỏng retry liên tục cũng nằm
 *    trong trần, và 429 thì không tốn một truy vấn nào.
 *
 * `isParentOnly` cố ý KHÔNG mock — dùng bản thật của `lib/auth/permissions`, nếu không thì
 * test chỉ chứng minh chính cái mock của mình.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  // Phải nằm TRONG `vi.hoisted`: `vi.mock` được nâng lên đầu file, biến top-level thường
  // chưa khởi tạo lúc factory chạy (đã ăn đúng `ReferenceError` đó).
  RealtimeTokenError: class RealtimeTokenError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  auth: vi.fn(
    async () =>
      null as {
        user?: { id: string; role?: string; roles?: string[]; tokenVersion?: number };
      } | null,
  ),
  hasAcceptedChatPolicy: vi.fn(async (_userId: string) => false),
  issueSseTicket: vi.fn(async (_u: { id: string; tokenVersion?: number }) => ({
    token: "sse",
    expiresAt: new Date("2026-08-10T03:25:00.000Z"),
  })),
  rateLimit: vi.fn(async (_a: { key: string; max: number; windowMs: number }) => ({
    success: true,
    remaining: 29,
    resetAt: Date.now() + 60_000,
  })),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/chat/policy", () => ({ hasAcceptedChatPolicy: h.hasAcceptedChatPolicy }));
vi.mock("@/lib/chat/realtime-token", () => ({
  issueSseTicket: h.issueSseTicket,
  RealtimeTokenError: h.RealtimeTokenError,
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: h.rateLimit }));

import { GET } from "./route";

const PARENT = { id: "ph-1", role: "PARENT", roles: ["PARENT"], tokenVersion: 1 };
const TEACHER = { id: "gv-1", role: "TEACHER", roles: ["TEACHER"], tokenVersion: 1 };
const TEACHER_AND_PARENT = {
  id: "gv-ph",
  role: "TEACHER",
  roles: ["TEACHER", "PARENT"],
  tokenVersion: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: PARENT });
  h.hasAcceptedChatPolicy.mockResolvedValue(false);
  h.issueSseTicket.mockResolvedValue({
    token: "sse",
    expiresAt: new Date("2026-08-10T03:25:00.000Z"),
  });
  h.rateLimit.mockResolvedValue({ success: true, remaining: 29, resetAt: Date.now() + 60_000 });
});

describe("cổng chính sách trên vé realtime", () => {
  it("PH chưa đồng ý → 403 CHAT_POLICY_REQUIRED và KHÔNG cấp vé", async () => {
    const res = await GET();

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "CHAT_POLICY_REQUIRED" },
    });
    expect(h.issueSseTicket).not.toHaveBeenCalled();
  });

  it("PH đã đồng ý → 200 kèm vé (chứng minh 403 ở trên không phải do lý do khác)", async () => {
    h.hasAcceptedChatPolicy.mockResolvedValue(true);

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ token: "sse" });
    expect(h.issueSseTicket).toHaveBeenCalledWith({ id: "ph-1", tokenVersion: 1 });
  });

  it("hỏi sổ đồng ý của CHÍNH người trong phiên", async () => {
    h.hasAcceptedChatPolicy.mockResolvedValue(true);

    await GET();

    expect(h.hasAcceptedChatPolicy).toHaveBeenCalledWith("ph-1");
  });

  it("lỗi đọc DB khi tra sổ → fail-closed 403, KHÔNG cấp vé", async () => {
    h.hasAcceptedChatPolicy.mockRejectedValue(new Error("DB down"));

    const res = await GET();

    expect(res.status).toBe(403);
    expect(h.issueSseTicket).not.toHaveBeenCalled();
  });
});

describe("nhân viên không bị cổng chính sách của phụ huynh chặn", () => {
  it("GV chưa từng bấm đồng ý → vẫn 200 (họ không có màn đó để bấm)", async () => {
    h.auth.mockResolvedValue({ user: TEACHER });
    h.hasAcceptedChatPolicy.mockResolvedValue(false);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(h.issueSseTicket).toHaveBeenCalledTimes(1);
    // Không hỏi sổ luôn — hỏi rồi bỏ qua kết quả là mời gọi ai đó "dọn cho gọn" thành chặn.
    expect(h.hasAcceptedChatPolicy).not.toHaveBeenCalled();
  });

  it("người vừa là GV vừa là PH tính là nhân viên → không bị chặn", async () => {
    h.auth.mockResolvedValue({ user: TEACHER_AND_PARENT });

    const res = await GET();

    expect(res.status).toBe(200);
  });
});

describe("thứ tự cổng", () => {
  it("chưa đăng nhập → 401 trước tất cả (không rate limit, không tra sổ)", async () => {
    h.auth.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(h.rateLimit).not.toHaveBeenCalled();
    expect(h.hasAcceptedChatPolicy).not.toHaveBeenCalled();
    expect(h.issueSseTicket).not.toHaveBeenCalled();
  });

  it("vượt trần → 429 và KHÔNG tra sổ đồng ý (429 không được tốn truy vấn)", async () => {
    h.rateLimit.mockResolvedValue({ success: false, remaining: 0, resetAt: Date.now() + 1_000 });

    const res = await GET();

    expect(res.status).toBe(429);
    expect(h.hasAcceptedChatPolicy).not.toHaveBeenCalled();
    expect(h.issueSseTicket).not.toHaveBeenCalled();
    expect(h.rateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: "chat:realtime-token:ph-1", max: 30, windowMs: 60_000 }),
    );
  });
});

describe("chỉ còn SSE (Supabase Realtime đã gỡ 28/09/2026)", () => {
  it("trả vé SSE + provider=sse (tab mở từ bundle cũ vẫn chọn đúng tầng)", async () => {
    h.auth.mockResolvedValue({ user: TEACHER });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ token: "sse", provider: "sse" });
    expect(body.expiresAt).toBe("2026-08-10T03:25:00.000Z");
    expect(h.issueSseTicket).toHaveBeenCalledWith({ id: "gv-1", tokenVersion: 1 });
  });

  it("phiên bị thu hồi (RealtimeTokenError) ⇒ 401", async () => {
    h.auth.mockResolvedValue({ user: TEACHER });
    h.issueSseTicket.mockRejectedValue(new h.RealtimeTokenError("TOKEN_VERSION_MISMATCH"));
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
