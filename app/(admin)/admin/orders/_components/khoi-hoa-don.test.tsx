// @vitest-environment jsdom
/**
 * Ca [KHD-UI-*] — khối "Hoá đơn điện tử" trên trang chi tiết đơn (GĐ 7, docs/ke-toan-hoa-don/PLAN.md §8).
 *
 * Canh HÀNH VI trên phần tử thật: nút tải là thẻ `<a>` trỏ đúng route (không có thì KHÔNG có phần tử —
 * luật 12), dòng "khách không có email" nằm cùng mục với nút tải, và khối mang neo `#hoa-don` mà thông
 * báo "hoá đơn chưa gửi được" trỏ tới.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { DongHoaDonDon, KhoiHoaDonDon } from "@/lib/finance/hoa-don/khoi-hoa-don-don";
import { KhoiHoaDon } from "./khoi-hoa-don";

const dong = (o: Partial<DongHoaDonDon> = {}): DongHoaDonDon => ({
  key: "dot:dot1",
  trangThai: "DA_XUAT",
  ngayThuLabel: "10/09/2026",
  soTien: 3_000_000,
  nguonLabel: "Chuyển khoản · FT1",
  nhanDot: "Đợt 1/2",
  nhan: "Đã xuất hoá đơn",
  tone: "success",
  soHoaDon: "1C26TSR · số 123",
  ngayPhatHanhLabel: "11/09/2026",
  taiPdf: "/payments/hoa-don/hd1/tai-ve?loai=pdf",
  taiXml: "/payments/hoa-don/hd1/tai-ve?loai=xml",
  lyDoKhongTai: null,
  email: { loai: "KHONG_CO_EMAIL", nhan: "Khách không có email — tải về gửi qua Zalo", tone: "warning", chiTiet: null },
  lyDoKhongXuat: null,
  huyTruoc: null,
  ...o,
});

const khoi = (o: Partial<KhoiHoaDonDon> = {}): KhoiHoaDonDon => ({ dong: [dong()], thieuCoSo: 0, lichSu: 0, ...o });

describe("[KHD-UI-01] nút tải là liên kết THẬT tới route — hoặc không có gì", () => {
  it("đã xuất + tải được ⇒ hai liên kết trỏ đúng route, mở tab mới", () => {
    render(<KhoiHoaDon khoi={khoi()} />);
    const pdf = screen.getByRole("link", { name: "Tải PDF hoá đơn 1C26TSR · số 123" });
    expect(pdf.getAttribute("href")).toBe("/payments/hoa-don/hd1/tai-ve?loai=pdf");
    expect(pdf.getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("link", { name: "Tải XML hoá đơn 1C26TSR · số 123" }).getAttribute("href")).toBe(
      "/payments/hoa-don/hd1/tai-ve?loai=xml",
    );
  });

  it("route không cho ⇒ KHÔNG có liên kết nào, và lý do được in ra", () => {
    render(
      <KhoiHoaDon
        khoi={khoi({
          dong: [dong({ taiPdf: null, taiXml: null, lyDoKhongTai: "Cần quyền xem thông tin khách để tải hoá đơn — nhờ kế toán gửi" })],
        })}
      />,
    );
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText(/Cần quyền xem thông tin khách/)).toBeTruthy();
  });

  it("khách không có email ⇒ lời dặn gửi Zalo nằm TRONG CÙNG mục với nút tải", () => {
    render(<KhoiHoaDon khoi={khoi()} />);
    const muc = screen.getByText("Khách không có email — tải về gửi qua Zalo").closest("li")!;
    expect(within(muc).getByRole("link", { name: /Tải PDF/ })).toBeTruthy();
  });
});

describe("[KHD-UI-02] khung khối", () => {
  it("neo `#hoa-don` (thông báo trỏ tới) + tiêu đề đặt tên cho vùng", () => {
    const { container } = render(<KhoiHoaDon khoi={khoi()} />);
    expect(container.querySelector("section#hoa-don")).not.toBeNull();
    expect(screen.getByRole("region", { name: "Hoá đơn điện tử" })).toBeTruthy();
  });

  it("tóm tắt đếm lần thu ĐÃ có hoá đơn (kể cả xuất ngoài hệ thống) trên lần thu CẦN hoá đơn (bỏ 'không xuất')", () => {
    render(
      <KhoiHoaDon
        khoi={khoi({
          dong: [
            dong({ key: "a" }),
            dong({ key: "b", trangThai: "CHO", nhan: "Chờ kế toán xuất hoá đơn", taiPdf: null, taiXml: null, email: null }),
            dong({ key: "c", trangThai: "KHONG_XUAT", nhan: "Không xuất hoá đơn", taiPdf: null, taiXml: null, email: null }),
            dong({ key: "d", trangThai: "DA_XUAT_NGOAI", nhan: "Đã xuất hoá đơn ngoài hệ thống", taiPdf: null, taiXml: null, email: null }),
          ],
        })}
      />,
    );
    expect(screen.getByText("2/3 lần thu đã có hoá đơn")).toBeTruthy();
  });

  it("chưa có lần thu nào ⇒ nói cách hoá đơn được xuất, không để khối trống", () => {
    render(<KhoiHoaDon khoi={khoi({ dong: [] })} />);
    expect(screen.getByText(/Hoá đơn được xuất theo từng lần thu/)).toBeTruthy();
  });

  it("[KHD-UI-03] đơn chỉ có tiền thu TRƯỚC khi lên hệ thống ⇒ nói ra, KHÔNG nói 'chưa có khoản thu'", () => {
    render(<KhoiHoaDon khoi={khoi({ dong: [], lichSu: 3 })} />);
    expect(screen.getByText(/3 khoản thu từ trước khi lên hệ thống/)).toBeTruthy();
    expect(screen.queryByText(/Chưa có khoản thu nào/)).toBeNull();
  });

  it("[KHD-UI-04] URL mang `#hoa-don` (thông báo trỏ tới) ⇒ khối tự cuộn vào khi đã gắn; không có neo thì đứng yên", () => {
    // Điều hướng trong app đi qua `loading.tsx`: trình duyệt nhận neo lúc khối CHƯA có nên không cuộn.
    const cuon = vi.fn();
    const goc = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = cuon;
    try {
      window.history.replaceState(null, "", "/orders/don1#hoa-don");
      const { unmount } = render(<KhoiHoaDon khoi={khoi()} />);
      expect(cuon).toHaveBeenCalledTimes(1);
      expect((cuon.mock.contexts[0] as Element).id).toBe("hoa-don");
      unmount();

      cuon.mockClear();
      window.history.replaceState(null, "", "/orders/don1");
      render(<KhoiHoaDon khoi={khoi()} />);
      expect(cuon).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = goc;
      window.history.replaceState(null, "", "/");
    }
  });

  it("đơn chưa gắn cơ sở ⇒ nói ra số khoản bị kẹt", () => {
    render(<KhoiHoaDon khoi={khoi({ dong: [], thieuCoSo: 2 })} />);
    expect(screen.getByText(/2 khoản thu chưa lên hoá đơn được/)).toBeTruthy();
    expect(screen.queryByText(/Hoá đơn được xuất theo từng lần thu/)).toBeNull();
  });
});
