"use client";

// Cụm "Mã QR in ra" của một điểm chấm công: xem trước, in, và thu hồi.
//
// Vì sao cần: từ 07/09 mã QR là mã TĨNH dán ở quầy. Không có chỗ nào IN được thì "in ra đặt tại
// trung tâm" phải gõ tay URL API; không có chỗ nào THU HỒI thì mất tờ giấy là phải chạy SQL trên
// prod — mà prod chỉ chạm được qua workflow GitHub. Tức lớp bảo vệ duy nhất còn lại của mã tĩnh
// (thu hồi được) trên thực tế là không dùng được.
//
// In bằng cửa sổ riêng chứ không `window.print()` cả trang: trang admin có sidebar, thanh tìm
// kiếm, tab — in ra là ba tờ giấy trong đó mã QR bé bằng con tem.
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { KeyRound, Printer } from "lucide-react";
import { BTN_DANGER, BTN_OUTLINE, FIELD } from "@/components/admin/cham-cong/classes";
import { cn } from "@/lib/utils";
import { revokeQrKeyAction } from "../_actions";

export function QrIn({
  workLocationId,
  centerId,
  tenDiem,
  maCoSo,
  qrKeyVersion,
  coToaDo,
  canConfig,
}: {
  workLocationId: string;
  centerId: string;
  tenDiem: string;
  maCoSo: string;
  qrKeyVersion: number;
  /** Chưa khai toạ độ ⇒ mã in ra chưa có lớp chặn nào; nói thẳng trước khi người ta đi dán. */
  coToaDo: boolean;
  canConfig: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [moThuHoi, setMoThuHoi] = useState(false);
  const [lyDo, setLyDo] = useState("");

  const inMa = () => {
    start(async () => {
      const res = await fetch(
        `/api/admin/cham-cong/qr-token?centerId=${encodeURIComponent(centerId)}&workLocationId=${encodeURIComponent(workLocationId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(body?.error ?? "Không lấy được mã QR. Thử lại sau.");
        return;
      }
      const data = (await res.json()) as { qrDataUrl?: string; qrKeyVersion?: number };
      if (!data.qrDataUrl) {
        toast.error("Máy chủ không trả về ảnh mã QR.");
        return;
      }
      const w = window.open("", "_blank", "width=800,height=1000");
      if (!w) {
        toast.error("Trình duyệt chặn cửa sổ in. Cho phép cửa sổ bật lên rồi thử lại.");
        return;
      }
      // Tờ A5 dọc: mã to hết cỡ, dưới là tên điểm và đời khoá để người dán biết tờ nào là tờ nào.
      w.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>QR chấm công — ${esc(tenDiem)}</title>
<style>
  @page { size: A5 portrait; margin: 12mm; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; text-align: center; margin: 0; }
  h1 { font-size: 20pt; margin: 0 0 4mm; }
  .ma { font-size: 12pt; color: #444; margin: 0 0 6mm; }
  img { width: 118mm; height: 118mm; display: block; margin: 0 auto; }
  .huong-dan { font-size: 12pt; margin-top: 6mm; line-height: 1.5; }
  .chan { font-size: 9pt; color: #666; margin-top: 8mm; }
</style></head><body>
  <h1>Chấm công — ${esc(tenDiem)}</h1>
  <p class="ma">${esc(maCoSo)}</p>
  <img src="${data.qrDataUrl}" alt="Mã QR chấm công">
  <p class="huong-dan">Mở camera điện thoại, quét mã, rồi bấm <b>Vào ca</b> hoặc <b>Ra ca</b>.<br>
  Phải đứng tại cơ sở — máy kiểm tra vị trí trước khi ghi.</p>
  <p class="chan">Đời khoá v${data.qrKeyVersion ?? qrKeyVersion} · in ${new Date().toLocaleDateString("vi-VN")}</p>
</body></html>`);
      w.document.close();
      w.focus();
      w.print();
    });
  };

  const thuHoi = () =>
    start(async () => {
      const r = await revokeQrKeyAction({ id: workLocationId, reason: lyDo });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Đã thu hồi mã cũ — in tờ mới và thay ngay tại quầy");
      setMoThuHoi(false);
      setLyDo("");
      router.refresh();
    });

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button type="button" onClick={inMa} disabled={pending} className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}>
        <Printer aria-hidden className="h-4 w-4" /> In mã QR
      </button>
      <span className="text-xs text-muted-foreground">đời khoá v{qrKeyVersion}</span>
      {!coToaDo && (
        <span className="text-xs text-state-warning-ink">
          Chưa khai toạ độ — mã in ra chưa chặn được ai quét từ xa
        </span>
      )}

      {canConfig &&
        (moThuHoi ? (
          <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-state-danger-ink/40 bg-state-danger-soft p-2">
            <p className="w-full text-xs text-state-danger-ink">
              Thu hồi là <b>mọi tờ đã in và mọi ảnh chụp cũ chết ngay</b>. Chỉ làm khi đã sẵn sàng in
              và thay tờ mới tại quầy — nếu không, cả cơ sở không chấm công được.
            </p>
            <input
              type="text"
              value={lyDo}
              onChange={(e) => setLyDo(e.target.value)}
              placeholder="Lý do: mất tờ giấy / nhân viên nghỉ còn giữ ảnh…"
              className={cn(FIELD, "h-8 min-w-[18rem] flex-1 text-xs")}
            />
            <button
              type="button"
              onClick={thuHoi}
              disabled={pending || lyDo.trim().length < 5}
              className={cn(BTN_DANGER, "h-8 px-3 text-xs")}
            >
              Xác nhận thu hồi
            </button>
            <button
              type="button"
              onClick={() => setMoThuHoi(false)}
              disabled={pending}
              className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}
            >
              Huỷ
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setMoThuHoi(true)}
            className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}
          >
            <KeyRound aria-hidden className="h-4 w-4" /> Thu hồi mã đã in
          </button>
        ))}
    </div>
  );
}

/** Thoát HTML cho nội dung tờ in — tên điểm do người vận hành nhập. */
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}
