// @vitest-environment node
/**
 * [TVB-*] Tách văn bản pháp lý thành mục. Lời hứa lớn nhất: giao diện mới KHÔNG đổi một byte văn bản
 * pháp lý — nên ca [TVB-01] ghép lại 11 file thật và so từng byte.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ghepVanBan, phanDauDeHienThi, tachVanBan } from "./tach-van-ban";
import { LEGAL_PAGES, LEGAL_PAGES_PHU } from "@/lib/legal-pages";

const THU_MUC = resolve(process.cwd(), "content/legal");
const FILE_MD = readdirSync(THU_MUC).filter((f) => f.endsWith(".md"));

describe("[TVB] tách văn bản pháp lý", () => {
  it("[TVB-01] ghép lại từng file .md thật bằng ĐÚNG từng byte (không mất/đổi chữ nào)", () => {
    expect(FILE_MD.length).toBeGreaterThanOrEqual(11);
    for (const f of FILE_MD) {
      const goc = readFileSync(resolve(THU_MUC, f), "utf8");
      expect(ghepVanBan(tachVanBan(goc)), f).toBe(goc);
    }
  });

  it("[TVB-02] mọi trang pháp lý công khai có file .md tương ứng, mỗi file có ngày cập nhật và ≥ 1 mục", () => {
    const slug = [...LEGAL_PAGES, ...LEGAL_PAGES_PHU]
      .map((p) => p.slug)
      .filter((s) => FILE_MD.includes(`${s}.md`));
    expect(slug.length).toBeGreaterThanOrEqual(11);
    for (const s of slug) {
      const v = tachVanBan(readFileSync(resolve(THU_MUC, `${s}.md`), "utf8"));
      expect(v.ngayCapNhat, s).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      expect(v.muc.length, s).toBeGreaterThan(0);
      expect(v.tieuDeH1, s).toBeTruthy();
    }
  });

  it("[TVB-03] số mục liên tiếp từ 1, neo trùng số, tiêu đề đã bỏ tiền tố 'N.'", () => {
    const v = tachVanBan(readFileSync(resolve(THU_MUC, "dieu-khoan-su-dung.md"), "utf8"));
    expect(v.muc.map((m) => m.so)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(v.muc[0]).toMatchObject({ neo: "muc-1", tieu: "Chấp nhận Điều khoản" });
    expect(v.muc.every((m) => !/^\d+\./.test(m.tieu))).toBe(true);
  });

  it("[TVB-04] đầu mục '###' không bị coi là mục; dòng '##' trong khối mã cũng không", () => {
    const md = "# T\n\n## 1. A\n\ntext\n\n### 1.1 con\n\n```\n## không phải mục\n```\n\n## 2. B\nx";
    const v = tachVanBan(md);
    expect(v.muc.map((m) => m.tieu)).toEqual(["A", "B"]);
    expect(ghepVanBan(v)).toBe(md);
  });

  it("[TVB-05] giữ nguyên CRLF, tiêu đề không đánh số có neo theo vị trí", () => {
    const md = "# T\r\n\r\n## Lời mở đầu\r\nabc\r\n## 2. Hai\r\ndef";
    const v = tachVanBan(md);
    expect(ghepVanBan(v)).toBe(md);
    expect(v.muc[0]).toMatchObject({ so: null, neo: "muc-1", tieu: "Lời mở đầu" });
    expect(v.muc[1]).toMatchObject({ so: 2, neo: "muc-2" });
  });

  it("[TVB-06] file không có mục nào: toàn bộ nằm ở phanDau; không có ngày ⇒ null", () => {
    const v = tachVanBan("# Chỉ có tiêu đề\n\nmột đoạn");
    expect(v.muc).toEqual([]);
    expect(v.ngayCapNhat).toBeNull();
    expect(ghepVanBan(v)).toBe("# Chỉ có tiêu đề\n\nmột đoạn");
  });

  it("[TVB-07] phần dẫn nhập để hiển thị: bỏ H1 + dòng ngày, GIỮ căn cứ pháp lý", () => {
    const v = tachVanBan(readFileSync(resolve(THU_MUC, "chinh-sach-bao-mat.md"), "utf8"));
    const hien = phanDauDeHienThi(v);
    expect(hien).not.toMatch(/^# /m);
    expect(hien).not.toMatch(/Cập nhật lần cuối/);
    expect(hien).toMatch(/Căn cứ pháp lý/);
  });
});
