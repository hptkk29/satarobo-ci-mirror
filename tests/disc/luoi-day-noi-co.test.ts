/**
 * [DISC-QA-WIRE-*] Lưới ghim DÂY NỐI cờ DISC (CLAUDE.md luật 11: prop cờ mặc định false mà không ai
 * truyền = lỗi CÂM; chỉ ghim được bằng đọc mã nguồn vì thứ cần kiểm là một lời gọi/prop, không phải
 * giá trị trả về). Mọi khẳng định chạy trên mã ĐÃ BỎ CHÚ THÍCH (chú thích giải thích bản vá hay chứa
 * đúng chuỗi đang cấm) và đếm SỐ LẦN khớp.
 *
 * Phần hành vi (cờ bật ⇒ có, tắt ⇒ không) nằm ở [DISC-QA-NAV-*] bên dưới và ở
 * lib/disc/nav.test.ts + components/public/floating-cta.disc.test.tsx.
 */
import { describe, expect, it } from "vitest";
import { boChuThich, docTep, GOC_REPO } from "./_quet";
import { join } from "node:path";
import { chenMucDisc, DISC_NAV } from "../../lib/disc/nav";

const ma = (rel: string) => boChuThich(docTep(join(GOC_REPO, rel)));
const dem = (s: string, re: RegExp) => s.match(re)?.length ?? 0;

describe("[DISC-QA-WIRE-01] layout public truyền cờ cho đúng HAI nơi", () => {
  const s = ma("app/(public)/layout.tsx");
  it("<Header discEnabled=…> và <FloatingCta discEnabled=…> đều nhận isDiscEnabled()", () => {
    expect(dem(s, /<Header discEnabled=\{isDiscEnabled\(\)\}\s*\/>/g)).toBe(1);
    expect(dem(s, /<FloatingCta discEnabled=\{isDiscEnabled\(\)\}\s*\/>/g)).toBe(1);
  });
  it("cờ đọc ở SERVER (layout không phải 'use client')", () => {
    expect(s).not.toMatch(/^\s*["']use client["']/m);
  });
  it("không có chỗ nào render Header/FloatingCta trần (thiếu prop = mục menu biến mất)", () => {
    expect(dem(s, /<Header\s*\/>/g)).toBe(0);
    expect(dem(s, /<FloatingCta\s*\/>/g)).toBe(0);
  });
});

describe("[DISC-QA-WIRE-02] mọi nơi render Header / FloatingCta / MobileNavDrawer trong app phải truyền cờ", () => {
  it("không có <Header /> hay <FloatingCta /> trần ở cây public", () => {
    // Quét layout/page trong app/(public) + components/public: chỗ nào render mà quên prop sẽ lộ ở đây.
    const dsTep = ["app/(public)/layout.tsx", "components/public/header.tsx"];
    for (const rel of dsTep) {
      const s = ma(rel);
      expect(dem(s, /<FloatingCta\s*\/>/g), `${rel}: <FloatingCta /> trần`).toBe(0);
      if (rel.endsWith("layout.tsx")) expect(dem(s, /<Header\s*\/>/g), `${rel}: <Header /> trần`).toBe(0);
    }
  });
});

describe("[DISC-QA-WIRE-03] Header: danh sách desktop và drawer mobile đi qua cùng chenMucDisc", () => {
  const h = ma("components/public/header.tsx");
  const d = ma("components/sections/mobile-nav-drawer.tsx");
  it("Header: dựng navLinks bằng chenMucDisc(NAV_LINKS, discEnabled) và RENDER navLinks (không NAV_LINKS)", () => {
    expect(dem(h, /chenMucDisc\(\s*NAV_LINKS\s*,\s*discEnabled\s*\)/g)).toBe(1);
    expect(dem(h, /navLinks\.map\(/g)).toBe(1);
    // Render thẳng mảng gốc = bỏ qua mục DISC mà không lỗi nào báo.
    expect(dem(h, /NAV_LINKS\.map\(/g)).toBe(0);
  });
  it("Header truyền cờ xuống drawer đúng MỘT lần", () => {
    expect(dem(h, /<MobileNavDrawer\s+discEnabled=\{discEnabled\}\s*\/>/g)).toBe(1);
    expect(dem(h, /<MobileNavDrawer\s*\/>/g)).toBe(0);
  });
  it("Drawer: dựng navItems bằng chenMucDisc(NAV_ITEMS, discEnabled) và RENDER navItems (không NAV_ITEMS)", () => {
    expect(dem(d, /chenMucDisc\(\s*NAV_ITEMS\s*,\s*discEnabled\s*\)/g)).toBe(1);
    expect(dem(d, /navItems\.map\(/g)).toBe(1);
    expect(dem(d, /NAV_ITEMS\.map\(/g)).toBe(0);
  });
  it("Header và Drawer đều khai prop discEnabled với mặc định false (cờ TẮT khi không ai truyền)", () => {
    expect(h).toMatch(/discEnabled\s*=\s*false/);
    expect(d).toMatch(/discEnabled\s*=\s*false/);
  });
  it("cả hai danh sách đều còn mục 'Liên hệ' => /lien-he (điểm neo để DISC đứng ngay trước)", () => {
    expect(h).toMatch(/label:\s*"Liên hệ",\s*href:\s*"\/lien-he"/);
    expect(d).toMatch(/label:\s*"Liên hệ",\s*href:\s*"\/lien-he"/);
  });
});

describe("[DISC-QA-WIRE-04] nút nổi: nhãn và đích lấy từ DISC_NAV, ẩn ở /disc, mặc định tắt", () => {
  const f = ma("components/public/floating-cta.tsx");
  it("dùng DISC_NAV (không chép tay nhãn/đường dẫn)", () => {
    expect(f).toMatch(/from "@\/lib\/disc\/nav"/);
    expect(dem(f, /DISC_NAV\.href/g)).toBeGreaterThanOrEqual(2); // desktop + mobile
    expect(dem(f, /DISC_NAV\.label/g)).toBeGreaterThanOrEqual(2);
    expect(f).not.toMatch(/Khám phá DISC/); // nhãn chỉ có ở một nguồn
  });
  it("mặc định discEnabled = false; cả hai nút đều nằm sau `discEnabled &&`", () => {
    expect(f).toMatch(/discEnabled\s*=\s*false/);
    expect(dem(f, /\{discEnabled && \(/g)).toBe(2);
  });
  it("/disc nằm trong danh sách ẩn nút nổi", () => {
    expect(f).toMatch(/HIDDEN_PREFIXES\s*=\s*\[[^\]]*"\/disc"/);
  });
});

describe("[DISC-QA-NAV-*] hành vi chenMucDisc với ĐÚNG hai danh sách thật (đối chứng dương/âm)", () => {
  // Trích mục thật từ mã nguồn để test không dựa vào bản sao tự viết.
  const trich = (rel: string, tenMang: string) => {
    const s = ma(rel);
    const kh = new RegExp(`${tenMang}[^=]*=\\s*\\[([\\s\\S]*?)\\n\\];`).exec(s);
    expect(kh, `không thấy mảng ${tenMang} trong ${rel}`).toBeTruthy();
    return [...kh![1]!.matchAll(/label:\s*"([^"]+)",\s*href:\s*"([^"]+)"/g)].map((m) => ({ label: m[1]!, href: m[2]! }));
  };
  const headerMuc = trich("components/public/header.tsx", "NAV_LINKS");
  const drawerMuc = trich("components/sections/mobile-nav-drawer.tsx", "NAV_ITEMS");

  it("trích được mục thật (lưới không rỗng)", () => {
    expect(headerMuc.length).toBeGreaterThanOrEqual(5);
    expect(drawerMuc.length).toBeGreaterThanOrEqual(5);
  });
  it.each([
    ["header", headerMuc],
    ["drawer", drawerMuc],
  ] as const)("%s — cờ BẬT: có đúng 1 mục /disc, đứng ngay trước /lien-he; thứ tự các mục khác giữ nguyên", (_t, muc) => {
    const r = chenMucDisc(muc, true);
    expect(r.filter((m) => m.href === "/disc")).toHaveLength(1);
    const i = r.findIndex((m) => m.href === "/disc");
    expect(r[i]!.label).toBe("Khám phá DISC");
    expect(r[i + 1]?.href).toBe("/lien-he");
    expect(r.filter((m) => m.href !== "/disc").map((m) => m.href)).toEqual(muc.map((m) => m.href));
  });
  it.each([
    ["header", headerMuc],
    ["drawer", drawerMuc],
  ] as const)("%s — cờ TẮT: không có /disc và danh sách giữ nguyên (đối chứng của ca trên)", (_t, muc) => {
    const r = chenMucDisc(muc, false);
    expect(r.some((m) => m.href === "/disc")).toBe(false);
    expect(r).toEqual(muc);
  });
  it("nhãn menu KHÔNG kèm 'miễn phí' (PRD v2.0)", () => {
    expect(DISC_NAV.label).not.toMatch(/miễn phí/i);
  });
  it("chenMucDisc không đổi mảng đầu vào (không rò trạng thái giữa hai lần render)", () => {
    const goc = [...headerMuc];
    chenMucDisc(headerMuc, true);
    expect(headerMuc).toEqual(goc);
  });
});
