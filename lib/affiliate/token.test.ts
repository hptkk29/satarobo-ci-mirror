/**
 * [AFF-TOK-*] — token công khai của link / QR / mã giới thiệu. Không DB.
 */
import { describe, expect, it } from "vitest";
import { BANG_CHU_CROCKFORD, DO_DAI_TOKEN, chuanHoaToken, dinhDangTokenDeDoc, sinhToken, tokenTuByte } from "./token";

describe("[AFF-TOK-01] dựng token", () => {
  it("bảng chữ: 32 ký tự duy nhất, không I L O U (không nhầm với 1/0)", () => {
    expect(BANG_CHU_CROCKFORD).toHaveLength(32);
    expect(new Set(BANG_CHU_CROCKFORD).size).toBe(32);
    for (const c of "ILOU") expect(BANG_CHU_CROCKFORD).not.toContain(c);
  });

  it("tokenTuByte: xác định theo byte (lấy 5 bit thấp), đúng độ dài", () => {
    // [0,1,2,31,32,33,255,128,7,8] & 31 = [0,1,2,31,0,1,31,0,7,8] → "012Z01Z078"
    const t = tokenTuByte(Uint8Array.from([0, 1, 2, 31, 32, 33, 255, 128, 7, 8]));
    expect(t).toHaveLength(DO_DAI_TOKEN);
    expect(t).toBe("012Z01Z078");
  });

  it("thiếu byte ⇒ ném lỗi (không dựng token ngắn)", () => {
    expect(() => tokenTuByte(new Uint8Array(DO_DAI_TOKEN - 1))).toThrow();
  });

  it("sinhToken: đúng độ dài + chỉ ký tự trong bảng; 2000 lần không trùng (entropy 50 bit)", () => {
    const thay = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      const t = sinhToken();
      expect(t).toHaveLength(DO_DAI_TOKEN);
      for (const c of t) expect(BANG_CHU_CROCKFORD).toContain(c);
      thay.add(t);
    }
    expect(thay.size).toBe(2000);
  });
});

describe("[AFF-TOK-02] chuanHoaToken — cổng chặn token hỏng/giả mạo", () => {
  const T = "K8F29XQ47M";

  it("token đúng đi qua nguyên vẹn", () => {
    expect(chuanHoaToken(T)).toBe(T);
  });

  it("chữ thường, khoảng trắng, gạch ngang (đọc qua điện thoại) ⇒ chuẩn hoá về cùng token", () => {
    expect(chuanHoaToken("k8f2-9xq4-7m")).toBe(T);
    expect(chuanHoaToken(" K8F2 9XQ4 7M ")).toBe(T);
  });

  it("quy ước Crockford: O→0, I/L→1 (người đọc nhầm vẫn ra token đúng)", () => {
    const t = "K0F29XQ417"; // có cả 0 và 1
    expect(chuanHoaToken("KOF29XQ4I7")).toBe(t);
    expect(chuanHoaToken("KOF29XQ4l7")).toBe(t);
    expect(chuanHoaToken("kof29xq4i7")).toBe(t);
  });

  it("sai độ dài (ngắn/dài hơn), ký tự ngoài bảng, rỗng, kiểu lạ ⇒ null — không cắt/không sửa tiếp", () => {
    for (const x of ["", "K8F29XQ47", "K8F29XQ47MZ", "K8F29XQ47U", "K8F29XQ4!M", "K8F29XQ47€", "<script>", "'; DROP", "%4B8F29XQ47M"]) {
      expect(chuanHoaToken(x), JSON.stringify(x)).toBeNull();
    }
    for (const x of [null, undefined, 123, {}, [], true]) expect(chuanHoaToken(x)).toBeNull();
  });

  it("chuỗi quá dài bị bỏ NGAY (không chuẩn hoá chuỗi rác/DoS) dù chứa token đúng", () => {
    expect(chuanHoaToken(`${T}${" ".repeat(64)}`)).toBeNull();
    expect(chuanHoaToken("A".repeat(10_000))).toBeNull();
  });

  it("null byte / xuống dòng bên trong ⇒ null (khoảng trắng chỉ được ở HAI ĐẦU/giữa, không chen ký tự điều khiển)", () => {
    expect(chuanHoaToken("K8F29\u0000XQ47M")).toBeNull();
  });
});

describe("[AFF-TOK-03] định dạng để đọc", () => {
  it("nhóm 4-4-2 và chuẩn hoá ngược lại ra đúng token", () => {
    const t = "K8F29XQ47M";
    expect(dinhDangTokenDeDoc(t)).toBe("K8F2-9XQ4-7M");
    expect(chuanHoaToken(dinhDangTokenDeDoc(t))).toBe(t);
  });
});
