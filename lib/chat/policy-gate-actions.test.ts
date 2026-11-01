// @vitest-environment node
/**
 * US-16 AC2 — CỬA THỨ BA của cổng chính sách: Server Action.
 *
 * Cổng "chưa đồng ý quy định thì server không trả nội dung" có ĐÚNG ba cửa, và nhóm làm
 * US-16 chỉ chặn được hai (HTML qua `layout.tsx` + 4 page RSC, và vé realtime qua
 * `app/api/chat/realtime-token/route.ts`) vì `lib/chat/_actions.ts` khi đó thuộc vùng file
 * một nhóm agent khác đang sửa. File này khoá cửa còn lại.
 *
 * Vì sao cửa này là cửa thật chứ không phải lo xa: Server Action LÀ endpoint HTTP. Phụ
 * huynh đã dùng chat trước khi `CHAT_POLICY_VERSION` được nâng vẫn còn nguyên id hội thoại
 * trong lịch sử trình duyệt; gọi thẳng `getMessagesPageAction(convId, null)` không đi qua
 * layout nào cả. Chặn hai cửa mà bỏ cửa thứ ba thì AC2 chỉ là tấm màn che.
 *
 * Bất biến pin ở đây:
 *  • Phụ huynh CHƯA đồng ý → `CHAT_POLICY_REQUIRED` và KHÔNG hàm đọc nội dung nào chạy.
 *  • Phụ huynh ĐÃ đồng ý → đi tiếp bình thường (đối chứng dương — thiếu nó thì một bản vá
 *    "chặn sạch mọi phụ huynh" cũng làm test xanh).
 *  • NHÂN VIÊN không bao giờ bị cổng này chặn, kể cả khi không có dòng đồng ý nào: giáo
 *    viên/quản lý không hề thấy màn chính sách của phụ huynh, chặn họ ở đây là tắt chat
 *    của nhân viên.
 *  • Lỗi đọc DB ⇒ coi như CHƯA đồng ý (fail-closed). Đây là cổng nội dung: hỏng thì đóng.
 *  • Đường GHI (gửi tin) cũng bị chặn — nhắn được vào nhóm khi chưa đồng ý thì "bấm đồng ý
 *    mới vào" không còn nghĩa gì.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(
    async () =>
      null as { user?: { id: string; role?: string | null; roles?: string[] | null } } | null,
  ),
  hasAcceptedChatPolicy: vi.fn(async (_userId: string) => true),
  getMessagesPage: vi.fn(async () => ({ messages: [], nextCursor: null })),
  fetchMessagesSince: vi.fn(async () => ({ messages: [], hasMore: false })),
  listChatAttachments: vi.fn(async () => []),
  sendChatMessage: vi.fn(async () => ({ ok: true as const, data: { id: "m-1" } })),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/chat/policy", () => ({ hasAcceptedChatPolicy: h.hasAcceptedChatPolicy }));
vi.mock("@/lib/chat/messages", () => ({
  sendChatMessage: h.sendChatMessage,
  listChatAttachments: h.listChatAttachments,
}));
vi.mock("@/lib/chat/queries", () => ({
  getMessagesPage: h.getMessagesPage,
  fetchMessagesSince: h.fetchMessagesSince,
  markConversationRead: vi.fn(async () => ({ unreadCount: 0 })),
}));
vi.mock("@/lib/chat/moderation", () => ({ recallOwnMessage: vi.fn() }));
vi.mock("@/lib/chat/announcements", () => ({ markAnnouncementRead: vi.fn() }));
vi.mock("@/lib/chat/dm", () => ({ openDmAsActor: vi.fn() }));
vi.mock("@/lib/chat/admin", () => ({
  adminLookupConversationAsActor: vi.fn(),
  setConversationLockAsActor: vi.fn(),
}));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: vi.fn() }));

import {
  fetchMessagesSinceAction,
  getMessagesPageAction,
  listChatAttachmentsAction,
  sendChatMessageAction,
} from "./_actions";

/** Tài khoản THUẦN phụ huynh — đối tượng duy nhất của cổng này. */
const PH = { user: { id: "ph-1", role: "PARENT", roles: ["PARENT"] } };
/** Giáo viên — phải đi lọt, không bao giờ thấy màn chính sách. */
const GV = { user: { id: "gv-1", role: "TEACHER", roles: ["TEACHER"] } };

beforeEach(() => {
  h.auth.mockReset();
  h.hasAcceptedChatPolicy.mockReset();
  h.getMessagesPage.mockClear();
  h.fetchMessagesSince.mockClear();
  h.listChatAttachments.mockClear();
  h.sendChatMessage.mockClear();
  h.hasAcceptedChatPolicy.mockResolvedValue(true);
});

describe("cổng chính sách trên Server Action (US-16 AC2, cửa thứ ba)", () => {
  it("PH chưa đồng ý → getMessagesPageAction bị chặn, KHÔNG chạm tầng đọc", async () => {
    h.auth.mockResolvedValue(PH);
    h.hasAcceptedChatPolicy.mockResolvedValue(false);

    const res = await getMessagesPageAction("conv-1", null);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("CHAT_POLICY_REQUIRED");
    // Quan trọng hơn cả mã lỗi: truy vấn nội dung KHÔNG được chạy. Trả lỗi sau khi đã đọc
    // xong lịch sử thì dữ liệu đã nằm trong tiến trình rồi.
    expect(h.getMessagesPage).not.toHaveBeenCalled();
  });

  it("ĐỐI CHỨNG DƯƠNG — PH đã đồng ý thì đi tiếp bình thường", async () => {
    h.auth.mockResolvedValue(PH);
    h.hasAcceptedChatPolicy.mockResolvedValue(true);

    const res = await getMessagesPageAction("conv-1", null);

    // Thiếu ca này thì một bản vá "chặn sạch mọi phụ huynh" vẫn làm cả file xanh.
    expect(res.ok).toBe(true);
    expect(h.getMessagesPage).toHaveBeenCalledTimes(1);
  });

  it("PH chưa đồng ý → fetchMessagesSinceAction bị chặn (đường bù tin sau khi rớt mạng)", async () => {
    h.auth.mockResolvedValue(PH);
    h.hasAcceptedChatPolicy.mockResolvedValue(false);

    const res = await fetchMessagesSinceAction("conv-1", null);

    expect(res.ok).toBe(false);
    expect(h.fetchMessagesSince).not.toHaveBeenCalled();
  });

  it("PH chưa đồng ý → listChatAttachmentsAction bị chặn (ảnh cũng là nội dung)", async () => {
    h.auth.mockResolvedValue(PH);
    h.hasAcceptedChatPolicy.mockResolvedValue(false);

    const res = await listChatAttachmentsAction("conv-1", ["m-1"]);

    expect(res.ok).toBe(false);
    expect(h.listChatAttachments).not.toHaveBeenCalled();
  });

  it("PH chưa đồng ý → KHÔNG gửi được tin (cổng áp cả đường ghi)", async () => {
    h.auth.mockResolvedValue(PH);
    h.hasAcceptedChatPolicy.mockResolvedValue(false);

    const res = await sendChatMessageAction({ conversationId: "conv-1", body: "xin chào" });

    expect(res.ok).toBe(false);
    expect(h.sendChatMessage).not.toHaveBeenCalled();
  });

  it("GIÁO VIÊN không bị cổng chặn dù không có dòng đồng ý nào", async () => {
    h.auth.mockResolvedValue(GV);
    h.hasAcceptedChatPolicy.mockResolvedValue(false);

    const res = await getMessagesPageAction("conv-1", null);

    // Nhân viên không bao giờ thấy màn chính sách của phụ huynh. Chặn họ ở đây là tắt chat
    // của toàn bộ giáo viên — hỏng nặng hơn nhiều so với lỗ đang vá.
    expect(res.ok).toBe(true);
    expect(h.getMessagesPage).toHaveBeenCalledTimes(1);
    // Và không tốn một truy vấn nào để biết điều đó.
    expect(h.hasAcceptedChatPolicy).not.toHaveBeenCalled();
  });

  it("lỗi đọc DB khi kiểm đồng ý → FAIL-CLOSED, chặn chứ không cho qua", async () => {
    h.auth.mockResolvedValue(PH);
    h.hasAcceptedChatPolicy.mockRejectedValue(new Error("DB sập"));

    const res = await getMessagesPageAction("conv-1", null);

    expect(res.ok).toBe(false);
    expect(h.getMessagesPage).not.toHaveBeenCalled();
  });

  it("chưa đăng nhập → AUTH, và không hỏi tới bảng đồng ý", async () => {
    h.auth.mockResolvedValue(null);

    const res = await getMessagesPageAction("conv-1", null);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("AUTH");
    expect(h.hasAcceptedChatPolicy).not.toHaveBeenCalled();
    expect(h.getMessagesPage).not.toHaveBeenCalled();
  });
});
