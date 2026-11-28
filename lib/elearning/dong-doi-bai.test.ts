// @vitest-environment node
/** [DDB-*] B-11 — nhóm + gắn nhãn bài gốc / bản tách trong màn quản trị (KHÔNG cộng gộp dữ liệu). */
import { describe, expect, it } from "vitest";
import { nhomDongDoiBai, type BaiDeNhomDongDoi } from "./dong-doi-bai";

const b = (id: string, title: string, forkedFromLessonId: string | null, trangThaiBan: string[]): BaiDeNhomDongDoi => ({ id, title, forkedFromLessonId, trangThaiBan });

describe("[DDB-01] nhomDongDoiBai", () => {
  it("🔴 bản tách nằm NGAY DƯỚI bài gốc và được gắn nhãn theo trạng thái bản; bài gốc có bản tách mang nhãn 'bài gốc'", () => {
    const r = nhomDongDoiBai([
      b("x2", "Video X", "x1", ["DRAFT"]),
      b("y1", "Video Y", null, ["PUBLISHED"]),
      b("x1", "Video X", null, ["PUBLISHED"]),
    ]);
    expect(r.map((x) => [x.id, x.nhan, x.laBanTach])).toEqual([
      ["x1", "Video X — bài gốc", false],
      ["x2", "Video X — bản tách (bản nháp)", true],
      ["y1", "Video Y", false],
    ]);
  });

  it("nhãn bản tách theo trạng thái: đang phát hành · bản nháp · đã khoá chưa phát hành · chưa vào bản nào", () => {
    const moTa = (tt: string[]) => nhomDongDoiBai([b("g", "T", null, ["PUBLISHED"]), b("t", "T", "g", tt)])[1]!.nhan;
    expect(moTa(["PUBLISHED", "DRAFT"])).toBe("T — bản tách (đang phát hành)");
    expect(moTa(["DRAFT"])).toBe("T — bản tách (bản nháp)");
    expect(moTa(["PENDING_REVIEW"])).toBe("T — bản tách (đã khoá, chưa phát hành)");
    expect(moTa([])).toBe("T — bản tách (chưa vào bản nào)");
  });

  it("không có bản tách ⇒ nhãn là tên trơn, thứ tự theo tên; chuỗi tách (A→B→C) xếp liền nhau", () => {
    expect(nhomDongDoiBai([b("2", "Bài B", null, []), b("1", "Bài A", null, [])]).map((x) => x.nhan)).toEqual(["Bài A", "Bài B"]);
    const chuoi = nhomDongDoiBai([b("c", "T", "bb", ["DRAFT"]), b("a", "T", null, ["PUBLISHED"]), b("bb", "T", "a", ["PUBLISHED"])]);
    expect(chuoi.map((x) => x.id)).toEqual(["a", "bb", "c"]);
  });

  it("🔴 bản tách mà bài gốc không có trong danh sách (đã xoá) vẫn hiện, gắn nhãn bản tách; vòng dõi hỏng KHÔNG lặp vô hạn và không làm mất bài", () => {
    expect(nhomDongDoiBai([b("t", "T", "da-xoa", ["DRAFT"])]).map((x) => x.nhan)).toEqual(["T — bản tách (bản nháp)"]);
    const vong = nhomDongDoiBai([b("p", "P", "q", []), b("q", "Q", "p", [])]);
    expect(vong.map((x) => x.id).sort()).toEqual(["p", "q"]);
  });

  it("KHÔNG gộp: mỗi bài vào danh sách ra đúng MỘT lần với id gốc của nó", () => {
    const vao = [b("g", "T", null, ["PUBLISHED"]), b("t1", "T", "g", ["DRAFT"]), b("t2", "T", "g", ["DRAFT"])];
    expect(nhomDongDoiBai(vao).map((x) => x.id).sort()).toEqual(["g", "t1", "t2"]);
  });
});
