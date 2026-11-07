// @vitest-environment node
/**
 * P1·4 — cách ly cơ sở của báo cáo R2 (kiểm toán 23/10/2026).
 *
 * `TrnLessonProgress` / `TrnVideoSession` là bảng CON, không nằm trong `SCOPED_MODELS` ⇒
 * `scopedDb` không lọc chúng. Trước khi vá, `dungR2ChoBai` đọc thẳng bằng `db` và
 * CENTER_MANAGER cơ sở này thấy nhịp xem (thời gian xem, số lần tua, cờ tập trung) của người
 * học cơ sở khác. Cổng cách ly là `TrnEnrollment` (mang `centerId`): test này khoá rằng mọi
 * truy vấn bảng con bị giới hạn vào đúng danh sách lượt học trong tầm nhìn.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  lessonFind: vi.fn(),
  progressFind: vi.fn(async (_a: unknown) => [] as unknown[]),
  sessionGroup: vi.fn(async (_a: unknown) => [] as unknown[]),
  enrollmentFind: vi.fn(async (_a: unknown) => [] as { id: string }[]),
  banChupFind: vi.fn(async (_a: unknown) => [] as unknown[]),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    trnLesson: { findUnique: h.lessonFind },
    trnLessonProgress: { findMany: h.progressFind },
    trnVideoSession: { groupBy: h.sessionGroup },
    trnLessonProgressRevision: { findMany: h.banChupFind },
  },
}));

import { dungR2ChoBai } from "@/lib/elearning/report-r2";
import type { ScopedDb } from "@/lib/actions/factory";

const sdb = { trnEnrollment: { findMany: h.enrollmentFind } } as unknown as ScopedDb;

const TIEN_DO = (userId: string) => ({
  userId,
  enrollmentId: `en-${userId}`,
  mediaRevision: 1,
  status: "IN_PROGRESS",
  segmentBitmap: null,
  segmentSec: 10,
  coveredSec: 100,
  contentSec: 600,
  totalWatchSec: 120,
  maxPositionSec: 300,
  seekCount: 1,
  blockedSeekCount: 0,
  attnAskedCount: 0,
  attnPassedCount: 0,
  bitmapPurgedAt: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.lessonFind.mockResolvedValue({ id: "l1", title: "Bài video", durationSec: 600, mediaRevision: 1 });
  h.banChupFind.mockResolvedValue([]);
  h.progressFind.mockResolvedValue([TIEN_DO("u-cs1")]);
  h.sessionGroup.mockResolvedValue([{ userId: "u-cs1", _count: { _all: 2 } }]);
});

describe("R2 chỉ đọc nhịp xem của lượt học TRONG tầm nhìn", () => {
  it("hỏi lượt học qua scopedDb, rồi khoá CẢ HAI truy vấn bảng con vào đúng danh sách đó", async () => {
    h.enrollmentFind.mockResolvedValue([{ id: "en-cs1" }]);
    const dong = await dungR2ChoBai(sdb, "l1");

    // cổng cách ly là truy vấn qua scopedDb, theo đúng bài đang xem
    expect(h.enrollmentFind).toHaveBeenCalledWith({
      where: { lessonProgress: { some: { lessonId: "l1" } } },
      select: { id: true },
    });
    const prog = h.progressFind.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(prog.where).toMatchObject({ lessonId: "l1", enrollmentId: { in: ["en-cs1"] } });
    const sess = h.sessionGroup.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(sess.where).toMatchObject({ lessonId: "l1", enrollmentId: { in: ["en-cs1"] } });
    expect(dong).toHaveLength(1);
    expect(dong[0]).toMatchObject({ userId: "u-cs1", soPhien: 2 });
  });

  it("KHÔNG có lượt học nào trong tầm nhìn ⇒ rỗng và KHÔNG chạm bảng con", async () => {
    // Người cấp cơ sở mở bài mà chỉ người cơ sở khác đang học: phải thấy trống,
    // không phải thấy người của cơ sở khác.
    h.enrollmentFind.mockResolvedValue([]);
    const dong = await dungR2ChoBai(sdb, "l1");
    expect(dong).toEqual([]);
    expect(h.progressFind).not.toHaveBeenCalled();
    expect(h.sessionGroup).not.toHaveBeenCalled();
  });

  it("bài không tồn tại ⇒ rỗng, không hỏi gì thêm", async () => {
    h.lessonFind.mockResolvedValue(null);
    expect(await dungR2ChoBai(sdb, "khong-co")).toEqual([]);
    expect(h.enrollmentFind).not.toHaveBeenCalled();
  });

  it("ĐỐI CHỨNG: danh sách trong tầm nhìn có 2 lượt ⇒ cả hai vào bộ lọc, không mất ai", async () => {
    h.enrollmentFind.mockResolvedValue([{ id: "en-a" }, { id: "en-b" }]);
    await dungR2ChoBai(sdb, "l1");
    const prog = h.progressFind.mock.calls[0]?.[0] as { where: { enrollmentId: { in: string[] } } };
    expect(prog.where.enrollmentId.in).toEqual(["en-a", "en-b"]);
  });
});

describe("R2 phân biệt PHIÊN BẢN nội dung — DONE cũ không đọc được như DONE của video hiện tại", () => {
  it("🔴 lượt còn ở phiên bản CŨ của bài ⇒ `laBanCu: true`, kèm phiên bản của hàng và của bài", async () => {
    h.lessonFind.mockResolvedValue({ id: "l1", title: "Bài video", durationSec: 600, mediaRevision: 3 });
    h.enrollmentFind.mockResolvedValue([{ id: "en-u-cs1" }]);
    h.progressFind.mockResolvedValue([{ ...TIEN_DO("u-cs1"), mediaRevision: 1, status: "DONE" }]);
    const [d] = await dungR2ChoBai(sdb, "l1");
    expect(d).toMatchObject({ phienBan: 1, phienBanBai: 3, laBanCu: true, trangThai: "DONE" });
  });

  it("ĐỐI CHỨNG: hàng ở ĐÚNG phiên bản hiện tại ⇒ `laBanCu: false`", async () => {
    h.lessonFind.mockResolvedValue({ id: "l1", title: "Bài video", durationSec: 600, mediaRevision: 3 });
    h.enrollmentFind.mockResolvedValue([{ id: "en-u-cs1" }]);
    h.progressFind.mockResolvedValue([{ ...TIEN_DO("u-cs1"), mediaRevision: 3 }]);
    const [d] = await dungR2ChoBai(sdb, "l1");
    expect(d?.laBanCu).toBe(false);
  });

  it("lịch sử phiên bản đến từ bản chụp, khoá CÙNG danh sách lượt học trong tầm nhìn (cách ly cơ sở), và chỉ gồm phiên bản CŨ HƠN hàng hiện hành", async () => {
    h.lessonFind.mockResolvedValue({ id: "l1", title: "Bài video", durationSec: 600, mediaRevision: 3 });
    h.enrollmentFind.mockResolvedValue([{ id: "en-u-cs1" }]);
    h.progressFind.mockResolvedValue([{ ...TIEN_DO("u-cs1"), mediaRevision: 3 }]);
    h.banChupFind.mockResolvedValue([
      { enrollmentId: "en-u-cs1", mediaRevision: 1, status: "DONE", coveredSec: 600, completedAt: new Date("2026-09-01") },
      { enrollmentId: "en-u-cs1", mediaRevision: 2, status: "IN_PROGRESS", coveredSec: 90, completedAt: null },
      { enrollmentId: "en-u-cs1", mediaRevision: 3, status: "IN_PROGRESS", coveredSec: 5, completedAt: null },
    ]);
    const [d] = await dungR2ChoBai(sdb, "l1");
    expect(d?.lichSu.map((x) => [x.rev, x.trangThai])).toEqual([[1, "DONE"], [2, "IN_PROGRESS"]]);
    const q = h.banChupFind.mock.calls[0]?.[0] as { where: Record<string, unknown>; select: Record<string, boolean> };
    expect(q.where).toMatchObject({ lessonId: "l1", enrollmentId: { in: ["en-u-cs1"] } });
    expect(q.select.segmentBitmap).toBeUndefined(); // không kéo bitmap của video đã thay
  });

  it("không có lượt trong tầm nhìn ⇒ KHÔNG chạm bảng bản chụp", async () => {
    h.enrollmentFind.mockResolvedValue([]);
    await dungR2ChoBai(sdb, "l1");
    expect(h.banChupFind).not.toHaveBeenCalled();
  });
});
