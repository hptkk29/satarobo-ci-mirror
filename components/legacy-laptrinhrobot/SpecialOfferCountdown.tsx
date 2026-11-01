"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import useCountdown from "./_hooks/useCountdown";
import { formatDeadline } from "./_utils/deadlines";
import { PROGRAM_END_LABEL } from "@/lib/uu-dai";
import {
  promotions as staticPromotions,
  type PrimaryPromotion,
  type SecondaryPromotion,
  type Promotions,
} from "./_data/promotions";
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CreditCard,
  Flame,
  Gift,
  Sparkles,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";

const iconMap: Record<string, LucideIcon> = { CreditCard, Flame, Gift, Sparkles, Trophy, Users };

interface SlideCarouselProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
}

function SlideCarousel<T>({ items, renderItem }: SlideCarouselProps<T>) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchX = useRef<number | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const total = items.length;

  const prev = () => setIdx((i) => (i - 1 + total) % total);
  const next = () => setIdx((i) => (i + 1) % total);

  const pauseAndResume = () => {
    setPaused(true);
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => setPaused(false), 5000);
  };

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % total), 4000);
    return () => clearInterval(id);
  }, [paused, total]);

  useEffect(
    () => () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    },
    [],
  );

  return (
    <div>
      <div
        className="overflow-hidden"
        onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (touchX.current === null) return;
          const delta = touchX.current - e.changedTouches[0].clientX;
          if (Math.abs(delta) > 40) {
            if (delta > 0) next();
            else prev();
            pauseAndResume();
          }
          touchX.current = null;
        }}
      >
        <div className="flex transition-transform duration-300 ease-in-out" style={{ transform: `translateX(-${idx * 100}%)` }}>
          {items.map((item, i) => (
            <div key={i} className="min-w-full">{renderItem(item, i)}</div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-4">
        <button type="button" onClick={() => { prev(); pauseAndResume(); }} className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-text-dark shadow-sm transition hover:border-primary-orange hover:text-primary-orange active:scale-95" aria-label="Trước">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex gap-1.5">
          {items.map((_, i) => (
            <button key={i} type="button" onClick={() => { setIdx(i); pauseAndResume(); }} className={`h-2 rounded-full transition-all duration-300 ${i === idx ? "w-6 bg-primary-orange" : "w-2 bg-gray-300 hover:bg-gray-400"}`} aria-label={`Slide ${i + 1}`} />
          ))}
        </div>
        <button type="button" onClick={() => { next(); pauseAndResume(); }} className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-text-dark shadow-sm transition hover:border-primary-orange hover:text-primary-orange active:scale-95" aria-label="Tiếp">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

type UnifiedPromo =
  | (PrimaryPromotion & { _type: "primary" })
  | (SecondaryPromotion & { _type: "secondary" });

export default function SpecialOfferCountdown({
  promotions = staticPromotions,
}: {
  promotions?: Promotions;
}) {
  const { deadline, timeLeft } = useCountdown();
  const pad = (n: number) => String(n).padStart(2, "0");

  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const countdownItems = [
    { label: "Ngày", value: timeLeft.days },
    { label: "Giờ", value: timeLeft.hours },
    { label: "Phút", value: timeLeft.minutes },
    { label: "Giây", value: timeLeft.seconds },
  ];

  const allPromos: UnifiedPromo[] = [
    ...promotions.primary.map((p) => ({ ...p, _type: "primary" as const })),
    ...promotions.secondary.map((p) => ({ ...p, _type: "secondary" as const })),
  ];

  const renderPrimaryCard = (promo: PrimaryPromotion) => {
    const Icon = iconMap[promo.icon] ?? Flame;
    return (
      <article className={`flex h-full flex-col rounded-3xl border bg-white p-5 shadow-card sm:p-6 ${promo.featured ? "border-primary-orange/40 bg-gradient-to-br from-white via-white to-soft-cream" : "border-gray-100"}`}>
        <div className="mb-4 flex items-start gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border border-primary-orange/20 bg-soft-cream">
            <Icon className="h-6 w-6 text-primary-orange" />
          </div>
          <div>
            <h3 className="text-lg font-black text-text-dark">{promo.title}</h3>
            <div className="mt-1 text-3xl font-black leading-tight text-primary-orange">{promo.highlight}</div>
          </div>
        </div>
        <p className="mb-4 text-sm leading-relaxed text-text-muted">{promo.description}</p>
        <ul className="mb-5 space-y-2">
          {promo.details.slice(0, 3).map((detail) => (
            <li key={detail} className="grid grid-cols-[1.25rem_1fr] gap-2 text-xs leading-relaxed text-text-dark">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />
              <span>{detail}</span>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => scrollTo(promo.target)} className="mt-auto inline-flex items-center justify-center gap-2 rounded-xl border-2 border-primary-orange/30 bg-white px-4 py-2.5 text-sm font-black text-primary-orange transition hover:bg-primary-orange hover:text-white">
          {promo.cta}
          <ArrowRight className="h-4 w-4" />
        </button>
      </article>
    );
  };

  const renderSecondaryCard = (promo: SecondaryPromotion) => {
    const Icon = iconMap[promo.icon] ?? Gift;
    return (
      <article className="flex h-full flex-col rounded-3xl border border-gray-100 bg-white p-5 shadow-card">
        <div className="mb-4 flex items-start gap-4">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-primary-orange/20 bg-soft-cream">
            <Icon className="h-5 w-5 text-primary-orange" />
          </div>
          <div>
            <h3 className="text-base font-black text-text-dark">{promo.title}</h3>
            <div className="mt-1 text-xl font-black leading-tight text-primary-orange">{promo.highlight}</div>
          </div>
        </div>
        <p className="mb-3 text-sm leading-relaxed text-text-muted">{promo.description}</p>
        <div className="mt-auto rounded-2xl border border-gray-100 bg-gray-50 p-3">
          <p className="text-xs leading-relaxed text-text-muted">{promo.condition}</p>
          <p className="mt-2 text-xs font-semibold leading-relaxed text-primary-orange">{promo.note}</p>
        </div>
      </article>
    );
  };

  const renderCard = (promo: UnifiedPromo) =>
    promo._type === "primary" ? renderPrimaryCard(promo) : renderSecondaryCard(promo);

  return (
    <section id="special-offer" className="relative overflow-hidden bg-gradient-to-br from-soft-cream via-white to-soft-purple/50 py-16">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary-orange/30 to-transparent" />

      <div className="container-site relative">
        <div className="mx-auto mb-7 max-w-4xl text-center sm:mb-9">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary-orange/25 bg-white px-4 py-2 text-primary-orange shadow-card">
            <Flame className="h-4 w-4 animate-pulse" />
            <span className="text-xs font-black uppercase tracking-wider sm:text-sm">
              Ưu đãi khai giảng — áp dụng đến hết {PROGRAM_END_LABEL}
            </span>
          </div>
          <h2 className="heading-2 mb-4 text-text-dark">Ưu đãi khai giảng lớp mới</h2>
          <p className="mx-auto max-w-2xl text-sm leading-relaxed text-text-muted sm:text-base">
            Đăng ký sớm để giữ học phí tốt cho Sata1–Sata7. Sata8 là gói riêng, giá cố định.
          </p>
        </div>

        <div className="mx-auto mb-7 grid max-w-xl grid-cols-4 gap-2 sm:mb-9 sm:gap-3">
          {countdownItems.map((item) => (
            <div key={item.label} className="rounded-2xl border border-primary-purple/10 bg-white/90 p-3 text-center shadow-card sm:p-4">
              <div className="font-black tabular-nums leading-none text-primary-purple" style={{ fontSize: "clamp(1.5rem, 5vw, 2.25rem)" }}>{pad(item.value)}</div>
              <div className="mt-1.5 text-[10px] font-bold uppercase tracking-wider text-text-muted sm:text-xs">{item.label}</div>
            </div>
          ))}
        </div>

        <p className="mx-auto mb-7 max-w-xl text-center text-[11px] font-semibold text-text-muted sm:mb-9 sm:text-xs">
          Đếm ngược đến buổi khai giảng gần nhất — {formatDeadline(deadline)}
        </p>

        <div className="mb-7 md:hidden">
          <SlideCarousel items={allPromos} renderItem={renderCard} />
        </div>

        <div className="hidden md:block">
          <div className="mb-5 grid gap-4 sm:mb-6 md:grid-cols-2 lg:grid-cols-3">
            {promotions.primary.map((promo) => <div key={promo.id} className="h-full">{renderPrimaryCard(promo)}</div>)}
          </div>
          <div className="mb-7 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {promotions.secondary.map((promo) => <div key={promo.id} className="h-full">{renderSecondaryCard(promo)}</div>)}
          </div>
        </div>

        <div className="mb-7 rounded-3xl border border-primary-orange/20 bg-soft-cream p-4 shadow-card sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-primary-orange/20 bg-white">
              <Clock3 className="h-5 w-5 text-primary-orange" />
            </div>
            <p className="text-sm leading-relaxed text-text-dark">
              <strong>Lưu ý:</strong> Các ưu đãi trên không áp dụng cho Sata8 — Vé Vàng Chung Kết.
              Sata8 là gói cam kết độc lập, giá cố định và có chính sách
              hoàn tiền 100% theo điều kiện cam kết.
            </p>
          </div>
        </div>

        <div className="flex flex-col justify-center gap-3 sm:flex-row">
          <button onClick={() => scrollTo("registration-form")} className="btn-primary cta-pulse cta-shine w-full sm:w-auto">
            Đăng ký nhận ưu đãi
            <ArrowRight className="h-5 w-5" />
          </button>
          <button onClick={() => scrollTo("roadmap")} className="btn-outline w-full sm:w-auto">
            Tư vấn khóa phù hợp
          </button>
        </div>
      </div>
    </section>
  );
}
