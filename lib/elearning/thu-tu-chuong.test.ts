// @vitest-environment node
/**
 * [TTC-*] B-11c — thứ tự CHƯƠNG của một bản: hàm thuần `thuTuChuongCuaBan` (có tham số thứ tự đã lưu) + đọc an toàn `docThuTuChuongLuuSan`.
 * Phần Postgres thật (kéo / thêm bài / sao chép / nhân bản): tests/elearning/b11-sao-chep-khi-ghi-db.test.ts [B11-S-20..23].
 */
import { describe, expect, it } from "vitest";
import { chonBaiCuaDeTrongBan, docThuTuChuongLuuSan, thuTuChuongCuaBan } from "./ban-cua-luot";

const CH = [
  { id: "a", orderIndex: 0 },
  { id: "b", orderIndex: 1 },
  { id: "r", orderIndex: 2 }, // chương rỗng
];
const thuTu = (m: Map<string, number>) => [...CH].sort((x, y) => m.get(x.id)! - m.get(y.id)!).map((c) => c.id);

describe("[TTC-01] thuTuChuongCuaBan", () => {
  it("bản chưa từng kéo chương (mọi dòng NULL, không bản đồ) ⇒ theo cột chương như cũ", () => {
    const m = thuTuChuongCuaBan(CH, [{ moduleId: "a", moduleOrder: null }, { moduleId: "b", moduleOrder: null }], null);
    expect(thuTu(m)).toEqual(["a", "b", "r"]);
  });
  it("🔴 chương RỖNG lấy vị trí từ bản đồ đã lưu — không nhảy xuống cuối", () => {
    const dong = [{ moduleId: "a", moduleOrder: 1 }, { moduleId: "b", moduleOrder: 2 }];
    expect(thuTu(thuTuChuongCuaBan(CH, dong, { r: 0, a: 1, b: 2 }))).toEqual(["r", "a", "b"]);
    // Đối chứng: KHÔNG có bản đồ ⇒ hành vi cũ (rỗng ra cuối) — hai đầu vào cho hai kết quả khác nhau.
    expect(thuTu(thuTuChuongCuaBan(CH, dong, null))).toEqual(["a", "b", "r"]);
  });
  it("số trên DÒNG thắng bản đồ khi hai bên lệch (dòng là nguồn của chương có bài; bản đồ chỉ bù chương không có dòng)", () => {
    const dong = [{ moduleId: "a", moduleOrder: 2 }, { moduleId: "b", moduleOrder: 0 }];
    expect(thuTu(thuTuChuongCuaBan(CH, dong, { a: 0, b: 1, r: 1 }))).toEqual(["b", "r", "a"]);
  });
  it("chương mới (không có dòng, không trong bản đồ) xếp SAU các chương đã có vị trí, theo cột chương", () => {
    const ch = [...CH, { id: "n", orderIndex: 3 }];
    const m = thuTuChuongCuaBan(ch, [{ moduleId: "a", moduleOrder: 0 }, { moduleId: "b", moduleOrder: 1 }], { a: 0, b: 1, r: 2 });
    expect([...ch].sort((x, y) => m.get(x.id)! - m.get(y.id)!).map((c) => c.id)).toEqual(["a", "b", "r", "n"]);
  });
});

describe("[TTC-02] docThuTuChuongLuuSan đọc an toàn (cột JSON có thể là bất cứ thứ gì)", () => {
  it("nhận đối tượng { id: số nguyên >= 0 }", () => expect(docThuTuChuongLuuSan({ a: 0, b: 2 })).toEqual({ a: 0, b: 2 }));
  it("🔴 dạng hỏng ⇒ null, KHÔNG ném lỗi: null · mảng · chuỗi · số · rỗng · giá trị lạ bị bỏ", () => {
    for (const x of [null, undefined, [], [1, 2], "abc", 5, {}, { a: -1 }, { a: 1.5 }, { a: "0" }]) expect(docThuTuChuongLuuSan(x), JSON.stringify(x)).toBeNull();
    expect(docThuTuChuongLuuSan({ a: 0, b: "x", c: -2, d: 3 })).toEqual({ a: 0, d: 3 });
  });
});

describe("[TTC-03] chonBaiCuaDeTrongBan — bài gốc và bản tách cùng gắn một đề", () => {
  const goc = { id: "q", orderIndex: 3, versionLessons: [{ versionId: "v10" }] };
  const tach = { id: "q2", orderIndex: 4, versionLessons: [{ versionId: "v11" }] };
  const cu = { id: "cu", orderIndex: 5, versionLessons: [] }; // bài kiểu cũ: chưa từng vào bản nào
  it("🔴 chọn bài NẰM TRONG bản của lượt học, bất kể thứ tự trả về", () => {
    expect(chonBaiCuaDeTrongBan([tach, goc], "v10")?.id).toBe("q");
    expect(chonBaiCuaDeTrongBan([goc, tach], "v11")?.id).toBe("q2");
  });
  it("🔴 đề không nằm trong bản của lượt học ⇒ null (không ghi 'xong' vào bài của bản người ấy không thấy)", () => {
    expect(chonBaiCuaDeTrongBan([tach], "v10")).toBeNull();
  });
  it("bài kiểu cũ (chưa vào bản nào) vẫn là ứng viên; bài trong bản được ưu tiên hơn nó", () => {
    expect(chonBaiCuaDeTrongBan([cu], "v10")?.id).toBe("cu");
    expect(chonBaiCuaDeTrongBan([cu, goc], "v10")?.id).toBe("q");
  });
  it("chưa biết bản (null) ⇒ bài có orderIndex nhỏ nhất (tất định); không ứng viên ⇒ null", () => {
    expect(chonBaiCuaDeTrongBan([tach, goc], null)?.id).toBe("q");
    expect(chonBaiCuaDeTrongBan([], "v10")).toBeNull();
  });
});
