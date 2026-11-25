// @vitest-environment node
/**
 * F-21 — vòng quét gửi thông báo: ĐÚNG NGƯỜI, ĐÚNG LÚC, KHÔNG NHẮC LẶP.
 *
 * Ba khẳng định ở đây là ba lỗi đã đo được của bản cũ, và không cái nào bắt được
 * bằng test thuần:
 *   · người nhận phải là quản lý của ĐÚNG cơ sở có ảnh treo (bản cũ chỉ hiện cho ai
 *     tự mở chuông, nên "đúng người" chưa từng được kiểm ở tầng gửi);
 *   · ảnh giáo viên mới tải lên cho buổi CŨ phải bắn ngay (bản cũ đợi đủ 2 ngày kể
 *     từ lúc tải lên);
 *   · hai lượt cron trong cùng ngày phải ra CÙNG một khoá chống trùng.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
// Type-only (bị xoá lúc biên dịch) → không kéo module thật vào dù nó đang bị mock.
import type { NotifyStaffParams } from "@/lib/notifications/notify";

const h = vi.hoisted(() => ({
  media: [] as unknown[],
  sessions: [] as unknown[],
  classes: [] as unknown[],
  users: [] as {
    id: string;
    isActive: boolean;
    deletedAt: Date | null;
    roles: string[];
    centerId: string | null;
  }[],
  notify: vi.fn(async (p: NotifyStaffParams) => p.userIds.length),
  setting: vi.fn(async (key: string) =>
    key === "media.reviewDeadlineHour" ? 10 : 1,
  ),
}));

vi.mock("@/lib/db", () => ({
  db: {
    classSessionMedia: { findMany: vi.fn(async () => h.media) },
    classSession: { findMany: vi.fn(async () => h.sessions) },
    class: { findMany: vi.fn(async () => h.classes) },
    user: {
      // Mô phỏng đúng phần `where` mà hàm thật dùng — nếu không thì test "đúng người"
      // trở thành test rỗng (mọi truy vấn trả cùng một danh sách).
      findMany: vi.fn(async (a: { where: { roles: { hasSome: string[] }; centerId?: string } }) =>
        h.users
          .filter(
            (u) =>
              u.isActive &&
              u.deletedAt === null &&
              u.roles.some((r) => a.where.roles.hasSome.includes(r)) &&
              (a.where.centerId === undefined || u.centerId === a.where.centerId),
          )
          .map((u) => ({ id: u.id })),
      ),
    },
  },
}));
vi.mock("@/lib/notifications/notify", () => ({ notifyStaff: h.notify }));
vi.mock("@/lib/settings/service", () => ({ getSetting: h.setting }));
vi.mock("@/lib/org/org-service", () => ({
  orgUnitIdForCenter: vi.fn(async (cid: string) => `ou-${cid}`),
}));

const { runMediaReviewOverdueNotify } = await import("@/lib/lms/media-review-overdue-run");

const QL = (id: string, centerId: string | null) => ({
  id,
  isActive: true,
  deletedAt: null,
  roles: ["CENTER_MANAGER"],
  centerId,
});

beforeEach(() => {
  h.media = [];
  h.sessions = [];
  h.classes = [];
  h.users = [];
  h.notify.mockClear();
});

/** Buổi 24/08 → hạn 10h sáng 25/08 VN = 2026-08-25T03:00Z. */
const SAU_HAN = new Date("2026-08-25T04:00:00.000Z"); // 11h sáng 25/08 VN
const TRUOC_HAN = new Date("2026-08-25T02:00:00.000Z"); // 9h sáng 25/08 VN

function moiThuBinhThuong() {
  h.media = [
    {
      id: "m1",
      classId: "clsA",
      classSessionId: "s1",
      takenAt: null,
      createdAt: new Date("2026-08-24T10:00:00.000Z"),
    },
  ];
  h.sessions = [{ id: "s1", classId: "clsA", date: new Date("2026-08-24T00:00:00.000Z") }];
  h.classes = [
    { id: "clsA", name: "Robot 1", classCode: "CS1-R1", centerId: "cs1", orgUnitId: "ou-cs1" },
  ];
  h.users = [QL("ql-cs1", "cs1"), QL("ql-cs2", "cs2")];
}

describe("[F-21] runMediaReviewOverdueNotify — đúng lúc", () => {
  it("[F-21-R01] chưa quá hạn → không bắn thông báo nào", async () => {
    moiThuBinhThuong();
    const r = await runMediaReviewOverdueNotify(TRUOC_HAN);
    expect(r.overdue).toBe(0);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("[F-21-R02] quá hạn → bắn đúng một thông báo cho folder", async () => {
    moiThuBinhThuong();
    const r = await runMediaReviewOverdueNotify(SAU_HAN);
    expect(r.overdue).toBe(1);
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify.mock.calls[0]![0]).toMatchObject({ href: "/media" });
  });

  it("[F-21-R03] 🔴 ảnh MỚI TẢI LÊN cho buổi tuần trước → bắn ngay, không đợi 2 ngày", async () => {
    const buoiCu = new Date("2026-08-20T00:00:00.000Z"); // hạn: 10h 21/08
    h.media = [
      {
        id: "m9",
        classId: "clsA",
        classSessionId: "s9",
        takenAt: null,
        // Vừa tải lên 5 phút trước — ngưỡng cũ ("chờ quá 2 ngày") nói CHƯA trễ.
        createdAt: new Date("2026-08-25T03:55:00.000Z"),
      },
    ];
    h.sessions = [{ id: "s9", classId: "clsA", date: buoiCu }];
    h.classes = [
      { id: "clsA", name: "Robot 1", classCode: "CS1-R1", centerId: "cs1", orgUnitId: "ou-cs1" },
    ];
    h.users = [QL("ql-cs1", "cs1")];

    const r = await runMediaReviewOverdueNotify(SAU_HAN);
    expect(r.overdue).toBe(1);
    expect(h.notify).toHaveBeenCalledTimes(1);
  });
});

describe("[F-21] runMediaReviewOverdueNotify — đúng người", () => {
  it("[F-21-R10] chỉ quản lý của CƠ SỞ CÓ ảnh treo được gọi", async () => {
    moiThuBinhThuong();
    h.users = [QL("ql-cs1", "cs1"), QL("ql-cs1-b", "cs1"), QL("ql-cs2", "cs2")];
    await runMediaReviewOverdueNotify(SAU_HAN);
    expect(h.notify.mock.calls[0]![0].userIds).toEqual(["ql-cs1", "ql-cs1-b"]);
  });

  it("[F-21-R11] quản lý đã nghỉ / bị vô hiệu hoá không nhận", async () => {
    moiThuBinhThuong();
    h.users = [
      { ...QL("ql-nghi", "cs1"), isActive: false },
      { ...QL("ql-xoa", "cs1"), deletedAt: new Date() },
      QL("ql-cs1", "cs1"),
    ];
    await runMediaReviewOverdueNotify(SAU_HAN);
    expect(h.notify.mock.calls[0]![0].userIds).toEqual(["ql-cs1"]);
  });

  it("[F-21-R12] cơ sở không còn quản lý nào → không bắn bừa cho người cơ sở khác", async () => {
    moiThuBinhThuong();
    h.users = [QL("ql-cs2", "cs2")];
    const r = await runMediaReviewOverdueNotify(SAU_HAN);
    expect(h.notify).not.toHaveBeenCalled();
    expect(r.khongCoNguoiNhan).toBe(1);
  });

  it("[F-21-R13] lớp chưa gắn cơ sở → đếm vào 'không có người nhận', KHÔNG bắn toàn hệ", async () => {
    moiThuBinhThuong();
    h.classes = [
      { id: "clsA", name: "Robot 1", classCode: null, centerId: null, orgUnitId: null },
    ];
    const r = await runMediaReviewOverdueNotify(SAU_HAN);
    expect(h.notify).not.toHaveBeenCalled();
    expect(r.khongCoNguoiNhan).toBe(1);
  });

  it("[F-21-R14] hai cơ sở cùng treo → mỗi bên nhận thông báo của chính mình", async () => {
    h.media = [
      { id: "m1", classId: "clsA", classSessionId: "s1", takenAt: null, createdAt: new Date("2026-08-24T10:00:00.000Z") },
      { id: "m2", classId: "clsB", classSessionId: "s2", takenAt: null, createdAt: new Date("2026-08-24T10:00:00.000Z") },
    ];
    h.sessions = [
      { id: "s1", classId: "clsA", date: new Date("2026-08-24T00:00:00.000Z") },
      { id: "s2", classId: "clsB", date: new Date("2026-08-24T00:00:00.000Z") },
    ];
    h.classes = [
      { id: "clsA", name: "Robot 1", classCode: "CS1-R1", centerId: "cs1", orgUnitId: "ou-cs1" },
      { id: "clsB", name: "Robot 2", classCode: "CS2-R2", centerId: "cs2", orgUnitId: "ou-cs2" },
    ];
    h.users = [QL("ql-cs1", "cs1"), QL("ql-cs2", "cs2")];

    await runMediaReviewOverdueNotify(SAU_HAN);
    const theoNguoi = h.notify.mock.calls.map((c) => c[0].userIds);
    expect(theoNguoi).toHaveLength(2);
    expect(theoNguoi.flat().sort()).toEqual(["ql-cs1", "ql-cs2"]);
    // Không ai nhận thông báo của cơ sở kia.
    for (const call of h.notify.mock.calls) {
      expect(call[0].userIds).toHaveLength(1);
    }
  });
});

describe("[F-21] runMediaReviewOverdueNotify — chống nhắc lặp", () => {
  it("[F-21-R20] hai lượt cron trong cùng ngày VN → CÙNG khoá chống trùng", async () => {
    moiThuBinhThuong();
    await runMediaReviewOverdueNotify(SAU_HAN);
    await runMediaReviewOverdueNotify(new Date("2026-08-25T15:00:00.000Z"));
    const [a, b] = h.notify.mock.calls.map((c) => c[0].dedupeKey);
    expect(a).toBe(b);
    expect(a).toBe("media_review.overdue:s:s1:2026-08-25");
  });

  it("[F-21-R21] sang ngày hôm sau → khoá mới (việc còn treo thì còn được nhắc)", async () => {
    moiThuBinhThuong();
    await runMediaReviewOverdueNotify(SAU_HAN);
    await runMediaReviewOverdueNotify(new Date("2026-08-26T04:00:00.000Z"));
    const [a, b] = h.notify.mock.calls.map((c) => c[0].dedupeKey);
    expect(a).not.toBe(b);
  });

  it("[F-21-R22] quá hạn quá lâu → thôi nhắc, chuông không bị chôn sống", async () => {
    moiThuBinhThuong();
    const r = await runMediaReviewOverdueNotify(new Date("2026-09-30T04:00:00.000Z"));
    expect(r.overdue).toBe(0);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("[F-21-R23] nhiều ảnh cùng buổi → MỘT thông báo, có số lượng trong câu chữ", async () => {
    moiThuBinhThuong();
    h.media = [
      { id: "m1", classId: "clsA", classSessionId: "s1", takenAt: null, createdAt: new Date("2026-08-24T10:00:00.000Z") },
      { id: "m2", classId: "clsA", classSessionId: "s1", takenAt: null, createdAt: new Date("2026-08-24T10:01:00.000Z") },
      { id: "m3", classId: "clsA", classSessionId: "s1", takenAt: null, createdAt: new Date("2026-08-24T10:02:00.000Z") },
    ];
    await runMediaReviewOverdueNotify(SAU_HAN);
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify.mock.calls[0]![0].body).toContain("3");
    expect(h.notify.mock.calls[0]![0].body).toContain("CS1-R1");
  });

  it("[F-21-R24] không có ảnh chờ duyệt → không truy vấn thêm, không thông báo", async () => {
    const r = await runMediaReviewOverdueNotify(SAU_HAN);
    expect(r).toMatchObject({ scanned: 0, overdue: 0, notified: 0 });
    expect(h.notify).not.toHaveBeenCalled();
  });
});
