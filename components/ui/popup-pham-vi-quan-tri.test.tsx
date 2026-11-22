// @vitest-environment jsdom
/**
 * [HDUI-S*] — phạm vi `admin-scope` cho hộp nổi render qua PORTAL ra `<body>` (R1 của audit 05).
 *
 * BỐI CẢNH. Token admin (`--primary` tím…) chỉ có BÊN TRONG `.admin-scope`; hộp nổi portal ra ngoài khung đó nên
 * `bg-primary` rơi về CAM của `:root`. Bản S5a đầu tiên gắn hook `useLopPhamViPortal` vào CẢ Dialog/Sheet/Tooltip/Popover
 * ⇒ đổi cam→tím ở ~82 trang admin. Đó là thay đổi giao diện TOÀN ADMIN, ngoài phạm vi Invoice Hub, nên đã được GỠ khỏi
 * Dialog/Sheet/Tooltip (commit cô lập riêng) và chờ owner duyệt. Hook chỉ còn ở `Popover` — component MỚI, chỉ khu Hoá đơn dùng.
 *
 * Khoá ba điều:
 *   · S1 — KHÔNG có `.admin-scope` trong trang: không popup nào mang class ấy (site public/portal/GV không đổi).
 *   · S2 — CÓ khung `.admin-scope`: CHỈ Popover tự mang; Dialog/Sheet/Tooltip KHÔNG (bằng chứng "không đổi màu admin hàng loạt").
 *   · S3 — danh sách tệp UI có Portal mà KHÔNG gọi hook là MỘT QUYẾT ĐỊNH CÓ TÊN (CHO_OWNER_DUYET), không phải sót.
 *
 * Muốn áp bản sửa toàn cục: owner duyệt rồi hoàn tác commit gỡ (lịch sử còn nguyên ở `ca1472971`), và đảo S2/S3 ở file này.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

import { Dialog, DialogContent, DialogTitle } from "./dialog";
import { Sheet, SheetContent, SheetTitle } from "./sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

/** Dựng cả bốn hộp ĐANG MỞ trong cùng một cây, trả các phần tử popup theo `data-slot`. */
function dungBonHop() {
  render(
    <TooltipProvider>
      <Dialog open>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Hộp thoại</DialogTitle>
        </DialogContent>
      </Dialog>
      <Sheet open>
        <SheetContent>
          <SheetTitle>Ngăn</SheetTitle>
        </SheetContent>
      </Sheet>
      <Tooltip open>
        <TooltipTrigger>nút</TooltipTrigger>
        <TooltipContent>Gợi ý</TooltipContent>
      </Tooltip>
      <Popover open>
        <PopoverTrigger>mở</PopoverTrigger>
        <PopoverContent>Nội dung</PopoverContent>
      </Popover>
    </TooltipProvider>,
  );
  const lay = (slot: string) => document.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
  return {
    dialog: lay("dialog-content"),
    sheet: lay("sheet-content"),
    tooltip: lay("tooltip-content"),
    popover: lay("popover-content"),
  };
}

describe("[HDUI-S1] không có .admin-scope trong trang ⇒ popup KHÔNG mang admin-scope (site khác giữ nguyên)", () => {
  it("cả bốn popup đều có mặt và không có class admin-scope", () => {
    const hop = dungBonHop();
    for (const [ten, el] of Object.entries(hop)) {
      expect(el, `${ten} phải render`).not.toBeNull();
      expect(el!.classList.contains("admin-scope"), `${ten} không được mang admin-scope`).toBe(false);
    }
  });
});

describe("[HDUI-S2] có khung .admin-scope ⇒ CHỈ Popover (mới, của Hoá đơn) mang admin-scope; primitive dùng chung KHÔNG đổi", () => {
  function dungTrongKhungAdmin() {
    const khung = document.createElement("div");
    khung.className = "admin-scope";
    document.body.appendChild(khung);
    return { khung, hop: dungBonHop() };
  }

  it("Popover mang admin-scope dù portal ra body (nằm ngoài khung)", () => {
    const { khung, hop } = dungTrongKhungAdmin();
    expect(hop.popover, "popover phải render").not.toBeNull();
    expect(hop.popover!.classList.contains("admin-scope")).toBe(true);
    expect(khung.contains(hop.popover!), "popover nằm ngoài khung admin").toBe(false);
  });

  it("Dialog · Sheet · Tooltip KHÔNG tự thêm admin-scope — hành vi cũ của ~82 trang admin giữ nguyên", () => {
    const { hop } = dungTrongKhungAdmin();
    for (const ten of ["dialog", "sheet", "tooltip"] as const) {
      expect(hop[ten], `${ten} phải render`).not.toBeNull();
      expect(hop[ten]!.classList.contains("admin-scope"), `${ten} không được tự mang admin-scope`).toBe(false);
    }
  });

  it("Dialog vẫn giữ class do chỗ gọi truyền (chỗ gọi tự gắn admin-scope như trước vẫn hoạt động)", () => {
    const khung = document.createElement("div");
    khung.className = "admin-scope";
    document.body.appendChild(khung);
    render(
      <Dialog open>
        <DialogContent showCloseButton={false} className="admin-scope sata-test-lop">
          <DialogTitle>x</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const el = document.querySelector<HTMLElement>('[data-slot="dialog-content"]')!;
    expect(el.classList.contains("sata-test-lop")).toBe(true);
    expect(el.classList.contains("admin-scope")).toBe(true);
  });
});

// ─── [HDUI-S3] lưới ghim: tệp UI có Portal mà không gọi hook phải nằm trong danh sách quyết định có tên ───────────────

const UI_DIR = path.join(process.cwd(), "components", "ui");

/** Bỏ chú thích để câu giải thích bản vá không tự làm lưới xanh/đỏ oan (luật 11). */
function boChuThich(x: string): string {
  return x
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

/** THUẦN — tệp có dựng Portal (`<XxxPrimitive.Portal`)? */
export function coPortal(src: string): boolean {
  return /<[A-Za-z]+\.Portal\b/.test(boChuThich(src));
}

/** THUẦN — tệp có GỌI hook phạm vi (không chỉ import)? Neo vào lời gọi `useLopPhamViPortal(`. */
export function goiHookPhamVi(src: string): boolean {
  return /\buseLopPhamViPortal\s*\(/.test(boChuThich(src));
}

/**
 * Tệp có Portal mà CỐ Ý chưa phủ phạm vi admin, vì phủ là đổi giao diện diện rộng (nút `bg-primary`, list của
 * dropdown/select/combobox trên ~82 trang admin) — CHỜ OWNER DUYỆT. Đây là QUYẾT ĐỊNH, không phải sót:
 * thêm tệp mới vào danh sách này phải kèm lý do; tệp Portal mới của khu Hoá đơn thì gọi hook.
 */
const CHO_OWNER_DUYET = ["combobox.tsx", "dialog.tsx", "dropdown-menu.tsx", "select.tsx", "sheet.tsx", "tooltip.tsx"];

describe("[HDUI-S3] tệp components/ui có Portal: hoặc gọi hook phạm vi, hoặc nằm trong danh sách CHO_OWNER_DUYET", () => {
  const tep = fs.readdirSync(UI_DIR).filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"));

  it("quét thật thấy cả bảy tệp có Portal (chống lưới rỗng)", () => {
    const co = tep.filter((f) => coPortal(fs.readFileSync(path.join(UI_DIR, f), "utf8"))).sort();
    expect(co).toEqual(
      ["combobox.tsx", "dialog.tsx", "dropdown-menu.tsx", "popover.tsx", "select.tsx", "sheet.tsx", "tooltip.tsx"].sort(),
    );
  });

  it("tệp có Portal mà không trong CHO_OWNER_DUYET thì phải GỌI hook (popover.tsx)", () => {
    const thieu = tep.filter((f) => {
      const src = fs.readFileSync(path.join(UI_DIR, f), "utf8");
      return coPortal(src) && !CHO_OWNER_DUYET.includes(f) && !goiHookPhamVi(src);
    });
    expect(thieu).toEqual([]);
    expect(goiHookPhamVi(fs.readFileSync(path.join(UI_DIR, "popover.tsx"), "utf8"))).toBe(true);
  });

  it("tệp trong CHO_OWNER_DUYET thực sự KHÔNG gọi hook — ai gắn lại là đổi màu toàn admin mà chưa được duyệt", () => {
    const daPhu = CHO_OWNER_DUYET.filter((f) => goiHookPhamVi(fs.readFileSync(path.join(UI_DIR, f), "utf8")));
    expect(daPhu).toEqual([]);
  });

  it("bộ so khớp: chuỗi thuần có Portal / có lời gọi hook nhưng chỉ import thì KHÔNG tính", () => {
    expect(coPortal("<DialogPrimitive.Portal data-slot='x' />")).toBe(true);
    expect(coPortal("// <DialogPrimitive.Portal>\nconst a = 1")).toBe(false);
    expect(goiHookPhamVi('import { useLopPhamViPortal } from "./x"\nconst a = 1')).toBe(false);
    expect(goiHookPhamVi("const lop = useLopPhamViPortal()")).toBe(true);
    expect(goiHookPhamVi("// useLopPhamViPortal()\n")).toBe(false);
  });
});
