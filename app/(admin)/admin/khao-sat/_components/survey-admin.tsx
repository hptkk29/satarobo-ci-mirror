"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createSurvey, toggleSurvey } from "../_actions";

const MILESTONE_LABEL: Record<string, string> = {
  AFTER_TRIAL: "Sau học thử",
  AFTER_3_SESSIONS: "Sau 3 buổi",
  MID_COURSE: "Giữa khoá",
  END_COURSE: "Cuối khoá",
  AFTER_COMPLAINT: "Sau khiếu nại",
  GENERAL: "Chung",
};

type SurveyRow = { id: string; title: string; milestone: string; isActive: boolean; responses: number; nps: number | null };

const DEFAULT_NPS_Q = "Anh/chị có sẵn sàng giới thiệu Sata Robo cho phụ huynh khác?";

export function SurveyAdmin({
  centers,
  surveys,
}: {
  centers: { id: string; name: string }[];
  surveys: SurveyRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [milestone, setMilestone] = useState("GENERAL");
  const [centerId, setCenterId] = useState("");
  const [questionText, setQuestionText] = useState(DEFAULT_NPS_Q);

  const inputCls = "w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none";

  function submit() {
    startTransition(async () => {
      const res = await createSurvey({ title, milestone, centerId, questionText });
      if (res.ok) { toast.success("Đã tạo khảo sát"); setTitle(""); setQuestionText(DEFAULT_NPS_Q); router.refresh(); }
      else toast.error(res.error ?? "Lỗi");
    });
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Tạo khảo sát (NPS) <span className="ml-1 rounded bg-state-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-state-warning-ink">bản cũ</span>
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Khảo sát NPS 1 câu (0–10). Khảo sát trung tâm nhiều loại câu hỏi: dùng Form builder ở “Đánh giá &amp; Khảo sát”.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tiêu đề khảo sát" className={`${inputCls} sm:col-span-3`} />
          <label className="sm:col-span-3 block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Câu hỏi NPS (thang 0-10)</span>
            <textarea value={questionText} onChange={(e) => setQuestionText(e.target.value)} rows={2} className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Mốc gửi</span>
            <select value={milestone} onChange={(e) => setMilestone(e.target.value)} className={inputCls}>
              {Object.entries(MILESTONE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Đối tượng (cơ sở)</span>
            <select value={centerId} onChange={(e) => setCenterId(e.target.value)} className={inputCls}>
              <option value="">Mọi cơ sở</option>
              {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <div className="flex items-end">
            <button type="button" onClick={submit} disabled={pending || !title.trim()}
              className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
              {pending ? "Đang tạo…" : "Tạo khảo sát"}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">Khảo sát</h2>
        {surveys.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có khảo sát.</p>
        ) : (
          <ul className="divide-y divide-border">
            {surveys.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">{s.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {MILESTONE_LABEL[s.milestone]} · {s.responses} phản hồi
                    {s.nps !== null ? <span className="ml-1 font-semibold text-primary">· NPS {s.nps}</span> : null}
                  </p>
                </div>
                <button type="button" disabled={pending}
                  onClick={() => startTransition(async () => { await toggleSurvey(s.id); router.refresh(); })}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.isActive ? "bg-state-success-soft text-state-success-ink" : "bg-muted text-muted-foreground"}`}>
                  {s.isActive ? "Đang chạy" : "Tạm dừng"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
