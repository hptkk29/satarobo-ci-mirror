// @vitest-environment node
/**
 * EL-04 — GHI NHỊP ĐỌC: thứ tự cổng và các đường bị chặn.
 *
 * Case đáng giá ở đây toàn là case BỊ TỪ CHỐI. Đường thành công chỉ có một, và
 * nó không bao giờ là chỗ sai; chỗ sai là một cổng bị bỏ qua, hoặc bị kiểm sai
 * thứ tự rồi rò thông tin qua thông báo lỗi.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  can: vi.fn(() => true),
  assertPolicy: vi.fn(async () => undefined),
  enrollment: null as unknown,
  lesson: null as unknown,
  course: null as unknown,
  progress: null as unknown,
  // Tham số phải được KHAI KIỂU: `vi.fn(async () => ...)` không tham số thì
  // `mock.calls[0]` là tuple RỖNG và `calls[0][0].update` không biên dịch được.
  // Vitest vẫn xanh — chỉ `tsc` bắt. Đã vấp đúng lỗi này một lần ở EL-01 PR3.
  upsert: vi.fn(
    async (_args: {
      where: unknown;
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }) => ({}),
  ),
  // Khai TRONG `vi.hoisted`: `vi.mock` được hoist lên đầu file, nên một `class`
  // khai ở thân file sẽ chưa khởi tạo lúc factory chạy.
  PolicyErr: class PolicyErr extends Error {},
}));

vi.mock("@/lib/auth/can", () => ({ can: h.can }));
vi.mock("@/lib/elearning/policy-acceptance", () => ({
  assertPolicyAccepted: h.assertPolicy,
  PolicyNotAcceptedError: h.PolicyErr,
}));
vi.mock("@/lib/db", () => ({
  db: {
    trnEnrollment: { findFirst: vi.fn(async () => h.enrollment) },
    trnLesson: { findFirst: vi.fn(async () => h.lesson) },
    trnCourse: { findUnique: vi.fn(async () => h.course) },
    trnLessonProgress: {
      findUnique: vi.fn(async () => h.progress),
      upsert: h.upsert,
    },
  },
}));

import { ghiNhipDoc } from "./reading-progress";

const ACTOR = { userId: "u1" } as never;
const NOW = new Date("2026-09-01T10:00:00+07:00");

const NHIP = {
  actor: ACTOR,
  enrollmentId: "e1",
  lessonId: "l1",
  readSeconds: 40,
  scrollMaxPct: 95,
  seq: 1,
  now: NOW,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.can.mockReturnValue(true);
  h.assertPolicy.mockResolvedValue(undefined);
  h.enrollment = {
    id: "e1",
    courseId: "c1",
    status: "IN_PROGRESS",
    dueAt: null,
    assignmentId: null,
    assignment: null,
  };
  h.lesson = { id: "l1", minReadSeconds: 30 };
  h.course = {
    id: "c1",
    visibility: "ASSIGNED_ONLY",
    selfEnrollEnabled: false,
    securityLevel: "INTERNAL",
    versions: [{ id: "v1" }],
  };
  h.progress = null;
});

describe("đường thành công", () => {
  it("nhịp ĐẦU TIÊN bị trần `db + 20` kẹp — không thể xong ngay nhịp đầu", async () => {
    // Đây là hành vi ĐÚNG, không phải giới hạn phiền toái: chưa có dòng nào trong DB
    // thì `db = 0`, trần là 20 giây. Một client báo 40 ở nhịp đầu hoặc là nhịp trễ, hoặc
    // là bơm số — và không phân biệt được hai ca. Cắt về 20 là hướng an toàn, và các
    // nhịp sau tự bù lại vì trần nâng theo giá trị đã lưu.
    const r = await ghiNhipDoc(NHIP);
    expect(r).toMatchObject({ ok: true, done: false });
    const arg = h.upsert.mock.calls[0]?.[0];
    expect(arg.create.readSeconds).toBe(20);
  });

  it("nhịp sau, khi DB đã có số ⇒ đủ ngưỡng và DONE", async () => {
    h.progress = { readSeconds: 25, scrollMaxPct: 90, seq: 1, verifiedAt: null };
    const r = await ghiNhipDoc({ ...NHIP, seq: 2 });
    expect(r).toMatchObject({ ok: true, done: true });
    const arg = h.upsert.mock.calls[0]?.[0];
    expect(arg.update.verifiedAt).toBeInstanceOf(Date);
  });

  it("chưa đủ ngưỡng ⇒ IN_PROGRESS, không đặt verifiedAt", async () => {
    const r = await ghiNhipDoc({ ...NHIP, readSeconds: 10, scrollMaxPct: 50 });
    expect(r).toMatchObject({ ok: true, done: false });
    const arg = h.upsert.mock.calls[0]?.[0];
    expect(arg.create.status).toBe("IN_PROGRESS");
    expect(arg.create.verifiedAt).toBeUndefined();
  });
});

describe("chống IDOR — hai vế, không phải một", () => {
  it("lượt ghi danh không thuộc về mình ⇒ NOT_FOUND, KHÔNG ghi gì", async () => {
    h.enrollment = null;
    const r = await ghiNhipDoc(NHIP);
    expect(r).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("có lượt hợp lệ NHƯNG bài thuộc khoá khác ⇒ vẫn NOT_FOUND", async () => {
    // Vế thứ hai, hay bị quên: một lượt ghi danh hợp lệ KHÔNG cho phép ghi tiến
    // độ lên bài của khoá khác. Thiếu vế này thì ai có một lượt học bất kỳ đều
    // ghi được tiến độ lên mọi bài trong hệ thống.
    h.lesson = null;
    const r = await ghiNhipDoc(NHIP);
    expect(r).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("hai ca 'không tồn tại' và 'không phải của mình' trả CÙNG thông báo", async () => {
    // Phân biệt hai ca là nói cho người dò biết id nào có thật.
    h.enrollment = null;
    const a = await ghiNhipDoc(NHIP);
    h.enrollment = {
      id: "e1",
      courseId: "c1",
      status: "IN_PROGRESS",
      dueAt: null,
      assignmentId: null,
      assignment: null,
    };
    h.lesson = null;
    const b = await ghiNhipDoc(NHIP);
    expect(a).toMatchObject({ code: "NOT_FOUND" });
    expect(b).toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("các cổng chặn — không cổng nào được bỏ qua", () => {
  it("thiếu quyền học ⇒ chặn TRƯỚC khi chạm DB", async () => {
    h.can.mockReturnValue(false);
    const r = await ghiNhipDoc(NHIP);
    expect(r).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("chưa chấp nhận chính sách ⇒ 0 dòng tiến độ được ghi", async () => {
    // Kiểm SAU khi ghi là đã thu mất một nhịp của người chưa đồng ý, và một nhịp
    // đã ghi thì không "chưa thu" lại được.
    h.assertPolicy.mockRejectedValue(new h.PolicyErr("chưa xác nhận"));
    const r = await ghiNhipDoc(NHIP);
    expect(r).toMatchObject({ ok: false, code: "POLICY_NOT_ACCEPTED" });
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("lượt đã thu hồi ⇒ chặn", async () => {
    h.enrollment = { ...(h.enrollment as object), status: "REVOKED" };
    expect(await ghiNhipDoc(NHIP)).toMatchObject({ ok: false, code: "REVOKED" });
  });

  it("khoá chưa có phiên bản xuất bản ⇒ chặn", async () => {
    h.course = { ...(h.course as object), versions: [] };
    expect(await ghiNhipDoc(NHIP)).toMatchObject({ ok: false, code: "NOT_PUBLISHED" });
  });
});

describe("khoá sau hạn", () => {
  const QUA_HAN = { ...NHIP, now: new Date("2026-09-02T10:00:00+07:00") };
  const HAN = new Date("2026-09-01T17:00:00+07:00");

  it("quá hạn + không cho trễ ⇒ OVERDUE_LOCKED, 0 dòng ghi", async () => {
    h.enrollment = { ...(h.enrollment as object), dueAt: HAN };
    const r = await ghiNhipDoc(QUA_HAN);
    expect(r).toMatchObject({ ok: false, code: "OVERDUE_LOCKED" });
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("quá hạn + lượt giao CHO trễ ⇒ vẫn ghi được", async () => {
    h.enrollment = {
      ...(h.enrollment as object),
      dueAt: HAN,
      assignmentId: "a1",
      assignment: { allowLate: true },
    };
    expect(await ghiNhipDoc(QUA_HAN)).toMatchObject({ ok: true });
  });

  it("quá hạn + KHÔNG gắn lượt giao ⇒ KHOÁ (fail-closed)", async () => {
    // Nhóm sinh tự động (tương đương, auto từ yêu cầu, tự ghi danh) là nhóm đông
    // nhất. Mặc định cho trễ ở đây là mở toang hạn chót cho gần hết hệ thống.
    h.enrollment = { ...(h.enrollment as object), dueAt: HAN, assignmentId: null };
    expect(await ghiNhipDoc(QUA_HAN)).toMatchObject({ code: "OVERDUE_LOCKED" });
  });
});

describe("chống bơm số và nhịp đảo thứ tự", () => {
  it("client báo 99999 ⇒ bị kẹp về db + biên", async () => {
    h.progress = { readSeconds: 100, scrollMaxPct: 50, seq: 1, verifiedAt: null };
    await ghiNhipDoc({ ...NHIP, readSeconds: 99999, seq: 2 });
    const arg = h.upsert.mock.calls[0]?.[0];
    expect(arg.update.readSeconds).toBe(120);
  });

  it("nhịp seq cũ hơn ⇒ bỏ, KHÔNG ghi, và KHÔNG báo lỗi", async () => {
    // Với người dùng thì không có gì sai; một lỗi ở đây sẽ hiện lên giữa lúc họ
    // đang đọc.
    h.progress = { readSeconds: 200, scrollMaxPct: 95, seq: 9, verifiedAt: NOW };
    const r = await ghiNhipDoc({ ...NHIP, seq: 3 });
    expect(r).toMatchObject({ ok: true, done: true });
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("verifiedAt đã có ⇒ KHÔNG ghi đè, mốc 'lần đầu đạt' giữ nguyên", async () => {
    // Đọc lại bài sau khi đã hoàn thành không được đẩy mốc hoàn thành về sau —
    // mọi chỉ số đúng-hạn đọc mốc đó.
    h.progress = { readSeconds: 300, scrollMaxPct: 100, seq: 1, verifiedAt: NOW };
    await ghiNhipDoc({ ...NHIP, seq: 2 });
    const arg = h.upsert.mock.calls[0]?.[0];
    expect(arg.update.verifiedAt).toBeUndefined();
  });
});
