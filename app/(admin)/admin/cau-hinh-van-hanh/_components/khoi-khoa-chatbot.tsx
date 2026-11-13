"use client";

// Khối "API key Anthropic" ở tab Chatbot website: trạng thái key (4 ký tự cuối), ô dán key mới, nút gỡ,
// và HƯỚNG DẪN LẤY KEY (chủ dự án: "tôi cần hướng dẫn lấy key"). Key không bao giờ quay lại trình duyệt.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TrangThaiKhoa } from "@/lib/chatbot/khoa-api";
import { luuKhoaChatbotAction, xoaKhoaChatbotAction } from "../_actions-chatbot";

const fmt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
};

export function KhoiKhoaChatbot({ trangThai, suaDuoc }: { trangThai: TrangThaiKhoa; suaDuoc: boolean }) {
  const [khoa, setKhoa] = useState("");
  const [xacNhanGo, setXacNhanGo] = useState(false);
  const [dangLam, batDau] = useTransition();

  const luu = () =>
    batDau(async () => {
      const kq = await luuKhoaChatbotAction({ khoa });
      if (kq.ok) {
        setKhoa("");
        toast.success("Đã lưu API key");
      } else toast.error(kq.loi);
    });
  const go = () =>
    batDau(async () => {
      const kq = await xoaKhoaChatbotAction();
      setXacNhanGo(false);
      if (kq.ok) toast.success("Đã gỡ API key — chatbot tạm tắt");
      else toast.error(kq.loi);
    });

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold">API key Anthropic (Claude)</h3>
        {trangThai.coKhoa ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Đang dùng key <span className="font-mono">sk-ant-…{trangThai.duoi}</span>
            {trangThai.capNhatLuc && <> · cập nhật {fmt(trangThai.capNhatLuc)}</>}
            {trangThai.capNhatBoi && <> bởi {trangThai.capNhatBoi}</>}
          </p>
        ) : (
          <p className="mt-1 text-sm text-state-warning-ink">Chưa có key — chatbot chưa chạy được, nhân vật trên website vẫn mở Zalo.</p>
        )}
      </div>

      {!trangThai.luuDuoc && (
        <p className="rounded-md border border-state-warning-soft bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink">
          {trangThai.lyDoKhongLuuDuoc} Báo bên kỹ thuật đặt khoá này trên máy chủ (một lần duy nhất).
        </p>
      )}

      {suaDuoc ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="password"
            autoComplete="off"
            placeholder={trangThai.coKhoa ? "Dán key mới để thay" : "sk-ant-…"}
            value={khoa}
            onChange={(e) => setKhoa(e.target.value)}
            disabled={dangLam || !trangThai.luuDuoc}
            aria-label="API key Anthropic"
          />
          <Button onClick={luu} disabled={dangLam || !khoa.trim() || !trangThai.luuDuoc}>
            Lưu key
          </Button>
          {trangThai.coKhoa &&
            (xacNhanGo ? (
              <Button variant="destructive" onClick={go} disabled={dangLam}>
                Bấm lần nữa để gỡ
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setXacNhanGo(true)} disabled={dangLam}>
                Gỡ key
              </Button>
            ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Chỉ quản trị cấp cao nhất được khai hoặc gỡ key.</p>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer font-medium">Hướng dẫn lấy API key</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>
            Vào <span className="font-mono">console.anthropic.com</span>, đăng nhập (hoặc tạo tài khoản) bằng email công ty.
          </li>
          <li>
            Mục <b>Billing</b>: nạp tiền trả trước (vài USD là đủ chạy thử; chatbot dùng model Claude Haiku 5.5, mỗi
            cuộc hỏi đáp ngắn tốn khoảng vài chục đồng). Nên đặt <b>giới hạn chi tiêu hằng tháng</b> ở mục Limits.
          </li>
          <li>
            Mục <b>API keys</b> → <b>Create Key</b>, đặt tên dễ nhận (vd &quot;website-chatbot&quot;) → bấm sao chép key
            (bắt đầu bằng <span className="font-mono">sk-ant-</span>). Key chỉ hiện MỘT lần.
          </li>
          <li>Dán vào ô ở trên rồi bấm <b>Lưu key</b>. Sau đó bật &quot;Bật chatbot trên website&quot; ở bên dưới.</li>
          <li>
            Không gửi key qua chat/Zalo/email. Lỡ lộ key: vào console.anthropic.com tắt key đó, tạo key mới và dán lại ở
            đây.
          </li>
        </ol>
      </details>
    </div>
  );
}
