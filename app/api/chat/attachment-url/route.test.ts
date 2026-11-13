// @vitest-environment node
/**
 * US-16 AC2 — `GET /api/chat/attachment-url` là **cửa thứ ba** vào nội dung chat.
 *
 * Cổng chính sách ở `layout.tsx` + 4 page RSC chỉ chặn đường HTML; route cấp vé realtime
 * đã có chốt riêng. Còn route này đổi `MessageAttachment.id` lấy **signed URL 5 phút** —
 * ảnh trong nhóm lớp LÀ nội dung. Link `?id=…` nằm sẵn trong lịch sử trình duyệt của phụ
 * huynh đã dùng chat trước khi `CHAT_POLICY_VERSION` được nâng (đúng thủ tục ghi trong
 * `docs/chat-realtime/onboarding-pilot.md` khi sửa nội dung chính sách), nên "chưa bấm
 * đồng ý bản mới" mà vẫn tải được ảnh là lỗ thật, không phải giả định.
 *
 * Bất biến pin ở đây:
 *  • Tài khoản THUẦN phụ huynh chưa đồng ý → 403 `CHAT_POLICY_REQUIRED`, KHÔNG ký URL nào.
 *  • Nhân viên (GV/QLCS/Admin) KHÔNG bị chặn — họ không bao giờ thấy màn chính sách.
 *  • Lỗi đọc DB khi tra sổ đồng ý → coi như CHƯA đồng ý (fail-closed).
 *  • Cổng chính sách đứng TRƯỚC khi chạm `getChatAttachmentReadUrl` (không rò cả việc
 *    "id này có tồn tại không").
 *
 * `can` / `isParentOnly` cố ý KHÔNG mock — dùng bản thật của `lib/auth/permissions`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(
    async () =>
      null as { user?: { id: string; role?: string; roles?: string[] } } | null,
  ),
  hasAcceptedChatPolicy: vi.fn(async (_userId: string) => false),
  getChatAttachmentReadUrl: vi.fn(async (_id: string, _userId: string) => ({
    url: "https://r2.example/signed",
    fileName: "anh.jpg",
    mimeType: "image/jpeg",
    expiresIn: 300,
    expiresAt: new Date("2026-08-10T03:05:00.000Z"),
  })),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/chat/policy", () => ({ hasAcceptedChatPolicy: h.hasAcceptedChatPolicy }));
vi.mock("@/lib/chat/attachments", () => ({
  getChatAttachmentReadUrl: h.getChatAttachmentReadUrl,
  ChatAttachmentError: class ChatAttachmentError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
}));

import { GET } from "./route";

const PARENT = { id: "ph-1", role: "PARENT", roles: ["PARENT"] };
const TEACHER = { id: "gv-1", role: "TEACHER", roles: ["TEACHER"] };

const req = () =>
  ({
    nextUrl: new URL("https://hocvien.satarobo.vn/api/chat/attachment-url?id=att-1"),
  }) as unknown as Parameters<typeof GET>[0];

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: PARENT });
  h.hasAcceptedChatPolicy.mockResolvedValue(false);
});

describe("[US-16][AC2] cổng chính sách trên route ảnh đính kèm", () => {
  it("PH thuần CHƯA đồng ý → 403 CHAT_POLICY_REQUIRED, KHÔNG ký URL", async () => {
    const res = await GET(req());

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "CHAT_POLICY_REQUIRED" },
    });
    // Không chạm tầng ảnh: chưa đồng ý thì đến "id này có thật không" cũng không trả lời.
    expect(h.getChatAttachmentReadUrl).not.toHaveBeenCalled();
  });

  it("PH ĐÃ đồng ý → qua cổng, trả signed URL", async () => {
    h.hasAcceptedChatPolicy.mockResolvedValue(true);

    const res = await GET(req());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, data: { id: "att-1" } });
    expect(h.getChatAttachmentReadUrl).toHaveBeenCalledWith("att-1", "ph-1");
  });

  it("GIÁO VIÊN không bị cổng này chặn — không hỏi sổ đồng ý", async () => {
    h.auth.mockResolvedValue({ user: TEACHER });

    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(h.hasAcceptedChatPolicy).not.toHaveBeenCalled();
  });

  it("tra sổ đồng ý LỖI DB → fail-closed (403), không mở cửa", async () => {
    h.hasAcceptedChatPolicy.mockRejectedValue(new Error("DB down"));

    const res = await GET(req());

    expect(res.status).toBe(403);
    expect(h.getChatAttachmentReadUrl).not.toHaveBeenCalled();
  });
});
