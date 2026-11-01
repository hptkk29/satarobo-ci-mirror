"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { chonDichDen404, DICH_DEN_MAC_DINH } from "@/lib/routing/dich-den-404";

// Host đọc ở TRÌNH DUYỆT (xem lib/routing/dich-den-404.ts: vì sao không đọc `headers()` trên server).
// `useSyncExternalStore`: bản server/hydrate dùng snapshot "" (⇒ link trang chủ), sau hydrate React tự
// cập nhật theo `window.location.host` — không cần effect, không cần state.
const khongDangKy = () => () => {};
const docHostTrinhDuyet = () => window.location.host;
const docHostServer = () => "";

export function NutVeTrangChinh() {
  const host = useSyncExternalStore(khongDangKy, docHostTrinhDuyet, docHostServer);
  const dest = chonDichDen404(host);
  return (
    <>
      <Link
        href={dest.href}
        className="rounded-lg bg-[#7C3AED] px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
      >
        {dest.label}
      </Link>
      {dest.href !== DICH_DEN_MAC_DINH.href && (
        <Link
          href={DICH_DEN_MAC_DINH.href}
          className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
        >
          {DICH_DEN_MAC_DINH.label}
        </Link>
      )}
    </>
  );
}
