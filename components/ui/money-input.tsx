"use client";

// Ô nhập tiền dùng chung cho CẢ 4 SITE (admin, portal, teacher, public): người dùng gõ
// "10000000", ô hiển thị "10.000.000".
//
// VÌ SAO tách ô nhìn thấy và ô ẩn:
//   • Ô nhìn thấy là `type="text"` — `type="number"` KHÔNG cho hiển thị dấu chấm
//     (trình duyệt coi "10.000.000" là giá trị rỗng và trả về "").
//   • Ô ẩn `type="hidden" name={name}` giữ SỐ TRẦN "10000000". Hàng chục Server Action
//     đang đọc `formData.get("amount")` rồi `Number(...)`; nhờ ô ẩn này mà KHÔNG phải
//     sửa một dòng nào ở server.
//   ⇒ Ô nhìn thấy CỐ Ý không có `name` — nếu có, FormData sẽ nhận thêm chuỗi
//     "10.000.000" và `Number(...)` phía server ra NaN.

import * as React from "react";

import { formatVndInput, parseVndInput } from "@/lib/format/money";
import { cn } from "@/lib/utils";

/** Chặn ngay lúc gõ, để `parseVndInput` (trả null khi vượt ngưỡng an toàn) không bao
 *  giờ làm ô đang gõ dở bị xoá trắng. */
const MAX_DIGITS = 15;

type NativeInputProps = Omit<
  React.ComponentProps<"input">,
  | "name"
  | "type"
  | "value"
  | "defaultValue"
  | "onChange"
  | "onKeyDown"
  | "min"
  | "max"
>;

export type MoneyInputProps = NativeInputProps & {
  /** Tên field gửi lên server — gắn vào ô ẨN, giá trị là số trần ("10000000"). */
  name: string;
  /** Chế độ uncontrolled. */
  defaultValue?: number | string | null;
  /** Chế độ controlled — truyền kèm `onValueChange`. */
  value?: number | string | null;
  /** Gọi mỗi lần giá trị đổi; `null` = ô đang trống. */
  onValueChange?: (value: number | null) => void;
  min?: number;
  max?: number;
  allowNegative?: boolean;
  /** Hậu tố mờ bên phải; truyền `null` để bỏ. */
  suffix?: React.ReactNode;
};

function countDigits(text: string, until: number): number {
  let n = 0;
  for (let i = 0; i < until && i < text.length; i += 1) {
    if (text[i] >= "0" && text[i] <= "9") n += 1;
  }
  return n;
}

/**
 * Vị trí caret sau `count` chữ số trong chuỗi ĐÃ format.
 * Đếm CHỮ SỐ chứ không đếm ký tự: format lại làm số dấu chấm thay đổi, bám theo ký tự
 * thì sửa giữa chuỗi sẽ bị nhảy con trỏ về cuối — lỗi kinh điển của kiểu ô này.
 */
function caretAfterDigits(formatted: string, count: number): number {
  // count = 0 mà có dấu trừ thì đứng SAU dấu trừ, để gõ tiếp ra số chứ không phải
  // chèn số vào trước dấu.
  if (count <= 0) return formatted.startsWith("-") ? 1 : 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i += 1) {
    if (formatted[i] >= "0" && formatted[i] <= "9") {
      seen += 1;
      if (seen === count) return i + 1;
    }
  }
  return formatted.length;
}

/**
 * Chuỗi thô (vừa gõ / vừa dán) → chuỗi hiển thị + số.
 *
 * DẤU TRỪ LUÔN ĐƯỢC GIỮ, kể cả ở ô KHÔNG cho số âm.
 *
 * VÌ SAO. Trước đây `allowNegative=false` bóc luôn dấu trừ ngay tại đây, nên ô đang
 * hiển thị "-5.000.000" (giá trị âm nạp sẵn từ cha) chỉ cần gõ một phím là thành
 * "5.000.000" và bắn `onValueChange(5000000)` — khoản âm 5 triệu lặng lẽ đổi dấu
 * thành dương, không một bong bóng lỗi nào. Đổi dấu số tiền mà người dùng không biết
 * là loại lỗi không thể phát hiện bằng mắt khi rà sổ.
 *
 * ⇒ Ở đây chỉ CHUYỂN ĐÚNG thứ người dùng gõ. Việc TỪ CHỐI số âm dời xuống tầng
 * validity (`setCustomValidity` bên dưới): người dùng vẫn thấy dấu trừ mình vừa gõ/dán
 * VÀ thấy lời báo lỗi, submit bị chặn — thà không lưu được còn hơn lưu sai dấu.
 */
function normalizeMoneyText(
  input: string,
  allowNegative: boolean,
): { text: string; num: number | null } {
  const negative = /^\s*-/.test(input);
  const digits = input.replace(/\D/g, "").slice(0, MAX_DIGITS);
  // Dấu trừ đứng MỘT MÌNH (chưa có chữ số nào) thì chỉ giữ ở ô cho phép số âm — không
  // giữ thì người dùng không tài nào gõ được số âm (gõ "-" là biến mất ngay). Ô không
  // cho số âm thì gõ mỗi "-" coi như chưa gõ gì: chưa có số nên chưa có gì để lật dấu.
  if (digits === "") return { text: negative && allowNegative ? "-" : "", num: null };
  const magnitude = Number(digits);
  const num = negative && magnitude !== 0 ? -magnitude : magnitude;
  return { text: formatVndInput(num), num };
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  return parseVndInput(value, { allowNegative: true });
}

export function MoneyInput({
  name,
  defaultValue,
  value,
  onValueChange,
  min,
  max,
  allowNegative = false,
  suffix = "đ",
  className,
  id,
  required,
  disabled,
  readOnly,
  placeholder,
  ...rest
}: MoneyInputProps) {
  const isControlled = value !== undefined;
  const inputRef = React.useRef<HTMLInputElement>(null);
  const caretRef = React.useRef<number | null>(null);

  const [text, setText] = React.useState(() =>
    formatVndInput(toNumber(isControlled ? value : defaultValue)),
  );

  // Đồng bộ khi controlled: nếu cha từ chối/nắn giá trị vừa gõ thì ô phải bật lại theo
  // cha. So bằng SỐ (không so chuỗi) để "" và "-" — đều parse ra null — không tạo vòng
  // set-state vô tận.
  // Luôn `allowNegative: true` ở đây: `text` là chuỗi do chính component sinh ra, nên
  // dấu trừ chỉ có mặt khi prop `allowNegative` đã cho phép.
  const num = parseVndInput(text, { allowNegative: true });
  if (isControlled && num !== toNumber(value)) {
    setText(formatVndInput(toNumber(value)));
  }

  // Đặt lại caret SAU khi React vẽ xong chuỗi mới; không có dep array vì chỉ chạy thật
  // khi handler vừa xin một vị trí.
  React.useLayoutEffect(() => {
    const el = inputRef.current;
    const pos = caretRef.current;
    if (el && pos !== null) {
      caretRef.current = null;
      el.setSelectionRange(pos, pos);
    }
  });

  // min/max/required: đặt lên ô ẨN là VÔ TÁC DỤNG (trình duyệt bỏ qua validation của
  // input hidden). Nên:
  //   • `required` đặt thẳng lên ô nhìn thấy → dùng luôn bong bóng lỗi + auto-focus của
  //     trình duyệt, không phải chế lại.
  //   • `min`/`max` thì trình duyệt bỏ qua trên `type="text"`, nên tự kiểm bằng
  //     `setCustomValidity` — vẫn chặn được submit và vẫn hiện bong bóng ngay tại ô.
  //   • Số âm ở ô không cho phép: kiểm ngay tại đây thay vì lặng lẽ bỏ dấu trừ (xem
  //     ghi chú của `normalizeMoneyText`). Bắt cả giá trị âm do CHA nạp sẵn — trước
  //     đây ô vẫn vẽ ra "-5.000.000" rồi im lặng đổi dấu ở phím gõ đầu tiên.
  React.useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    let message = "";
    if (text !== "" && num === null) {
      message = "Số tiền không hợp lệ";
    } else if (num !== null) {
      if (!allowNegative && num < 0) {
        message = "Ô này không nhận số âm";
      } else if (typeof min === "number" && num < min) {
        message = `Số tiền tối thiểu là ${formatVndInput(min)} đ`;
      } else if (typeof max === "number" && num > max) {
        message = `Số tiền tối đa là ${formatVndInput(max)} đ`;
      }
    }
    el.setCustomValidity(message);
  }, [text, num, min, max, allowNegative]);

  const commitFromRaw = (rawText: string, caretInRaw: number) => {
    const digitsBefore = countDigits(rawText, caretInRaw);
    const next = normalizeMoneyText(rawText, allowNegative);
    caretRef.current = caretAfterDigits(next.text, digitsBefore);
    setText(next.text);
    onValueChange?.(next.num);
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const el = event.currentTarget;
    // Dán "1.500.000 đ" cũng đi qua đây: normalize bóc hết ký tự thừa nên không cần
    // handler onPaste riêng.
    commitFromRaw(el.value, el.selectionStart ?? el.value.length);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const el = event.currentTarget;
    if (el.readOnly || el.disabled) return;
    const start = el.selectionStart;
    if (start === null || start !== el.selectionEnd) return;

    if (event.key === "Backspace" && start > 0 && el.value[start - 1] === ".") {
      // Để trình duyệt xoá dấu chấm thì format lại sẽ chèn nó về đúng chỗ cũ ⇒ người
      // dùng thấy "bấm Backspace mà không mất gì". Xoá thẳng CHỮ SỐ trước dấu chấm.
      event.preventDefault();
      commitFromRaw(el.value.slice(0, start - 2) + el.value.slice(start - 1), start - 2);
    } else if (event.key === "Delete" && el.value[start] === ".") {
      // Đối xứng cho phím Delete: xoá chữ số đứng NGAY SAU dấu chấm.
      event.preventDefault();
      commitFromRaw(el.value.slice(0, start) + el.value.slice(start + 2), start);
    }
  };

  return (
    <div className="relative">
      <input
        {...rest}
        ref={inputRef}
        id={id}
        // KHÔNG có `name` — xem ghi chú đầu file.
        type="text"
        inputMode={allowNegative ? "text" : "numeric"}
        autoComplete="off"
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        placeholder={placeholder}
        className={cn(
          "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20",
          // tabular-nums: chữ số cùng bề rộng nên chuỗi không "giật" khi thêm dấu chấm.
          "tabular-nums",
          "disabled:cursor-not-allowed disabled:opacity-60",
          suffix ? "pr-8" : undefined,
          className,
        )}
      />
      {suffix ? (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
          {suffix}
        </span>
      ) : null}
      {/* `disabled` phải soi gương sang ô ẩn: theo chuẩn HTML, field disabled KHÔNG được
          gửi lên — không mirror thì ô khoá vẫn âm thầm submit giá trị. */}
      <input type="hidden" name={name} value={num === null ? "" : String(num)} disabled={disabled} />
    </div>
  );
}
