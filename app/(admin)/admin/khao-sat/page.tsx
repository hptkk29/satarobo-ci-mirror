import Link from "next/link";
import { redirect } from "next/navigation";
import { Gauge, ClipboardList, ArrowRight } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { computeNps } from "@/lib/survey/nps";
import { SurveyAdmin } from "./_components/survey-admin";

export const metadata = { title: "Khảo sát / NPS | Admin" };
export const dynamic = "force-dynamic";

export default async function SurveyPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("parent-feedback:view"))) redirect("/dashboard");

  // Cách ly cơ sở: Survey/SurveyResponse ∈ SCOPED_MODELS. Survey có record centerId=null
  // hợp lệ (khảo sát dùng chung toàn hệ thống) — trước đây phải scope THỦ CÔNG "null OR
  // visible" vì sdb inject `centerId IN` sẽ ẩn nhầm. Từ #03 Pha B, NULL_IS_GLOBAL_MODELS
  // đã dạy scopedDb đúng semantics đó → dùng sdb thẳng, bỏ scope tay.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const [centers, surveys, responses] = await Promise.all([
    sdb.center.findMany({ where: { isActive: true }, orderBy: { displayOrder: "asc" }, select: { id: true, name: true } }),
    sdb.survey.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, title: true, milestone: true, isActive: true, _count: { select: { responses: true } } },
    }),
    sdb.surveyResponse.findMany({
      where: { npsScore: { not: null } },
      select: { npsScore: true, centerId: true, surveyId: true },
      take: 5000,
    }),
  ]);

  // P1-h — NPS theo TỪNG khảo sát (để admin thấy "ra điểm" ngay ở danh sách).
  const bySurvey = new Map<string, number[]>();
  for (const r of responses) {
    const arr = bySurvey.get(r.surveyId) ?? [];
    arr.push(r.npsScore as number);
    bySurvey.set(r.surveyId, arr);
  }

  const overall = computeNps(responses.map((r) => r.npsScore));
  const centerName = new Map(centers.map((c) => [c.id, c.name]));
  const byCenter = new Map<string, number[]>();
  for (const r of responses) {
    const k = r.centerId ?? "—";
    const arr = byCenter.get(k) ?? [];
    arr.push(r.npsScore as number);
    byCenter.set(k, arr);
  }

  return (
    <div className="max-w-4xl p-6">
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <Gauge className="h-6 w-6 text-primary" /> Khảo sát / NPS
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Chỉ số NPS làm cơ sở KPI cho bộ phận CSKH.</p>
      </div>

      {/* FL4-03 — Hợp nhất khảo sát trung tâm về engine EvalForm (CENTER_SURVEY, 4 loại
          câu hỏi). Approach (a): KHÔNG xây form-builder mới ở đây — trỏ admin sang
          /admin/evaluations (đã có Form builder + đợt + kết quả). NPS dưới đây là bản
          cũ (deprecate 2-phase), vẫn xem được. */}
      <Link
        href="/evaluations"
        className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-primary-soft bg-primary-soft p-4 transition-colors hover:bg-primary-soft-hover"
      >
        <div className="flex items-start gap-3">
          <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-semibold text-foreground">
              Khảo sát trung tâm 4 loại câu hỏi (mới)
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Tạo khảo sát cơ sở bằng Form builder (chấm sao / chọn 1 / chọn nhiều / tự luận) và mở
              đợt cho phụ huynh tại <span className="font-medium">Đánh giá &amp; Khảo sát</span>. NPS
              bên dưới là bản cũ, đang được thay dần.
            </p>
          </div>
        </div>
        <ArrowRight className="h-5 w-5 shrink-0 text-primary" />
      </Link>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="NPS tổng" value={overall.nps} tone={overall.nps >= 50 ? "ok" : overall.nps >= 0 ? "warn" : "bad"} />
        <Stat label="Promoter" value={overall.promoters} />
        <Stat label="Passive" value={overall.passives} />
        <Stat label="Detractor" value={overall.detractors} />
      </div>

      {byCenter.size > 0 && (
        <section className="mb-4 rounded-xl border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">NPS theo cơ sở</h2>
          <ul className="divide-y divide-border">
            {[...byCenter.entries()].map(([cid, scores]) => {
              const r = computeNps(scores);
              return (
                <li key={cid} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-foreground">{cid === "—" ? "Chưa gắn cơ sở" : centerName.get(cid) ?? cid}</span>
                  <span className="font-bold tabular-nums text-primary">{r.nps} <span className="text-xs font-normal text-muted-foreground">({r.total} phản hồi)</span></span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <SurveyAdmin
        centers={centers}
        surveys={surveys.map((s) => ({
          id: s.id,
          title: s.title,
          milestone: s.milestone,
          isActive: s.isActive,
          responses: s._count.responses,
          nps: bySurvey.has(s.id) ? computeNps(bySurvey.get(s.id)!).nps : null,
        }))}
      />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "bad" }) {
  const cls = tone === "ok" ? "text-state-success-ink" : tone === "bad" ? "text-state-danger-ink" : tone === "warn" ? "text-state-warning-ink" : "text-primary";
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className={`text-2xl font-bold tabular-nums ${cls}`}>{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
