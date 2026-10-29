// @vitest-environment jsdom
/**
 * [LNL-*] — Tên phụ huynh ở `/lead-nguoi` là liên kết sang trang chi tiết lead (28/10/2026).
 * Dựng THẬT component và soi cây DOM: chỉ ô TÊN là `<a>`, mỗi lead một đường dẫn đúng id, bấm tên
 * không làm đổi ô tick, và có đối chứng dương (cả bảng lẫn thẻ điện thoại đều có liên kết).
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { BangLeadNguoi } from "./bang-lead-nguoi";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../_actions", () => ({ phanBoLeadNguoiAction: vi.fn() }));

const dong = [
  { id: "lead-a", parentName: "Vo Le Anh Huy", phone: "0984868788", status: "DANG_NUOI_DUONG", centerId: "cs1", chuId: "u1", chuTen: "Lê Thị Phương Liên", soNgayIm: 164 },
  { id: "lead-b", parentName: "Tài Đức", phone: "0799796899", status: "DANG_NUOI_DUONG", centerId: "cs1", chuId: "u2", chuTen: "Nguyễn Thị Lộc", soNgayIm: 163 },
];

function dung() {
  return render(
    <BangLeadNguoi
      tong={2}
      dong={dong}
      trang={1}
      soTrang={1}
      soDong={20}
      quetThieu={0}
      nguong={90}
      centerId=""
      coSo={[{ id: "cs1", ten: "Cơ sở 1", ma: "CS1" }]}
      nguoiNhan={[]}
    />,
  );
}

describe("[LNL-01] tên phụ huynh → trang chi tiết lead", () => {
  it("mỗi tên là liên kết tới /leads/<id> của ĐÚNG lead đó (bảng + thẻ điện thoại)", () => {
    dung();
    for (const d of dong) {
      const links = screen.getAllByRole("link", { name: d.parentName });
      // Một ở bảng desktop, một ở thẻ mobile — cả hai cùng được dựng (ẩn bằng CSS).
      expect(links).toHaveLength(2);
      for (const a of links) expect(a.getAttribute("href")).toBe(`/leads/${d.id}`);
    }
  });

  it("⚠️ CHỈ tên là liên kết: số điện thoại, trạng thái, người giữ, số ngày không phải <a>", () => {
    const { container } = dung();
    const tatCa = Array.from(container.querySelectorAll("a")).map((a) => a.textContent);
    expect(tatCa.sort()).toEqual(["Tài Đức", "Tài Đức", "Vo Le Anh Huy", "Vo Le Anh Huy"].sort());
  });

  it("mở tab mới để KHÔNG mất danh sách đã tick (rel an toàn)", () => {
    dung();
    const a = screen.getAllByRole("link", { name: "Tài Đức" })[0]!;
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
  });

  it("bấm tên không đổi ô tick của dòng (đối chứng: bấm ô tick thì tick)", () => {
    dung();
    const hang = screen.getAllByRole("row").find((r) => within(r).queryByRole("link", { name: "Vo Le Anh Huy" }))!;
    const o = within(hang).getByRole("checkbox") as HTMLInputElement;
    expect(o.checked).toBe(false);
    fireEvent.click(within(hang).getByRole("link", { name: "Vo Le Anh Huy" }));
    expect(o.checked).toBe(false);
    fireEvent.click(o);
    expect(o.checked).toBe(true);
  });
});
