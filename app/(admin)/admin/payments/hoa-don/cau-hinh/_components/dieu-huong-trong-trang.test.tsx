// [NAV-01..03] Liên kết «Trong trang này» chỉ cuộn khung nội dung chứa đích, KHÔNG gọi `scrollIntoView` (thủ phạm kéo cả tài liệu — xem đầu tệp nguồn).
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DieuHuongTrongTrang, cuonTrongKhung } from "./dieu-huong-trong-trang";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** Dựng: html > khung(overflow-y auto, đã cuộn được) > đích. jsdom không bố cục nên ép scrollHeight/clientHeight. */
function dung() {
  const khung = document.createElement("main");
  khung.style.overflowY = "auto";
  Object.defineProperty(khung, "scrollHeight", { value: 2000, configurable: true });
  Object.defineProperty(khung, "clientHeight", { value: 500, configurable: true });
  const dich = document.createElement("section");
  dich.id = "dich";
  khung.appendChild(dich);
  document.body.appendChild(khung);
  const scrollTo = vi.fn();
  (khung as unknown as { scrollTo: typeof scrollTo }).scrollTo = scrollTo;
  const scrollIntoView = vi.fn();
  (dich as unknown as { scrollIntoView: typeof scrollIntoView }).scrollIntoView = scrollIntoView;
  return { khung, dich, scrollTo, scrollIntoView };
}

describe("[NAV-01] cuonTrongKhung", () => {
  it("cuộn ĐÚNG khung có overflow-y và nội dung dài hơn khung; KHÔNG gọi scrollIntoView", () => {
    const { scrollTo, scrollIntoView } = dung();
    expect(cuonTrongKhung("dich")).toBe(true);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo.mock.calls[0]![0]).toMatchObject({ top: expect.any(Number) });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
  it("không có khung cuộn nào (trang vừa khít) ⇒ không cuộn gì và KHÔNG gọi scrollIntoView", () => {
    const dich = document.createElement("section");
    dich.id = "dich";
    const si = vi.fn();
    (dich as unknown as { scrollIntoView: typeof si }).scrollIntoView = si;
    document.body.appendChild(dich);
    expect(cuonTrongKhung("dich")).toBe(true);
    expect(si).not.toHaveBeenCalled();
  });
  it("không tìm thấy đích ⇒ false (để trình duyệt tự xử lý liên kết)", () => {
    expect(cuonTrongKhung("khong-co")).toBe(false);
  });
});

describe("[NAV-02] thanh liên kết", () => {
  it("bấm thường ⇒ preventDefault + cuộn khung; có href đúng để mở tab mới", () => {
    const { scrollTo } = dung();
    render(<DieuHuongTrongTrang muc={[{ id: "dich", nhan: "Tới đích" }]} />);
    const a = screen.getByRole("link", { name: "Tới đích" });
    expect(a.getAttribute("href")).toBe("#dich");
    const roiBo = fireEvent.click(a); // false = đã preventDefault
    expect(roiBo).toBe(false);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
  it("Ctrl/Cmd+bấm (mở tab mới) ⇒ KHÔNG chặn, KHÔNG cuộn", () => {
    const { scrollTo } = dung();
    render(<DieuHuongTrongTrang muc={[{ id: "dich", nhan: "Tới đích" }]} />);
    const a = screen.getByRole("link", { name: "Tới đích" });
    expect(fireEvent.click(a, { ctrlKey: true })).toBe(true);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
