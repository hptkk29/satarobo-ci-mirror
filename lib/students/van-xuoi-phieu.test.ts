import { describe, expect, it } from "vitest";
import { EMPTY_NOTES } from "@/lib/lms/session-eval-rubric";
import { vanXuoiPhieu } from "./van-xuoi-phieu";

describe("vanXuoiPhieu — chữ hiện trên thẻ nhận xét", () => {
  it("[VXP-01] 'Đánh giá chung' thắng 4 mục cũ và comment", () => {
    expect(vanXuoiPhieu({ notes: { ...EMPTY_NOTES, overall: "X", knowledge: "Y" }, comment: "Z" })).toBe("X");
  });

  it("[VXP-02] phiếu CŨ 4 mục: in đủ các mục có chữ, mỗi mục một dòng, không mất chữ", () => {
    const t = vanXuoiPhieu({
      notes: { overall: "", knowledge: "Nắm tốt", skill: "Lắp nhanh", attitude: "", proposal: "Ôn thêm ở nhà" },
      comment: null,
    });
    expect(t).toBe("Kiến thức: Nắm tốt\nKỹ năng: Lắp nhanh\nĐề xuất: Ôn thêm ở nhà");
  });

  it("[VXP-03] không có notes thì rơi về comment (đã cắt khoảng trắng); không gì cả thì rỗng", () => {
    expect(vanXuoiPhieu({ notes: null, comment: " Con tiến bộ. " })).toBe("Con tiến bộ.");
    expect(vanXuoiPhieu({ notes: null, comment: null })).toBe("");
  });
});
