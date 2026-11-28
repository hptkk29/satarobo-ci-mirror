// @vitest-environment node
/**
 * [ONL-NET-*] E-learning ONLINE — lưới ghim mã nguồn: TÁCH BẠCH ba hệ · dây nối cờ/menu/quyền · cổng của mọi trang và action.
 *
 * Đây là lưới ghim MÃ NGUỒN (luật 11: mong manh nhất) — neo vào chuỗi hẹp, đếm số lần khớp, và mỗi lưới ĐÃ được cấy lỗi để thấy đỏ trước khi tin.
 * Bỏ chú thích trước khi quét (chú thích giải thích thường chứa đúng chuỗi đang cấm).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as actions from "../../lib/elearning-online/actions";
import { menuElearning, moiHrefThay, type QuyenMenu } from "../../app/(elearning)/elearning/_components/menu";

const GOC = process.cwd();
const doc = (f: string) => readFileSync(join(GOC, f), "utf8");
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function lietKe(dir: string, loc: (f: string) => boolean): string[] {
  const ra: string[] = [];
  const di = (d: string) => {
    for (const t of readdirSync(join(GOC, d))) {
      const p = `${d}/${t}`;
      if (statSync(join(GOC, p)).isDirectory()) di(p);
      else if (loc(p)) ra.push(p);
    }
  };
  di(dir);
  return ra;
}

/** Tiện ích kỹ thuật thuần của khu e-learning được Online dùng lại (không chứa luật nghiệp vụ Nội bộ). Thêm vào đây là một quyết định, không phải sửa test cho xanh. */
const CHO_PHEP_DUNG_CHUNG = new Set(["elearning/dashboard-pure", "elearning/tab-url"]);

const KHONG: QuyenMenu = { soan: false, cham: false, giao: false, baoCao: false, baoCaoDoi: false, quanLyYeuCau: false, quanLyChuongTrinh: false, evalLinkBat: false, onlineXem: false, onlineQuanLy: false };

describe("[ONL-NET-01] ba hệ TÁCH BẠCH (Nội bộ `Trn*` · Online `Onl*` · LMS Offline)", () => {
  const maOnline = [...lietKe("lib/elearning-online", (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)), ...lietKe("app/(elearning)/elearning/online", (f) => /\.tsx?$/.test(f))];
  const maNoiBo = lietKe("lib/elearning", (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));

  it("🔴 mã Online KHÔNG chạm model nội bộ `trn*` / LMS Offline / đơn hàng / thanh toán (đối chứng: có mã Online để quét)", () => {
    expect(maOnline.length).toBeGreaterThan(10);
    const vi: string[] = [];
    for (const f of maOnline) {
      const src = boChuThich(doc(f));
      // Chỉ bắt truy cập delegate Prisma (db./tx./sdb./prisma.<model>.) — `q.course.code` là QUAN HỆ của một dòng `onl*`, không phải model khác.
      for (const m of src.matchAll(/\b(?:db|tx|sdb|prisma)\.(trn[A-Z]\w*|order|orderItem|payment|paymentRequest|enrollment|attendance|classSession|exam|examAttempt|lesson|course)\b\s*\./g)) vi.push(`${f}: .${m[1]}.`);
      for (const m of src.matchAll(/from\s+["']@\/lib\/(elearning|payments|orders|finance|lms)\/([\w-]+)["']/g)) {
        // Tiện ích KỸ THUẬT thuần dùng chung (không mang nghiệp vụ): kiểu sắc thái + địa chỉ tab. Mọi import khác từ hệ khác là coupling nghiệp vụ.
        if (!CHO_PHEP_DUNG_CHUNG.has(`${m[1]}/${m[2]}`)) vi.push(`${f}: import ${m[1]}/${m[2]}`);
      }
    }
    expect(vi).toEqual([]);
  });

  it("🔴 mã Nội bộ (`lib/elearning`) KHÔNG chạm model Online `onl*` và không import `lib/elearning-online`", () => {
    expect(maNoiBo.length).toBeGreaterThan(50);
    const vi: string[] = [];
    for (const f of maNoiBo) {
      const src = boChuThich(doc(f));
      if (/\.onl[A-Z]\w*\s*\./.test(src)) vi.push(`${f}: model onl*`);
      if (/elearning-online/.test(src)) vi.push(`${f}: import elearning-online`);
    }
    expect(vi).toEqual([]);
  });

  it("🔴 LMS Offline / đơn hàng / thanh toán KHÔNG chạm model `onl*` (chỉ Workstream A gọi qua hàm cấp quyền)", () => {
    const vi: string[] = [];
    for (const f of [...lietKe("lib/lms", (f) => /\.tsx?$/.test(f) && !/\.test\./.test(f)), ...lietKe("lib/orders", (f) => /\.tsx?$/.test(f) && !/\.test\./.test(f)), ...lietKe("lib/payments", (f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))]) {
      if (/\.onl[A-Z]\w*\s*\./.test(boChuThich(doc(f)))) vi.push(f);
    }
    expect(vi).toEqual([]);
  });
});

describe("[ONL-NET-02] dây nối cờ · menu · quyền", () => {
  it("🔴 layout truyền ĐỦ hai biến menu Online, gộp CẢ cờ lẫn quyền (quên truyền = mục menu biến mất câm — luật 11)", () => {
    const src = boChuThich(doc("app/(elearning)/elearning/layout.tsx"));
    expect(src).toContain('onlineXem: isElearningOnlineEnabled() && can(actor, "onl:course:view")');
    expect(src).toContain('onlineQuanLy: isElearningOnlineEnabled() && can(actor, "onl:course:manage")');
  });

  it("menu: không quyền ⇒ không có mục Online; có quyền xem ⇒ Khoá online; danh mục chỉ khi có quyền quản lý (đối chứng dương + âm)", () => {
    const tap = (p: Partial<QuyenMenu>) => new Set(moiHrefThay(menuElearning({ ...KHONG, ...p })));
    expect([...tap({})].some((h) => h.startsWith("/elearning/online"))).toBe(false);
    expect(tap({ onlineXem: true }).has("/elearning/online")).toBe(true);
    expect(tap({ onlineXem: true }).has("/elearning/online/danh-muc")).toBe(false);
    expect(tap({ onlineXem: true, onlineQuanLy: true }).has("/elearning/online/danh-muc")).toBe(true);
    // quản lý mà không có quyền xem (cờ tắt ⇒ layout đưa cả hai về false; ở đây ghim: quản lý một mình không mở khu)
    expect(tap({ onlineQuanLy: true }).has("/elearning/online")).toBe(false);
    // quyền Nội bộ không mở khu Online
    expect([...tap({ soan: true, cham: true, giao: true, baoCao: true, quanLyChuongTrinh: true, quanLyYeuCau: true })].some((h) => h.startsWith("/elearning/online"))).toBe(false);
  });

  it("🔴 cờ ELEARNING_ONLINE_ENABLED mặc định TẮT và độc lập với ELEARNING_ENABLED", () => {
    const flags = boChuThich(doc("lib/flags.ts"));
    expect(flags).toMatch(/export function isElearningOnlineEnabled\(\): boolean \{\s*return process\.env\.ELEARNING_ONLINE_ENABLED === "true";/);
  });
});

describe("[ONL-NET-03] cổng của mọi trang và mọi action", () => {
  const trang = lietKe("app/(elearning)/elearning/online", (f) => /\/page\.tsx$/.test(f));

  it("🔴 MỌI trang Online gọi `vaoTrangOnline(\"onl:…\")` ngay đầu và là `force-dynamic` (đối chứng: có ≥ 6 trang)", () => {
    expect(trang.length).toBeGreaterThanOrEqual(6);
    for (const f of trang) {
      const src = boChuThich(doc(f));
      expect(src, f).toMatch(/await vaoTrangOnline\("onl:[a-z-]+:[a-z-]+"/);
      expect(src, f).toContain('export const dynamic = "force-dynamic"');
      expect(src, f).not.toMatch(/from "@\/lib\/db"/); // trang không import db trần
    }
  });

  it("🔴 cổng `vaoTrangOnline` kiểm CỜ trước, rồi phiên, rồi quyền (cờ tắt ⇒ notFound, không lộ gì)", () => {
    const src = boChuThich(doc("app/(elearning)/elearning/online/_lib/vao.tsx"));
    const iCo = src.indexOf("isElearningOnlineEnabled()");
    const iPhien = src.indexOf("await auth()");
    const iQuyen = src.indexOf("can(actor, quyen)");
    expect(iCo).toBeGreaterThan(-1);
    expect(iCo).toBeLessThan(iPhien);
    expect(iPhien).toBeLessThan(iQuyen);
    expect(src).toContain("notFound()");
  });

  it("🔴 MỌI cấu hình action đòi một key `onl:*` đã khai ở registry, đặt module `elearning-online`, có entityType; ghi/xoá có auditAction (đối chứng: ≥ 20 cấu hình)", () => {
    const cfg = Object.entries(actions).filter(([, v]) => typeof v === "object" && v !== null && "handler" in v) as [string, { permission: string; module: string; entityType: string; auditAction?: string; name: string }][];
    expect(cfg.length).toBeGreaterThanOrEqual(28);
    const registry = doc("lib/permissions/registry/elearning-online.ts");
    for (const [ten, c] of cfg) {
      expect(c.permission, ten).toMatch(/^onl:[a-z-]+:[a-z-]+$/);
      expect(registry, `${ten}: key ${c.permission} chưa khai ở registry`).toContain(`"${c.permission}"`);
      expect(c.module, ten).toBe("elearning-online");
      expect(c.entityType.length, ten).toBeGreaterThan(2);
      expect(c.auditAction, ten).toBeTruthy();
    }
  });

  it("🔴 mọi hành động PHÁ HỦY / thu quyền bắt buộc lý do (xoá chương/bài/danh mục, lưu trữ khoá, cấp, thu hồi)", () => {
    const can = ["cauHinhXoaChuong", "cauHinhXoaBai", "cauHinhXoaDanhMuc", "cauHinhLuuTruKhoa", "cauHinhCapQuyen", "cauHinhThuHoiQuyen", "cauHinhLuuTruCauHoi", "cauHinhCapChungNhanTay", "cauHinhThuHoiChungNhan"] as const;
    for (const k of can) expect((actions as Record<string, { requireReason?: boolean }>)[k]?.requireReason, k).toBe(true);
  });

  it("🔴 `_actions.ts` bọc ĐÚNG số cấu hình bằng `defineAction` (không action nào mọc ngoài `lib/elearning-online/actions.ts` → không lọt qua lưới trên)", () => {
    const cfgSo = Object.values(actions).filter((v) => typeof v === "object" && v !== null && "handler" in v).length;
    const src = boChuThich(doc("app/(elearning)/elearning/online/_actions.ts"));
    expect((src.match(/= defineAction\(/g) ?? []).length).toBe(cfgSo);
    expect(src).not.toMatch(/export const (?!\w+Action = defineAction)/);
  });
});
