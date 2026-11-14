// @vitest-environment jsdom
/**
 * [PTS-UI-*] «Tủ sách gia đình» ở CỔNG PHỤ HUYNH (dựng THẬT: giao diện sinh từ artifact + view-model; fetch được giả).
 *   [PTS-UI-01] dựng được: 20 ebook, 6 chủ đề + «Tất cả», sách giáo khoa theo lớp; tab «Lớp của <con>» mở đúng lớp con khai; mỗi cuốn SGK trỏ ĐÚNG địa chỉ cuốn đó
 *   [PTS-UI-02] hồ sơ ĐÃ có phường/xã: không hiện ô hỏi; «Tải» xin link ở API cổng phụ huynh rồi chuyển tới link
 *   [PTS-UI-03] hồ sơ CHƯA có phường/xã: hiện ô hỏi; «Tải» KHÔNG gọi API tải, báo bằng lời; chọn + lưu ⇒ POST rồi tải được; lưu lỗi ⇒ báo lỗi, vẫn chưa tải được
 *   [PTS-UI-04] lỗi tải: chưa có tệp / mạng đứt ⇒ báo bằng lời, không điều hướng; server nói chưa đủ điều kiện ⇒ ô hỏi hiện lại
 *   [PTS-CSS] `cssSangObject` chuyển chuỗi CSS của thiết kế sang object style của React
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EBOOKS } from "@/lib/tu-sach/ebook";
import { SGK } from "@/lib/tu-sach/sgk";
import { TuSachCong } from "./tu-sach-cong";
import { cssSangObject } from "./vm";

const PHUONG = ["Phường Hải Châu", "Phường Sơn Trà", "Xã Bà Nà"];
let fetchMock: ReturnType<typeof vi.fn>;
let assign: ReturnType<typeof vi.fn>;

const dung = (o: { coPhuong?: boolean; lop?: { ten: string; lop: number }[] } = {}) =>
  render(<TuSachCong coPhuongBanDau={o.coPhuong ?? true} lopCuaCon={o.lop ?? []} phuongDs={PHUONG} />);
const goiTai = () => fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("/api/portal/tu-sach/tai"));
const goiLuu = () => fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("/api/portal/tu-sach/phuong"));

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).startsWith("/api/portal/tu-sach/tai")) return { ok: true, json: async () => ({ ok: true, url: "https://r2.example/sach.pdf?sig=1" }) } as Response;
    return { ok: true, json: async () => ({ ok: true }) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  assign = vi.fn();
  Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("[PTS-UI-01] dựng cả màn", () => {
  it("20 ebook, bộ lọc chủ đề, sách giáo khoa đúng lớp, liên kết đúng cuốn", () => {
    dung({ lop: [{ ten: "Bé An", lop: 3 }, { ten: "Bé Na", lop: 7 }] });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Tủ sách gia đình/);
    expect(screen.getAllByRole("button", { name: /^Tải / })).toHaveLength(EBOOKS.length);
    expect(screen.getAllByRole("tab").length).toBeGreaterThanOrEqual(7 + 12); // 7 bộ lọc + 12 lớp
    // mở đúng lớp của con đầu tiên (lớp 3)
    const lop3 = SGK.filter((s) => s.lop === 3);
    const lienKet = screen.getAllByRole("link", { name: /trang NXB Giáo dục/ });
    expect(lienKet).toHaveLength(lop3.length);
    expect(lienKet.map((a) => a.getAttribute("href"))).toEqual(lop3.map((s) => s.url));
    expect(lienKet.every((a) => a.getAttribute("target") === "_blank" && /noopener/.test(a.getAttribute("rel") ?? ""))).toBe(true);
    // đổi sang lớp của con thứ hai
    fireEvent.click(screen.getByRole("button", { name: /Lớp của Bé Na \(lớp 7\)/ }));
    expect(screen.getAllByRole("link", { name: /trang NXB Giáo dục/ })).toHaveLength(SGK.filter((s) => s.lop === 7).length);
  });
  it("lọc theo chủ đề rồi quay lại «Tất cả»", () => {
    dung();
    const n = EBOOKS.filter((e) => e.chuDe === "Gia đình").length;
    fireEvent.click(screen.getByRole("tab", { name: "Gia đình" }));
    expect(screen.getAllByRole("button", { name: /^Tải / })).toHaveLength(n);
    fireEvent.click(screen.getByRole("tab", { name: "Tất cả" }));
    expect(screen.getAllByRole("button", { name: /^Tải / })).toHaveLength(EBOOKS.length);
  });
});

describe("[PTS-UI-02] hồ sơ đã có phường/xã", () => {
  it("không hiện ô hỏi; «Tải» xin link ở API cổng phụ huynh rồi chuyển tới link", async () => {
    dung({ coPhuong: true });
    expect(screen.queryByText(/Hồ sơ còn thiếu phường\/xã/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: `Tải ${EBOOKS[6]!.tieuDe}` }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://r2.example/sach.pdf?sig=1"));
    expect(goiTai()[0]![0]).toBe(`/api/portal/tu-sach/tai/${EBOOKS[6]!.so}`);
  });
});

describe("[PTS-UI-03] hồ sơ chưa có phường/xã", () => {
  it("hiện ô hỏi; «Tải» không gọi API, báo bằng lời; chọn + lưu ⇒ tải được", async () => {
    dung({ coPhuong: false });
    expect(screen.getByText(/Hồ sơ còn thiếu phường\/xã/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: `Tải ${EBOOKS[0]!.tieuDe}` }));
    expect(goiTai()).toHaveLength(0);
    expect(screen.getByRole("status").textContent).toMatch(/Chọn phường\/xã/);
    // bấm Lưu khi chưa chọn
    fireEvent.click(screen.getByRole("button", { name: "Lưu vào hồ sơ" }));
    expect(goiLuu()).toHaveLength(0);
    // chọn rồi lưu
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Phường Hải Châu" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu vào hồ sơ" }));
    await waitFor(() => expect(goiLuu()).toHaveLength(1));
    expect(JSON.parse(String(goiLuu()[0]![1].body))).toEqual({ phuong: "Phường Hải Châu" }); // CHỈ phường — tên/SĐT lấy từ tài khoản ở máy chủ
    await waitFor(() => expect(screen.queryByText(/Hồ sơ còn thiếu phường\/xã/)).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: `Tải ${EBOOKS[0]!.tieuDe}` }));
    await waitFor(() => expect(assign).toHaveBeenCalled());
  });
  it("lưu lỗi ⇒ báo lỗi, ô hỏi vẫn còn", async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, json: async () => ({ ok: false, loi: "THIEU_THONG_TIN_TAI_KHOAN" }) }) as Response);
    dung({ coPhuong: false });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Phường Sơn Trà" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu vào hồ sơ" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Hồ sơ gia đình/));
    expect(screen.getByText(/Hồ sơ còn thiếu phường\/xã/)).toBeTruthy();
  });
});

describe("[PTS-UI-04] lỗi khi tải", () => {
  it("chưa có tệp ⇒ báo «đang được cập nhật», không điều hướng", async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, json: async () => ({ ok: false, loi: "CHUA_CO_TEP" }) }) as Response);
    dung();
    fireEvent.click(screen.getByRole("button", { name: `Tải ${EBOOKS[1]!.tieuDe}` }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/đang được cập nhật/));
    expect(assign).not.toHaveBeenCalled();
  });
  it("mạng đứt ⇒ báo bằng lời; máy chủ nói chưa đủ điều kiện ⇒ ô hỏi hiện lại", async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error("offline");
    });
    dung();
    fireEvent.click(screen.getByRole("button", { name: `Tải ${EBOOKS[1]!.tieuDe}` }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Mạng đang chập chờn/));
    cleanup();
    fetchMock.mockImplementation(async () => ({ ok: false, json: async () => ({ ok: false, loi: "CHUA_DE_LAI_THONG_TIN" }) }) as Response);
    dung({ coPhuong: true });
    expect(screen.queryByText(/Hồ sơ còn thiếu phường\/xã/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: `Tải ${EBOOKS[1]!.tieuDe}` }));
    await waitFor(() => expect(screen.getByText(/Hồ sơ còn thiếu phường\/xã/)).toBeTruthy());
    expect(within(document.body).queryAllByRole("status").length).toBeGreaterThan(0);
  });
});

describe("[PTS-CSS] cssSangObject", () => {
  it("kebab → camel, bỏ ô trống, giữ giá trị có dấu hai chấm/dấu phẩy", () => {
    expect(cssSangObject("flex: none; border-radius: 10px 14px; background: #620c8b; ;")).toEqual({ flex: "none", borderRadius: "10px 14px", background: "#620c8b" });
    expect(cssSangObject("font-family: 'Bitter', Georgia, serif; box-shadow: inset 6px 0 0 rgba(0,0,0,0.18)")).toEqual({ fontFamily: "'Bitter', Georgia, serif", boxShadow: "inset 6px 0 0 rgba(0,0,0,0.18)" });
  });
});
