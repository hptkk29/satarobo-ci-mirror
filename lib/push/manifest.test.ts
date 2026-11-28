// `public/manifest.json` — điều kiện để nhân viên iPhone "Thêm vào màn hình chính".
//
// Toàn bộ phạm vi của module Web Push đứng trên một giả định: nhân viên iOS CÀI ĐƯỢC web app.
// Safari chỉ giao push cho web app đã ở màn hình chính, và chỉ coi là cài được khi có manifest
// hợp lệ với `display: standalone`. Nên một dấu phẩy sai trong file này không phải lỗi nhỏ —
// nó làm toàn bộ nhánh iOS im lặng mà không có triệu chứng nào ở phía server.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { isInfraPath } from "@/lib/auth/route-policy";

const goc = process.cwd();
const DUONG_MANIFEST = "/manifest.json";

function docManifest(): Record<string, unknown> {
  const raw = readFileSync(resolve(goc, "public/manifest.json"), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("[PUSH-MANIFEST-T01] manifest hợp lệ và đủ điều kiện cài", () => {
  it("là JSON đọc được", () => {
    expect(() => docManifest()).not.toThrow();
  });

  it("display = standalone — điều kiện iOS mới cho Web Push", () => {
    expect(docManifest().display).toBe("standalone");
  });

  it("có đủ name, short_name, start_url, scope", () => {
    const m = docManifest();
    for (const k of ["name", "short_name", "start_url", "scope"]) {
      expect(String(m[k] ?? "")).not.toBe("");
    }
  });

  it("có ít nhất một icon", () => {
    const icons = docManifest().icons;
    expect(Array.isArray(icons)).toBe(true);
    expect((icons as unknown[]).length).toBeGreaterThan(0);
  });
});

describe("[PUSH-MANIFEST-T02] icon KHAI ĐÚNG kích thước thật của file", () => {
  it("mọi icon tồn tại trên đĩa và `sizes` khớp header PNG", () => {
    // Khai 512x512 cho một file 500x500 là lời nói dối im lặng: trình duyệt vẫn tải, chỉ là
    // biểu tượng trên màn hình chính bị co méo, và không có cảnh báo nào ở đâu. Test này đọc
    // thẳng IHDR của PNG (offset 16) nên nó so với BYTE THẬT, không so với ý định.
    const icons = docManifest().icons as { src: string; sizes: string; type?: string }[];
    for (const ic of icons) {
      const duong = resolve(goc, "public", ic.src.replace(/^\//, ""));
      expect(existsSync(duong), `thiếu file ${ic.src}`).toBe(true);

      const b = readFileSync(duong);
      expect(b.slice(1, 4).toString("ascii"), `${ic.src} không phải PNG`).toBe("PNG");
      const rong = b.readUInt32BE(16);
      const cao = b.readUInt32BE(20);
      expect(ic.sizes, `${ic.src} khai sai kích thước`).toBe(`${rong}x${cao}`);
    }
  });

  it("icon mà service worker dùng cũng phải tồn tại", () => {
    // `sw.js` chạy ngoài bundler nên đường dẫn icon là chuỗi trần — gõ sai thì thông báo hiện
    // ra không có biểu tượng, và không lỗi nào được ghi ở đâu cả.
    const sw = readFileSync(resolve(goc, "public/sw.js"), "utf8");
    const duongIcon = [...sw.matchAll(/["'](\/icons\/[^"']+)["']/g)].map((m) => m[1]);
    expect(duongIcon.length).toBeGreaterThan(0);
    for (const d of new Set(duongIcon)) {
      expect(existsSync(resolve(goc, "public", d!.replace(/^\//, ""))), `thiếu ${d}`).toBe(true);
    }
  });
});

describe("[PUSH-MANIFEST-T03] đường phục vụ manifest KHÔNG bị middleware nuốt", () => {
  it("`/manifest.json` nằm trong isInfraPath", () => {
    // Đây là cái bẫy đã suýt dính: nhánh admin của `decideRoute` mở đúng chuỗi `/manifest.json`
    // (`route-policy.ts`), và matcher của `proxy.ts` KHÔNG loại đuôi `.json` — nên nếu đường
    // manifest không nằm trong `isInfraPath` thì request nặc danh mà trình duyệt dùng để lấy
    // manifest sẽ rơi vào luật host×role. Không lỗi, không log: web app chỉ đơn giản không cài
    // được, và cả nhánh iOS chết câm.
    expect(isInfraPath(DUONG_MANIFEST)).toBe(true);
  });

  it("`/manifest.webmanifest` KHÔNG nằm trong isInfraPath — vì thế không được dùng app/manifest.ts", () => {
    // Khoá lại lý do của quyết định: file quy ước `app/manifest.ts` của Next phát ra đường này.
    // Nếu một ngày nào đó `isInfraPath` mở luôn `.webmanifest` thì test này đỏ, và người sửa
    // phải đọc lại đoạn chú thích ở `app/(admin)/admin/layout.tsx` trước khi đổi cách phục vụ.
    expect(isInfraPath("/manifest.webmanifest")).toBe(false);
  });

  it("layout admin trỏ tới ĐÚNG đường tĩnh, không phải .webmanifest", () => {
    const src = readFileSync(resolve(goc, "app/(admin)/admin/layout.tsx"), "utf8");
    expect(src).toContain(`manifest: "${DUONG_MANIFEST}"`);
    expect(src).not.toContain("manifest.webmanifest\"");
  });

  it("`/sw.js` được matcher của proxy loại khỏi middleware", () => {
    // Service worker phải tải được ở mọi trạng thái đăng nhập. Matcher loại theo ĐUÔI FILE;
    // test này khoá việc `js` còn nằm trong danh sách loại đó.
    const proxy = readFileSync(resolve(goc, "proxy.ts"), "utf8");
    const m = proxy.match(/matcher:\s*\[\s*"([^"]+)"/);
    expect(m, "không tìm thấy matcher trong proxy.ts").not.toBeNull();
    const re = new RegExp(m![1].replace(/\\\\/g, "\\"));
    expect(re.test("/sw.js"), "/sw.js KHÔNG được loại khỏi middleware").toBe(false);
    // Đối chứng: một đường trang bình thường thì PHẢI qua middleware.
    expect(re.test("/leads/abc")).toBe(true);
  });
});
