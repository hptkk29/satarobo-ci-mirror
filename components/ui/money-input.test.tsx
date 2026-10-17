// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MoneyInput } from "@/components/ui/money-input";

function visible() {
  return screen.getByTestId("mi") as HTMLInputElement;
}
function hidden(container: HTMLElement) {
  return container.querySelector('input[type="hidden"]') as HTMLInputElement;
}

/**
 * Gõ/dán như trình duyệt thật. PHẢI đi qua `fireEvent.change(el, { target })`:
 * gán thẳng `el.value = x` sẽ cập nhật luôn value-tracker của React ⇒ React tưởng
 * không có gì đổi và KHÔNG gọi onChange (test xanh/đỏ giả).
 */
function typeInto(el: HTMLInputElement, next: string, caret = next.length) {
  fireEvent.change(el, {
    target: { value: next, selectionStart: caret, selectionEnd: caret },
  });
}

describe("MoneyInput smoke", () => {
  it("gõ số trần → hiển thị có chấm, ô ẩn giữ số trần", () => {
    const { container } = render(<MoneyInput name="amount" data-testid="mi" />);
    typeInto(visible(), "10000000");
    expect(visible().value).toBe("10.000.000");
    expect(hidden(container).value).toBe("10000000");
    expect(hidden(container).name).toBe("amount");
    expect(visible().hasAttribute("name")).toBe(false);
  });

  it("dán '1.500.000 đ' → 1500000", () => {
    const { container } = render(<MoneyInput name="amount" data-testid="mi" />);
    typeInto(visible(), "1.500.000 đ");
    expect(visible().value).toBe("1.500.000");
    expect(hidden(container).value).toBe("1500000");
  });

  it("defaultValue hiển thị sẵn dấu chấm", () => {
    const { container } = render(
      <MoneyInput name="amount" data-testid="mi" defaultValue={2500000} />,
    );
    expect(visible().value).toBe("2.500.000");
    expect(hidden(container).value).toBe("2500000");
  });

  it("sửa GIỮA chuỗi: caret bám theo SỐ CHỮ SỐ, không nhảy về cuối", () => {
    render(<MoneyInput name="amount" data-testid="mi" defaultValue={100000} />);
    const el = visible();
    expect(el.value).toBe("100.000");
    // Đặt caret sau "10" rồi gõ "5" ⇒ chuỗi thô "1050.000" (dấu chấm lệch chỗ).
    typeInto(el, "1050.000", 3);
    expect(el.value).toBe("1.050.000"); // đã format lại
    expect(el.selectionStart).toBe(4); // "1.05|0.000" — ngay sau chữ số vừa gõ
  });

  it("Backspace ngay sau dấu chấm xoá chữ số, không phải dấu chấm", () => {
    render(<MoneyInput name="amount" data-testid="mi" defaultValue={10000000} />);
    const el = visible();
    el.setSelectionRange(3, 3); // "10.|000.000"
    fireEvent.keyDown(el, { key: "Backspace" });
    expect(el.value).toBe("1.000.000");
  });

  it("Delete ngay trước dấu chấm xoá chữ số đứng sau", () => {
    render(<MoneyInput name="amount" data-testid="mi" defaultValue={10000000} />);
    const el = visible();
    el.setSelectionRange(2, 2); // "10|.000.000"
    fireEvent.keyDown(el, { key: "Delete" });
    expect(el.value).toBe("1.000.000");
  });

  it("xoá trắng → ô ẩn rỗng, onValueChange nhận null", () => {
    const seen: (number | null)[] = [];
    const { container } = render(
      <MoneyInput
        name="amount"
        data-testid="mi"
        defaultValue={5000}
        onValueChange={(n) => seen.push(n)}
      />,
    );
    typeInto(visible(), "");
    expect(hidden(container).value).toBe("");
    expect(seen).toEqual([null]);
  });

  it("min/max chặn được submit qua setCustomValidity", () => {
    render(<MoneyInput name="amount" data-testid="mi" min={100000} max={900000} />);
    typeInto(visible(), "5000");
    expect(visible().checkValidity()).toBe(false);
    typeInto(visible(), "5000000");
    expect(visible().checkValidity()).toBe(false);
    typeInto(visible(), "500000");
    expect(visible().checkValidity()).toBe(true);
  });

  it("required chặn khi để trống", () => {
    render(<MoneyInput name="amount" data-testid="mi" required />);
    expect(visible().checkValidity()).toBe(false);
    typeInto(visible(), "1000");
    expect(visible().checkValidity()).toBe(true);
  });

  it("allowNegative: gõ '-' không bị nuốt", () => {
    const { container } = render(
      <MoneyInput name="delta" data-testid="mi" allowNegative />,
    );
    typeInto(visible(), "-");
    expect(visible().value).toBe("-");
    typeInto(visible(), "-500000");
    expect(visible().value).toBe("-500.000");
    expect(hidden(container).value).toBe("-500000");
  });

  // ─── Số âm ở ô KHÔNG cho phép: chặn, KHÔNG lật dấu ───────────────────────────
  // Bẫy cũ: ô bỏ dấu trừ rồi bắn ra số DƯƠNG ⇒ khoản −5tr lặng lẽ thành +5tr. Luật mới:
  // giữ nguyên thứ người dùng gõ, chặn submit bằng bong bóng lỗi.

  it("dán số âm vào ô không cho phép: giữ dấu trừ + chặn submit, KHÔNG lật thành dương", () => {
    const seen: (number | null)[] = [];
    const { container } = render(
      <MoneyInput name="amount" data-testid="mi" onValueChange={(n) => seen.push(n)} />,
    );
    typeInto(visible(), "-500000");
    expect(visible().value).toBe("-500.000");
    expect(hidden(container).value).toBe("-500000");
    expect(seen).toEqual([-500000]); // KHÔNG có 500000 dương nào lọt ra
    expect(visible().checkValidity()).toBe(false);
    expect(visible().validationMessage).toBe("Ô này không nhận số âm");
  });

  it("giá trị âm nạp sẵn: hiện đúng dấu và bị đánh dấu không hợp lệ ngay từ đầu", () => {
    render(<MoneyInput name="amount" data-testid="mi" defaultValue={-5000000} />);
    expect(visible().value).toBe("-5.000.000");
    expect(visible().checkValidity()).toBe(false);
  });

  it("giá trị âm nạp sẵn: gõ thêm 1 phím cũng không âm thầm đổi dấu", () => {
    const seen: (number | null)[] = [];
    render(
      <MoneyInput
        name="amount"
        data-testid="mi"
        defaultValue={-5000000}
        onValueChange={(n) => seen.push(n)}
      />,
    );
    // Gõ thêm số 0 vào cuối "-5.000.000" → "-5.000.0000"
    typeInto(visible(), "-5.000.0000");
    expect(seen).toEqual([-50000000]);
    expect(visible().value).toBe("-50.000.000");
  });

  it("gõ mỗi dấu '-' ở ô không cho số âm: không hiện gì, cũng không báo lỗi", () => {
    const { container } = render(<MoneyInput name="amount" data-testid="mi" />);
    typeInto(visible(), "-");
    expect(visible().value).toBe("");
    expect(hidden(container).value).toBe("");
    expect(visible().checkValidity()).toBe(true);
  });

  it("sửa số âm về dương thì hết lỗi", () => {
    render(<MoneyInput name="amount" data-testid="mi" />);
    typeInto(visible(), "-500000");
    expect(visible().checkValidity()).toBe(false);
    typeInto(visible(), "500000");
    expect(visible().checkValidity()).toBe(true);
  });

  it("allowNegative: số âm hợp lệ, không bị chặn", () => {
    render(<MoneyInput name="delta" data-testid="mi" allowNegative />);
    typeInto(visible(), "-500000");
    expect(visible().checkValidity()).toBe(true);
  });

  it("controlled: cha nắn giá trị thì ô bật lại theo cha", () => {
    function Wrap() {
      const [v, setV] = React.useState<number | null>(0);
      return (
        <MoneyInput
          name="amount"
          data-testid="mi"
          value={v}
          onValueChange={(n) => setV(n === null ? null : Math.min(n, 1000))}
        />
      );
    }
    render(<Wrap />);
    typeInto(visible(), "999999");
    expect(visible().value).toBe("1.000");
  });

  it("disabled thì ô ẩn cũng disabled (không submit giá trị)", () => {
    const { container } = render(
      <MoneyInput name="amount" data-testid="mi" defaultValue={1000} disabled />,
    );
    expect(hidden(container).disabled).toBe(true);
  });

  it("label htmlFor gắn được vào ô nhìn thấy", () => {
    render(
      <>
        <label htmlFor="tuition">Học phí</label>
        <MoneyInput name="tuition" id="tuition" data-testid="mi" />
      </>,
    );
    expect(screen.getByLabelText("Học phí")).toBe(visible());
  });

  it("FormData nhận số trần từ ô ẩn (server không phải sửa gì)", () => {
    const { container } = render(
      <form>
        <MoneyInput name="amount" data-testid="mi" />
      </form>,
    );
    typeInto(visible(), "10000000");
    const fd = new FormData(container.querySelector("form") as HTMLFormElement);
    expect(fd.get("amount")).toBe("10000000");
    expect(Number(fd.get("amount"))).toBe(10_000_000);
  });
});
