"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { nopBaiTapAction } from "../_actions";
import type { NenNopBai } from "@/lib/elearning/task-view";

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
  const taiTep = async (f: File) => {
    if (!g) return;
    setDangTai(true);
    try {
      const ky = await fetch("/api/elearning/bai-nop/tep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buoc: "ky",
          submissionId: g.submissionId,
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
          submissionId: g.submissionId,
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
      <div className="rounded-md border p-3 text-sm">
        <p className="font-medium">Bài này chấm theo: {nen.tenKhung}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Đạt từ <strong>{nen.passPoints}</strong>/{nen.totalPoints} điểm. Người chấm
          có <strong>3 ngày làm việc</strong> kể từ lúc bạn nộp.
        </p>
        <ol className="mt-2 space-y-2">
          {nen.tieuChi.map((tc, i) => (
            <li key={i} className="text-xs">
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
        <div className="rounded-md border p-3 text-sm">
          <p>
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

          {g.status === "SUBMITTED" ? (
            // Nói rõ đang chờ AI, và rằng hạn của họ được bảo vệ. Không nói thì một
            // tuần im lặng trông y hệt hệ thống nuốt mất bài.
            <p className="mt-1 text-xs text-muted-foreground">
              Bài đã tới hàng chờ chấm. Nếu người chấm trễ hạn, hệ thống tự nới hạn
              của bạn đúng số ngày đã chờ — bạn không bị tính trễ vì việc đó.
            </p>
          ) : null}

          {g.diemTieuChi.length > 0 ? (
            <ul className="mt-2 space-y-0.5 text-xs">
              {g.diemTieuChi.map((d, i) => (
                <li key={i}>
                  <span className="text-muted-foreground">{d.label}:</span> {d.muc} (
                  {d.points})
                  {d.note ? <span className="text-muted-foreground"> · {d.note}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}

          {g.feedback ? (
            <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-xs">
              {g.feedback}
            </p>
          ) : null}

          {/* Tệp đính kèm — chỉ đính được khi lượt còn mở. */}
          {g.tep.length > 0 ? (
            <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
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
                  if (f) void taiTep(f);
                }}
                className="text-xs"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {dangTai
                  ? "Đang tải tệp lên…"
                  : `Video MP4, ghi âm MP3/M4A hoặc PDF · tối đa 300MB mỗi tệp, ${5 - g.tep.length} tệp còn lại`}
              </p>
              {/* ⚠️ Ràng buộc §13.3 về dữ liệu của người KHÁC. Hệ thống không kiểm
                  được điều này bằng mã, nên nó phải nằm ở nơi người nộp đọc trước
                  khi chọn tệp. */}
              <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">
                Không nộp tệp có mặt hoặc tên học sinh. Dùng nhân viên đóng vai, hoặc
                góc quay không nhận diện. Ghi âm tư vấn phải ẩn danh trước khi nộp.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Ô nộp ──────────────────────────────────────────────────────── */}
      {nen.nopDuoc ? (
        <div className="space-y-2 rounded-md border p-3">
          <textarea
            value={chu}
            onChange={(e) => setChu(e.target.value)}
            rows={8}
            maxLength={20_000}
            placeholder="Bài làm của bạn…"
            className="w-full rounded-md border px-2 py-1 text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Nộp xong vẫn đính kèm tệp được, chừng nào chưa có ai chấm.
          </p>
          <button
            type="button"
            disabled={dangChay || chu.trim().length === 0}
            onClick={nop}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {dangChay ? "Đang nộp…" : g ? "Nộp lại" : "Nộp bài"}
          </button>
          {/* Nói thẳng: nộp KHÔNG phải là xong. */}
          <p className="text-xs text-muted-foreground">
            Bài chỉ tính là hoàn thành khi người chấm cho đủ {nen.passPoints} điểm.
          </p>
        </div>
      ) : g?.status === "SUBMITTED" ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm">
          Bài đang chờ chấm — chưa nộp lại được.
        </p>
      ) : (
        <p className="rounded-md bg-muted px-3 py-2 text-sm">
          Bài đã đạt. Không cần nộp lại.
        </p>
      )}
    </div>
  );
}
