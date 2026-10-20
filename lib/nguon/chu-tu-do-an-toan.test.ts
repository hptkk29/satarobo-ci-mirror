// @vitest-environment node
/**
 * [TDA-*] Chữ TỰ DO của tab Nguồn (`signals.nhanGoc` · `otherSourceNote`) — cổng PII phía SERVER.
 *
 * Sự cố (review vòng 7, 11/10/2026): ô «Nguồn» của Excel là chữ tự do. 'Chị Lan 0905123456 giới thiệu' được lưu NGUYÊN VĂN vào `signals.nhanGoc` (gắn NHAN_NGUON_LA) và hàng
 * chờ / khối Nguồn trên lead trả nó cho người KHÔNG có `leads:view-pii` (GIAM_DOC có `sources:view`; HO_ACCOUNTANT), trong khi tên lead đã được che. Cùng lớp lỗi với
 * `signals.maNvSai.raw` (đã vá vòng 6 bằng `docMaNvSai(luu, canViewPii)`); `otherSourceNote` (giải trình) cùng họ.
 *
 *  [TDA-01]  CÓ quyền ⇒ nguyên văn (trim) — kể cả SĐT; đối chứng dương của mọi ca «không quyền»
 *  [TDA-02]  KHÔNG quyền ⇒ nhãn KHỚP CHÍNH XÁC nhãn chuẩn (28 dòng bảng 06/10, bỏ hoa/thường + khoảng trắng) hiện nguyên; mọi chữ khác ⇒ «đã ẩn (N ký tự)»
 *  [TDA-03]  KHÔNG quyền ⇒ 12 dạng SĐT/email/tên KHÔNG để lại chuỗi ≥ 6 chữ số, không '@', không tên
 *  [TDA-04]  giải trình: không quyền ⇒ ẩn hẳn (không có bảng nhãn chuẩn cho nó)
 *  [TDA-05]  hình lạ (không phải chuỗi / rỗng) ⇒ null, cả hai nhánh quyền
 *  [TDA-06]  đối chứng: bảng nhãn chuẩn KHÔNG chứa dãy ≥ 6 chữ số hay '@' (cho qua nguyên văn thì không thể lộ)
 *  [TDA-07]  `canViewPii` BẮT BUỘC: quên truyền là lỗi biên dịch (luật 7), không phải lặng lẽ lộ
 *  [TDA-08]  `Lead.source` (đường vào) cũng là chữ tự do khi đường Excel ghi nguyên văn ô «Nguồn» vào đó — probe `[EMNV-D19]` tìm ra: cùng luật với nhãn gốc
 *  [TDA-W1] [TDA-W2] [TDA-W3] lưới dây nối: hàng chờ · khối Nguồn trên lead · thống kê chi tiết nguồn đưa nhãn gốc / giải trình / đường vào qua hàm này, không đọc thẳng
 *            `signals.nhanGoc` / `otherSourceNote` / `Lead.source` ra khỏi tầng server
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BANG_ANH_XA_0610 } from "./anh-xa-nhan-cu";
import { docDuongVao, docGiaiTrinh, docNhanGoc, VET_AN } from "./chu-tu-do-an-toan";

/** Chuỗi KHÔNG ĐƯỢC còn trong kết quả khi không có quyền: dãy ≥ 6 chữ số (kể cả cách nhau bằng . - khoảng trắng, +84), '@'. */
function conSdtHoacMail(s: string | null): boolean {
  if (s === null) return false;
  if (s.includes("@")) return true;
  return /(?:\d[\s.-]?){6,}/.test(s);
}

const MAU_NGUY_HIEM = [
  "Chị Lan 0905123456 giới thiệu",
  "0905123456",
  "0905.123.456",
  "0905-123-456",
  "0905 123 456",
  "+84 905 123 456",
  "84905123456",
  "SR0905123456",
  "lan.nguyen@gmail.com",
  "a@b.vn",
  "Nguyễn Thị Lan",
  "Cô Hoa (mẹ bé Bin) 0912345678",
];

describe("[TDA] chữ tự do của tab Nguồn — lọc ở SERVER theo leads:view-pii", () => {
  it("[TDA-01] CÓ quyền ⇒ nguyên văn (chỉ trim), kể cả SĐT — đối chứng dương", () => {
    for (const m of MAU_NGUY_HIEM) {
      expect(docNhanGoc(`  ${m}  `, true), m).toBe(m);
      expect(docGiaiTrinh(`  ${m}  `, true), m).toBe(m);
    }
    // và phép đo `conSdtHoacMail` BẮT được các mẫu này (không thì «không thấy» chỉ nghĩa là bộ đo hỏng)
    expect(MAU_NGUY_HIEM.filter((m) => !conSdtHoacMail(m))).toEqual(["Nguyễn Thị Lan"]); // tên thuần chữ: bộ đo số/email không bắt — cổng ẩn-trừ-nhãn-chuẩn lo phần này
  });

  it("[TDA-02] KHÔNG quyền: nhãn KHỚP CHÍNH XÁC nhãn chuẩn hiện nguyên; còn lại «đã ẩn (N ký tự)»", () => {
    expect(docNhanGoc("Ads", false)).toBe("Ads");
    expect(docNhanGoc("  nguồn từ  phụ huynh giới thiệu ", false)).toBe("nguồn từ  phụ huynh giới thiệu"); // trim đầu/cuối, giữ nguyên chữ người gõ
    expect(docNhanGoc("ADS", false)).toBe("ADS"); // hoa/thường không phân biệt
    // gần-đúng KHÔNG đủ: thêm chữ vào nhãn chuẩn là chữ tự do
    expect(docNhanGoc("Ads Chị Lan 0905123456", false)).toBe(VET_AN("Ads Chị Lan 0905123456".length));
    expect(docNhanGoc("Facebook", false)).toBe("đã ẩn (8 ký tự)");
    expect(docNhanGoc("Chị Lan 0905123456 giới thiệu", false)).toBe(`đã ẩn (${"Chị Lan 0905123456 giới thiệu".length} ký tự)`);
  });

  it("[TDA-03] KHÔNG quyền: không dạng nào để lại SĐT/email — kết quả tuần tự hoá không chứa chuỗi số ≥ 6, không '@'", () => {
    for (const m of MAU_NGUY_HIEM) {
      const a = docNhanGoc(m, false);
      const b = docGiaiTrinh(m, false);
      expect(conSdtHoacMail(a), `nhanGoc ${m} → ${a}`).toBe(false);
      expect(conSdtHoacMail(b), `giaiTrinh ${m} → ${b}`).toBe(false);
      expect(JSON.stringify({ a, b })).not.toMatch(/\d{6}/);
    }
    // tên người không có chữ số cũng bị ẩn (không có cách phát hiện «đây là tên» ⇒ ẩn mọi thứ ngoài nhãn chuẩn)
    expect(docNhanGoc("Nguyễn Thị Lan", false)).toBe(VET_AN("Nguyễn Thị Lan".length));
    expect(docGiaiTrinh("Nguyễn Thị Lan", false)).toBe(VET_AN("Nguyễn Thị Lan".length));
  });

  it("[TDA-04] giải trình: không quyền ⇒ ẩn hẳn, kể cả chữ trùng một nhãn chuẩn (giải trình KHÔNG có bảng chuẩn)", () => {
    expect(docGiaiTrinh("Ads", false)).toBe(VET_AN(3));
    expect(docGiaiTrinh("Phụ huynh giới thiệu qua Zalo, không có mã", false)).toBe(VET_AN("Phụ huynh giới thiệu qua Zalo, không có mã".length));
  });

  it("[TDA-05] hình lạ ⇒ null ở cả hai nhánh quyền (dữ liệu JSON tuỳ ý không được làm hỏng màn)", () => {
    for (const luu of [null, undefined, 0, 12, true, {}, [], ["Ads"], "", "   ", "\n\t"]) {
      for (const q of [true, false]) {
        expect(docNhanGoc(luu, q), `${JSON.stringify(luu)}/${q}`).toBeNull();
        expect(docGiaiTrinh(luu, q), `${JSON.stringify(luu)}/${q}`).toBeNull();
      }
    }
  });

  it("[TDA-06] đối chứng: bảng nhãn chuẩn (nguồn của đường «cho qua nguyên văn») không chứa dãy ≥ 6 chữ số hay '@'", () => {
    expect(BANG_ANH_XA_0610.length).toBe(28);
    for (const r of BANG_ANH_XA_0610) {
      expect(conSdtHoacMail(r.nhan), r.nhan).toBe(false);
      expect(docNhanGoc(r.nhan, false), r.nhan).toBe(r.nhan); // và đường cho qua THẬT SỰ cho qua (không ẩn nhầm)
    }
  });

  it("[TDA-07] `canViewPii` BẮT BUỘC — thiếu là lỗi biên dịch, không phải lặng lẽ lộ", () => {
    // @ts-expect-error tham số thứ hai không có mặc định (luật 7)
    const a = docNhanGoc("Chị Lan 0905123456 giới thiệu");
    // @ts-expect-error tham số thứ hai không có mặc định (luật 7)
    const b = docGiaiTrinh("Chị Lan 0905123456 giới thiệu");
    // Chạy thật mà quên cờ (JS/any) ⇒ phải rơi về AN TOÀN (coi như không quyền), không phải lộ.
    expect(a).toBe(VET_AN("Chị Lan 0905123456 giới thiệu".length));
    expect(b).toBe(VET_AN("Chị Lan 0905123456 giới thiệu".length));
  });
});

/** Mã đã bỏ chú thích — lưới soi MÃ, không soi lời kể về mã (luật 11). */
function docMa(p: string): string {
  return readFileSync(resolve(process.cwd(), p), "utf8")
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

describe("[TDA-08] đường vào (Lead.source) cùng luật", () => {
  it("không quyền: nhãn chuẩn hiện, chữ người nhập ẩn; có quyền: nguyên văn; rỗng ⇒ null", () => {
    expect(docDuongVao("sale-form", false)).toBe("sale-form"); // một trong 28 nhãn đã chốt
    expect(docDuongVao("Chị Lan 0905123456 giới thiệu", false)).toBe(VET_AN("Chị Lan 0905123456 giới thiệu".length));
    expect(docDuongVao("Chị Lan 0905123456 giới thiệu", true)).toBe("Chị Lan 0905123456 giới thiệu");
    expect(docDuongVao("import-excel", false), "giá trị máy ngoài bảng chuẩn: an toàn trước, tiện sau").toBe(VET_AN("import-excel".length));
    expect(docDuongVao("", false)).toBeNull();
    expect(docDuongVao(null, true)).toBeNull();
  });
});

describe("[TDA-W] dây nối: chữ tự do ra khỏi tầng server CHỈ qua docNhanGoc/docGiaiTrinh", () => {
  it("[TDA-W1] hàng chờ: nhanGoc đi qua docNhanGoc(…, p.canViewPii); không còn đường thô", () => {
    const ma = docMa("lib/nguon/doc-hang-cho.ts");
    expect(dem(ma, /\bnhanGoc: docNhanGoc\(nhanGocTu\(a\.signals\), p\.canViewPii\)/g)).toBe(1);
    expect(dem(ma, /\bnhanGoc: nhanGocTu\(/g)).toBe(0); // không ai gán thẳng kết quả thô của nhanGocTu vào trường trả ra
    expect(dem(ma, /\bduongVao: docDuongVao\(r\.source, p\.canViewPii\)/g)).toBe(1);
    expect(dem(ma, /\bduongVao: r\.source\b/g)).toBe(0);
  });

  it("[TDA-W2] khối Nguồn trên lead: giaiTrinh qua docGiaiTrinh, nhanGoc qua docNhanGoc, cùng cờ p.canViewPii; không còn đường thô", () => {
    const ma = docMa("lib/nguon/doc-gan-nguon.ts");
    expect(dem(ma, /\bgiaiTrinh: docGiaiTrinh\(a\.otherSourceNote, p\.canViewPii\)/g)).toBe(1);
    expect(dem(ma, /\bnhanGoc: docNhanGoc\(s\.nhanGoc, p\.canViewPii\)/g)).toBe(1);
    expect(dem(ma, /\bgiaiTrinh: chuoi\(/g)).toBe(0);
    expect(dem(ma, /\bnhanGoc: chuoi\(/g)).toBe(0);
    expect(dem(ma, /\bduongVao: docDuongVao\(l\.source, p\.canViewPii\)/g)).toBe(1);
    expect(dem(ma, /\bduongVao: l\.source\b/g)).toBe(0);
  });

  it("[TDA-W3] thống kê chi tiết một nguồn: «đường vào» của lead đi qua docDuongVao với cờ canViewPii BẮT BUỘC; không còn đường thô", () => {
    const ma = docMa("lib/nguon/doc-danh-muc.ts");
    expect(dem(ma, /\bduongVao: docDuongVao\(r\.source, canViewPii\)/g)).toBe(1);
    expect(dem(ma, /\bduongVao: r\.source\b/g)).toBe(0);
    expect(dem(ma, /\bcanViewPii: boolean,\s*\):\s*Promise<ChiTietNguon \| null>/g), "canViewPii là tham số BẮT BUỘC của docChiTietNguon (không `?`, không mặc định)").toBe(1);
    const trang = docMa("lib/nguon/doc-trang-chi-tiet.ts");
    expect(dem(trang, /docChiTietNguon\(actor, code, p\.now, p\.canViewPii\)/g)).toBe(1);
    expect(dem(docMa("app/(admin)/admin/nguon-hoa-hong/nguon/[maNguon]/page.tsx"), /\bcanViewPii\b/g)).toBeGreaterThanOrEqual(2); // khai (canViewLeadPii) + truyền xuống
  });
});
