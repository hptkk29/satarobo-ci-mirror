"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { legalHref } from "@/lib/legal-pages";
import { cn } from "@/lib/utils";

// components/public/o-tich-chinh-sach.tsx — Ô TÍCH ĐỒNG Ý CHÍNH SÁCH BẢO MẬT.
//
// ─────────────────────────────────────────────────────────────────────────────
// Nguồn: hướng dẫn BCT mục 3 — *"Ở trang đăng ký, bổ sung nội dung cho người mua tích xác
// nhận «Tôi đã đọc và đồng ý với Chính sách bảo mật của website» => Gắn link nội dung
// chính sách"*. Ảnh minh hoạ kèm theo chốt ba chi tiết mà CHỮ KHÔNG NÓI:
//
//   · ô vuông RỖNG  ⇒ mặc định CHƯA tích (người dùng phải chủ động tích);
//   · chỉ cụm "Chính sách bảo mật" được gạch chân ⇒ link CHỈ bọc ba chữ đó, không bọc cả câu;
//   · mũi tên chú "Gắn link nội dung chính sách" trỏ đúng vào cụm ấy.
//
// Trước 21/09/2026 toàn bộ mặt công khai có ĐÚNG MỘT ô tích (`components/khoa-hoc/
// consult-modal.tsx`), và nó là ô MARKETING, tích sẵn, không chặn gửi. Ba biểu mẫu còn lại
// chỉ có một đoạn `<p>` kiểu "Gửi thông tin đồng nghĩa bạn đồng ý…" — đó là DÒNG CHỮ, không
// phải ô tích, và hồ sơ đòi ô tích.
//
// Dùng `<input type="checkbox">` thuần: repo không có `components/ui/checkbox.tsx`, và đây
// đúng là hình dạng trong ảnh. `forwardRef` để dùng được cả hai kiểu — controlled
// (`checked`/`onChange`) lẫn `register()` của react-hook-form.
// ─────────────────────────────────────────────────────────────────────────────

/** Nhãn NGUYÊN VĂN theo hướng dẫn, tách làm ba phần để chỉ giữa là link. */
export const NHAN_O_TICH_TRUOC = "Tôi đã đọc và đồng ý với ";
export const NHAN_O_TICH_LINK = "Chính sách bảo mật";
export const NHAN_O_TICH_SAU = " của website";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /** Thông báo lỗi hiện dưới ô khi người dùng bấm gửi mà chưa tích. */
  loi?: string | null;
  /** Class cho khối bọc ngoài (không phải cho ô tích). */
  wrapperClassName?: string;
};

export const OTichChinhSach = forwardRef<HTMLInputElement, Props>(function OTichChinhSach(
  { loi, wrapperClassName, className, id = "dong-y-chinh-sach-bao-mat", ...inputProps },
  ref,
) {
  return (
    <div className={cn("space-y-1", wrapperClassName)}>
      <label
        htmlFor={id}
        className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed"
      >
        <input
          {...inputProps}
          ref={ref}
          id={id}
          type="checkbox"
          aria-invalid={loi ? true : undefined}
          className={cn(
            "mt-0.5 h-4 w-4 flex-shrink-0 rounded border-gray-300 text-orange-600 focus:ring-orange-500",
            loi && "border-red-500",
            className,
          )}
        />
        <span>
          {NHAN_O_TICH_TRUOC}
          <a
            href={legalHref("chinh-sach-bao-mat")}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary-purple underline underline-offset-2"
            // Bấm vào link KHÔNG được làm đổi trạng thái ô tích (link nằm trong <label>).
            onClick={(e) => e.stopPropagation()}
          >
            {NHAN_O_TICH_LINK}
          </a>
          {NHAN_O_TICH_SAU}
        </span>
      </label>
      {loi ? <p className="text-xs text-red-600">{loi}</p> : null}
    </div>
  );
});
