// @vitest-environment node
/**
 * EL-08 — mã chương trình + luật gắn phiếu nhu cầu.
 *
 * Mã chương trình được IN RA GIẤY và trích dẫn trong quyết định, nên nó là thứ
 * không sửa lại được. Hai case đắt nhất ở đây đều là về việc đó: mã không được
 * suy động từ tên enum, và không được mang đoạn phân loại đã đổi nghĩa.
 */
import { describe, it, expect } from "vitest";
import {
  dungMaChuongTrinh,
  tachMaChuongTrinh,
  maChucNang,
  kiemGanPhieuNhuCau,
  THONG_BAO_NHU_CAU,
  type FunctionTag,
} from "@/lib/elearning/program-code";

const TAT_CA: FunctionTag[] = [
  "SALE",
  "TEACHING",
  "MARKETING",
  "HR",
  "ACCOUNTING",
  "OPERATION",
  "COMPANY_WIDE",
];

describe("dạng mã `SR.DT.[CN].[NĂM].[STT]`", () => {
  it("dựng đúng dạng", () => {
    expect(
      dungMaChuongTrinh({ primaryFunctionTag: "SALE", year: 2026, seq: 7 }),
    ).toBe("SR.DT.KD.2026.007");
  });

  it("KHÔNG có đoạn `[CB]` bậc công việc", () => {
    // C6 — §8.3(a) định nghĩa L5 là một GIAI ĐOẠN (<60 ngày, CTV, thực tập) chứ
    // không phải bậc; nó nay tách thành `stageTag` riêng. Nhét vào mã là ghi cứng
    // một phân loại đã đổi nghĩa vào thứ đã in ra giấy.
    const ma = dungMaChuongTrinh({ primaryFunctionTag: "SALE", year: 2026, seq: 7 });
    expect(ma.split(".")).toHaveLength(5);
    expect(ma).not.toMatch(/L[1-5]/);
  });

  it("số thứ tự đệm 3 chữ số để sắp xếp theo chuỗi ra đúng thứ tự", () => {
    // Không đệm thì "10" đứng trước "2" trong mọi danh sách sắp theo mã.
    const ds = [2, 10, 100].map((seq) =>
      dungMaChuongTrinh({ primaryFunctionTag: "HR", year: 2026, seq }),
    );
    expect([...ds].sort()).toEqual(ds);
  });

  it("mỗi chức năng một mã RIÊNG, không trùng nhau", () => {
    const ma = TAT_CA.map(maChucNang);
    expect(new Set(ma).size).toBe(TAT_CA.length);
  });

  it("mã chức năng là hằng, KHÔNG suy từ tên enum", () => {
    // Suy động thì đổi tên giá trị enum (việc bình thường) sẽ đổi luôn mã của
    // những chương trình ĐÃ IN RA.
    expect(maChucNang("COMPANY_WIDE")).toBe("CT");
    expect(maChucNang("TEACHING")).toBe("GD");
  });
});

describe("từ chối đầu vào vô lý thay vì sinh mã rác", () => {
  it("số thứ tự < 1 ⇒ ném lỗi", () => {
    expect(() =>
      dungMaChuongTrinh({ primaryFunctionTag: "HR", year: 2026, seq: 0 }),
    ).toThrow();
  });

  it("năm ngoài khoảng 4 chữ số ⇒ ném lỗi", () => {
    for (const year of [26, 12026]) {
      expect(() =>
        dungMaChuongTrinh({ primaryFunctionTag: "HR", year, seq: 1 }),
      ).toThrow();
    }
  });
});

describe("đọc ngược mã", () => {
  it("tách đúng ba phần", () => {
    expect(tachMaChuongTrinh("SR.DT.GD.2026.012")).toEqual({
      chucNang: "GD",
      year: 2026,
      seq: 12,
    });
  });

  it("mã sai dạng ⇒ `null`, không đoán", () => {
    for (const x of ["SR.DT.GD.2026", "GD.2026.012", "SR.DT.GD.26.012", ""]) {
      expect(tachMaChuongTrinh(x), x).toBeNull();
    }
  });

  it("dựng rồi tách lại ra đúng đầu vào", () => {
    for (const tag of TAT_CA) {
      const ma = dungMaChuongTrinh({ primaryFunctionTag: tag, year: 2026, seq: 3 });
      expect(tachMaChuongTrinh(ma)?.seq, tag).toBe(3);
    }
  });
});

describe("§8.1 — phải có phiếu nhu cầu ĐÃ DUYỆT, hoặc lý do miễn", () => {
  const kiem = (o: Partial<Parameters<typeof kiemGanPhieuNhuCau>[0]> = {}) =>
    kiemGanPhieuNhuCau({
      needId: null,
      needStatus: null,
      needExemptReason: null,
      ...o,
    });

  it("có phiếu ĐÃ DUYỆT ⇒ hợp lệ", () => {
    expect(kiem({ needId: "n1", needStatus: "APPROVED" })).toEqual({ ok: true });
  });

  it("phiếu CHƯA duyệt ⇒ từ chối", () => {
    // Chấp nhận phiếu chưa duyệt là biến câu "phải có phiếu ĐÃ DUYỆT" thành
    // "phải có ai đó đã gõ một cái phiếu".
    expect(kiem({ needId: "n1", needStatus: "NEW" })).toEqual({
      ok: false,
      code: "NEED_NOT_APPROVED",
    });
  });

  it("không phiếu, không lý do ⇒ từ chối", () => {
    expect(kiem()).toEqual({ ok: false, code: "NEED_REQUIRED" });
  });

  it("lý do miễn là đường thoát hợp lệ", () => {
    expect(kiem({ needExemptReason: "Khoá tuân thủ theo quyết định BGĐ" })).toEqual({
      ok: true,
    });
  });

  it("lý do chỉ có khoảng trắng KHÔNG tính là lý do", () => {
    expect(kiem({ needExemptReason: "   " })).toEqual({
      ok: false,
      code: "NEED_REQUIRED",
    });
  });

  it("có CẢ HAI ⇒ từ chối, không im lặng chọn một bên", () => {
    // Người đọc sau không biết cái nào là sự thật.
    expect(kiem({ needId: "n1", needStatus: "APPROVED", needExemptReason: "x" })).toEqual({
      ok: false,
      code: "NEED_AND_EXEMPT",
    });
  });

  it("mỗi mã lỗi có câu tiếng Việt nói được phải làm gì", () => {
    for (const code of ["NEED_REQUIRED", "NEED_NOT_APPROVED", "NEED_AND_EXEMPT"] as const) {
      expect(THONG_BAO_NHU_CAU[code], code).toBeTruthy();
      expect(THONG_BAO_NHU_CAU[code].length, code).toBeGreaterThan(15);
    }
  });
});
