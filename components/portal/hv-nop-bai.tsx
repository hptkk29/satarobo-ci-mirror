"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AttachmentUpload, type UploadedFile } from "@/components/assignments/attachment-upload";
import { submitAssignment } from "@/app/(portal)/portal/bai-tap/actions";
import { NUT_CAM, NUT_TAT } from "@/components/portal/hv-ui";

// Ô "Bài làm của em" — nộp bài tập bằng CHÍNH hành động nộp bài đang chạy (cùng cổng hạn nộp, cùng luật chấm trễ). Chỉ khác giao diện.
export function HvNopBai({
  assignmentId,
  allowText,
  allowFile,
  initialText,
  initialFiles,
  daCham,
  xung,
}: {
  assignmentId: string;
  allowText: boolean;
  allowFile: boolean;
  initialText: string | null;
  initialFiles: UploadedFile[];
  daCham: boolean;
  xung: string;
}) {
  const router = useRouter();
  const [chu, setChu] = useState(initialText ?? "");
  const [tep, setTep] = useState<UploadedFile[]>(initialFiles);
  const [dang, bat] = useTransition();
  const [xong, setXong] = useState<"ok" | "tre" | null>(null);

  if (daCham) {
    return <p className="m-0 rounded-xl bg-[var(--sr-success-bg)] p-3.5 text-sm text-[var(--sr-success)]">Bài đã được chấm — em không nộp lại được nữa.</p>;
  }

  const coGi = chu.trim().length > 0 || tep.length > 0;
  const nop = () => {
    if (!coGi) {
      toast.error(allowText && !allowFile ? "Em viết bài làm rồi bấm Nộp nhé." : "Em thêm ít nhất một ảnh, video hoặc tệp nhé.");
      return;
    }
    bat(async () => {
      const r = await submitAssignment({
        assignmentId,
        textAnswer: allowText ? chu : null,
        files: tep.map((f) => ({ fileUrl: f.url, fileName: f.name, fileSize: f.size || null, mimeType: f.mime || null })),
      });
      if (r.ok) {
        setXong(r.status === "LATE" ? "tre" : "ok");
        router.refresh();
      } else toast.error(r.error ?? "Nộp bài chưa được. Em thử lại nhé.");
    });
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-[15px] font-bold">Bài làm của em</div>
      {xong && (
        <p className="m-0 rounded-xl bg-[var(--sr-success-bg)] p-3.5 text-sm font-semibold text-[var(--sr-success)]">
          {xong === "tre" ? "Đã nộp (trễ hạn)." : "Nộp bài rồi!"} {xung} sẽ chấm. Có điểm là em thấy ở mục “Đã nộp” và trong Tin mới. Em có thể sửa và nộp lại trước khi được chấm.
        </p>
      )}
      {allowFile && (
        <div className="rounded-2xl border-2 border-dashed border-[var(--sr-dash)] bg-card p-3">
          <AttachmentUpload value={tep} onChange={setTep} endpoint="/api/portal/upload-url" maxFiles={5} disabled={dang} label="Chụp ảnh, quay video hoặc chọn tệp" />
        </div>
      )}
      {allowText && (
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          {allowFile ? `Em muốn nói gì với ${xung}? (không bắt buộc)` : "Bài làm của em"}
          <textarea
            value={chu}
            onChange={(e) => setChu(e.target.value)}
            rows={4}
            placeholder="Ví dụ: Em đổi bánh răng to sang bên trái để robot chạy chậm lại."
            className="box-border w-full resize-y rounded-xl border border-border bg-card p-3 text-sm font-normal leading-[21px] text-foreground"
          />
        </label>
      )}
      <button type="button" onClick={nop} disabled={dang} aria-disabled={!coGi} className={cn(coGi ? NUT_CAM : NUT_TAT, "h-12 self-start text-[15px]")}>
        {dang ? "Đang nộp…" : coGi ? (xong ? "Nộp lại" : "Nộp bài") : "Thêm ảnh, video hoặc tệp để nộp"}
      </button>
    </div>
  );
}
