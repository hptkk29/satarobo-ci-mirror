import { describe, expect, it } from "vitest";
import { bacCuaPhieu, canhBao, demSoBuoi, diemTheoNhom, ketLuan, kieuO, luotBu, phepCong, type KieuO } from "@/lib/portal/chuyen-can-thuan";

const k = (o: Partial<Parameters<typeof kieuO>[0]>) =>
  kieuO({ attendance: "PRESENT", past: true, laKeTiep: false, ngoaiPhamVi: false, bu: null, ...o });

describe("[CC-01] kiểu ô buổi", () => {
  it("huỷ > ngoài phạm vi > có mặt / bù / vắng theo đơn bù", () => {
    expect(k({ attendance: "CANCELLED" })).toBe("huy");
    expect(k({ ngoaiPhamVi: true })).toBe("ngoai");
    expect(k({ attendance: "PRESENT" })).toBe("co");
    expect(k({ attendance: "MAKEUP" })).toBe("bu");
    expect(k({ attendance: "EXCUSED", bu: "PENDING" })).toBe("cho");
    expect(k({ attendance: "EXCUSED", bu: "SCHEDULED" })).toBe("xep");
    expect(k({ attendance: "ABSENT", bu: null })).toBe("vang");
  });
  it("chưa chấm KHÔNG phải vắng; buổi tương lai: kế tiếp / sắp tới", () => {
    expect(k({ attendance: "UNMARKED" })).toBe("chua-cham");
    expect(k({ attendance: "FUTURE", past: false, laKeTiep: true })).toBe("ke");
    expect(k({ attendance: "FUTURE", past: false })).toBe("sap");
  });
});

describe("[CC-02] đếm buổi + phép cộng", () => {
  const ks: KieuO[] = ["co", "co", "co", "bu", "cho", "chua-cham", "ke", "sap", "sap", "huy", "ngoai"];
  const s = demSoBuoi(ks);
  it("buổi huỷ và ngoài phạm vi không vào bất kỳ nhóm nào", () => {
    expect(s).toMatchObject({ lopDaHoc: 6, conDaHoc: 4, choBu: 1, chuaCham: 1, conLai: 3, tongNhom: 9 });
  });
  it("tỉ lệ có mặt: mẫu số bỏ buổi chưa chấm", () => {
    expect(s.tiLe).toEqual({ phanTram: 80, coMat: 4, mauSo: 5 });
    expect(demSoBuoi(["chua-cham"]).tiLe).toBeNull();
  });
  it("phép cộng khớp khi bằng số đăng ký, lệch thì nói thẳng", () => {
    expect(phepCong(s, 9)).toMatchObject({ khop: true, lech: 0 });
    const lech = phepCong(s, 12);
    expect(lech.khop).toBe(false);
    expect(lech.nhan).toContain("Lệch 3 buổi");
  });
});

describe("[CC-03] kết luận", () => {
  const so = (a: Partial<ReturnType<typeof demSoBuoi>>) => ({ ...demSoBuoi([]), ...a });
  it("chờ bù ⇒ tím, đưa tới Học bù; vắng không bù ⇒ cảnh báo", () => {
    expect(ketLuan({ ten: "An", s: so({ lopDaHoc: 7, conDaHoc: 6, choBu: 1 }), soBuoiChoBu: [6] })).toMatchObject({ sac: "tot", viec: "Chọn giờ học bù buổi 6" });
    expect(ketLuan({ ten: "An", s: so({ lopDaHoc: 7, conDaHoc: 6, vangKhongBu: 1 }), soBuoiChoBu: [] }).sac).toBe("canh-bao");
  });
  it("chỉ có buổi chưa chấm ⇒ không gọi là vắng", () => {
    expect(ketLuan({ ten: "An", s: so({ lopDaHoc: 3, chuaCham: 3 }), soBuoiChoBu: [] }).tieuDe).toContain("chưa chấm");
  });
});

describe("[CC-04] chất lượng", () => {
  it("bậc của phiếu: không chấm tiêu chí nào ⇒ null", () => {
    expect(bacCuaPhieu(null)).toBeNull();
    expect(bacCuaPhieu({ "kt-cu": 1, "kt-moi": 1 })).toBe(3);
    expect(bacCuaPhieu({ "kt-cu": 4, "kt-moi": 4 })).toBe(1);
  });
  it("cảnh báo chỉ khi ≥2/3 buổi gần nhất ở bậc Khá; không có phiếu ⇒ không nói gì", () => {
    expect(canhBao([], 0)).toBeNull();
    expect(canhBao([{ n: 1, bac: 1 }, { n: 2, bac: 1 }, { n: 3, bac: 3 }], 0)?.loai).toBe("luu-y");
    const tot = canhBao([{ n: 1, bac: 3 }, { n: 2, bac: 3 }, { n: 3, bac: 2 }], 2);
    expect(tot?.loai).toBe("tot");
    expect(tot?.noi).toContain("Còn 2 bài về nhà chưa nộp");
  });
  it("điểm theo nhóm đổi sang thang 5 vạch; tiêu chí lạ bị bỏ", () => {
    const d = diemTheoNhom([{ "kt-cu": 2, "kt-moi": 1, "khong-co": 1 }, null]);
    expect(d).toEqual([{ ten: "Kiến thức", diem: 4.5, chu: "4,5" }]);
  });
});

describe("[CC-05] lượt bù", () => {
  it("còn = cấp − giữ − đã dùng, không âm", () => {
    expect(luotBu(4, 1, 0)).toEqual({ tong: 4, dung: 0, giu: 1, con: 3 });
    expect(luotBu(1, 2, 1).con).toBe(0);
  });
});
