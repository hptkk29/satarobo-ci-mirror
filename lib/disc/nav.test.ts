/**
 * [DISC-NAV-*] Lối vào DISC: một nguồn nhãn/đường dẫn, cờ TẮT thì không lộ.
 * Từ 10/11/2026 DISC đứng trong nhóm «Góc gia đình» (hành vi theo cờ ở `lib/public/goc-gia-dinh.test.ts`, ca `[GOC-*]`).
 * Test đọc mã nguồn chỉ dùng để ghim DÂY NỐI (luật 11: cờ mặc định false mà không ai
 * truyền = lỗi câm) — phần hành vi ở các ca render bên dưới.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, afterEach } from "vitest";
import { DISC_NAV } from "./nav";
import { isDiscEnabled } from "@/lib/flags";

describe("[DISC-NAV-01] hằng DISC_NAV", () => {
  it("nhãn đúng PRD (không 'miễn phí'), đích /disc", () => {
    expect(DISC_NAV.label).toBe("Khám phá DISC");
    expect(DISC_NAV.label).not.toMatch(/miễn phí/i);
    expect(DISC_NAV.href).toBe("/disc");
  });
});

describe("[DISC-FLAG-01] isDiscEnabled chỉ nhận đúng chuỗi 'true'", () => {
  const cu = process.env.DISC_ENABLED;
  afterEach(() => {
    if (cu === undefined) delete process.env.DISC_ENABLED;
    else process.env.DISC_ENABLED = cu;
  });
  it.each([[undefined, false], ["", false], ["1", false], ["TRUE", false], ["true", true]])("%s → %s", (v, kq) => {
    if (v === undefined) delete process.env.DISC_ENABLED;
    else process.env.DISC_ENABLED = v;
    expect(isDiscEnabled()).toBe(kq);
  });
});

describe("[DISC-WIRE-*] dây nối cờ (luật 11)", () => {
  const doc = (p: string) => readFileSync(p, "utf8");
  it("layout public truyền cờ DISC cho Header VÀ FloatingCta", () => {
    const s = doc("app/(public)/layout.tsx");
    expect(s.match(/discEnabled=\{isDiscEnabled\(\)\}/g)?.length).toBe(2);
  });
  it("Header truyền cờ xuống drawer mobile", () => {
    expect(doc("components/public/header.tsx")).toMatch(/<MobileNavDrawer discEnabled=\{discEnabled\}[^>]*\/>/);
  });
  it("Header và drawer dùng chung chenNhomGoc (không chép tay hai bản)", () => {
    expect(doc("components/public/header.tsx")).toMatch(/chenNhomGoc\(/);
    expect(doc("components/sections/mobile-nav-drawer.tsx")).toMatch(/chenNhomGoc\(/);
  });
  it("trang /disc trả 404 khi cờ tắt", () => {
    expect(doc("app/(public)/disc/page.tsx")).toMatch(/if \(!isDiscEnabled\(\)\) notFound\(\)/);
  });
});
