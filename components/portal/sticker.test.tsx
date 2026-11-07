// @vitest-environment jsdom
/**
 * [STK-*] — bộ sticker robot của hai cổng (04/11/2026).
 *   [STK-01] bảng kích thước KHỚP tệp thật (mỗi tên có đúng một tệp .webp, đúng pixel; không tệp mồ côi)
 *   [STK-02] dung lượng: mỗi ảnh ≤ 60KB, cả bộ ≤ 400KB (trang cổng không nặng thêm)
 *   [STK-03] `Sticker`: ảnh trang trí (alt rỗng + aria-hidden), width/height đúng tỉ lệ ảnh; `NoiDungTrong` giữ nguyên chữ
 *   [STK-04] không còn icon robot vẽ tay `RobotMat` ở bất kỳ nơi nào trong components/portal
 *   [STK-05] đúng sticker ở đúng màn (Hôm nay · Hành trình… · khối trống của phụ huynh/học sinh)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NoiDungTrong, Sticker } from "@/components/portal/sticker";
import { STICKER } from "@/components/portal/sticker-kich-thuoc";
import { HvTrong } from "@/components/portal/hv-ui";

afterEach(cleanup);

const THU_MUC = resolve(process.cwd(), "public/portal/sticker");

/** Kích thước pixel của WebP (VP8X · VP8 · VP8L). */
function kichThuocWebp(b: Buffer): { w: number; h: number } {
  expect(b.toString("ascii", 0, 4)).toBe("RIFF");
  expect(b.toString("ascii", 8, 12)).toBe("WEBP");
  const loai = b.toString("ascii", 12, 16);
  if (loai === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  if (loai === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (loai === "VP8L") {
    const v = b.readUInt32LE(21);
    return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 };
  }
  throw new Error("không phải WebP hợp lệ: " + loai);
}

describe("[STK-01] bảng kích thước khớp tệp", () => {
  it("mỗi tên trong bảng có tệp .webp đúng kích thước; không tệp nào ngoài bảng", () => {
    const tep = readdirSync(THU_MUC).filter((f) => f.endsWith(".webp")).map((f) => f.replace(/\.webp$/, "")).sort();
    expect(tep).toEqual(Object.keys(STICKER).sort());
    for (const [ten, k] of Object.entries(STICKER)) {
      const kt = kichThuocWebp(readFileSync(resolve(THU_MUC, `${ten}.webp`)));
      expect(kt, ten).toEqual({ w: k.w, h: k.h });
    }
  });
  it("đối chứng của bộ đọc: byte rác PHẢI bị từ chối", () => {
    expect(() => kichThuocWebp(Buffer.from("khong-phai-webp-khong-phai-webp-khong-phai-webp"))).toThrow();
  });
});

describe("[STK-02] dung lượng", () => {
  it("mỗi ảnh ≤ 60KB và cả bộ ≤ 400KB", () => {
    let tong = 0;
    for (const f of readdirSync(THU_MUC)) {
      const kb = statSync(resolve(THU_MUC, f)).size / 1024;
      tong += kb;
      expect(kb, f).toBeLessThanOrEqual(60);
    }
    expect(tong).toBeLessThanOrEqual(400);
  });
});

describe("[STK-03] component", () => {
  it("Sticker: trang trí, đúng tỉ lệ, đúng nguồn", () => {
    const { container } = render(<Sticker ten="chao" cao={100} />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("aria-hidden")).toBe("true");
    expect(img.getAttribute("height")).toBe("100");
    expect(img.getAttribute("width")).toBe(String(Math.round((100 * STICKER.chao.w) / STICKER.chao.h)));
    expect(decodeURIComponent(img.getAttribute("src") ?? "")).toContain("/portal/sticker/chao.webp");
  });
  it("NoiDungTrong: giữ nguyên chữ + có sticker; HvTrong dùng kính lúp mặc định và đổi được", () => {
    const { container } = render(<NoiDungTrong ten="khen">Cảm ơn ba mẹ!</NoiDungTrong>);
    expect(screen.getByText("Cảm ơn ba mẹ!")).toBeTruthy();
    expect(decodeURIComponent(container.querySelector("img")!.getAttribute("src") ?? "")).toContain("khen.webp");
    cleanup();
    const a = render(<HvTrong>Chưa có tin</HvTrong>);
    expect(decodeURIComponent(a.container.querySelector("img")!.getAttribute("src") ?? "")).toContain("tim-kiem.webp");
    cleanup();
    const b = render(<HvTrong sticker="thu-gian">Chưa có ảnh</HvTrong>);
    expect(decodeURIComponent(b.container.querySelector("img")!.getAttribute("src") ?? "")).toContain("thu-gian.webp");
    expect(screen.getByText("Chưa có ảnh")).toBeTruthy();
  });
});

// ── đọc nguồn (neo vào LỜI GỌI, bỏ chú thích — luật 14)
const boChuThich = (s: string) =>
  s
    .split(/\r?\n/)
    .filter((d) => !/^\s*\/\//.test(d))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(\s)\/\/.*$/gm, "$1");
const doc = (p: string) => boChuThich(readFileSync(resolve(process.cwd(), p), "utf8"));

describe("[STK-04] hết icon robot vẽ tay", () => {
  it("không còn `RobotMat` trong components/portal (kể cả định nghĩa)", () => {
    const loi: string[] = [];
    for (const f of readdirSync(resolve(process.cwd(), "components/portal"))) {
      if (!/\.tsx?$/.test(f) || /\.test\./.test(f)) continue;
      if (/RobotMat/.test(doc(`components/portal/${f}`))) loi.push(f);
    }
    expect(loi).toEqual([]);
  });
});

describe("[STK-05] đúng sticker ở đúng màn", () => {
  const co = (f: string, re: RegExp) => expect(doc(f), f).toMatch(re);
  it("Cổng học sinh: Hôm nay = chào · nộp hết bài = ăn mừng · cảm ơn đánh giá = tim · tính cách theo nhóm DISC", () => {
    co("components/portal/hv-hom-nay.tsx", /<Sticker ten="chao"/);
    co("components/portal/hv-bai-tap.tsx", /<Sticker ten="an-mung"/);
    co("components/portal/hv-danh-gia.tsx", /<Sticker ten="tim"/);
    co("components/portal/hv-san-pham.tsx", /D: "sieu-nhan", I: "an-mung", S: "thu-gian", C: "doc-sach"/);
    co("components/portal/hv-san-pham.tsx", /<Sticker ten=\{STICKER_NHOM\[r\.chinh\]\}/);
  });
  it("Cổng phụ huynh: các khối «chưa có gì» dùng NoiDungTrong", () => {
    co("components/portal/hoc-phi-phu-huynh.tsx", /<NoiDungTrong ten="tim-kiem"[^>]*>\s*Chưa có phiếu thu/);
    co("components/portal/hoa-don-phu-huynh.tsx", /<NoiDungTrong ten="may-tinh"/);
    co("components/portal/chuyen-can-page.tsx", /<NoiDungTrong ten="doc-sach"/);
    co("components/portal/gop-y-phu-huynh.tsx", /<NoiDungTrong ten="khen"/);
    co("components/portal/ho-so-phu-huynh.tsx", /<NoiDungTrong ten="chao"/);
    co("components/portal/children-page.tsx", /<NoiDungTrong ten="chao"/);
    co("components/portal/hinh-anh-page.tsx", /<Sticker ten="thu-gian"/);
    co("components/portal/hinh-anh-page.tsx", /<NoiDungTrong ten="tim-kiem"/);
  });
});
