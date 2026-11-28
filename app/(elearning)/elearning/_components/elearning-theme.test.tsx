// @vitest-environment jsdom
/**
 * [EL-TH-*] Sáng/Tối của khu e-learning — gốc `.elearning-root`, `.dark` KHÔNG lên <html>/<body>, và hộp nổi qua portal
 * (Dialog, Dropdown…) mang lại token + `.dark` của gốc.
 *
 * Vì sao test hộp nổi bằng primitive THẬT: lỗi cần canh là "popup sáng nổi lên giữa nền tối" — chỉ xảy ra với container
 * portal thật do base-ui dựng; giả lập container bằng tay thì xanh dù cơ chế không chạm tới container thật.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  ElearningThemeRoot,
  KHOA_THEME,
  laTheme,
  phanGiaiTheme,
  useElearningTheme,
} from "./elearning-theme";

beforeEach(() => {
  window.localStorage.clear();
  // jsdom không có matchMedia: giả lập "hệ thống sáng", đủ để kiểm hành vi chọn tay.
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function Doi() {
  const { setTheme, theme, resolved } = useElearningTheme();
  return (
    <div>
      <span data-testid="trang-thai">{`${theme}/${resolved}`}</span>
      <button type="button" onClick={() => setTheme("dark")}>
        toi
      </button>
      <button type="button" onClick={() => setTheme("light")}>
        sang
      </button>
    </div>
  );
}

const goc = () => document.querySelector<HTMLElement>(".elearning-root")!;

describe("[EL-TH-01] hàm thuần", () => {
  it("laTheme chỉ nhận ba giá trị", () => {
    expect(["light", "dark", "system"].every(laTheme)).toBe(true);
    expect(laTheme("blue")).toBe(false);
    expect(laTheme(null)).toBe(false);
  });
  it("phanGiaiTheme: system theo hệ điều hành, còn lại giữ nguyên", () => {
    expect(phanGiaiTheme("system", true)).toBe("dark");
    expect(phanGiaiTheme("system", false)).toBe("light");
    expect(phanGiaiTheme("light", true)).toBe("light");
    expect(phanGiaiTheme("dark", false)).toBe("dark");
  });
});

describe("[EL-TH-02] gốc + phạm vi", () => {
  it("mặc định theo hệ thống (sáng ở đây), gốc có elearning-root và admin-scope, KHÔNG có dark", () => {
    render(
      <ElearningThemeRoot>
        <Doi />
      </ElearningThemeRoot>,
    );
    expect(screen.getByTestId("trang-thai").textContent).toBe("system/light");
    expect(goc().classList.contains("admin-scope")).toBe(true);
    expect(goc().classList.contains("dark")).toBe(false);
  });

  it("chọn Tối ⇒ `.dark` lên CHÍNH gốc, KHÔNG lên <html> hay <body>, và được nhớ lại", () => {
    render(
      <ElearningThemeRoot>
        <Doi />
      </ElearningThemeRoot>,
    );
    fireEvent.click(screen.getByText("toi"));
    expect(goc().classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.body.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem(KHOA_THEME)).toBe("dark");
  });

  it("đọc lại lựa chọn đã lưu sau khi mount; giá trị lạ trong kho bị bỏ", () => {
    window.localStorage.setItem(KHOA_THEME, "dark");
    const { unmount } = render(
      <ElearningThemeRoot>
        <Doi />
      </ElearningThemeRoot>,
    );
    expect(screen.getByTestId("trang-thai").textContent).toBe("dark/dark");
    unmount();
    window.localStorage.setItem(KHOA_THEME, "tím");
    render(
      <ElearningThemeRoot>
        <Doi />
      </ElearningThemeRoot>,
    );
    expect(screen.getByTestId("trang-thai").textContent).toBe("system/light");
  });
});

describe("[EL-TH-04] bộ quan sát bỏ qua phần tử hạ tầng", () => {
  it("<next-route-announcer> (phần tử tuỳ biến) KHÔNG bị gắn token; <div> thường thì có", async () => {
    render(
      <ElearningThemeRoot>
        <Doi />
      </ElearningThemeRoot>,
    );
    const hatang = document.createElement("next-route-announcer");
    const thuong = document.createElement("div");
    document.body.append(hatang, thuong);
    await act(async () => {});
    expect(hatang.classList.contains("elearning-root")).toBe(false);
    expect(thuong.classList.contains("elearning-root")).toBe(true);
  });
});

describe("[EL-TH-03] hộp nổi qua portal mang lại token + dark của gốc", () => {
  function DungHop() {
    return (
      <ElearningThemeRoot>
        <Doi />
        <Dialog open>
          <DialogContent showCloseButton={false}>
            <DialogTitle>Hộp thoại</DialogTitle>
          </DialogContent>
        </Dialog>
      </ElearningThemeRoot>
    );
  }
  const containerCuaHop = () => {
    const popup = document.querySelector('[data-slot="dialog-content"]')!;
    let el: HTMLElement | null = popup as HTMLElement;
    while (el && el.parentElement !== document.body) el = el.parentElement;
    return el!;
  };

  it("sáng: container mang elearning-root nhưng KHÔNG dark", async () => {
    render(<DungHop />);
    await act(async () => {});
    const c = containerCuaHop();
    expect(c.classList.contains("elearning-root")).toBe(true);
    expect(c.classList.contains("dark")).toBe(false);
  });

  it("đổi sang tối KHI popup đang mở ⇒ container đang mở cũng nhận dark ngay (không đợi mở lại)", async () => {
    render(<DungHop />);
    await act(async () => {});
    fireEvent.click(screen.getByText("toi"));
    await act(async () => {});
    expect(containerCuaHop().classList.contains("dark")).toBe(true);
    fireEvent.click(screen.getByText("sang"));
    await act(async () => {});
    expect(containerCuaHop().classList.contains("dark")).toBe(false);
  });

  it("rời khu e-learning (unmount) ⇒ container còn nằm trong <body> được trả sạch class (admin không thừa token e-learning)", async () => {
    const { unmount } = render(<DungHop />);
    await act(async () => {});
    // Một container portal "ở lại" sau khi khung gỡ (vd. popup đang đóng dở): dựng tay để chắc chắn nó còn trong <body>.
    const conLai = document.createElement("div");
    document.body.appendChild(conLai);
    await act(async () => {});
    expect(conLai.classList.contains("elearning-root")).toBe(true);
    unmount();
    expect(conLai.classList.contains("elearning-root")).toBe(false);
    expect(conLai.classList.contains("admin-scope")).toBe(false);
    expect(conLai.classList.contains("dark")).toBe(false);
    expect(conLai.hasAttribute("data-el-portal")).toBe(false);
  });
});
