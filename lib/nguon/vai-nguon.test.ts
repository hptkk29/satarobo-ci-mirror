/**
 * Ca [NHH-H18-*] — H18: lõi quy nguồn KHÔNG dùng số 5/6/7/8 làm khoá logic; vai suy nguồn là mã NGỮ NGHĨA
 * SALE / MANAGER / TEACHER / OTHER_EMPLOYEE. Số của văn bản 06/10 chỉ nằm ở dữ liệu (`documentNo`) và ở
 * bảng nhãn cũ (`anh-xa-nhan-cu.ts`, cột `stt`) — hai nơi là ADAPTER của văn bản đó.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as DanhMuc from "./danh-muc-goc";
import { NHOM_NHAN_SU_GOC, VAI_SANG_NGUON_MAC_DINH, suyVaiNguon } from "./danh-muc-goc";

describe("[NHH-H18-01] suyVaiNguon trả mã NGỮ NGHĨA, không trả số", () => {
  const b = VAI_SANG_NGUON_MAC_DINH;
  it("bốn mã vai", () => {
    expect(suyVaiNguon(["CENTER_SALES_CSM"], b)).toBe("SALE");
    expect(suyVaiNguon(["HO_SALE"], b)).toBe("SALE");
    expect(suyVaiNguon(["CENTER_MANAGER"], b)).toBe("MANAGER");
    expect(suyVaiNguon(["GIAM_DOC"], b)).toBe("MANAGER");
    expect(suyVaiNguon(["TEACHER"], b)).toBe("TEACHER");
    expect(suyVaiNguon(["HO_ACCOUNTANT"], b)).toBe("OTHER_EMPLOYEE");
    expect(suyVaiNguon([], b)).toBe("OTHER_EMPLOYEE");
  });
  it("[DYN-V1-LUOI] vai KHÔNG còn chọn nhóm: danh-muc-goc không xuất bảng vai→nhóm nào (NHOM_THEO_VAI · suyNguonTuVai đã gỡ); nhóm gốc của di trú là MỘT hằng", () => {
    expect(Object.keys(DanhMuc)).not.toContain("NHOM_THEO_VAI");
    expect(Object.keys(DanhMuc)).not.toContain("suyNguonTuVai");
    expect(NHOM_NHAN_SU_GOC).toBe("EMPLOYEE_REFERRAL");
  });
  it("bảng mặc định khai theo `vai`, không còn khai trực tiếp mã nhóm", () => {
    for (const bac of VAI_SANG_NGUON_MAC_DINH) {
      expect(Object.keys(bac).sort()).toEqual(["roleCodes", "vai"]);
    }
  });
});

describe("[NHH-H18-02] lưới — lib/nguon KHÔNG đọc `documentNo` ngoài danh mục và không so số 5..8 làm khoá", () => {
  const GOC = process.cwd();
  const tep = readdirSync(resolve(GOC, "lib/nguon")).filter((t) => t.endsWith(".ts") && !/\.(test|spec)\.ts$/.test(t));
  const boChuThich = (s: string) =>
    s
      .split(/\r?\n/)
      .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "");

  it("lưới quét ĐƯỢC tệp (không quét rỗng)", () => {
    expect(tep.length).toBeGreaterThan(10);
    expect(tep).toContain("danh-muc-goc.ts");
  });

  it("`.documentNo` chỉ được ĐỌC làm logic ở danh mục (khai dữ liệu); nơi khác = 0", () => {
    // `doc-danh-muc.ts` (PR6) chỉ CHIẾU cột này ra giao diện (`documentNo: g.documentNo` — số thứ tự để HIỂN THỊ ở
    // bảng danh mục), không so sánh, không làm khoá. Ngoại lệ có tên, không phải mở cửa: tệp khác đọc = đỏ.
    const NGOAI_LE_HIEN_THI = ["danh-muc-goc.ts", "doc-danh-muc.ts"];
    const sai = tep
      .filter((t) => !NGOAI_LE_HIEN_THI.includes(t))
      .filter((t) => /\.documentNo\b/.test(boChuThich(readFileSync(resolve(GOC, "lib/nguon", t), "utf8"))));
    expect(sai).toEqual([]);
  });

  it("không có phép so/khoá nào kiểu `=== 5|6|7|8` hay `case 5:` trong lõi quy nguồn", () => {
    const co = ["quy-nguon.ts", "doi-nguon.ts", "kiem-nguon.ts", "gian-lan.ts", "noi-day.ts"].filter((t) => tep.includes(t));
    // Vế dương: lõi ĐÃ có mặt (lưới không quét rỗng). Thiếu tệp = chưa hiện thực = đỏ.
    expect(co).toEqual(["quy-nguon.ts", "doi-nguon.ts", "kiem-nguon.ts", "gian-lan.ts", "noi-day.ts"]);
    const loi = co.filter((t) => /(?:===?|!==?|case)\s*[5-8]\b/.test(boChuThich(readFileSync(resolve(GOC, "lib/nguon", t), "utf8"))));
    expect(loi).toEqual([]);
  });
});
