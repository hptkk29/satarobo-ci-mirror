"use client";

// Sáng/Tối cho riêng khu e-learning (Q3, DECISIONS.md D-02).
//
// KHÔNG dùng ThemeProvider của next-themes (nó gắn `.dark` lên <html>): điều hướng client từ /elearning sang /admin
// sẽ để `.dark` trên <html> và kéo admin sang nền tối. Class `.dark` đặt lên CHÍNH phần tử `.elearning-root` — tiền lệ
// `app/(teacher)/teacher/_components/teacher-theme.tsx`. Token nằm ở ../elearning.css.
//
// Mặc định "Hệ thống" (Q3). SSR luôn ra bản sáng để markup server/client khớp, effect đồng bộ lại ngay sau mount
// (không lệch hydrate). Lưu lựa chọn trong localStorage — chỉ là tiện nghi từng người, mọi đọc/ghi bọc try/catch.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export type ElearningTheme = "light" | "dark" | "system";

export const KHOA_THEME = "satarobo:elearning:theme";

type Ctx = {
  /** Lựa chọn của người dùng (có thể là "system"). */
  theme: ElearningTheme;
  /** Kết quả đã phân giải — thứ đang hiển thị. */
  resolved: "light" | "dark";
  setTheme: (t: ElearningTheme) => void;
};

const ElearningThemeContext = createContext<Ctx | null>(null);

export function useElearningTheme(): Ctx {
  const ctx = useContext(ElearningThemeContext);
  if (!ctx) throw new Error("useElearningTheme phải nằm trong <ElearningThemeRoot>");
  return ctx;
}

/** THUẦN — kiểm giá trị đọc từ localStorage (chuỗi lạ ⇒ bỏ, rơi về "system"). */
export function laTheme(v: string | null): v is ElearningTheme {
  return v === "light" || v === "dark" || v === "system";
}

/** THUẦN — phân giải lựa chọn + trạng thái hệ thống thành sáng/tối. */
export function phanGiaiTheme(theme: ElearningTheme, heThongToi: boolean): "light" | "dark" {
  return theme === "system" ? (heThongToi ? "dark" : "light") : theme;
}

/** Thẻ mà bộ quan sát bỏ qua: không phải hộp nổi, gắn token lên chúng là vô nghĩa. */
const THE_BO_QUA = new Set(["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT"]);

/**
 * THUẦN theo DOM — gắn phạm vi e-learning lên MỘT phần tử con trực tiếp của <body> (container của portal).
 *
 * Vì sao có: Dialog · Dropdown · Select · Sheet · Tooltip · Combobox render qua portal ra <body>, tức NGOÀI
 * `.elearning-root` — nên mất cả token kem/tím lẫn `.dark` (popup sáng nổi lên giữa nền tối). Sửa từng primitive là sửa
 * 7 tệp dùng chung với ~82 trang admin (danh sách CHO_OWNER_DUYET trong popup-pham-vi-quan-tri.test.tsx — chưa được
 * duyệt); gắn ở container thì CHỈ ảnh hưởng khi khu e-learning đang mở, vì bộ quan sát chỉ sống cùng `ElearningThemeRoot`.
 */
export function ganPhamViChoPortal(el: Element, toi: boolean): void {
  if (THE_BO_QUA.has(el.tagName)) return;
  // Phần tử tuỳ biến (`next-route-announcer`, `nextjs-portal`…) là hạ tầng của Next, không phải hộp nổi của giao diện.
  if (el.tagName.includes("-")) return;
  // Chứa chính khung e-learning (vd. gốc ứng dụng) thì không phải portal — đừng đè lên nó. Container ĐÃ gắn trước đó
  // (có `data-el-portal`) thì luôn được cập nhật `.dark` — nó đang mang `elearning-root` do chính ta gắn.
  if (!el.hasAttribute("data-el-portal") && (el.querySelector(".elearning-root") || el.classList.contains("elearning-root"))) return;
  el.setAttribute("data-el-portal", "");
  el.classList.add("admin-scope", "elearning-root");
  el.classList.toggle("dark", toi);
}

function heThongDangToi(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Phần tử GỐC của khu e-learning: mang `.elearning-root` (+ `.dark`) và `.admin-scope` (token tím/cam, popup tìm thấy nó để
 * tự gắn lại phạm vi). Nền/chữ đi qua class Tailwind, KHÔNG qua CSS không-layer (xem elearning.css).
 */
export function ElearningThemeRoot({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ElearningTheme>("system");
  const [heThongToi, setHeThongToi] = useState(false);

  useEffect(() => {
    try {
      const luu = window.localStorage.getItem(KHOA_THEME);
      if (laTheme(luu)) setThemeState(luu);
    } catch {
      /* chế độ riêng tư / bị chặn: dùng mặc định */
    }
    setHeThongToi(heThongDangToi());
  }, []);

  // Theo dõi hệ điều hành đổi giao diện khi người dùng đang chọn "Hệ thống".
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setHeThongToi(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setTheme = useCallback((t: ElearningTheme) => {
    try {
      window.localStorage.setItem(KHOA_THEME, t);
    } catch {
      /* như trên */
    }
    setThemeState(t);
  }, []);

  const resolved = phanGiaiTheme(theme, heThongToi);

  // Hộp nổi qua portal: gắn token + `.dark` lên container ngay khi nó xuất hiện (MutationObserver chạy như microtask,
  // trước lần vẽ kế tiếp ⇒ không nháy sáng). Đổi giao diện khi popup đang mở: cập nhật cả những container đã gắn.
  useEffect(() => {
    const toi = resolved === "dark";
    document.querySelectorAll("body > [data-el-portal]").forEach((el) => ganPhamViChoPortal(el, toi));
    const obs = new MutationObserver((ds) => {
      for (const d of ds) {
        d.addedNodes.forEach((n) => {
          if (n.nodeType === 1 && n.parentNode === document.body) ganPhamViChoPortal(n as Element, toi);
        });
      }
    });
    obs.observe(document.body, { childList: true });
    return () => obs.disconnect();
  }, [resolved]);

  // Rời khu e-learning: trả sạch container còn sót để admin không thừa class (portal thường đã tự gỡ). CHỈ khi
  // unmount — nếu gộp vào effect trên thì mỗi lần đổi sáng/tối sẽ gỡ sạch rồi không tìm lại được container đang mở.
  useEffect(
    () => () => {
      document.querySelectorAll("body > [data-el-portal]").forEach((el) => {
        el.removeAttribute("data-el-portal");
        el.classList.remove("admin-scope", "elearning-root", "dark");
      });
    },
    [],
  );

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);

  return (
    <ElearningThemeContext.Provider value={value}>
      <div
        data-elearning-theme={resolved}
        data-tuy-chon={theme}
        className={cn(
          "admin-scope elearning-root min-h-screen bg-background text-sm text-foreground print:bg-white",
          resolved === "dark" && "dark",
        )}
      >
        {children}
      </div>
    </ElearningThemeContext.Provider>
  );
}
