// @vitest-environment jsdom
/**
 * Ca [TTHD-UI-*] — khối "Người mua trên hoá đơn" che PII theo `orders:view-pii` (29/09, PLAN GĐ 7 mục 12).
 *
 * Canh trên phần tử THẬT:
 *   · thiếu quyền ⇒ MST / CCCD / địa chỉ / email hoá đơn KHÔNG có bản đầy đủ nào trong DOM, và KHÔNG có nút
 *     Sửa (form khởi tạo bằng bản đã che rồi Lưu là ghi đè dữ liệu thật — bẫy đã biết);
 *   · nhãn "còn thiếu" tính trên dữ liệu THẬT — che rồi mới tính là nhãn nói dối;
 *   · đối chứng dương: có quyền ⇒ thấy đủ, có nút Sửa, form mở ra mang giá trị THẬT.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../_actions", () => ({ luuThongTinHoaDonAction: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { khoiNguoiMuaHoaDon, NHAN_DA_AN } from "@/lib/finance/hoa-don/khoi-nguoi-mua";
import type { DonChoHoaDon } from "@/lib/finance/hoa-don/nguoi-mua";
import { ThongTinHoaDon } from "./thong-tin-hoa-don";

const DON: DonChoHoaDon = {
  customerName: "Phan Thị Hồng",
  customerPhone: "0905123456",
  customerEmail: "hong.phan@example.com",
  customerAddress: "60 Đồng Du",
  customerWard: "Hải Châu 1",
  customerCity: "Đà Nẵng",
  customerCccd: "048183006790",
  invoiceBuyerName: "Phan Thị Hồng",
  invoiceCompanyName: "Công ty ABC",
  invoiceTaxCode: "0401234567",
  invoiceEmail: "ketoan.abc@example.com",
};
const THAT = ["0401234567", "048183006790", "60 Đồng Du", "ketoan.abc@example.com", "hong.phan@example.com"];

const ve = (xemPii: boolean, canManage = true) =>
  render(<ThongTinHoaDon orderId="don1" khoi={khoiNguoiMuaHoaDon(DON, xemPii)} updatedAt="2026-09-29T02:00:00.000Z" canManage={canManage} />);

describe("[TTHD-UI-01] thiếu orders:view-pii ⇒ che + không có form sửa", () => {
  it("không một giá trị THẬT nào của MST / CCCD / địa chỉ / email trong DOM; hiện bản che", () => {
    const { container } = ve(false);
    const html = container.innerHTML;
    for (const v of THAT) expect(html, v).not.toContain(v);
    expect(screen.getByText("040xxxx567")).toBeTruthy();
    expect(screen.getByText("048xxxxxx790")).toBeTruthy();
    expect(screen.getByText(NHAN_DA_AN)).toBeTruthy();
    expect(screen.getByText("ke********@example.com")).toBeTruthy();
  });

  it("KHÔNG có nút Sửa (kể cả khi có orders:manage), KHÔNG có ô nhập nào", () => {
    ve(false, true);
    expect(screen.queryByRole("button", { name: /Sửa/ })).toBeNull();
    expect(screen.queryAllByRole("textbox")).toEqual([]);
  });

  it("nhãn 'còn thiếu' tính trên dữ liệu THẬT: đủ ô ⇒ 'Xuất hoá đơn được' (MST đã che không làm nó thành 'cần bổ sung')", () => {
    ve(false);
    expect(screen.getByText("Xuất hoá đơn được")).toBeTruthy();
    expect(screen.queryByText(/Cần bổ sung/)).toBeNull();
  });
});

describe("[TTHD-UI-02] đối chứng dương: có quyền ⇒ thấy đủ, sửa được bằng giá trị THẬT", () => {
  it("thấy MST / CCCD / email đầy đủ; nút Sửa mở form mang giá trị thật", () => {
    ve(true);
    expect(screen.getByText("0401234567")).toBeTruthy();
    expect(screen.getByText("048183006790")).toBeTruthy();
    expect(screen.getByText("ketoan.abc@example.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Sửa/ }));
    expect((screen.getByLabelText("Mã số thuế / CCCD chủ hộ") as HTMLInputElement).value).toBe("0401234567");
    expect((screen.getByLabelText("Email nhận hoá đơn điện tử") as HTMLInputElement).value).toBe("ketoan.abc@example.com");
  });

  it("có xem PII nhưng không có orders:manage ⇒ không nút Sửa", () => {
    ve(true, false);
    expect(screen.queryByRole("button", { name: /Sửa/ })).toBeNull();
  });
});

describe("[TTHD-UI-03] view-model (thuần)", () => {
  it("thiếu quyền ⇒ giaTriSua null; có quyền ⇒ giá trị thật; thieu/daKhai giống nhau ở hai bên", () => {
    const an = khoiNguoiMuaHoaDon(DON, false);
    const hien = khoiNguoiMuaHoaDon(DON, true);
    expect(an.giaTriSua).toBeNull();
    expect(hien.giaTriSua).toMatchObject({ invoiceTaxCode: "0401234567", invoiceEmail: "ketoan.abc@example.com" });
    expect(an.thieu).toEqual(hien.thieu);
    expect(an.daKhai).toBe(hien.daKhai);
    expect(JSON.stringify(an)).not.toMatch(/0401234567|048183006790|60 Đồng Du|ketoan\.abc@|hong\.phan@/);
  });

  it("ô trống ⇒ null ở cả hai bên (không in 'Đã ẩn' cho thứ không có)", () => {
    const trong = khoiNguoiMuaHoaDon({ ...DON, invoiceTaxCode: null, customerCccd: null, customerAddress: null, customerWard: null, customerCity: null }, false);
    expect([trong.maSoThue, trong.cccd, trong.diaChi]).toEqual([null, null, null]);
  });
});

describe("[TTHD-W1] lưới ghim dây nối ở trang đơn (RSC — không ca hành vi nào chạm được)", () => {
  // Trước bản vá: khối nhận `don={{…order}}` — bản `order` đã che một phần (MST còn nguyên) và form khởi tạo
  // bằng chính nó. Nay trang dựng view-model từ đơn THẬT theo đúng quyền của người xem.
  it("trang gọi khoiNguoiMuaHoaDon(order, canViewPii) đúng MỘT lần; nhánh che của `order` che cả MST", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(process.cwd(), "app/(admin)/admin/orders/[id]/page.tsx"), "utf8");
    expect(src.match(/khoiNguoiMua=\{khoiNguoiMuaHoaDon\(order, canViewPii\)\}/g)).toHaveLength(1);
    expect(src.match(/invoiceTaxCode: order\.invoiceTaxCode \? maskPhone\(order\.invoiceTaxCode\) : order\.invoiceTaxCode,/g)).toHaveLength(1);
  });
});
