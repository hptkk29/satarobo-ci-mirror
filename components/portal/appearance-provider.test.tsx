// @vitest-environment jsdom
// Hành vi giao diện Cổng phụ huynh: class `.dark` và màu nhấn phải nằm INLINE trên
// wrapper `.portal-v2` (không rò ra <html> → admin/public không bị ảnh hưởng).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  PortalAppearanceProvider,
  usePortalAppearance,
} from "@/components/portal/appearance-provider";
import { GiaoDienPage } from "@/components/portal/giao-dien-page";
import { ROLE_DEFAULT_ACCENT } from "@/lib/portal/appearance";

const STORAGE_KEY = "sata-portal-appearance";

const store: Record<string, string> = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  });
  // jsdom không có matchMedia — chế độ "Hệ thống" cần nó.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
});

const saved = () => JSON.parse(store[STORAGE_KEY] ?? "null");

function Probe() {
  const a = usePortalAppearance();
  return (
    <div>
      <span data-testid="theme">{a.theme}</span>
      <span data-testid="dirty">{String(a.dirty)}</span>
      <button onClick={() => a.setTheme("dark")}>set-dark</button>
      <button onClick={() => a.setAccent("parent", "#123456")}>
        set-accent
      </button>
      <button onClick={() => a.saveAccents()}>save</button>
      <button onClick={() => a.discardAccents()}>discard</button>
    </div>
  );
}

function renderProvider(role: "parent" | "student" = "parent") {
  const { container } = render(
    <PortalAppearanceProvider role={role} className="portal-v2">
      <Probe />
    </PortalAppearanceProvider>,
  );
  const wrapper = container.firstElementChild as HTMLElement;
  return { wrapper };
}

describe("PortalAppearanceProvider", () => {
  it("mặc định: sáng, coral phụ huynh, data-mode=parent", () => {
    const { wrapper } = renderProvider();
    expect(wrapper.classList.contains("portal-v2")).toBe(true);
    expect(wrapper.classList.contains("dark")).toBe(false);
    expect(wrapper.dataset.mode).toBe("parent");
    expect(wrapper.style.getPropertyValue("--primary")).toBe(
      ROLE_DEFAULT_ACCENT.parent,
    );
  });

  it("đổi sang Tối: class `dark` lên wrapper (KHÔNG lên <html>) và lưu ngay", () => {
    const { wrapper } = renderProvider();
    fireEvent.click(screen.getByText("set-dark"));

    expect(wrapper.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(saved().theme).toBe("dark");
  });

  it("đổi màu nhấn: preview ngay trên wrapper nhưng chưa ghi localStorage", () => {
    const { wrapper } = renderProvider();
    fireEvent.click(screen.getByText("set-accent"));

    expect(wrapper.style.getPropertyValue("--primary")).toBe("#123456");
    expect(wrapper.style.getPropertyValue("--accent")).toBe("#123456");
    expect(screen.getByTestId("dirty").textContent).toBe("true");
    expect(store[STORAGE_KEY]).toBeUndefined();
  });

  it("bấm Lưu mới ghi localStorage và hết dirty", () => {
    renderProvider();
    fireEvent.click(screen.getByText("set-accent"));
    fireEvent.click(screen.getByText("save"));

    expect(saved().accents.parent).toBe("#123456");
    expect(screen.getByTestId("dirty").textContent).toBe("false");
  });

  it("Hoàn tác trả màu về bản đã lưu", () => {
    const { wrapper } = renderProvider();
    fireEvent.click(screen.getByText("set-accent"));
    fireEvent.click(screen.getByText("discard"));

    expect(wrapper.style.getPropertyValue("--primary")).toBe(
      ROLE_DEFAULT_ACCENT.parent,
    );
    expect(screen.getByTestId("dirty").textContent).toBe("false");
  });

  it("role=student: data-mode, màu cam, và mực TỐI (cam là màu sáng)", () => {
    const { wrapper } = renderProvider("student");
    expect(wrapper.dataset.mode).toBe("student");
    expect(wrapper.style.getPropertyValue("--primary")).toBe(
      ROLE_DEFAULT_ACCENT.student,
    );
    expect(wrapper.style.getPropertyValue("--primary-foreground")).toBe(
      "#241A2E",
    );
  });

  it("nhận lại chế độ Tối đã lưu ở shell v2 cũ (key `portal-theme`)", () => {
    store["portal-theme"] = "dark";
    const { wrapper } = renderProvider();
    expect(wrapper.classList.contains("dark")).toBe(true);
    expect(screen.getByTestId("theme").textContent).toBe("dark");
  });

  it("màu nhấn tương phản: nền tối → chữ trắng, nền sáng → mực tối", () => {
    const { wrapper } = renderProvider();
    fireEvent.click(screen.getByText("set-accent")); // #123456 — tối
    expect(wrapper.style.getPropertyValue("--primary-foreground")).toBe(
      "#FFFFFF",
    );
  });
});

describe("Trang /portal/giao-dien", () => {
  const renderPage = (role: "parent" | "student" = "parent") =>
    render(
      <PortalAppearanceProvider role={role} className="portal-v2">
        <GiaoDienPage />
      </PortalAppearanceProvider>,
    ).container.firstElementChild as HTMLElement;

  it("chọn Tối làm tối cả cổng", () => {
    const wrapper = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Tối/ }));
    expect(wrapper.classList.contains("dark")).toBe(true);
  });

  it("bấm đúng preset mặc định (Tím) thì không có gì để lưu", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Màu Tím" }));
    expect(screen.getByRole("button", { name: /Lưu thay đổi/ })).toBeDisabled();
  });

  it("chọn preset rồi Lưu → ghi đúng màu cho vai trò đang sửa", () => {
    renderPage();
    const save = screen.getByRole("button", { name: /Lưu thay đổi/ });
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Màu Xanh ngọc" }));
    expect(save).toBeEnabled();
    fireEvent.click(save);

    expect(saved().accents.parent).toBe("#1F93A8");
    // Học sinh chưa đổi → không ghi, để nhận mặc định hiện hành.
    expect(saved().accents.student).toBeUndefined();
  });

  it("đổi tab sang Học sinh thì sửa màu học sinh, không đụng màu phụ huynh", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Học sinh/ }));
    fireEvent.click(screen.getByRole("button", { name: "Màu Chàm" }));
    fireEvent.click(screen.getByRole("button", { name: /Lưu thay đổi/ }));

    expect(saved().accents.student).toBe("#4F46E5");
    expect(saved().accents.parent).toBeUndefined();
  });

  it("ô HEX chỉ commit khi đủ 6 ký tự hợp lệ", () => {
    const wrapper = renderPage();
    const hex = screen.getByLabelText("Mã màu HEX");

    fireEvent.change(hex, { target: { value: "ff0" } });
    expect(wrapper.style.getPropertyValue("--primary")).toBe(
      ROLE_DEFAULT_ACCENT.parent,
    );

    fireEvent.change(hex, { target: { value: "ff0000" } });
    expect(wrapper.style.getPropertyValue("--primary")).toBe("#FF0000");
  });
});
