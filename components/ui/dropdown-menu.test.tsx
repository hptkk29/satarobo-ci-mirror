// @vitest-environment jsdom
/**
 * Hợp đồng của `DropdownMenuLabel` — cái bẫy đã làm crash tab prod ngày 10/07.
 *
 * `DropdownMenuLabel` map thẳng sang `Menu.GroupLabel` của @base-ui/react. Part đó gọi
 * `useMenuGroupRootContext()`, và context ném lỗi khi KHÔNG có `<Menu.Group>` bọc ngoài:
 *   "Base UI: MenuGroupRootContext is missing. Menu group parts must be used within <Menu.Group>."
 *
 * Ở dev thấy nguyên câu đó; ở prod lỗi bị minify thành `formatErrorMessage(31)` và người
 * dùng chỉ thấy "This page couldn't load" — RoleSwitcher (#13) dính đúng vậy: bấm mở
 * dropdown là mất trang. Menu tài khoản ở topbar không dùng Label nên vẫn chạy, khiến
 * lỗi trông như "ngẫu nhiên".
 *
 * Hai test dưới đây khoá cả hai đầu: hành vi của thư viện, và cách repo dùng nó.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

afterEach(cleanup);

describe("DropdownMenuLabel — bắt buộc nằm trong DropdownMenuGroup", () => {
  it("KHÔNG có Group ⇒ throw (đây chính là crash prod, không phải giả thuyết)", () => {
    // base-ui log lỗi qua console.error trước khi ném — im nó đi cho output sạch.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <DropdownMenu open>
          <DropdownMenuTrigger>mở</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Chuyển vai trò</DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>,
      ),
    ).toThrowError(/MenuGroupRootContext|Menu\.Group|formatErrorMessage|\b31\b/);
    spy.mockRestore();
  });

  it("CÓ Group ⇒ render bình thường, label hiện ra", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>mở</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Chuyển vai trò</DropdownMenuLabel>
            <DropdownMenuItem>Mọi vai trò (gộp)</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText("Chuyển vai trò")).toBeDefined();
    expect(screen.getByText("Mọi vai trò (gộp)")).toBeDefined();
  });
});

describe("Quét tĩnh — không file nào dùng DropdownMenuLabel mà quên Group", () => {
  const ROOT = process.cwd();

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of fs.readdirSync(dir)) {
      if (name === "node_modules" || name === ".next") continue;
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith(".tsx")) out.push(p);
    }
    return out;
  }

  // Timeout riêng: đây là QUÉT ĐĨA (đọc mọi .tsx của app/ + components/), không phải test
  // logic. Trên Windows nó chạm ~4,3s khi cả bộ test chạy song song — tức mặc định 5s là
  // ĐANG SÁT MÉP, và mỗi file .tsx thêm vào repo lại đẩy gần hơn. Đỏ vì hết giờ ở một
  // test quét tĩnh đọc y hệt "code vi phạm", nên nâng trần thay vì để nó thỉnh thoảng đỏ.
  it("mọi <DropdownMenuLabel> đều có <DropdownMenuGroup> trong cùng file", { timeout: 30_000 }, () => {
    const viPham: string[] = [];
    for (const f of [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components"))]) {
      if (f.endsWith("dropdown-menu.tsx") || f.endsWith("dropdown-menu.test.tsx")) continue;
      const src = fs.readFileSync(f, "utf8");
      if (src.includes("<DropdownMenuLabel") && !src.includes("<DropdownMenuGroup")) {
        viPham.push(path.relative(ROOT, f));
      }
    }
    expect(viPham, `File dùng DropdownMenuLabel mà thiếu DropdownMenuGroup:\n  ${viPham.join("\n  ")}`).toEqual([]);
  });
});
