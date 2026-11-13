// @vitest-environment jsdom
/**
 * [BNM-*] — khung xem bài nộp trên màn chấm (12/11/2026): video/ảnh bấm mở to trong hộp thoại, KHÔNG nhảy sang trang khác.
 *   [BNM-01] video hiện thành KHUNG bấm được (nút), có khung hình đầu — chưa có trình phát đầy đủ, chưa có liên kết rời trang
 *   [BNM-02] bấm khung ⇒ hộp thoại lớn với <video controls autoplay>; đóng hộp thoại ⇒ trình phát gỡ ra (dừng phát)
 *   [BNM-03] tệp khác (pdf) là chip liên kết mở thẻ mới; ảnh mở to trong hộp thoại
 *   [BNM-04] tệp cũ thiếu mimeType vẫn nhận ra video theo đuôi; có mimeType thì tin mimeType (đối chứng âm)
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BaiNopMedia, dinhDangGiay, laAnh, laVideo, type BaiNopFile } from "./bai-nop-media";

afterEach(cleanup);

const VIDEO: BaiNopFile = { id: "f1", url: "https://cdn.test/robot-cua-em.mp4", name: "robot-cua-em.mp4", size: 1_200_000, mime: "video/mp4" };
const PDF: BaiNopFile = { id: "f2", url: "https://cdn.test/bao-cao.pdf", name: "bao-cao.pdf", size: 52_000, mime: "application/pdf" };
const ANH: BaiNopFile = { id: "f3", url: "https://cdn.test/anh.png", name: "anh.png", size: 9_000, mime: "image/png" };

describe("[BNM-01] khung video", () => {
  it("video là NÚT bấm được (không phải thẻ <a> rời trang), chưa có trình phát điều khiển", () => {
    const { container } = render(<BaiNopMedia files={[VIDEO]} />);
    const nut = screen.getByRole("button", { name: /Xem video robot-cua-em\.mp4/ });
    expect(nut.tagName).toBe("BUTTON");
    expect(container.querySelector("a[href$='robot-cua-em.mp4']")).toBeNull();
    expect(container.querySelector("video[controls]")).toBeNull();
    expect(container.querySelector("video")?.getAttribute("src")).toContain("robot-cua-em.mp4#t=0.1");
  });
});

describe("[BNM-02] bấm ⇒ mở to", () => {
  it("hộp thoại có <video controls autoplay> đúng tệp; đóng lại thì trình phát biến mất", async () => {
    render(<BaiNopMedia files={[VIDEO]} />);
    expect(screen.queryByLabelText(/Video bài làm/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Xem video/ }));
    const phat = (await screen.findByLabelText("Video bài làm: robot-cua-em.mp4")) as HTMLVideoElement;
    expect(phat.hasAttribute("controls")).toBe(true);
    expect(phat.autoplay).toBe(true);
    expect(phat.getAttribute("src")).toBe(VIDEO.url);
    fireEvent.click(screen.getByRole("button", { name: /Close|Đóng/i }));
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByLabelText("Video bài làm: robot-cua-em.mp4")).toBeNull();
  });
});

describe("[BNM-03] tệp khác + ảnh", () => {
  it("pdf là chip liên kết mở thẻ mới; ảnh là nút mở to", async () => {
    render(<BaiNopMedia files={[PDF, ANH]} />);
    const pdf = screen.getByRole("link", { name: /bao-cao\.pdf/ });
    expect(pdf.getAttribute("target")).toBe("_blank");
    expect(pdf.getAttribute("rel")).toContain("noopener");
    fireEvent.click(screen.getByRole("button", { name: /Xem ảnh anh\.png/ }));
    const to = await screen.findAllByAltText("anh.png");
    expect(to.length).toBeGreaterThanOrEqual(2); // ô thu nhỏ + bản mở to
  });
});

describe("[BNM-04] nhận dạng loại tệp", () => {
  it("thiếu mime ⇒ đoán theo đuôi; có mime ⇒ tin mime (pdf đặt tên .mp4 vẫn là pdf)", () => {
    expect(laVideo({ url: "https://x/y.MOV?sig=1" })).toBe(true);
    expect(laAnh({ name: "a.jpeg" })).toBe(true);
    expect(laVideo({ mime: "application/pdf", name: "gia-vo.mp4" })).toBe(false);
    expect(laVideo({ url: "https://x/y.pdf" })).toBe(false);
  });
  it("dinhDangGiay: 83 → 1:23; 3725 → 1:02:05; vô hạn/rỗng → null", () => {
    expect(dinhDangGiay(83)).toBe("1:23");
    expect(dinhDangGiay(3725)).toBe("1:02:05");
    expect(dinhDangGiay(Infinity)).toBeNull();
    expect(dinhDangGiay(null)).toBeNull();
  });
});
