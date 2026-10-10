import { describe, it, expect } from "vitest";
import {
  isPlaceholderTitle,
  pickLessonContent,
  planLessonMerge,
  type SourceLesson,
  type TargetLesson,
} from "./curriculum-merge";

const src = (order: number, title: string): SourceLesson => ({
  id: `s${order}`,
  order,
  title,
  description: null,
  content: null,
  duration: 90,
  objectives: [],
  materials: [],
  notes: null,
  teacherGuide: null,
  expectedOutput: null,
  homeworkDefault: null,
  assessmentCriteria: null,
});

const tgt = (order: number, over: Partial<TargetLesson> = {}): TargetLesson => ({
  id: `t${order}`,
  order,
  title: `Buổi ${order}`,
  status: "INCOMPLETE",
  archivedAt: null,
  attachmentCount: 0,
  ...over,
});

const sata1 = Array.from({ length: 16 }, (_, i) => src(i + 1, `S1 bài ${i + 1}`));
const sata2 = Array.from({ length: 16 }, (_, i) => src(i + 1, `S2 bài ${i + 1}`));
const combo32 = Array.from({ length: 32 }, (_, i) => tgt(i + 1));

describe("planLessonMerge", () => {
  it("Sata 1 vào buổi 1 → ghi đè 16 buổi đầu, không tạo mới", () => {
    const plan = planLessonMerge({ sources: sata1, targets: combo32, startOrder: 1 });
    expect(plan.errors).toEqual([]);
    expect(plan.overwriteCount).toBe(16);
    expect(plan.createCount).toBe(0);
    expect(plan.items[0].targetOrder).toBe(1);
    expect(plan.items[0].targetId).toBe("t1");
    expect(plan.items[15].targetOrder).toBe(16);
    expect(plan.items[15].sourceTitle).toBe("S1 bài 16");
  });

  it("Sata 2 vào buổi 17 → ghi đè đúng nửa sau, không đụng buổi 1–16", () => {
    const plan = planLessonMerge({ sources: sata2, targets: combo32, startOrder: 17 });
    expect(plan.errors).toEqual([]);
    expect(plan.items.map((i) => i.targetOrder)).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 17),
    );
    expect(plan.items.every((i) => i.action === "overwrite")).toBe(true);
  });

  it("giáo trình đích ngắn hơn → phần dư TẠO MỚI, không báo lỗi", () => {
    const plan = planLessonMerge({
      sources: sata1,
      targets: combo32.slice(0, 10),
      startOrder: 1,
    });
    expect(plan.errors).toEqual([]);
    expect(plan.overwriteCount).toBe(10);
    expect(plan.createCount).toBe(6);
    expect(plan.items[10].targetId).toBeNull();
    expect(plan.items[10].action).toBe("create");
  });

  it("bắt đầu quá xa cuối giáo trình → chặn (không để hổng buổi)", () => {
    const plan = planLessonMerge({
      sources: sata1,
      targets: combo32.slice(0, 10),
      startOrder: 20,
    });
    expect(plan.errors.join(" ")).toContain("không thể bắt đầu từ buổi 20");
  });

  it("buổi đích đang KHÓA hoặc đã lưu trữ → chặn, nêu đúng buổi nào", () => {
    const targets = [...combo32];
    targets[4] = tgt(5, { status: "LOCKED" });
    targets[7] = tgt(8, { archivedAt: new Date() });
    const plan = planLessonMerge({ sources: sata1, targets, startOrder: 1 });
    expect(plan.errors).toHaveLength(2);
    expect(plan.errors[0]).toContain("Buổi 5");
    expect(plan.errors[1]).toContain("Buổi 8");
  });

  it("buổi đích đã có nội dung riêng / đã gắn học liệu → CẢNH BÁO chứ không chặn", () => {
    const targets = [...combo32];
    targets[2] = tgt(3, { title: "Bài tự soạn của trung tâm" });
    targets[5] = tgt(6, { attachmentCount: 2 });
    const plan = planLessonMerge({ sources: sata1, targets, startOrder: 1 });
    expect(plan.errors).toEqual([]);
    expect(plan.warnings).toHaveLength(2);
    expect(plan.warnings[0]).toContain("Bài tự soạn của trung tâm");
    expect(plan.warnings[1]).toContain("2 học liệu");
  });

  it("nguồn rỗng / vị trí bắt đầu sai → báo lỗi rõ ràng", () => {
    expect(planLessonMerge({ sources: [], targets: combo32, startOrder: 1 }).errors[0]).toContain(
      "chưa có bài học",
    );
    expect(
      planLessonMerge({ sources: sata1, targets: combo32, startOrder: 0 }).errors[0],
    ).toContain("≥ 1");
  });

  it("isPlaceholderTitle chỉ đúng với ô trống 'Buổi N'", () => {
    expect(isPlaceholderTitle("Buổi 7", 7)).toBe(true);
    expect(isPlaceholderTitle("  Buổi 7  ", 7)).toBe(true);
    expect(isPlaceholderTitle("Buổi 7", 8)).toBe(false);
    expect(isPlaceholderTitle("Buổi 7 — Dò line", 7)).toBe(false);
  });

  it("pickLessonContent KHÔNG mang theo id/order và sao chép mảng (không chia sẻ tham chiếu)", () => {
    const s: SourceLesson = { ...src(1, "A"), objectives: ["a"], materials: ["m"] };
    const c = pickLessonContent(s);
    expect(c).not.toHaveProperty("id");
    expect(c).not.toHaveProperty("order");
    c.objectives.push("b");
    expect(s.objectives).toEqual(["a"]);
  });
});
