// @vitest-environment jsdom
/**
 * [NHH-KY-ST-*] — BỐN TRẠNG THÁI của tab Kỳ (DESIGN.md §5): đang tải · rỗng · lỗi · không có quyền. Bộ này canh phần ĐANG TẢI trên phần tử thật và ghim ba phần còn lại ở chỗ chúng sống.
 *
 * Khung chờ phải ĐÚNG HÌNH màn thật: bảng 10 cột (bằng `<th>` của BangKy — doc 06 ghi 10 từ lâu nhưng mã từng để 8) từ xl; dưới xl là danh sách thẻ (BangKy dưới xl không còn là bảng),
 * nên khung chờ dưới xl cũng là thẻ — khung bảng 10 cột nhấp nháy rồi nhảy sang thẻ là hai hình khác nhau.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Loading from "./loading";

afterEach(cleanup);
const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const KY = "app/(admin)/admin/nguon-hoa-hong/ky";

describe("[NHH-KY-ST-01] đang tải", () => {
  it("khung có role=status + aria-busy + nhãn tiếng Việt; bảng chờ có ĐÚNG số cột của BangKy (từ xl) và danh sách thẻ chờ dành cho dưới xl", () => {
    const { container } = render(<Loading />);
    const vo = screen.getAllByRole("status")[0]!;
    expect(vo.getAttribute("aria-busy")).toBe("true");
    expect(vo.getAttribute("aria-label")).toBe("Đang tải kỳ hoa hồng…");

    const soCotBang = (doc(`${KY}/_components/bang-ky.tsx`).match(/<th scope="col"/g) ?? []).length;
    expect(soCotBang).toBe(10);
    const bang = container.querySelector('[class~="hidden"][class~="xl:block"]')!;
    expect(bang, "khung chờ dạng bảng chỉ hiện từ xl").not.toBeNull();
    // hàng tiêu đề của BangSkeleton: một Skeleton mỗi cột
    expect(bang.querySelector('[role="status"]')!.firstElementChild!.children).toHaveLength(soCotBang);
    const the = container.querySelector('[data-khung-the][class~="xl:hidden"]')!;
    expect(the, "khung chờ dạng thẻ chỉ hiện dưới xl").not.toBeNull();
    expect(the.children.length).toBeGreaterThanOrEqual(4);
  });
});

describe("[NHH-KY-ST-02] ba trạng thái còn lại sống ở đúng chỗ (ghim mã nguồn, đã bỏ chú thích)", () => {
  const ma = (s: string) => s.split("\n").filter((d) => !d.trimStart().startsWith("//")).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
  const page = ma(doc(`${KY}/page.tsx`));

  it("không có quyền: trang trả `ThieuQuyen` ngay khi thiếu cổng PAGE_GATES — TRƯỚC mọi truy vấn", () => {
    expect((page.match(/<ThieuQuyen tab="ky"/g) ?? []).length).toBe(1);
    expect(page.indexOf("<ThieuQuyen tab=\"ky\"")).toBeLessThan(page.indexOf("docKyCutover()"));
  });

  it("rỗng: ba EmptyState có chữ riêng (chưa có mốc · chưa thấy cơ sở · kỳ chưa mở) — không màn trắng", () => {
    for (const t of ["Hoa hồng theo kỳ mới chưa bắt đầu", "Chưa thấy cơ sở nào", "chưa được mở"]) expect(page, t).toContain(t);
  });

  it("lỗi: ranh giới lỗi ở GỐC module (phủ cả tab Kỳ) là client component dùng RouteError; tab Kỳ không có error.tsx riêng thừa", () => {
    const loi = doc("app/(admin)/admin/nguon-hoa-hong/error.tsx");
    expect(loi).toMatch(/^\s*["']use client["']/m);
    expect(loi).toContain("RouteError");
  });
});
