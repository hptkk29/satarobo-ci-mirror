// @vitest-environment jsdom
/**
 * [HDUI-I*] — `InfoTip` = `HelpHint` mở rộng prop `icon` (chốt O-2 của audit 05: "?" cho ô form, "i" cho ghi chú tĩnh).
 *
 * jsdom không đo được bố cục, nên "vùng chạm ≥24px / ≥44px" và "không tràn ở 320px" được khoá ở tầng HỢP ĐỒNG LỚP CSS
 * (đúng các class tạo ra kích thước ấy) — và đã cấy lỗi (bỏ class) để thấy đỏ. Số đo thật cần ảnh chụp 375px/1440px.
 *
 * Không có `@testing-library/user-event`: Enter/Space trên `<button>` không thử được ở jsdom; ca I4 khoá rằng trigger LÀ
 * `<button type="button">` (nên Enter/Space chạy bằng ngữ nghĩa nút native, và không submit form chứa nó).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { FieldLabel, HelpHint, InfoTip } from "./help-hint";

afterEach(cleanup);

/**
 * Chuỗi sự kiện của một lần BẤM THẬT. `fireEvent.click` trần KHÔNG mở được tooltip của base-ui trong jsdom (nó dựa vào
 * pointerdown/focus đi trước click) — đã đo; trình duyệt thật luôn gửi cả chuỗi này.
 */
async function moBangBam(nut: HTMLElement, kieu: "mouse" | "touch" = "mouse") {
  await act(async () => {
    fireEvent.pointerDown(nut, { pointerType: kieu });
    if (kieu === "touch") fireEvent.touchStart(nut);
    fireEvent.mouseDown(nut);
    nut.focus();
    fireEvent.pointerUp(nut, { pointerType: kieu });
    fireEvent.mouseUp(nut);
    fireEvent.click(nut);
  });
}

describe("[HDUI-I1] prop icon: mặc định '?', 'info' ra chữ i", () => {
  it("không khai icon ⇒ help (mọi chỗ gọi cũ giữ nguyên)", () => {
    render(<HelpHint>Nội dung</HelpHint>);
    const nut = screen.getByRole("button", { name: "Xem hướng dẫn" });
    expect(nut.getAttribute("data-icon")).toBe("help");
    expect(nut.querySelector("svg")).not.toBeNull();
  });

  it("icon='info' ⇒ chữ i, và svg khác svg của '?'", () => {
    const { container: a } = render(<HelpHint>Nội dung</HelpHint>);
    const svgHelp = a.querySelector("svg")!.outerHTML;
    cleanup();
    render(<HelpHint icon="info">Nội dung</HelpHint>);
    const nut = screen.getByRole("button", { name: "Xem hướng dẫn" });
    expect(nut.getAttribute("data-icon")).toBe("info");
    expect(nut.querySelector("svg")!.outerHTML).not.toBe(svgHelp);
  });

  it("InfoTip là cùng một component với HelpHint (một chuẩn, không hai bản)", () => {
    expect(InfoTip).toBe(HelpHint);
  });

  it("FieldLabel truyền được hintIcon xuống", () => {
    render(<FieldLabel label="Ký hiệu" hint="Nhóm chữ-số đầu số hoá đơn." hintIcon="info" />);
    expect(screen.getByRole("button", { name: "Xem hướng dẫn" }).getAttribute("data-icon")).toBe("info");
  });
});

describe("[HDUI-I1b] FieldLabel truyền hintLabel xuống nút (aria-label riêng, không rơi về mặc định)", () => {
  it("hintLabel khai ⇒ nút mang đúng tên ấy, KHÔNG còn 'Xem hướng dẫn'", () => {
    render(<FieldLabel label="Ký hiệu" hint="Nhóm chữ-số đầu số hoá đơn." hintLabel="Giải thích ký hiệu" />);
    const nut = screen.getByRole("button", { name: "Giải thích ký hiệu" });
    expect(nut.getAttribute("aria-label")).toBe("Giải thích ký hiệu");
    expect(screen.queryByRole("button", { name: "Xem hướng dẫn" })).toBeNull();
  });

  it("đối chứng: không khai hintLabel ⇒ tên mặc định", () => {
    render(<FieldLabel label="Ký hiệu" hint="Nhóm chữ-số đầu số hoá đơn." />);
    expect(screen.getByRole("button", { name: "Xem hướng dẫn" })).toBeDefined();
  });

  it("không có hint ⇒ không vẽ nút (nhãn trơn)", () => {
    render(<FieldLabel label="Ký hiệu" hintLabel="Giải thích ký hiệu" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("[HDUI-I2] bấm mở, nội dung hiện, focus VẪN ở nút", () => {
  it.each(["help", "info"] as const)("icon=%s", async (icon) => {
    render(<InfoTip icon={icon}>Hướng dẫn ngắn.</InfoTip>);
    const nut = screen.getByRole("button", { name: "Xem hướng dẫn" });
    await moBangBam(nut);
    expect(screen.getByText("Hướng dẫn ngắn.")).toBeDefined();
    expect(document.activeElement).toBe(nut);
  });
});

describe("[HDUI-I2b] mở được bằng CẢM ỨNG và bằng BÀN PHÍM (focus), không cần hover", () => {
  it("chạm (pointerType=touch) mở", async () => {
    render(<InfoTip>Hướng dẫn ngắn.</InfoTip>);
    await moBangBam(screen.getByRole("button", { name: "Xem hướng dẫn" }), "touch");
    expect(screen.getByText("Hướng dẫn ngắn.")).toBeDefined();
  });

  it("Tab vào nút (focus bàn phím) mở", async () => {
    render(<InfoTip>Hướng dẫn ngắn.</InfoTip>);
    const nut = screen.getByRole("button", { name: "Xem hướng dẫn" });
    await act(async () => {
      nut.focus();
    });
    expect(screen.getByText("Hướng dẫn ngắn.")).toBeDefined();
  });
});

describe("[HDUI-I3] Esc đóng, focus trả về / ở lại nút", () => {
  it("mở ⇒ Esc ⇒ nội dung mất, focus ở nút", async () => {
    render(<InfoTip>Hướng dẫn ngắn.</InfoTip>);
    const nut = screen.getByRole("button", { name: "Xem hướng dẫn" });
    await moBangBam(nut);
    expect(screen.getByText("Hướng dẫn ngắn.")).toBeDefined();
    await act(async () => {
      fireEvent.keyDown(nut, { key: "Escape" });
    });
    expect(screen.queryByText("Hướng dẫn ngắn.")).toBeNull();
    expect(document.activeElement).toBe(nut);
  });
});

describe("[HDUI-I4] nút native, có tên truy cập, không submit form chứa nó", () => {
  it("<button type=button> + aria-label tuỳ biến", () => {
    render(<InfoTip label="Giải thích ký hiệu">x</InfoTip>);
    const nut = screen.getByRole("button", { name: "Giải thích ký hiệu" });
    expect(nut.tagName).toBe("BUTTON");
    expect(nut.getAttribute("type")).toBe("button");
  });

  it("bấm trong <form> không gửi form", async () => {
    const gui = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={gui}>
        <InfoTip>Hướng dẫn</InfoTip>
      </form>,
    );
    await moBangBam(screen.getByRole("button", { name: "Xem hướng dẫn" }));
    expect(gui).not.toHaveBeenCalled();
  });
});

describe("[HDUI-I5] hợp đồng lớp CSS: vùng chạm ≥24px (≥44px khi cảm ứng) mà KHÔNG phình icon", () => {
  it("nút có pseudo-element mở rộng vùng bấm: -5px (14+10=24) và -15px khi pointer-coarse (14+30=44)", () => {
    render(<InfoTip>x</InfoTip>);
    const lop = screen.getByRole("button", { name: "Xem hướng dẫn" }).className.split(/\s+/);
    expect(lop).toContain("relative");
    expect(lop).toContain("after:absolute");
    expect(lop).toContain("after:-inset-[5px]");
    expect(lop).toContain("pointer-coarse:after:-inset-[15px]");
  });

  it("không đổi cỡ icon hiển thị (size-3.5 giữ nguyên để 37 form không xê dịch)", () => {
    render(<InfoTip>x</InfoTip>);
    const svg = screen.getByRole("button", { name: "Xem hướng dẫn" }).querySelector("svg")!;
    expect(svg.getAttribute("class")).toContain("size-3.5");
  });
});

describe("[HDUI-I7] nội dung hướng dẫn nằm TRONG MỘT khối bọc (chữ đậm không vỡ thành cột một-từ)", () => {
  // TooltipContent là `inline-flex`: mỗi nút con trực tiếp của nó thành MỘT CỘT. Đo trên trình duyệt thật 15/10/2026:
  // hướng dẫn có <b> vỡ thành các cột một-từ. jsdom không thấy bố cục ⇒ khoá cấu trúc DOM làm nên bố cục đó.
  it("chữ trần và thẻ <b> cùng nằm trong một <div>, không phải con trực tiếp của hộp flex", async () => {
    render(
      <InfoTip>
        Chọn <b>Đã cọc</b> thì hệ thống ghi số tiền.
      </InfoTip>,
    );
    await moBangBam(screen.getByRole("button", { name: "Xem hướng dẫn" }));
    const hop = document.querySelector<HTMLElement>('[data-slot="tooltip-content"]')!;
    const dam = hop.querySelector("b")!;
    const khoi = dam.parentElement!;
    expect(khoi.tagName).toBe("DIV");
    expect(khoi).not.toBe(hop);
    expect(khoi.parentElement).toBe(hop);
    // chữ trần quanh <b> cũng nằm trong cùng khối ấy (không có text node mồ côi dưới hộp flex)
    expect(khoi.textContent).toBe("Chọn Đã cọc thì hệ thống ghi số tiền.");
    expect([...hop.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "")).toEqual([]);
  });
});

describe("[HDUI-I6] hộp nội dung không tràn: rộng tối đa 18rem NHƯNG không quá bề ngang màn (320px)", () => {
  it("class giới hạn bề rộng có min(18rem, 100vw - 2rem)", async () => {
    render(<InfoTip>Hướng dẫn</InfoTip>);
    await moBangBam(screen.getByRole("button", { name: "Xem hướng dẫn" }));
    const hop = document.querySelector<HTMLElement>('[data-slot="tooltip-content"]')!;
    expect(hop.className).toContain("max-w-[min(18rem,calc(100vw-2rem))]");
    expect(hop.className).toContain("whitespace-normal");
  });
});
