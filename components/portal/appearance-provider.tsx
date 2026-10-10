"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import {
  accentCssVars,
  accentsEqual,
  defaultAppearance,
  loadAppearance,
  normalizeHex,
  resolveDark,
  saveAppearance,
  type PortalAppearance,
  type PortalRole,
  type ThemeMode,
} from "@/lib/portal/appearance";

// Provider bọc TOÀN BỘ shell portal v2 và tự render wrapper `.portal-v2`, vì màu
// nhấn + class `.dark` phải nằm trên đúng phần tử đó (xem app/globals.css).
//
// Chế độ Sáng/Tối lưu NGAY khi chọn. Màu nhấn preview trực tiếp trên shell nhưng
// chỉ ghi localStorage khi bấm "Lưu" — giống trang Giao diện của SataUI.

type PortalAppearanceContextValue = {
  /** false ở lần render đầu (SSR + hydrate) → chưa đọc localStorage. */
  mounted: boolean;
  /** Vai trò đang xem, suy từ route; quyết định màu nào đang áp lên shell. */
  role: PortalRole;
  theme: ThemeMode;
  isDark: boolean;
  setTheme: (theme: ThemeMode) => void;
  /** Màu đang hiển thị (bản nháp) — thay đổi thấy ngay trên shell. */
  accents: Record<PortalRole, string>;
  setAccent: (role: PortalRole, hex: string) => void;
  saveAccents: () => void;
  discardAccents: () => void;
  dirty: boolean;
};

const PortalAppearanceContext =
  createContext<PortalAppearanceContextValue | null>(null);

export function usePortalAppearance(): PortalAppearanceContextValue {
  const ctx = useContext(PortalAppearanceContext);
  if (ctx === null) {
    throw new Error(
      "usePortalAppearance phải nằm trong <PortalAppearanceProvider>",
    );
  }
  return ctx;
}

export function PortalAppearanceProvider({
  role,
  className,
  children,
}: {
  role: PortalRole;
  className?: string;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [systemDark, setSystemDark] = useState(false);
  // `saved` = bản đã ghi localStorage. `draft` = màu đang preview trên shell.
  const [saved, setSaved] = useState<PortalAppearance>(defaultAppearance);
  const [draft, setDraft] = useState<Record<PortalRole, string>>(
    () => defaultAppearance().accents,
  );

  useEffect(() => {
    const stored = loadAppearance();
    setSaved(stored);
    setDraft(stored.accents);
    setMounted(true);
  }, []);

  // Chế độ "Hệ thống" bám theo prefers-color-scheme, kể cả khi user đổi giữa phiên.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemDark(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const setTheme = useCallback((theme: ThemeMode) => {
    setSaved((prev) => {
      const next = { ...prev, theme };
      saveAppearance(next);
      return next;
    });
  }, []);

  const setAccent = useCallback((target: PortalRole, hex: string) => {
    setDraft((prev) => ({ ...prev, [target]: normalizeHex(hex) }));
  }, []);

  const saveAccents = useCallback(() => {
    setSaved((prev) => {
      const next = { ...prev, accents: { ...draft } };
      saveAppearance(next);
      return next;
    });
  }, [draft]);

  const discardAccents = useCallback(
    () => setDraft(saved.accents),
    [saved.accents],
  );

  const isDark = resolveDark(saved.theme, systemDark);
  const dirty = !accentsEqual(draft, saved.accents);

  // Trước khi mount thì chưa biết màu đã lưu → để CSS mặc định của `.portal-v2`
  // lo lần paint đầu, tránh lệch hydrate giữa server và client.
  const style = useMemo(
    () => (mounted ? accentCssVars(draft[role]) : undefined),
    [mounted, draft, role],
  );

  const value = useMemo<PortalAppearanceContextValue>(
    () => ({
      mounted,
      role,
      theme: saved.theme,
      isDark,
      setTheme,
      accents: draft,
      setAccent,
      saveAccents,
      discardAccents,
      dirty,
    }),
    [
      mounted,
      role,
      saved.theme,
      isDark,
      setTheme,
      draft,
      setAccent,
      saveAccents,
      discardAccents,
      dirty,
    ],
  );

  return (
    <PortalAppearanceContext.Provider value={value}>
      <div
        className={cn(className, isDark && "dark")}
        style={style}
        data-mode={role}
      >
        {children}
      </div>
    </PortalAppearanceContext.Provider>
  );
}
