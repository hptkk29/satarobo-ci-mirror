// @vitest-environment jsdom
/**
 * Ca [TTHD-UI-*] — khối «Người mua trên hoá đơn» (8 ô) che PII theo `orders:view-pii` và điền sẵn từ hồ sơ (01/11/2026).
 *
 * Canh trên phần tử THẬT:
 *   · thiếu quyền ⇒ ngày sinh / CCCD / SĐT / địa chỉ / email KHÔNG có bản đầy đủ nào trong DOM, và KHÔNG có nút Sửa
 *     (form khởi tạo bằng bản đã che rồi Lưu là ghi đè dữ liệu thật — bẫy đã biết);
 *   · nhãn "còn thiếu" tính trên dữ liệu THẬT — che rồi mới tính là nhãn nói dối;
 *   · đối chứng dương: có quyền ⇒ thấy đủ, có nút Sửa, form mở ra mang giá trị THẬT (đơn trước, hồ sơ sau);
 *   · ô lấy từ hồ sơ được ĐÁNH DẤU (tờ hoá đơn chỉ đọc thứ đã lưu trên đơn), ô hồ sơ khác đơn được NHẮC.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../_actions", () => ({ luuThongTinHoaDonAction: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { khoiNguoiMuaHoaDon, NHAN_DA_AN } from "@/lib/finance/hoa-don/khoi-nguoi-mua";
import type { DonChoHoaDon } from "@/lib/finance/hoa-don/nguoi-mua";
import { FORM_TRONG, hieuLuc, type DonChoForm, type FormNguoiMua } from "@/lib/finance/hoa-don/form-nguoi-mua";
import { ThongTinHoaDon } from "./thong-tin-hoa-don";

const DON: DonChoHoaDon & DonChoForm = {
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
  invoiceStudentName: null,
  invoiceStudentDob: null,
  invoiceStudentCccd: null,
  invoiceParentPhone: null,
};
/** Hồ sơ học viên: có tên em + ngày sinh + CCCD em mà ĐƠN chưa có; SĐT ba/mẹ khác với đơn. */
const HO_SO: FormNguoiMua = {
  ...FORM_TRONG,
  hocVienTen: "Nguyễn Đức Huy Hoàng",
  hocVienNgaySinh: "2015-03-09",
  hocVienCccd: "048215001234",
  phuHuynhSdt: "0905999888",
};
const THAT = [
  "0401234567",
  "048183006790",
  "048215001234",
  "2015-03-09",
  "60 Đồng Du",
  "ketoan.abc@example.com",
  "hong.phan@example.com",
  "0905123456",
];

const ve = (xemPii: boolean, canManage = true) =>
  render(
    <ThongTinHoaDon
      orderId="don1"
      khoi={khoiNguoiMuaHoaDon(DON, xemPii, { hieuLuc: hieuLuc(DON, HO_SO), hoSo: HO_SO, noiGhi: "HOC_VIEN" })}
      updatedAt="2026-11-01T02:00:00.000Z"
      canManage={canManage}
    />,
  );

describe("[TTHD-UI-01] thiếu orders:view-pii ⇒ che + không có form sửa", () => {
  it("không một giá trị THẬT nào của ngày sinh / CCCD / SĐT / địa chỉ / email / MST trong DOM; hiện bản che", () => {
    const { container } = ve(false);
    const html = container.innerHTML;
    for (const v of THAT) expect(html, v).not.toContain(v);
    expect(screen.getAllByText(NHAN_DA_AN).length).toBeGreaterThanOrEqual(2); // ngày sinh + địa chỉ
    expect(screen.getByText("040xxxx567")).toBeTruthy(); // MST
    expect(screen.getByText("048xxxxxx790")).toBeTruthy(); // CCCD ba/mẹ
    expect(screen.getByText("048xxxxxx234")).toBeTruthy(); // CCCD học viên (từ hồ sơ)
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
  it("thấy đủ tám ô; ô lấy từ hồ sơ được ĐÁNH DẤU; có dòng nhắc 'tờ hoá đơn chỉ đọc thứ đã lưu trên đơn'", () => {
    ve(true);
    for (const nhan of [
      "Họ và tên học viên",
      "Ngày tháng năm sinh học viên",
      "Địa chỉ nơi ở",
      "Số CCCD của học viên",
      "Họ và tên của ba/mẹ",
      "SĐT của ba/mẹ",
      "Số CCCD của ba/mẹ",
      "Email của ba/mẹ",
    ]) {
      expect(screen.getByText(nhan), nhan).toBeTruthy();
    }
    expect(screen.getByText("2015-03-09")).toBeTruthy();
    expect(screen.getByText("048215001234")).toBeTruthy();
    // 3 ô học viên (tên · ngày sinh · CCCD) đều từ hồ sơ.
    expect(screen.getAllByText(/từ hồ sơ — chưa lưu vào đơn/)).toHaveLength(3);
    const nhac = screen.getByText((_, el) => el?.tagName === "P" && /3 mục/.test(el.textContent ?? ""));
    expect(nhac.textContent).toMatch(/3 mục.*hồ sơ học viên.*chỉ đọc thứ đã lưu trên đơn/);
  });

  it("nút Sửa mở form: ô học viên điền SẴN từ hồ sơ, ba/mẹ lấy theo ĐƠN; hồ sơ khác đơn thì có nhắc + nút dùng giá trị hồ sơ", () => {
    ve(true);
    fireEvent.click(screen.getByRole("button", { name: /Sửa/ }));
    expect((screen.getByLabelText("Họ và tên học viên") as HTMLInputElement).value).toBe("Nguyễn Đức Huy Hoàng");
    expect((screen.getByLabelText("Ngày tháng năm sinh học viên") as HTMLInputElement).value).toBe("2015-03-09");
    expect((screen.getByLabelText("Số CCCD của học viên") as HTMLInputElement).value).toBe("048215001234");
    expect((screen.getByLabelText("SĐT của ba/mẹ") as HTMLInputElement).value).toBe("0905123456"); // ĐƠN thắng hồ sơ
    expect((screen.getByLabelText("Số CCCD của ba/mẹ") as HTMLInputElement).value).toBe("048183006790");
    expect((screen.getByLabelText("Email của ba/mẹ") as HTMLInputElement).value).toBe("ketoan.abc@example.com");
    // Hồ sơ ghi SĐT khác ⇒ nhắc, và bấm là lấy giá trị hồ sơ.
    expect(screen.getByText("0905999888")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dùng giá trị hồ sơ" }));
    expect((screen.getByLabelText("SĐT của ba/mẹ") as HTMLInputElement).value).toBe("0905999888");
  });

  it("'Xuất cho công ty' vẫn còn (tên đơn vị + MST) và cảnh báo thiếu MST khi có tên đơn vị", () => {
    ve(true);
    fireEvent.click(screen.getByRole("button", { name: /Sửa/ }));
    expect((screen.getByLabelText("Tên đơn vị") as HTMLInputElement).value).toBe("Công ty ABC");
    expect((screen.getByLabelText("Mã số thuế") as HTMLInputElement).value).toBe("0401234567");
    fireEvent.change(screen.getByLabelText("Mã số thuế"), { target: { value: "" } });
    expect(screen.getByText(/bắt buộc có mã số thuế/)).toBeTruthy();
  });

  it("có xem PII nhưng không có orders:manage ⇒ không nút Sửa", () => {
    ve(true, false);
    expect(screen.queryByRole("button", { name: /Sửa/ })).toBeNull();
  });
});

describe("[TTHD-UI-04] lệnh mở hộp thoại từ khối «Thông tin người mua qua mã QR» (nút «Nhập thay phụ huynh»)", () => {
  const dung = (xemPii: boolean, canManage: boolean, lenhMo?: number) => (
    <ThongTinHoaDon
      orderId="don1"
      khoi={khoiNguoiMuaHoaDon(DON, xemPii, { hieuLuc: hieuLuc(DON, HO_SO), hoSo: HO_SO, noiGhi: "HOC_VIEN" })}
      updatedAt="2026-11-01T02:00:00.000Z"
      canManage={canManage}
      lenhMo={lenhMo}
    />
  );
  it("bộ đếm TĂNG ⇒ mở đúng hộp thoại «Người mua trên hoá đơn» (ô điền sẵn như bấm «Sửa»); tăng lần nữa sau khi đóng ⇒ mở lại; render lại vì lý do khác KHÔNG mở", () => {
    const { rerender } = render(dung(true, true, 0));
    expect(screen.queryByRole("dialog")).toBeNull(); // mount với 0 ⇒ KHÔNG tự mở
    rerender(dung(true, true, 0));
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(dung(true, true, 1));
    expect(screen.getByRole("dialog").textContent).toMatch(/Thông tin người mua trên hoá đơn/);
    expect((screen.getByLabelText("Họ và tên học viên") as HTMLInputElement).value).toBe("Nguyễn Đức Huy Hoàng");
    fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(dung(true, true, 1)); // cùng số ⇒ không mở lại
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(dung(true, true, 2));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
  it("đối chứng ÂM: thiếu quyền sửa (orders:manage) hoặc thiếu orders:view-pii ⇒ lệnh KHÔNG mở được gì (nút phía khối QR cũng không được vẽ)", () => {
    for (const [pii, quanLy] of [[true, false], [false, true], [false, false]] as const) {
      const { rerender, unmount } = render(dung(pii, quanLy, 0));
      rerender(dung(pii, quanLy, 1));
      expect(screen.queryByRole("dialog"), `pii=${pii} quanLy=${quanLy}`).toBeNull();
      unmount();
    }
  });
  it("không truyền `lenhMo` ⇒ hành vi cũ: không tự mở, nút «Sửa» vẫn mở như trước", () => {
    render(dung(true, true));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Sửa/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("[TTHD-UI-03] view-model (thuần)", () => {
  const tu = { hieuLuc: hieuLuc(DON, HO_SO), hoSo: HO_SO, noiGhi: "HOC_VIEN" as const };

  it("thiếu quyền ⇒ giaTriSua null; có quyền ⇒ giá trị thật; thieu/daKhai giống nhau ở hai bên", () => {
    const an = khoiNguoiMuaHoaDon(DON, false, tu);
    const hien = khoiNguoiMuaHoaDon(DON, true, tu);
    expect(an.giaTriSua).toBeNull();
    expect(hien.giaTriSua?.form).toMatchObject({ donViMst: "0401234567", phuHuynhEmail: "ketoan.abc@example.com", hocVienCccd: "048215001234" });
    expect(hien.giaTriSua?.hoSo).toEqual(HO_SO);
    expect(an.thieu).toEqual(hien.thieu);
    expect(an.daKhai).toBe(hien.daKhai);
    expect(JSON.stringify(an)).not.toMatch(/0401234567|048183006790|048215001234|2015-03-09|60 Đồng Du|ketoan\.abc@|hong\.phan@|0905123456|0905999888/);
  });

  it("ô trống ⇒ null ở cả hai bên (không in 'Đã ẩn' cho thứ không có)", () => {
    const trong = { ...DON, invoiceTaxCode: null, customerCccd: null, customerAddress: null, customerWard: null, customerCity: null };
    const k = khoiNguoiMuaHoaDon(trong, false, { hieuLuc: hieuLuc(trong, FORM_TRONG), hoSo: FORM_TRONG, noiGhi: "KHONG" });
    expect([k.maSoThue, k.cccd, k.diaChi]).toEqual([null, null, null]);
    expect(k.o.find((x) => x.khoa === "diaChi")?.giaTri).toBeNull();
    expect(k.o.find((x) => x.khoa === "hocVienNgaySinh")?.giaTri).toBeNull();
  });

  it("đếm ô theo hồ sơ: khối địa chỉ tính MỘT mục dù gồm ba ô", () => {
    const trong = { ...DON, customerAddress: null, customerWard: null, customerCity: null };
    const hs = { ...FORM_TRONG, tinh: "Đà Nẵng", phuong: "Hải Châu", diaChi: "60 Đồng Du" };
    const k = khoiNguoiMuaHoaDon(trong, true, { hieuLuc: hieuLuc(trong, hs), hoSo: hs, noiGhi: "HOC_VIEN" });
    expect(k.soODangTheoHoSo).toBe(1);
  });
});

describe("[TTHD-W1] lưới ghim dây nối ở trang đơn (RSC — không ca hành vi nào chạm được)", () => {
  // Trước bản vá: khối nhận `don={{…order}}` — bản `order` đã che một phần (MST còn nguyên) và form khởi tạo
  // bằng chính nó. Nay trang dựng view-model từ đơn THẬT theo đúng quyền của người xem, kèm hồ sơ điền sẵn.
  it("trang gọi khoiNguoiMuaHoaDon(order, canViewPii, …) đúng MỘT lần, đọc hồ sơ TRONG lô (không thêm await); nhánh che của `order` che cả ba cột mới", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(process.cwd(), "app/(admin)/admin/orders/[id]/page.tsx"), "utf8");
    expect(src.match(/khoiNguoiMua=\{khoiNguoiMuaHoaDon\(order, canViewPii, tuHoSoNguoiMua\)\}/g)).toHaveLength(1);
    expect(src.match(/docHieuLucNguoiMuaTuDb\(order\),/g)).toHaveLength(1);
    expect(src.match(/invoiceTaxCode: order\.invoiceTaxCode \? maskPhone\(order\.invoiceTaxCode\) : order\.invoiceTaxCode,/g)).toHaveLength(1);
    expect(src.match(/invoiceStudentCccd: null,/g)).toHaveLength(1);
    expect(src.match(/invoiceStudentDob: null,/g)).toHaveLength(1);
    expect(src.match(/invoiceParentPhone: order\.invoiceParentPhone \? maskPhone\(order\.invoiceParentPhone\)/g)).toHaveLength(1);
  });
});
