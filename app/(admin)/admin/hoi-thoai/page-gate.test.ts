// @vitest-environment node
/**
 * US-15 AC5 + AC1 — CỔNG CỦA ROUTE `/admin/hoi-thoai` (danh sách + hồ sơ).
 *
 * Hai điều file này pin, mà không test nào khác pin được:
 *
 * 1. **QLCS bị chặn khỏi ROUTE**, không chỉ khỏi mục sidebar. `lib/auth/chat-permissions.test.ts`
 *    chứng minh QLCS không có `chat:admin`; test đó vẫn xanh nguyên nếu ai đó đổi gate của
 *    trang sang `chat:read` (QLCS CÓ) hoặc xoá hẳn dòng gate. Chỉ chỗ này bắt được.
 *    ⚠️ `chat:admin` KHÔNG nằm trong `PAGE_GATES` (bảng đó dành cho route nhiều action OR
 *    nhau) nên `lib/auth/page-gates.test.ts` cũng không phủ tới.
 *
 * 2. **Trang hồ sơ KHÔNG tải nội dung.** Nếu RSC nạp sẵn 50 tin rồi để client "ẩn tới khi
 *    nhập lý do" thì nội dung đã nằm trong HTML: mở DevTools là đọc, không lý do, không
 *    một dòng audit nào — đúng cái AC1 gọi là "vòng qua modal". Kiểm bằng props THẬT sự
 *    giao cho Client Component, không bằng mắt nhìn giao diện.
 *
 * `redirect`/`notFound` được mock NÉM lỗi như bản thật của Next — nếu chúng chỉ ghi nhận
 * lời gọi rồi để hàm chạy tiếp, một trang mất gate vẫn "có gọi redirect" và test vẫn xanh
 * trong khi dữ liệu đã kịp rời DB.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(async () => null as { user?: { id: string } } | null),
  checkPermission: vi.fn(async (_action: string) => false),
  resolveActor: vi.fn(async (userId: string) => ({ userId }) as unknown),
  listAdminConversations: vi.fn(async () => [] as unknown[]),
  /** Hồ sơ mặc định — gán lại trong `beforeEach` vì `mockResolvedValue(null)` của một
   *  test khác sẽ ở lại (clearAllMocks xoá LỜI GỌI, không xoá phần cài đặt). */
  defaultMeta: (conversationId: string) => ({
    conversationId,
    type: "CLASS_GROUP",
    status: "ACTIVE",
    centerId: "c1",
    orgUnitId: "cs1",
    classId: "lopA",
    className: "Sata 3 — CS1",
    centerName: "Cơ sở 1",
    title: null,
    createdById: "gv-1",
    createdAt: new Date("2026-08-01T00:00:00Z"),
    lastMessageAt: new Date("2026-08-08T00:00:00Z"),
    archivedAt: null,
    participantCount: 12,
    messageCount: 340,
  }),
  loadAdminConversationMeta: vi.fn(async (_conversationId: string) => null as unknown),
  adminLookupConversationAsActor: vi.fn(async () => ({ ok: false })),
  setConversationLockAsActor: vi.fn(async () => ({ ok: false })),
  // Client Component: chỉ cần một danh tính để soi props được giao cho nó.
  // Phải nằm TRONG `vi.hoisted` — `vi.mock` bị nâng lên đầu file, biến top-level thường
  // chưa khởi tạo lúc factory chạy (đã ăn `ReferenceError` đúng như vậy).
  VIEWER: function AdminConversationViewerStub() {
    return null;
  },
}));

class RedirectSignal extends Error {
  constructor(readonly to: string) {
    super(`NEXT_REDIRECT:${to}`);
  }
}
class NotFoundSignal extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
  }
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
  notFound: () => {
    throw new NotFoundSignal();
  },
}));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/db-scope", () => ({
  scopedDb: () => ({ center: { findMany: async () => [{ id: "c1", name: "Cơ sở 1" }] } }),
}));
vi.mock("@/lib/chat/admin", () => ({
  listAdminConversations: h.listAdminConversations,
  loadAdminConversationMeta: h.loadAdminConversationMeta,
  adminLookupConversationAsActor: h.adminLookupConversationAsActor,
  setConversationLockAsActor: h.setConversationLockAsActor,
}));
vi.mock("./_components/conversation-viewer", () => ({ AdminConversationViewer: h.VIEWER }));

import ConversationListPage from "./page";
import ConversationDetailPage from "./[conversationId]/page";

const CONV_ID = "11111111-2222-4333-8444-555555555555";

const listPage = (sp: Record<string, string> = {}) =>
  ConversationListPage({ searchParams: Promise.resolve(sp) });
const detailPage = (conversationId = CONV_ID) =>
  ConversationDetailPage({ params: Promise.resolve({ conversationId }) });

/** Tìm props mà cây JSX giao cho một component cụ thể (RSC chưa render nên phải tự đi). */
function propsGivenTo(node: unknown, type: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = propsGivenTo(child, type);
      if (found) return found;
    }
    return null;
  }
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (el.type === type) return el.props ?? {};
  if (el.props) {
    for (const value of Object.values(el.props)) {
      const found = propsGivenTo(value, type);
      if (found) return found;
    }
  }
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "admin-1" } });
  h.checkPermission.mockResolvedValue(true);
  h.loadAdminConversationMeta.mockImplementation(async (id: string) => h.defaultMeta(id));
});

// ─── Danh sách hội thoại ────────────────────────────────────────────────────

describe("/admin/hoi-thoai — danh sách", () => {
  it("chưa đăng nhập → redirect /login, KHÔNG tra cứu hội thoại nào", async () => {
    h.auth.mockResolvedValue(null);

    await expect(listPage()).rejects.toMatchObject({ to: "/login" });
    expect(h.listAdminConversations).not.toHaveBeenCalled();
  });

  it("[AC5] QLCS (không có chat:admin) → redirect, KHÔNG rò cả DANH SÁCH metadata", async () => {
    h.checkPermission.mockResolvedValue(false);

    await expect(listPage()).rejects.toMatchObject({ to: "/dashboard?error=unauthorized" });
    // Tên lớp / số tin / danh sách cơ sở khác cũng là thứ QLCS không được thấy ở màn này.
    expect(h.listAdminConversations).not.toHaveBeenCalled();
    expect(h.resolveActor).not.toHaveBeenCalled();
  });

  it("[AC5] gate hỏi ĐÚNG `chat:admin` — không phải chat:read/moderate (QLCS có 2 quyền đó)", async () => {
    await listPage();

    expect(h.checkPermission).toHaveBeenCalledWith("chat:admin");
    const asked = h.checkPermission.mock.calls.map((c) => c[0]);
    expect(asked).not.toContain("chat:read");
    expect(asked).not.toContain("chat:moderate");
  });

  it("Admin → dựng danh sách, chuyển đúng bộ lọc trên URL xuống hàm tra cứu", async () => {
    await listPage({ q: "Sata 3", center: "c1", type: "CLASS_GROUP", status: "LOCKED" });

    expect(h.listAdminConversations).toHaveBeenCalledTimes(1);
    const [actor, filters] = h.listAdminConversations.mock.calls[0] as unknown as [
      { userId: string },
      Record<string, unknown>,
    ];
    // Actor của CHÍNH phiên — không phải id nào lấy từ query string.
    expect(actor.userId).toBe("admin-1");
    expect(filters).toMatchObject({
      q: "Sata 3",
      centerId: "c1",
      type: "CLASS_GROUP",
      status: "LOCKED",
    });
  });
});

// ─── Hồ sơ một hội thoại ────────────────────────────────────────────────────

describe("/admin/hoi-thoai/[conversationId] — hồ sơ", () => {
  it("chưa đăng nhập → redirect /login, KHÔNG đọc cả metadata", async () => {
    h.auth.mockResolvedValue(null);

    await expect(detailPage()).rejects.toMatchObject({ to: "/login" });
    expect(h.loadAdminConversationMeta).not.toHaveBeenCalled();
  });

  it("[AC5] QLCS mở thẳng URL hồ sơ → redirect, KHÔNG đọc metadata, KHÔNG đọc nội dung", async () => {
    h.checkPermission.mockResolvedValue(false);

    await expect(detailPage()).rejects.toMatchObject({ to: "/dashboard?error=unauthorized" });
    expect(h.loadAdminConversationMeta).not.toHaveBeenCalled();
    expect(h.adminLookupConversationAsActor).not.toHaveBeenCalled();
  });

  it("hội thoại không tồn tại → notFound (không dựng trang rỗng)", async () => {
    h.loadAdminConversationMeta.mockResolvedValue(null as unknown as never);

    await expect(detailPage()).rejects.toBeInstanceOf(NotFoundSignal);
  });

  it("[AC1] Admin mở hồ sơ → KHÔNG một dòng tin nào rời DB; props giao cho client chỉ có hồ sơ", async () => {
    const tree = await detailPage();

    // Nội dung chỉ đi qua Server Action có lý do + audit — RSC không được gọi tới nó.
    expect(h.adminLookupConversationAsActor).not.toHaveBeenCalled();

    const props = propsGivenTo(tree, h.VIEWER);
    expect(props, "trang phải giao việc cho AdminConversationViewer").not.toBeNull();
    const keys = Object.keys(props ?? {});
    // Chỉ hồ sơ: tên, loại, trạng thái, số lượng. Không `messages`, không `transcript`.
    for (const forbidden of ["messages", "transcript", "initialMessages", "body", "preview"]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(props).toMatchObject({ conversationId: CONV_ID, initialStatus: "ACTIVE" });
    // Chốt chặn cuối: không chuỗi nào trong props trông giống nội dung tin.
    expect(JSON.stringify(props)).not.toContain("Nội dung");
  });
});
