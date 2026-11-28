import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NHAN_LOAI_CAU, nhanLoaiCau } from "./nhan-loai-cau";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const giaTriEnum = (() => {
  const m = schema.match(/enum TrnQuestionType \{([\s\S]*?)\n\}/);
  expect(m, "không thấy enum TrnQuestionType trong schema").not.toBeNull();
  return m![1]!
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim())
    .filter((l) => /^[A-Z_]+$/.test(l));
})();

describe("[NLC-01] nhãn loại câu hỏi", () => {
  it("🔴 MỌI giá trị của enum TrnQuestionType đều có nhãn (thêm loại mới mà quên nhãn ⇒ đỏ, không rơi ra mã thô trên màn)", () => {
    expect(giaTriEnum.length).toBeGreaterThanOrEqual(14);
    for (const v of giaTriEnum) expect(NHAN_LOAI_CAU[v], v).toBeTruthy();
  });
  it("không có nhãn thừa cho loại không còn trong enum, và không có hai loại trùng nhãn", () => {
    expect(Object.keys(NHAN_LOAI_CAU).sort()).toEqual([...giaTriEnum].sort());
    const nhan = Object.values(NHAN_LOAI_CAU);
    expect(new Set(nhan).size).toBe(nhan.length);
  });
  it("loại lạ rơi về mã gốc (không bịa nhãn)", () => {
    expect(nhanLoaiCau("SINGLE")).toBe("Chọn một");
    expect(nhanLoaiCau("LOAI_MOI_CHUA_KHAI")).toBe("LOAI_MOI_CHUA_KHAI");
  });
});
