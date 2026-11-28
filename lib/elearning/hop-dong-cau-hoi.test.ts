// @vitest-environment node
/**
 * [HDC-*] HỢP ĐỒNG câu hỏi dùng chung với site giáo viên / portal (`contentQuestionSchema`) + enum `TrnQuestionType` — P6 (D1).
 *
 * P6 thêm loại câu MỚI, nhưng hợp đồng dùng chung KHÔNG được đổi: site GV/portal parse `contentJson` bằng `contentQuestionSchema` và có `switch` theo `type`.
 * Loại mới của e-learning có khuôn RIÊNG (`cauSoSchema`…). Lưới này khoá hai điều:
 *  · MỖI loại cũ vẫn parse y như trước (mẫu cố định, không sinh từ chính schema) — thêm/sửa/gỡ một loại dùng chung là đỏ;
 *  · loại e-learning-riêng KHÔNG lọt vào hợp đồng dùng chung (nếu lọt, `switch` ở site GV/portal gặp loại nó không biết).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contentQuestionSchema } from "@/lib/assignments/question-content-db";
import { cauSoSchema } from "./cham-so";

const MAU: Record<string, unknown> = {
  single: { id: "a", type: "single", question: "Q?", options: ["x", "y"], correctIndex: 1 },
  multiple: { id: "a", type: "multiple", question: "Q?", options: ["x", "y", "z"], correctIndices: [0, 2] },
  boolean: { id: "a", type: "boolean", question: "Q?", correct: true },
  fill: { id: "a", type: "fill", question: "Q ___ ?", answers: ["đáp án"] },
  short: { id: "a", type: "short", question: "Q?", sampleAnswer: "mẫu" },
  essay: { id: "a", type: "essay", question: "Q?" },
  matching: { id: "a", type: "matching", question: "Q?", pairs: [{ left: "1", right: "một" }, { left: "2", right: "hai" }] },
  ordering: { id: "a", type: "ordering", question: "Q?", items: ["đầu", "giữa", "cuối"] },
  video: { id: "a", type: "video", question: "Q?" },
};

describe("[HDC-01] hợp đồng dùng chung: chín loại hiện có vẫn parse (tương thích ngược)", () => {
  for (const [loai, mau] of Object.entries(MAU)) {
    it(`loại ${loai}`, () => {
      expect(contentQuestionSchema.safeParse(mau).success, loai).toBe(true);
    });
  }
  it("đúng chín loại — không thêm, không bớt (thêm loại vào hợp đồng dùng chung phải là quyết định riêng với site GV/portal)", () => {
    const hop = (contentQuestionSchema as unknown as { options: { shape: { type: { value: string } } }[] }).options.map((o) => o.shape.type.value).sort();
    expect(hop).toEqual(Object.keys(MAU).sort());
  });
});

describe("[HDC-02] loại của e-learning KHÔNG lọt vào hợp đồng dùng chung", () => {
  const SO = { id: "n1", type: "numeric", question: "Q?", answer: 60, tolerance: 1, unit: "cm" };
  it("đối chứng dương: câu nhập số hợp lệ với khuôn RIÊNG của e-learning", () => {
    expect(cauSoSchema.safeParse(SO).success).toBe(true);
  });
  it("🔴 câu nhập số KHÔNG parse bằng hợp đồng dùng chung", () => {
    expect(contentQuestionSchema.safeParse(SO).success).toBe(false);
  });
});

describe("[HDC-03] enum TrnQuestionType: chín giá trị cũ giữ nguyên thứ tự, năm giá trị mới thêm cuối (ADD-only)", () => {
  const s = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8").replace(/\r\n/g, "\n");
  const khoi = /enum TrnQuestionType \{([\s\S]*?)\n\}/.exec(s)?.[1] ?? "";
  const giaTri = khoi
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("///"));
  it("thứ tự", () => {
    expect(giaTri).toEqual([
      "SINGLE", "MULTIPLE", "TRUE_FALSE", "FILL_BLANK", "MATCHING", "ORDERING", "SHORT_ANSWER", "CASE", "ESSAY",
      "CLASSIFY", "IMAGE_HOTSPOT", "NUMERIC", "PRODUCT", "BLOCK_SEQUENCE",
    ]);
  });
  it("migration D1 chỉ ADD VALUE (không DROP/RENAME), và KHÔNG dùng giá trị mới trong cùng tệp", () => {
    const m = readFileSync(resolve(process.cwd(), "prisma/migrations/20261203120000_p6_d1_loai_cau_hoi_moi/migration.sql"), "utf8");
    const lenh = m.split("\n").filter((l) => !l.trim().startsWith("--") && l.trim());
    expect(lenh.length).toBe(5);
    for (const l of lenh) expect(l).toMatch(/^ALTER TYPE "TrnQuestionType" ADD VALUE IF NOT EXISTS '[A-Z_]+';$/);
  });
  it("migration D2 chỉ thêm HAI cột JSONB nullable vào TrnExamAnswer", () => {
    const m = readFileSync(resolve(process.cwd(), "prisma/migrations/20261203130000_p6_d2_dap_an_json/migration.sql"), "utf8");
    const lenh = m.split("\n").filter((l) => !l.trim().startsWith("--") && l.trim());
    expect(lenh).toEqual([
      'ALTER TABLE "TrnExamAnswer" ADD COLUMN IF NOT EXISTS "answerJson" JSONB;',
      'ALTER TABLE "TrnExamAnswer" ADD COLUMN IF NOT EXISTS "attachmentsJson" JSONB;',
    ]);
  });
});
