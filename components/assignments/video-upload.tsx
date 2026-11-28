"use client";

// Nộp VIDEO bài tập (12/11/2026): chọn/quay video → (nén phía trình duyệt khi file lớn) → presign → PUT thẳng R2 → trả UploadedFile.
// Dùng cho cổng phụ huynh + cổng học sinh. KHÔNG thêm thư viện: nén bằng `<video>` + canvas + MediaRecorder.
//
// NÉN — nói thật về giới hạn: ta KHÔNG có ffmpeg ở máy chủ (container nhỏ, test và prod chung một VPS) nên chỉ nén được phía TRÌNH DUYỆT, và
// MediaRecorder chạy theo THỜI GIAN THẬT (video 60 giây mất ~60 giây để nén). Vì vậy:
//   · chỉ nén khi tệp > 30MB; nhỏ hơn thì gửi NGUYÊN BẢN (khỏi mất chất lượng và thời gian);
//   · nén về tối đa 720p, ~2,5 Mbps — đủ để giáo viên đọc rõ mô hình/dòng code, không phải bản mờ;
//   · trình duyệt không hỗ trợ nén (không có captureStream/MediaRecorder) hoặc nén lỗi ⇒ gửi nguyên bản nếu ≤ 120MB, ngược lại báo lỗi rõ ràng;
//   · KHÔNG giới hạn thời lượng video (chủ dự án 12/11/2026: "không tối thiểu hay tối đa bao nhiêu giây"); chỉ có trần DUNG LƯỢNG tệp (120MB) vì
//     máy chủ/kho lưu trữ cần một trần. Video dài > 3 phút mà tệp còn ≤ 120MB thì BỎ QUA nén (nén chạy theo thời gian thật — 10 phút video = chờ 10 phút);
//     nhưng tệp > 120MB thì BẮT BUỘC nén dù dài bao lâu, kẻo "không giới hạn độ dài" thành giới hạn ngầm.
import { useRef, useState } from "react";
import { Film, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import type { UploadedFile } from "@/components/assignments/attachment-upload";

/** Quá ngưỡng này thì bỏ qua bước nén (MediaRecorder chạy theo thời gian thật). Không phải giới hạn độ dài video. */
const TOI_DA_GIAY_DE_NEN = 180;
const TOI_DA_BYTE = 120 * 1024 * 1024;
const NGUONG_NEN_BYTE = 30 * 1024 * 1024;
const CAO_TOI_DA = 720;
const BITRATE = 2_500_000;

/** MIME mà MediaRecorder của trình duyệt này ghi được — ưu tiên mp4 (phát được ở mọi nơi), rồi webm. Không có ⇒ null. */
function chonDinhDang(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return null;
}

function docThongSo(f: File): Promise<{ giay: number; rong: number; cao: number }> {
  return new Promise((ok, loi) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const url = URL.createObjectURL(f);
    v.onloadedmetadata = () => {
      ok({ giay: v.duration, rong: v.videoWidth, cao: v.videoHeight });
      URL.revokeObjectURL(url);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      loi(new Error("Không đọc được video này"));
    };
    v.src = url;
  });
}

/** Nén bằng cách phát video vào canvas rồi ghi lại. Chạy theo thời gian thật; `tienDo` 0–100. */
function nen(f: File, rong: number, cao: number, tienDo: (p: number) => void): Promise<File> {
  return new Promise((ok, loi) => {
    const dinhDang = chonDinhDang();
    const v = document.createElement("video");
    if (!dinhDang || typeof (v as HTMLVideoElement & { captureStream?: unknown }).captureStream !== "function") {
      return loi(new Error("KHONG_HO_TRO"));
    }
    const heSo = Math.min(1, CAO_TOI_DA / Math.max(1, cao));
    const w = Math.round((rong * heSo) / 2) * 2;
    const h = Math.round((cao * heSo) / 2) * 2;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return loi(new Error("KHONG_HO_TRO"));

    const url = URL.createObjectURL(f);
    v.src = url;
    v.muted = false;
    v.playsInline = true;
    const luong = canvas.captureStream(30);
    // Âm thanh: lấy từ chính phần tử video (nếu trình duyệt cho).
    try {
      const am = (v as HTMLVideoElement & { captureStream: () => MediaStream }).captureStream().getAudioTracks();
      for (const t of am) luong.addTrack(t);
    } catch {
      /* không có tiếng cũng không sao */
    }
    const ghi = new MediaRecorder(luong, { mimeType: dinhDang, videoBitsPerSecond: BITRATE });
    const manh: BlobPart[] = [];
    ghi.ondataavailable = (e) => e.data.size > 0 && manh.push(e.data);
    let dung = false;
    const ve = () => {
      if (dung) return;
      ctx.drawImage(v, 0, 0, w, h);
      if (v.duration > 0) tienDo(Math.min(99, Math.round((v.currentTime / v.duration) * 100)));
      requestAnimationFrame(ve);
    };
    ghi.onstop = () => {
      dung = true;
      URL.revokeObjectURL(url);
      const loai = dinhDang.split(";")[0] ?? "video/webm";
      const duoi = loai.includes("mp4") ? "mp4" : "webm";
      ok(new File(manh, `${f.name.replace(/\.[^.]+$/, "")}-nen.${duoi}`, { type: loai }));
    };
    ghi.onerror = () => loi(new Error("Nén video thất bại"));
    v.onended = () => ghi.state !== "inactive" && ghi.stop();
    v.onerror = () => {
      dung = true;
      URL.revokeObjectURL(url);
      loi(new Error("Không phát được video để nén"));
    };
    v.onplaying = () => {
      ghi.start(1000);
      requestAnimationFrame(ve);
    };
    v.play().catch(() => loi(new Error("KHONG_HO_TRO")));
  });
}

export function VideoUpload({
  value,
  onChange,
  endpoint = "/api/portal/upload-url",
  disabled = false,
}: {
  /** Chỉ các tệp VIDEO đã tải lên (component này quản lý riêng khỏi ảnh/tài liệu). */
  value: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
  endpoint?: string;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [buoc, setBuoc] = useState<"" | "doc" | "nen" | "gui">("");
  const [pt, setPt] = useState(0);

  async function guiLen(f: File): Promise<UploadedFile> {
    const sign = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "video", filename: f.name, mimeType: f.type, sizeBytes: f.size }),
    });
    if (!sign.ok) {
      const d = (await sign.json().catch(() => ({}))) as { error?: string };
      throw new Error(d.error || "Không tạo được link tải lên");
    }
    const { uploadUrl, publicUrl } = (await sign.json()) as { uploadUrl: string; publicUrl: string };
    const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": f.type }, body: f });
    if (!put.ok) throw new Error("Tải video lên thất bại — kiểm tra mạng rồi thử lại");
    return { url: publicUrl, name: f.name, size: f.size, mime: f.type };
  }

  async function chon(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (input.current) input.current.value = "";
    if (!f) return;
    if (!f.type.startsWith("video/")) return void toast.error("Chỉ nhận tệp video");
    try {
      setBuoc("doc");
      const ts = await docThongSo(f);
      let tep = f;
      if (f.size > NGUONG_NEN_BYTE && (ts.giay <= TOI_DA_GIAY_DE_NEN || f.size > TOI_DA_BYTE)) {
        setBuoc("nen");
        setPt(0);
        try {
          tep = await nen(f, ts.rong, ts.cao, setPt);
          // Nén xong mà không nhỏ hơn thì giữ bản gốc (không làm tệ thêm).
          if (tep.size >= f.size) tep = f;
        } catch (err) {
          if (!(err instanceof Error && err.message === "KHONG_HO_TRO") && f.size > TOI_DA_BYTE) throw err;
          tep = f; // không nén được ⇒ gửi nguyên bản nếu còn trong trần
        }
      }
      if (tep.size > TOI_DA_BYTE) {
        throw new Error(`Video ${Math.round(tep.size / 1024 / 1024)}MB vượt trần ${Math.round(TOI_DA_BYTE / 1024 / 1024)}MB. Hãy quay ở độ phân giải thấp hơn hoặc dùng Chrome/Safari bản mới để tự nén.`);
      }
      setBuoc("gui");
      onChange([...value, await guiLen(tep)]);
      toast.success("Đã tải video lên");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không tải được video");
    } finally {
      setBuoc("");
    }
  }

  const ban = disabled || buoc !== "";
  return (
    <div className="space-y-2">
      {value.map((f, i) => (
        <div key={`${f.url}-${i}`} className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-2 text-sm">
          <Film className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            {f.name} · {(f.size / 1024 / 1024).toFixed(1)}MB
          </span>
          {!disabled ? (
            <button type="button" onClick={() => onChange(value.filter((_, k) => k !== i))} className="shrink-0 text-neutral-400 hover:text-red-500" aria-label={`Xoá ${f.name}`}>
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      ))}
      <input ref={input} type="file" accept="video/*" capture="environment" className="sr-only" tabIndex={-1} onChange={(e) => void chon(e)} />
      <button
        type="button"
        disabled={ban}
        onClick={() => input.current?.click()}
        className="flex min-h-14 w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 p-3 text-sm font-semibold text-neutral-600 hover:border-orange-400 hover:bg-orange-50 disabled:opacity-60"
      >
        {buoc ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Film className="h-4 w-4" aria-hidden />}
        {buoc === "doc" ? "Đang kiểm tra video…" : buoc === "nen" ? `Đang nén video… ${pt}% (giữ nguyên trang này)` : buoc === "gui" ? "Đang tải video lên…" : value.length > 0 ? "Thêm video khác" : "Quay hoặc chọn video"}
      </button>
      <p className="text-xs text-neutral-500">Không giới hạn độ dài — chỉ giới hạn dung lượng tệp tối đa {Math.round(TOI_DA_BYTE / 1024 / 1024)}MB. Video lớn được nén trước khi gửi (video dài nén lâu hơn).</p>
    </div>
  );
}
