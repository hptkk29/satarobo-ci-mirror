import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Star, EyeOff } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { passesScope, scopedDb } from "@/lib/db-scope";
import { getRound } from "@/lib/eval/rounds";
import { aggregateRound, getRoundDetail, type RoundAggregate } from "@/lib/eval/aggregate";
import { parseOptions } from "@/lib/eval/forms";

export const metadata = { title: "Kết quả đợt | Admin" };
export const dynamic = "force-dynamic";

export default async function RoundResultsPage({ params }: { params: Promise<{ roundId: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const canDetail = await checkPermission("evaluations:view-detail");
  const canAggregate = await checkPermission("evaluations:view-aggregate");
  // AC4 — không quyền → không thấy gì.
  if (!canDetail && !canAggregate) redirect("/dashboard");

  const { roundId } = await params;
  const round = await getRound(roundId);
  if (!round) notFound();

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  // Cách ly cơ sở cho MỌI người xem (A1-LOW 10/07 — trước đây chỉ áp canDetail:
  // GV view-aggregate cầm roundId CENTER_SURVEY cơ sở khác vẫn đọc được tổng hợp
  // góp ý TEXTBOX nguyên văn). Vá 24/07: bỏ bypass isHoLevel trần → passesScope
  // per-model — role HO không có evaluations:* scope ALL (Toại TRAINING@HO) hết xem
  // kết quả đợt CS2; đợt CS1 + SYSTEM (centerId=null, đúng semantics NULL_IS_GLOBAL
  // cho ĐỌC) vẫn xem như cũ. SUPER_ADMIN / role HO có quyền không đổi.
  if (!passesScope("EvaluationRound", { centerId: round.centerId }, actor)) {
    redirect("/evaluations");
  }

  // GV chỉ-tổng-hợp + đợt TEACHER_EVAL → tổng hợp lọc theo CHÍNH MÌNH (AC4).
  const teacherFilter =
    !canDetail && round.scope === "TEACHER_EVAL" ? session.user.id : undefined;

  const aggregate = await aggregateRound(roundId, teacherFilter ? { teacherId: teacherFilter } : undefined);
  const qTypeMap = new Map(aggregate.questions.map((q) => [q.questionId, q.type] as const));

  // Chi tiết (chỉ view-detail) — kèm danh tính.
  let detail: Awaited<ReturnType<typeof getRoundDetail>> = [];
  let nameMap = new Map<string, string>();
  if (canDetail) {
    detail = await getRoundDetail(roundId);
    const studentIds = [...new Set(detail.map((d) => d.studentId).filter((x): x is string => !!x))];
    const teacherIds = [...new Set(detail.map((d) => d.teacherId).filter((x): x is string => !!x))];
    const parentIds = [...new Set(detail.map((d) => d.parentUserId).filter((x): x is string => !!x))];
    const [students, users] = await Promise.all([
      // Student ∈ SCOPED_MODELS → sdb tự inject centerId: tên HV cơ sở khác (đợt
      // TEACHER_EVAL toàn hệ thống, centerId=null bỏ qua gate trên) sẽ không lộ.
      sdb.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, name: true } }),
      sdb.user.findMany({ where: { id: { in: [...teacherIds, ...parentIds] } }, select: { id: true, name: true } }),
    ]);
    nameMap = new Map([
      ...students.map((s) => [s.id, s.name] as const),
      ...users.map((u) => [u.id, u.name ?? "—"] as const),
    ]);
  }

  return (
    <div className="max-w-3xl space-y-5 p-6">
      <Link href="/evaluations" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Về danh sách
      </Link>

      <div>
        <h1 className="text-xl font-bold text-foreground">{round.name}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {round.form.title} · {round.scope === "TEACHER_EVAL" ? "Đánh giá GV" : "Khảo sát cơ sở"} ·{" "}
          {aggregate.responseCount} phản hồi
        </p>
        {!canDetail && (
          <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <EyeOff className="h-3.5 w-3.5" /> Chế độ tổng hợp ẩn danh (không hiển thị danh tính học viên)
          </p>
        )}
      </div>

      <AggregateView aggregate={aggregate} />

      {canDetail && detail.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">Chi tiết phản hồi</h2>
          <div className="space-y-2">
            {detail.map((d) => (
              <div key={d.id} className="rounded-lg border border-border bg-card p-3 text-sm">
                <p className="text-xs text-muted-foreground">
                  {new Date(d.submittedAt).toLocaleString("vi-VN")}
                  {d.teacherId && ` · GV: ${nameMap.get(d.teacherId) ?? "—"}`}
                  {d.studentId && ` · HV: ${nameMap.get(d.studentId) ?? "—"}`}
                  {d.parentUserId && ` · PH: ${nameMap.get(d.parentUserId) ?? "—"}`}
                </p>
                <ul className="mt-1 space-y-0.5 text-foreground">
                  {d.answers.map((a, i) => {
                    const isPhoto = qTypeMap.get(a.questionId) === "PHOTO";
                    const opts = parseOptions(a.valueOptions);
                    return (
                      <li key={i}>
                        {a.valueNumber != null && `⭐ ${a.valueNumber}/5`}
                        {opts.length > 0 &&
                          (isPhoto ? (
                            <span className="mt-1 flex flex-wrap gap-1.5">
                              {opts.map((u) => (
                                <a key={u} href={u} target="_blank" rel="noopener noreferrer">
                                  <img src={u} alt="Ảnh" className="h-14 w-14 rounded border border-border object-cover" />
                                </a>
                              ))}
                            </span>
                          ) : (
                            opts.join(", ")
                          ))}
                        {a.valueText && `“${a.valueText}”`}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function AggregateView({ aggregate }: { aggregate: RoundAggregate }) {
  if (aggregate.responseCount === 0) {
    return <p className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">Chưa có phản hồi.</p>;
  }
  // Gom câu hỏi theo nhóm tiêu chí (groupLabel) như phiếu mẫu; null = không nhóm.
  const groupOrder: (string | null)[] = [];
  const grouped = new Map<string | null, RoundAggregate["questions"]>();
  for (const q of aggregate.questions) {
    const key = q.groupLabel ?? null;
    if (!grouped.has(key)) {
      grouped.set(key, []);
      groupOrder.push(key);
    }
    grouped.get(key)!.push(q);
  }
  return (
    <div className="space-y-5">
      {groupOrder.map((label, gi) => (
        <div key={gi} className="space-y-3">
          {label && (
            <h3 className="text-xs font-bold uppercase tracking-wider text-primary">{label}</h3>
          )}
          {(grouped.get(label) ?? []).map((q) => (
            <QuestionAggregateCard key={q.questionId} q={q} />
          ))}
        </div>
      ))}
    </div>
  );
}

function QuestionAggregateCard({ q }: { q: RoundAggregate["questions"][number] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
          <p className="font-medium text-foreground">{q.label}</p>
          {q.type === "STAR_RATING" && (
            <div className="mt-2 text-sm text-foreground">
              <span className="inline-flex items-center gap-1 text-lg font-bold text-state-warning-ink">
                <Star className="h-5 w-5 fill-state-warning-ink" /> {q.avg ?? "—"}
              </span>
              <span className="ml-2 text-xs text-muted-foreground">({q.count} lượt)</span>
              <div className="mt-1 space-y-0.5">
                {([5, 4, 3, 2, 1] as const).map((s) => (
                  <div key={s} className="flex items-center gap-2 text-xs">
                    <span className="w-6 text-muted-foreground">{s}★</span>
                    <span className="tabular-nums text-muted-foreground">{q.distribution[s]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(q.type === "RADIO" || q.type === "CHECKBOX") && (
            <ul className="mt-2 space-y-1 text-sm text-foreground">
              {q.optionCounts.map((o) => (
                <li key={o.option} className="flex justify-between">
                  <span>{o.option}</span>
                  <span className="font-semibold tabular-nums text-primary">{o.count}</span>
                </li>
              ))}
            </ul>
          )}
          {q.type === "TEXTBOX" && (
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {q.texts.length === 0 ? (
                <li className="text-muted-foreground">Chưa có ý kiến.</li>
              ) : (
                q.texts.map((t, i) => <li key={i} className="rounded bg-muted px-2 py-1">“{t}”</li>)
              )}
            </ul>
          )}
          {q.type === "PHOTO" && (
            q.photos.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Chưa có ảnh.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {q.photos.map((u) => (
                  <a key={u} href={u} target="_blank" rel="noopener noreferrer">
                    <img src={u} alt="Ảnh" className="h-16 w-16 rounded border border-border object-cover" />
                  </a>
                ))}
              </div>
            )
          )}
    </div>
  );
}
