// Ca [QNL-*] — chọn LÔ đơn cho mỗi lượt quét của scanner bóng (Invoice Hub S8). THUẦN, không đồng hồ thật (tick là tham số).
// Không có con trỏ lưu ở đâu cả: lượt nào cũng chọn lô chỉ từ (danh sách ứng viên, tick) ⇒ cron lỡ / chạy chồng / chết giữa chừng không làm mất đơn nào,
// chỉ làm một đơn được quét hơi muộn. Tính chất cần khoá: XOAY VÒNG PHỦ HẾT mọi ứng viên, và xác định.
import { describe, expect, it } from "vitest";
import { BUOC_TICK_PHUT, CO_LO, TRAN_DON_MOI_LUOT, chonLo, ghepLoTheoTang, gopLo, tickCua } from "./quet-nghia-vu-lo";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `o${String(i).padStart(3, "0")}`);

describe("[QNL-01] chonLo — xoay vòng phủ hết", () => {
  it("n ≤ cỡ lô ⇒ lấy hết, mọi tick", () => {
    expect(chonLo(ids(5), 0, 10)).toEqual(ids(5));
    expect(chonLo(ids(5), 7, 10)).toEqual(ids(5));
    expect(chonLo([], 3, 10)).toEqual([]);
  });

  it("n > cỡ lô ⇒ mỗi tick đúng `kichCo` phần tử; ceil(n/kichCo) tick liên tiếp phủ HẾT n phần tử (mọi điểm xuất phát)", () => {
    for (const n of [11, 59, 60, 61, 137, 400]) {
      const kichCo = 10;
      const can = Math.ceil(n / kichCo);
      for (const t0 of [0, 1, 17, 1000, 1_234_567]) {
        const thay = new Set<string>();
        for (let t = t0; t < t0 + can; t++) {
          const lo = chonLo(ids(n), t, kichCo);
          expect(lo).toHaveLength(kichCo);
          for (const x of lo) thay.add(x);
        }
        expect(thay.size, `n=${n} t0=${t0}`).toBe(n);
      }
    }
  });

  it("xác định: không phụ thuộc thứ tự ứng viên đưa vào, và loại trùng", () => {
    const a = chonLo([...ids(40)].reverse(), 5, 8);
    const b = chonLo([...ids(40), ...ids(40)], 5, 8);
    expect(a).toEqual(chonLo(ids(40), 5, 8));
    expect(b).toEqual(a);
  });

  it("cỡ lô không dương ⇒ rỗng (không chia cho 0, không lấy hết)", () => {
    expect(chonLo(ids(5), 1, 0)).toEqual([]);
  });
});

describe("[QNL-02] tickCua", () => {
  it("cùng một ô 10 phút ⇒ cùng tick; sang ô kế ⇒ tick + 1", () => {
    const a = tickCua(new Date("2026-11-02T03:00:00Z"));
    expect(tickCua(new Date("2026-11-02T03:09:59Z"))).toBe(a);
    expect(tickCua(new Date("2026-11-02T03:10:00Z"))).toBe(a + 1);
    expect(BUOC_TICK_PHUT).toBe(10);
  });
});

describe("[QNL-03] gopLo — ưu tiên theo tầng, loại trùng, chặn trần", () => {
  it("tầng đầu đi trước; đơn xuất hiện ở nhiều tầng chỉ tính một lần; cắt ở trần", () => {
    const lo = gopLo([["a", "b"], ["b", "c"], ["d", "e"]], 4);
    expect(lo).toEqual(["a", "b", "c", "d"]);
  });

  it("đối chứng: trần lớn thì lấy hết, thứ tự tầng giữ nguyên", () => {
    expect(gopLo([["x"], ["y", "x"], ["z"]], 99)).toEqual(["x", "y", "z"]);
  });
});

describe("[QNL-04] ghepLoTheoTang — thành phần lô theo tầng (hàm thuần: kiểm bằng danh sách tổng hợp, không cần DB)", () => {
  const tang = (tien: string, n: number) => Array.from({ length: n }, (_, i) => `${tien}${String(i).padStart(3, "0")}`);

  it("ba tầng đều dư ⇒ đúng 40 mới đổi + 10 chưa ổn định + 10 quét vòng = trần 60; đơn mới đổi đứng ĐẦU", () => {
    const u = { thayDoi: tang("a", 100), chuaOnDinh: tang("b", 30), quetVong: tang("c", 50) };
    const lo = ghepLoTheoTang(u, 7);
    expect(lo).toHaveLength(TRAN_DON_MOI_LUOT);
    expect(lo.filter((x) => x.startsWith("a"))).toHaveLength(CO_LO.thayDoi);
    expect(lo.filter((x) => x.startsWith("b"))).toHaveLength(CO_LO.chuaOnDinh);
    expect(lo.filter((x) => x.startsWith("c"))).toHaveLength(CO_LO.quetVong);
    expect(lo.slice(0, CO_LO.thayDoi).every((x) => x.startsWith("a"))).toBe(true);
  });

  it("tầng quét vòng KHÔNG ăn chỗ của tầng khác và không bị bỏ: ít đơn mới đổi ⇒ lô nhỏ hơn trần nhưng vẫn có đủ 10 quét vòng", () => {
    const lo = ghepLoTheoTang({ thayDoi: tang("a", 3), chuaOnDinh: [], quetVong: tang("c", 500) }, 0);
    expect(lo.filter((x) => x.startsWith("a"))).toHaveLength(3);
    expect(lo.filter((x) => x.startsWith("c"))).toHaveLength(CO_LO.quetVong);
    expect(lo).toHaveLength(3 + CO_LO.quetVong);
  });

  it("hạn ngạch là QUYẾT ĐỊNH có chủ đích (40/10/10 trong trần 60, đơn mới đổi chiếm phần lớn) — đổi nó phải đổi cả ca này, không trôi lặng lẽ", () => {
    // Các ca trên lấy kỳ vọng từ chính hằng số nên đổi hằng số không làm chúng đỏ; ca này ghim GIÁ TRỊ.
    expect(CO_LO).toEqual({ thayDoi: 40, chuaOnDinh: 10, quetVong: 10 });
    expect(TRAN_DON_MOI_LUOT).toBe(60);
    expect(CO_LO.thayDoi + CO_LO.chuaOnDinh + CO_LO.quetVong).toBeLessThanOrEqual(TRAN_DON_MOI_LUOT);
    expect(CO_LO.thayDoi).toBeGreaterThan(CO_LO.chuaOnDinh + CO_LO.quetVong);
  });

  it("đơn nằm ở nhiều tầng chỉ tính MỘT lần (tầng cao hơn giữ nó)", () => {
    const lo = ghepLoTheoTang({ thayDoi: ["x1"], chuaOnDinh: ["x1", "y1"], quetVong: ["x1", "y1", "z1"] }, 0);
    expect(lo).toEqual(["x1", "y1", "z1"]);
  });

  it("ba tầng rỗng ⇒ lô rỗng; xoay vòng theo tick (hai tick liền kề ra hai lô khác nhau khi tầng đủ lớn)", () => {
    expect(ghepLoTheoTang({ thayDoi: [], chuaOnDinh: [], quetVong: [] }, 3)).toEqual([]);
    const u = { thayDoi: tang("a", 100), chuaOnDinh: [], quetVong: [] };
    expect(ghepLoTheoTang(u, 1)).not.toEqual(ghepLoTheoTang(u, 2));
  });
});
