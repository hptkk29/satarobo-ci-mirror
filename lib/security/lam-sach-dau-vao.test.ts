import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { chuoiCoKyTuCam, laLoiDoDauVao, lamSachChuoi, lamSachDeep } from "./lam-sach-dau-vao";

const NUL = String.fromCharCode(0);

describe("lamSachChuoi — thứ Postgres/Prisma từ chối (PHONE_ENUMERATION, reviewer 20/10/2026)", () => {
  it("[LSD-01] bỏ NUL; thay MỌI lone surrogate (cao lẫn thấp, đầu/giữa/cuối chuỗi) bằng U+FFFD", () => {
    expect(lamSachChuoi(`a${NUL}b${NUL}`)).toBe("ab");
    expect(lamSachChuoi("a\ud800b")).toBe("a�b");
    expect(lamSachChuoi("a\udc00b")).toBe("a�b");
    expect(lamSachChuoi("\ud800")).toBe("�");
    expect(lamSachChuoi("x\udc00")).toBe("x�");
    expect(lamSachChuoi("\ud800\ud800")).toBe("��");
    expect(lamSachChuoi("\udc00\ud800")).toBe("��"); // thấp rồi cao = KHÔNG phải một cặp
  });

  it("[LSD-02] cặp thay thế HỢP LỆ (emoji, ký tự ngoài BMP) và chữ có dấu KHÔNG bị đụng; chuỗi sạch trả về chính nó", () => {
    for (const s of ["😀", "a😀b", "𠀀", "Nguyễn Thị Ánh", "tab\tnewline\nreturn\r", ""]) expect(lamSachChuoi(s)).toBe(s);
    expect(lamSachChuoi("a😀\ud800b")).toBe("a😀�b"); // cặp hợp lệ giữ, nửa mồ côi thay
  });

  it("[LSD-03] idempotent, và kết quả LUÔN well-formed (JSON.stringify không còn \\ud800 trần — thứ làm Prisma ném «unexpected end of hex escape»)", () => {
    for (const s of [`a${NUL}𐀀\ud800`, "\udc00\udc00\ud800\ud800", "😀😀\ud83d"]) {
      const r = lamSachChuoi(s);
      expect(lamSachChuoi(r)).toBe(r);
      expect(chuoiCoKyTuCam(r)).toBe(false);
      expect(JSON.stringify(r)).not.toMatch(/\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])/i);
    }
  });

  it("[LSD-04] chuoiCoKyTuCam: đối chứng DƯƠNG (có NUL / có nửa cặp ⇒ true) lẫn ÂM (sạch ⇒ false)", () => {
    expect(chuoiCoKyTuCam(`a${NUL}`)).toBe(true);
    expect(chuoiCoKyTuCam("a\ud800")).toBe(true);
    expect(chuoiCoKyTuCam("a\udc00")).toBe(true);
    expect(chuoiCoKyTuCam("a😀")).toBe(false);
    expect(chuoiCoKyTuCam("Nguyễn")).toBe(false);
  });
});

describe("lamSachDeep", () => {
  it("[LSD-05] làm sạch chuỗi ở mọi tầng — giá trị, phần tử mảng VÀ khoá; không đụng số/boolean/null; không sửa đầu vào", () => {
    const vao = { [`k${NUL}`]: "a\ud800", n: 5, b: true, z: null, arr: ["x\udc00", { y: `m${NUL}` }], sau: { a: { b: "c\ud800" } } };
    const copy = JSON.stringify(vao);
    const ra = lamSachDeep(vao) as Record<string, unknown>;
    expect(ra).toEqual({ k: "a�", n: 5, b: true, z: null, arr: ["x�", { y: "m" }], sau: { a: { b: "c�" } } });
    expect(JSON.stringify(vao)).toBe(copy);
  });

  it("[LSD-06] quá sâu ⇒ cắt thành null (không đệ quy vô hạn trên dữ liệu kẻ lạ); chuỗi trần và giá trị nguyên thuỷ đi qua", () => {
    let sau: unknown = "đáy";
    for (let i = 0; i < 50; i += 1) sau = { x: sau };
    let cur = lamSachDeep(sau) as Record<string, unknown> | null;
    let tang = 0;
    while (cur && typeof cur === "object") {
      cur = cur.x as Record<string, unknown> | null;
      tang += 1;
    }
    expect(cur).toBeNull();
    expect(tang).toBeLessThan(12);
    expect(lamSachDeep("a\ud800")).toBe("a�");
    expect(lamSachDeep(7)).toBe(7);
    expect(lamSachDeep(undefined)).toBeUndefined();
  });
});

describe("laLoiDoDauVao — phân biệt lỗi do ĐẦU VÀO với lỗi HẠ TẦNG", () => {
  const known = (code: string) => new Prisma.PrismaClientKnownRequestError("x", { code, clientVersion: "t" });

  it("[LSD-07] khoá ngoại · UNIQUE · quá dài · validation · NUL ở Postgres ⇒ true", () => {
    for (const c of ["P2000", "P2002", "P2003", "P2011"]) expect(laLoiDoDauVao(known(c)), c).toBe(true);
    expect(laLoiDoDauVao(new Prisma.PrismaClientValidationError("bad", { clientVersion: "t" }))).toBe(true);
    expect(laLoiDoDauVao(new Prisma.PrismaClientUnknownRequestError("invalid byte sequence for encoding UTF8: 0x00 (22021)", { clientVersion: "t" }))).toBe(true);
    expect(laLoiDoDauVao(new Prisma.PrismaClientUnknownRequestError("unexpected end of hex escape", { clientVersion: "t" }))).toBe(true);
  });

  it("[LSD-08] mất kết nối · hết pool · giao dịch hết hạn · lỗi thường · không phải object ⇒ false (đó là lỗi của HỆ THỐNG, 500 là đúng và không phụ thuộc đầu vào)", () => {
    for (const c of ["P1001", "P1008", "P2024", "P2028", "P2034"]) expect(laLoiDoDauVao(known(c)), c).toBe(false);
    expect(laLoiDoDauVao(new Prisma.PrismaClientUnknownRequestError("connection reset", { clientVersion: "t" }))).toBe(false);
    expect(laLoiDoDauVao(new Error("ép lỗi để đo"))).toBe(false);
    expect(laLoiDoDauVao(null)).toBe(false);
    expect(laLoiDoDauVao("P2002")).toBe(false);
  });
});
