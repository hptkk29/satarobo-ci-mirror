import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { chonDichDen404, DICH_DEN_MAC_DINH } from "./dich-den-404";

describe("[NF404] chọn đích của link ở trang 404 theo host", () => {
  it("[NF404-01] mỗi host trả đúng đích như bản cũ (giaovien/hocvien/admin/sale)", () => {
    expect(chonDichDen404("giaovien.satarobo.vn")).toEqual({ href: "/teacher", label: "Về trang giáo viên" });
    expect(chonDichDen404("hocvien.satarobo.vn")).toEqual({ href: "/portal", label: "Về cổng phụ huynh" });
    expect(chonDichDen404("admin.satarobo.vn")).toEqual({ href: "/dashboard", label: "Về Dashboard" });
    expect(chonDichDen404("sale.satarobo.vn")).toEqual({ href: "/dashboard", label: "Về Dashboard" });
  });

  it("[NF404-02] host công khai, rỗng, null, undefined ⇒ trang chủ; không phân biệt hoa/thường; có cổng vẫn khớp", () => {
    for (const h of ["satarobo.vn", "test.satarobo.vn", "", null, undefined, "localhost:3000"]) {
      expect(chonDichDen404(h)).toEqual(DICH_DEN_MAC_DINH);
    }
    expect(chonDichDen404("ADMIN.SataRobo.vn")).toEqual({ href: "/dashboard", label: "Về Dashboard" });
    expect(chonDichDen404("giaovien.localhost:3000").href).toBe("/teacher");
  });

  it("[NF404-03] host chỉ CHỨA tiền tố ở giữa chuỗi KHÔNG bị nhận nhầm (không mở rộng quyền gợi ý)", () => {
    expect(chonDichDen404("evil-admin.satarobo.vn")).toEqual(DICH_DEN_MAC_DINH);
    expect(chonDichDen404("x.admin.satarobo.vn")).toEqual(DICH_DEN_MAC_DINH);
  });
});

// ── LƯỚI GHIM MÃ NGUỒN ─────────────────────────────────────────────────────────────────────────
// Luật cần khoá: các trang 404 KHÔNG dùng API động của request (headers/cookies/connection) trên server.
// Mã TRƯỚC bản vá: `import { headers } from "next/headers"; const host = (await headers()).get("host")` trong
// app/not-found.tsx ⇒ `/tin-tuc/<slug lạ>` trả 500 ("Page changed from static to dynamic at runtime … headers").
// Đếm cả SỐ TỆP quét được (chú thích giải thích bản vá chứa đúng chuỗi đang cấm nên phải bỏ chú thích trước khi so).
function boChuThich(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
function timNotFound(dir: string, out: string[] = []): string[] {
  for (const ten of readdirSync(dir)) {
    if (ten === "node_modules" || ten === ".next") continue;
    const p = join(dir, ten);
    const st = statSync(p);
    if (st.isDirectory()) timNotFound(p, out);
    else if (ten === "not-found.tsx") out.push(p);
  }
  return out;
}

describe("[NF404-W] trang 404 không đọc API động trên server", () => {
  const goc = resolve(process.cwd(), "app");
  const cacTep = timNotFound(goc);

  it("[NF404-W0] quét được ít nhất app/not-found.tsx (lưới không rỗng)", () => {
    expect(cacTep.some((p) => p.replace(/\\/g, "/").endsWith("app/not-found.tsx"))).toBe(true);
  });

  it("[NF404-W1] mọi not-found.tsx: không import next/headers, không gọi headers()/cookies()/connection()", () => {
    for (const p of cacTep) {
      const ma = boChuThich(readFileSync(p, "utf8"));
      expect(ma, p).not.toMatch(/from\s+["']next\/headers["']/);
      expect(ma, p).not.toMatch(/\b(headers|cookies|connection)\s*\(/);
    }
  });

  it("[NF404-W2] lối thoát 404 (chọn đích) là client component, đọc host ở trình duyệt, không import next/headers", () => {
    const ma = readFileSync(resolve(process.cwd(), "components/not-found/loi-thoat-404.tsx"), "utf8");
    expect(ma.trimStart().startsWith('"use client"')).toBe(true);
    const code = boChuThich(ma);
    expect(code).not.toMatch(/next\/headers/);
    expect(code).toMatch(/window\.location\.host/);
    expect(code).toMatch(/chonDichDen404\(/);
  });
});
