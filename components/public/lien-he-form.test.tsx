// @vitest-environment jsdom
/**
 * [PUB-LH-*] Biểu mẫu đặt học thử DÙNG CHUNG (trang /lien-he · trang chủ · popup) — giao diện mới của
 * artifact nhưng HÀNH VI GỬI không đổi: lỗi từng ô, ô đồng ý Chính sách bảo mật chặn gửi, honeypot,
 * payload `/api/leads` đủ trường (centerCode, consentMarketing, dongYChinhSachBaoMat, source…).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("next/link", () => ({
  default: (p: { href: string; children: React.ReactNode }) => <a href={p.href}>{p.children}</a>,
}));

import { LienHeForm } from "./lien-he-form";

const fetchMock = vi.fn();

beforeEach(() => {
  // jsdom không có scrollIntoView / matchMedia — form cuộn tới ô lỗi đầu tiên.
  Element.prototype.scrollIntoView = vi.fn();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const gui = () => fireEvent.click(screen.getByRole("button", { name: /ĐẶT BUỔI HỌC THỬ 1-1 MIỄN PHÍ/ }));
const dien = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("LienHeForm — kiểm tra từng ô", () => {
  it("[PUB-LH-01] gửi form rỗng: báo lỗi tên con · SĐT · ô đồng ý, KHÔNG gọi API", async () => {
    render(<LienHeForm variant="page" />);
    gui();
    expect(await screen.findByText("Vui lòng nhập họ và tên con.")).toBeTruthy();
    expect(screen.getByText("Vui lòng đọc và đồng ý với Chính sách bảo mật.")).toBeTruthy();
    expect(screen.getAllByRole("alert").length).toBe(2); // tên con + SĐT (ô đồng ý có dòng lỗi riêng của OTichChinhSach)
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("[PUB-LH-02] đủ ô nhưng CHƯA tích đồng ý Chính sách bảo mật ⇒ vẫn không gửi (đối chứng của PUB-LH-03)", async () => {
    render(<LienHeForm variant="page" />);
    dien(/Họ và tên con/, "Nguyễn Minh Khoa");
    dien(/ĐT di động phụ huynh/, "0905 123 456");
    gui();
    expect(await screen.findByText("Vui lòng đọc và đồng ý với Chính sách bảo mật.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("LienHeForm — gửi lead", () => {
  it("[PUB-LH-03] hợp lệ: POST /api/leads đủ trường, SĐT chuẩn hoá, mã cơ sở, đồng ý; trang hiện lời cảm ơn", async () => {
    const onSuccess = vi.fn();
    render(<LienHeForm variant="page" onSuccess={onSuccess} />);
    dien(/Họ và tên con/, "Nguyễn Minh Khoa");
    dien(/ĐT di động phụ huynh/, "0905 123 456");
    fireEvent.click(screen.getByRole("checkbox"));
    gui();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe("/api/leads");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      childName: "Nguyễn Minh Khoa",
      parentName: "PH của Nguyễn Minh Khoa",
      phone: "84905123456", // canonicalPhone: dạng quốc tế không dấu +
      source: "lien-he",
      centerCode: "CS1",
      website: "",
      consentMarketing: true,
      dongYChinhSachBaoMat: true,
    });
    expect(String(body.note)).toContain("Cơ sở: Cơ sở 1");
    // popup/home luôn là "đặt học thử"; trang /lien-he chỉ khi ?free-trial=true ⇒ ở đây KHÔNG có dòng này.
    expect(String(body.note)).not.toContain("buổi học thử 1-1 miễn phí");

    expect(await screen.findByText("Cảm ơn ba mẹ!")).toBeTruthy();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("[PUB-LH-04] popup/home ghi 'Đăng ký buổi học thử 1-1 miễn phí' vào ghi chú", async () => {
    render(<LienHeForm variant="popup" />);
    dien(/Họ và tên con/, "Trần An");
    dien(/ĐT di động phụ huynh/, "0905123456");
    fireEvent.click(screen.getByRole("checkbox"));
    gui();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const init = fetchMock.mock.calls[0]?.[1] as { body: string };
    expect(String((JSON.parse(init.body) as { note: string }).note)).toContain(
      "Đăng ký buổi học thử 1-1 miễn phí",
    );
  });

  it("[PUB-LH-05] máy chủ từ chối ⇒ KHÔNG hiện lời cảm ơn, không gọi onSuccess", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ ok: false, error: "Quá nhiều lượt" }) });
    const onSuccess = vi.fn();
    render(<LienHeForm variant="page" onSuccess={onSuccess} />);
    dien(/Họ và tên con/, "Nguyễn Minh Khoa");
    dien(/ĐT di động phụ huynh/, "0905123456");
    fireEvent.click(screen.getByRole("checkbox"));
    gui();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: /ĐẶT BUỔI HỌC THỬ/ })).toBeTruthy());
    expect(screen.queryByText("Cảm ơn ba mẹ!")).toBeNull();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

describe("LienHeForm — biến thể", () => {
  it("[PUB-LH-06] popup chỉ có 3 ô + ô đồng ý (không có 'Thêm thông tin'); id tiền tố p-; trang có tiền tố f-", () => {
    const { container, unmount } = render(<LienHeForm variant="popup" />);
    expect(container.querySelector("#p-con")).not.toBeNull();
    expect(container.querySelector("#p-cs")).not.toBeNull();
    expect(container.querySelector("#p-ph")).toBeNull();
    expect(screen.queryByText(/Thêm thông tin để xếp lớp nhanh hơn/)).toBeNull();
    unmount();

    const trang = render(<LienHeForm variant="page" />);
    expect(trang.container.querySelector("#f-con")).not.toBeNull();
    expect(trang.container.querySelector("#f-ph")).not.toBeNull();
    expect(trang.container.querySelector("section#dang-ky")).not.toBeNull();
  });

  it("[PUB-LH-07] trang chủ: neo #lien-he; trang Liên hệ: neo #dang-ky", () => {
    const home = render(<LienHeForm variant="home" />);
    expect(home.container.querySelector("section#lien-he")).not.toBeNull();
    expect(home.container.querySelector("section#dang-ky")).toBeNull();
  });
});
