// @vitest-environment jsdom
/**
 * PhanTrangBang — bọc một bảng CÓ SẴN cho có phân trang.
 *
 * Đây là thứ sắp chạy qua ~140 bảng thật, nên test phải chứng minh đúng ba điều:
 *   1. KHÔNG đụng gì vào markup gốc (class, thead, tfoot, cấu trúc ô);
 *   2. cắt đúng dòng theo trang;
 *   3. gặp hình dạng lạ thì TRẢ BẢNG NGUYÊN TRẠNG chứ không đoán — thà một bảng dài còn
 *      hơn một bảng sai.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

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
beforeEach(() => kho.clear());

function bangGia(n: number, opts: { tfoot?: boolean; rong?: boolean } = {}) {
  return (
    <table className="w-full text-sm bang-goc">
      <thead className="dau-bang">
        <tr>
          <th>Tên</th>
        </tr>
      </thead>
      <tbody className="than-bang">
        {opts.rong && (
          <tr>
            <td>Chưa có dữ liệu.</td>
          </tr>
        )}
        {Array.from({ length: n }, (_, i) => (
          <tr key={i} className="dong">
            <td>{`HV-${i + 1}`}</td>
          </tr>
        ))}
      </tbody>
      {opts.tfoot && (
        <tfoot className="chan-bang">
          <tr>
            <td>Tổng cộng</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

const soDongThan = (c: HTMLElement) => c.querySelector("tbody")?.children.length ?? 0;

describe("PhanTrangBang — giữ nguyên bảng gốc", () => {
  it("không đổi class của table / thead / tbody", () => {
    const { container } = render(<PhanTrangBang>{bangGia(3)}</PhanTrangBang>);
    expect(container.querySelector("table")?.className).toBe("w-full text-sm bang-goc");
    expect(container.querySelector("thead")?.className).toBe("dau-bang");
    expect(container.querySelector("tbody")?.className).toBe("than-bang");
  });

  it("giữ nguyên <tfoot> (dòng tổng cộng KHÔNG được bị cắt theo trang)", () => {
    const { container } = render(<PhanTrangBang>{bangGia(50, { tfoot: true })}</PhanTrangBang>);
    expect(container.querySelector("tfoot")?.textContent).toContain("Tổng cộng");
    expect(soDongThan(container)).toBe(20);
  });

  it("dòng vẫn nằm trực tiếp trong tbody, không bị bọc thêm thẻ", () => {
    const { container } = render(<PhanTrangBang>{bangGia(3)}</PhanTrangBang>);
    const tbody = container.querySelector("tbody");
    expect([...(tbody?.children ?? [])].every((el) => el.tagName === "TR")).toBe(true);
    expect(tbody?.querySelector("tr")?.className).toBe("dong");
  });
});

describe("PhanTrangBang — cắt trang", () => {
  it("mặc định 20 dòng, bấm sang trang ra lô kế tiếp", () => {
    const { container } = render(<PhanTrangBang>{bangGia(57)}</PhanTrangBang>);
    expect(soDongThan(container)).toBe(20);
    expect(screen.getByText("HV-1")).toBeDefined();

    fireEvent.click(screen.getByLabelText("Trang sau"));
    expect(screen.queryByText("HV-1")).toBeNull();
    expect(screen.getByText("HV-21")).toBeDefined();
    expect(screen.getByText(/trang 2\/3/)).toBeDefined();
  });

  it("đổi số dòng ở trang xa → về trang 1", () => {
    const { container } = render(<PhanTrangBang>{bangGia(200)}</PhanTrangBang>);
    fireEvent.click(screen.getByLabelText("Trang sau"));
    fireEvent.click(screen.getByLabelText("Trang sau"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "50" } });
    expect(soDongThan(container)).toBe(50);
    expect(screen.getByText("HV-1")).toBeDefined();
  });

  it("dòng do điều kiện trả `false` không bị tính thành dòng", () => {
    // `{items.length === 0 && <tr>…}` là khuôn dòng-rỗng ở khắp repo: khi CÓ dữ liệu nó
    // là `false`, không được đếm thành một dòng làm lệch tổng.
    render(<PhanTrangBang tenDonVi="học viên">{bangGia(30, { rong: false })}</PhanTrangBang>);
    expect(screen.getByText(/30 học viên/)).toBeDefined();
  });

  it("chuỗi lạc trong tbody không bị tính thành dòng", () => {
    // `Children.toArray` tự bỏ `false`/`null`, NHƯNG giữ nguyên chuỗi và số. Một `{" "}`
    // hay một biểu thức trả chuỗi lọt vào tbody mà bị đếm là dòng thì tổng sai và trang
    // cuối hụt mất một bản ghi thật.
    const { container } = render(
      <PhanTrangBang tenDonVi="học viên">
        <table>
          <tbody>
            {" "}
            {Array.from({ length: 30 }, (_, i) => (
              <tr key={i}>
                <td>{`HV-${i + 1}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </PhanTrangBang>,
    );
    expect(screen.getByText(/30 học viên/)).toBeDefined();
    expect(soDongThan(container)).toBe(20);
  });

  it("bảng ngắn ≤10 dòng → không bày thanh phân trang, giữ đủ dòng", () => {
    const { container } = render(<PhanTrangBang>{bangGia(9)}</PhanTrangBang>);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(soDongThan(container)).toBe(9);
  });

  it("bảng chỉ có dòng 'chưa có dữ liệu' → hiện nguyên dòng đó", () => {
    const { container } = render(<PhanTrangBang>{bangGia(0, { rong: true })}</PhanTrangBang>);
    expect(container.textContent).toContain("Chưa có dữ liệu.");
    expect(screen.queryByLabelText("Trang sau")).toBeNull();
  });
});

describe("PhanTrangBang — fail-safe khi hình dạng lạ", () => {
  it("KHÔNG có tbody → trả bảng nguyên trạng, không phân trang, không nổ", () => {
    const { container } = render(
      <PhanTrangBang>
        <table>
          <caption>Bảng lạ</caption>
        </table>
      </PhanTrangBang>,
    );
    expect(container.querySelector("caption")?.textContent).toBe("Bảng lạ");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("NHIỀU tbody → trả nguyên trạng, giữ ĐỦ mọi dòng (không cắt nhầm nhóm)", () => {
    const { container } = render(
      <PhanTrangBang>
        <table>
          <tbody>
            {Array.from({ length: 30 }, (_, i) => (
              <tr key={i}>
                <td>{`A-${i}`}</td>
              </tr>
            ))}
          </tbody>
          <tbody>
            <tr>
              <td>B-1</td>
            </tr>
          </tbody>
        </table>
      </PhanTrangBang>,
    );
    expect(container.querySelectorAll("tbody").length).toBe(2);
    expect(container.querySelectorAll("tr").length).toBe(31);
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("PhanTrangBang — bảng shadcn (<Table>/<TableBody>)", () => {
  it("nhận cả <TableBody> của shadcn, không chỉ <tbody> thô", () => {
    // Repo dùng lẫn hai kiểu. Chỉ nhận `<tbody>` thô thì 17 bảng shadcn im lặng không
    // phân trang — và fail-safe thì KHÔNG kêu, nên sẽ không ai phát hiện.
    const { container } = render(
      <PhanTrangBang>
        <Table>
          <TableBody>
            {Array.from({ length: 30 }, (_, i) => (
              <TableRow key={i}>
                <TableCell>{`HV-${i + 1}`}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </PhanTrangBang>,
    );
    expect(soDongThan(container)).toBe(20);
    expect(screen.getByLabelText("Trang sau")).toBeDefined();
  });
});

// ── [PTB-DONG] mở đúng TRANG chứa dòng đang chọn (màn Hoá đơn điện tử — PLAN §10) ─────────────────
// Khoá có dấu ":" (khoá lần thu `dot:<id>`) — React mã hoá khoá trong `Children.toArray`, so ngây thơ
// là không bao giờ khớp và prop thành lời hứa suông.
function bangKhoa(n: number) {
  return (
    <table>
      <tbody>
        {Array.from({ length: n }, (_, i) => (
          <tr key={`dot:k${i + 1}`}>
            <td>{`HV-${i + 1}`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

describe("[PTB-DONG] khoaDongHien — dòng đang chọn luôn nằm trên trang đang hiện", () => {
  it("dòng thứ 31 (mặc định 20/trang) ⇒ mở thẳng trang 2", () => {
    render(<PhanTrangBang khoaDongHien="dot:k31">{bangKhoa(45)}</PhanTrangBang>);
    expect(screen.getByText("HV-31")).toBeDefined();
    expect(screen.queryByText("HV-1")).toBeNull();
    expect(screen.getByText(/trang 2\/3/)).toBeDefined();
  });

  it("đổi dòng chọn (xác nhận xong ⇒ dòng kế tiếp) ⇒ chuyển theo sang trang chứa nó", () => {
    const { rerender } = render(<PhanTrangBang khoaDongHien="dot:k2">{bangKhoa(45)}</PhanTrangBang>);
    expect(screen.getByText(/trang 1\/3/)).toBeDefined();
    rerender(<PhanTrangBang khoaDongHien="dot:k44">{bangKhoa(45)}</PhanTrangBang>);
    expect(screen.getByText("HV-44")).toBeDefined();
    expect(screen.getByText(/trang 3\/3/)).toBeDefined();
  });

  it("người dùng tự lật trang khi dòng chọn KHÔNG đổi ⇒ bảng vẽ lại cũng không giật về", () => {
    const { rerender } = render(<PhanTrangBang khoaDongHien="dot:k31">{bangKhoa(45)}</PhanTrangBang>);
    fireEvent.click(screen.getByLabelText("Trang trước"));
    expect(screen.getByText(/trang 1\/3/)).toBeDefined();
    rerender(<PhanTrangBang khoaDongHien="dot:k31">{bangKhoa(45)}</PhanTrangBang>);
    expect(screen.getByText(/trang 1\/3/)).toBeDefined();
  });

  it("đối chứng: khoá không có trong bảng / không truyền ⇒ hành vi cũ (trang 1)", () => {
    const { unmount } = render(<PhanTrangBang khoaDongHien="dot:khong-co">{bangKhoa(45)}</PhanTrangBang>);
    expect(screen.getByText(/trang 1\/3/)).toBeDefined();
    unmount();
    render(<PhanTrangBang>{bangKhoa(45)}</PhanTrangBang>);
    expect(screen.getByText(/trang 1\/3/)).toBeDefined();
  });
});
