"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { chamBaiTapAction } from "../_actions";
import { GhiChu } from "../../_components/ui/trang";
import { LIEN_KET_CHU, NHAN_O, NUT_CHINH, NUT_PHU, O_NHAP, O_NHAP_VAN_BAN } from "../../_components/ui/dieu-khien";
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
    <div className="space-y-5">
      {/* ── Bài làm ────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-4 text-sm">
        <h2 className="text-base font-semibold text-foreground">Bài làm</h2>
        <p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted px-3 py-2.5">
          {luot.contentText}
        </p>
        {luot.tep.length > 0 ? (
          <ul className="mt-3 space-y-1 text-sm">
            {luot.tep.map((t) => (
              <li key={t.key}>
                <a
                  href={`/api/elearning/bai-nop/tai-ve?luot=${encodeURIComponent(
                    luot.submissionId,
                  )}&khoa=${encodeURIComponent(t.key)}`}
                  target="_blank"
                  rel="noreferrer"
                  className={LIEN_KET_CHU}
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
        <GhiChu sac="danger">
          Có tiêu chí hệ thống không đọc được các mức — chưa chấm được bài này. Báo
          Đào tạo sửa khung, đừng chấm tay.
        </GhiChu>
      ) : null}

      {/* ── Tiêu chí ───────────────────────────────────────────────────── */}
      <ol className="space-y-3">
        {luot.tieuChi.map((t, i) => (
          <li key={t.criterionId} className="rounded-xl border border-border bg-card p-4 text-sm">
            <p className="text-base font-semibold text-foreground">
              <span className="mr-2 text-muted-foreground">{i + 1}.</span>
              {t.label}
            </p>
            {t.description ? (
              <p className="mt-0.5 text-sm text-muted-foreground">{t.description}</p>
            ) : null}

            <div role="group" aria-label={`Chọn mức cho tiêu chí ${t.label}`} className="mt-3 space-y-1.5">
              {t.levels.map((m, j) => {
                const dangChon = chon[t.criterionId] === j;
                return (
                  <button
                    key={j}
                    type="button"
                    aria-pressed={dangChon}
                    onClick={() => setChon((s) => ({ ...s, [t.criterionId]: j }))}
                    className={`flex min-h-11 w-full items-start gap-3 rounded-lg border px-3 py-2 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                      dangChon
                        ? "border-primary bg-primary-soft font-medium text-foreground"
                        : "border-border bg-background hover:bg-muted"
                    }`}
                  >
                    {/* Mức đã chọn: dấu ✓ + viền — màu không đứng một mình. */}
                    <span
                      aria-hidden
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${
                        dangChon ? "border-primary bg-primary text-primary-foreground" : "border-border"
                      }`}
                    >
                      {dangChon ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span className="w-10 shrink-0 font-semibold tabular-nums text-foreground">{m.points}</span>
                    <span className="min-w-0">
                      {m.label}
                      {m.desc ? (
                        <span className="block text-sm font-normal text-muted-foreground">{m.desc}</span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>

            <input
              value={ghiChu[t.criterionId] ?? ""}
              onChange={(e) =>
                setGhiChu((s) => ({ ...s, [t.criterionId]: e.target.value }))
              }
              maxLength={2000}
              placeholder="Ghi chú cho tiêu chí này (không bắt buộc)"
              aria-label={`Ghi chú cho tiêu chí ${t.label}`}
              className={`mt-3 ${O_NHAP}`}
            />
          </li>
        ))}
      </ol>

      {/* ── Chốt ───────────────────────────────────────────────────────── */}
      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <label className="block">
          <span className={NHAN_O}>Nhận xét chung cho cả bài</span>
          <textarea
            value={nhanXet}
            onChange={(e) => setNhanXet(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="Không bắt buộc"
            className={`mt-1 ${O_NHAP_VAN_BAN}`}
          />
        </label>
        <p className="text-sm font-medium text-foreground" aria-live="polite">
          {soTrong > 0
            ? `Còn ${soTrong} tiêu chí chưa chọn mức.`
            : `Tổng: ${tong}/${luot.totalPoints} — ${seDat ? "đạt" : "chưa đạt"} (đạt từ ${luot.passPoints}).`}
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={dangChay || soTrong > 0 || luot.coTieuChiHong}
            onClick={() => chot(false)}
            className={NUT_CHINH}
          >
            {dangChay ? "Đang chốt…" : "Chốt điểm"}
          </button>
          <button
            type="button"
            disabled={dangChay || soTrong > 0 || luot.coTieuChiHong}
            onClick={() => chot(true)}
            className={NUT_PHU}
          >
            Trả về để sửa
          </button>
        </div>

        <p className="text-sm text-muted-foreground">
          {/* Nói rõ khác biệt: một đường đóng sổ, một đường mở lại cho người học. */}
          Chốt điểm là đóng lượt này. Trả về để sửa thì điểm từng tiêu chí vẫn được
          ghi lại, và người học nộp lại được.
        </p>
      </div>
    </div>
  );
}
