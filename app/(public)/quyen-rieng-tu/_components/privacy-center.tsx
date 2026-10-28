"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  acceptAll,
  rejectAll,
  clearConsent,
  readConsent,
  writeConsent,
  type ConsentState,
} from "@/lib/cookie-consent";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

/**
 * Privacy Center — phần tương tác client của `/quyen-rieng-tu`.
 * Cho phép user xem và sửa consent đã đặt + withdraw consent.
 * Bắt buộc theo NĐ 13/2023/NĐ-CP (right to access, modify, withdraw).
 */
export function PrivacyCenter() {
  const [state, setState] = useState<ConsentState | null>(null);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    const current = readConsent();
    setState(current);
    if (current) {
      setAnalytics(current.categories.analytics);
      setMarketing(current.categories.marketing);
    }
  }, []);

  function handleSave() {
    const next = writeConsent({ necessary: true, analytics, marketing });
    setState(next);
    toast.success("Đã lưu lựa chọn quyền riêng tư");
  }

  function handleAcceptAll() {
    const next = acceptAll();
    setState(next);
    setAnalytics(true);
    setMarketing(true);
    toast.success("Đã chấp nhận tất cả cookie");
  }

  function handleRejectAll() {
    const next = rejectAll();
    setState(next);
    setAnalytics(false);
    setMarketing(false);
    toast.success("Đã từ chối cookie phân tích & tiếp thị");
  }

  function handleWithdraw() {
    clearConsent();
    setState(null);
    setAnalytics(false);
    setMarketing(false);
    toast.success(
      "Đã rút lại consent. Cookie banner sẽ hiện lại lần tới anh/chị ghé thăm.",
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 md:px-6 md:py-16">
      <div className="space-y-2">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          <Link href="/" className="hover:underline">Trang chủ</Link> /{" "}
          <span>Quyền riêng tư</span>
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-white">
          Trung tâm quyền riêng tư
        </h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          Quản lý cách Sata Robo sử dụng cookie và dữ liệu cá nhân của anh/chị
          khi truy cập trang. Theo Nghị định 13/2023/NĐ-CP.
        </p>
      </div>

      <div className="mt-10 space-y-6">
        <ConsentSection
          title="Cookie cần thiết"
          description="Đảm bảo các chức năng cốt lõi: đăng nhập, bảo mật phiên làm việc, ghi nhớ lựa chọn cookie. Không thể tắt."
          enabled
          disabled
        />
        <ConsentSection
          title="Cookie phân tích"
          description="Sata Robo dùng Google Analytics 4 để đo lượng truy cập, hành vi điều hướng và cải thiện trải nghiệm. IP được ẩn danh (anonymize_ip). Không sử dụng cho quảng cáo."
          enabled={analytics}
          onChange={setAnalytics}
        />
        <ConsentSection
          title="Cookie tiếp thị"
          description="Meta Pixel theo dõi hành vi để cá nhân hoá quảng cáo trên Facebook/Instagram và đo lường hiệu quả chiến dịch. Có thể chia sẻ dữ liệu mã hoá với Meta."
          enabled={marketing}
          onChange={setMarketing}
        />
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Button onClick={handleSave}>Lưu lựa chọn</Button>
        <Button variant="outline" onClick={handleAcceptAll}>
          Chấp nhận tất cả
        </Button>
        <Button variant="outline" onClick={handleRejectAll}>
          Từ chối tất cả
        </Button>
        <Button variant="ghost" onClick={handleWithdraw} className="text-red-600 hover:text-red-700">
          Rút lại toàn bộ consent
        </Button>
      </div>

      {state && (
        <div className="mt-10 rounded-lg border bg-neutral-50 p-4 text-sm dark:border-neutral-800 dark:bg-neutral-900/50">
          <div className="font-medium text-neutral-900 dark:text-white">
            Lần xác nhận gần nhất
          </div>
          <div className="mt-1 text-neutral-600 dark:text-neutral-400">
            {new Date(state.acceptedAt).toLocaleString("vi-VN")} — phiên bản {state.version}
          </div>
        </div>
      )}

      <div className="mt-12 space-y-4 text-sm text-neutral-600 dark:text-neutral-400">
        <h2 className="text-base font-semibold text-neutral-900 dark:text-white">
          Quyền của anh/chị
        </h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Quyền được biết dữ liệu cá nhân nào được thu thập</li>
          <li>Quyền truy cập, sửa đổi, xoá dữ liệu cá nhân</li>
          <li>Quyền phản đối, hạn chế xử lý dữ liệu</li>
          <li>Quyền rút lại consent bất cứ lúc nào (nút "Rút lại toàn bộ consent" ở trên)</li>
          <li>
            Quyền khiếu nại đến cơ quan có thẩm quyền (Bộ Công an — Cục An ninh
            mạng và phòng, chống tội phạm sử dụng công nghệ cao)
          </li>
        </ul>
        <p>
          Để thực hiện các quyền trên, anh/chị có thể liên hệ{" "}
          <a
            href="mailto:privacy@satarobo.vn"
            className="underline underline-offset-2 hover:text-neutral-900 dark:hover:text-white"
          >
            privacy@satarobo.vn
          </a>{" "}
          hoặc qua{" "}
          <Link href="/lien-he" className="underline underline-offset-2">
            trang Liên hệ
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

function ConsentSection({
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
    <div className="flex items-start justify-between gap-4 rounded-lg border bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex-1">
        <div className="text-base font-medium text-neutral-900 dark:text-white">
          {title}
        </div>
        <div className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
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
