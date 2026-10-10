// @vitest-environment node
/**
 * [NHH-COM-06] / [NHH-COM-17] / [NHH-COM-18] / [NHH-COM-20] — ô tính (L13/L14), đảo theo dòng gốc, khoá idempotency và
 * `inputHash` (04 §10, §11). THUẦN. Ví dụ số: V1, V3, V8 của 04 §18.
 */
import { describe, it, expect } from "vitest";

import { bamDauVao, chuoiChuanHoa, khoaDao, khoaDieuChinh, khoaLegacy, khoaNguoi, khoaOriginal, tachKhoaNguoi } from "./khoa-so";
import { soVoiO, tachChenhDoiNguon, type TrangThaiO } from "./o-tinh";
import { tinhDaoNguoc } from "./dao-nguoc";

const SALE = khoaNguoi("SALE", "USER", "u-sale");
const REF = khoaNguoi("REFERRER_PARENT", "USER", "u-ph");
const QC1 = khoaNguoi("MARKETING", "USER", "u-qc1");
const QC2 = khoaNguoi("MARKETING", "USER", "u-qc2");

function o(p: Partial<Omit<TrangThaiO, "rong">> & { rong?: Record<string, number> } = {}): TrangThaiO {
  const { rong, ...rest } = p;
  return {
    calcSlotId: "slot-1",
    netBase: 10_000_000,
    coSoConLai: 10_000_000,
    rong: new Map(Object.entries(rong ?? { [SALE]: 300_000 })),
    hashDaChapNhan: new Set(["h-cu"]),
    coKhieuNai: false,
    soLanDao: 0,
    ...rest,
  };
}
const kv = (x: Record<string, number>) => new Map(Object.entries(x));

describe("[NHH-COM-17] soVoiO — so Σ RÒNG của ô với kỳ vọng hôm nay (04 §10.4)", () => {
  it("đối chứng dương: không đổi gì (hash đã chấp nhận) ⇒ không làm gì — 0 dòng, 0 hàng chờ", () => {
    expect(soVoiO({ o: o(), kyVong: kv({ [SALE]: 300_000 }), hashMoi: "h-cu", cheDo: "QUET" })).toEqual({ loai: "KHONG_LAM_GI", lyDo: "HASH_DA_CHAP_NHAN" });
  });

  it("hash lệch nhưng TIỀN không đổi ⇒ không làm gì (đầu vào đổi mà tiền giữ nguyên)", () => {
    expect(soVoiO({ o: o(), kyVong: kv({ [SALE]: 300_000 }), hashMoi: "h-moi", cheDo: "QUET" })).toEqual({ loai: "KHONG_LAM_GI", lyDo: "CHENH_BANG_0" });
  });

  it("(a)(b)(c) đổi người / thêm người: hash lệch + tiền lệch ⇒ INPUT_DRIFT, KHÔNG tự ghi ORIGINAL nào", () => {
    // đổi Sale: u-sale-moi được 300k, u-sale cũ phải về 0 ⇒ chênh +300k và −300k
    const moi = khoaNguoi("SALE", "USER", "u-sale-moi");
    const r = soVoiO({ o: o(), kyVong: kv({ [moi]: 300_000 }), hashMoi: "h-moi", cheDo: "QUET" });
    expect(r).toMatchObject({ loai: "INPUT_DRIFT" });
    expect(r.loai === "INPUT_DRIFT" && r.chenh.map((c) => [c.key, c.chenh])).toEqual([
      [SALE, -300_000],
      [moi, 300_000],
    ]);
  });

  it("(d) rule sang EXCLUDE (kỳ vọng rỗng) ⇒ INPUT_DRIFT đòi lại −300k — dòng cũ KHÔNG biến mất khỏi so sánh", () => {
    const r = soVoiO({ o: o(), kyVong: kv({}), hashMoi: "h-moi", cheDo: "QUET" });
    expect(r).toMatchObject({ loai: "INPUT_DRIFT", chenh: [{ key: SALE, chenh: -300_000, kyVong: 0, rong: 300_000 }] });
  });

  it("hash đã 'giữ nguyên' (DISMISSED) nằm trong hashDaChapNhan ⇒ không đẻ hàng chờ lần hai", () => {
    const r = soVoiO({ o: o({ hashDaChapNhan: new Set(["h-cu", "h-da-giu-nguyen"]) }), kyVong: kv({}), hashMoi: "h-da-giu-nguyen", cheDo: "QUET" });
    expect(r.loai).toBe("KHONG_LAM_GI");
  });
});

describe("[NHH-COM-23] dung sai LÀM TRÒN sau hoàn một phần — chênh 1đ KHÔNG phải trôi đầu vào (04 §11.1: 'làm tròn từng người lệch tối đa 1đ')", () => {
  // Ví dụ đo trên DB thật (08/10): gốc 1.326.956 × 1% = 13.270; hoàn 753.016 ⇒ đảo round(13.270 × 753.016 / 1.326.956) = −7.530 ⇒ ròng 5.740.
  // Kỳ vọng hôm nay trên cơ sở còn lại 573.940 × 1% = 5.739,4 ⇒ 5.739. Hai phép làm tròn khác nhau ⇒ lệch 1đ mà đầu vào KHÔNG đổi.
  const sauHoanLe = (soLanDao: number, rong = 5_740) => o({ netBase: 1_326_956, coSoConLai: 573_940, rong: { [SALE]: rong }, soLanDao });

  it("QUET, đã hoàn 1 lần, chênh ±1đ ⇒ KHÔNG làm gì (không đẻ INPUT_DRIFT cứng chặn khoá kỳ)", () => {
    expect(soVoiO({ o: sauHoanLe(1), kyVong: kv({ [SALE]: 5_739 }), hashMoi: "h-moi", cheDo: "QUET" })).toEqual({ loai: "KHONG_LAM_GI", lyDo: "LAM_TRON_SAU_HOAN" });
    expect(soVoiO({ o: sauHoanLe(1, 5_738), kyVong: kv({ [SALE]: 5_739 }), hashMoi: "h-moi", cheDo: "QUET" })).toEqual({ loai: "KHONG_LAM_GI", lyDo: "LAM_TRON_SAU_HOAN" });
  });

  it("đối chứng: CHƯA hoàn lần nào ⇒ dung sai 0 — chênh 1đ vẫn là INPUT_DRIFT (làm tròn lúc ghi và lúc so cùng một công thức)", () => {
    expect(soVoiO({ o: sauHoanLe(0), kyVong: kv({ [SALE]: 5_739 }), hashMoi: "h-moi", cheDo: "QUET" }).loai).toBe("INPUT_DRIFT");
  });

  it("đối chứng: chênh VƯỢT dung sai ⇒ vẫn là INPUT_DRIFT (đổi người / đổi tỉ lệ thật không bị nuốt)", () => {
    expect(soVoiO({ o: sauHoanLe(1), kyVong: kv({ [SALE]: 5_742 }), hashMoi: "h-moi", cheDo: "QUET" }).loai).toBe("INPUT_DRIFT");
    // người MỚI hưởng 5.739đ (ròng 0) là đổi người thật, không phải sai số làm tròn ⇒ vượt dung sai
    const moi = khoaNguoi("SALE", "USER", "u-sale-moi");
    expect(soVoiO({ o: sauHoanLe(1), kyVong: kv({ [SALE]: 5_740, [moi]: 5_739 }), hashMoi: "h-moi", cheDo: "QUET" }).loai).toBe("INPUT_DRIFT");
  });

  it("dung sai nở theo số lần hoàn: 1 lần ⇒ 1đ, 2 lần ⇒ 2đ, 4 lần ⇒ 3đ (sai số làm tròn cộng dồn ≤ 0,5đ mỗi lần)", () => {
    const sai = (k: number, lech: number) => soVoiO({ o: sauHoanLe(k), kyVong: kv({ [SALE]: 5_740 + lech }), hashMoi: "h-moi", cheDo: "QUET" }).loai;
    expect([sai(1, 1), sai(1, 2), sai(2, 2), sai(2, 3), sai(4, 3), sai(4, 4)]).toEqual(["KHONG_LAM_GI", "INPUT_DRIFT", "KHONG_LAM_GI", "INPUT_DRIFT", "KHONG_LAM_GI", "INPUT_DRIFT"]);
  });

  it("đổi nguồn CÓ QUYỀN không dùng dung sai: tự ghi đúng số chênh (kể cả 1đ) — chỉ lượt QUET mới nuốt sai số làm tròn", () => {
    const r = soVoiO({ o: sauHoanLe(1), kyVong: kv({ [SALE]: 5_739 }), hashMoi: "h-moi", cheDo: "DOI_NGUON_CO_QUYEN" });
    expect(r).toEqual({ loai: "GHI", chenh: [{ key: SALE, chenh: -1, kyVong: 5_739, rong: 5_740 }] });
  });

  it("ô có KHIẾU NẠI + chênh 1đ sau hoàn: lượt QUET vẫn không đẻ drift giả", () => {
    expect(soVoiO({ o: { ...sauHoanLe(1), coKhieuNai: true }, kyVong: kv({ [SALE]: 5_739 }), hashMoi: "h-moi", cheDo: "QUET" }).loai).toBe("KHONG_LAM_GI");
  });
});

describe("[NHH-COM-18] V8— đổi nguồn có quyền sau khi đã HOÀN: correction tính trên Σ RÒNG và cơ sở CÒN LẠI", () => {
  // Khoản 10tr, Sale 400.000 ban đầu; hoàn 4tr ⇒ Sale −160.000 ⇒ rong 240.000, coSoConLai 6tr. Đổi nguồn: REFERRER_PARENT 1%.
  const sauHoan = o({ coSoConLai: 6_000_000, rong: { [SALE]: 240_000 } });

  it("kỳ vọng trên 6tr: Sale 4% × 6tr = 240.000 (không đổi), REFERRER 1% × 6tr = 60.000 ⇒ chỉ +60.000 cho REFERRER", () => {
    const r = soVoiO({ o: sauHoan, kyVong: kv({ [SALE]: 240_000, [REF]: 60_000 }), hashMoi: "h-moi", cheDo: "DOI_NGUON_CO_QUYEN" });
    expect(r).toEqual({ loai: "GHI", chenh: [{ key: REF, chenh: 60_000, kyVong: 60_000, rong: 0 }] });
  });

  it("cấy: tính trên TOÀN netBase 10tr cho +100.000 — sai, trả trên phần ĐÃ HOÀN (đây là con số thiết kế cũ ra)", () => {
    const r = soVoiO({ o: sauHoan, kyVong: kv({ [SALE]: 400_000, [REF]: 100_000 }), hashMoi: "h-moi", cheDo: "DOI_NGUON_CO_QUYEN" });
    expect(r.loai === "GHI" && r.chenh.find((c) => c.key === REF)?.chenh).toBe(100_000);
    // bản đúng ở ca trên là 60.000 — hai con số KHÁC nhau là toàn bộ ý nghĩa của `coSoConLai`
  });

  it("sau khi ghi correction Σ ròng = kỳ vọng ⇒ lượt Tính kế tiếp KHÔNG ghi thêm (không còn ORIGINAL thứ hai)", () => {
    const xong = o({ coSoConLai: 6_000_000, rong: { [SALE]: 240_000, [REF]: 60_000 }, hashDaChapNhan: new Set(["h-moi"]) });
    for (let i = 0; i < 2; i++) {
      expect(soVoiO({ o: xong, kyVong: kv({ [SALE]: 240_000, [REF]: 60_000 }), hashMoi: "h-moi", cheDo: "QUET" }).loai).toBe("KHONG_LAM_GI");
    }
  });

  it("ô có KHIẾU NẠI ⇒ không tự động (về INPUT_DRIFT) — khiếu nại có thể đã bù đúng phần mà đổi nguồn sắp trả", () => {
    const r = soVoiO({ o: o({ coKhieuNai: true }), kyVong: kv({ [SALE]: 300_000, [REF]: 100_000 }), hashMoi: "h-moi", cheDo: "DOI_NGUON_CO_QUYEN" });
    expect(r.loai).toBe("INPUT_DRIFT");
  });

  it("chế độ QUET không bao giờ tự ghi, kể cả khi chênh lệch rõ ràng", () => {
    expect(soVoiO({ o: o(), kyVong: kv({ [SALE]: 300_000, [REF]: 100_000 }), hashMoi: "h-moi", cheDo: "QUET" }).loai).toBe("INPUT_DRIFT");
  });
});

describe("[NHH-COM-06] tinhDaoNguoc — V1: thu 10tr, Sale 3% = 300.000, hoàn 4tr ⇒ −120.000; hoàn tiếp 6tr ⇒ −180.000", () => {
  const goc = (id = "e-sale"): ReadonlyMap<string, string> => new Map([[SALE, id]]);

  it("hoàn 4.000.000 trên 10.000.000 ⇒ −120.000 (tỉ lệ TIỀN của chính dòng, không phải rate hôm nay)", () => {
    const r = tinhDaoNguoc({ absAmountAm: 4_000_000, vatRateGoc: 0, nhomO: [{ o: o(), dongGoc: goc() }] });
    expect(r.coSoDao).toBe(4_000_000);
    expect(r.theoO[0]!.dong).toEqual([{ key: SALE, amount: -120_000, refEntryId: "e-sale" }]);
  });

  it("hoàn tiếp 6.000.000 ≥ cơ sở còn lại 6tr ⇒ ĐẢO SẠCH −180.000, tổng về đúng 0 (không lệch 1đ)", () => {
    const sau = o({ coSoConLai: 6_000_000, rong: { [SALE]: 180_000 } });
    const r = tinhDaoNguoc({ absAmountAm: 6_000_000, vatRateGoc: 0, nhomO: [{ o: sau, dongGoc: goc() }] });
    expect(r.theoO[0]!.dong).toEqual([{ key: SALE, amount: -180_000, refEntryId: "e-sale" }]);
  });

  it("hoàn LỚN HƠN cơ sở còn lại vẫn không đảo quá số ròng (đảo sạch, dừng ở rong)", () => {
    const sau = o({ coSoConLai: 6_000_000, rong: { [SALE]: 180_000 } });
    const r = tinhDaoNguoc({ absAmountAm: 9_000_000, vatRateGoc: 0, nhomO: [{ o: sau, dongGoc: goc() }] });
    expect(r.theoO[0]!.dong[0]!.amount).toBe(-180_000);
  });

  it("[NHH-COM-20] V3 — 2 QC mỗi người 50.000, hoàn 4/10 ⇒ MỖI người −20.000, Σ vai Marketing −40.000 (thiết kế cũ ra −80.000)", () => {
    const r = tinhDaoNguoc({
      absAmountAm: 4_000_000,
      vatRateGoc: 0,
      nhomO: [{ o: o({ rong: { [QC1]: 50_000, [QC2]: 50_000 } }), dongGoc: new Map([[QC1, "e1"], [QC2, "e2"]]) }],
    });
    expect(r.theoO[0]!.dong.map((d) => [d.key, d.amount])).toEqual([
      [QC1, -20_000],
      [QC2, -20_000],
    ]);
    expect(r.theoO[0]!.dong.reduce((s, d) => s + d.amount, 0)).toBe(-40_000);
  });

  it("V6 — VAT của DÒNG GỐC: hoàn 5.400.000 với vatRate gốc 0,08 ⇒ cơ sở đảo 5.000.000 (không tra lại VAT hôm nay)", () => {
    const sau = o({ netBase: 10_000_000, coSoConLai: 10_000_000, rong: { [SALE]: 300_000 } });
    const r = tinhDaoNguoc({ absAmountAm: 5_400_000, vatRateGoc: 0.08, nhomO: [{ o: sau, dongGoc: goc() }] });
    expect(r.coSoDao).toBe(5_000_000);
    expect(r.theoO[0]!.dong[0]!.amount).toBe(-150_000);
  });

  it("người đã bị đảo hết / sửa nguồn rút về 0 (rong ≤ 0) ⇒ không sinh dòng", () => {
    const r = tinhDaoNguoc({ absAmountAm: 4_000_000, vatRateGoc: 0, nhomO: [{ o: o({ rong: { [SALE]: 0, [REF]: 0 } }), dongGoc: new Map() }] });
    expect(r.theoO[0]!.dong).toEqual([]);
  });

  it("làm tròn từng người lệch tối đa 1đ: 33.333 × 4/10 = 13.333,2 ⇒ −13.333", () => {
    const r = tinhDaoNguoc({ absAmountAm: 4_000_000, vatRateGoc: 0, nhomO: [{ o: o({ rong: { [SALE]: 33_333 } }), dongGoc: goc() }] });
    expect(r.theoO[0]!.dong[0]!.amount).toBe(-13_333);
  });

  it("thiếu dòng gốc cho người có số ròng ⇒ ném (không đảo mù)", () => {
    expect(() => tinhDaoNguoc({ absAmountAm: 1_000, vatRateGoc: 0, nhomO: [{ o: o(), dongGoc: new Map() }] })).toThrow(/dòng gốc/);
  });

  it("nhiều ô của cùng gốc: cơ sở đảo chia theo cơ sở còn lại của từng ô, Σ = coSoDao", () => {
    const o1 = o({ calcSlotId: "s1", coSoConLai: 6_000_000, rong: { [SALE]: 240_000 } });
    const o2 = o({ calcSlotId: "s2", coSoConLai: 4_000_000, rong: { [SALE]: 160_000 } });
    const r = tinhDaoNguoc({
      absAmountAm: 5_000_000,
      vatRateGoc: 0,
      nhomO: [
        { o: o1, dongGoc: goc("e1") },
        { o: o2, dongGoc: goc("e2") },
      ],
    });
    expect(r.theoO.map((x) => x.coSoDao)).toEqual([3_000_000, 2_000_000]);
    expect(r.theoO.flatMap((x) => x.dong.map((d) => d.amount))).toEqual([-120_000, -80_000]);
  });
});

describe("khoá idempotency & inputHash (04 §10.3, §10.4)", () => {
  it("khoá ORIGINAL KHÔNG chứa policyVersionId: version mới ra không đẻ khoá mới cho cùng khoản × vai × người", () => {
    const a = khoaOriginal({ paymentId: "p1", orderItemKey: "oi1", thanhPhan: "TUITION", roleCode: "SALE", kind: "USER", beneficiaryId: "u1" });
    expect(a).toBe("ORIG|p1|oi1|TUITION|SALE|USER|u1");
    expect(a).not.toMatch(/version/i);
  });
  it("mọi thành phần NOT NULL: thiếu dòng đơn ⇒ '-'", () => {
    expect(khoaOriginal({ paymentId: "p1", orderItemKey: "", thanhPhan: "TUITION", roleCode: "SALE", kind: "USER", beneficiaryId: "u1" })).toBe("ORIG|p1|-|TUITION|SALE|USER|u1");
    expect(khoaDieuChinh({ loai: "SOURCE_CORRECTION", refEventId: "ev", calcSlotId: null, roleCode: "SALE", kind: "USER", beneficiaryId: "u1" })).toBe("SOURCE_CORRECTION|ev|-|SALE|USER|u1");
  });
  it("khoá đảo = bút toán ÂM × dòng gốc — hai lượt cùng một cặp ra cùng khoá", () => {
    expect(khoaDao("r1", "e1")).toBe(khoaDao("r1", "e1"));
    expect(khoaDao("r1", "e1")).not.toBe(khoaDao("r2", "e1"));
  });
  it("[NHH-COM-12f] khoá LEGACY_REVERSAL = khoản hoàn × TẦNG × NGƯỜI: hai người cùng tầng (vd 2 QC) hoặc cùng người khác tầng KHÔNG đụng khoá nhau; cùng bộ ba ⇒ cùng khoá (retry idempotent)", () => {
    expect(khoaLegacy("r1", "QC", "u1")).toBe(khoaLegacy("r1", "QC", "u1"));
    expect(khoaLegacy("r1", "QC", "u1")).not.toBe(khoaLegacy("r1", "QC", "u2")); // cùng tầng, khác người
    expect(khoaLegacy("r1", "QC", "u1")).not.toBe(khoaLegacy("r1", "SALE", "u1")); // cùng người, khác tầng
    expect(khoaLegacy("r1", "QC", "u1")).not.toBe(khoaLegacy("r2", "QC", "u1")); // khác khoản hoàn
  });
  it("khoá người khứ hồi", () => {
    expect(tachKhoaNguoi(SALE)).toEqual({ roleCode: "SALE", kind: "USER", beneficiaryId: "u-sale" });
    expect(() => tachKhoaNguoi("rác")).toThrow();
  });
  it("inputHash tất định: thứ tự khoá đối tượng và Map/Set không đổi dấu vân tay; Date theo ISO", () => {
    const a = bamDauVao({ b: 1, a: { y: [1, 2], x: new Date("2026-10-01T00:00:00.000Z") }, m: new Map([["k2", 2], ["k1", 1]]) });
    const b = bamDauVao({ m: new Map([["k1", 1], ["k2", 2]]), a: { x: new Date("2026-10-01T00:00:00.000Z"), y: [1, 2] }, b: 1 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(bamDauVao({ a: 1 })).not.toBe(bamDauVao({ a: 2 }));
    expect(chuoiChuanHoa({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
  it("số không hữu hạn ⇒ ném (băm NaN là che lỗi)", () => {
    expect(() => bamDauVao({ a: NaN })).toThrow();
  });
});

describe("[NHH-COM-06] tinhDaoNguoc — làm tròn NỬA LÊN và chia phần dư (lưới bổ sung sau cấy lỗi 08/10)", () => {
  const goc = (id = "e-sale"): ReadonlyMap<string, string> => new Map([[SALE, id]]);

  // Vì sao cần: ca "33.333 × 4/10 = 13.333,2" ở trên cho CÙNG kết quả dù hàm làm tròn nửa-lên hay cắt xuống — cấy `Math.floor` vào
  // `nhanChiaLamTron` ⇒ 0 ca đỏ (08/10). Hai số dưới đây có phần lẻ ≥ 0,5 nên hai cách làm tròn cho hai kết quả KHÁC nhau.
  it("[NHH-COM-06b] làm tròn NỬA LÊN, không cắt xuống: 12.345 × 5/10 = 6.172,5 ⇒ −6.173; 33.334 × 4/10 = 13.333,6 ⇒ −13.334", () => {
    const a = tinhDaoNguoc({ absAmountAm: 5_000_000, vatRateGoc: 0, nhomO: [{ o: o({ rong: { [SALE]: 12_345 } }), dongGoc: goc() }] });
    expect(a.theoO[0]!.dong[0]!.amount).toBe(-6_173);
    const b = tinhDaoNguoc({ absAmountAm: 4_000_000, vatRateGoc: 0, nhomO: [{ o: o({ rong: { [SALE]: 33_334 } }), dongGoc: goc() }] });
    expect(b.theoO[0]!.dong[0]!.amount).toBe(-13_334);
  });

  // Ca "nhiều ô" cũ chia 5.000.000 theo 6:4 — chia HẾT nên không có phần dư để phân phối; đảo thứ tự ưu tiên phần dư ⇒ 0 ca đỏ (08/10).
  it("[NHH-COM-06c] cơ sở đảo chia cho nhiều ô theo phần dư LỚN nhất (Hamilton): 10đ chia theo cơ sở còn lại 1:2:4 ⇒ 1, 3, 6 (phần dư nhỏ nhất ra 2, 2, 6)", () => {
    const ds = [1, 2, 4].map((cs, i) => ({ o: o({ calcSlotId: `s${i + 1}`, netBase: cs, coSoConLai: cs, rong: { [SALE]: 1 } }), dongGoc: goc(`e${i + 1}`) }));
    const r = tinhDaoNguoc({ absAmountAm: 10, vatRateGoc: 0, nhomO: ds });
    expect(r.theoO.map((x) => x.coSoDao)).toEqual([1, 3, 6]);
    expect(r.theoO.reduce((s, x) => s + x.coSoDao, 0)).toBe(10);
  });
});

describe("[NHH-COM-18g] tachChenhDoiNguon — đổi nguồn chỉ TỰ GHI phần do nguồn gây ra; chuyển tiền giữa hai người cùng vai phải qua người duyệt", () => {
  const ACQ = new Set(["REFERRER_PARENT", "REFERRER_EMPLOYEE", "AFFILIATE"]);
  const SALE_MOI = khoaNguoi("SALE", "USER", "u-sale-moi");
  const c = (key: string, kyVong: number, rong: number) => ({ key, chenh: kyVong - rong, kyVong, rong });

  it("vai isAcquisition (người giới thiệu) luôn tự ghi; vai khác đổi NGƯỜI (cũ −, mới +) ⇒ cả vai chờ duyệt", () => {
    const r = tachChenhDoiNguon([c(REF, 100_000, 0), c(SALE, 0, 400_000), c(SALE_MOI, 400_000, 0)], ACQ);
    expect(r.tuGhi.map((x) => x.key)).toEqual([REF]);
    expect(r.choDuyet.map((x) => x.key).sort()).toEqual([SALE, SALE_MOI].sort());
  });

  it("vai isAcquisition đổi NGƯỜI (người giới thiệu A → B vì nguồn đổi) vẫn TỰ GHI — chính nguồn gây ra, không phải chuyển tiền ngoài ý muốn", () => {
    const refA = khoaNguoi("REFERRER_PARENT", "USER", "u-ph-a");
    const refB = khoaNguoi("REFERRER_PARENT", "USER", "u-ph-b");
    const r = tachChenhDoiNguon([c(refA, 0, 100_000), c(refB, 100_000, 0)], ACQ);
    expect(r.tuGhi.map((x) => x.key).sort()).toEqual([refA, refB].sort());
    expect(r.choDuyet).toEqual([]);
  });

  it("đối chứng dương: vai khác chỉ đổi TỈ LỆ cho cùng một người (chính sách theo nhóm nguồn) ⇒ vẫn tự ghi", () => {
    const r = tachChenhDoiNguon([c(SALE, 500_000, 400_000)], ACQ);
    expect(r.tuGhi).toHaveLength(1);
    expect(r.choDuyet).toHaveLength(0);
  });

  it("chỉ MỘT phía (người mới xuất hiện do rule mới / người cũ mất rule) không phải chuyển tiền ⇒ tự ghi", () => {
    expect(tachChenhDoiNguon([c(QC1, 50_000, 0)], ACQ)).toEqual({ tuGhi: [c(QC1, 50_000, 0)], choDuyet: [] });
    expect(tachChenhDoiNguon([c(QC2, 0, 50_000)], ACQ)).toEqual({ tuGhi: [c(QC2, 0, 50_000)], choDuyet: [] });
  });

  it("vai Marketing hai người đổi chỗ ⇒ chờ duyệt; vai khác trong CÙNG lượt vẫn tách riêng theo vai", () => {
    const r = tachChenhDoiNguon([c(QC1, 0, 50_000), c(QC2, 50_000, 0), c(REF, 10_000, 0)], ACQ);
    expect(r.choDuyet.map((x) => x.key).sort()).toEqual([QC1, QC2].sort());
    expect(r.tuGhi.map((x) => x.key)).toEqual([REF]);
  });

  it("master không khai vai isAcquisition nào ⇒ KHÔNG tự ghi mù: vai người giới thiệu cũng theo luật chung (đổi người ⇒ chờ duyệt)", () => {
    const r = tachChenhDoiNguon([c(REF, 100_000, 0)], new Set());
    expect(r.tuGhi).toHaveLength(1); // chỉ một phía ⇒ không phải chuyển tiền
    const r2 = tachChenhDoiNguon([c(khoaNguoi("REFERRER_PARENT", "USER", "a"), 0, 5), c(khoaNguoi("REFERRER_PARENT", "USER", "b"), 5, 0)], new Set());
    expect(r2.choDuyet).toHaveLength(2);
  });
});
