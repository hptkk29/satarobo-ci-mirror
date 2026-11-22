// @vitest-environment jsdom
/**
 * [AFR-KY-UI-*] — LỌC THEO CAMPAIGN AFFILIATE trên tab Kỳ (AFF-P3 H2), trên phần tử thật.
 *
 * Lưới chính: phần của campaign KHÔNG được trông như số của cả kỳ. Mọi ca "không thấy X" có đối chứng dương (luật 11).
 *   [AFR-KY-UI-01] ô lọc: có danh sách ⇒ vẽ + mang theo cơ sở/tháng/trạng thái; rỗng ∧ không lọc ⇒ KHÔNG vẽ; đang lọc mã lạ ⇒ vẫn vẽ, nói «không còn trong danh sách»; «Bỏ lọc» chỉ khi đang lọc
 *   [AFR-KY-UI-02] dải phần-của-campaign: nêu tên campaign + nói thẳng «chỉ là phần của campaign / nút Tính, Khoá áp dụng cho cả kỳ»; kỳ không có dòng ⇒ «chưa có dòng» (KHÁC 0 đồng); liên kết Sổ chỉ khi có
 *   [AFR-KY-UI-03] BangKy: đang lọc ⇒ mỗi dòng có dòng phụ «Phần …» ở CẢ bảng lẫn thẻ, link chọn kỳ GIỮ campaign; không lọc ⇒ không dòng phụ nào
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import type { DanhSachKy, DongKy } from "@/lib/hoa-hong/ky-doc";
import { BangKy } from "./bang-ky";
import { LocCampaignKy, PhanCampaignKy } from "./campaign-ky";

afterEach(cleanup);

const LUA = [
  { code: "CAMP_A", ten: "Chiến dịch A" },
  { code: "CAMP_B", ten: "Chiến dịch B" },
];

describe("[AFR-KY-UI-01] LocCampaignKy", () => {
  it("có danh sách ⇒ vẽ ô chọn, mang theo cơ sở · tháng · trạng thái; KHÔNG có «Bỏ lọc» khi chưa lọc", () => {
    const { container } = render(<LocCampaignKy basePath="/nguon-hoa-hong/ky" giu={{ coSo: "c1", thang: "2026-10", trangthai: "LOCKED" }} lua={LUA} dangChon={null} />);
    const form = container.querySelector("form")!;
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe("/nguon-hoa-hong/ky");
    expect(Array.from(form.querySelectorAll("input[type=hidden]")).map((i) => [i.getAttribute("name"), (i as HTMLInputElement).value])).toEqual([
      ["coSo", "c1"],
      ["thang", "2026-10"],
      ["trangthai", "LOCKED"],
    ]);
    const sel = container.querySelector("select[name=camp]") as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => [o.value, o.textContent])).toEqual([
      ["", "Mọi campaign"],
      ["CAMP_A", "Chiến dịch A"],
      ["CAMP_B", "Chiến dịch B"],
    ]);
    expect(screen.queryByRole("link", { name: "Bỏ lọc" })).toBeNull();
  });

  it("đối chứng: danh sách rỗng ∧ không lọc ⇒ KHÔNG vẽ gì; đang lọc ⇒ «Bỏ lọc» về đúng URL không có camp", () => {
    const { container, unmount } = render(<LocCampaignKy basePath="/nguon-hoa-hong/ky" giu={{ coSo: "c1" }} lua={[]} dangChon={null} />);
    expect(container.querySelector("form")).toBeNull();
    unmount();
    render(<LocCampaignKy basePath="/nguon-hoa-hong/ky" giu={{ coSo: "c1", thang: "2026-10" }} lua={LUA} dangChon="CAMP_A" />);
    expect(screen.getByRole("link", { name: "Bỏ lọc" }).getAttribute("href")).toBe("/nguon-hoa-hong/ky?coSo=c1&thang=2026-10");
    expect((document.querySelector("select[name=camp]") as HTMLSelectElement).value).toBe("CAMP_A");
  });

  it("mã trên URL không còn trong danh sách ⇒ ô VẪN hiện đúng mã đó và nói «không còn trong danh sách» (không nói «Mọi campaign» khi đang lọc)", () => {
    render(<LocCampaignKy basePath="/nguon-hoa-hong/ky" giu={{}} lua={[]} dangChon="CAMP_DA_GO" />);
    const sel = document.querySelector("select[name=camp]") as HTMLSelectElement;
    expect(sel.value).toBe("CAMP_DA_GO");
    expect(sel.selectedOptions[0]!.textContent).toContain("không còn trong danh sách");
  });
});

describe("[AFR-KY-UI-02] PhanCampaignKy", () => {
  it("nêu tên campaign + số của campaign + câu «chỉ là phần của campaign … cả kỳ»; liên kết Sổ đúng địa chỉ", () => {
    render(<PhanCampaignKy tenCampaign="Chiến dịch A" kyNhan="10/2026" phan={{ hoaHong: 1_200_000, dieuChinh: -200_000, soDong: 3 }} hrefSo="/nguon-hoa-hong/so?xem=tat-ca&thang=2026-10&camp=CAMP_A" />);
    const vung = screen.getByRole("region", { name: /Phần của campaign Chiến dịch A trong kỳ/ });
    expect(vung.textContent).toContain("Chiến dịch A");
    expect(vung.textContent).toContain("1.200.000");
    expect(vung.textContent).toContain("200.000");
    expect(screen.getByRole("note").textContent).toMatch(/chỉ là phần của campaign/);
    expect(screen.getByRole("note").textContent).toMatch(/cả kỳ, không theo campaign/);
    expect(screen.getByRole("link", { name: "Xem các dòng này ở Sổ" }).getAttribute("href")).toBe("/nguon-hoa-hong/so?xem=tat-ca&thang=2026-10&camp=CAMP_A");
  });

  it("kỳ không có dòng nào của campaign ⇒ «chưa có dòng» (KHÔNG in 0 đồng); không có đường vào Sổ ⇒ không vẽ liên kết", () => {
    render(<PhanCampaignKy tenCampaign="Chiến dịch A" kyNhan="10/2026" phan={null} hrefSo={null} />);
    expect(document.body.textContent).toContain("chưa có dòng nào trong kỳ 10/2026");
    expect(document.body.textContent).not.toMatch(/Hoa hồng ghi mới/);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

function dongKy(p: Partial<DongKy> = {}): DongKy {
  return {
    id: "k1",
    period: "2026-10",
    centerId: "cs1",
    coSo: "CS1",
    status: "LOCKED",
    coSoTinh: 100_000_000,
    hoaHong: 3_000_000,
    dieuChinh: 0,
    soNguoi: 4,
    soChan: 0,
    lastCalculatedAt: null,
    lockedAt: null,
    khoaBoi: null,
    exportedAt: null,
    paidAt: null,
    ...p,
  };
}
const ds = (d: DongKy[]): DanhSachKy => ({ dong: d, tong: d.length, trang: 1, soTrang: 1, coTrang: 25 });

describe("[AFR-KY-UI-03] BangKy khi lọc theo campaign", () => {
  it("đang lọc ⇒ dòng phụ «Phần …» ở bảng VÀ thẻ; kỳ không có dòng ⇒ «chưa có dòng»; link chọn kỳ GIỮ camp", () => {
    render(
      <BangKy
        ds={ds([dongKy({ id: "k1" }), dongKy({ id: "k2", period: "2026-09" })])}
        basePath="/nguon-hoa-hong/ky"
        kyCutover="2026-08"
        thangDangChon="2026-10"
        coSoDangChon="cs1"
        trangThai={null}
        camp={{ ma: "CAMP_A", ten: "Chiến dịch A", theoKy: { k1: { hoaHong: 700_000, dieuChinh: 0, soDong: 2 } } }}
      />,
    );
    const phu = Array.from(document.querySelectorAll("[data-phan-campaign]")).map((e) => e.textContent);
    // 2 kỳ × (bảng + thẻ) = 4 dòng phụ
    expect(phu).toHaveLength(4);
    expect(phu.filter((t) => /700\.000/.test(t ?? ""))).toHaveLength(2);
    expect(phu.filter((t) => /chưa có dòng/.test(t ?? ""))).toHaveLength(2);
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.includes("thang=2026-10") && h.includes("camp=CAMP_A"))).toBe(true);
    // MỌI liên kết chọn kỳ đều giữ camp
    expect(hrefs.filter((h) => h.includes("thang=")).every((h) => h.includes("camp=CAMP_A"))).toBe(true);
  });

  it("đối chứng: camp=null ⇒ KHÔNG dòng phụ nào, link không mang camp", () => {
    render(<BangKy ds={ds([dongKy()])} basePath="/nguon-hoa-hong/ky" kyCutover="2026-08" thangDangChon="2026-10" coSoDangChon="cs1" trangThai={null} camp={null} />);
    expect(document.querySelectorAll("[data-phan-campaign]")).toHaveLength(0);
    expect(Array.from(document.querySelectorAll("a")).some((a) => (a.getAttribute("href") ?? "").includes("camp="))).toBe(false);
  });
});
