"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { GhiDeAnh } from "@/lib/pub-anh/ghi-de-thuan";

/**
 * Ảnh admin đã thay (mã ảnh → `{url,w,h}`), do `PubRoot` (server) đọc từ DB rồi thả xuống cây. Dùng context để CẢ server component
 * lẫn client component (hero, popup…) cùng gọi `<PubAnh>` mà không đổi một chỗ gọi nào. Ngoài `PubRoot` (trang thử, bản xem trước)
 * context rỗng ⇒ mọi ảnh dùng bản mặc định.
 */
const RONG: Readonly<Record<string, GhiDeAnh>> = Object.freeze({});
const NguCanh = createContext<Readonly<Record<string, GhiDeAnh>>>(RONG);

export function PubAnhGhiDeProvider({ ghiDe, children }: { ghiDe: Readonly<Record<string, GhiDeAnh>>; children: ReactNode }) {
  return <NguCanh.Provider value={ghiDe}>{children}</NguCanh.Provider>;
}

export function useGhiDeAnh(id: string): GhiDeAnh | undefined {
  return useContext(NguCanh)[id];
}
