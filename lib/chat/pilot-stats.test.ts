import { describe, it, expect, vi } from "vitest";

// `pilot-stats` dùng lại `isAnnouncementRecipient` của `lib/chat/announcements` (một nguồn
// sự thật cho mẫu số) — kéo theo `@/lib/auth` (next-auth) và `@/lib/db`. Bộ test này chỉ
// đụng phần THUẦN nên chặn cả hai ở cửa, đúng cách `announcements.test.ts` đang làm.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/db", () => ({ db: {} }));

import {
  buildPilotClassStats,
  pct,
  sumPilotTotals,
  PILOT_READ_WINDOW_HOURS,
  type PilotClassInput,
  type PilotParent,
} from "./pilot-stats";
import { CHAT_POLICY, CHAT_POLICY_VERSION, CHAT_POLICY_FOOTER } from "./policy-content";

// =============================================================================
// US-16 AC4 — bảng số này là CỔNG của Đợt 2. Sai một con số ở đây thì quyết định
// "mở rộng hay dừng" bị ra sai, nên mọi bẫy đếm phải có test riêng.
// =============================================================================

const HOUR = 3_600_000;
const T0 = new Date("2026-08-10T02:00:00.000Z"); // 09:00 giờ VN

const parent = (id: string, over: Partial<PilotParent> = {}): PilotParent => ({
  userId: id,
  derivedFrom: "CLASS_STUDENT_PARENT",
  accountStatus: "ACTIVE",
  lastLoginAt: new Date("2026-08-09T00:00:00.000Z"),
  ...over,
});

const input = (over: Partial<PilotClassInput> = {}): PilotClassInput => ({
  conversationId: "conv1",
  classId: "class1",
  className: "Sata 1 — T3-T5",
  centerName: "CS1",
  conversationStatus: "ACTIVE",
  participants: [],
  firstAnnouncement: null,
  firstAnnouncementReads: [],
  acceptedPolicyUserIds: new Set<string>(),
  now: new Date(T0.getTime() + 72 * HOUR),
  ...over,
});

describe("mẫu số — chỉ đếm PHỤ HUYNH", () => {
  it("GV/QLCS trong nhóm KHÔNG vào mẫu số", () => {
    const s = buildPilotClassStats(
      input({
        participants: [
          parent("ph1"),
          parent("ph2"),
          { userId: "gv1", derivedFrom: "CLASS_TEACHER", accountStatus: "ACTIVE" },
          { userId: "qlcs1", derivedFrom: "CENTER_MANAGER", accountStatus: "ACTIVE" },
        ],
      }),
    );
    expect(s.parentCount).toBe(2);
  });

  it("participant thêm TAY (derivedFrom null) rơi về vai tài khoản", () => {
    const s = buildPilotClassStats(
      input({
        participants: [
          { userId: "u1", derivedFrom: null, role: "PARENT", accountStatus: "ACTIVE" },
          { userId: "u2", derivedFrom: null, role: "TEACHER", accountStatus: "ACTIVE" },
          { userId: "u3", derivedFrom: null, roles: ["PARENT"], accountStatus: "ACTIVE" },
        ],
      }),
    );
    expect(s.parentCount).toBe(2);
  });
});

describe("% kích hoạt", () => {
  it("PENDING_ACTIVATION không tính là đã kích hoạt", () => {
    const s = buildPilotClassStats(
      input({
        participants: [
          parent("ph1"),
          parent("ph2", { accountStatus: "PENDING_ACTIVATION", lastLoginAt: null }),
          parent("ph3", { accountStatus: "DISABLED", lastLoginAt: null }),
        ],
      }),
    );
    expect(s.activatedCount).toBe(1);
    expect(s.parentCount).toBe(3);
  });

  it("đã kích hoạt ≠ đã đăng nhập — hai cột riêng biệt", () => {
    // Tài khoản tạo trước cụm A1 mặc định ACTIVE mà chưa từng đăng nhập: nếu chỉ nhìn
    // accountStatus thì báo 100% kích hoạt trong khi chưa ai vào hệ thống.
    const s = buildPilotClassStats(
      input({
        participants: [parent("ph1", { lastLoginAt: null }), parent("ph2")],
      }),
    );
    expect(s.activatedCount).toBe(2);
    expect(s.loggedInCount).toBe(1);
  });
});

describe("% đọc thông báo đầu trong 48h", () => {
  const ann = { messageId: "m1", createdAt: T0 };

  it("đọc trong 48h tính; đọc sau 48h chỉ vào cột 'đã đọc'", () => {
    const s = buildPilotClassStats(
      input({
        participants: [parent("ph1"), parent("ph2"), parent("ph3")],
        firstAnnouncement: ann,
        firstAnnouncementReads: [
          { userId: "ph1", readAt: new Date(T0.getTime() + 2 * HOUR) },
          { userId: "ph2", readAt: new Date(T0.getTime() + 60 * HOUR) },
        ],
      }),
    );
    expect(s.readWithinWindowCount).toBe(1);
    expect(s.readTotalCount).toBe(2);
  });

  it("đúng mốc 48h vẫn tính (biên đóng)", () => {
    const s = buildPilotClassStats(
      input({
        participants: [parent("ph1")],
        firstAnnouncement: ann,
        firstAnnouncementReads: [
          { userId: "ph1", readAt: new Date(T0.getTime() + PILOT_READ_WINDOW_HOURS * HOUR) },
        ],
      }),
    );
    expect(s.readWithinWindowCount).toBe(1);
  });

  it("GV mở thông báo cũng sinh AnnouncementRead — KHÔNG được đếm (chống 'đã đọc 4/3')", () => {
    const s = buildPilotClassStats(
      input({
        participants: [
          parent("ph1"),
          { userId: "gv1", derivedFrom: "CLASS_TEACHER", accountStatus: "ACTIVE" },
        ],
        firstAnnouncement: ann,
        firstAnnouncementReads: [
          { userId: "ph1", readAt: new Date(T0.getTime() + HOUR) },
          { userId: "gv1", readAt: new Date(T0.getTime() + HOUR) },
        ],
      }),
    );
    expect(s.readWithinWindowCount).toBe(1);
    expect(s.parentCount).toBe(1);
  });

  it("thông báo vừa đăng 1h trước → windowClosed=false (số CÒN CHẠY)", () => {
    const s = buildPilotClassStats(
      input({
        participants: [parent("ph1")],
        firstAnnouncement: ann,
        now: new Date(T0.getTime() + HOUR),
      }),
    );
    expect(s.windowClosed).toBe(false);
  });

  it("lớp chưa có thông báo nào → firstAnnouncementAt null, không tự nhận 0%", () => {
    const s = buildPilotClassStats(input({ participants: [parent("ph1")] }));
    expect(s.firstAnnouncementAt).toBeNull();
    expect(s.readWithinWindowCount).toBe(0);
    expect(pct(s.readWithinWindowCount, s.parentCount)).toBe(0);
  });
});

describe("pct — mẫu số 0", () => {
  it("0/0 → null (hiển thị '—'), KHÔNG phải 0% hay 100%", () => {
    expect(pct(0, 0)).toBeNull();
    expect(pct(1, 3)).toBe(33);
    expect(pct(2, 3)).toBe(67);
  });
});

describe("đồng ý chính sách", () => {
  it("chỉ đếm PH có trong tập đã đồng ý", () => {
    const s = buildPilotClassStats(
      input({
        participants: [parent("ph1"), parent("ph2")],
        acceptedPolicyUserIds: new Set(["ph1", "nguoi-la"]),
      }),
    );
    expect(s.policyAcceptedCount).toBe(1);
  });
});

describe("sumPilotTotals", () => {
  it("cộng dồn, KHÔNG trung bình-của-trung-bình; lớp chưa có thông báo không vào mẫu số đọc", () => {
    const a = buildPilotClassStats(
      input({
        conversationId: "c1",
        participants: [parent("p1"), parent("p2"), parent("p3"), parent("p4")],
        firstAnnouncement: { messageId: "m1", createdAt: T0 },
        firstAnnouncementReads: [
          { userId: "p1", readAt: new Date(T0.getTime() + HOUR) },
          { userId: "p2", readAt: new Date(T0.getTime() + HOUR) },
        ],
      }),
    );
    const b = buildPilotClassStats(
      input({ conversationId: "c2", participants: [parent("p5")] }), // chưa có thông báo
    );

    const t = sumPilotTotals([a, b]);
    expect(t.classCount).toBe(2);
    expect(t.parentCount).toBe(5);
    expect(t.classesWithAnnouncement).toBe(1);
    expect(t.announcementRecipientCount).toBe(4);
    expect(t.readWithinWindowCount).toBe(2);
    // 2/4 = 50% — nếu trung bình theo lớp (50% và 0%) sẽ ra 25%, tức bôi đen lớp
    // chưa hề gửi thông báo.
    expect(pct(t.readWithinWindowCount, t.announcementRecipientCount)).toBe(50);
  });
});

describe("nội dung chính sách (US-16 AC2)", () => {
  it("có version + đủ mục + không hứa thứ hệ thống không làm được", () => {
    expect(CHAT_POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(CHAT_POLICY.length).toBeGreaterThanOrEqual(5);
    const all = [...CHAT_POLICY.map((p) => `${p.heading} ${p.body}`), CHAT_POLICY_FOOTER]
      .join(" ")
      .toLowerCase();
    for (const forbidden of ["mã hoá đầu cuối", "chỉ mình bạn", "tự động xoá", "tuyệt đối bảo mật"]) {
      expect(all).not.toContain(forbidden);
    }
    // 4 điều PHẢI nói (yêu cầu cứng của US-16).
    expect(all).toContain("lưu");
    expect(all).toContain("quản lý cơ sở");
    expect(all).toContain("ghi vết");
    expect(all).toContain("kho riêng");
  });
});
