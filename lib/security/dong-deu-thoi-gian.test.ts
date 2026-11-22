// @vitest-environment node
/**
 * [DDT-*] — lớp thời gian CHUNG của các đường công khai nhận SĐT (R10 · D1). Thuần: đồng hồ + hàm chờ + nhiễu đều TIÊM vào (luật 19), không chờ thật.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { DO_TRE_NHIEU_TOI_DA_MS, DO_TRE_TOI_THIEU_MS, denNguongThoiGian, phuThuocThoiGianThat, type PhuThuocThoiGian } from "./dong-deu-thoi-gian";

const T0 = Date.parse("2026-10-18T03:00:00.000Z");

function gia(troi: number, nhieu: number): { pt: PhuThuocThoiGian; cho: number[] } {
  const cho: number[] = [];
  return { cho, pt: { now: () => new Date(T0 + troi), cho: async (ms) => void cho.push(ms), nhieuMs: () => nhieu } };
}

afterEach(() => vi.restoreAllMocks());

describe("[DDT-01] chờ BÙ phần còn thiếu để mọi nhánh cùng ra sau ngưỡng + nhiễu", () => {
  it("nhánh nhanh (20 ms) và nhánh chậm (60 ms) đều kết thúc đúng ngưỡng + nhiễu: tổng = đã trôi + chờ", async () => {
    for (const troi of [20, 60, 200]) {
      const { pt, cho } = gia(troi, 40);
      expect(await denNguongThoiGian(pt, T0, "thu")).toBe(true);
      expect(cho).toHaveLength(1);
      expect(troi + cho[0]!).toBe(DO_TRE_TOI_THIEU_MS + 40);
    }
  });
  it("hằng số: ngưỡng 700 ms, nhiễu tối đa 150 ms (đổi là đổi quyết định bảo mật — đo lại bằng tests/lead-intake/affiliate-intake-do-tre.spec.ts)", () => {
    expect(DO_TRE_TOI_THIEU_MS).toBe(700);
    expect(DO_TRE_NHIEU_TOI_DA_MS).toBe(150);
  });
});

describe("[DDT-02] phần việc thật VƯỢT ngưỡng ⇒ không chờ thêm, trả false và GHI LOG không PII", () => {
  it("vượt đúng ngưỡng (nhiễu 0) ⇒ không chờ; log có nhãn đường + số ms, không có thứ nào khác", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { pt, cho } = gia(DO_TRE_TOI_THIEU_MS, 0);
    expect(await denNguongThoiGian(pt, T0, "api/leads")).toBe(false);
    expect(cho).toEqual([]);
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(String(aviso.mock.calls[0]![0])).toContain("api/leads");
    expect(String(aviso.mock.calls[0]![0])).toContain(String(DO_TRE_TOI_THIEU_MS));
  });
  it("ĐỐI CHỨNG DƯƠNG: dưới ngưỡng ⇒ chờ và KHÔNG log", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { pt, cho } = gia(DO_TRE_TOI_THIEU_MS - 1, 0);
    expect(await denNguongThoiGian(pt, T0, "api/leads")).toBe(true);
    expect(cho).toEqual([1]);
    expect(aviso).not.toHaveBeenCalled();
  });
});

describe("[DDT-03] phụ thuộc thật", () => {
  it("nhiễu thật nằm trong [0, 150]; đồng hồ thật là Date; hàm chờ thật giải quyết sau ~ms", async () => {
    const pt = phuThuocThoiGianThat();
    for (let i = 0; i < 200; i += 1) {
      const n = pt.nhieuMs();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(DO_TRE_NHIEU_TOI_DA_MS);
      expect(Number.isInteger(n)).toBe(true);
    }
    expect(pt.now()).toBeInstanceOf(Date);
    const t = Date.now();
    await pt.cho(30);
    expect(Date.now() - t).toBeGreaterThanOrEqual(25);
  });
});
