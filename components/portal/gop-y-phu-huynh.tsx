"use client";

import { NoiDungTrong } from "@/components/portal/sticker";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SurveyCard, SurveyQuestionItem } from "@/lib/portal/surveys";
import type { CenterSurveyRoundView } from "@/lib/eval/center-survey";
import { submitSurveyResponse } from "@/app/(portal)/portal/khao-sat/_actions";
import { CenterSurveyForm } from "@/app/(portal)/portal/khao-sat/center-survey";
import { createParentFeedback } from "@/app/(portal)/portal/danh-gia/actions";
import { CHU_DE_GOP_Y, noiDungGopY } from "@/lib/portal/gop-y-thuan";

// Cổng phụ huynh — "Góp ý cho trung tâm", dựng theo artifact Gop-y.dc.html.
// Khảo sát: câu hỏi THẬT của từng khảo sát (NPS 0–10 / chấm sao / ý kiến), gửi qua `submitSurveyResponse`. Góp ý bất kỳ lúc nào: gửi qua
// `createParentFeedback` (bảng ParentFeedback, có 1–5 sao bắt buộc nên form có thêm hàng "Mức hài lòng chung"). KHÔNG vẽ ô "Gửi ẩn danh":
// góp ý lưu kèm tên phụ huynh, chưa có chế độ ẩn danh.

const CARD = "rounded-[20px] border border-border bg-card";
const O_NHAP = "w-full rounded-[10px] border border-border bg-card px-3 text-[15px] text-[var(--sr-ink)] outline-none focus:border-[var(--sr-purple)]";

export type GopYDaGui = { id: string; rating: number; content: string; ngay: string; traLoi: string | null };

function Sao({ gia, onChon, nhan }: { gia: number; onChon: (n: number) => void; nhan: string }) {
  return (
    <span role="radiogroup" aria-label={nhan} className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={gia === n}
          aria-label={`${nhan}: ${n} sao`}
          onClick={() => onChon(n)}
          className="flex size-9 items-center justify-center p-0"
        >
          <Star className={cn("size-6", n <= gia ? "fill-[var(--sr-orange)] text-[var(--sr-orange)]" : "text-[var(--sr-dash)]")} />
        </button>
      ))}
    </span>
  );
}

function KhaoSat({ c }: { c: SurveyCard }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tl, setTl] = useState<Record<string, number | string>>({});
  const [diem, setDiem] = useState<number | null>(null);
  const [ghiChu, setGhiChu] = useState("");
  const coCauHoi = c.questions.length > 0;
  const nps = c.questions.filter((q) => q.type === "NPS");
  const sao = c.questions.filter((q) => q.type === "RATING");
  const chu = c.questions.filter((q) => q.type === "TEXT");
  const dat = (id: string) => (typeof tl[id] === "number" ? (tl[id] as number) : null);
  // Số thứ tự cố định theo THỨ TỰ HIỂN THỊ (NPS → chấm sao → ý kiến), tính trước khi dựng JSX.
  const soNps = coCauHoi ? nps.length : 1;
  const soSaoMuc = sao.length > 0 ? 1 : 0;

  function gui() {
    if (coCauHoi) {
      const thieu = c.questions.find((q) => q.type !== "TEXT" && typeof tl[q.id] !== "number");
      if (thieu) return void toast.error(`Vui lòng trả lời: ${thieu.text}`);
    } else if (diem == null) return void toast.error("Vui lòng chọn điểm 0–10");
    startTransition(async () => {
      const res = await submitSurveyResponse(
        coCauHoi
          ? {
              surveyId: c.id,
              comment: ghiChu,
              answers: c.questions.filter((q) => tl[q.id] !== undefined && tl[q.id] !== "").map((q) => ({ questionId: q.id, value: tl[q.id] as number | string })),
            }
          : { surveyId: c.id, npsScore: diem, comment: ghiChu },
      );
      if (res.ok) {
        toast.success("Cảm ơn ba mẹ đã gửi khảo sát!");
        router.refresh();
      } else toast.error(res.error ?? "Lỗi gửi khảo sát");
    });
  }

  const nutNps = (q: SurveyQuestionItem | null, stt: number) => {
    const gia = q ? dat(q.id) : diem;
    return (

      <fieldset key={q ? q.id : "nps"} className="m-0 flex flex-col gap-2.5 border-0 p-0">
        <legend className="pb-2.5 text-[15px] font-bold">
          {stt}. {q ? q.text : "Ba mẹ sẵn lòng giới thiệu Sata Robo cho người quen ở mức nào?"}
        </legend>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-1.5">
          {Array.from({ length: 11 }, (_, n) => (
            <button
              key={n}
              type="button"
              aria-pressed={gia === n}
              onClick={() => (q ? setTl((a) => ({ ...a, [q.id]: n })) : setDiem(n))}
              className={cn("h-11 rounded-[10px] text-[15px] font-bold", gia === n ? "bg-[var(--sr-purple)] text-white" : "border border-border bg-card")}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex justify-between text-xs text-[var(--sr-ink-muted)]"><span>Không giới thiệu</span><span>Chắc chắn giới thiệu</span></div>
      </fieldset>
    );
  };

  return (
    <article className={cn(CARD, "flex min-w-0 flex-col gap-[22px] p-5 min-[560px]:p-6")}>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--sr-orange-text)]">KHẢO SÁT · {c.minutes} PHÚT · ẨN DANH</div>
          <h2 className="text-[22px] font-bold leading-7">{c.title}</h2>
          {c.description ? <p className="text-sm text-[var(--sr-ink-muted)]">{c.description}</p> : null}
        </div>
      </div>

      {coCauHoi ? nps.map((q, i) => nutNps(q, i + 1)) : nutNps(null, 1)}

      {sao.length > 0 ? (
        <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
          <legend className="pb-2.5 text-[15px] font-bold">{soNps + 1}. Chấm điểm từng mặt</legend>
          {sao.map((q) => (
            <div key={q.id} className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl bg-background px-3.5 py-3">
              <span className="text-sm font-semibold">{q.text}</span>
              <Sao gia={dat(q.id) ?? 0} onChon={(n) => setTl((a) => ({ ...a, [q.id]: n }))} nhan={q.text} />
            </div>
          ))}
        </fieldset>
      ) : null}

      {chu.map((q, i) => (
        <label key={q.id} className="flex flex-col gap-2 text-[15px] font-bold">
          {soNps + soSaoMuc + i + 1}. {q.text}
          <textarea
            rows={4}
            maxLength={2000}
            value={typeof tl[q.id] === "string" ? (tl[q.id] as string) : ""}
            onChange={(e) => setTl((a) => ({ ...a, [q.id]: e.target.value }))}
            placeholder="Viết bao nhiêu cũng được"
            className={cn(O_NHAP, "resize-y py-3 font-normal")}
          />
        </label>
      ))}

      {!coCauHoi || chu.length === 0 ? (
        <label className="flex flex-col gap-2 text-[15px] font-bold">
          Góp ý thêm (không bắt buộc)
          <textarea rows={3} value={ghiChu} onChange={(e) => setGhiChu(e.target.value)} placeholder="Viết bao nhiêu cũng được" className={cn(O_NHAP, "resize-y py-3 font-normal")} />
        </label>
      ) : null}

      <button type="button" onClick={gui} disabled={pending} className="h-12 self-start rounded-xl bg-[var(--sr-purple)] px-[22px] text-[15px] font-bold text-white disabled:opacity-70">
        {pending ? "Đang gửi…" : "Gửi khảo sát"}
      </button>
    </article>
  );
}

function FormGopY() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [chuDe, setChuDe] = useState<string>(CHU_DE_GOP_Y[0] ?? "");
  const [noiDung, setNoiDung] = useState("");
  const [sao, setSao] = useState(0);
  return (
    <article className={cn(CARD, "flex flex-col gap-3 p-5")}>
      <h2 className="text-[17px] font-bold">Góp ý bất kỳ lúc nào</h2>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (sao === 0) return void toast.error("Vui lòng chọn mức hài lòng chung (1–5 sao)");
          startTransition(async () => {
            const r = await createParentFeedback({ rating: sao, content: noiDungGopY(chuDe, noiDung) });
            if (r.ok) {
              toast.success("Đã gửi góp ý");
              setNoiDung("");
              setSao(0);
              router.refresh();
            } else toast.error(r.error ?? "Lỗi gửi góp ý");
          });
        }}
      >
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          Về việc
          <select value={chuDe} onChange={(e) => setChuDe(e.target.value)} className={cn(O_NHAP, "h-11 text-sm font-normal")}>
            {CHU_DE_GOP_Y.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          Nội dung
          <textarea value={noiDung} onChange={(e) => setNoiDung(e.target.value)} rows={4} className={cn(O_NHAP, "resize-y py-2.5 text-sm font-normal")} />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] font-semibold">
          <span>Mức hài lòng chung</span>
          <Sao gia={sao} onChon={setSao} nhan="Mức hài lòng chung" />
        </div>
        <button type="submit" disabled={pending} className="h-11 rounded-xl bg-[var(--sr-orange)] text-sm font-bold text-[var(--sr-on-orange)] disabled:opacity-70">
          {pending ? "Đang gửi…" : "Gửi góp ý"}
        </button>
      </form>
    </article>
  );
}

export function GopYPhuHuynh({
  cards,
  centerRounds,
  gopY,
}: {
  cards: SurveyCard[];
  centerRounds: CenterSurveyRoundView[];
  gopY: GopYDaGui[];
}) {
  const chua = cards.filter((c) => !c.done);
  const xong = cards.filter((c) => c.done);
  return (
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-display text-[28px] font-extrabold leading-[34px] min-[560px]:text-[32px] min-[560px]:leading-[38px]">Góp ý cho trung tâm</h1>
        <div className="text-sm text-[var(--sr-ink-muted)]">Góp ý theo từng mục: ba mẹ chọn mục muốn góp ý (cơ sở vật chất, giáo viên, chương trình…) và trả lời khảo sát ngắn, ẩn danh của mục đó.</div>
      </header>

      <div className="flex flex-wrap items-start gap-5">
        <section className="flex min-w-0 flex-[999_1_520px] flex-col gap-5">
          {centerRounds.map((r) => (
            <div key={r.roundId} className={cn(CARD, "p-5 min-[560px]:p-6")}>
              {/* Đợt khảo sát cơ sở (FL4-03): giữ nguyên form nhiều loại câu hỏi của luồng chính. */}
              <CenterSurveyForm roundId={r.roundId} title={r.title} questions={r.questions} />
            </div>
          ))}
          {chua.map((c) => (
            <KhaoSat key={c.id} c={c} />
          ))}
          {chua.length === 0 && centerRounds.length === 0 ? (
            <NoiDungTrong ten="khen" className="rounded-[20px] border-2 border-dashed border-border px-5 py-8 text-sm text-[var(--sr-ink-muted)]">
              Hiện không có khảo sát nào cần trả lời. Cảm ơn ba mẹ!
            </NoiDungTrong>
          ) : null}
          {xong.length > 0 ? (
            <div className={cn(CARD, "flex flex-col gap-2 p-5")}>
              <h2 className="text-[17px] font-bold">Khảo sát đã làm</h2>
              {xong.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{c.title}</span>
                  <span className="rounded-full bg-[var(--sr-success-bg)] px-2.5 py-[3px] text-[11px] font-bold text-[var(--sr-success)]">Đã làm</span>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          <FormGopY />
          <article className={cn(CARD, "flex flex-col gap-3 p-5")}>
            <h2 className="text-[17px] font-bold">Góp ý đã gửi</h2>
            {gopY.length === 0 ? (
              <div className="text-[13px] text-[var(--sr-ink-muted)]">Ba mẹ chưa gửi góp ý nào.</div>
            ) : (
              gopY.map((g) => (
                <div key={g.id} className="flex flex-col gap-1.5 rounded-xl bg-background p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">{g.content.length > 90 ? `${g.content.slice(0, 90)}…` : g.content}</span>
                    <span
                      className={cn(
                        "flex-none rounded-full px-2 py-0.5 text-[11px] font-bold",
                        g.traLoi ? "bg-[var(--sr-success-bg)] text-[var(--sr-success)]" : "bg-[var(--sr-tint-orange)] text-[var(--sr-ink)]",
                      )}
                    >
                      {g.traLoi ? "Đã phản hồi" : "Chờ phản hồi"}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--sr-ink-muted)]">{g.ngay} · {g.rating}/5 sao</div>
                  {g.traLoi ? <div className="text-[13px] leading-[19px]">Trung tâm: {g.traLoi}</div> : null}
                </div>
              ))
            )}
          </article>
        </aside>
      </div>
    </div>
  );
}
