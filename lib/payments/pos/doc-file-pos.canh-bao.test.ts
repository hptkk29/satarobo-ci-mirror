// [POS-CB-*] — `docFilePos` nuốt ĐÚNG cảnh báo "Bad uncompressed size" của thư viện `xlsx`. THUẦN.
//
// File ngân hàng ghi mục zip bằng DATA DESCRIPTOR mà ô kích thước giải nén = 0 ⇒ `xlsx` gọi
// `console.error("Bad uncompressed size: N != 0")` mỗi lần đọc, vẫn đọc đúng. Dev overlay của Next
// đếm dòng đó thành "Issues" ⇒ kế toán tưởng import hỏng. Chỉ nuốt ĐÚNG chuỗi đó, CHỈ trong lúc gọi
// `XLSX.read`, khôi phục console trong `finally`; mọi cảnh báo khác vẫn in.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { docFilePos, nuotCanhBaoKichThuocZip } from "./doc-file-pos";
import { DONG_CS1, THU_MUC_CS1, dungXlsxThat } from "@/tests/fixtures/pos/smartpos-that";

const CANH_BAO = /Bad uncompressed size/;

/**
 * Đo 30/09/2026 trên HAI file thật (`29092026_USER_TXN*.zip`): mỗi mục của xlsx bên trong có data
 * descriptor MANG CHỮ KÝ `50 4B 07 08` và ô "kích thước giải nén" = **0** (vd `csz 315 usz 0`) ⇒
 * `xlsx` in `Bad uncompressed size: 1052 != 0` … 9 dòng mỗi file. Fixture `dungXlsxThat` (JSZip)
 * ghi kích thước ĐÚNG vào descriptor nên KHÔNG tái hiện được cảnh báo — hàm này vá đúng ô đó về 0
 * như ngân hàng làm.
 */
function giongNganHang(b: Uint8Array): Uint8Array {
  const out = b.slice();
  let soMuc = 0;
  for (let i = 0; i + 16 <= out.length; i++) {
    if (out[i] === 0x50 && out[i + 1] === 0x4b && out[i + 2] === 0x07 && out[i + 3] === 0x08) {
      out.fill(0, i + 12, i + 16);
      soMuc++;
    }
  }
  if (soMuc === 0) throw new Error("fixture không có data descriptor mang chữ ký — không vá được");
  return out;
}

async function xlsxNganHang() {
  return giongNganHang(await dungXlsxThat(DONG_CS1));
}

async function zipNganHang() {
  const z = new JSZip();
  z.file(`${THU_MUC_CS1}/29092026_TXN_000.xlsx`, await xlsxNganHang());
  return z.generateAsync({ type: "uint8array", compression: "DEFLATE", streamFiles: true });
}

const coCanhBao = (spy: MockInstance) => spy.mock.calls.some((c) => CANH_BAO.test(String(c[0])));

describe("[POS-CB] cảnh báo 'Bad uncompressed size' của xlsx", () => {
  let err: MockInstance;
  let warn: MockInstance;
  beforeEach(() => {
    err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("[POS-CB-01] ĐỐI CHỨNG DƯƠNG: gọi XLSX.read trần trên file thật ⇒ thư viện CÓ in cảnh báo", async () => {
    XLSX.read(await xlsxNganHang(), { type: "array", sheets: 0 });
    expect(coCanhBao(err), "fixture phải tái hiện được cảnh báo, không thì ca dưới xanh vô nghĩa").toBe(true);
  });

  it("[POS-CB-02] docFilePos (.xlsx và .zip thật) ⇒ KHÔNG in cảnh báo đó, vẫn đọc đủ dòng", async () => {
    const x = await docFilePos(await xlsxNganHang(), "29092026_TXN_000.xlsx");
    const z = await docFilePos(await zipNganHang(), "29092026_USER_TXN.zip");
    expect(x.ok && x.dong.length).toBe(DONG_CS1.length);
    expect(z.ok && z.dong.length).toBe(DONG_CS1.length);
    expect(coCanhBao(err)).toBe(false);
    expect(coCanhBao(warn)).toBe(false);
  });

  it("[POS-CB-03] chỉ nuốt ĐÚNG chuỗi đó — cảnh báo khác vẫn in (cả error lẫn warn)", () => {
    nuotCanhBaoKichThuocZip(() => {
      console.error("Bad uncompressed size: 1234 != 0");
      console.warn("Bad uncompressed size: 99 != 0");
      console.error("Lỗi khác của thư viện", 1);
      console.warn("Cảnh báo khác");
    });
    expect(err.mock.calls).toEqual([["Lỗi khác của thư viện", 1]]);
    expect(warn.mock.calls).toEqual([["Cảnh báo khác"]]);
  });

  it("[POS-CB-06] kích thước lệch THẬT ('N != M', M ≠ 0 — zip hỏng / bị cắt) VẪN in — chỉ nuốt '!= 0'", () => {
    // Mã TRƯỚC bản vá (rà vòng 3): lọc bằng `startsWith("Bad uncompressed size")` ⇒ nuốt cả tín
    // hiệu chẩn đoán thật, trái với chú thích/tài liệu ("nuốt ĐÚNG … != 0").
    nuotCanhBaoKichThuocZip(() => {
      console.error("Bad uncompressed size: 1052 != 5");
      console.error("Bad uncompressed size: 1052 != 0");
      console.warn("Bad uncompressed size: 7 != 70");
      console.error("Bad uncompressed size: 1052 != 0 (thêm đuôi)");
    });
    expect(err.mock.calls).toEqual([["Bad uncompressed size: 1052 != 5"], ["Bad uncompressed size: 1052 != 0 (thêm đuôi)"]]);
    expect(warn.mock.calls).toEqual([["Bad uncompressed size: 7 != 70"]]);
  });

  it("[POS-CB-04] console được KHÔI PHỤC sau khi xong — kể cả khi hàm bên trong ném", () => {
    const e0 = console.error;
    const w0 = console.warn;
    expect(() =>
      nuotCanhBaoKichThuocZip(() => {
        throw new Error("hỏng");
      }),
    ).toThrow("hỏng");
    expect(console.error).toBe(e0);
    expect(console.warn).toBe(w0);
    // Ngoài vùng bọc, chính chuỗi đó lại in bình thường.
    console.error("Bad uncompressed size: 1 != 0");
    expect(coCanhBao(err)).toBe(true);
  });

  it("[POS-CB-05] trả về đúng giá trị của hàm bên trong", () => {
    expect(nuotCanhBaoKichThuocZip(() => 42)).toBe(42);
  });
});
