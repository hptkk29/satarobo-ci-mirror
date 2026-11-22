// @vitest-environment jsdom
/**
 * [GOC-FLOAT-*] Nút nổi «Góc gia đình» (DISC · Tủ sách · Sức khỏe) — thay viên thuốc «Khám phá DISC» + nút Messenger cũ (10/11/2026).
 * Luật: nhãn/đích từ nguồn chung, cờ TẮT thì vắng (đối chứng dương: Zalo còn), không che Zalo/học thử, ẩn ở /disc,
 * bảng và khung chat không mở cùng lúc.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

let path = "/";
vi.mock("next/navigation", () => ({ usePathname: () => path }));
import { FloatingCta } from "./floating-cta";

const DU_CHATBOT = { coSo: [{ code: "CS1", name: "Cơ sở 1", address: "211 Nguyễn Hữu Thọ" }], khoaQuanTam: ["Sata3"] };
const TAT_CA = { tuSach: true, sucKhoe: true };
const KHONG = { tuSach: false, sucKhoe: false };

beforeEach(() => {
  path = "/";
  window.sessionStorage.clear();
});
afterEach(() => cleanup());

const nutGoc = () => screen.getByTestId("goc-floating");

describe("[GOC-FLOAT-01] cờ BẬT: một nút «Góc gia đình», bấm ra bảng 3 lối vào", () => {
  it("chưa bấm: có nút với nhãn đúng, CHƯA có bảng; Zalo + học thử + gọi vẫn còn", () => {
    render(<FloatingCta discEnabled congThongTin={TAT_CA} chatbot={DU_CHATBOT} />);
    expect(nutGoc().textContent).toContain("Góc gia đình");
    expect(nutGoc().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("goc-floating-panel")).toBeNull();
    expect(screen.getByRole("link", { name: /chat zalo/i })).toBeTruthy();
    // Thanh đáy điện thoại (giao diện public mới) có CTA học thử.
    expect(screen.getByText(/đặt học thử miễn phí/i)).toBeTruthy();
    // Nút gọi NỔI mang số điện thoại trong nhãn; «Gọi ngay» là của thanh đáy điện thoại.
    expect(screen.getByRole("link", { name: /^Gọi \d/ })).toBeTruthy();
  });
  it("bấm: bảng hiện đủ DISC → Tủ sách → Sức khỏe, đúng đích; nhãn DISC không 'miễn phí'", () => {
    render(<FloatingCta discEnabled congThongTin={TAT_CA} chatbot={DU_CHATBOT} />);
    fireEvent.click(nutGoc());
    expect(nutGoc().getAttribute("aria-expanded")).toBe("true");
    const bang = screen.getByTestId("goc-floating-panel");
    const lienKet = within(bang).getAllByRole("link");
    expect(lienKet.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Khám phá DISC", "/disc"],
      ["Tủ sách", "/tu-sach"],
      ["Sức khỏe", "/suc-khoe"],
    ]);
    expect(lienKet[0]!.textContent).not.toMatch(/miễn phí/i);
  });
  it("Messenger ĐÃ GỠ: không còn liên kết m.me / nhãn Messenger nào", () => {
    const { container } = render(<FloatingCta discEnabled congThongTin={TAT_CA} chatbot={DU_CHATBOT} />);
    expect(container.querySelector('a[href*="m.me"]')).toBeNull();
    expect(screen.queryByLabelText(/messenger/i)).toBeNull();
  });
  it("nút «Góc gia đình» đứng TRÊN CÙNG ngăn xếp, trước Zalo (không đè hai nút cũ)", () => {
    render(<FloatingCta discEnabled congThongTin={TAT_CA} chatbot={DU_CHATBOT} />);
    const zalo = screen.getByRole("link", { name: /chat zalo/i });
    expect(nutGoc().compareDocumentPosition(zalo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("[GOC-FLOAT-02] mỗi cờ chỉ thêm mục CỦA NÓ", () => {
  it("DISC tắt, hai cổng bật ⇒ bảng chỉ có Tủ sách + Sức khỏe", () => {
    render(<FloatingCta discEnabled={false} congThongTin={TAT_CA} chatbot={DU_CHATBOT} />);
    fireEvent.click(nutGoc());
    const nhan = within(screen.getByTestId("goc-floating-panel")).getAllByRole("link").map((a) => a.textContent);
    expect(nhan).toEqual(["Tủ sách", "Sức khỏe"]);
    expect(screen.queryByText("Khám phá DISC")).toBeNull();
  });
  it("đúng MỘT mục bật ⇒ viên thuốc liên kết THẲNG tới mục đó, không có bảng và không có nút bấm-mở", () => {
    render(<FloatingCta discEnabled={false} congThongTin={{ tuSach: false, sucKhoe: true }} chatbot={DU_CHATBOT} />);
    const v = nutGoc();
    expect(v.tagName).toBe("A");
    expect(v.getAttribute("href")).toBe("/suc-khoe");
    expect(v.textContent).toContain("Sức khỏe");
    expect(screen.queryByTestId("goc-floating-panel")).toBeNull();
  });
  it("cả ba TẮT ⇒ KHÔNG có nút nào (đối chứng dương: Zalo vẫn còn ở các ca trên và ở đây)", () => {
    render(<FloatingCta discEnabled={false} congThongTin={KHONG} chatbot={DU_CHATBOT} />);
    expect(screen.queryByTestId("goc-floating")).toBeNull();
    expect(screen.getByRole("link", { name: /chat zalo/i })).toBeTruthy();
  });
});

describe("[GOC-FLOAT-03] ẩn / đánh dấu theo trang", () => {
  it("ở /disc: không hiện nút nào (trang làm bài cần toàn màn hình)", () => {
    path = "/disc";
    const { container } = render(<FloatingCta discEnabled congThongTin={TAT_CA} chatbot={DU_CHATBOT} />);
    expect(container.innerHTML).toBe("");
  });
  it("ở /tu-sach: nút VẪN hiện, và mục Tủ sách trong bảng được đánh dấu đang đứng (đối chứng: các mục khác thì không)", () => {
    path = "/tu-sach";
    render(<FloatingCta discEnabled congThongTin={TAT_CA} chatbot={DU_CHATBOT} />);
    fireEvent.click(nutGoc());
    const bang = screen.getByTestId("goc-floating-panel");
    expect(within(bang).getByTestId("goc-floating-tu-sach").getAttribute("aria-current")).toBe("page");
    expect(within(bang).getByTestId("goc-floating-suc-khoe").getAttribute("aria-current")).toBeNull();
    expect(within(bang).getByTestId("goc-floating-disc").getAttribute("aria-current")).toBeNull();
  });
});

describe("[GOC-FLOAT-04] đóng bảng", () => {
  it("Esc đóng", () => {
    render(<FloatingCta discEnabled congThongTin={TAT_CA} chatbot={DU_CHATBOT} />);
    fireEvent.click(nutGoc());
    expect(screen.getByTestId("goc-floating-panel")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("goc-floating-panel")).toBeNull();
  });
  it("bấm ra ngoài đóng; bấm TRONG bảng thì không", () => {
    render(<FloatingCta discEnabled congThongTin={TAT_CA} chatbot={DU_CHATBOT} />);
    fireEvent.click(nutGoc());
    fireEvent.pointerDown(screen.getByTestId("goc-floating-panel"));
    expect(screen.getByTestId("goc-floating-panel")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("goc-floating-panel")).toBeNull();
  });
  it("đổi trang thì đóng", () => {
    const { rerender } = render(<FloatingCta discEnabled congThongTin={TAT_CA} chatbot={DU_CHATBOT} />);
    fireEvent.click(nutGoc());
    expect(screen.getByTestId("goc-floating-panel")).toBeTruthy();
    path = "/suc-khoe";
    rerender(<FloatingCta discEnabled congThongTin={TAT_CA} chatbot={DU_CHATBOT} />);
    expect(screen.queryByTestId("goc-floating-panel")).toBeNull();
  });
});

describe("[GOC-FLOAT-05] bảng và khung chat không mở cùng lúc", () => {
  it("mở khung chat khi bảng đang mở ⇒ bảng đóng; mở bảng khi chat đang mở ⇒ chat đóng", async () => {
    window.sessionStorage.setItem("satarobo-chatbot-bat", "1"); // chatbot đang chạy (useChatbotBat đọc phiên)
    render(<FloatingCta discEnabled congThongTin={TAT_CA} chatbot={DU_CHATBOT} />);
    const chat = await screen.findByTestId("chatbot-mo");
    fireEvent.click(nutGoc());
    expect(screen.getByTestId("goc-floating-panel")).toBeTruthy();
    fireEvent.click(chat);
    expect(chat.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByTestId("goc-floating-panel")).toBeNull();
    fireEvent.click(nutGoc());
    expect(screen.getByTestId("goc-floating-panel")).toBeTruthy();
    expect(chat.getAttribute("aria-expanded")).toBe("false");
  });
});
