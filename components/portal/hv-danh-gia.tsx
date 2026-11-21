"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { HvThe, HvTrong, NUT_CAM, NUT_TAT } from "@/components/portal/hv-ui";
import { Sticker } from "@/components/portal/sticker";
import { toSubmitAnswers, type AnswerState, type PortalQuestion } from "@/app/(portal)/portal/danh-gia-gv/_fields";
import { submitTeacherEval } from "@/app/(portal)/portal/danh-gia-gv/_actions";
import { MAT_CUOI, demCauThieu, kieuCau, nhanConThieu, nhanLuaChon, type CauTho, type TraLoi } from "@/lib/portal/hv-danh-gia-thuan";
import { XUNG_GV, XUNG_GV_HOA } from "@/lib/portal/hv-dieu-huong";

// Màn "Đánh giá thầy cô" — artifact HV-Danh-gia / M-HV-Danh-gia. Vẽ ĐÚNG các câu của đợt đánh giá thật (xem hv-danh-gia-thuan.ts)
// và gửi bằng CHÍNH hành động `submitTeacherEval` đang chạy.

type Cap = { enrollmentId: string; teacherId: string; teacherName: string; className: string; role: string };
type Dot = { roundId: string; name: string; questions: PortalQuestion[]; pairs: Cap[] };

function Mat({ i, ten, on, bam }: { i: number; ten: string; on: boolean; bam: () => void }) {
  const m = MAT_CUOI[i] ?? MAT_CUOI[2]!;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={bam}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-2xl border-2 px-1 py-3 text-foreground",
        on ? "border-[var(--sr-purple)] bg-[var(--sr-tint-purple)]" : "border-border bg-card",
      )}
    >
      <svg aria-hidden="true" width="44" height="44" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r="20" fill={m.nen} />
        <circle cx="15" cy="18" r="2.6" fill="var(--sr-ink)" />
        <circle cx="29" cy="18" r="2.6" fill="var(--sr-ink)" />
        <path d={m.mieng} stroke="var(--sr-ink)" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      </svg>
      <span className="text-[13px] font-bold leading-[17px]">{ten}</span>
    </button>
  );
}

function Sao({ gia, doi, nhan }: { gia: number; doi: (n: number) => void; nhan: string }) {
  return (
    <span role="radiogroup" aria-label={nhan} className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={n === gia}
          aria-label={`${n} sao`}
          onClick={() => doi(n)}
          className="grid size-11 place-items-center border-0 bg-transparent p-0"
        >
          <svg aria-hidden="true" width="34" height="34" viewBox="0 0 24 24" strokeWidth="1.6" strokeLinejoin="round" fill={n <= gia ? "var(--sr-orange)" : "var(--card)"} stroke={n <= gia ? "var(--sr-orange-text)" : "var(--sr-dash)"}>
            <path d="M12 2.8l2.8 6 6.5.7-4.9 4.4 1.4 6.4L12 17l-5.8 3.3 1.4-6.4L2.7 9.5l6.5-.7z" />
          </svg>
        </button>
      ))}
    </span>
  );
}

function Chip({ ten, on, bam, nhieu }: { ten: string; on: boolean; bam: () => void; nhieu: boolean }) {
  return (
    <button
      type="button"
      role={nhieu ? "checkbox" : "radio"}
      aria-checked={on}
      onClick={bam}
      className={cn(
        "h-[42px] rounded-full border px-4 text-sm font-semibold",
        on ? "border-[var(--sr-purple)] bg-[var(--sr-purple)] text-white" : "border-border bg-card text-foreground",
      )}
    >
      {on ? "✓ " : ""}
      {ten}
    </button>
  );
}

function MotPhieu({ roundId, ten, cap, questions }: { roundId: string; ten: string; cap: Cap; questions: PortalQuestion[] }) {
  const router = useRouter();
  const [dang, bat] = useTransition();
  const [tl, setTl] = useState<AnswerState>({});
  const [xong, setXong] = useState(false);
  const cau = questions as CauTho[];
  const thieu = demCauThieu(cau, tl as Record<string, TraLoi>);
  const dat = (id: string, v: TraLoi) => setTl((c) => ({ ...c, [id]: { ...c[id], ...v } }));

  if (xong) {
    return (
      <section className="flex flex-col items-center gap-3 rounded-3xl bg-[var(--sr-success-bg)] p-8 text-center">
        <Sticker ten="tim" cao={104} />
        <h2 className="m-0 font-display text-[28px] font-extrabold leading-[34px] text-[var(--sr-success)] min-[900px]:text-[32px] min-[900px]:leading-[38px]">Cảm ơn em!</h2>
        <div className="max-w-[520px] text-base leading-6">Đánh giá đã được gửi. Cảm ơn em đã nói thật lòng với {XUNG_GV}.</div>
        <Link href="/portal/hoc-sinh" className={cn(NUT_CAM, "mt-1.5 h-[46px] text-[15px]")}>
          Về trang Hôm nay
        </Link>
      </section>
    );
  }

  const gui = () => {
    if (thieu > 0) {
      toast.error("Em chọn cho đủ các câu nhé.");
      return;
    }
    bat(async () => {
      const r = await submitTeacherEval({ roundId, enrollmentId: cap.enrollmentId, teacherId: cap.teacherId, answers: toSubmitAnswers(questions, tl) });
      if (r.ok) {
        setXong(true);
        router.refresh();
      } else toast.error(r.error);
    });
  };

  // Gom các câu sao liền nhau vào MỘT thẻ (như bản thiết kế "Em cho thầy cô mấy sao?").
  const khoi: { sao: boolean; ds: PortalQuestion[] }[] = [];
  for (const q of questions) {
    const sao = kieuCau(q as CauTho) === "sao";
    const cuoi = khoi[khoi.length - 1];
    if (sao && cuoi?.sao) cuoi.ds.push(q);
    else khoi.push({ sao, ds: [q] });
  }
  let so = 0;

  return (
    <>
      <section className="flex flex-wrap items-center gap-[18px] rounded-3xl bg-[var(--sr-purple)] p-6 text-white">
        <span aria-hidden="true" className="grid size-16 shrink-0 place-items-center rounded-full bg-[var(--sr-orange)] text-[22px] font-extrabold text-[var(--sr-on-orange)]">
          {cap.teacherName.trim().split(/\s+/).slice(-2).map((w) => w[0]).join("").toUpperCase()}
        </span>
        <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-1.5">
          <div className="text-xs font-bold tracking-[0.08em] text-[var(--sr-hero-eyebrow)]">{ten.toUpperCase()}</div>
          <h1 className="m-0 break-words font-display text-[24px] font-extrabold leading-[30px] min-[900px]:text-[28px] min-[900px]:leading-[34px]">
            Em thấy học với {cap.teacherName} thế nào?
          </h1>
          <div className="text-[15px] leading-[22px] text-[var(--sr-hero-text)]">
            {cap.className} · Câu trả lời của em là <b className="text-white">bí mật</b> — {XUNG_GV} không biết ai trả lời.
          </div>
        </div>
      </section>

      {khoi.map((k, bi) => {
        if (k.sao) {
          so += 1;
          return (
            <HvThe key={bi} className="gap-4 p-6">
              <h2 className="m-0 text-xl font-bold">
                {so}. Em cho {XUNG_GV} mấy sao?
              </h2>
              {k.ds.map((q) => (
                <div key={q.id} className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border pb-3.5 last:border-b-0 last:pb-0">
                  <span className="min-w-0 flex-[1_1_240px] text-[15px] font-semibold leading-[22px]">{q.label}</span>
                  <Sao gia={tl[q.id]?.number ?? 0} doi={(n) => dat(q.id, { number: n })} nhan={q.label} />
                </div>
              ))}
            </HvThe>
          );
        }
        const q = k.ds[0]!;
        so += 1;
        const kieu = kieuCau(q as CauTho);
        const chon = tl[q.id]?.options ?? [];
        return (
          <HvThe key={bi} className="gap-3.5 p-6">
            <h2 className="m-0 text-xl font-bold">
              {so}. {q.label}
              {kieu === "chon-nhieu" && <span className="ml-1.5 text-sm font-medium text-muted-foreground">(chọn bao nhiêu cũng được)</span>}
              {!q.required && kieu !== "chon-nhieu" && <span className="ml-1.5 text-sm font-medium text-muted-foreground">(không bắt buộc)</span>}
            </h2>
            {kieu === "mat" && (
              <div role="radiogroup" aria-label={q.label} className="grid grid-cols-5 gap-2.5">
                {q.options.map((o, i) => (
                  <Mat key={o} i={i} ten={nhanLuaChon(o)} on={chon[0] === o} bam={() => dat(q.id, { options: [o] })} />
                ))}
              </div>
            )}
            {kieu === "chon-mot" && (
              <div role="radiogroup" aria-label={q.label} className="flex flex-wrap gap-2">
                {q.options.map((o) => (
                  <Chip key={o} ten={nhanLuaChon(o)} nhieu={false} on={chon[0] === o} bam={() => dat(q.id, { options: [o] })} />
                ))}
              </div>
            )}
            {kieu === "chon-nhieu" && (
              <div className="flex flex-wrap gap-2">
                {q.options.map((o) => (
                  <Chip
                    key={o}
                    ten={nhanLuaChon(o)}
                    nhieu
                    on={chon.includes(o)}
                    bam={() => dat(q.id, { options: chon.includes(o) ? chon.filter((x) => x !== o) : [...chon, o] })}
                  />
                ))}
              </div>
            )}
            {kieu === "van-ban" && (
              <textarea
                rows={3}
                value={tl[q.id]?.text ?? ""}
                onChange={(e) => dat(q.id, { text: e.target.value })}
                placeholder="Ví dụ: Em thích nhất lúc được tự lắp robot. Em muốn có thêm thời gian thử robot chạy."
                className="box-border w-full resize-y rounded-xl border border-border bg-card p-3 text-sm leading-[21px] text-foreground"
              />
            )}
          </HvThe>
        );
      })}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={gui} disabled={dang} aria-disabled={thieu > 0} className={cn(thieu > 0 ? NUT_TAT : NUT_CAM, "h-12 text-[15px]")}>
          {dang ? "Đang gửi…" : "Gửi đánh giá"}
        </button>
        <span className="text-[13px] text-muted-foreground">{nhanConThieu(thieu)}</span>
      </div>
    </>
  );
}

export function HvDanhGiaTrang({ blocks }: { blocks: Dot[] }) {
  const phieu = blocks.flatMap((b) => b.pairs.map((p) => ({ b, p })));
  if (phieu.length === 0) {
    return (
      <>
        <header className="flex flex-col gap-1.5">
          <h1 className="m-0 font-display text-[26px] font-extrabold leading-[32px] min-[900px]:text-[32px] min-[900px]:leading-[38px]">Đánh giá {XUNG_GV}</h1>
        </header>
        <HvTrong>
          Hiện chưa có đợt đánh giá nào đang mở. Có đợt mới là {XUNG_GV_HOA} báo để em vào đánh giá nhé. Cảm ơn em!
        </HvTrong>
      </>
    );
  }
  return (
    <>
      {phieu.map(({ b, p }) => (
        <div key={`${b.roundId}|${p.enrollmentId}|${p.teacherId}`} className="flex flex-col gap-4 min-[900px]:gap-[22px]">
          <MotPhieu roundId={b.roundId} ten={b.name} cap={p} questions={b.questions} />
        </div>
      ))}
    </>
  );
}
