"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck, ExternalLink } from "lucide-react";
import {
  SITE_POLICY_TIEU_DE,
  SITE_POLICY_TOM_TAT,
  SITE_POLICY_LY_DO,
  SITE_POLICY_HREF,
  SITE_POLICY_NHAN_TRUOC,
  SITE_POLICY_NHAN_LINK,
  SITE_POLICY_NHAN_SAU,
} from "@/lib/legal/site-policy-content";
import { acceptSitePolicyAction } from "../actions";

// Màn CỔNG của `/portal/hoc-phi` — hồ sơ Bộ Công Thương mục 4.
//
// ⚠️ Import từ `site-policy-CONTENT`, KHÔNG từ `site-policy`: file kia chạm `@/lib/db`,
// import vào Client Component là kéo Prisma xuống bundle trình duyệt.
//
// Cố ý KHÔNG dùng modal/dialog: modal tắt được bằng Esc, và nội dung phía sau nó đã nằm
// trong payload RSC — tức không phải cổng. Cổng thật nằm ở layout, đây chỉ là màn hình.
export function SitePolicyGate() {
  const router = useRouter();
  const [dongY, setDongY] = useState(false);
  const [pending, startTransition] = useTransition();

  function xacNhan() {
    startTransition(async () => {
      const res = await acceptSitePolicyAction();
      if (!res.ok) {
        toast.error(res.error ?? "Không ghi nhận được xác nhận, vui lòng thử lại.");
        return;
      }
      // `refresh` chứ không `push`: cây RSC dựng lại và nội dung học phí hiện ra TẠI CHỖ.
      // Không toast "thành công" — nội dung hiện ra đã là phản hồi.
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-xl border border-border bg-card p-6 sm:p-8">
        <div className="mb-4 flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </span>
          <div>
            <h1 className="text-lg font-bold text-foreground">{SITE_POLICY_TIEU_DE}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{SITE_POLICY_LY_DO}</p>
          </div>
        </div>

        <ul className="mb-5 space-y-2 rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
          {SITE_POLICY_TOM_TAT.map((dong) => (
            <li key={dong} className="flex gap-2">
              <span aria-hidden className="text-primary">
                •
              </span>
              <span>{dong}</span>
            </li>
          ))}
        </ul>

        {/* `target="_blank"`: mở toàn văn ở tab mới để phụ huynh KHÔNG mất chỗ đang đứng. */}
        <a
          href={SITE_POLICY_HREF}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          Đọc toàn văn các chính sách
          <ExternalLink className="h-3.5 w-3.5" />
        </a>

        {/* Ô TÍCH THẬT — hướng dẫn BCT dùng chữ "tích xác nhận", nên phải là ô tích chụp
            màn làm bằng được, không phải một nút "Tôi đồng ý". */}
        <label
          htmlFor="dong-y-chinh-sach-hoat-dong"
          className="flex cursor-pointer items-start gap-2 text-sm"
        >
          <input
            id="dong-y-chinh-sach-hoat-dong"
            type="checkbox"
            checked={dongY}
            onChange={(e) => setDongY(e.target.checked)}
            disabled={pending}
            className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-input text-primary focus:ring-primary"
          />
          <span>
            {SITE_POLICY_NHAN_TRUOC}
            <a
              href={SITE_POLICY_HREF}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline underline-offset-2"
              onClick={(e) => e.stopPropagation()}
            >
              {SITE_POLICY_NHAN_LINK}
            </a>
            {SITE_POLICY_NHAN_SAU}
          </span>
        </label>

        <button
          type="button"
          onClick={xacNhan}
          disabled={!dongY || pending}
          className="mt-5 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Đang ghi nhận…" : "Xác nhận và tiếp tục"}
        </button>

        <p className="mt-3 text-center text-xs text-muted-foreground">
          Các mục khác của cổng phụ huynh (học bạ, lịch học, tin nhắn, thông báo) vẫn dùng
          bình thường.
        </p>
      </div>
    </div>
  );
}
