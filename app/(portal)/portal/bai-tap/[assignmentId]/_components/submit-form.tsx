"use client";

// BGĐ 31/07 — nộp bài NHIỀU file+ảnh (trước: 1 file). Upload qua widget dùng chung
// (presign /api/portal/upload-url → PUT R2). 2-phase: server vẫn ghi cột đơn = file đầu.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AttachmentUpload,
  type UploadedFile,
} from "@/components/assignments/attachment-upload";
import { VideoUpload } from "@/components/assignments/video-upload";
import { CauHoiLamBai, coNoiDungDapAn, dapAnDeGui, type DapAnTheoCau } from "@/components/assignments/lam-bai-cau-hoi";
import type { CauHoiHocVien, DapAn } from "@/lib/assignments/lam-bai";
import { submitAssignment } from "../../actions";

const laVideo = (f: UploadedFile) => f.mime.startsWith("video/");

export function SubmitForm({
  assignmentId,
  allowText,
  allowFile,
  yeuCauVideo,
  cauHoi,
  initialAnswers,
  initialText,
  initialFiles,
  graded,
}: {
  assignmentId: string;
  allowText: boolean;
  allowFile: boolean;
  /** Bài yêu cầu nộp video — BẮT BUỘC khai (luật 11): quên truyền = ô nộp video biến mất im lặng. */
  yeuCauVideo: boolean;
  /** TẤT CẢ câu hỏi của bài (đã bỏ đáp án đúng). BẮT BUỘC khai (luật 11): quên truyền = bài nhiều câu chỉ còn ô văn bản, câm lặng. */
  cauHoi: CauHoiHocVien[];
  /** Câu trả lời đã nộp trước đó (nộp lại / xem lại). */
  initialAnswers: { questionId: string; dapAn: DapAn; dung: boolean | null }[];
  initialText: string | null;
  initialFiles: UploadedFile[];
  graded: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState(initialText ?? "");
  const [files, setFiles] = useState<UploadedFile[]>(initialFiles);
  const [dapAn, setDapAn] = useState<DapAnTheoCau>(() => Object.fromEntries(initialAnswers.map((a) => [a.questionId, a.dapAn])));
  const coCauVideo = cauHoi.some((q) => q.type === "video");
  const yeuVideo = yeuCauVideo || coCauVideo;
  const khongPhaiVideo = cauHoi.filter((q) => q.type !== "video");
  const daLam = khongPhaiVideo.filter((q) => coNoiDungDapAn(dapAn[q.id])).length;
  // Bài có câu hỏi: ô văn bản chỉ là ghi chú thêm — câu trả lời nằm trong từng câu.
  const coCauHoi = cauHoi.length > 0;
  const [pending, startTransition] = useTransition();

  function submit() {
    if (coCauHoi && daLam === 0 && !text.trim() && files.length === 0) {
      toast.error("Hãy trả lời ít nhất một câu hỏi");
      return;
    }
    if (!coCauHoi && allowText && !text.trim() && files.length === 0) {
      toast.error("Nhập nội dung hoặc đính kèm file");
      return;
    }
    if (!coCauHoi && !allowText && files.length === 0) {
      toast.error("Vui lòng đính kèm file bài làm");
      return;
    }
    if (yeuVideo && !files.some((f) => f.mime.startsWith("video/"))) {
      toast.error("Bài này yêu cầu nộp video — hãy thêm một video");
      return;
    }
    startTransition(async () => {
      const res = await submitAssignment({
        assignmentId,
        textAnswer: allowText ? text : null,
        answers: dapAnDeGui(dapAn),
        files: files.map((f) => ({
          fileUrl: f.url,
          fileName: f.name,
          fileSize: f.size || null,
          mimeType: f.mime || null,
        })),
      });
      if (res.ok) {
        toast.success(
          res.status === "LATE" ? "Đã nộp (trễ hạn)" : "Đã nộp bài",
        );
        router.refresh();
      } else {
        toast.error(res.error ?? "Nộp bài thất bại");
      }
    });
  }

  if (graded) {
    return (
      <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
        Bài đã được chấm — không thể nộp lại.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {coCauHoi && (
        <>
          <CauHoiLamBai
            cauHoi={cauHoi}
            dapAn={dapAn}
            onChange={(id, a) => setDapAn((d) => ({ ...d, [id]: a }))}
            disabled={pending}
            videoSlot={() => (
              <>
                <p className="m-0 text-xs font-semibold text-neutral-700">Quay hoặc chọn video làm đáp án (bắt buộc)</p>
                <VideoUpload value={files.filter(laVideo)} onChange={(v) => setFiles([...files.filter((f) => !laVideo(f)), ...v])} disabled={pending} />
              </>
            )}
          />
          <p className="text-xs text-neutral-500">
            Đã làm {daLam}/{khongPhaiVideo.length} câu
            {daLam < khongPhaiVideo.length ? " — câu bỏ trống tính 0 điểm." : "."}
          </p>
        </>
      )}

      {allowText && (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={coCauHoi ? 3 : 5}
          placeholder={coCauHoi ? "Ghi chú thêm cho thầy cô (không bắt buộc)…" : "Nhập câu trả lời / mô tả bài làm…"}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none"
        />
      )}

      {yeuCauVideo && !coCauVideo && (
        <div className="space-y-1.5">
          <p className="text-sm font-semibold text-neutral-800">Video bài làm (bắt buộc)</p>
          <VideoUpload value={files.filter(laVideo)} onChange={(v) => setFiles([...files.filter((f) => !laVideo(f)), ...v])} disabled={pending} />
        </div>
      )}

      {allowFile && (
        <AttachmentUpload
          value={files.filter((f) => !laVideo(f))}
          onChange={(v) => setFiles([...files.filter(laVideo), ...v])}
          endpoint="/api/portal/upload-url"
          maxFiles={5}
          disabled={pending}
          label="Đính kèm ảnh / tài liệu bài làm"
        />
      )}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-lg bg-orange-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-800 disabled:opacity-60"
      >
        {pending ? "Đang nộp…" : "Nộp bài"}
      </button>
    </div>
  );
}
