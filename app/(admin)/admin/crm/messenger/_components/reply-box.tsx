"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { replyAction } from "../actions";

const QUICK_REPLIES = [
  "Dạ anh/chị cho em xin SĐT để tư vấn lộ trình phù hợp cho bé ạ.",
  "Dạ Sata Robo có lớp thử miễn phí, anh/chị cho bé qua trải nghiệm nhé.",
];

/**
 * S-2b (27/08/2026) — Ô trả lời nay GỬI THẬT ra Meta Send API.
 *
 * Luật của ô này: **chỉ nói "Đã gửi" khi server xác nhận `daGuiThat`.** Bản trước suy
 * "đã gửi" từ `res.ok` và bắn `toast.success("Đã gửi")` cho một hành động chỉ ghi DB —
 * khách không nhận gì, người trực tin là xong việc. Ba nhánh, ba loại toast khác nhau.
 *
 * `moPhong` do server tính (thiếu khoá Meta hoặc công tắc `messenger.sendLive` tắt) và
 * hiện NGAY trên ô nhập, để người dùng biết trước khi gõ chứ không phải bấm mới biết.
 */
export function ReplyBox({
  conversationId,
  moPhong,
}: {
  conversationId: string;
  moPhong: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();

  function send(value: string) {
    start(async () => {
      const res = await replyAction(conversationId, value);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setText("");
      router.refresh();
      if (res.daGuiThat) toast.success("Đã gửi tới khách");
      // Mô phỏng: KHÔNG dùng toast.success. Tin nằm trong sổ nhưng khách không nhận —
      // báo xanh ở đây là quay lại đúng lỗi vừa vá.
      else toast.warning(res.canhBao);
    });
  }

  return (
    <div className="space-y-2">
      {moPhong ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-state-warning bg-state-warning-soft p-3 text-sm text-state-warning-ink"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            <span className="font-semibold">Đang ở chế độ mô phỏng.</span> Tin gửi từ đây được
            lưu vào hệ thống nhưng <span className="font-semibold">KHÔNG tới khách</span>. Cần
            điền khoá Meta và bật “Gửi tin Messenger THẬT” ở Cấu hình vận hành.
          </p>
        </div>
      ) : null}
      <div className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Nhập trả lời..."
          onKeyDown={(e) => e.key === "Enter" && text.trim() && send(text)}
        />
        <Button onClick={() => send(text)} disabled={pending || !text.trim()}>
          {moPhong ? "Gửi (mô phỏng)" : "Gửi"}
        </Button>
      </div>
      <div className="flex flex-wrap gap-1">
        {QUICK_REPLIES.map((q) => (
          <button
            key={q}
            type="button"
            disabled={pending}
            onClick={() => send(q)}
            className="rounded border px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted"
          >
            {q.slice(0, 28)}…
          </button>
        ))}
      </div>
    </div>
  );
}
