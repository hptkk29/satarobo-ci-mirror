// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PubAnh } from "./pub-anh";
import { PubAnhGhiDeProvider } from "./pub-anh-ghi-de";

const ID = "659c303937fe76b0d2be11b04c59889e"; // photo 576×768 .jpg
const ID_KHOA = "09822f256fe47024e33331af8e3a0ea5"; // chỉ có ở images/khoa-hoc
const URL_THAY = "https://cdn.satarobo.vn/uploads/images/2026-11/anh-moi-1a2b3c4d.webp";

const anh = (id: string) => <PubAnh id={id} alt="mô tả" sizes="300px" />;
const src = (c: HTMLElement) => c.querySelector("img")!.getAttribute("src")!;
const dai = (c: HTMLElement) => decodeURIComponent(c.querySelector("img")!.getAttribute("srcset") ?? src(c));

describe("[PAG] PubAnh dùng ảnh admin đã thay", () => {
  afterEach(cleanup);

  it("[PAG-01] không có ghi đè (hoặc ngoài Provider) ⇒ ảnh mặc định trong repo", () => {
    expect(dai(render(anh(ID)).container)).toContain(`/pub/${ID}.jpg`);
    cleanup();
    expect(dai(render(<PubAnhGhiDeProvider ghiDe={{}}>{anh(ID)}</PubAnhGhiDeProvider>).container)).toContain(`/pub/${ID}.jpg`);
  });

  it("[PAG-02] có ghi đè ⇒ src là ảnh mới trên CDN, KHÔNG còn ảnh mặc định; khung (width/height) vẫn của ô", () => {
    const { container } = render(<PubAnhGhiDeProvider ghiDe={{ [ID]: { url: URL_THAY, w: 1200, h: 1600 } }}>{anh(ID)}</PubAnhGhiDeProvider>);
    const img = container.querySelector("img")!;
    expect(dai(container)).toContain(URL_THAY);
    expect(dai(container)).not.toContain(`/pub/${ID}.jpg`);
    expect(img.getAttribute("width")).toBe("576");
    expect(img.getAttribute("height")).toBe("768");
  });

  it("[PAG-03] ghi đè của ảnh KHÁC không ảnh hưởng ảnh này (khoá theo mã ảnh)", () => {
    const { container } = render(<PubAnhGhiDeProvider ghiDe={{ [ID_KHOA]: { url: URL_THAY, w: 500, h: 500 } }}>{anh(ID)}</PubAnhGhiDeProvider>);
    expect(dai(container)).toContain(`/pub/${ID}.jpg`);
  });

  it("[PAG-04] ô chỉ có ở images/khoa-hoc cũng thay được", () => {
    const g = { url: URL_THAY, w: 537, h: 685 };
    const { container } = render(<PubAnhGhiDeProvider ghiDe={{ [ID_KHOA]: g }}>{anh(ID_KHOA)}</PubAnhGhiDeProvider>);
    expect(dai(container)).toContain(URL_THAY);
  });
});

describe("[PAG-W] dây nối (lưới ghim mã nguồn — hành vi thật nằm ở PAG-01..04 và PAA-*)", () => {
  const doc = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");

  it("[PAG-W1] PubRoot đọc ảnh đã thay MỘT lần và bọc children bằng Provider", () => {
    const s = doc("components/public/pub-root.tsx");
    expect((s.match(/docAnhGhiDe\(\)/g) ?? []).length).toBe(1);
    expect(s).toMatch(/<PubAnhGhiDeProvider ghiDe=\{anhGhiDe\}>\{children\}<\/PubAnhGhiDeProvider>/);
  });

  it("[PAG-W2] trang admin + hai action đều đi qua cổng quyền site-content; action gọi assertPermission TRƯỚC mọi truy cập DB", () => {
    const a = doc("app/(admin)/admin/site-content/anh-public/actions.ts");
    expect((a.match(/assertPermission\("site-content:edit"\)/g) ?? []).length).toBe(2);
    for (const hamTen of ["luuAnhPublicAction", "datLaiAnhPublicAction"]) {
      const phan = a.slice(a.indexOf(`export async function ${hamTen}`));
      expect(phan.indexOf("assertPermission(")).toBeGreaterThan(-1);
      expect(phan.indexOf("assertPermission(")).toBeLessThan(phan.indexOf("scopedDb("));
    }
    const p = doc("app/(admin)/admin/site-content/anh-public/page.tsx");
    expect(p).toContain('PAGE_GATES["/site-content"]');
    expect(p).toContain('checkPermission("site-content:edit")');
  });

  it("[PAG-W3] trang 'Nội dung website' có lối vào tới trang ảnh public (không để mồ côi)", () => {
    expect(doc("app/(admin)/admin/site-content/page.tsx")).toContain('href="/site-content/anh-public"');
  });
});
