// @vitest-environment node
/**
 * [NHH-VS-*] / [NHH-XK-*] — ngăn "Vì sao con số này" (chỉ đọc ẢNH CHỤP trên dòng) và kết chuyển SỔ ÂM khi xuất bảng chi (04 §13). THUẦN.
 */
import { describe, it, expect } from "vitest";

import { MA_KHOI_PHUC_HOAN_LEGACY } from "./kieu";
import { dinhDangDong, dinhDangSo, dungViSao, type DongChoViSao } from "./vi-sao";
import { dungBangChi, ketChuyenAm } from "./xuat-ky";
import { tinhConNoTheoDongTruocKhoan } from "./phan-bo-khoan";

const dong = (p: Partial<DongChoViSao> = {}): DongChoViSao => ({
  entryKind: "ORIGINAL",
  amount: 300_000,
  grossAmount: 10_000_000,
  vatRate: 0,
  netBase: 10_000_000,
  rate: 0.03,
  fixedAmount: null,
  capRate: 0.09,
  equivalentRate: 0.09,
  sourceGroupCode: "PAID_ADS",
  transactionTypeCode: "NEW",
  roleCode: "SALE",
  splitMethod: "DONG",
  documentNumber: "SR.QD.208",
  versionNo: 1,
  calcKind: "PERCENT",
  reason: "SOURCE_GROUP=PAID_ADS thắng GLOBAL v1 vì phạm vi cụ thể hơn",
  reasonCode: null,
  naturalPeriod: "2026-10",
  kyGhi: "2026-10",
  lateArrival: false,
  refEntryId: null,
  refEventType: null,
  refEventId: null,
  resolverBasis: { canCu: "LEAD_CONVERTED_BY" },
  paymentId: "pay-1",
  ...p,
});

describe("[NHH-VS] dungViSao — chỉ nói điều dòng sổ THẬT SỰ chứa (ảnh chụp, không phụ thuộc chính sách live)", () => {
  it("[NHH-VS-12] dòng TRẢ LẠI hoa hồng của khoản hoàn sổ cũ bị bác mượn kind DISPUTE_ADJUSTMENT nhưng KHÔNG được gọi là 'khiếu nại'; kind DISPUTE_ADJUSTMENT thật vẫn gọi là khiếu nại", () => {
    const tra = dungViSao(dong({ entryKind: "DISPUTE_ADJUSTMENT", reasonCode: MA_KHOI_PHUC_HOAN_LEGACY, amount: 160_000 }), true);
    expect(tra.tieuDe).not.toMatch(/khiếu nại/);
    expect(tra.tieuDe).toMatch(/Trả lại hoa hồng đã thu hồi/);
    expect(dungViSao(dong({ entryKind: "DISPUTE_ADJUSTMENT", reasonCode: "KHIEU_NAI_X", amount: 1 }), true).tieuDe).toMatch(/khiếu nại/);
  });

  it("[NHH-VS-01] ORIGINAL: cơ sở · loại · nguồn · chính sách + lý do thắng · công thức tiền · kiểm trần", () => {
    const v = dungViSao(dong(), true);
    expect(v.tieuDe).toBe("Hoa hồng phát sinh từ khoản thu · SALE");
    const nhan = (n: string) => v.buoc.find((b) => b.nhan === n);
    expect(nhan("Cơ sở tính hoa hồng")?.giaTri).toBe("10.000.000đ → 10.000.000đ");
    expect(nhan("Loại giao dịch")?.giaTri).toBe("Khách mới (NEW)");
    expect(nhan("Nhóm nguồn")?.giaTri).toBe("PAID_ADS");
    expect(nhan("Chính sách áp dụng")).toMatchObject({ giaTri: "SR.QD.208 · phiên bản 1", ghiChu: expect.stringContaining("thắng GLOBAL") });
    expect(nhan("Công thức")?.giaTri).toBe("10.000.000đ × 3% = 300.000đ");
    expect(nhan("Phần của người này")?.giaTri).toBe("300.000đ");
    expect(nhan("Kiểm trần")?.giaTri).toBe("Tổng tỉ lệ 9% ≤ trần 9%");
    expect(v.canhBao).toEqual([]);
  });

  it("[NHH-VS-02] nguồn UNKNOWN được nói rõ là mức THẤP NHẤT (D7), không im lặng", () => {
    expect(dungViSao(dong({ sourceGroupCode: "UNKNOWN" }), true).buoc.find((b) => b.nhan === "Nhóm nguồn")?.giaTri).toMatch(/mức thấp nhất/);
  });

  it("[NHH-VS-03] VAT: 10.800.000 → 10.000.000 với VAT 8% (V6) — ghi chú nói đã bỏ VAT", () => {
    const b = dungViSao(dong({ grossAmount: 10_800_000, vatRate: 0.08, netBase: 10_000_000 }), true).buoc.find((x) => x.nhan === "Cơ sở tính hoa hồng");
    expect(b).toMatchObject({ giaTri: "10.800.000đ → 10.000.000đ", ghiChu: expect.stringContaining("VAT 8%") });
  });

  it("[NHH-VS-04] REVERSAL: nói rõ thu hồi theo tỉ lệ tiền của dòng gốc, kèm dòng gốc & giao dịch hoàn; số âm hiển thị dấu trừ", () => {
    const v = dungViSao(dong({ entryKind: "REVERSAL", amount: -120_000, netBase: -4_000_000, grossAmount: -4_000_000, refEntryId: "e-goc", refEventType: "PAYMENT", refEventId: "pay-hoan", reasonCode: "HOAN_TIEN", calcKind: "PERCENT" }), true);
    expect(v.buoc.find((b) => b.nhan === "Cơ sở thu hồi")).toMatchObject({ giaTri: "4.000.000đ (đã bỏ VAT 0% của dòng gốc)" });
    expect(v.buoc.find((b) => b.nhan === "Số thu hồi")?.giaTri).toBe("−120.000đ");
    expect(v.buoc.find((b) => b.nhan === "Dòng gốc")?.giaTri).toBe("e-goc");
    expect(v.buoc.find((b) => b.nhan === "Giao dịch liên quan")?.giaTri).toBe("pay-hoan");
  });

  it("[NHH-VS-05] LATE_ARRIVAL (H22): nói kỳ hiệu lực KHÁC kỳ ghi, kèm lý do bằng mã máy, và cảnh báo 'kỳ cũ không bị mở lại'", () => {
    const v = dungViSao(dong({ entryKind: "LATE_ARRIVAL", naturalPeriod: "2026-10", kyGhi: "2026-12", lateArrival: true, reasonCode: "KY_GOC_DA_DONG" }), true);
    expect(v.buoc.find((b) => b.nhan === "Kỳ")).toMatchObject({ giaTri: "Hiệu lực 2026-10 · ghi vào kỳ 2026-12", ghiChu: expect.stringContaining("đã đóng") });
    expect(v.canhBao[0]).toMatch(/không bị mở lại/);
  });

  it("[NHH-VS-06] không bịa lý do: reasonCode lạ ⇒ không có ghi chú kỳ; tỉ lệ vượt trần ghi trên dòng ⇒ cảnh báo dữ liệu bất thường", () => {
    const v = dungViSao(dong({ lateArrival: true, reasonCode: "MA_LA", kyGhi: "2026-11" }), true);
    expect(v.buoc.find((b) => b.nhan === "Kỳ")?.ghiChu).toBeUndefined();
    expect(dungViSao(dong({ equivalentRate: 0.1 }), true).canhBao.join(" ")).toMatch(/bất thường/);
  });

  it("[NHH-VS-07] người chỉ xem phần CỦA MÌNH (hienTongTiLe=false): KHÔNG có tổng tỉ lệ các vai ở bất kỳ chỗ nào; vẫn nói 'trong trần' + trần; phần của mình đầy đủ", () => {
    const d = dong({ equivalentRate: 0.0777 }); // tổng ĐẶC TRƯNG, khác mọi số khác trên dòng
    const kin = JSON.stringify(dungViSao(d, false));
    expect(kin).not.toContain("7,77");
    expect(kin).not.toContain("Tổng tỉ lệ");
    const tran = dungViSao(d, false).buoc.find((b) => b.nhan === "Kiểm trần");
    expect(tran?.giaTri).toBe("Trong trần 9%");
    expect(dungViSao(d, false).buoc.find((b) => b.nhan === "Công thức")?.giaTri).toBe("10.000.000đ × 3% = 300.000đ");
    // đối chứng dương: có quyền xem tổng ⇒ thấy
    expect(JSON.stringify(dungViSao(d, true))).toContain("Tổng tỉ lệ 7,77% ≤ trần 9%");
  });

  it("[NHH-VS-08] cảnh báo 'vượt trần' dựa trên tổng ⇒ chỉ phát cho người được thấy tổng (không để lộ gián tiếp qua cảnh báo)", () => {
    expect(dungViSao(dong({ equivalentRate: 0.1 }), false).canhBao).toEqual([]);
    expect(dungViSao(dong({ equivalentRate: 0.1 }), true).canhBao.join(" ")).toMatch(/bất thường/);
  });

  it("dinhDangDong: nhóm nghìn bằng dấu chấm, dấu trừ thật, làm tròn", () => {
    expect(dinhDangDong(0)).toBe("0đ");
    expect(dinhDangDong(999)).toBe("999đ");
    expect(dinhDangDong(1_234_567)).toBe("1.234.567đ");
    expect(dinhDangDong(-1_000)).toBe("−1.000đ");
  });

  it("[NHH-DD-01] dinhDangSo: số đếm cùng luật nhóm nghìn / dấu trừ / làm tròn với dinhDangDong, KHÔNG hậu tố; soLe > 0 ⇒ phẩy thập phân đủ chữ số", () => {
    expect(dinhDangSo(0)).toBe("0");
    expect(dinhDangSo(999)).toBe("999");
    expect(dinhDangSo(1_234_567)).toBe("1.234.567");
    expect(dinhDangSo(-1_000)).toBe("−1.000");
    expect(dinhDangSo(-0.4)).toBe("0"); // dấu theo giá trị đã làm tròn, như dinhDangDong
    expect(dinhDangSo(2.5)).toBe("3");
    expect(dinhDangSo(8.5, 2)).toBe("8,50");
    expect(dinhDangSo(1234.567, 2)).toBe("1.234,57");
    expect(dinhDangSo(0, 2)).toBe("0,00");
    expect(dinhDangSo(-2.5, 2)).toBe("−2,50");
    // cùng chữ số với dinhDangDong (chỉ khác hậu tố) — hai hàm không được lệch nhau
    for (const n of [0, 7, 1_000, 12_345, 987_654_321]) expect(`${dinhDangSo(n)}đ`).toBe(dinhDangDong(n));
  });
});

describe("[NHH-XK-01] ketChuyenAm — sổ ÂM RÒNG: không xuất số âm, kết chuyển sang tháng kế (04 §13, Q19)", () => {
  const m = (o: Record<string, number>) => new Map(Object.entries(o));

  it("người có Σ tháng dương, không nợ ⇒ xuất đủ, không kết chuyển", () => {
    const r = ketChuyenAm({ tongThang: m({ a: 500_000 }), amKetChuyen: m({}) });
    expect([...r.xuat]).toEqual([["a", 500_000]]);
    expect(r.amMoi.size).toBe(0);
  });

  it("Σ tháng ÂM (hoàn khoản lớn, tháng này không bán được) ⇒ xuất 0 và phần âm sang tháng kế", () => {
    const r = ketChuyenAm({ tongThang: m({ a: -300_000 }), amKetChuyen: m({}) });
    expect(r.xuat.get("a")).toBe(0);
    expect(r.amMoi.get("a")).toBe(-300_000);
  });

  it("nợ âm tháng trước được trừ DẦN vào số dương: +500.000 − 300.000 nợ ⇒ xuất 200.000, hết nợ", () => {
    const r = ketChuyenAm({ tongThang: m({ a: 500_000 }), amKetChuyen: m({ a: -300_000 }) });
    expect(r.xuat.get("a")).toBe(200_000);
    expect(r.amMoi.size).toBe(0);
  });

  it("nợ lớn hơn số dương ⇒ xuất 0, còn nợ phần chênh", () => {
    const r = ketChuyenAm({ tongThang: m({ a: 100_000 }), amKetChuyen: m({ a: -300_000 }) });
    expect(r.xuat.get("a")).toBe(0);
    expect(r.amMoi.get("a")).toBe(-200_000);
  });

  it("người chỉ có nợ cũ, tháng này không có dòng nào ⇒ vẫn mang nợ sang tiếp (không biến mất)", () => {
    const r = ketChuyenAm({ tongThang: m({}), amKetChuyen: m({ a: -50_000 }) });
    expect(r.xuat.get("a")).toBe(0);
    expect(r.amMoi.get("a")).toBe(-50_000);
  });

  it("bất biến: KHÔNG BAO GIỜ xuất số âm; Σ xuất + Σ nợ mới = Σ tháng + Σ nợ cũ", () => {
    const tong = m({ a: 700_000, b: -200_000, c: 0, d: 50_000 });
    const no = m({ a: -100_000, b: -50_000, d: -80_000 });
    const r = ketChuyenAm({ tongThang: tong, amKetChuyen: no });
    for (const v of r.xuat.values()) expect(v).toBeGreaterThanOrEqual(0);
    const vao = [...tong.values(), ...no.values()].reduce((s, x) => s + x, 0);
    const ra = [...r.xuat.values(), ...r.amMoi.values()].reduce((s, x) => s + x, 0);
    expect(ra).toBe(vao);
  });

  // Cấy 08/10: bỏ kẹp `Math.min(0, …)` đầu vào ⇒ 0 ca đỏ — chỗ gọi đã kẹp một lần nên lần kẹp thứ hai ở đây chưa từng được chạm. Hàm thuần tự giữ hợp đồng "nợ ≤ 0".
  it("hợp đồng đầu vào: 'nợ' DƯƠNG (dữ liệu hỏng) KHÔNG làm tăng số xuất — coi như 0", () => {
    const r = ketChuyenAm({ tongThang: m({ a: 100_000 }), amKetChuyen: m({ a: 50_000 }) });
    expect(r.xuat.get("a")).toBe(100_000);
    expect(r.amMoi.size).toBe(0);
  });

  it("dungBangChi: tổng chi là Σ phần xuất (không âm), có cột kết chuyển trước/sau", () => {
    const b = dungBangChi({
      tongThang: m({ a: 500_000, b: -100_000 }),
      amKetChuyen: m({ a: -100_000 }),
      ten: m({}) as never,
    });
    expect(b.dong.map((d) => [d.nguoi, d.soTienChi, d.amKetChuyenTruoc, d.amKetChuyenSau])).toEqual([
      ["a", 400_000, -100_000, 0],
      ["b", 0, 0, -100_000],
    ]);
    expect(b.tong).toBe(400_000);
  });
});

describe("[NHH-TRX-07b] tinhConNoTheoDongTruocKhoan — V7: các khoản KHÔNG gắn đứng trước được quy cho thành phần bằng chính phanBoKhoan", () => {
  const hp = { orderItemId: "oi-hp", loai: "COURSE_ENROLLMENT", enrollmentId: null, studentId: "hv", enrollmentStudentId: null, phaiThu: 10_000_000 };
  const kit = { orderItemId: "oi-kit", loai: "PRODUCT", enrollmentId: null, studentId: null, enrollmentStudentId: null, phaiThu: 2_000_000 };

  it("khoản 1 = 10tr gắn học phí; ⇒ học phí còn 0, kit còn 2tr (khoản 2 = 2tr không gắn sẽ rơi vào kit)", () => {
    const no = tinhConNoTheoDongTruocKhoan({
      dong: [hp, kit],
      khoanTruoc: [{ amount: 10_000_000, orderItemId: "oi-hp", enrollmentId: null, enrollmentStudentId: null }],
      orderType: "COURSE",
      hocVienTheoLeadChild: null,
    });
    expect([no.get("oi-hp"), no.get("oi-kit")]).toEqual([0, 2_000_000]);
  });

  it("khoản KHÔNG gắn đứng trước, CHỈ kit còn nợ ⇒ trừ vào kit (không trừ nhầm vào học phí)", () => {
    const no = tinhConNoTheoDongTruocKhoan({
      dong: [{ ...hp, phaiThu: 0 }, kit],
      khoanTruoc: [{ amount: 500_000, orderItemId: null, enrollmentId: null, enrollmentStudentId: null }],
      orderType: "COURSE",
      hocVienTheoLeadChild: null,
    });
    expect([no.get("oi-hp"), no.get("oi-kit")]).toEqual([0, 1_500_000]);
  });

  it("khoản không gắn mà CẢ HAI còn nợ ⇒ bị giữ (CHUA_GAN_CON) ⇒ KHÔNG trừ vào đâu (không đoán)", () => {
    const no = tinhConNoTheoDongTruocKhoan({
      dong: [hp, kit],
      khoanTruoc: [{ amount: 6_000_000, orderItemId: null, enrollmentId: null, enrollmentStudentId: null }],
      orderType: "COURSE",
      hocVienTheoLeadChild: null,
    });
    expect([no.get("oi-hp"), no.get("oi-kit")]).toEqual([10_000_000, 2_000_000]);
  });
});
