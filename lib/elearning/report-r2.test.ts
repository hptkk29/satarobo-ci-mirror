// @vitest-environment node
/**
 * EL-13 — dải nhiệt đoạn xem của báo cáo R2.
 *
 * Dải nhiệt là thứ người quản lý NHÌN rồi kết luận về một con người. Nên hai hỏng
 * ở đây đều dẫn tới kết luận sai về người thật:
 *  · cắt bớt đuôi khi bài dài ⇒ dải trông như bài hết sớm, và phần cuối bài không
 *    ai xem thì không hiện ra;
 *  · lẫn "đã dọn sau 90 ngày" với "chưa xem gì" ⇒ báo cáo nói người học xong từ
 *    năm ngoái là chưa xem đoạn nào.
 */
import { describe, it, expect } from "vitest";
import { dungDaiNhiet, O_TOI_DA } from "@/lib/elearning/report-r2";
import { bitmapRong, batDoan, soDoanCua } from "@/lib/elearning/segment-bitmap";

/** Bitmap có các đoạn `[tu, den)` được bật. */
const bm = (soDoan: number, khoang: [number, number][]) => {
  const b = bitmapRong(soDoan);
  for (const [t, d] of khoang) for (let i = t; i < d; i += 1) batDoan(b, i);
  return b;
};

describe("dải nhiệt cơ bản", () => {
  it("xem trọn bài ⇒ mọi ô đều đầy", () => {
    const soDoan = soDoanCua(600);
    const d = dungDaiNhiet({ bitmap: bm(soDoan, [[0, soDoan]]), contentSec: 600 });
    expect(d.o.every((x) => x === 1)).toBe(true);
  });

  it("chưa xem gì ⇒ mọi ô đều rỗng, KHÔNG phải mảng rỗng", () => {
    // Mảng rỗng vẽ ra một dải không có gì, trông y như bài không có nội dung.
    const d = dungDaiNhiet({ bitmap: null, contentSec: 600 });
    expect(d.o.length).toBeGreaterThan(0);
    expect(d.o.every((x) => x === 0)).toBe(true);
  });

  it("xem nửa đầu ⇒ nửa đầu đầy, nửa sau rỗng", () => {
    const soDoan = soDoanCua(600);
    const d = dungDaiNhiet({
      bitmap: bm(soDoan, [[0, Math.floor(soDoan / 2)]]),
      contentSec: 600,
    });
    expect(d.o[0]).toBe(1);
    expect(d.o[d.o.length - 1]).toBe(0);
  });

  it("bỏ qua đoạn GIỮA thì thấy được chỗ trũng", () => {
    // Đây là thứ báo cáo sinh ra để thấy: người tua qua phần giữa.
    const soDoan = soDoanCua(600);
    const d = dungDaiNhiet({
      bitmap: bm(soDoan, [
        [0, 20],
        [100, soDoan],
      ]),
      contentSec: 600,
      oToiDa: 12,
    });
    const giua = d.o[Math.floor(d.o.length / 2)]!;
    expect(giua).toBeLessThan(1);
  });
});

describe("🔴 bài DÀI thì GỘP ô, không cắt đuôi", () => {
  it("số ô không vượt trần", () => {
    const d = dungDaiNhiet({ bitmap: null, contentSec: 3600 });
    expect(d.o.length).toBeLessThanOrEqual(O_TOI_DA);
  });

  it("ô CUỐI vẫn đại diện cho phần CUỐI bài", () => {
    // Cắt đuôi thì dải trông như bài hết ở phút thứ 10, và phần cuối bài không ai
    // xem sẽ không bao giờ hiện ra — đúng chỗ báo cáo cần chỉ tới nhất.
    const soDoan = soDoanCua(3600);
    const d = dungDaiNhiet({
      // Chỉ xem đúng đoạn CUỐI CÙNG của bài.
      bitmap: bm(soDoan, [[soDoan - 1, soDoan]]),
      contentSec: 3600,
    });
    expect(d.o[d.o.length - 1]).toBeGreaterThan(0);
    expect(d.o[0]).toBe(0);
  });

  it("tổng thời lượng các ô phủ HẾT bài", () => {
    const contentSec = 3600;
    const d = dungDaiNhiet({ bitmap: null, contentSec });
    expect(d.o.length * d.giayMoiO).toBeGreaterThanOrEqual(contentSec);
  });

  it("bài NGẮN thì không gộp — mỗi ô một đoạn", () => {
    const d = dungDaiNhiet({ bitmap: null, contentSec: 60 });
    expect(d.giayMoiO).toBe(5);
    expect(d.o.length).toBe(12);
  });
});

describe("không vỡ trên đầu vào dị", () => {
  it("thời lượng 0 ⇒ dải rỗng, không chia cho 0", () => {
    expect(dungDaiNhiet({ bitmap: null, contentSec: 0 }).o).toEqual([]);
  });

  it("thời lượng âm ⇒ dải rỗng", () => {
    expect(dungDaiNhiet({ bitmap: null, contentSec: -100 }).o).toEqual([]);
  });

  it("bitmap NGẮN hơn số đoạn ⇒ phần thiếu tính là chưa xem", () => {
    // Xảy ra thật khi video bị THAY TỆP bằng bản dài hơn: bitmap cũ ngắn hơn.
    // Đọc ngoài mảng phải ra "chưa xem", không được ném.
    const d = dungDaiNhiet({ bitmap: bm(10, [[0, 10]]), contentSec: 600 });
    expect(d.o[0]).toBeGreaterThan(0);
    expect(d.o[d.o.length - 1]).toBe(0);
  });

  it("mọi ô luôn nằm trong khoảng 0..1", () => {
    const soDoan = soDoanCua(600);
    const d = dungDaiNhiet({ bitmap: bm(soDoan, [[0, soDoan]]), contentSec: 600 });
    for (const x of d.o) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
    }
  });
});
