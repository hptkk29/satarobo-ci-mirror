"use client";

import { useId, useRef } from "react";
import { CAU_LY_DO_KHONG_HOP_LE, docSo } from "@/lib/elearning/cham-so";
import { cn } from "@/lib/utils";

/**
 * Ô NHẬP SỐ của câu NUMERIC (`NvQ-nhapso.html`): ô số lớn căn phải, đơn vị cạnh ô, bàn phím 3×4 (`1`–`9`, `,`, `0`, `⌫`).
 * Gõ bằng bàn phím thường cũng được. Chuỗi người học gõ được GIỮ NGUYÊN (không tự đổi `.` thành `,`) — máy chủ đọc bằng `docSo`, cùng một luật với lỗi báo ở đây.
 *
 * Lưu: `onChot` được gọi khi tiêu điểm RỜI KHỎI cả khối (ô + bàn phím), không theo từng phím — mỗi lần lưu là một lượt gọi server.
 * Lỗi định dạng hiện NGAY dưới ô (`role="alert"`) nhưng KHÔNG chặn lưu chuỗi dở: người đang gõ "12," chưa phải lỗi nghiêm trọng; nộp bài thì máy chủ chấm câu không đọc được là SAI.
 */
export function OSo({
  giaTri,
  donVi,
  nhan,
  onDoi,
  onChot,
}: {
  giaTri: string;
  donVi?: string | null;
  /** Nhãn đọc cho trình đọc màn hình ("Trả lời câu 9"). */
  nhan: string;
  onDoi: (v: string) => void;
  /** Tiêu điểm rời khối: lưu giá trị hiện tại. */
  onChot: (v: string) => void;
}) {
  const idLoi = useId();
  const khoi = useRef<HTMLDivElement>(null);
  const kiem = giaTri.trim() === "" ? null : docSo(giaTri);
  const loi = kiem && !kiem.ok ? CAU_LY_DO_KHONG_HOP_LE[kiem.lyDo] : null;

  const them = (k: string) => onDoi(`${giaTri}${k}`);
  const xoa = () => onDoi(giaTri.slice(0, -1));

  const PHIM = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "⌫"] as const;

  return (
    <div
      ref={khoi}
      className="mt-3 space-y-3"
      onBlur={(e) => {
        // Chỉ chốt khi tiêu điểm đi ra NGOÀI khối (không phải từ ô sang phím).
        if (!khoi.current?.contains(e.relatedTarget as Node | null)) onChot(giaTri);
      }}
    >
      <div className="flex items-center gap-2.5">
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={giaTri}
          onChange={(e) => onDoi(e.target.value)}
          aria-label={nhan}
          aria-invalid={loi ? true : undefined}
          aria-describedby={loi ? idLoi : undefined}
          className={cn(
            "h-[60px] min-w-0 flex-1 rounded-md border-b-2 bg-primary-soft px-3 text-right text-[28px] tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
            loi ? "border-state-danger" : "border-[var(--el-fill)]",
          )}
        />
        {donVi ? <span className="text-xl font-semibold text-foreground">{donVi}</span> : null}
      </div>
      {loi ? (
        <p id={idLoi} role="alert" className="text-xs font-medium text-state-danger-ink">
          {loi}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Nhập số. Dùng dấu , hoặc . làm dấu thập phân; không dùng dấu ngăn hàng nghìn.</p>
      )}
      <div role="group" aria-label="Bàn phím số" className="grid max-w-[420px] grid-cols-3 gap-2">
        {PHIM.map((k) => (
          <button
            key={k}
            type="button"
            aria-label={k === "⌫" ? "Xoá ký tự cuối" : k === "," ? "Dấu phẩy thập phân" : k}
            onClick={() => (k === "⌫" ? xoa() : them(k))}
            className="inline-flex h-[52px] items-center justify-center rounded-lg border border-input bg-card text-xl text-foreground outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}
