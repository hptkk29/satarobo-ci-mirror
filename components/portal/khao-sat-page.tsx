"use client";

import { useState } from "react";
import {
  ClipboardList,
  Info,
  Clock,
  ChevronRight,
  ChevronUp,
  CircleCheck,
} from "lucide-react";
import type { SurveyCard } from "@/lib/portal/surveys";
import type { CenterSurveyRoundView } from "@/lib/eval/center-survey";
import { PageHero, HeroMetric } from "@/components/portal/page-header";
import { ChildSwitcher } from "@/components/portal/child-switcher";
import { SurveyForm } from "@/app/(portal)/portal/khao-sat/survey-form";
import { CenterSurveyForm } from "@/app/(portal)/portal/khao-sat/center-survey";

export function KhaoSatPageV2({
  kids,
  activeId,
  cards,
  todoCount,
  centerRounds = [],
}: {
  kids: { id: string; name: string }[];
  activeId: string | null;
  cards: SurveyCard[];
  todoCount: number;
  centerRounds?: CenterSurveyRoundView[];
}) {
  // Thẻ NPS đang mở form — expand tại chỗ (không có route con riêng cho khảo sát).
  const [openId, setOpenId] = useState<string | null>(null);
  const totalTodo = todoCount + centerRounds.length;
  // Cờ "Đã làm" tính theo TỪNG CON → subtitle nêu rõ con đang chọn (nhà 1 con
  // ChildSwitcher ẩn nhưng vẫn biết ngữ cảnh).
  const activeName = kids.find((k) => k.id === activeId)?.name ?? null;

  return (
    <div className="portal-v2 mx-auto w-full max-w-6xl space-y-6">
      <ChildSwitcher kids={kids} activeId={activeId} />

      <PageHero
        icon={ClipboardList}
        overline="Cổng phụ huynh"
        title="Khảo sát trung tâm"
        subtitle={`${activeName ? `Khảo sát cho ${activeName} · ` : ""}Còn ${totalTodo} khảo sát chưa làm.`}
        metric={<HeroMetric label="Chưa làm" value={String(totalTodo)} />}
      />

      <div className="flex items-start gap-3 rounded-2xl border border-info/25 bg-info/5 p-4 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-5 shrink-0 text-info" />
        <p>
          Khảo sát đánh giá <b className="text-foreground">trung tâm/cơ sở</b>{" "}
          (chất lượng giảng dạy, cơ sở vật chất, dịch vụ). Mọi câu trả lời được
          tổng hợp <b className="text-foreground">ẩn danh</b>; mỗi khảo sát chỉ
          gửi một lần cho mỗi con.
        </p>
      </div>

      {/* FL4-03 — đợt khảo sát cơ sở CENTER_SURVEY (luồng chính) vẫn hiện ở v2. */}
      {centerRounds.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
            Khảo sát cơ sở đang mở
          </h2>
          {centerRounds.map((r) => (
            <CenterSurveyForm
              key={r.roundId}
              roundId={r.roundId}
              title={r.title}
              questions={r.questions}
            />
          ))}
        </section>
      )}

      {cards.length === 0 && centerRounds.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Hiện chưa có khảo sát nào đang mở.
        </div>
      ) : (
        cards.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((c) => (
              <div
                key={c.id}
                className="flex flex-col rounded-2xl border border-border bg-card p-5"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
                    <ClipboardList className="size-5" />
                  </span>
                  {c.done ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-success/10 px-2 py-0.5 text-xs font-bold text-success">
                      <CircleCheck className="size-3.5" /> Đã làm
                    </span>
                  ) : (
                    <span className="rounded-md border border-caution/40 bg-caution/5 px-2 py-0.5 text-xs font-bold text-caution">
                      Chưa làm
                    </span>
                  )}
                </div>
                <span className="mt-4 w-fit rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                  {c.category}
                </span>
                <h3 className="mt-2 text-base font-bold text-foreground">
                  {c.title}
                </h3>
                {c.description && (
                  <p className="mt-1 flex-1 text-sm text-muted-foreground">
                    {c.description}
                  </p>
                )}
                <div className="mt-4 border-t border-border pt-3">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Clock className="size-4" /> {c.minutes} phút
                    </span>
                    {c.done ? (
                      <span className="text-sm font-bold text-muted-foreground">
                        Đã hoàn thành
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setOpenId((cur) => (cur === c.id ? null : c.id))
                        }
                        className="inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline"
                      >
                        {openId === c.id ? (
                          <>
                            Đóng lại <ChevronUp className="size-4" />
                          </>
                        ) : (
                          <>
                            Làm khảo sát <ChevronRight className="size-4" />
                          </>
                        )}
                      </button>
                    )}
                  </div>
                  {!c.done && openId === c.id && (
                    <div className="mt-3">
                      {/* Truyền câu hỏi THẬT của survey — form render đủ (không chỉ 1 câu NPS). */}
                      <SurveyForm
                        surveyId={c.id}
                        title={c.title}
                        questions={c.questions}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
