import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const co = vi.hoisted(() => ({ bat: false, loiKy: false }));
vi.mock("@/lib/flags", () => ({ isMediaSignedUrlEnabled: () => co.bat }));
vi.mock("@/lib/storage/signed-url", () => ({
  keyFromPublicUrl: (u: string) => (u.startsWith("https://kho.app/") ? u.slice("https://kho.app/".length) : null),
  signedMediaUrl: async (key: string, ttl: number) => {
    if (co.loiKy) throw new Error("ky loi");
    return `https://kho.app/ky/${key}?ttl=${ttl}`;
  },
}));
vi.mock("@/lib/portal/photos", () => ({ getStudentPhotos: vi.fn() }));

import { kyAnhMacDinh, khoaAnhBuoiRieng, TTL_URL_ANH_GIAY } from "./dich-vu/anh-buoi-hoc";
import { datKhoTepRieng, type KhoTepRieng } from "./kho-tep-rieng";

/**
 * [ANH] V8.2 — bộ ký ảnh mặc định + lưới ghim (hành vi dữ liệu thật ở tests/mobile-api/anh-buoi-hoc.spec.ts [ANH-DB]).
 *   [ANH-01] cờ TẮT ⇒ null (kể cả URL thuộc kho); cờ BẬT + URL kho ⇒ URL KÝ ≤ 15 phút; URL ngoài kho / ký lỗi ⇒ null — KHÔNG BAO GIỜ URL gốc
 *   [ANH-W1] loader của web: mặc định VẪN qua `resolveMediaUrl` (web không đổi); chỉ `urlTho` mới trả URL gốc, và dịch vụ di động là nơi duy nhất dùng
 */
const bo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const doc = (p: string) => bo(readFileSync(resolve(process.cwd(), p), "utf8"));

describe("[ANH] bộ ký ảnh mặc định", () => {
  beforeEach(() => {
    co.bat = false;
    co.loiKy = false;
  });

  it("[ANH-01] chỉ trả URL ký; mọi trường hợp khác ⇒ null", async () => {
    expect(await kyAnhMacDinh("https://kho.app/uploads/a.jpg")).toBeNull(); // cờ tắt
    co.bat = true;
    const u = await kyAnhMacDinh("https://kho.app/uploads/a.jpg");
    expect(u).toBe(`https://kho.app/ky/uploads/a.jpg?ttl=${TTL_URL_ANH_GIAY}`);
    expect(TTL_URL_ANH_GIAY).toBeLessThanOrEqual(900);
    expect(await kyAnhMacDinh("https://nguoi-la.example/a.jpg")).toBeNull(); // ngoài kho
    co.loiKy = true;
    expect(await kyAnhMacDinh("https://kho.app/uploads/a.jpg")).toBeNull(); // ký lỗi ⇒ không rơi về URL gốc
  });

  it("[ANH-02] V8.6: ảnh trong KHO RIÊNG (`private:class-media/…`) — chỉ ký qua kho riêng ≤ 15 phút, độc lập cờ ảnh công khai; khoá lạ / không có kho ⇒ null", async () => {
    const goi: Array<{ key: string; ttl: number }> = [];
    const kho: KhoTepRieng = { ten: "gia", kyPut: async () => ({ url: "", headers: {} }), dau: async () => null, docByteDau: async () => null, xoa: async () => undefined, kyGet: async (key, ttl) => (goi.push({ key, ttl }), `https://kho-rieng.invalid/${key}?ttl=${ttl}`) };
    co.bat = false; // cờ ảnh công khai TẮT không ảnh hưởng đường kho riêng
    datKhoTepRieng(kho);
    try {
      expect(await kyAnhMacDinh("private:class-media/a-1.png")).toBe(`https://kho-rieng.invalid/class-media/a-1.png?ttl=${TTL_URL_ANH_GIAY}`);
      expect(goi).toEqual([{ key: "class-media/a-1.png", ttl: TTL_URL_ANH_GIAY }]);
      goi.length = 0;
      for (const x of ["private:class-media/../secret", "private:exam-img/a.png", "private:class-media/", "private:class-media/a/b.png", "private:", "private:class-media/" + "x".repeat(130)]) expect(await kyAnhMacDinh(x), x).toBeNull();
      expect(goi.length).toBe(0); // khoá sai không bao giờ tới kho
      expect(khoaAnhBuoiRieng("private:class-media/ok.png")).toBe("class-media/ok.png");
    } finally {
      datKhoTepRieng(null);
    }
    const truoc = process.env.MOBILE_UPLOAD_LOCAL_DIR;
    delete process.env.MOBILE_UPLOAD_LOCAL_DIR;
    try {
      expect(await kyAnhMacDinh("private:class-media/ok.png")).toBeNull(); // không có kho ⇒ fail-closed, không URL công khai
    } finally {
      if (truoc !== undefined) process.env.MOBILE_UPLOAD_LOCAL_DIR = truoc;
    }
  });

  it("[ANH-W1] loader web giữ nguyên hành vi mặc định; urlTho chỉ cho dịch vụ di động", () => {
    const p = doc("lib/portal/photos.ts");
    expect(p).toContain("opts.urlTho ? media.map((m) => m.fileUrl) : await Promise.all(media.map((m) => resolveMediaUrl(m.fileUrl)))");
    expect(p).toContain("opts: { urlTho?: boolean } = {}");
    const dung: string[] = [];
    for (const f of ["lib/mobile-api/dich-vu/anh-buoi-hoc.ts"]) if (/urlTho:\s*true/.test(doc(f))) dung.push(f);
    expect(dung).toEqual(["lib/mobile-api/dich-vu/anh-buoi-hoc.ts"]);
    expect(doc("app/(portal)/portal/hinh-anh/page.tsx")).not.toMatch(/urlTho/); // trang web không bao giờ bật
  });
});
