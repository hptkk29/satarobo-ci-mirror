"use client";

// Sáng/Tối cho riêng site giáo viên.
//
// KHÔNG dùng ThemeProvider của next-themes (nó gắn `.dark` lên <html>) — vì điều
// hướng client từ /teacher sang /admin sẽ để lại `.dark` trên <html>, kéo theo
// admin bị nền tối. Thay vào đó gắn `.dark` lên chính `.teacher-root`, đúng
// pattern app/(auth)/auth.css. Token nằm ở ./teacher.css.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { cn } from "@/lib/utils";

export type TeacherTheme = "light" | "dark" | "system";

const STORAGE_KEY = "teacher-theme";

type Ctx = {
  /** Lựa chọn của người dùng (có thể là "system"). */
  theme: TeacherTheme;
  /** Kết quả đã phân giải — thứ đang hiển thị. */
  resolved: "light" | "dark";
  setTheme: (t: TeacherTheme) => void;
};

const TeacherThemeContext = createContext<Ctx | null>(null);

export function useTeacherTheme(): Ctx {
  const ctx = useContext(TeacherThemeContext);
  if (!ctx) {
    throw new Error("useTeacherTheme phải nằm trong <TeacherThemeRoot>");
  }
  return ctx;
}

function isTheme(v: string | null): v is TeacherTheme {
  return v === "light" || v === "dark" || v === "system";
}

function prefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/**
 * Bọc toàn bộ site GV. Render `.teacher-root` (+ `.dark` khi cần) — mọi token
 * trong teacher.css bám vào đây.
 */
export function TeacherThemeRoot({ children }: { children: React.ReactNode }) {
  // SSR luôn ra "light" để markup server/client khớp nhau; effect dưới sẽ đồng
  // bộ lại theo localStorage ngay sau khi mount.
  const [theme, setThemeState] = useState<TeacherTheme>("light");
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isTheme(stored)) setThemeState(stored);
    setSystemDark(prefersDark());
  }, []);

  // Theo dõi thay đổi của hệ điều hành khi người dùng chọn "Hệ thống".
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setTheme = useCallback((t: TeacherTheme) => {
    localStorage.setItem(STORAGE_KEY, t);
    setThemeState(t);
  }, []);

  const resolved: "light" | "dark" =
    theme === "system" ? (systemDark ? "dark" : "light") : theme;

  const value = useMemo(
    () => ({ theme, resolved, setTheme }),
    [theme, resolved, setTheme],
  );

  return (
    <TeacherThemeContext.Provider value={value}>
      <div
        className={cn(
          "teacher-root flex min-h-screen flex-col",
          resolved === "dark" && "dark",
        )}
      >
        {children}
      </div>
    </TeacherThemeContext.Provider>
  );
}
