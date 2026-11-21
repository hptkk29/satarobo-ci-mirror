// components/portal/v2-shell-header.test.ts — L6/L7 (nghiệm thu bảo lưu vòng 2): thanh trên cổng phụ huynh KHÔNG được rộng hơn màn hình khi tên dài.
//
// Đo ở NT-L: tên "NT-BL Phụ huynh 2 bé" (21 ký tự) ⇒ scrollWidth 434/375 trên MỌI trang cổng; tên ngắn ⇒ 375/375. Cùng cấu trúc class dựng lại trong Chromium ở 375px:
// trước bản vá 426/375, sau bản vá 375/375 (số đo lúc vá). jsdom không có bố cục nên test này GHIM các class quyết định (luật 11: neo hẹp, đếm số lần) —
// kiểm bố cục thật là việc của lượt đo 375px trên test sau deploy.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ma = readFileSync(resolve(process.cwd(), "components/portal/v2-shell.tsx"), "utf8")
  .split("\n")
  .filter((d) => !d.trimStart().startsWith("//"))
  .join("\n");

describe("[L6] thanh trên cổng PH co lại được khi tên dài", () => {
  it("[L6-01] chip tên (ProfileSwitcher): nút có `min-w-0`, khối chữ có `min-w-0`, tên vẫn `truncate`", () => {
    const nut = ma.match(/"flex min-w-0 items-center gap-2\.5 rounded-xl border px-3 py-1\.5/g) ?? [];
    expect(nut).toHaveLength(1);
    expect(ma.match(/<span className="flex min-w-0 flex-col items-start leading-tight">/g) ?? []).toHaveLength(1);
    expect(ma).toMatch(/max-w-\[12rem\] truncate text-sm font-bold/);
  });

  it("[L6-02] cụm bên phải (đổi giao diện · chuông · tài khoản) KHÔNG co: `shrink-0`", () => {
    expect(ma.match(/<div className="ml-auto flex shrink-0 items-center gap-2">/g) ?? []).toHaveLength(1);
  });
});
