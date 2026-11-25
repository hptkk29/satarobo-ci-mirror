// [GY-04..07] — Cổng phụ huynh (03/11/2026): «chỉ cần 1 khảo sát cho 1 mục góp ý», KHÔNG khảo sát sau học thử / giữa khoá / cuối khoá.
//   [GY-04] hàm thuần: chỉ GENERAL là «mục góp ý» (đối chứng dương: GENERAL hiện); 4 mốc hành trình + AFTER_COMPLAINT không
//   [GY-05] bộ nạp THẬT (`getCenterSurveys`) hỏi DB với điều kiện milestone = GENERAL — cả nhánh có câu hỏi lẫn không
//   [GY-06] trang khảo sát cũ + hành động gửi khảo sát cùng dùng một điều kiện (đọc nguồn, neo vào lời gọi)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    student: { findUnique: vi.fn(async () => ({ centerId: "c1", preferredCenterId: null })) },
    survey: { findMany },
    surveyResponse: { findMany: vi.fn(async () => []) },
  },
}));

import { dieuKienKhaoSatMucGopY, laKhaoSatMucGopY } from "@/lib/portal/gop-y-thuan";
import { getCenterSurveys } from "@/lib/portal/surveys";

beforeEach(() => findMany.mockReset());

describe("[GY-04] mốc khảo sát nào là «mục góp ý»", () => {
  it("GENERAL hiện (đối chứng dương)", () => {
    expect(laKhaoSatMucGopY("GENERAL")).toBe(true);
    expect(dieuKienKhaoSatMucGopY()).toEqual({ milestone: "GENERAL" });
  });
  it("sau học thử · sau 3 buổi · giữa khoá · cuối khoá · sau khiếu nại KHÔNG hiện", () => {
    for (const m of ["AFTER_TRIAL", "AFTER_3_SESSIONS", "MID_COURSE", "END_COURSE", "AFTER_COMPLAINT"]) {
      expect(laKhaoSatMucGopY(m), m).toBe(false);
    }
  });
});

describe("[GY-05] bộ nạp khảo sát của cổng", () => {
  const dong = { id: "s1", title: "Cơ sở vật chất", description: null, createdAt: new Date("2026-11-01T00:00:00Z") };
  it("có câu hỏi: where mang milestone GENERAL", async () => {
    findMany.mockResolvedValue([{ ...dong, questions: [] }]);
    const r = await getCenterSurveys("st1");
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0]?.[0]?.where).toMatchObject({ isActive: true, milestone: "GENERAL" });
    expect(r.cards.map((c) => c.id)).toEqual(["s1"]);
  });
  it("chỉ đếm (withQuestions=false, nguồn của chuông thông báo): where cũng mang milestone GENERAL", async () => {
    findMany.mockResolvedValue([dong]);
    await getCenterSurveys("st1", { withQuestions: false });
    expect(findMany.mock.calls[0]?.[0]?.where).toMatchObject({ milestone: "GENERAL" });
  });
});

const boChuThich = (s: string) =>
  s
    .split(/\r?\n/)
    .filter((d) => !/^\s*\/\//.test(d))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(\s)\/\/.*$/gm, "$1");
const doc = (p: string) => boChuThich(readFileSync(resolve(process.cwd(), p), "utf8"));

describe("[GY-06] mọi truy vấn Survey của cổng đi qua cùng điều kiện", () => {
  it("trang khảo sát (nhánh cũ) và hành động gửi khảo sát", () => {
    expect(doc("app/(portal)/portal/khao-sat/page.tsx").match(/\.\.\.dieuKienKhaoSatMucGopY\(\)/g)).toHaveLength(1);
    expect(doc("app/(portal)/portal/khao-sat/_actions.ts").match(/\.\.\.dieuKienKhaoSatMucGopY\(\)/g)).toHaveLength(1);
    expect(doc("lib/portal/surveys.ts").match(/\.\.\.dieuKienKhaoSatMucGopY\(\)/g)).toHaveLength(1);
  });
  it("màn Góp ý không còn nhắc khảo sát sau học thử / giữa khoá / cuối khoá", () => {
    const man = readFileSync(resolve(process.cwd(), "components/portal/gop-y-phu-huynh.tsx"), "utf8");
    expect(man).toMatch(/Góp ý theo từng mục/);
    expect(man).not.toMatch(/sau (buổi )?học thử|giữa khoá|cuối khoá/i);
  });
});
