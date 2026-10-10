"use client";

// components/admin/nguon-hoa-hong/phan-tram-input.tsx — `PercentageInput` (06 §5.2, §7): gõ PHẦN TRĂM, lưu TỈ LỆ.
//
// Người dùng gõ "3" = 3%. Dưới ô luôn in lại con số SẼ ĐƯỢC LƯU ("= 0,03 trên mỗi đồng thực thu") — chính dòng này là thứ
// bắt lỗi ×100: nếu ai đó nối nhầm ô này với một cột lưu số nguyên, dòng in lại sẽ lệch ngay trước mắt người gõ. Phép đổi nằm ở
// `lib/hoa-hong/phan-tram.ts` (có ca `[NHH-FE-05*]`); component CHỈ vẽ và không tự tính gì.
//
// Giá trị là CHỮ NGƯỜI DÙNG GÕ (`value: string`), không phải số: ép sang số mỗi lần gõ sẽ nuốt "3," đang gõ dở và biến "03" thành 3.
// `inputMode="decimal"` để bàn phím số hiện trên điện thoại/tablet; dấu phẩy và dấu chấm đều nhận.
import { useId } from "react";

import { docPhanTram, loiGiaiThichTiLe } from "@/lib/hoa-hong/phan-tram";
import { cn } from "@/lib/utils";

import { O_NHAP } from "./classes";

export function PercentageInput({
  value,
  onChange,
  error,
  disabled,
  ariaLabel,
  truong,
  className,
}: {
  value: string;
  onChange: (raw: string) => void;
  /** Lỗi từ NGOÀI (server, hoặc luật của bước). Lỗi đọc-không-ra của chính ô này luôn được tự suy ra. */
  error?: string | null;
  disabled?: boolean;
  /** Bắt buộc: ô nằm trong bảng vai × loại, không có nhãn thấy được ⇒ cần tên cho trình đọc màn hình. */
  ariaLabel: string;
  /** Khoá trường để cuộn/focus tới (`data-truong`). */
  truong?: string;
  className?: string;
}) {
  const id = useId();
  const kq = docPhanTram(value);
  const loiRieng = kq.kieu === "loi" ? kq.loi : null;
  const loi = error ?? loiRieng;
  const echo = kq.kieu === "ok" ? loiGiaiThichTiLe(kq.tiLe) : null;
  const mo = `${id}-mo-ta`;
  return (
    <div className={cn("min-w-0", className)}>
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-invalid={loi ? true : undefined}
          aria-describedby={loi || echo ? mo : undefined}
          data-truong={truong}
          onChange={(e) => onChange(e.target.value)}
          className={cn(O_NHAP, "pr-8 text-right tabular-nums")}
        />
        {/* Hậu tố cố định: không phải ký tự trong ô, nên người gõ không phải xoá "%" cũ. */}
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
          %
        </span>
      </div>
      {/* Lỗi là phần tử RIÊNG có role=alert (đọc ra khi nó xuất hiện); dòng in lại tỉ lệ thì im lặng. Cùng id nên aria-describedby không đổi. */}
      {loi ? (
        <p id={mo} role="alert" className="mt-1 min-h-[1rem] text-xs text-state-danger-ink">
          {loi}
        </p>
      ) : (
        <p id={mo} className="mt-1 min-h-[1rem] text-xs text-muted-foreground">
          {echo}
        </p>
      )}
    </div>
  );
}
