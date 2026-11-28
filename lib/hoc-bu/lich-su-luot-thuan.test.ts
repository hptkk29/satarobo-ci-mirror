import { describe, expect, it } from "vitest";
import { hieuLucQlcs, kiemSuaHocVuot, kiemSuaQlcs, lyDoSua, nguonSuaHocVuot, nguonSuaQlcs, phanLoaiButToan, suaDuoc } from "./lich-su-luot-thuan";

const adj = (nguon: string, grantedDelta: number) => ({ type: "ADJUSTMENT", idemKey: `ADJUSTMENT:${nguon}`, grantedDelta });

describe("lich-su-luot-thuan", () => {
  it("[LSL-01] phân loại theo khoá bút toán + dấu", () => {
    expect(phanLoaiButToan(adj("qlcs:abcdefgh", 2)).nhom).toBe("QLCS_CAP");
    expect(phanLoaiButToan(adj("qlcs:abcdefgh", -1)).nhom).toBe("QLCS_GIAM");
    expect(phanLoaiButToan(adj("hocvuot:REQ1", 3))).toMatchObject({ nhom: "HOC_VUOT_DUYET", requestId: "REQ1" });
    expect(phanLoaiButToan(adj("hocvuot:REQ1:doi-1700000000", -3))).toMatchObject({ nhom: "HOC_VUOT_DOI", requestId: "REQ1" });
    expect(phanLoaiButToan(adj("hocvuot:REQ1:sua-1700000000", -1))).toMatchObject({ nhom: "HOC_VUOT_SUA", requestId: "REQ1" });
    expect(phanLoaiButToan(adj("don:ITEM9", 4)).nhom).toBe("THEO_DON");
    expect(phanLoaiButToan({ type: "GRANT", idemKey: "GRANT:khoi-tao", grantedDelta: 6 }).nhom).toBe("TU_DONG");
  });

  it("[LSL-02] bút toán sửa QLCS trỏ về bút toán gốc; khoá lạ ⇒ KHAC (không đoán)", () => {
    expect(phanLoaiButToan(adj("qlcs:sua:GOC77:abcdefgh", -1))).toMatchObject({ nhom: "QLCS_SUA", gocId: "GOC77" });
    expect(phanLoaiButToan(adj("la-hoac", 1)).nhom).toBe("KHAC");
    expect(phanLoaiButToan({ type: "ADJUSTMENT", idemKey: null, grantedDelta: 1 }).nhom).toBe("KHAC");
    expect(phanLoaiButToan({ type: "HOLD", idemKey: "HOLD:x", grantedDelta: 0 }).nhom).toBe("KHAC");
  });

  it("[LSL-03] khoá sửa dùng ĐÚNG tiền tố mà bộ phân loại nhận ra (khứ hồi), và không bắt đầu bằng `don:`", () => {
    const q = nguonSuaQlcs("GOC1", "abcdefgh");
    expect(q.startsWith("don:")).toBe(false);
    expect(phanLoaiButToan(adj(q, -2))).toMatchObject({ nhom: "QLCS_SUA", gocId: "GOC1" });
    const h = nguonSuaHocVuot("REQ2", "abcdefgh");
    expect(h.startsWith("don:")).toBe(false);
    expect(phanLoaiButToan(adj(h, 1))).toMatchObject({ nhom: "HOC_VUOT_SUA", requestId: "REQ2" });
  });

  it("[LSL-04] chỉ bút toán GỐC sửa được; bút toán bù trừ / theo đơn / tự động thì không", () => {
    for (const n of ["QLCS_CAP", "QLCS_GIAM", "HOC_VUOT_DUYET"] as const) expect(suaDuoc(n)).toBe(true);
    for (const n of ["QLCS_SUA", "HOC_VUOT_SUA", "HOC_VUOT_DOI", "THEO_DON", "TU_DONG", "KHAC"] as const) expect(suaDuoc(n)).toBe(false);
  });

  it("[LSL-05] hiệu lực = số gốc + các lần bù trừ", () => {
    expect(hieuLucQlcs({ grantedDelta: 5 }, [{ grantedDelta: -2 }, { grantedDelta: 1 }])).toBe(4);
    expect(hieuLucQlcs({ grantedDelta: 3 }, [])).toBe(3);
  });

  it("[LSL-06] sửa QLCS: trùng số / không phải số nguyên / thiếu lý do / quá 12 lượt một lần ⇒ từ chối; hợp lệ ⇒ null", () => {
    const ok = { hieuLuc: 5, soMoi: 3, lyDo: "Cấp nhầm hai lượt do sai lớp", maLan: "abcdefgh12" };
    expect(kiemSuaQlcs(ok)).toBeNull();
    expect(kiemSuaQlcs({ ...ok, soMoi: 5 })).toMatch(/trùng/);
    expect(kiemSuaQlcs({ ...ok, soMoi: 2.5 })).toMatch(/số nguyên/);
    expect(kiemSuaQlcs({ ...ok, lyDo: "ngắn" })).toMatch(/lý do/i);
    expect(kiemSuaQlcs({ ...ok, soMoi: 40 })).toMatch(/tối đa/);
    expect(kiemSuaQlcs({ ...ok, maLan: "x" })).toMatch(/Phiên/);
  });

  it("[LSL-07] sửa duyệt học vượt: 1 ≤ b ≤ số buổi phải bù; trùng số cũ / thiếu lý do ⇒ từ chối", () => {
    const ok = { bHienTai: 3, bMoi: 2, phaiBu: 4, lyDo: "Phụ huynh chỉ đồng ý bù 2 buổi", maLan: "abcdefgh12" };
    expect(kiemSuaHocVuot(ok)).toBeNull();
    expect(kiemSuaHocVuot({ ...ok, bMoi: 0 })).toMatch(/từ 1 đến 4/);
    expect(kiemSuaHocVuot({ ...ok, bMoi: 5 })).toMatch(/từ 1 đến 4/);
    expect(kiemSuaHocVuot({ ...ok, bMoi: 3 })).toMatch(/trùng/);
    expect(kiemSuaHocVuot({ ...ok, lyDo: "ngắn" })).toMatch(/lý do/i);
  });

  it("[LSL-08] câu lý do nêu số trước → sau", () => {
    expect(lyDoSua(3, 2, "  Cấp nhầm  ", "QLCS sửa")).toBe("QLCS sửa: 3 → 2 lượt. Cấp nhầm");
  });
});
