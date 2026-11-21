// @vitest-environment node
// [NHH-FE-05*] Ô PHẦN TRĂM: người gõ "3" nghĩa là 3%, DB lưu 0.03. Lỗi ×100 (lưu 3 = 300%) là lỗi tiền thật,
// và nó không bao giờ ném — nên ghim bằng ca, không bằng mắt.
import { describe, expect, it } from "vitest";
import { tiLeSangMicro } from "./tien";
import { dinhDangPhanTram, docPhanTram, loiGiaiThichTiLe } from "./phan-tram";

const ok = (raw: string) => {
  const r = docPhanTram(raw);
  if (r.kieu !== "ok") throw new Error(`"${raw}" lẽ ra hợp lệ nhưng ra ${JSON.stringify(r)}`);
  return r;
};

describe("[NHH-FE-05] docPhanTram — gõ phần trăm, lưu tỉ lệ", () => {
  it("[NHH-FE-05] gõ 3 ⇒ 3% ⇒ lưu 0.03 (KHÔNG phải 3)", () => {
    const r = ok("3");
    expect(r.tiLe).toBe("0.03");
    expect(r.tiLe).not.toBe("3");
  });

  it("[NHH-FE-05a] nhận dấu phẩy kiểu Việt và dấu chấm; bỏ khoảng trắng và hậu tố %", () => {
    expect(ok("3,5").tiLe).toBe("0.035");
    expect(ok("3.5").tiLe).toBe("0.035");
    expect(ok("  4 % ").tiLe).toBe("0.04");
    expect(ok("9").tiLe).toBe("0.09");
  });

  it("[NHH-FE-05b] không trôi số thực: 7 ⇒ 0.07, 4,35 ⇒ 0.0435, 1,1 ⇒ 0.011", () => {
    expect(ok("7").tiLe).toBe("0.07");
    expect(ok("4,35").tiLe).toBe("0.0435");
    expect(ok("1,1").tiLe).toBe("0.011");
    expect(ok("0,29").tiLe).toBe("0.0029");
  });

  it("[NHH-FE-05c] biên: 100 ⇒ 1; 0,0001 ⇒ 0.000001 (tối thiểu Decimal(9,6)); vượt 100, 0 và âm bị từ chối", () => {
    expect(ok("100").tiLe).toBe("1");
    expect(ok("0,0001").tiLe).toBe("0.000001");
    for (const raw of ["100,01", "101", "0", "0,0", "-3", "+3"]) {
      expect(docPhanTram(raw).kieu, raw).toBe("loi");
    }
  });

  it("[NHH-FE-05d] quá 4 chữ số thập phân của PHẦN TRĂM (6 của tỉ lệ) ⇒ từ chối, KHÔNG làm tròn im lặng", () => {
    const r = docPhanTram("3,12345");
    expect(r.kieu).toBe("loi");
    if (r.kieu === "loi") expect(r.loi).toMatch(/4 chữ số thập phân/);
  });

  it("[NHH-FE-05e] rác ⇒ lỗi; rỗng ⇒ 'trong' (người gọi quyết định có bắt buộc không)", () => {
    for (const raw of ["abc", "1e2", "3,,5", "3.5.1", "٣", "3 4"]) {
      expect(docPhanTram(raw).kieu, raw).toBe("loi");
    }
    expect(docPhanTram("").kieu).toBe("trong");
    expect(docPhanTram("   ").kieu).toBe("trong");
  });

  it("[NHH-FE-05f] kết quả luôn qua được tiLeSangMicro (cổng của service) và micro = phần trăm × 10.000", () => {
    for (const raw of ["3", "3,5", "0,0001", "100", "4,35", "12,3456"]) {
      const r = ok(raw);
      const micro = tiLeSangMicro(r.tiLe);
      const kyVong = BigInt(Math.round(Number(raw.replace(",", ".")) * 10000));
      expect(micro, raw).toBe(kyVong);
    }
  });
});

describe("[NHH-FE-05g] dinhDangPhanTram — tỉ lệ lưu ⇒ chữ người đọc", () => {
  it("0.03 ⇒ '3' · 0.035 ⇒ '3,5' · 0.0435 ⇒ '4,35' · 1 ⇒ '100' · 0.000001 ⇒ '0,0001'", () => {
    expect(dinhDangPhanTram("0.03")).toBe("3");
    expect(dinhDangPhanTram("0.035")).toBe("3,5");
    expect(dinhDangPhanTram("0.0435")).toBe("4,35");
    expect(dinhDangPhanTram("1")).toBe("100");
    expect(dinhDangPhanTram("0.000001")).toBe("0,0001");
    expect(dinhDangPhanTram("0.040000")).toBe("4");
  });

  it("vòng tròn: định dạng rồi đọc lại ra đúng tỉ lệ ban đầu", () => {
    for (const tiLe of ["0.04", "0.0125", "0.09", "0.000123", "0.5"]) {
      expect(ok(dinhDangPhanTram(tiLe)).tiLe).toBe(tiLe);
    }
  });

  it("nhận số (Decimal.toString) và cắt số 0 thừa", () => {
    expect(dinhDangPhanTram(0.04)).toBe("4");
    expect(dinhDangPhanTram("0.010000")).toBe("1");
  });
});

describe("[NHH-FE-05h] loiGiaiThichTiLe — dòng in lại dưới ô", () => {
  it("'= 0,03 trên mỗi đồng thực thu' khi gõ 3", () => {
    expect(loiGiaiThichTiLe("0.03")).toBe("= 0,03 trên mỗi đồng thực thu");
    expect(loiGiaiThichTiLe("0.0435")).toBe("= 0,0435 trên mỗi đồng thực thu");
    expect(loiGiaiThichTiLe("1")).toBe("= 1 trên mỗi đồng thực thu");
  });
});
