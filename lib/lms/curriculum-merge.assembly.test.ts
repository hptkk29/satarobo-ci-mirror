// [LR3D-M*] Gộp bài × tài liệu lắp ráp 3D (owner chốt 23/10/2026): gộp KHÔNG sao chép link bài nguồn,
// GIỮ link bài đích, và phải CẢNH BÁO rõ khi bài nguồn có link. Thuần — không DB.
import { describe, it, expect } from "vitest";
import {
  pickLessonContent,
  planLessonMerge,
  type SourceLesson,
  type TargetLesson,
} from "./curriculum-merge";

const URL_A = "https://www.zmrobo.net/modelmanual/model?modelUrl=Alpha%20Set%20A/03.Catapult%20Car";

const src = (order: number, over: Partial<SourceLesson> = {}): SourceLesson => ({
  id: `s${order}`,
  order,
  title: `Nguồn ${order}`,
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
  ...over,
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

const co = (n: number, over: Partial<TargetLesson> = {}) => Array.from({ length: n }, (_, i) => tgt(i + 1, over));
const DONG_GOP = /bài nguồn có tài liệu lắp ráp 3D/;

describe("planLessonMerge × tài liệu lắp ráp 3D", () => {
  it("[LR3D-M01] bài nguồn KHÔNG có link ⇒ không thêm cảnh báo lắp ráp nào", () => {
    const plan = planLessonMerge({ sources: [src(1), src(2)], targets: co(2), startOrder: 1 });
    expect(plan.warnings).toEqual([]);
    expect(plan.items.every((i) => i.warning === null)).toBe(true);
  });

  it("[LR3D-M02] nguồn có link, đích TRỐNG ⇒ cảnh báo 'sẽ KHÔNG có link', nêu đúng buổi đích", () => {
    const plan = planLessonMerge({ sources: [src(1, { assemblyManualUrl: URL_A }), src(2)], targets: co(2), startOrder: 1 });
    expect(plan.errors).toEqual([]);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toMatch(DONG_GOP);
    expect(plan.warnings[0]).toContain("buổi đích: 1)");
    expect(plan.warnings[0]).toContain("KHÔNG sao chép");
    expect(plan.warnings[0]).toContain("0 buổi đích đang có link riêng");
    expect(plan.warnings[0]).toContain("1 buổi đích sẽ KHÔNG có link lắp ráp");
    // Dòng xem trước của đúng buổi 1 mang ghi chú; buổi 2 thì không.
    expect(plan.items[0]!.warning).toContain("sẽ KHÔNG có link lắp ráp");
    expect(plan.items[1]!.warning).toBeNull();
  });

  it("[LR3D-M03] nguồn có link, đích CŨNG có link ⇒ nói link đích được GIỮ NGUYÊN (không phải 'sẽ trống')", () => {
    const plan = planLessonMerge({
      sources: [src(1, { assemblyManualUrl: URL_A })],
      targets: co(1, { attachmentCount: 1, hasAssemblyManual: true }),
      startOrder: 1,
    });
    expect(plan.warnings.join("\n")).toContain("1 buổi đích đang có link riêng: giữ nguyên");
    expect(plan.warnings.join("\n")).toContain("0 buổi đích sẽ KHÔNG có link lắp ráp");
    expect(plan.items[0]!.warning).toContain("link riêng của buổi này được giữ nguyên");
    expect(plan.items[0]!.warning).not.toContain("sẽ KHÔNG có link lắp ráp");
  });

  it("[LR3D-M04] bài nguồn có link vào buổi đích TẠO MỚI ⇒ vẫn cảnh báo (buổi mới chưa có link)", () => {
    const plan = planLessonMerge({ sources: [src(1), src(2, { assemblyManualUrl: URL_A })], targets: co(1), startOrder: 1 });
    expect(plan.createCount).toBe(1);
    expect(plan.warnings[0]).toContain("buổi đích: 2)");
    expect(plan.items[1]!.action).toBe("create");
    expect(plan.items[1]!.warning).toContain("KHÔNG sao chép");
  });

  it("[LR3D-M05] nhiều bài nguồn có link ⇒ MỘT dòng gộp liệt kê đủ các buổi đích và đếm đúng 'giữ' / 'trống'", () => {
    const targets = [tgt(1, { attachmentCount: 1, hasAssemblyManual: true }), tgt(2), tgt(3)];
    const plan = planLessonMerge({
      sources: [src(1, { assemblyManualUrl: URL_A }), src(2, { assemblyManualUrl: URL_A }), src(3)],
      targets,
      startOrder: 1,
    });
    const dong = plan.warnings.filter((w) => DONG_GOP.test(w));
    expect(dong).toHaveLength(1);
    expect(dong[0]).toContain("2 bài nguồn");
    expect(dong[0]).toContain("buổi đích: 1, 2)");
    expect(dong[0]).toContain("1 buổi đích đang có link riêng: giữ nguyên");
    expect(dong[0]).toContain("1 buổi đích sẽ KHÔNG có link lắp ráp");
  });

  it("[LR3D-M06] đích đã có học liệu khác + nguồn có link ⇒ cảnh báo cũ GIỮ NGUYÊN và cảnh báo lắp ráp đứng riêng (không nuốt nhau)", () => {
    const plan = planLessonMerge({
      sources: [src(1, { assemblyManualUrl: URL_A })],
      targets: co(1, { title: "Bài đã soạn", attachmentCount: 2 }),
      startOrder: 1,
    });
    expect(plan.warnings).toHaveLength(2);
    expect(plan.warnings[0]).toContain('đang có nội dung riêng ("Bài đã soạn")');
    expect(plan.warnings[0]).toContain("đã gắn 2 học liệu");
    expect(plan.warnings[1]).toMatch(DONG_GOP);
    expect(plan.items[0]!.warning).toContain("Ngoài ra:");
  });

  it("[LR3D-M07] đích LOCKED / lưu trữ ⇒ vẫn CHẶN như cũ và KHÔNG thêm cảnh báo lắp ráp thừa", () => {
    const plan = planLessonMerge({
      sources: [src(1, { assemblyManualUrl: URL_A }), src(2, { assemblyManualUrl: URL_A })],
      targets: [tgt(1, { status: "LOCKED" }), tgt(2, { archivedAt: new Date() })],
      startOrder: 1,
    });
    expect(plan.errors).toHaveLength(2);
    expect(plan.warnings.filter((w) => DONG_GOP.test(w))).toEqual([]);
  });

  it("[LR3D-M08] pickLessonContent KHÔNG mang link sang đích dù nguồn có (whitelist) — gộp không kế thừa", () => {
    const picked = pickLessonContent(src(1, { assemblyManualUrl: URL_A }));
    expect(Object.keys(picked).filter((k) => k.startsWith("assemblyManual"))).toEqual([]);
    expect(JSON.stringify(picked)).not.toContain("zmrobo");
  });
});
