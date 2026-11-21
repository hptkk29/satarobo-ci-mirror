"use client";

import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { chonDichDen404, DICH_DEN_MAC_DINH } from "@/lib/routing/dich-den-404";

// Host đọc ở TRÌNH DUYỆT (xem lib/routing/dich-den-404.ts: vì sao không đọc host trên server).
// Bản server/hydrate dùng snapshot "" (⇒ host công khai), sau hydrate React cập nhật theo `window.location.host`.
const khongDangKy = () => () => {};
const docHostTrinhDuyet = () => window.location.host;
const docHostServer = () => "";

/** Host hiện tại có phải site công khai (satarobo.vn / test…) không — admin / giáo viên / cổng PH thì không. */
export function useLaHostCongKhai(): boolean {
  const host = useSyncExternalStore(khongDangKy, docHostTrinhDuyet, docHostServer);
  return chonDichDen404(host).href === DICH_DEN_MAC_DINH.href;
}

/** Chỉ vẽ `children` ở host công khai (thanh trên · chân trang · nút nổi của site public không có nghĩa ở admin / GV / PH). */
export function ChiHienOHostCongKhai({ children }: { children: ReactNode }) {
  return useLaHostCongKhai() ? <>{children}</> : null;
}
