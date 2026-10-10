// @vitest-environment jsdom
/**
 * [KM-TEP] Ô chọn tệp văn bản gốc (lỗi trên test.satarobo.vn 26/09/2026: "chồng trang, cuộn hai lần").
 *
 * Bản đầu ẩn ô `<input type="file">` bằng `sr-only` = position:absolute. Khung admin không có tổ
 * tiên `relative` nào trong <main> (vùng cuộn), nên ô đó lấy khối chứa ở NGOÀI vùng cuộn, đứng ở
 * vị trí tĩnh cuối form và kéo dài cả trang: đo trên bản build, trang dài thêm 289px ở 1280px và
 * 797px ở 375px ⇒ thanh cuộn thứ hai, khung admin trôi lên mất đầu trang.
 *
 * jsdom không dàn trang nên KHÔNG đo được chiều cao — ca 01 khoá đúng nguyên nhân (ô không được là
 * phần tử absolute), ca 02 khoá rằng ẩn hẳn không làm mất đường chọn tệp (nút vẫn mở ô).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { TepVanBan } from "./tep-van-ban";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function oChonTep(container: HTMLElement): HTMLInputElement {
  const o = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!o) throw new Error("không thấy ô chọn tệp");
  return o;
}

describe("[KM-TEP] ô chọn tệp văn bản gốc", () => {
  it("[KM-TEP-01] ô ẩn bằng display:none, KHÔNG bằng sr-only (absolute thoát vùng cuộn)", () => {
    const { container } = render(<TepVanBan value={null} onChange={() => {}} />);
    const o = oChonTep(container);
    expect(o.classList.contains("hidden")).toBe(true);
    expect(o.classList.contains("sr-only")).toBe(false);
    expect(o.className).not.toMatch(/\babsolute\b/);
  });

  it("[KM-TEP-02] bấm nút ⇒ mở ô chọn tệp (ẩn hẳn không mất đường chọn tệp)", () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const { container } = render(<TepVanBan value={null} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Chọn tệp văn bản gốc/ }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(click.mock.contexts[0]).toBe(oChonTep(container));
  });
});
