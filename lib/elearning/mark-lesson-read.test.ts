// @vitest-environment node
/**
 * EL-04 — `markLessonRead` qua action factory.
 *
 * Test gọi thẳng `runAction` với actor seed (đúng lý do factory tách lõi thuần ra
 * khỏi binding Next): không cần request, không cần `auth()`.
 *
 * Case đáng giá nhất là case ĐẦU TIÊN: nút này KHÔNG được cho phép bấm-để-hoàn-
 * thành. Nếu nó tự đặt `verifiedAt` thì toàn bộ cơ chế đo thành trang trí, và mọi
 * người sẽ mở bài rồi bấm ngay — mà không ai phát hiện, vì bảng vẫn đầy dòng
 * "đã hoàn thành".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  can: vi.fn(() => true),
  assertPolicy: vi.fn(async () => undefined),
  enrollment: null as unknown,
  lesson: null as unknown,
  progress: null as unknown,
  update: vi.fn(async (_a: { where: unknown; data: Record<string, unknown> }) => ({})),
  audit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth/can", () => ({ can: h.can }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.audit }));
vi.mock("@/lib/elearning/content-gate", () => ({
  assertPolicyForAction: h.assertPolicy,
}));
vi.mock("@/lib/db-scope", () => ({
  scopedDb: () => ({
    trnEnrollment: { findFirst: vi.fn(async () => h.enrollment) },
    trnLesson: { findFirst: vi.fn(async () => h.lesson) },
    trnLessonProgress: {
      findUnique: vi.fn(async () => h.progress),
      update: h.update,
    },
  }),
}));

import { runAction } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";
import { assertPolicyForAction } from "@/lib/elearning/content-gate";
import { isLessonDone } from "@/lib/elearning/reading";
import {
  effectiveAllowLate,
  isProgressWriteLocked,
  OVERDUE_LOCKED,
  OVERDUE_LOCKED_MESSAGE,
} from "@/lib/elearning/due-lock";
import { z } from "zod";

/**
 * Bản sao CẤU HÌNH của action thật. Không import từ `app/**\/_actions.ts` vì file
 * đó mang `"use server"` — nạp nó trong vitest kéo theo binding Next.
 * ⚠️ Có guard nguồn ở cuối file để hai bản không trôi khỏi nhau.
 */
const cfg = {
  name: "markLessonRead",
  permission: "elearning:lesson:learn",
  module: "elearning",
  entityType: "TrnLessonProgress",
  auditAction: "UPDATE",
  schema: z.object({
    enrollmentId: z.string().min(1),
    lessonId: z.string().min(1),
  }),
  handler: async ({
    db,
    actor,
    input,
  }: {
    db: never;
    actor: { userId: string };
    input: { enrollmentId: string; lessonId: string };
  }) => {
    await assertPolicyForAction(actor.userId);
    const d = db as unknown as {
      trnEnrollment: { findFirst: (a: unknown) => Promise<Record<string, never>> };
      trnLesson: { findFirst: (a: unknown) => Promise<Record<string, never>> };
      trnLessonProgress: {
        findUnique: (a: unknown) => Promise<Record<string, never>>;
        update: (a: unknown) => Promise<unknown>;
      };
    };
    const enrollment = (await d.trnEnrollment.findFirst({})) as unknown as {
      id: string;
      status: string;
      dueAt: Date | null;
      assignmentId: string | null;
      assignment: { allowLate: boolean } | null;
    } | null;
    if (!enrollment || enrollment.status === "REVOKED") {
      throw new ActionError("NOT_FOUND", "Không tìm thấy lượt học của bạn");
    }
    const lesson = (await d.trnLesson.findFirst({})) as unknown as {
      id: string;
      minReadSeconds: number;
    } | null;
    if (!lesson) throw new ActionError("NOT_FOUND", "Không tìm thấy bài học");

    const now = new Date();
    if (
      isProgressWriteLocked({
        dueAt: enrollment.dueAt,
        allowLate: effectiveAllowLate({
          assignmentId: enrollment.assignmentId,
          assignmentAllowLate: enrollment.assignment?.allowLate,
        }),
        now,
      })
    ) {
      throw new ActionError(OVERDUE_LOCKED, OVERDUE_LOCKED_MESSAGE);
    }

    const progress = (await d.trnLessonProgress.findUnique({})) as unknown as {
      id: string;
      readSeconds: number;
      scrollMaxPct: number;
      verifiedAt: Date | null;
    } | null;
    if (
      !progress ||
      !isLessonDone({
        readSeconds: progress.readSeconds,
        scrollMaxPct: progress.scrollMaxPct,
        minReadSeconds: lesson.minReadSeconds,
      })
    ) {
      throw new ActionError(
        "NOT_YET_DONE",
        "Chưa đủ điều kiện hoàn thành — cần đọc đủ thời gian và xem hết bài",
      );
    }
    if (progress.verifiedAt) {
      return { entityId: progress.id, data: { alreadyDone: true } };
    }
    await d.trnLessonProgress.update({
      where: { id: progress.id },
      data: { status: "DONE", verifiedAt: now, completedAt: now },
    });
    return { entityId: progress.id, data: { alreadyDone: false } };
  },
} as never;

const ACTOR = { userId: "u1", isSuperAdmin: false } as never;
const INPUT = { enrollmentId: "e1", lessonId: "l1" };
const META = { actorName: "Người học" };

beforeEach(() => {
  vi.clearAllMocks();
  h.can.mockReturnValue(true);
  h.assertPolicy.mockResolvedValue(undefined);
  h.enrollment = {
    id: "e1",
    status: "IN_PROGRESS",
    dueAt: null,
    assignmentId: null,
    assignment: null,
  };
  h.lesson = { id: "l1", minReadSeconds: 30 };
  h.progress = { id: "p1", readSeconds: 60, scrollMaxPct: 95, verifiedAt: null };
});

describe("KHÔNG cho bấm-để-hoàn-thành", () => {
  it("chưa đủ thời gian ⇒ NOT_YET_DONE, KHÔNG ghi", async () => {
    // Đây là case giữ cho cả cơ chế đo có nghĩa. Nếu nút tự đặt `verifiedAt` thì
    // mọi người mở bài rồi bấm ngay, và bảng vẫn đầy dòng "đã hoàn thành" nên
    // không ai phát hiện.
    h.progress = { id: "p1", readSeconds: 10, scrollMaxPct: 95, verifiedAt: null };
    const { res } = await runAction(cfg, ACTOR, INPUT, META);
    expect(res).toMatchObject({ ok: false, error: { code: "NOT_YET_DONE" } });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("đủ giờ nhưng chưa cuộn hết ⇒ vẫn NOT_YET_DONE", async () => {
    h.progress = { id: "p1", readSeconds: 600, scrollMaxPct: 40, verifiedAt: null };
    const { res } = await runAction(cfg, ACTOR, INPUT, META);
    expect(res).toMatchObject({ ok: false, error: { code: "NOT_YET_DONE" } });
  });

  it("chưa có dòng tiến độ nào ⇒ NOT_YET_DONE", async () => {
    h.progress = null;
    const { res } = await runAction(cfg, ACTOR, INPUT, META);
    expect(res).toMatchObject({ ok: false, error: { code: "NOT_YET_DONE" } });
  });

  it("đủ điều kiện ⇒ chốt, đặt verifiedAt", async () => {
    const { res } = await runAction(cfg, ACTOR, INPUT, META);
    expect(res).toMatchObject({ ok: true });
    const arg = h.update.mock.calls[0]?.[0];
    expect(arg?.data.status).toBe("DONE");
    expect(arg?.data.verifiedAt).toBeInstanceOf(Date);
  });
});

describe("mốc hoàn thành chỉ đặt MỘT LẦN", () => {
  it("đã có verifiedAt ⇒ không ghi lại, không đẩy mốc về sau", async () => {
    // Mọi chỉ số đúng-hạn đọc mốc này. Đọc lại bài sau khi đã hoàn thành mà làm
    // mốc trôi thì một người đúng hạn có thể thành trễ, hoặc ngược lại.
    h.progress = {
      id: "p1",
      readSeconds: 600,
      scrollMaxPct: 100,
      verifiedAt: new Date("2026-08-01T00:00:00Z"),
    };
    const { res } = await runAction(cfg, ACTOR, INPUT, META);
    expect(res).toMatchObject({ ok: true });
    expect(h.update).not.toHaveBeenCalled();
  });
});

describe("các cổng khác", () => {
  it("thiếu quyền học ⇒ PERMISSION_DENIED trước mọi thứ", async () => {
    h.can.mockReturnValue(false);
    const { res } = await runAction(cfg, ACTOR, INPUT, META);
    expect(res).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED" } });
    expect(h.assertPolicy).not.toHaveBeenCalled();
  });

  it("chưa chấp nhận chính sách ⇒ chặn, và lỗi phải là ActionError", async () => {
    // `PolicyNotAcceptedError` không phải `ActionError` ⇒ ném thẳng là màn 500.
    // `assertPolicyForAction` tồn tại đúng để map, và case này pin điều đó.
    h.assertPolicy.mockRejectedValue(
      new ActionError("POLICY_NOT_ACCEPTED", "Chưa xác nhận chính sách"),
    );
    const { res } = await runAction(cfg, ACTOR, INPUT, META);
    expect(res).toMatchObject({
      ok: false,
      error: { code: "POLICY_NOT_ACCEPTED" },
    });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("quá hạn + không cho trễ ⇒ OVERDUE_LOCKED", async () => {
    h.enrollment = {
      ...(h.enrollment as object),
      dueAt: new Date("2020-01-01T00:00:00Z"),
    };
    const { res } = await runAction(cfg, ACTOR, INPUT, META);
    expect(res).toMatchObject({ ok: false, error: { code: OVERDUE_LOCKED } });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("lượt không thuộc về mình ⇒ NOT_FOUND", async () => {
    h.enrollment = null;
    const { res } = await runAction(cfg, ACTOR, INPUT, META);
    expect(res).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });
});

describe("hai bản cấu hình không được trôi khỏi nhau", () => {
  it("action thật giữ đúng các mốc mà test này giả lập", async () => {
    // Test dựng lại handler vì file thật mang `"use server"`. Guard nguồn để nếu
    // ai đó sửa action thật mà quên sửa ở đây, ta biết ngay thay vì tin một test
    // đang kiểm phiên bản cũ.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(process.cwd(), "app/(elearning)/elearning/_actions.ts"),
      "utf8",
    );
    for (const moc of [
      "assertPolicyForAction",
      "NOT_YET_DONE",
      "isLessonDone",
      "isProgressWriteLocked",
      "effectiveAllowLate",
      "progress.verifiedAt",
      'permission: "elearning:lesson:learn"',
    ]) {
      expect(src, moc).toContain(moc);
    }
  });

  it("file 'use server' KHÔNG export hằng số — chỉ hàm async", async () => {
    // `export const` lạc vào file `"use server"` làm Server Action vỡ LÚC CHẠY
    // (E352) mà `pnpm build` vẫn xanh.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(process.cwd(), "app/(elearning)/elearning/_actions.ts"),
      "utf8",
    );
    const exports = [...src.matchAll(/^export\s+(const|function|async)\s+(\w+)/gm)];
    for (const m of exports) {
      // `defineAction(...)` trả về một hàm async, nên `export const x = defineAction`
      // là hợp lệ; mọi `export const` KHÁC thì không.
      if (m[1] === "const") {
        const sau = src.slice(m.index ?? 0, (m.index ?? 0) + 200);
        expect(sau, m[2]).toContain("defineAction(");
      }
    }
  });
});
