// @vitest-environment jsdom
/**
 * [NHH-FE-01] · [NHH-FE-09] · [NHH-FE-06] — khung module trên PHẦN TỬ THẬT (ModuleNav, ScopeBar, QueueToggle).
 *
 * Mỗi ca "KHÔNG thấy X" đi kèm đối chứng dương "vai kia THẤY X" (CLAUDE.md luật 11): ca chỉ khẳng định SỰ VẮNG MẶT
 * luôn ĐẠT khi tính năng hỏng hoàn toàn.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ADMIN_ROUTE_SEGMENTS } from "@/lib/auth/route-policy";
import { dungNguonHoaHongScope, type ModuleKey, type NguonHoaHongScope } from "@/lib/nguon-hoa-hong/scope";
import { TAB_HREF, TAB_KEYS, cacKeyCuaTab } from "@/lib/nguon-hoa-hong/tab";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// HelpHint là client component bọc Tooltip của base-ui — ở đây chỉ cần nút "?" có mặt, không cần tooltip chạy.
vi.mock("@/components/admin/ui/help-hint", () => ({
  HelpHint: ({ label }: { label?: string }) => <button type="button" aria-label={label ?? "Xem hướng dẫn"} />,
}));

import { ThieuQuyen } from "./khung-module";
import { BangSkeleton, KhungSkeleton } from "./skeletons";
import { HangChoRong } from "./hang-cho-rong";
import { ModuleNav } from "./module-nav";
import { QueueToggle, docCheDoXem } from "./queue-toggle";
import { dinhDangTran, ScopeBar } from "./scope-bar";

afterEach(cleanup);

const CS1 = { id: "cs1", code: "CS1", name: "Trụ sở chính - Nguyễn Hữu Thọ" };
const CS2 = { id: "cs2", code: "CS2", name: "114 Hoàng Diệu" };

function scopeCua(quyen: ModuleKey[], co: { nguon: boolean; engine: boolean }, thay: "ALL" | string[] = "ALL"): NguonHoaHongScope {
  return dungNguonHoaHongScope({
    quyen: new Set(quyen),
    co,
    centerIds: { Lead: thay, CommissionPeriod: thay, CommissionTransaction: thay },
    cacCoSo: [CS1, CS2],
  });
}

const link = (ten: string | RegExp) => screen.queryByRole("link", { name: ten });

describe("[NHH-FE-01] ModuleNav — năm tab, href literal, có lối vào", () => {
  it("danh sách href trong module-nav.tsx KHỚP TAB_HREF của lib (lệch là một tab thành mồ côi)", () => {
    const nguon = readFileSync(resolve(process.cwd(), "components/admin/nguon-hoa-hong/module-nav.tsx"), "utf8");
    const khai = [...nguon.matchAll(/key:\s*"([a-z-]+)",\s*label:\s*"[^"]+",\s*href:\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]);
    expect(khai.map((k) => k[0])).toEqual([...TAB_KEYS]);
    for (const [key, href] of khai) expect(href, `tab ${key}`).toBe(TAB_HREF[key as keyof typeof TAB_HREF]);
  });

  it("segment đầu của mọi tab nằm trong ADMIN_ROUTE_SEGMENTS (thiếu là proxy đá vòng)", () => {
    for (const href of Object.values(TAB_HREF)) {
      expect(ADMIN_ROUTE_SEGMENTS.has(href.split("/")[1]!), href).toBe(true);
    }
  });

  it("đủ quyền + cả hai cờ ⇒ thấy ĐỦ năm tab, đúng địa chỉ", () => {
    render(
      <ModuleNav
        active="nguon"
        scope={scopeCua(
          ["sources:view", "commission_policies:view", "commission:view-center", "commission_periods:manage", "commission_disputes:review"],
          { nguon: true, engine: true },
        )}
        soHangCho={{}}
      />,
    );
    for (const k of TAB_KEYS) {
      const el = document.querySelector(`a[href="${TAB_HREF[k]}"]`);
      expect(el, `thiếu tab ${k}`).not.toBeNull();
    }
    expect(screen.getAllByRole("link")).toHaveLength(5);
    expect(screen.getByRole("link", { name: "Nguồn" }).getAttribute("aria-current")).toBe("page");
    // CHỈ MỘT tab được đánh dấu — mọi tab cùng 'page' thì trình đọc màn hình không biết đang ở đâu (đợt cấy 08/10, C32)
    expect(document.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
    cleanup();
    render(
      <ModuleNav
        active="so"
        scope={scopeCua(["sources:view", "commission:view-self"], { nguon: true, engine: true })}
        soHangCho={{}}
      />,
    );
    expect(screen.getByRole("link", { name: "Sổ hoa hồng" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Nguồn" }).getAttribute("aria-current")).toBeNull();
  });

  it("pilot nguồn (engine tắt): Marketing chỉ thấy tab Nguồn; đối chứng dương: engine bật ⇒ thấy cả Chính sách", () => {
    const q: ModuleKey[] = ["sources:view", "commission_policies:view", "commission:view-self"];
    render(<ModuleNav active="nguon" scope={scopeCua(q, { nguon: true, engine: false })} soHangCho={{}} />);
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/nguon-hoa-hong/nguon"]);
    cleanup();
    render(<ModuleNav active="nguon" scope={scopeCua(q, { nguon: true, engine: true })} soHangCho={{}} />);
    expect(link("Chính sách")).not.toBeNull();
  });

  it("không tab nào mở được ⇒ KHÔNG vẽ gì (không bày thanh tab rỗng)", () => {
    const { container } = render(<ModuleNav active="nguon" scope={scopeCua([], { nguon: true, engine: true })} soHangCho={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it("pill hàng chờ: có số > 0 thì hiện kèm chữ cho trình đọc; bằng 0 hoặc không truyền thì KHÔNG hiện (không in '0')", () => {
    const scope = scopeCua(["sources:view"], { nguon: true, engine: false });
    render(<ModuleNav active="nguon" scope={scope} soHangCho={{ nguon: 12 }} />);
    const tab = screen.getByRole("link", { name: /Nguồn/ });
    expect(within(tab).getByText("12")).toBeTruthy();
    expect(tab.textContent).toContain("việc cần xử lý");
    cleanup();
    render(<ModuleNav active="nguon" scope={scope} soHangCho={{ nguon: 0 }} />);
    expect(screen.getByRole("link", { name: "Nguồn" }).textContent).toBe("Nguồn");
    cleanup();
    render(<ModuleNav active="nguon" scope={scope} soHangCho={{}} />);
    expect(screen.getByRole("link", { name: "Nguồn" }).textContent).toBe("Nguồn");
  });
});

describe("[NHH-FE-09] ScopeBar — chip cơ sở trên phần tử thật", () => {
  const chipTu = (s: NguonHoaHongScope) => s.coSoCua("Lead");

  it("QLCS CS1 (tầm nhìn [CS1]): chip CS2 KHÔNG có trên DOM; ĐỐI CHỨNG DƯƠNG: Kế toán HO thấy cả CS1 lẫn CS2", () => {
    const qlcs = scopeCua(["sources:view"], { nguon: true, engine: false }, ["cs1"]);
    render(<ScopeBar basePath="/nguon-hoa-hong/nguon" coSo={chipTu(qlcs)} dangChon={null} tatCaNhan="Tất cả cơ sở" />);
    expect(link(/CS1/)).not.toBeNull();
    expect(link(/CS2/)).toBeNull();
    expect(link("Tất cả cơ sở")).not.toBeNull();
    cleanup();

    const ho = scopeCua(["sources:view"], { nguon: true, engine: false }, "ALL");
    render(<ScopeBar basePath="/nguon-hoa-hong/nguon" coSo={chipTu(ho)} dangChon={null} tatCaNhan="Tất cả cơ sở" />);
    expect(link(/CS1/)).not.toBeNull();
    expect(link(/CS2/)).not.toBeNull();
  });

  it("chip giữ tham số khác (xem, van-de) nhưng RƠI `trang` (đổi cơ sở là về trang 1) và đánh dấu chip đang chọn", () => {
    const s = scopeCua(["sources:view"], { nguon: true, engine: false });
    render(
      <ScopeBar
        basePath="/nguon-hoa-hong/nguon"
        coSo={chipTu(s)}
        dangChon="cs2"
        tatCaNhan="Tất cả cơ sở"
        giu={{ xem: "tat-ca", "van-de": "UNKNOWN", trang: 4 }}
      />,
    );
    expect(link(/CS1/)!.getAttribute("href")).toBe("/nguon-hoa-hong/nguon?coSo=cs1&xem=tat-ca&van-de=UNKNOWN");
    expect(link(/CS2/)!.getAttribute("aria-current")).toBe("page");
    expect(link("Tất cả cơ sở")!.getAttribute("href")).toBe("/nguon-hoa-hong/nguon?xem=tat-ca&van-de=UNKNOWN");
    // đúng MỘT chip sáng: CS1 và "Tất cả" KHÔNG được đánh dấu khi đang chọn CS2 (đợt cấy 08/10, C33)
    expect(link(/CS1/)!.getAttribute("aria-current")).toBeNull();
    expect(link("Tất cả cơ sở")!.getAttribute("aria-current")).toBeNull();
    expect(document.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
    cleanup();
    // đang ở "Tất cả cơ sở" (dangChon null): chỉ chip Tất cả sáng, mọi chip cơ sở tắt (C34)
    render(<ScopeBar basePath="/nguon-hoa-hong/nguon" coSo={chipTu(s)} dangChon={null} tatCaNhan="Tất cả cơ sở" />);
    expect(link("Tất cả cơ sở")!.getAttribute("aria-current")).toBe("page");
    expect(link(/CS1/)!.getAttribute("aria-current")).toBeNull();
    expect(link(/CS2/)!.getAttribute("aria-current")).toBeNull();
  });

  it("không có cơ sở nào trong tầm nhìn ⇒ nói thẳng, không vẽ chip", () => {
    render(<ScopeBar basePath="/nguon-hoa-hong/nguon" coSo={[]} dangChon={null} />);
    expect(screen.getByText(/chưa thấy cơ sở nào/)).toBeTruthy();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("không truyền `coSo` (tab không theo cơ sở) ⇒ không có chip và không có câu 'chưa thấy cơ sở'", () => {
    render(<ScopeBar basePath="/nguon-hoa-hong/chinh-sach" tran={0.09} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryByText(/chưa thấy cơ sở/)).toBeNull();
  });

  it("trần ĐỌC từ giá trị truyền vào (không hằng 9% trong UI): 0,09 → 9%; 0,085 → 8,5%; không truyền ⇒ không vẽ dòng trần", () => {
    expect(dinhDangTran(0.09)).toBe("9%");
    expect(dinhDangTran(0.085)).toBe("8,5%");
    expect(dinhDangTran(0.1)).toBe("10%");
    render(<ScopeBar basePath="/x" coSo={[]} tran={0.085} />);
    expect(screen.getByText("8,5%")).toBeTruthy();
    cleanup();
    render(<ScopeBar basePath="/x" coSo={[]} />);
    expect(screen.queryByText(/Trần hiện hành/)).toBeNull();
    cleanup();
    // null (đọc setting hỏng) cũng không vẽ — không đoán
    render(<ScopeBar basePath="/x" coSo={[]} tran={null} />);
    expect(screen.queryByText(/Trần hiện hành/)).toBeNull();
  });
});

describe("[NHH-FE-06] QueueToggle — chế độ xem trên URL", () => {
  it("mặc định = Cần xử lý (không tham số); Tất cả = ?xem=tat-ca; giữ cơ sở, rơi van-de/trang", () => {
    render(<QueueToggle basePath="/nguon-hoa-hong/nguon" dangXem="can-xu-ly" soCanXuLy={37} giu={{ coSo: "cs1" }} />);
    const can = screen.getByRole("link", { name: /Cần xử lý/ });
    const tat = screen.getByRole("link", { name: "Tất cả" });
    expect(can.getAttribute("href")).toBe("/nguon-hoa-hong/nguon?coSo=cs1");
    expect(tat.getAttribute("href")).toBe("/nguon-hoa-hong/nguon?coSo=cs1&xem=tat-ca");
    expect(can.textContent).toContain("(37)");
    expect(can.getAttribute("aria-current")).toBe("page");
    expect(tat.getAttribute("aria-current")).toBeNull();
  });

  it("số chưa biết (null) ⇒ không in ngoặc; chế độ Tất cả sáng đúng một mục", () => {
    render(<QueueToggle basePath="/x" dangXem="tat-ca" soCanXuLy={null} />);
    expect(screen.getByRole("link", { name: "Cần xử lý" }).textContent).toBe("Cần xử lý");
    expect(document.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Tất cả" }).getAttribute("aria-current")).toBe("page");
  });
});

describe("[NHH-FE-06b] docCheDoXem — `?xem=` đọc thành chế độ, mặc định là HÀNG CHỜ", () => {
  it("chỉ đúng 'tat-ca' mới sang danh mục; không tham số, rác, hoa/thường lạ ⇒ Cần xử lý (mở ra ở hàng chờ, 06 §2.2)", () => {
    expect(docCheDoXem("tat-ca")).toBe("tat-ca");
    expect(docCheDoXem(null)).toBe("can-xu-ly");
    expect(docCheDoXem("")).toBe("can-xu-ly");
    expect(docCheDoXem("can-xu-ly")).toBe("can-xu-ly");
    expect(docCheDoXem("TAT-CA")).toBe("can-xu-ly");
    expect(docCheDoXem("<script>")).toBe("can-xu-ly");
  });
});

describe("[NHH-FE-03b] hàng chờ rỗng là trạng thái THÀNH CÔNG", () => {
  it("có dấu ✓ (không phải dấu 'i' của EmptyState), câu đúng phạm vi và đường đi tiếp", () => {
    const { container } = render(
      <HangChoRong
        tieuDe="Không còn lead nào cần xử lý nguồn"
        moTa="Mọi lead ở CS2 đều đã đủ căn cứ nguồn."
        hrefTiep="/nguon-hoa-hong/nguon?xem=tat-ca"
        nhanTiep="Xem tất cả nguồn"
      />,
    );
    expect(screen.getByText("Không còn lead nào cần xử lý nguồn")).toBeTruthy();
    expect(screen.getByText("Mọi lead ở CS2 đều đã đủ căn cứ nguồn.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Xem tất cả nguồn" }).getAttribute("href")).toBe("/nguon-hoa-hong/nguon?xem=tat-ca");
    // tông thành công, không phải tông muted của EmptyState
    expect(container.querySelector(".bg-state-success-soft")).not.toBeNull();
  });
});

describe("[NHH-FE-13] ThieuQuyen — nêu ĐỦ key quyền cần xin (không phải 403 trần)", () => {
  it("mỗi tab: in MỌI key của PAGE_GATES[href] (nối bằng 'hoặc') và tên tab — người gặp nó biết xin quyền gì", () => {
    for (const tab of TAB_KEYS) {
      cleanup();
      const scope = scopeCua([], { nguon: true, engine: true });
      render(<ThieuQuyen tab={tab} scope={scope} soHangCho={{}} />);
      const chu = document.body.textContent ?? "";
      const keys = cacKeyCuaTab(tab);
      expect(keys.length, `tab ${tab} phải có ít nhất một key`).toBeGreaterThan(0);
      for (const k of keys) expect(chu, `tab ${tab} thiếu key ${k}`).toContain(k);
      if (keys.length > 1) expect(chu).toContain(keys.join(" hoặc "));
      expect(chu).toContain("không có quyền xem");
    }
  });
});

describe("[NHH-FE-15] skeleton — trình đọc màn hình nghe được 'đang tải'", () => {
  it("vùng skeleton có role=status + aria-busy + nhãn (aria-label trên <div> trơ bị bỏ qua)", () => {
    const { container } = render(<BangSkeleton cot={3} dong={2} />);
    const v = container.firstElementChild as HTMLElement;
    expect(v.getAttribute("role")).toBe("status");
    expect(v.getAttribute("aria-busy")).toBe("true");
    expect(v.getAttribute("aria-label")).toBe("Đang tải…");
    cleanup();
    const k = render(<KhungSkeleton nhan="nguồn" cot={3} dong={2} />).container.firstElementChild as HTMLElement;
    expect(k.getAttribute("role")).toBe("status");
    expect(k.getAttribute("aria-busy")).toBe("true");
    expect(k.getAttribute("aria-label")).toBe("Đang tải nguồn…");
  });
});

describe("[NHH-FE-NAV-LB] pill số trên tab: mỗi tab nói ĐÚNG điều nó đếm (tab Sổ ≠ tab Kỳ)", () => {
  const scopeDu = () => scopeCua(["sources:view", "commission_policies:view", "commission:view-center", "commission_periods:manage", "commission_disputes:review"], { nguon: true, engine: true });

  it("cùng một con số, hai tab ⇒ hai nhãn KHÁC nhau: Sổ = 'hàng chờ đang mở', Kỳ = 'hàng chờ chặn khoá, mọi kỳ chưa khoá'; chữ cho trình đọc màn hình và title là MỘT câu", () => {
    render(<ModuleNav active="so" scope={scopeDu()} soHangCho={{ so: 7, ky: 7 }} />);
    const so = screen.getByRole("link", { name: /Sổ hoa hồng/ });
    const ky = screen.getByRole("link", { name: /^Kỳ/ });
    expect(so.textContent).toBe("Sổ hoa hồng7 hàng chờ đang mở");
    expect(ky.textContent).toBe("Kỳ7 hàng chờ chặn khoá, mọi kỳ chưa khoá");
    expect(so.querySelector("span[title]")!.getAttribute("title")).toBe("7 hàng chờ đang mở");
    expect(ky.querySelector("span[title]")!.getAttribute("title")).toBe("7 hàng chờ chặn khoá, mọi kỳ chưa khoá");
    expect(so.querySelector("span[title]")!.getAttribute("title")).not.toBe(ky.querySelector("span[title]")!.getAttribute("title"));
  });

  it("đối chứng: tab Nguồn / Chính sách / Khiếu nại giữ câu chung 'việc cần xử lý' (chỉ hai tab đếm hàng chờ sổ đổi chữ)", () => {
    render(<ModuleNav active="nguon" scope={scopeDu()} soHangCho={{ nguon: 3, "chinh-sach": 2, "khieu-nai": 1 }} />);
    expect(screen.getByRole("link", { name: /^Nguồn/ }).textContent).toBe("Nguồn3 việc cần xử lý");
    expect(screen.getByRole("link", { name: /^Chính sách/ }).textContent).toBe("Chính sách2 việc cần xử lý");
    expect(screen.getByRole("link", { name: /^Khiếu nại/ }).textContent).toContain("1 việc cần xử lý");
  });
});
