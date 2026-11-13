// @vitest-environment jsdom
/**
 * [LCC-*] — lời chào cho tài khoản phụ huynh CHƯA liên kết học viên (05/11/2026): thay câu «chưa được liên kết…» (ngõ cụt chữ) bằng lời chào +
 * lối vào DISC. KHÔNG có nút «Đăng ký học thử» (chủ dự án: thông tin khách khai ở bài DISC đã về lead, đăng ký lại chỉ sinh phiếu trùng).
 *   [LCC-01] DISC mở: lời chào có tên, nút «Khám phá DISC» → /portal/disc
 *   [LCC-02] DISC đóng ⇒ KHÔNG có nút DISC (không để link chết) và cũng không có nút nào khác chỉ lối đi
 *   [LCC-03] KHÔNG có «Đăng ký học thử» ở cả hai trạng thái; hotline gọi được; không còn câu cũ «Vui lòng liên hệ trung tâm…»
 *   [LCC-04] dây nối layout: một thông báo duy nhất dựng bằng LoiChaoChuaCoCon; không đọc header host (hết cần URL tuyệt đối)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LoiChaoChuaCoCon } from "@/components/portal/loi-chao-chua-co-con";

afterEach(cleanup);

function dung(coQuaTang: boolean) {
  return render(<LoiChaoChuaCoCon ten="Nguyễn Thu Hà" coQuaTang={coQuaTang} hotline="0837.312.860" />);
}

describe("[LCC-01] DISC mở", () => {
  it("lời chào có tên + hai ô «Quà tặng» / «Khuyến mãi» đúng đích", () => {
    dung(true);
    expect(screen.getByRole("heading", { name: "Chào Nguyễn Thu Hà!" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Quà tặng/ }).getAttribute("href")).toBe("/portal/qua-tang");
    expect(screen.getByRole("link", { name: /Khuyến mãi/ }).getAttribute("href")).toBe("/portal/khuyen-mai");
  });
});

describe("[LCC-02] DISC đóng", () => {
  it("không có nút DISC; không có liên kết nào dẫn vào /portal", () => {
    dung(false);
    expect(screen.queryByRole("link", { name: /Quà tặng/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Khuyến mãi/ })).toBeNull();
    const dichPortal = screen.queryAllByRole("link").filter((a) => (a.getAttribute("href") ?? "").startsWith("/portal"));
    expect(dichPortal).toHaveLength(0);
    // đối chứng dương: vẫn là lời chào của đúng người
    expect(screen.getByRole("heading", { name: "Chào Nguyễn Thu Hà!" })).toBeTruthy();
  });
});

describe("[LCC-03] không nút học thử; hotline; câu cũ", () => {
  it.each([[true], [false]])("coDisc=%s ⇒ không «Đăng ký học thử» và không liên kết /lien-he", (coDisc) => {
    const { container } = dung(coDisc);
    expect(screen.queryByRole("link", { name: /học thử/i })).toBeNull();
    expect(container.textContent).not.toMatch(/học thử/i);
    expect(screen.queryAllByRole("link").some((a) => (a.getAttribute("href") ?? "").includes("lien-he"))).toBe(false);
  });
  it("số gọi được; không còn câu ngõ cụt", () => {
    const { container } = dung(true);
    expect(screen.getByRole("link", { name: "0837.312.860" }).getAttribute("href")).toBe("tel:0837312860");
    expect(container.textContent).not.toMatch(/Vui lòng liên hệ/);
    expect(container.textContent).not.toMatch(/chưa được liên kết với học viên nào/);
  });
});

describe("[LCC-04] dây nối layout", () => {
  const layout = readFileSync(resolve(process.cwd(), "app/(portal)/portal/layout.tsx"), "utf8").replace(/\r\n/g, "\n");
  it("một thông báo duy nhất dựng bằng LoiChaoChuaCoCon; không còn đọc header host", () => {
    expect(layout.match(/<LoiChaoChuaCoCon\b/g) ?? []).toHaveLength(1);
    expect(layout).not.toMatch(/hrefHocThu|hostYeuCau|duongTrangCongKhai|next\/headers/);
    // coQuaTang của lời chào CÙNG nguồn (`coQuaTangNao`) với menu và với route /portal/qua-tang: hai ô chỉ hiện khi hộp quà thật sự mở được.
    expect(layout).toMatch(/coQuaTang=\{coQuaTangNao\(\{ disc: choPhepDisc, sucKhoe: coSucKhoe, tuSach: coTuSach \}\)\}/);
  });
});
