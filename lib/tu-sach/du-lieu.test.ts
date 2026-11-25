/**
 * [TS-DL-*] Dữ liệu Tủ sách: 20 ebook thật + 237 sách giáo khoa (liên kết NXBGD).
 *   [TS-DL-01] ebook: đúng 20 cuốn, số 1..20 liền mạch, chủ đề hợp lệ, có ảnh bìa trong repo, khoá R2 đúng khuôn
 *   [TS-DT-01] đọc thử 1/4 số trang (làm tròn lên, tối thiểu 1)
 *   [TS-DL-02] SGK: liên kết CHỈ về taphuan.nxbgd.vn (https), id duy nhất, mỗi lớp 1–12 có sách, không có «vở bài tập»
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CHU_DE_EBOOK, EBOOKS, khoaSach, MAU_CHU_DE, soTrangDocThu } from "./ebook";
import { SGK } from "./sgk";

describe("[TS-DL-01] ebook", () => {
  it("20 cuốn, số liền mạch 1..20, tiêu đề/mô tả không rỗng, số trang hợp lý", () => {
    expect(EBOOKS).toHaveLength(20);
    expect(EBOOKS.map((e) => e.so)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    for (const e of EBOOKS) {
      expect(e.tieuDe.length, `ebook ${e.so}`).toBeGreaterThan(5);
      expect(e.moTa.length).toBeGreaterThan(20);
      expect(e.soTrang).toBeGreaterThan(5);
      expect(e.soTrang).toBeLessThanOrEqual(40); // ≤ một «phần» của trình đọc
    }
  });
  it("chủ đề hợp lệ và có màu", () => {
    for (const e of EBOOKS) {
      expect(CHU_DE_EBOOK as readonly string[]).toContain(e.chuDe);
      expect(MAU_CHU_DE[e.chuDe]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
  it("mọi ebook có ảnh bìa trong public/tu-sach/bia", () => {
    for (const e of EBOOKS) expect(existsSync(resolve(process.cwd(), `public/tu-sach/bia/${e.so}.jpg`)), `bìa ${e.so}`).toBe(true);
  });
  it("khoá R2 đúng khuôn (PDF riêng tư ≠ ảnh trang công khai)", () => {
    expect(khoaSach.pdf(12)).toBe("tu-sach/ebook/12/sach.pdf");
    expect(khoaSach.trang(12, 3)).toBe("tu-sach/ebook/12/p3.webp");
    expect(khoaSach.pdf(1)).not.toBe(khoaSach.trang(1, 1));
  });
});

describe("[TS-DL-02] sách giáo khoa", () => {
  it("237 cuốn, id duy nhất, liên kết CHỈ https://taphuan.nxbgd.vn/", () => {
    expect(SGK).toHaveLength(237);
    expect(new Set(SGK.map((b) => b.id)).size).toBe(237);
    for (const b of SGK) {
      const u = new URL(b.url);
      expect(u.protocol, b.id).toBe("https:");
      expect(u.hostname, b.id).toBe("taphuan.nxbgd.vn");
      expect(b.url.endsWith(b.id), `url khớp id ${b.id}`).toBe(true);
    }
  });
  it("lớp 1–12 đều có sách; môn suy ra không rỗng; dữ liệu CHƯA có vở bài tập", () => {
    for (let l = 1; l <= 12; l++) expect(SGK.filter((b) => b.lop === l).length, `lớp ${l}`).toBeGreaterThan(0);
    for (const b of SGK) {
      expect(b.mon.length).toBeGreaterThan(1);
      expect(b.ten.startsWith(b.mon)).toBe(true);
    }
    expect(SGK.filter((b) => /vở bài tập/i.test(b.ten))).toEqual([]);
  });
});

describe("[TS-DT-01] đọc thử 1/4 số trang", () => {
  it("làm tròn LÊN, tối thiểu 1 trang, không vượt số trang; mọi ebook có phần đọc thử và còn phần bị khoá", () => {
    expect(soTrangDocThu(20)).toBe(5);
    expect(soTrangDocThu(21)).toBe(6);
    expect(soTrangDocThu(1)).toBe(1);
    expect(soTrangDocThu(2)).toBe(1);
    expect(soTrangDocThu(3)).toBe(1);
    expect(soTrangDocThu(4)).toBe(1);
    expect(soTrangDocThu(5)).toBe(2);
    for (const e of EBOOKS) {
      const g = soTrangDocThu(e.soTrang);
      expect(g, "ebook " + e.so).toBeGreaterThanOrEqual(1);
      expect(g, "ebook " + e.so).toBeLessThan(e.soTrang);
      expect(g / e.soTrang, "ebook " + e.so).toBeLessThanOrEqual(0.25 + 1 / e.soTrang);
    }
  });
});
