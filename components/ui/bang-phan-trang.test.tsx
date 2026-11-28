// @vitest-environment jsdom
/**
 * BangPhanTrang — cỗ máy phân trang dùng chung cho mọi bảng.
 *
 * Thứ đáng test không phải "có vẽ ra bảng không" mà là mấy chỗ bảng phân trang HAY SAI và
 * người dùng chỉ thấy triệu chứng "mất dữ liệu": đang ở trang cuối rồi lọc cho ngắn lại,
 * đổi số dòng khi đang ở trang xa, và bảng ngắn thì đừng bày nút bấm vô dụng.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { BangPhanTrang, SO_DONG_MAC_DINH } from "@/components/ui/bang-phan-trang";

function dongGia(n: number, tienTo = "HV") {
  return Array.from({ length: n }, (_, i) => (
    <tr key={i}>
      <td>{`${tienTo}-${i + 1}`}</td>
    </tr>
  ));
}

const HEAD = (
  <tr>
    <th>Tên</th>
  </tr>
);

const soDongHienRa = () => screen.getAllByRole("row").length - 1; // trừ dòng tiêu đề

// jsdom ở repo này không kèm localStorage dùng được → dựng bản trong bộ nhớ.
const kho = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => kho.get(k) ?? null,
    setItem: (k: string, v: string) => void kho.set(k, v),
    removeItem: (k: string) => void kho.delete(k),
    clear: () => kho.clear(),
  },
});

beforeEach(() => {
  kho.clear();
});

describe("BangPhanTrang", () => {
  it("mặc định 20 dòng/trang", () => {
    render(<BangPhanTrang head={HEAD} rows={dongGia(57)} colSpan={1} />);
    expect(SO_DONG_MAC_DINH).toBe(20);
    expect(soDongHienRa()).toBe(20);
    expect(screen.getByText(/trang 1\/3/)).toBeDefined();
  });

  it("cho chọn đúng 4 mức 10 / 20 / 50 / 100", () => {
    render(<BangPhanTrang head={HEAD} rows={dongGia(200)} colSpan={1} />);
    const select = screen.getByRole("combobox");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "10",
      "20",
      "50",
      "100",
    ]);
  });

  it("bấm sang trang sau → ra đúng lô kế tiếp, không lặp lô cũ", () => {
    render(<BangPhanTrang head={HEAD} rows={dongGia(57)} colSpan={1} />);
    expect(screen.getByText("HV-1")).toBeDefined();
    fireEvent.click(screen.getByLabelText("Trang sau"));
    expect(screen.queryByText("HV-1")).toBeNull();
    expect(screen.getByText("HV-21")).toBeDefined();
    expect(screen.getByText(/trang 2\/3/)).toBeDefined();
  });

  it("trang cuối chỉ còn phần dư, và nút Sau tắt", () => {
    render(<BangPhanTrang head={HEAD} rows={dongGia(57)} colSpan={1} />);
    fireEvent.click(screen.getByLabelText("Trang sau"));
    fireEvent.click(screen.getByLabelText("Trang sau"));
    expect(soDongHienRa()).toBe(17);
    expect(screen.getByLabelText("Trang sau")).toHaveProperty("disabled", true);
  });

  it("đổi số dòng khi đang ở trang xa → NHẢY VỀ TRANG 1", () => {
    // 200 dòng, đang ở trang 3 (20/trang). Đổi sang 50/trang thì VẪN còn 4 trang, nên phép
    // kẹp `Math.min` KHÔNG cứu: không chủ động về trang 1 là người dùng rơi vào giữa bảng
    // (HV-101) sau khi chỉ đổi mỗi số dòng hiển thị.
    render(<BangPhanTrang head={HEAD} rows={dongGia(200)} colSpan={1} />);
    fireEvent.click(screen.getByLabelText("Trang sau"));
    fireEvent.click(screen.getByLabelText("Trang sau"));
    expect(screen.getByText("HV-41")).toBeDefined();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "50" } });
    expect(soDongHienRa()).toBe(50);
    expect(screen.getByText("HV-1")).toBeDefined();
    expect(screen.queryByText("HV-101")).toBeNull();
    expect(screen.getByText(/trang 1\/4/)).toBeDefined();
  });

  it("dữ liệu co lại quá nhiều ⇒ nhãn trang KHÔNG bao giờ vượt tổng số trang", () => {
    const { rerender } = render(<BangPhanTrang head={HEAD} rows={dongGia(200)} colSpan={1} />);
    fireEvent.click(screen.getByLabelText("Trang sau"));
    fireEvent.click(screen.getByLabelText("Trang sau")); // trang 3/10
    rerender(<BangPhanTrang head={HEAD} rows={dongGia(25)} colSpan={1} />);
    expect(screen.getByText(/trang 2\/2/)).toBeDefined();
    expect(screen.queryByText(/trang 3/)).toBeNull();
  });

  it("dữ liệu co lại (lọc/tìm kiếm) khi đang ở trang cuối → tự lùi, KHÔNG hiện bảng trắng", () => {
    const { rerender } = render(<BangPhanTrang head={HEAD} rows={dongGia(57)} colSpan={1} />);
    fireEvent.click(screen.getByLabelText("Trang sau"));
    fireEvent.click(screen.getByLabelText("Trang sau")); // trang 3/3
    rerender(<BangPhanTrang head={HEAD} rows={dongGia(15)} colSpan={1} />);
    expect(soDongHienRa()).toBe(15);
    expect(screen.getByText("HV-1")).toBeDefined();
  });

  it("bảng ngắn (≤ 10 dòng) → KHÔNG bày thanh phân trang", () => {
    render(<BangPhanTrang head={HEAD} rows={dongGia(9)} colSpan={1} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByLabelText("Trang sau")).toBeNull();
    expect(soDongHienRa()).toBe(9);
  });

  it("bảng rỗng → một dòng thông báo, không nổ", () => {
    render(<BangPhanTrang head={HEAD} rows={[]} colSpan={1} trong="Chưa có học viên." />);
    expect(screen.getByText("Chưa có học viên.")).toBeDefined();
  });

  it("nhớ số dòng đã chọn cho lần sau (localStorage)", async () => {
    const { unmount } = render(<BangPhanTrang head={HEAD} rows={dongGia(200)} colSpan={1} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "50" } });
    expect(soDongHienRa()).toBe(50);
    unmount();

    render(<BangPhanTrang head={HEAD} rows={dongGia(200)} colSpan={1} />);
    expect(await screen.findByDisplayValue("50")).toBeDefined();
    expect(soDongHienRa()).toBe(50);
  });

  it("giá trị rác trong localStorage → bỏ qua, về mặc định (không vỡ trang)", () => {
    window.localStorage.setItem("satarobo:bang:soDong", "999");
    render(<BangPhanTrang head={HEAD} rows={dongGia(57)} colSpan={1} />);
    expect(soDongHienRa()).toBe(20);
  });

  it("đếm đúng khoảng đang xem, dùng tên đơn vị của bảng", () => {
    render(<BangPhanTrang head={HEAD} rows={dongGia(57)} colSpan={1} tenDonVi="học viên" />);
    expect(screen.getByText(/57 học viên/)).toBeDefined();
    expect(screen.getByText(/1–20/)).toBeDefined();
    fireEvent.click(screen.getByLabelText("Trang sau"));
    expect(screen.getByText(/21–40/)).toBeDefined();
  });
});

describe("BangPhanTrang — không phá cấu trúc bảng", () => {
  it("giữ nguyên class của table/thead/tbody bên gọi truyền vào", () => {
    const { container } = render(
      <BangPhanTrang
        head={HEAD}
        rows={dongGia(3)}
        colSpan={1}
        tableClassName="bang-cua-toi"
        theadClassName="dau-bang"
        tbodyClassName="than-bang"
      />,
    );
    expect(container.querySelector("table")?.className).toContain("bang-cua-toi");
    expect(container.querySelector("thead")?.className).toContain("dau-bang");
    expect(container.querySelector("tbody")?.className).toContain("than-bang");
  });

  it("dòng nằm ĐÚNG trong tbody (không bọc thêm thẻ làm vỡ HTML bảng)", () => {
    const { container } = render(<BangPhanTrang head={HEAD} rows={dongGia(3)} colSpan={1} />);
    const tbody = container.querySelector("tbody");
    expect(tbody?.children.length).toBe(3);
    expect([...(tbody?.children ?? [])].every((el) => el.tagName === "TR")).toBe(true);
  });
});

describe("BangPhanTrang — khoá ghi nhớ", () => {
  it("khoaGhiNho riêng ⇒ không đụng lựa chọn của bảng khác", () => {
    const { unmount } = render(
      <BangPhanTrang head={HEAD} rows={dongGia(200)} colSpan={1} khoaGhiNho="hoc-vien" />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "50" } });
    unmount();
    vi.clearAllMocks();

    render(<BangPhanTrang head={HEAD} rows={dongGia(200)} colSpan={1} khoaGhiNho="lop" />);
    expect(screen.getByDisplayValue("20")).toBeDefined();
  });
});
