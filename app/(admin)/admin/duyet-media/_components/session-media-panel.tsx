"use client";

// M3 (lưới media của buổi) + M4 (xem từng ảnh) — BA §7.4 MEDIA-REVIEW 26/08/2026.
//
// M4 là LỚP PHỦ trong cùng component chứ không phải route riêng: xem–loại–xem tiếp là
// một mạch thao tác, tách route thì mỗi lần loại một tấm là một lượt tải lại.
//
// ⚠️ BA §7.3c — VUỐT KHÔNG BAO GIỜ XOÁ. Vuốt trái/phải chỉ chuyển ảnh; loại ảnh chỉ qua
// nút X đỏ + xác nhận. Vuốt-để-xoá là cách chắc chắn nhất để mất ảnh vì lỡ tay.
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Film,
  ImageIcon,
  RotateCcw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  approveAllMediaAction,
  declareNoMediaAction,
  markVideoWatchedAction,
  rejectMediaAction,
  restoreMediaAction,
} from "../_actions";

export type ReviewMediaItem = {
  id: string;
  type: "IMAGE" | "VIDEO";
  url: string;
  thumbUrl: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "PURGED";
  durationSec: number | null;
  watchedRatio: number | null;
  uploadedByName: string | null;
};

type Props = {
  classSessionId: string;
  className: string;
  classCode: string | null;
  sessionLabel: string;
  items: ReviewMediaItem[];
  reviewStatus: "OPEN" | "APPROVED" | "NO_MEDIA_DECLARED";
  noMediaReason: string | null;
  decidedByName: string | null;
};

export function SessionMediaPanel({
  classSessionId,
  className,
  classCode,
  sessionLabel,
  items,
  reviewStatus,
  noMediaReason,
  decidedByName,
}: Props) {
  const router = useRouter();
  const [dangChay, start] = useTransition();
  const [slide, setSlide] = useState<number | null>(null);
  const [hoiDuyet, setHoiDuyet] = useState(false);
  const [hoiKhongAnh, setHoiKhongAnh] = useState(false);

  const song = items.filter((m) => m.status !== "REJECTED");
  const daLoai = items.filter((m) => m.status === "REJECTED");
  const choDuyet = song.filter((m) => m.status === "PENDING");

  function chay(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, ok: string) {
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(ok);
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start gap-3">
        <button
          type="button"
          onClick={() => router.push("/duyet-media")}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Danh sách
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold text-foreground">
            {className}
            {classCode && (
              <span className="ml-1 text-base font-normal text-muted-foreground">
                ({classCode})
              </span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">{sessionLabel}</p>
        </div>
      </header>

      {reviewStatus !== "OPEN" && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          <p className="font-semibold">
            {reviewStatus === "APPROVED"
              ? "Buổi này đã được duyệt"
              : "Buổi này đã ghi nhận: không có ảnh"}
            {decidedByName && <span className="font-normal"> — {decidedByName}</span>}
          </p>
          {noMediaReason && <p className="mt-1 font-normal">Ghi chú: {noMediaReason}</p>}
        </div>
      )}

      {/* ── Hành động chính ─────────────────────────────────────────────── */}
      {reviewStatus === "OPEN" && (
        <div className="flex flex-wrap items-center gap-2">
          {choDuyet.length > 0 ? (
            <button
              type="button"
              disabled={dangChay}
              onClick={() => setHoiDuyet(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Check className="h-4 w-4" aria-hidden />
              Duyệt tất cả ({choDuyet.length})
            </button>
          ) : (
            song.length === 0 && (
              <button
                type="button"
                disabled={dangChay}
                onClick={() => setHoiKhongAnh(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                Hôm nay không có ảnh
              </button>
            )
          )}
          <p className="text-sm text-muted-foreground">
            Bấm vào ảnh để xem lớn và loại từng tấm.
          </p>
        </div>
      )}

      {/* ── M3 · Lưới ───────────────────────────────────────────────────── */}
      {song.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <ImageIcon className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium text-foreground">Buổi này chưa có ảnh nào</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Nhắc giáo viên đứng buổi gửi ảnh, hoặc ghi nhận “không có ảnh” kèm lý do.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {song.map((m, i) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => setSlide(i)}
                className="group relative block aspect-square w-full overflow-hidden rounded-lg border border-border bg-muted"
                aria-label={`Xem lớn ảnh ${i + 1}`}
              >
                {/* next/image cố tình KHÔNG dùng: URL R2 ký hạn 10 phút, đưa qua bộ tối ưu
                    của Next là sinh bản nhớ đệm theo URL — mà URL đổi mỗi lần tải trang
                    nên nhớ đệm không bao giờ trúng, chỉ tốn thêm một vòng tải. */}
                <img
                  src={m.thumbUrl ?? m.url}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition group-hover:scale-105"
                />
                {m.type === "VIDEO" && (
                  <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
                    <Film className="h-3 w-3" aria-hidden />
                    {m.durationSec ? `${Math.round(m.durationSec)}s` : "video"}
                  </span>
                )}
                {m.status === "APPROVED" && (
                  <span className="absolute right-1.5 top-1.5 rounded-full bg-emerald-600 p-1 text-white">
                    <Check className="h-3 w-3" aria-hidden />
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* ── Thùng rác 7 ngày (BA §7.3a) ─────────────────────────────────── */}
      {daLoai.length > 0 && (
        <details className="rounded-xl border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-semibold text-foreground">
            Đã loại ({daLoai.length}) — còn khôi phục được trong 7 ngày
          </summary>
          <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
            {daLoai.map((m) => (
              <li key={m.id} className="space-y-1">
                <div className="relative aspect-square overflow-hidden rounded border border-border bg-muted">
                  <img
                    src={m.thumbUrl ?? m.url}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover opacity-50"
                  />
                </div>
                <button
                  type="button"
                  disabled={dangChay}
                  onClick={() =>
                    chay(
                      () => restoreMediaAction({ mediaId: m.id, classSessionId }),
                      "Đã khôi phục ảnh",
                    )
                  }
                  className="inline-flex w-full items-center justify-center gap-1 rounded border border-border px-1 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden />
                  Khôi phục
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* ── M4 · Xem từng ảnh ───────────────────────────────────────────── */}
      {slide !== null && song[slide] && (
        <SlideViewer
          items={song}
          index={slide}
          classSessionId={classSessionId}
          busy={dangChay}
          onClose={() => setSlide(null)}
          onIndex={setSlide}
          onReject={(mediaId) =>
            chay(() => rejectMediaAction({ mediaId, classSessionId }), "Đã loại ảnh")
          }
          onWatched={(mediaId, ratio) =>
            void markVideoWatchedAction({ mediaId, classSessionId, ratio })
          }
        />
      )}

      {/* ── Hộp xác nhận duyệt cả lô ────────────────────────────────────── */}
      {hoiDuyet && (
        <Modal onClose={() => setHoiDuyet(false)} title="Duyệt toàn bộ">
          {/* Câu chữ đúng nguyên văn BA US-03.2 — đây là câu QLCS ký tên vào. */}
          <p className="text-sm text-foreground">Xác nhận đã xem và duyệt toàn bộ ảnh</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {choDuyet.length} tấm sẽ chuyển sang trạng thái đã duyệt và giáo viên chọn được
            để gửi cho phụ huynh.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setHoiDuyet(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Huỷ
            </button>
            <button
              type="button"
              disabled={dangChay}
              onClick={() => {
                setHoiDuyet(false);
                chay(() => approveAllMediaAction({ classSessionId }), "Đã duyệt toàn bộ");
              }}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Xác nhận
            </button>
          </div>
        </Modal>
      )}

      {hoiKhongAnh && (
        <NoMediaModal
          busy={dangChay}
          onClose={() => setHoiKhongAnh(false)}
          onSubmit={(reason) => {
            setHoiKhongAnh(false);
            chay(
              () => declareNoMediaAction({ classSessionId, reason }),
              "Đã ghi nhận buổi không có ảnh",
            );
          }}
        />
      )}
    </div>
  );
}

// ─── M4 ────────────────────────────────────────────────────────────────────

function SlideViewer({
  items,
  index,
  busy,
  onClose,
  onIndex,
  onReject,
  onWatched,
}: {
  items: ReviewMediaItem[];
  index: number;
  classSessionId: string;
  busy: boolean;
  onClose: () => void;
  onIndex: (i: number) => void;
  onReject: (mediaId: string) => void;
  onWatched: (mediaId: string, ratio: number) => void;
}) {
  const [hoiLoai, setHoiLoai] = useState(false);
  const cur = items[index]!;
  const chamX = useRef<number | null>(null);

  const truoc = useCallback(() => onIndex(Math.max(0, index - 1)), [index, onIndex]);
  const sau = useCallback(() => onIndex(Math.min(items.length - 1, index + 1)), [index, items.length, onIndex]);

  // Bàn phím: mũi tên chuyển ảnh, Esc đóng. KHÔNG gán phím nào cho "loại" — loại phải là
  // một hành động có chủ ý, gõ nhầm phím không được xoá ảnh của lớp.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (hoiLoai) return;
      if (e.key === "ArrowLeft") truoc();
      else if (e.key === "ArrowRight") sau();
      else if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [truoc, sau, onClose, hoiLoai]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
      role="dialog"
      aria-modal="true"
      aria-label="Xem ảnh buổi học"
    >
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="text-sm tabular-nums">
          {index + 1} / {items.length}
        </span>
        <span className="truncate px-3 text-xs text-white/70">
          {cur.uploadedByName ? `GV gửi: ${cur.uploadedByName}` : ""}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-2 hover:bg-white/10"
          aria-label="Đóng"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden px-2"
        // Vuốt CHỈ chuyển ảnh (BA §7.3c).
        onTouchStart={(e) => {
          chamX.current = e.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(e) => {
          const x0 = chamX.current;
          const x1 = e.changedTouches[0]?.clientX;
          chamX.current = null;
          if (x0 == null || x1 == null) return;
          const d = x1 - x0;
          if (Math.abs(d) < 50) return;
          if (d > 0) truoc();
          else sau();
        }}
      >
        {index > 0 && (
          <button
            type="button"
            onClick={truoc}
            className="absolute left-2 z-10 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
            aria-label="Ảnh trước"
          >
            <ChevronLeft className="h-6 w-6" aria-hidden />
          </button>
        )}

        {cur.type === "VIDEO" ? (
          <video
            key={cur.id}
            src={cur.url}
            controls
            playsInline
            className="max-h-full max-w-full"
            // BA §7.3b — chốt "đã xem" ở 90%: đủ để coi là đã xem hết mà không bắt QLCS
            // ngồi hết đoạn tĩnh cuối clip.
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (!v.duration || !Number.isFinite(v.duration)) return;
              const r = v.currentTime / v.duration;
              if (r >= 0.9 && (cur.watchedRatio ?? 0) < 0.9) onWatched(cur.id, 1);
            }}
          />
        ) : (
          <img
            key={cur.id}
            src={cur.url}
            alt=""
            className="max-h-full max-w-full object-contain"
          />
        )}

        {index < items.length - 1 && (
          <button
            type="button"
            onClick={sau}
            className="absolute right-2 z-10 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
            aria-label="Ảnh sau"
          >
            <ChevronRight className="h-6 w-6" aria-hidden />
          </button>
        )}
      </div>

      <div className="flex items-center justify-center gap-3 px-4 py-5">
        {cur.status === "REJECTED" ? (
          <span className="rounded-full bg-white/10 px-4 py-2 text-sm text-white/70">
            Đã loại
          </span>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setHoiLoai(true)}
            className="inline-flex items-center gap-2 rounded-full bg-red-600 px-6 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            <X className="h-5 w-5" aria-hidden />
            Loại ảnh này
          </button>
        )}
      </div>

      {hoiLoai && (
        <Modal onClose={() => setHoiLoai(false)} title="Loại ảnh này?">
          <p className="text-sm text-muted-foreground">
            Ảnh sẽ ẩn khỏi lớp và giáo viên không chọn được nữa. Còn khôi phục được trong 7
            ngày trước khi xoá hẳn.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setHoiLoai(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Giữ lại
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setHoiLoai(false);
                onReject(cur.id);
                // Ảnh vừa loại biến khỏi danh sách ⇒ chỉ số phải lùi khi đang ở tấm cuối.
                if (index >= items.length - 1) onIndex(Math.max(0, items.length - 2));
              }}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              Loại ảnh
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Hộp thoại ─────────────────────────────────────────────────────────────

function NoMediaModal({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const du = reason.trim().length >= 10;
  return (
    <Modal onClose={onClose} title="Buổi này không có ảnh">
      <p className="text-sm text-muted-foreground">
        Ghi rõ vì sao buổi học không có ảnh. Ghi chú này đi vào báo cáo, tối thiểu 10 ký tự.
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        autoFocus
        placeholder="VD: Lớp học ngoài trời, máy hết pin — GV đã báo trước buổi."
        className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
      />
      <p className="mt-1 text-xs text-muted-foreground">{reason.trim().length}/10 ký tự</p>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          Huỷ
        </button>
        <button
          type="button"
          disabled={busy || !du}
          onClick={() => onSubmit(reason.trim())}
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
        >
          Ghi nhận
        </button>
      </div>
    </Modal>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl"
      >
        <h2 className="text-base font-bold text-foreground">{title}</h2>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}
