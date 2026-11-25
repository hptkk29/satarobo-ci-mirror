// @vitest-environment jsdom
/** [PUB-HOME-06..] Dựng thật từng khối trang chủ (không DB, không 3D): chữ/giá đúng, không dữ liệu giả, tương tác tab + FAQ. */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

// Hero gọi hook 3D (tải three/spacelab) — ở jsdom chỉ cần biết hero ở trạng thái "chờ" (poster hiện).
vi.mock("@/components/public/pub-design/use-pub-3d", () => ({ usePub3d: () => ({ ready: false, khongCo3D: false }) }));

import { BuoiHocSection, CamKetSection } from "./buoi-hoc-cam-ket";
import { FaqSection } from "./faq";
import { Hero } from "./hero";
import { chuoiGiaThe, dungCauHoi, type GiaTrangChu } from "./home-thuan";
import { KhoaHocSection } from "./khoa-hoc";
import { PhanHoiSection } from "./phan-hoi";
import { RobotTuLap } from "./robot-tu-lap";
import { DauTruongSection } from "./sang-lap-dau-truong";

const GIA: GiaTrangChu = { sata1: 2_400_000, sata3: 10_560_000, sata4: 11_520_000, sata5: 12_480_000 };

describe("[PUB-HOME-06] hero", () => {
  it("có h1, hai nút neo #lien-he / #khoa-hoc, bốn số liệu, canvas 3D + poster; số cơ sở theo prop", () => {
    const { container } = render(<Hero soCoSo={2} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Nhà sáng chế");
    expect(container.querySelector('a[href="#lien-he"]')).toBeTruthy();
    expect(container.querySelector('a[href="#khoa-hoc"]')).toBeTruthy();
    expect(container.querySelectorAll(".stats > div")).toHaveLength(4);
    expect(container.querySelector("canvas.space-cv")).toBeTruthy();
    expect(container.querySelector("img.space-poster")).toBeTruthy();
    expect(container.textContent).toContain("2 cơ sở · Đà Nẵng");
  });
});

describe("[PUB-HOME-07] bốn thẻ khoá học", () => {
  it("giá đúng (880.000đ/tháng …) và link tới đúng slug", () => {
    const { container } = render(<KhoaHocSection gia={chuoiGiaThe(GIA)} />);
    for (const s of ["880.000đ", "960.000đ", "1.040.000đ", "2.400.000đ"]) expect(container.textContent).toContain(s);
    const href = Array.from(container.querySelectorAll("article a")).map((a) => a.getAttribute("href"));
    for (const slug of ["combo-sata1-sata2", "sata3", "sata4", "sata5"]) expect(href).toContain(`/khoa-hoc/${slug}`);
    expect(container.querySelectorAll("article")).toHaveLength(4);
  });
  it("không có giá ⇒ KHÔNG số tiền nào, vẫn còn 4 link 'Xem chi tiết'", () => {
    const { container } = render(<KhoaHocSection gia={{ combo: null, sata3: null, sata4: null, sata5: null }} />);
    expect(container.textContent).not.toMatch(/\d\.\d{3}đ/);
    expect(screen.getAllByText("Xem chi tiết →")).toHaveLength(4);
  });
});

describe("[PUB-HOME-08] robot con sẽ tự lắp", () => {
  it("mặc định Alpha 6 mô hình; bấm Beta đổi sang 4 mô hình lưới c4", () => {
    const { container } = render(<RobotTuLap />);
    expect(container.querySelectorAll("button.kit-card")).toHaveLength(6);
    fireEvent.click(screen.getByRole("tab", { name: /Beta Set/ }));
    expect(container.querySelectorAll("button.kit-card")).toHaveLength(4);
    expect(container.querySelector(".kit-grid.c4")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Beta Set/ }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("[PUB-HOME-09] khối tĩnh", () => {
  it("[02] bốn bước, [03] năm cam kết + 5 quỹ đạo, [04] bốn ảnh đấu trường", () => {
    expect(render(<BuoiHocSection />).container.querySelectorAll("figure")).toHaveLength(4);
    const cam = render(<CamKetSection />);
    expect(cam.container.textContent).toContain("Hoàn 100% học phí");
    expect(cam.container.textContent).toContain("Hỗ trợ 3.000.000đ");
    expect(cam.container.querySelectorAll(".orb")).toHaveLength(5);
    expect(render(<DauTruongSection />).container.querySelectorAll(".mosaic figure")).toHaveLength(4);
  });
});

describe("[PUB-HOME-10] phản hồi phụ huynh — không dựng giả", () => {
  it("rỗng ⇒ không render gì (không khung '[Ảnh phản hồi]')", () => {
    expect(render(<PhanHoiSection danhSach={[]} />).container.innerHTML).toBe("");
  });
  it("có dữ liệu thật ⇒ hiện đúng nội dung + tên, tối đa 4 thẻ", () => {
    const mau = Array.from({ length: 6 }, (_, i) => ({
      name: `PH ${i}`, role: "Phụ huynh bé lớp 3", content: `Nội dung ${i}`, avatar: "P", avatarColor: "", videoId: null, location: "Đà Nẵng", rating: 5,
    }));
    const { container } = render(<PhanHoiSection danhSach={mau} />);
    expect(container.querySelectorAll("figure")).toHaveLength(4);
    expect(container.textContent).toContain("Nội dung 0");
    expect(container.textContent).not.toContain("[Ảnh phản hồi");
  });
});

describe("[PUB-HOME-11] FAQ accordion", () => {
  it("mặc định mở câu đầu (như artifact); bấm câu khác thì câu cũ đóng; bấm lại câu đang mở thì đóng", () => {
    const { container } = render(<FaqSection cauHoi={dungCauHoi(GIA)} />);
    const nut = screen.getAllByRole("button");
    expect(nut).toHaveLength(5);
    const dongMo = () => Array.from(container.querySelectorAll("p[id^='faq-tl-']")).map((p) => !(p as HTMLElement).hidden);
    expect(dongMo()).toEqual([true, false, false, false, false]);
    fireEvent.click(nut[1]);
    expect(dongMo()).toEqual([false, true, false, false, false]);
    expect(nut[1].getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(nut[3]);
    expect(dongMo()).toEqual([false, false, false, true, false]);
    fireEvent.click(nut[3]);
    expect(dongMo()).toEqual([false, false, false, false, false]);
    expect(within(container).getByText(/Hoàn 100% học phí/).textContent).toContain("3 ngày làm việc");
  });
});
