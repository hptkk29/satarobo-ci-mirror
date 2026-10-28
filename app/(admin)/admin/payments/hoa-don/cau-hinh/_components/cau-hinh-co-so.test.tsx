// @vitest-environment jsdom
// Ca [CHF-*] — form Cấu hình ký hiệu: chọn cơ sở ⇒ pháp nhân tự chọn theo Cây tổ chức; không khớp ⇒ để trống bắt chọn.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../_actions", () => ({ luuCauHinhHoaDonAction: vi.fn() }));

import { CauHinhCoSo } from "./cau-hinh-co-so";
import type { PhapNhanTheoCay } from "@/lib/finance/hoa-don/cau-hinh-co-so";

const PN = [
  { ma: "SATA_ROBO", ten: "SATA ROBO", maSoThue: "0402301783", bat: true },
  { ma: "NEW_VISION", ten: "NEW VISION", maSoThue: "0402341070", bat: true },
  { ma: "STEM_ROBOTICS_AI", ten: "STEM ROBOTICS & AI", maSoThue: "0402341056", bat: true },
];
const ve = (theoCay: PhapNhanTheoCay, coTheMoCay = true) =>
  render(<CauHinhCoSo centerId="cs1" tenCoSo="CS1 · Trụ sở" dong={[]} lichSu={[]} phapNhan={PN} theoCay={theoCay} coTheMoCay={coTheMoCay} namHienTai="2026" />);
const moThem = () => fireEvent.click(screen.getByRole("button", { name: /Thêm cấu hình/ }));
const oPn = () => screen.getByLabelText("Pháp nhân phát hành") as HTMLSelectElement;

afterEach(cleanup);

describe("[CHF] form cấu hình theo Cây tổ chức", () => {
  it("cơ sở gắn STEM ROBOTICS & AI ⇒ mở form là ĐÃ chọn đúng pháp nhân đó + câu giải thích + link Cây tổ chức", () => {
    ve({ loai: "KHOP", ma: "STEM_ROBOTICS_AI", ten: "STEM ROBOTICS & AI", maSoThue: "0402341056" });
    moThem();
    expect(oPn().value).toBe("STEM_ROBOTICS_AI");
    expect(screen.getByText(/Theo Cây tổ chức, CS1 · Trụ sở thuộc STEM ROBOTICS & AI · MST 0402341056/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Mở Cây tổ chức" }).getAttribute("href")).toBe("/to-chuc");
  });
  it("đổi sang pháp nhân KHÁC cây ⇒ cảnh báo; chọn lại đúng ⇒ hết cảnh báo", () => {
    ve({ loai: "KHOP", ma: "STEM_ROBOTICS_AI", ten: "STEM ROBOTICS & AI", maSoThue: "0402341056" });
    moThem();
    fireEvent.change(oPn(), { target: { value: "SATA_ROBO" } });
    expect(screen.getByText(/KHÁC với Cây tổ chức/)).toBeTruthy();
    fireEvent.change(oPn(), { target: { value: "STEM_ROBOTICS_AI" } });
    expect(screen.queryByText(/KHÁC với Cây tổ chức/)).toBeNull();
  });
  it("Cây tổ chức gắn pháp nhân CHƯA có trong danh sách ⇒ ô để TRỐNG (không rơi về Sata Robo) + nói rõ vì sao", () => {
    ve({ loai: "KHONG_CO_TRONG_DANH_SACH", ten: "CÔNG TY LẠ", maSoThue: "0999999999" });
    moThem();
    expect(oPn().value).toBe("");
    expect(screen.getByText(/chưa có trong danh sách phát hành hoá đơn/)).toBeTruthy();
  });
  it("Cây chưa gắn pháp nhân ⇒ ô trống + nhắc chọn tay", () => {
    ve({ loai: "CHUA_GAN" });
    moThem();
    expect(oPn().value).toBe("");
    expect(screen.getByText(/chưa gắn pháp nhân cho cơ sở này/)).toBeTruthy();
  });
  it("người không mở được Cây tổ chức ⇒ KHÔNG có link (luật 12: không hứa suông)", () => {
    ve({ loai: "KHOP", ma: "SATA_ROBO", ten: "SATA ROBO", maSoThue: "0402301783" }, false);
    moThem();
    expect(screen.queryByRole("link", { name: "Mở Cây tổ chức" })).toBeNull();
  });
});
