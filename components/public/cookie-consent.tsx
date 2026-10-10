"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  acceptAll,
  rejectAll,
  readConsent,
  writeConsent,
} from "@/lib/cookie-consent";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

/**
 * Cookie consent banner — NĐ 13/2023/NĐ-CP compliance.
 *
 * - Hiển thị khi chưa có consent (hoặc CONSENT_VERSION đã đổi).
 * - 3 lựa chọn: Chấp nhận tất cả · Chỉ cần thiết · Tuỳ chỉnh.
 * - Dispatch `consent-change` event để GA4 / MetaPixel listen và load có điều kiện.
 *
 * Đặt component này ở app/(public)/layout.tsx (không phải admin).
 */
export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [showCustomize, setShowCustomize] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    // Defer to avoid hydration mismatch — localStorage only on client.
    const t = setTimeout(() => {
      const existing = readConsent();
      if (!existing) setVisible(true);
    }, 800); // delay to not jar first paint
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  function handleAcceptAll() {
    acceptAll();
    setVisible(false);
  }

  function handleRejectAll() {
    rejectAll();
    setVisible(false);
  }

  function handleSaveCustom() {
    writeConsent({ necessary: true, analytics, marketing });
    setVisible(false);
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-consent-title"
      className="fixed inset-x-0 bottom-0 z-[70] border-t bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950"
    >
      <div className="mx-auto max-w-6xl px-4 py-4 md:px-6 md:py-5">
        {!showCustomize ? (
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex-1 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
              <p id="cookie-consent-title" className="font-medium text-neutral-900 dark:text-white">
                Sata Robo sử dụng cookie
              </p>
              <p className="mt-1">
                Chúng tôi dùng cookie để vận hành trang, phân tích lưu lượng và cải thiện trải nghiệm.
                Anh/chị có thể chấp nhận tất cả, từ chối, hoặc tuỳ chỉnh.{" "}
                <Link
                  href="/chinh-sach-bao-mat"
                  className="underline underline-offset-2 hover:text-neutral-900 dark:hover:text-white"
                >
                  Chính sách bảo mật
                </Link>
                .
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowCustomize(true)}
                className="whitespace-nowrap"
              >
                Tuỳ chỉnh
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRejectAll}
                className="whitespace-nowrap"
              >
                Chỉ cần thiết
              </Button>
              <Button
                size="sm"
                onClick={handleAcceptAll}
                className="whitespace-nowrap"
              >
                Chấp nhận tất cả
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-neutral-900 dark:text-white">
                Tuỳ chỉnh cookie
              </h2>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                Bật/tắt từng nhóm cookie theo nhu cầu.
              </p>
            </div>

            <div className="space-y-3">
              <ConsentRow
                title="Cookie cần thiết"
                description="Đảm bảo các chức năng cốt lõi (đăng nhập, bảo mật). Không thể tắt."
                enabled
                disabled
              />
              <ConsentRow
                title="Cookie phân tích"
                description="Google Analytics — đo lượng truy cập để cải thiện trang. Không thu thập danh tính cá nhân trực tiếp."
                enabled={analytics}
                onChange={setAnalytics}
              />
              <ConsentRow
                title="Cookie tiếp thị"
                description="Meta Pixel, Facebook conversion API — cá nhân hoá quảng cáo và đo hiệu quả chiến dịch."
                enabled={marketing}
                onChange={setMarketing}
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowCustomize(false)}
              >
                Quay lại
              </Button>
              <Button size="sm" onClick={handleSaveCustom}>
                Lưu lựa chọn
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ConsentRow({
  title,
  description,
  enabled,
  onChange,
  disabled = false,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/50">
      <div className="flex-1">
        <div className="text-sm font-medium text-neutral-900 dark:text-white">{title}</div>
        <div className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-400">
          {description}
        </div>
      </div>
      <Switch
        checked={enabled}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={`Bật/tắt ${title}`}
      />
    </div>
  );
}
