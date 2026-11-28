// @vitest-environment jsdom
/**
 * [HVK-*] — màn «Cho con vào Cổng học sinh» (vỏ PHỤ HUYNH, không phải vỏ học sinh) — 04/11/2026:
 *   [HVK-01] các khối xếp dọc CÓ khoảng cách + cùng khuôn với «Học phí» (cột 1160px, gap 24px) — lỗi cũ: các khối dính sát nhau
 *   [HVK-02] hai khung «… sẽ thấy / sẽ không thấy» đã BỎ; không còn đánh số bước; thẻ hành động gom con đang chọn · mã thoát · nút vào
 *   [HVK-03] «Mã thoát» (cùng vỏ) cũng bọc cùng khuôn
 *   [HVK-04] hai màn của BA MẸ dưới /portal/hoc-sinh dùng vỏ PHỤ HUYNH (không phải vỏ học sinh cũ)
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/portal/hoc-sinh/vao",
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));
vi.mock("sonner", () => ({ toast: { success: () => undefined, error: () => undefined } }));
vi.mock("@/app/(portal)/portal/hoc-sinh/actions", () => ({
  taoMaThoatAction: async () => ({ ok: true }),
  vaoCheDoHocSinhAction: async () => ({ ok: true }),
}));

import { HvVaoTrang } from "@/components/portal/hv-vao";
import { NHANH_BA_ME_TRONG_HOC_SINH, laManBaMeTrongHocSinh } from "@/lib/portal/hv-dieu-huong";

afterEach(cleanup);

const con = [{ id: "c1", ten: "Hồ Hữu Huy", tat: "HH", mauAv: 0 as const, khoa: "Sata3", lop: "CS1.SATA3.01", xong: 34, tong: 48, viec: "buổi tới T3" }];
const dung = (coMa = true) => render(<HvVaoTrang con={con} macDinhId="c1" coMa={coMa} namSinhCon={[2016]} namNay={2026} />);

describe("[HVK-01] khoảng cách giữa các khối", () => {
  it("gốc của màn là cột dọc có gap-6, tối đa 1160px, căn giữa (như «Học phí») và chứa đủ các khối", () => {
    const { container } = dung(false);
    const goc = container.firstElementChild as HTMLElement;
    expect(goc.className).toMatch(/\bmx-auto\b/);
    expect(goc.className).toMatch(/max-w-\[1160px\]/);
    expect(goc.className).toMatch(/\bflex-col\b/);
    expect(goc.className).toMatch(/\bgap-6\b/);
    // đối chứng: các khối nằm TRỰC TIẾP dưới gốc đó (đầu trang · chọn con · tạo mã thoát · thẻ hành động)
    expect(goc.querySelector(":scope > header")).not.toBeNull();
    expect(goc.querySelectorAll(":scope > section")).toHaveLength(3);
    expect(screen.getByText("Con nào sẽ học?")).toBeTruthy();
  });
});

describe("[HVK-02] hai khung «sẽ thấy / sẽ không thấy» đã bỏ", () => {
  it("không còn khung nào, không còn câu liệt kê dữ liệu con thấy/không thấy", () => {
    dung(true);
    const chu = document.body.textContent ?? "";
    expect(chu).not.toMatch(/sẽ thấy|sẽ không thấy/);
    expect(chu).not.toMatch(/Học phí, phiếu thu|Tin nhắn giữa ba mẹ|Buổi học tiếp theo, lịch học/);
    // đối chứng: phần còn lại của màn vẫn đủ (chọn con · trạng thái mã thoát · nút vào)
    expect(screen.getByText("Con nào sẽ học?")).toBeTruthy();
    expect(screen.getByText("Đã có mã thoát")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Đổi hoặc quên mã" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Vào Cổng học sinh của/ })).toBeTruthy();
  });
  it("không còn đánh số bước («1.», «2.», «3.») ở bất kỳ trạng thái nào", () => {
    for (const coMa of [true, false]) {
      dung(coMa);
      expect(document.body.textContent ?? "", String(coMa)).not.toMatch(/(^|\s)[123]\. /);
      cleanup();
    }
  });
  it("chưa có mã thoát ⇒ khối tạo mã hiện, nút vào khoá và nói phải tạo mã; có mã ⇒ nút vào mở", () => {
    dung(false);
    expect(screen.getByText("Tạo mã thoát 4 số")).toBeTruthy();
    expect(screen.getByText(/Tạo mã thoát ở trên để mở nút này/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Vào Cổng học sinh của/ }).getAttribute("aria-disabled")).toBe("true");
    cleanup();
    dung(true);
    expect(screen.queryByText("Tạo mã thoát 4 số")).toBeNull();
    expect(screen.getByRole("button", { name: /Vào Cổng học sinh của/ }).getAttribute("aria-disabled")).toBe("false");
  });
});

describe("[HVK-03] màn Mã thoát cùng vỏ", () => {
  it("gốc của HvMaTrang cũng là cột 1160px gap-6 căn giữa (đọc nguồn — màn này cần nhiều mock để dựng)", () => {
    const s = readFileSync(resolve(process.cwd(), "components/portal/hv-ma.tsx"), "utf8");
    expect(s).toMatch(/return \(\s*(?:\/\/[^\n]*\n\s*)*<div className="mx-auto flex w-full max-w-\[1160px\] flex-col gap-6">\s*<HvDauTrang/);
  });
});

describe("[HVK-04] vỏ cho hai màn của ba mẹ dưới /portal/hoc-sinh", () => {
  it("nhận đúng /vao và /ma (cả khi host hocvien.* bỏ tiền tố /portal); các trang học sinh khác KHÔNG", () => {
    for (const p of ["/portal/hoc-sinh/vao", "/portal/hoc-sinh/ma", "/portal/hoc-sinh/ma/", "/hoc-sinh/vao", "/portal/hoc-sinh/vao?x=1", "/portal/hoc-sinh/ma/quen"]) {
      expect(laManBaMeTrongHocSinh(p), p).toBe(true);
    }
    for (const p of ["/portal", "/portal/hoc-sinh", "/portal/hoc-sinh/lich", "/portal/hoc-sinh/thoat", "/portal/hoc-sinh/vao-x", "/portal/hoc-sinh/mat-khau", "/portal/vao"]) {
      expect(laManBaMeTrongHocSinh(p), p).toBe(false);
    }
  });
  it("danh sách khớp thư mục app/(portal)/portal/hoc-sinh/(ba-me)/ — thêm màn mới vào nhóm đó mà quên khai ⇒ đỏ", () => {
    const thuMuc = readdirSync(resolve(process.cwd(), "app/(portal)/portal/hoc-sinh/(ba-me)"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `/portal/hoc-sinh/${d.name}`)
      .sort();
    expect([...NHANH_BA_ME_TRONG_HOC_SINH].sort()).toEqual(thuMuc);
  });
  it("PortalV2Shell dùng đúng hàm này để quyết định vỏ học sinh (đọc nguồn — neo vào lời gọi)", () => {
    const s = readFileSync(resolve(process.cwd(), "components/portal/v2-shell.tsx"), "utf8");
    expect(s).toMatch(/&&\s*!laManBaMeTrongHocSinh\(norm\)/);
  });
});
