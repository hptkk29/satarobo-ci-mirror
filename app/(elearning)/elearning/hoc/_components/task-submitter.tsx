"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { nhapBaiTapAction, nopBaiTapAction } from "../_actions";
import type { NenNopBai } from "@/lib/elearning/task-view";
import { buocTienTrinh, diemTieuChiGon, tomTatKetQua } from "@/lib/elearning/task-view-pure";
import { CircleCheck, CircleDashed } from "lucide-react";

/**
 * EL-15c — NỘP MỘT BÀI TẬP.
 *
 * ⚠️ Khung chấm hiện ĐẦY ĐỦ trước khi làm. Giấu tiêu chí là bắt người học đoán mình
 * bị đo bằng gì — khác hẳn đề thi, nơi giấu đáp án là điều kiện của phép đo. Ở bài
 * thực hành, biết trước tiêu chí chính là một phần của việc học.
 *
 * ⚠️ Nộp KHÔNG phải là xong. Bài lên "hoàn thành" khi người chấm cho đủ điểm đạt,
 * và màn này nói thẳng điều đó để không ai đóng máy tưởng đã xong.
 */

const NHAN_TRANG_THAI: Record<string, string> = {
  SUBMITTED: "đang chờ chấm",
  GRADED: "đã chấm",
  NEEDS_REVISION: "người chấm trả về để sửa",
  DRAFT: "nháp",
};

export function TaskSubmitter(props: {
  enrollmentId: string;
  lessonId: string;
  nen: NenNopBai;
}) {
  const router = useRouter();
  const [dangChay, batDau] = useTransition();
  const [chu, setChu] = useState("");
  const [dangTai, setDangTai] = useState(false);
  const oTep = useRef<HTMLInputElement>(null);
  const { nen } = props;
  const g = nen.ganNhat;

  const nop = () =>
    batDau(async () => {
      const r = await nopBaiTapAction({
        enrollmentId: props.enrollmentId,
        lessonId: props.lessonId,
        contentText: chu.trim(),
      });
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success("Đã nộp — bài của bạn vào hàng chờ chấm");
      setChu("");
      router.refresh();
    });

  /**
   * Tải MỘT tệp: ký URL → PUT thẳng lên kho → báo xong để máy chủ xác minh.
   *
   * ⚠️ Bước "xong" là bắt buộc, không phải để cho đẹp: nếu bỏ, cột tệp ghi lời khai
   * của trình duyệt chứ không ghi sự thật — máy chủ chưa hề nhìn tệp đó.
   */
  const taiTep = async (f: File, duocChoSubmissionId?: string) => {
    setDangTai(true);
    try {
      // Đính tệp TRƯỚC khi nộp: chưa có lượt nào thì mở lượt NHÁP (không phải bài nộp) để tệp có chỗ gắn vào.
      // ⚠️ KHÔNG rơi về `g` (lượt đã nộp/đã chấm): route tải tệp chỉ nhận SUBMITTED/DRAFT, nên nộp lại phải đi vào NHÁP MỚI.
      let submissionId = duocChoSubmissionId ?? nen.nhap?.submissionId;
      if (!submissionId) {
        const m = await nhapBaiTapAction({ enrollmentId: props.enrollmentId, lessonId: props.lessonId });
        if (!m.ok) {
          toast.error(m.error.message);
          return;
        }
        submissionId = m.data.submissionId;
      }
      const ky = await fetch("/api/elearning/bai-nop/tep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buoc: "ky",
          submissionId,
          tenTep: f.name,
          mime: f.type,
          size: f.size,
        }),
      }).then((r) => r.json());
      if (!ky.ok) {
        toast.error(ky.error?.message ?? "Không ký được đường tải");
        return;
      }

      const put = await fetch(ky.data.url, {
        method: "PUT",
        headers: { "Content-Type": f.type },
        body: f,
      });
      if (!put.ok) {
        toast.error("Tải tệp lên không thành công — thử lại");
        return;
      }

      const xong = await fetch("/api/elearning/bai-nop/tep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buoc: "xong",
          submissionId,
          khoa: ky.data.khoa,
          tenTep: f.name,
          mime: f.type,
        }),
      }).then((r) => r.json());
      if (!xong.ok) {
        toast.error(xong.error?.message ?? "Tệp không qua được bước kiểm");
        return;
      }
      toast.success("Đã đính kèm tệp");
      router.refresh();
    } finally {
      setDangTai(false);
      if (oTep.current) oTep.current.value = "";
    }
  };

  return (
    <div className="space-y-4">
      {/* ── Khung chấm ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-4 text-sm">
        <p className="text-base font-semibold text-foreground">Bài này chấm theo: {nen.tenKhung}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Đạt từ <strong>{nen.passPoints}</strong>/{nen.totalPoints} điểm. Người chấm
          có <strong>3 ngày làm việc</strong> kể từ lúc bạn nộp.
        </p>
        <ol className="mt-3 space-y-3">
          {nen.tieuChi.map((tc, i) => (
            <li key={i} className="text-sm">
              <span className="font-medium">
                {i + 1}. {tc.label}
              </span>
              {tc.description ? (
                <span className="text-muted-foreground"> — {tc.description}</span>
              ) : null}
              <ul className="mt-0.5 space-y-0.5 pl-4 text-muted-foreground">
                {tc.levels.map((m, j) => (
                  <li key={j}>
                    {m.points} — {m.label}
                    {m.desc ? ` · ${m.desc}` : ""}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>

      {/* ── Lượt gần nhất ──────────────────────────────────────────────── */}
      {g ? (
        <div className="rounded-xl border border-border bg-card p-4 text-sm">
          <p className="font-medium">
            Lượt {g.attemptNo} — {NHAN_TRANG_THAI[g.status] ?? g.status}
            {g.score != null ? (
              <>
                {" · "}
                <strong>
                  {g.score}/{nen.totalPoints}
                </strong>{" "}
                — {g.passed ? "đạt" : "chưa đạt"}
              </>
            ) : null}
          </p>

          {/* Tiến trình 3 bước — chỉ vẽ thứ dữ liệu có (không có bước "đã có người mở chấm", không tên người chấm trước khi chấm). */}
          <ol aria-label="Tiến trình bài nộp" className="mt-3 space-y-2">
            {buocTienTrinh(g).map((b) => (
              <li key={b.id} className="flex items-start gap-2.5 text-sm">
                {b.xong ? (
                  <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-state-success-ink" aria-hidden />
                ) : (
                  <CircleDashed className={`mt-0.5 h-4 w-4 shrink-0 ${b.hienTai ? "text-state-info-ink" : "text-muted-foreground/60"}`} aria-hidden />
                )}
                <span className="min-w-0">
                  <span className={b.xong || b.hienTai ? "font-medium text-foreground" : "text-muted-foreground"}>{b.nhan}</span>
                  {b.chiTiet ? <span className="block text-xs text-muted-foreground">{b.chiTiet}</span> : null}
                </span>
              </li>
            ))}
          </ol>

          {tomTatKetQua(g, nen.totalPoints) ? (
            <p
              className={`mt-3 rounded-lg px-3 py-2 text-base font-semibold ${
                g.passed ? "bg-state-success-soft text-state-success-ink" : "bg-state-warning-soft text-state-warning-ink"
              }`}
            >
              {tomTatKetQua(g, nen.totalPoints)}
            </p>
          ) : null}

          {g.status === "SUBMITTED" ? (
            // Nói rõ đang chờ AI, và rằng hạn của họ được bảo vệ. Không nói thì một
            // tuần im lặng trông y hệt hệ thống nuốt mất bài.
            <p className="mt-1 text-sm text-muted-foreground">
              Bài đã tới hàng chờ chấm. Nếu người chấm trễ hạn, hệ thống tự nới hạn
              của bạn đúng số ngày đã chờ — bạn không bị tính trễ vì việc đó.
            </p>
          ) : null}

          {g.diemTieuChi.length > 0 ? (
            <ul aria-label="Điểm từng tiêu chí" className="mt-3 grid gap-2 sm:grid-cols-2">
              {g.diemTieuChi.map((d, i) => (
                <li key={i} className="rounded-lg border border-border px-3 py-2 text-sm">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-foreground">{d.label}</span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-foreground">{diemTieuChiGon(d.points, d.toiDa)}</span>
                  </span>
                  <span className="block text-xs text-muted-foreground">{d.muc}</span>
                  {d.note ? <span className="mt-1 block text-sm text-foreground">{d.note}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}

          {g.feedback ? (
            <p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm">
              {g.feedback}
              {g.nguoiCham ? <span className="mt-1 block text-xs text-muted-foreground">— {g.nguoiCham}</span> : null}
            </p>
          ) : null}

          {/* Tệp đính kèm — chỉ đính được khi lượt còn mở. */}
          {g.tep.length > 0 ? (
            <ul className="mt-2 space-y-0.5 text-sm text-muted-foreground">
              {g.tep.map((t) => (
                <li key={t.key}>
                  📎 {t.name} ({Math.round(t.size / 1024 / 1024)}MB)
                </li>
              ))}
            </ul>
          ) : null}

          {g.status === "SUBMITTED" ? (
            <div className="mt-2">
              <input
                ref={oTep}
                type="file"
                accept="video/mp4,audio/mpeg,audio/mp4,application/pdf"
                disabled={dangTai || g.tep.length >= 5}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void taiTep(f, g.submissionId);
                }}
                aria-label="Đính kèm tệp cho bài nộp"
                className="block w-full text-sm file:mr-3 file:min-h-9 file:rounded-lg file:border file:border-border file:bg-card file:px-3 file:text-sm file:font-medium"
              />
              <p className="mt-1 text-sm text-muted-foreground">
                {dangTai
                  ? "Đang tải tệp lên…"
                  : `Video MP4, ghi âm MP3/M4A hoặc PDF · tối đa 300MB mỗi tệp, ${5 - g.tep.length} tệp còn lại`}
              </p>
              {/* ⚠️ Ràng buộc §13.3 về dữ liệu của người KHÁC. Hệ thống không kiểm
                  được điều này bằng mã, nên nó phải nằm ở nơi người nộp đọc trước
                  khi chọn tệp. */}
              <p className="mt-2 rounded-lg border border-state-warning/40 bg-state-warning-soft px-3 py-2 text-sm">
                Không nộp tệp có mặt hoặc tên học sinh. Dùng nhân viên đóng vai, hoặc
                góc quay không nhận diện. Ghi âm tư vấn phải ẩn danh trước khi nộp.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Ô nộp ──────────────────────────────────────────────────────── */}
      {nen.nopDuoc ? (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <textarea
            value={chu}
            onChange={(e) => setChu(e.target.value)}
            rows={8}
            maxLength={20_000}
            placeholder="Bài làm của bạn — hoặc ghi chú cho người chấm nếu bạn nộp bằng tệp…"
            aria-label="Bài làm của bạn"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring"
          />
          {/* Nộp bằng TỆP: đính tệp trước, phần chữ trở thành ghi chú cho người chấm (không bắt buộc). */}
          {(nen.nhap?.tep.length ?? 0) > 0 ? (
            <ul aria-label="Tệp sẽ nộp" className="space-y-0.5 text-sm text-foreground">
              {nen.nhap?.tep.map((t) => (
                <li key={t.key}>
                  📎 {t.name} ({Math.max(1, Math.round(t.size / 1024 / 1024))}MB)
                </li>
              ))}
            </ul>
          ) : null}
          <div>
            <input
              type="file"
              accept="video/mp4,audio/mpeg,audio/mp4,application/pdf"
              disabled={dangTai || (nen.nhap?.tep.length ?? 0) >= 5}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void taiTep(f);
                e.target.value = "";
              }}
              aria-label="Đính tệp để nộp bằng tệp"
              className="block w-full text-sm file:mr-3 file:min-h-9 file:rounded-lg file:border file:border-border file:bg-card file:px-3 file:text-sm file:font-medium"
            />
            <p className="mt-1 text-sm text-muted-foreground">
              {dangTai
                ? "Đang tải tệp lên…"
                : "Có thể nộp chỉ bằng tệp (video MP4, ghi âm MP3/M4A hoặc PDF · tối đa 300MB mỗi tệp, 5 tệp) — khi đó phần chữ là ghi chú cho người chấm, không bắt buộc."}
            </p>
            <p className="mt-2 rounded-lg border border-state-warning/40 bg-state-warning-soft px-3 py-2 text-sm">
              Không nộp tệp có mặt hoặc tên học sinh. Dùng nhân viên đóng vai, hoặc góc quay không nhận diện. Ghi âm tư vấn phải ẩn danh
              trước khi nộp.
            </p>
          </div>
          <button
            type="button"
            disabled={dangChay || dangTai || (chu.trim().length === 0 && (nen.nhap?.tep.length ?? 0) === 0)}
            onClick={nop}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground outline-none transition-colors hover:bg-primary-dark focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {dangChay ? "Đang nộp…" : g ? "Nộp lại" : "Nộp bài"}
          </button>
          {/* Nói thẳng: nộp KHÔNG phải là xong. */}
          <p className="text-sm text-muted-foreground">
            Bài chỉ tính là hoàn thành khi người chấm cho đủ {nen.passPoints} điểm.
          </p>
        </div>
      ) : g?.status === "SUBMITTED" ? (
        <p className="rounded-xl border border-border bg-muted px-4 py-3 text-sm">
          Bài đang chờ chấm — chưa nộp lại được.
        </p>
      ) : (
        <p className="rounded-xl border border-border bg-muted px-4 py-3 text-sm">
          Bài đã đạt. Không cần nộp lại.
        </p>
      )}
    </div>
  );
}
