"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AttachmentUpload, type UploadedFile } from "@/components/assignments/attachment-upload";
import { submitAssignment } from "@/app/(portal)/portal/bai-tap/actions";
import { NUT_CAM, NUT_TAT } from "@/components/portal/hv-ui";
import { VideoUpload } from "@/components/assignments/video-upload";
import { CauHoiLamBai, coNoiDungDapAn, dapAnDeGui, type DapAnTheoCau } from "@/components/assignments/lam-bai-cau-hoi";
import type { CauHoiHocVien, DapAn } from "@/lib/assignments/lam-bai";

const laVideo = (f: UploadedFile) => f.mime.startsWith("video/");

// Ô "Bài làm của em" — nộp bài tập bằng CHÍNH hành động nộp bài đang chạy (cùng cổng hạn nộp, cùng luật chấm trễ). Chỉ khác giao diện.
export function HvNopBai({
  assignmentId,
  allowText,
  allowFile,
  yeuCauVideo,
  cauHoi,
  initialAnswers,
  initialText,
  initialFiles,
  daCham,
  xung,
}: {
  assignmentId: string;
  allowText: boolean;
  allowFile: boolean;
  /** Bài yêu cầu nộp video — BẮT BUỘC khai (luật 11). */
  yeuCauVideo: boolean;
  /** TẤT CẢ câu hỏi của bài (đã bỏ đáp án đúng). BẮT BUỘC khai (luật 11): quên truyền = bài nhiều câu chỉ còn ô văn bản, câm lặng. */
  cauHoi: CauHoiHocVien[];
  /** Câu trả lời đã nộp trước đó (nộp lại). */
  initialAnswers: { questionId: string; dapAn: DapAn; dung: boolean | null }[];
  initialText: string | null;
  initialFiles: UploadedFile[];
  daCham: boolean;
  xung: string;
}) {
  const router = useRouter();
  const [chu, setChu] = useState(initialText ?? "");
  const [tep, setTep] = useState<UploadedFile[]>(initialFiles);
  const [dang, bat] = useTransition();
  const [dapAn, setDapAn] = useState<DapAnTheoCau>(() => Object.fromEntries(initialAnswers.map((a) => [a.questionId, a.dapAn])));
  const [xong, setXong] = useState<"ok" | "tre" | null>(null);

  const coCauVideo = cauHoi.some((q) => q.type === "video");
  const yeuVideo = yeuCauVideo || coCauVideo;
  const khongPhaiVideo = cauHoi.filter((q) => q.type !== "video");
  const daLam = khongPhaiVideo.filter((q) => coNoiDungDapAn(dapAn[q.id])).length;
  const coCauHoi = cauHoi.length > 0;

  if (daCham) {
    return (
      <div className="flex flex-col gap-3">
        <p className="m-0 rounded-xl bg-[var(--sr-success-bg)] p-3.5 text-sm text-[var(--sr-success)]">Bài đã được chấm — em không nộp lại được nữa.</p>
        {coCauHoi && (
          <CauHoiLamBai
            cauHoi={cauHoi}
            dapAn={dapAn}
            onChange={() => {}}
            disabled
            ketQua={Object.fromEntries(initialAnswers.map((a) => [a.questionId, a.dung]))}
            videoSlot={() => <p className="m-0 text-sm text-muted-foreground">Video em đã nộp nằm ở phần tệp bài làm.</p>}
          />
        )}
      </div>
    );
  }

  const coGi = chu.trim().length > 0 || tep.length > 0 || daLam > 0;
  const nop = () => {
    if (!coGi) {
      toast.error(coCauHoi ? "Em trả lời ít nhất một câu rồi bấm Nộp nhé." : allowText && !allowFile ? "Em viết bài làm rồi bấm Nộp nhé." : "Em thêm ít nhất một ảnh, video hoặc tệp nhé.");
      return;
    }
    if (yeuVideo && !tep.some((f) => f.mime.startsWith("video/"))) {
      toast.error("Bài này cần có một video — em quay hoặc chọn video nhé.");
      return;
    }
    bat(async () => {
      const r = await submitAssignment({
        assignmentId,
        textAnswer: allowText ? chu : null,
        answers: dapAnDeGui(dapAn),
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
      {coCauHoi && (
        <>
          <CauHoiLamBai
            cauHoi={cauHoi}
            dapAn={dapAn}
            onChange={(id, a) => setDapAn((d) => ({ ...d, [id]: a }))}
            disabled={dang}
            videoSlot={() => (
              <>
                <div className="text-sm font-bold">Quay hoặc chọn video làm đáp án (bắt buộc)</div>
                <VideoUpload value={tep.filter(laVideo)} onChange={(v) => setTep([...tep.filter((f) => !laVideo(f)), ...v])} disabled={dang} />
              </>
            )}
          />
          <p className="m-0 text-[13px] text-muted-foreground">
            Em đã làm {daLam}/{khongPhaiVideo.length} câu{daLam < khongPhaiVideo.length ? " — câu bỏ trống được 0 điểm nhé." : "."}
          </p>
        </>
      )}
      {yeuCauVideo && !coCauVideo && (
        <div className="flex flex-col gap-1.5 rounded-2xl border-2 border-[var(--sr-orange)] bg-card p-3">
          <div className="text-sm font-bold">Video bài làm (bắt buộc)</div>
          <VideoUpload value={tep.filter(laVideo)} onChange={(v) => setTep([...tep.filter((f) => !laVideo(f)), ...v])} disabled={dang} />
        </div>
      )}
      {allowFile && (
        <div className="rounded-2xl border-2 border-dashed border-[var(--sr-dash)] bg-card p-3">
          <AttachmentUpload value={tep.filter((f) => !laVideo(f))} onChange={(v) => setTep([...tep.filter(laVideo), ...v])} endpoint="/api/portal/upload-url" maxFiles={5} disabled={dang} label="Chụp ảnh, quay video hoặc chọn tệp" />
        </div>
      )}
      {allowText && (
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          {allowFile || coCauHoi ? `Em muốn nói gì với ${xung}? (không bắt buộc)` : "Bài làm của em"}
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
        {dang ? "Đang nộp…" : coGi ? (xong ? "Nộp lại" : "Nộp bài") : coCauHoi ? "Trả lời ít nhất một câu để nộp" : "Thêm ảnh, video hoặc tệp để nộp"}
      </button>
    </div>
  );
}
