// @vitest-environment jsdom
/**
 * [AFR-SO-UI-*] — HAI Ô LỌC MỚI của tab Sổ (AFF-P3 H2): «Campaign Affiliate» và «Đối tác hưởng». Trên phần tử thật.
 *   [AFR-SO-UI-01] chỉ vẽ khi sổ trong tầm nhìn CÓ dòng Affiliate (hoặc URL đang lọc); sổ chưa dùng Affiliate ⇒ KHÔNG hai ô thừa (đối chứng dương: có danh sách ⇒ có ô)
 *   [AFR-SO-UI-02] «Đối tác hưởng» CHỈ khi người xem có danh sách đối tác (view-self không có) — độc lập với ô campaign
 *   [AFR-SO-UI-03] giá trị đang lọc mà không còn trong danh sách VẪN hiện và nói «không còn trong danh sách»; «Bỏ lọc» xuất hiện khi coLoc
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

import type { LuaChonBoLocSo } from "@/lib/hoa-hong/doc-so-giao-dien";
import { BoLocSoForm, type GiaTriBoLoc } from "./bo-loc";

afterEach(cleanup);

const LUA: LuaChonBoLocSo = {
  thang: ["2026-10"],
  nguoiHuong: [],
  nhomNguon: [],
  vai: [],
  loaiGiaoDich: [],
  campaign: [{ code: "CAMP_A", ten: "Chiến dịch A" }],
  doiTacHuong: [{ id: "aff1", ten: "Đối tác Một" }],
};
const TRONG: GiaTriBoLoc = { thang: "", vai: "", nguoi: "", nguon: "", loai: "", tt: "", camp: "", dt: "" };
const ten = (c: HTMLElement) => Array.from(c.querySelectorAll("select")).map((s) => s.getAttribute("name"));

describe("[AFR-SO-UI-01..03] bộ lọc Affiliate của Sổ", () => {
  it("[AFR-SO-UI-01] có dòng Affiliate ⇒ có cả hai ô; KHÔNG có ⇒ không ô nào (sổ chưa dùng Affiliate)", () => {
    const { container, rerender } = render(<BoLocSoForm basePath="/nguon-hoa-hong/so" giu={{ xem: "tat-ca" }} lua={LUA} gia={TRONG} coLoc={false} />);
    expect(ten(container)).toEqual(["thang", "vai", "nguon", "loai", "tt", "camp", "dt"]);
    rerender(<BoLocSoForm basePath="/nguon-hoa-hong/so" giu={{ xem: "tat-ca" }} lua={{ ...LUA, campaign: [], doiTacHuong: [] }} gia={TRONG} coLoc={false} />);
    expect(ten(container)).toEqual(["thang", "vai", "nguon", "loai", "tt"]);
  });

  it("[AFR-SO-UI-02] view-self (không có danh sách đối tác) ⇒ vẫn có ô campaign nhưng KHÔNG có ô «Đối tác hưởng»", () => {
    const { container } = render(<BoLocSoForm basePath="/nguon-hoa-hong/so" giu={{}} lua={{ ...LUA, doiTacHuong: [] }} gia={TRONG} coLoc={false} />);
    expect(ten(container)).toContain("camp");
    expect(ten(container)).not.toContain("dt");
  });

  it("[AFR-SO-UI-03] mã lạ trên URL vẫn hiện + «không còn trong danh sách»; đã chọn mã có thật thì hiện đúng tên; «Bỏ lọc» khi coLoc", () => {
    const { container, rerender } = render(<BoLocSoForm basePath="/nguon-hoa-hong/so" giu={{ xem: "tat-ca" }} lua={LUA} gia={{ ...TRONG, camp: "CAMP_A", dt: "aff1" }} coLoc />);
    const camp = container.querySelector("select[name=camp]") as HTMLSelectElement;
    expect(camp.value).toBe("CAMP_A");
    expect(camp.selectedOptions[0]!.textContent).toBe("Chiến dịch A");
    expect((container.querySelector("select[name=dt]") as HTMLSelectElement).selectedOptions[0]!.textContent).toBe("Đối tác Một");
    expect(screen.getByRole("link", { name: "Bỏ lọc" }).getAttribute("href")).toBe("/nguon-hoa-hong/so?xem=tat-ca");
    rerender(<BoLocSoForm basePath="/nguon-hoa-hong/so" giu={{ xem: "tat-ca" }} lua={{ ...LUA, campaign: [] }} gia={{ ...TRONG, camp: "CAMP_DA_GO" }} coLoc />);
    // danh sách campaign rỗng nhưng URL đang lọc ⇒ ô VẪN vẽ để người xem thấy và bỏ được
    const lạ = container.querySelector("select[name=camp]") as HTMLSelectElement;
    expect(lạ.value).toBe("CAMP_DA_GO");
    expect(lạ.selectedOptions[0]!.textContent).toContain("không còn trong danh sách");
  });
});
