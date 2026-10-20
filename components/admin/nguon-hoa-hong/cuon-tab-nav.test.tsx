// @vitest-environment jsdom
/**
 * [NHH-FE-NAV-CUON-*] — thanh tab cuộn ngang (CuonTabNav): dấu hiệu "còn tab ngoài màn" + tab đang chọn tự cuộn vào giữa.
 *
 * jsdom không có bố cục thật nên các số đo (scrollWidth / clientWidth / vị trí) được GIẢ ở mức prototype và đọc từ thuộc tính data của chính phần tử — ca nào cần
 * "không tràn" thì giả số đo khác đi, nên mỗi ca "không có dấu" có ca "có dấu" làm đối chứng (luật 11). Sự đúng đắn của mặt nạ trên màn thật xem ảnh chụp 768/375.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { TAB } from "./classes";
import { CuonTabNav } from "./cuon-tab-nav";

const luu = new WeakMap<Element, number>();
const goc = {
  scrollWidth: Object.getOwnPropertyDescriptor(Element.prototype, "scrollWidth"),
  clientWidth: Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth"),
  scrollLeft: Object.getOwnPropertyDescriptor(Element.prototype, "scrollLeft"),
  rect: Element.prototype.getBoundingClientRect,
};

beforeEach(() => {
  Object.defineProperty(Element.prototype, "scrollWidth", { configurable: true, get(this: Element) { return Number((this as HTMLElement).dataset.sw ?? 0); } });
  Object.defineProperty(Element.prototype, "clientWidth", { configurable: true, get(this: Element) { return Number((this as HTMLElement).dataset.cw ?? 0); } });
  Object.defineProperty(Element.prototype, "scrollLeft", {
    configurable: true,
    get(this: Element) { return luu.get(this) ?? 0; },
    set(this: Element, v: number) { luu.set(this, v); },
  });
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const left = Number((this as HTMLElement).dataset.left ?? 0);
    const width = Number((this as HTMLElement).dataset.w ?? 0);
    return { left, right: left + width, width, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON: () => ({}) } as DOMRect;
  };
});
afterEach(() => {
  cleanup();
  for (const k of ["scrollWidth", "clientWidth", "scrollLeft"] as const) if (goc[k]) Object.defineProperty(Element.prototype, k, goc[k]!);
  Element.prototype.getBoundingClientRect = goc.rect;
});

const NAV = "Thanh tab thử";
const dung = (p: { sw: number; cw: number; chon?: { left: number; w: number } }) =>
  render(
    <CuonTabNav aria-label={NAV} data-sw={p.sw} data-cw={p.cw} data-left={0}>
      <a href="#a">Nguồn</a>
      <a href="#b" aria-current="page" data-left={p.chon?.left ?? 0} data-w={p.chon?.w ?? 0}>
        Sổ hoa hồng
      </a>
      <a href="#c">Kỳ</a>
    </CuonTabNav>,
  );
const nav = () => screen.getByRole("navigation", { name: NAV });

describe("[NHH-FE-NAV-CUON-01] dấu 'còn tab ngoài màn' theo số đo thật", () => {
  it("tràn và đang ở đầu ⇒ mờ bên PHẢI; cuộn giữa ⇒ mờ cả hai; cuộn tới cuối ⇒ mờ bên TRÁI; đối chứng: không tràn ⇒ không mờ", () => {
    dung({ sw: 600, cw: 343 });
    expect(nav().getAttribute("data-mask")).toBe("phai");
    for (const [vi_tri, mong] of [[100, "ca-hai"], [257, "trai"], [0, "phai"]] as const) {
      act(() => {
        luu.set(nav(), vi_tri);
        fireEvent.scroll(nav());
      });
      expect(nav().getAttribute("data-mask"), `scrollLeft=${vi_tri}`).toBe(mong);
    }
    cleanup();
    dung({ sw: 343, cw: 343 });
    expect(nav().getAttribute("data-mask")).toBe("khong");
  });
});

describe("[NHH-FE-NAV-CUON-02] tab đang chọn tự cuộn vào giữa thanh", () => {
  it("tab chọn nằm ngoài màn ⇒ scrollLeft đặt để nó ở GIỮA thanh (không cuộn trang: chỉ gán scrollLeft của thanh); đối chứng: không tràn ⇒ không đụng scrollLeft", () => {
    // thanh rộng 343 hiển thị từ x=0; tab chọn bắt đầu x=450 rộng 140 ⇒ tâm 520 ⇒ cuộn 520 - 343/2 = 348.5
    dung({ sw: 700, cw: 343, chon: { left: 450, w: 140 } });
    expect(luu.get(nav())).toBeCloseTo(348.5, 1);
    cleanup();
    luu.delete(document.body);
    dung({ sw: 300, cw: 343, chon: { left: 450, w: 140 } });
    expect(luu.get(nav()) ?? 0).toBe(0);
  });

  it("tab chọn đã nằm trong màn ở đầu thanh ⇒ không cuộn (scrollLeft không âm)", () => {
    dung({ sw: 700, cw: 343, chon: { left: 10, w: 100 } });
    expect(luu.get(nav()) ?? 0).toBe(0);
  });
});

describe("[NHH-FE-NAV-CUON-03] lớp CSS", () => {
  it("TAB có shrink-0 (tab không co lại ép chữ xuống dòng); thanh ẩn thanh cuộn, đặt mặt nạ phía điện thoại làm mặc định TRƯỚC khi JS chạy", () => {
    expect(TAB).toMatch(/\bshrink-0\b/);
    dung({ sw: 600, cw: 343 });
    const c = nav().className;
    expect(c).toMatch(/overflow-x-auto/);
    expect(c).toMatch(/\[scrollbar-width:none\]/);
    expect(c).toMatch(/\[&::-webkit-scrollbar\]:hidden/);
    expect(c).toMatch(/max-md:\[mask-image:/); // mặc định trước hydration: điện thoại luôn tràn
    expect(c).toMatch(/data-\[mask=khong\]:\[mask-image:none\]/); // JS biết không tràn ⇒ gỡ mặt nạ
  });

  it("module-nav.tsx dùng CuonTabNav cho thanh tab và KHÔNG tự thành client component (scope có hàm, không qua được ranh giới client)", () => {
    const m = readFileSync(resolve(process.cwd(), "components/admin/nguon-hoa-hong/module-nav.tsx"), "utf8");
    expect(m).not.toMatch(/^\s*["']use client["']/m);
    expect((m.match(/<CuonTabNav\b/g) ?? []).length).toBe(1);
    const cuon = readFileSync(resolve(process.cwd(), "components/admin/nguon-hoa-hong/cuon-tab-nav.tsx"), "utf8");
    expect(cuon).toMatch(/^\s*["']use client["']/m);
    // bỏ chú thích TRƯỚC khi tìm cấm (chú thích giải thích bản vá chính là chỗ chứa chuỗi bị cấm — luật 11). scrollIntoView cuộn cả TRANG theo chiều dọc; chỉ gán scrollLeft của thanh.
    const maThat = cuon.split("\n").filter((d) => !d.trimStart().startsWith("//")).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(maThat).not.toMatch(/scrollIntoView/);
    expect(maThat).toMatch(/nav\.scrollLeft = /);
  });
});

