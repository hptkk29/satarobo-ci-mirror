"use client";

import { useRef, useState } from "react";
import { FileText, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { TRAN_CO_TEP_BAO_LUU } from "@/lib/bao-luu/tep";

// Chọn một tệp → xin URL ký (kho RIÊNG) → PUT thẳng lên R2 → giữ `key` do SERVER sinh. Trình duyệt không bao giờ tự đặt
// khoá và không có URL công khai; khoá chỉ có nghĩa khi server action nhận lại và kiểm hình dạng + HEAD tệp (Phiên 2).

export type TepDaTai = { key: string; ten: string };

export function TaiTepBaoLuu({
  nhan,
  giaTri,
  onChange,
  batBuoc = false,
  hoTro,
}: {
  nhan: string;
  giaTri: TepDaTai | null;
  onChange: (t: TepDaTai | null) => void;
  batBuoc?: boolean;
  hoTro?: string;
}) {
  const o = useRef<HTMLInputElement>(null);
  const [dang, setDang] = useState(false);

  async function chon(f: File | undefined) {
    if (!f) return;
    if (f.size > TRAN_CO_TEP_BAO_LUU) {
      toast.error(`Tệp quá lớn (tối đa ${Math.round(TRAN_CO_TEP_BAO_LUU / 1024 / 1024)}MB). Hãy nén ảnh rồi chọn lại.`);
      return;
    }
    setDang(true);
    try {
      const r = await fetch("/api/admin/bao-luu/tep/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: f.name, mimeType: f.type, sizeBytes: f.size }),
      });
      const j = (await r.json()) as { uploadUrl?: string; key?: string; contentType?: string; error?: string };
      if (!r.ok || !j.uploadUrl || !j.key) {
        toast.error(j.error ?? "Không xin được chỗ tải tệp");
        return;
      }
      const put = await fetch(j.uploadUrl, { method: "PUT", headers: { "Content-Type": j.contentType ?? f.type }, body: f });
      if (!put.ok) {
        toast.error("Tải tệp lên kho thất bại — thử lại");
        return;
      }
      onChange({ key: j.key, ten: f.name });
    } catch {
      toast.error("Mất kết nối khi tải tệp — thử lại");
    } finally {
      setDang(false);
      if (o.current) o.current.value = "";
    }
  }

  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">
        {nhan}
        {batBuoc && <span className="text-destructive"> *</span>}
      </p>
      {giaTri ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{giaTri.ten}</span>
          <button type="button" onClick={() => onChange(null)} aria-label={`Bỏ tệp ${giaTri.ten}`} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => o.current?.click()}
          disabled={dang}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-dashed border-border px-4 text-sm text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
        >
          {dang && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {dang ? "Đang tải lên…" : "Chọn tệp (PDF, JPG, PNG, WEBP)"}
        </button>
      )}
      <input ref={o} type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => void chon(e.target.files?.[0])} />
      {hoTro && <p className="text-xs text-muted-foreground">{hoTro}</p>}
    </div>
  );
}
