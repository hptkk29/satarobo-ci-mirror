"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { chamBaiTapAction } from "../_actions";
import type { LuotNopDeCham } from "@/lib/elearning/task-grading-queue";

/**
 * EL-15c — CHẤM MỘT LƯỢT NỘP theo khung.
 *
 * ⚠️ Chấm TRỌN một lượt trong MỘT lần, không lưu nháp — cùng luật với chấm bài thi
 * và cùng lý do: chấm dở dang đẻ ra một trạng thái thứ ba mà không cột nào mô tả
 * được, và không ai biết lượt đó còn chờ ai.
 *
 * ⚠️ Người chấm chọn MỘT mức cho mỗi tiêu chí, không gõ số. Gõ số là mở đường cho
 * hai người chấm cùng một khung bằng hai thang — đúng thứ khung sinh ra để chặn.
 */
export function TaskGradingForm(props: { luot: LuotNopDeCham }) {
  const router = useRouter();
  const [dangChay, batDau] = useTransition();
  const { luot } = props;

  const [chon, setChon] = useState<Record<string, number | null>>(
    Object.fromEntries(luot.tieuChi.map((t) => [t.criterionId, t.levelIndexCu])),
  );
  const [ghiChu, setGhiChu] = useState<Record<string, string>>(
    Object.fromEntries(luot.tieuChi.map((t) => [t.criterionId, t.noteCu ?? ""])),
  );
  const [nhanXet, setNhanXet] = useState("");

  const soTrong = luot.tieuChi.filter((t) => chon[t.criterionId] == null).length;
  const tong = luot.tieuChi.reduce((s, t) => {
    const i = chon[t.criterionId];
    return s + (i == null ? 0 : (t.levels[i]?.points ?? 0));
  }, 0);
  const seDat = tong >= luot.passPoints;

  const chot = (traVeSua: boolean) =>
    batDau(async () => {
      const r = await chamBaiTapAction({
        submissionId: luot.submissionId,
        diem: luot.tieuChi.map((t) => ({
          criterionId: t.criterionId,
          levelIndex: chon[t.criterionId]!,
          note: (ghiChu[t.criterionId] ?? "").trim() || null,
        })),
        traVeSua,
        feedback: nhanXet.trim() || null,
      });
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success(
        r.data.traVeSua
          ? "Đã trả bài về để người học sửa"
          : r.data.passed
            ? `Đã chốt — đạt ${r.data.totalScore}/${luot.totalPoints}`
            : `Đã chốt — chưa đạt (${r.data.totalScore}/${luot.totalPoints})`,
      );
      if (r.data.ghiTienDoLoi) {
        toast.error(
          "Điểm đã chốt, nhưng chưa đánh dấu được bài học là xong — báo kỹ thuật.",
        );
      }
      router.push("/elearning/cham-bai-tap");
      router.refresh();
    });

  return (
    <div className="space-y-4">
      {/* ── Bài làm ────────────────────────────────────────────────────── */}
      <div className="rounded-md border p-3 text-sm">
        <p className="text-xs text-muted-foreground">Bài làm</p>
        <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted px-3 py-2">
          {luot.contentText}
        </p>
        {luot.tep.length > 0 ? (
          <ul className="mt-2 space-y-1 text-xs">
            {luot.tep.map((t) => (
              <li key={t.key}>
                <a
                  href={`/api/elearning/bai-nop/tai-ve?luot=${encodeURIComponent(
                    luot.submissionId,
                  )}&khoa=${encodeURIComponent(t.key)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  📎 {t.name}
                </a>{" "}
                <span className="text-muted-foreground">
                  ({Math.round(t.size / 1024 / 1024)}MB)
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {luot.coTieuChiHong ? (
        // Không chấm được thì nói RÕ, đừng để người chấm ngồi thử từng ô.
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          Có tiêu chí hệ thống không đọc được các mức — chưa chấm được bài này. Báo
          Đào tạo sửa khung, đừng chấm tay.
        </p>
      ) : null}

      {/* ── Tiêu chí ───────────────────────────────────────────────────── */}
      <ol className="space-y-3">
        {luot.tieuChi.map((t, i) => (
          <li key={t.criterionId} className="rounded-md border p-3 text-sm">
            <p>
              <span className="mr-2 text-xs text-muted-foreground">{i + 1}.</span>
              <span className="font-medium">{t.label}</span>
            </p>
            {t.description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
            ) : null}

            <div className="mt-2 space-y-1">
              {t.levels.map((m, j) => (
                <button
                  key={j}
                  type="button"
                  onClick={() =>
                    setChon((s) => ({ ...s, [t.criterionId]: j }))
                  }
                  className={`block w-full rounded-md border px-3 py-2 text-left text-sm ${
                    chon[t.criterionId] === j
                      ? "border-primary bg-primary/10 font-medium"
                      : ""
                  }`}
                >
                  <span className="mr-2 text-xs text-muted-foreground">
                    {m.points}
                  </span>
                  {m.label}
                  {m.desc ? (
                    <span className="text-xs text-muted-foreground"> · {m.desc}</span>
                  ) : null}
                </button>
              ))}
            </div>

            <input
              value={ghiChu[t.criterionId] ?? ""}
              onChange={(e) =>
                setGhiChu((s) => ({ ...s, [t.criterionId]: e.target.value }))
              }
              maxLength={2000}
              placeholder="Ghi chú cho tiêu chí này (không bắt buộc)"
              className="mt-2 w-full rounded-md border px-2 py-1 text-sm"
            />
          </li>
        ))}
      </ol>

      {/* ── Chốt ───────────────────────────────────────────────────────── */}
      <div className="space-y-2 rounded-md border p-3">
        <textarea
          value={nhanXet}
          onChange={(e) => setNhanXet(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Nhận xét chung cho cả bài (không bắt buộc)"
          className="w-full rounded-md border px-2 py-1 text-sm"
        />
        <p className="text-xs text-muted-foreground">
          {soTrong > 0
            ? `Còn ${soTrong} tiêu chí chưa chọn mức.`
            : `Tổng: ${tong}/${luot.totalPoints} — ${seDat ? "đạt" : "chưa đạt"} (đạt từ ${luot.passPoints}).`}
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={dangChay || soTrong > 0 || luot.coTieuChiHong}
            onClick={() => chot(false)}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {dangChay ? "Đang chốt…" : "Chốt điểm"}
          </button>
          <button
            type="button"
            disabled={dangChay || soTrong > 0 || luot.coTieuChiHong}
            onClick={() => chot(true)}
            className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
          >
            Trả về để sửa
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          {/* Nói rõ khác biệt: một đường đóng sổ, một đường mở lại cho người học. */}
          Chốt điểm là đóng lượt này. Trả về để sửa thì điểm từng tiêu chí vẫn được
          ghi lại, và người học nộp lại được.
        </p>
      </div>
    </div>
  );
}
