// @vitest-environment node
/**
 * [NHH-POL-04*] trần · [NHH-POL-VAT-*] VAT · [NHH-POL-TIEN-*] làm tròn tiền (04 §4.2, §8, §9.1). THUẦN.
 */
import { describe, it, expect } from "vitest";
import { chiaTienChoVai, kiemTran, lamTronTien, tachVat, tienPhanTram, tiLeSangMicro, vatHieuLuc, type QuyTacTheoVai } from "./tien";

const pct = (roleCode: string, rate: number | string): QuyTacTheoVai => ({ roleCode, kieuTinh: "PERCENT", rate });

/** Seed v1 (04 §6.7): Sale 4% + Sale Admin 1% + QLCS 2% + Marketing 1% + GV Trial 1% = 9%. */
const SEED_V1: QuyTacTheoVai[] = [
  pct("SALE", 0.04),
  pct("SALE_ADMIN", 0.01),
  pct("CENTER_MANAGER", 0.02),
  pct("MARKETING", 0.01),
  pct("TRIAL_TEACHER", 0.01),
];

describe("[NHH-POL-04] trần = Σ TỈ LỆ rule thắng, so bằng số nguyên, tham số bắt buộc (04 §8)", () => {
  it("[NHH-POL-04] 9% qua, 9,01% chặn (trần 9%)", () => {
    expect(kiemTran({ coSo: 10_000_000, quyTacTheoVai: SEED_V1, tranTongTiLe: 0.09 }).ok).toBe(true);
    const vuot = kiemTran({
      coSo: 10_000_000,
      quyTacTheoVai: [...SEED_V1.slice(0, 4), pct("TRIAL_TEACHER", 0.0101)],
      tranTongTiLe: 0.09,
    });
    expect(vuot.ok).toBe(false);
    if (!vuot.ok) {
      expect(vuot.tiLeTuongDuong).toBeCloseTo(0.0901, 6);
      expect(vuot.tran).toBe(0.09);
    }
  });

  it("[NHH-POL-04] trần đọc từ cấu hình: setting 0.10 ⇒ 9,5% qua; cùng bộ rule mà trần 0.09 ⇒ chặn", () => {
    const chin_ruoi = [...SEED_V1.slice(0, 4), pct("TRIAL_TEACHER", 0.015)];
    expect(kiemTran({ coSo: 10_000_000, quyTacTheoVai: chin_ruoi, tranTongTiLe: 0.1 }).ok).toBe(true);
    expect(kiemTran({ coSo: 10_000_000, quyTacTheoVai: chin_ruoi, tranTongTiLe: 0.09 }).ok).toBe(false);
  });

  it("[NHH-POL-04b] V3b: cơ sở 1.234.550đ, seed v1 Σ 9% ⇒ QUA dù Σ tiền đã làm tròn 111.111đ > 9% × cơ sở 111.109,5đ", () => {
    const coSo = 1_234_550;
    const tienTungVai = SEED_V1.map((q) => tienPhanTram(coSo, (q as { rate: number }).rate));
    const tongTien = tienTungVai.reduce((a, b) => a + b, 0);
    expect(tienTungVai).toEqual([49_382, 12_346, 24_691, 12_346, 12_346]);
    expect(tongTien).toBe(111_111);
    expect(tongTien).toBeGreaterThan(coSo * 0.09); // 111.109,5 — thiết kế cũ so tiền sẽ báo vượt GIẢ
    const r = kiemTran({ coSo, quyTacTheoVai: SEED_V1, tranTongTiLe: 0.09 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tiLeTuongDuong).toBeCloseTo(0.09, 9);
  });

  it("[NHH-POL-04c] GV Trial NẰM TRONG trần: 8% bốn vai + GV 1,01% ⇒ chặn; GV 1% ⇒ qua", () => {
    const bonVai = SEED_V1.slice(0, 4);
    expect(kiemTran({ coSo: 5_000_000, quyTacTheoVai: [...bonVai, pct("TRIAL_TEACHER", 0.0101)], tranTongTiLe: 0.09 }).ok).toBe(false);
    expect(kiemTran({ coSo: 5_000_000, quyTacTheoVai: [...bonVai, pct("TRIAL_TEACHER", 0.01)], tranTongTiLe: 0.09 }).ok).toBe(true);
    // Đối chứng: bỏ GV Trial ra ngoài trần thì 8% + 1,01% không bị coi là vượt — chính là thiết kế CŨ.
    expect(kiemTran({ coSo: 5_000_000, quyTacTheoVai: bonVai, tranTongTiLe: 0.09 }).ok).toBe(true);
  });

  it("[NHH-POL-04d] kiểu cố định (P1) cộng vào tỉ lệ tương đương theo cơ sở của KHOẢN ĐÓ", () => {
    // 9% × 1.000.000đ = 90.000đ. Rule cố định 10.000đ + 8% = 90.000đ ⇒ đúng trần; 10.001đ ⇒ vượt.
    const rules = (fixed: number): QuyTacTheoVai[] => [pct("SALE", 0.08), { roleCode: "REFERRER_PARENT", kieuTinh: "FIXED_PER_PURCHASE", fixed }];
    expect(kiemTran({ coSo: 1_000_000, quyTacTheoVai: rules(10_000), tranTongTiLe: 0.09 }).ok).toBe(true);
    expect(kiemTran({ coSo: 1_000_000, quyTacTheoVai: rules(10_001), tranTongTiLe: 0.09 }).ok).toBe(false);
    // Cơ sở 0 mà còn khoản cố định ⇒ không chia được ⇒ chặn (fail-closed), không chia cho 0.
    expect(kiemTran({ coSo: 0, quyTacTheoVai: rules(1), tranTongTiLe: 0.09 }).ok).toBe(false);
  });

  it("[NHH-POL-04e] trần KHÔNG có mặc định: thiếu / NaN / âm ⇒ ném, không im lặng dùng 9%", () => {
    // @ts-expect-error — cố tình thiếu tham số bắt buộc (luật 7)
    expect(() => kiemTran({ coSo: 1_000_000, quyTacTheoVai: SEED_V1 })).toThrow();
    expect(() => kiemTran({ coSo: 1_000_000, quyTacTheoVai: SEED_V1, tranTongTiLe: Number.NaN })).toThrow();
    expect(() => kiemTran({ coSo: 1_000_000, quyTacTheoVai: SEED_V1, tranTongTiLe: -0.01 })).toThrow();
  });

  it("[NHH-POL-04f] không có rule nào ⇒ qua (không sinh gì thì không vượt)", () => {
    const r = kiemTran({ coSo: 1_000_000, quyTacTheoVai: [], tranTongTiLe: 0.09 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tiLeTuongDuong).toBe(0);
  });
});

describe("[NHH-POL-TIEN] làm tròn MỘT lần ở mức vai (04 §9.1)", () => {
  it("[NHH-POL-TIEN-01] tiLeSangMicro đúng với mọi tỉ lệ ≤ 6 chữ số thập phân, kể cả dạng chuỗi Decimal", () => {
    expect(tiLeSangMicro(0.04)).toBe(BigInt(40000));
    expect(tiLeSangMicro("0.040000")).toBe(BigInt(40000));
    expect(tiLeSangMicro(0.0901)).toBe(BigInt(90100));
    expect(tiLeSangMicro("1")).toBe(BigInt(1000000));
    expect(() => tiLeSangMicro(0.1234567)).toThrow(); // 7 chữ số — Decimal(9,6) không chứa được
    expect(() => tiLeSangMicro(Number.NaN)).toThrow();
  });

  it("[NHH-POL-TIEN-02] tienPhanTram = làm tròn một lần, nửa lên: 12.345,5 ⇒ 12.346; 0 ⇒ 0", () => {
    expect(tienPhanTram(1_234_550, 0.01)).toBe(12_346);
    expect(tienPhanTram(1_234_549, 0.01)).toBe(12_345);
    expect(tienPhanTram(0, 0.09)).toBe(0);
    expect(() => tienPhanTram(-1, 0.04)).toThrow(); // cơ sở âm là việc của dòng đảo, không phải của hàm này
  });

  it("[NHH-POL-TIEN-03] chiaTienChoVai: Σ phần ĐÚNG bằng tổng vai; người bị loại KHÔNG được chia lại cho người còn lại", () => {
    // 10.000đ chia 3 người ⇒ 3.334 + 3.333 + 3.333; người thứ ba nghỉ ⇒ phần của họ TREO, hai người kia KHÔNG ăn thêm.
    const chia = chiaTienChoVai(10_000, ["u1", "u2", "u3"], new Set(["u3"]));
    expect(chia.cacPhan.map((p) => p.amount)).toEqual([3_334, 3_333, 3_333]);
    expect(chia.duocChi).toEqual([
      { recipientId: "u1", amount: 3_334 },
      { recipientId: "u2", amount: 3_333 },
    ]);
    expect(chia.treo).toEqual([{ recipientId: "u3", amount: 3_333 }]);
    expect(chia.duocChi.reduce((s, p) => s + p.amount, 0) + chia.treo.reduce((s, p) => s + p.amount, 0)).toBe(10_000);
  });

  it("[NHH-POL-TIEN-04] lamTronTien đối xứng quanh 0 (dòng đảo = đúng âm của dòng gốc)", () => {
    expect(lamTronTien(12_345.5)).toBe(12_346);
    expect(lamTronTien(-12_345.5)).toBe(-12_346);
    expect(lamTronTien(-0.4)).toBe(0);
  });
});

describe("[NHH-POL-VAT] snapshot VAT (04 §4.2, D15)", () => {
  it("[NHH-POL-VAT-01] bảng rỗng ⇒ vatRate = 0 (mặc định cho tới khi kế toán chốt); net = gross", () => {
    expect(vatHieuLuc([], "2026-09-15")).toBe(0);
    expect(tachVat(1_234_550, 0)).toEqual({ grossAmount: 1_234_550, vatRate: 0, netBase: 1_234_550 });
  });

  it("[NHH-POL-VAT-02] theo NGÀY GỐC: mốc bắt đầu 2026-10-01 8% — khoản thu 30/09 vẫn 0, 01/10 là 8%", () => {
    const bang = [{ tuNgay: "2026-10-01", tiLe: 0.08 }];
    expect(vatHieuLuc(bang, "2026-09-30")).toBe(0);
    expect(vatHieuLuc(bang, "2026-10-01")).toBe(0.08);
    expect(vatHieuLuc(bang, "2026-12-31")).toBe(0.08);
  });

  it("[NHH-POL-VAT-03] nhiều mốc: lấy mốc gần nhất ≤ ngày gốc", () => {
    const bang = [
      { tuNgay: "2026-01-01", tiLe: 0.1 },
      { tuNgay: "2026-07-01", tiLe: 0.08 },
    ];
    expect(vatHieuLuc(bang, "2026-06-30")).toBe(0.1);
    expect(vatHieuLuc(bang, "2026-07-01")).toBe(0.08);
  });

  it("[NHH-POL-VAT-04] net = round(gross/(1+vat)): 1.080.000 @8% ⇒ 1.000.000; dòng đảo dùng vatRate CỦA DÒNG GỐC ⇒ đúng âm", () => {
    const goc = tachVat(1_080_000, 0.08);
    expect(goc.netBase).toBe(1_000_000);
    const dao = tachVat(-1_080_000, 0.08);
    expect(dao.netBase).toBe(-1_000_000);
  });

  it("[NHH-POL-VAT-04b] NỬA ĐỒNG: 3 @20% ⇒ 2,5 ⇒ 3; dòng đảo −3 ⇒ đúng −3 (đối xứng, không lệch 1 đồng như Math.round)", () => {
    // Cấy 08/10 (V01, Math.round thay lamTronTien): 0 ca đỏ — VAT-04 chỉ thử số tròn, nơi mọi cách làm tròn đều ra cùng kết quả.
    // Math.round(−2,5) = −2 nên dòng đảo của một khoản có phần lẻ nửa đồng KHÔNG còn bằng âm dòng gốc ⇒ sổ lệch 1 đồng mỗi lần hoàn.
    const goc = tachVat(3, 0.2);
    const dao = tachVat(-3, 0.2);
    expect(goc.netBase).toBe(3);
    expect(dao.netBase).toBe(-3);
    expect(dao.netBase).toBe(-goc.netBase);
    for (const g of [3, 15, 27, 33, 1_234_567]) expect(tachVat(-g, 0.2).netBase, `gross ${g}`).toBe(-tachVat(g, 0.2).netBase);
  });

  it("[NHH-POL-VAT-05] bảng không tăng dần / tỉ lệ ngoài [0,1) bị từ chối", () => {
    expect(() => vatHieuLuc([{ tuNgay: "2026-07-01", tiLe: 0.08 }, { tuNgay: "2026-01-01", tiLe: 0.1 }], "2026-08-01")).toThrow();
    expect(() => vatHieuLuc([{ tuNgay: "2026-01-01", tiLe: 1 }], "2026-08-01")).toThrow();
    expect(() => vatHieuLuc([{ tuNgay: "2026-01-01", tiLe: -0.1 }], "2026-08-01")).toThrow();
  });
});
