// @vitest-environment node
/**
 * [P7-17] `docDauVaoXemTruoc` — cổng ĐỌC của action xem trước giá theo phạm vi học. Zod là THẬT (schema đơn hàng), không giả.
 * Luật được ghim: câu từ chối do schema VIẾT (refine) đi ra màn nguyên văn kèm "Dòng N: "; lỗi cấu trúc tiếng Anh của zod thì KHÔNG; và hình dạng/trần của đầu vào KHÔNG đổi.
 */
import { describe, expect, it } from "vitest";
import { LOI_DAU_VAO_CHUNG, docDauVaoXemTruoc } from "./dau-vao-xem-truoc";

const dong = (metadata: unknown, o: Record<string, unknown> = {}) => ({
  type: "COURSE_ENROLLMENT",
  itemName: "Sata 3",
  quantity: 1,
  unitPrice: 0,
  packageId: null,
  examAttemptId: null,
  productId: null,
  studentId: null,
  leadChildId: null,
  discounts: [],
  metadata,
  ...o,
});
const vao = (items: unknown[], centerId: string | null = "cs2") => ({ centerId, items });

describe("[P7-17] docDauVaoXemTruoc", () => {
  it.each([12, 24, 36, 48, 13, 49, 500])("soBuoi=%i ⇒ qua cổng đọc (mốc đúng/sai là việc của planner, không phải của cổng này)", (so) => {
    const r = docDauVaoXemTruoc(vao([dong({ courseId: "k", soBuoi: so })]));
    expect(r.ok).toBe(true);
  });

  it.each([501, 4824, 482_400])("soBuoi=%i (> 500) ⇒ từ chối bằng câu CỦA SCHEMA, kèm số dòng", (so) => {
    const r = docDauVaoXemTruoc(vao([dong({ courseId: "k", soBuoi: so })]));
    expect(r).toEqual({ ok: false, error: "Dòng 1: Số buổi phải là số nguyên từ 1 đến 500" });
  });

  it("số dòng đúng với vị trí: lỗi ở dòng thứ 2 ⇒ 'Dòng 2:'", () => {
    const r = docDauVaoXemTruoc(vao([dong({ courseId: "k", soBuoi: 24 }), dong({ courseId: "k", soBuoi: 4824 })]));
    expect(r).toEqual({ ok: false, error: "Dòng 2: Số buổi phải là số nguyên từ 1 đến 500" });
  });

  it("[P7-PF2] NHIỀU dòng sai ⇒ báo dòng sai ĐẦU TIÊN (không phải dòng cuối)", () => {
    const sai = (so: number) => dong({ courseId: "k", soBuoi: so });
    expect(docDauVaoXemTruoc(vao([sai(4824), sai(9999)]))).toEqual({ ok: false, error: "Dòng 1: Số buổi phải là số nguyên từ 1 đến 500" });
    expect(docDauVaoXemTruoc(vao([dong({ courseId: "k", soBuoi: 24 }), sai(4824), sai(9999)]))).toEqual({
      ok: false,
      error: "Dòng 2: Số buổi phải là số nguyên từ 1 đến 500",
    });
  });

  it("[P7-PF3] trần 20 dòng: 20 dòng qua, 21 dòng bị từ chối (câu chung — lỗi này không do schema viết)", () => {
    const n = (k: number) => Array.from({ length: k }, () => dong({ courseId: "k", soBuoi: 24 }));
    expect(docDauVaoXemTruoc(vao(n(20))).ok).toBe(true);
    expect(docDauVaoXemTruoc(vao(n(21)))).toEqual({ ok: false, error: LOI_DAU_VAO_CHUNG });
  });

  it("hình thức lớp sai ⇒ cũng nói câu của schema", () => {
    const r = docDauVaoXemTruoc(vao([dong({ courseId: "k", coachFormat: "XYZ" })]));
    expect(r).toEqual({ ok: false, error: "Dòng 1: Hình thức lớp không hợp lệ" });
  });

  it("lỗi CẤU TRÚC (thiếu tên dòng, thiếu items) ⇒ câu chung — không lộ tiếng Anh nội bộ của zod", () => {
    expect(docDauVaoXemTruoc(vao([dong({ courseId: "k" }, { itemName: "" })]))).toEqual({ ok: false, error: LOI_DAU_VAO_CHUNG });
    expect(docDauVaoXemTruoc({ centerId: "cs2" })).toEqual({ ok: false, error: LOI_DAU_VAO_CHUNG });
    expect(docDauVaoXemTruoc(null)).toEqual({ ok: false, error: LOI_DAU_VAO_CHUNG });
  });

  it("soBuoi KHÔNG phải số nguyên dương / là chuỗi ⇒ từ chối (KHÔNG bị kẹp về null = 'mua đủ khoá')", () => {
    for (const so of [0, -1, 24.5, "24"]) {
      const r = docDauVaoXemTruoc(vao([dong({ courseId: "k", soBuoi: so })]));
      expect(r.ok, String(so)).toBe(false);
    }
  });

  it("centerId rỗng bị từ chối, null được phép (đơn chưa chọn cơ sở)", () => {
    expect(docDauVaoXemTruoc(vao([dong({ courseId: "k" })], null)).ok).toBe(true);
    expect(docDauVaoXemTruoc(vao([dong({ courseId: "k" })], "")).ok).toBe(false);
  });
});
