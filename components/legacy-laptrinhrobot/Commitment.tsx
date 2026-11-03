"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { commitments as staticCommitments, type Commitment as CommitmentType } from "./_data/commitments";
import { SATA_ROBO_PHONE } from "@/lib/locations";
import {
  BadgeDollarSign,
  ChevronLeft,
  ChevronRight,
  FileText,
  Plane,
  Presentation,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

const iconMap: Record<string, LucideIcon> = { BadgeDollarSign, FileText, Plane, Presentation, ShieldCheck, Users };

const toneClasses = [
  "bg-orange-50 text-primary-orange border-orange-200",
  "bg-purple-50 text-primary-purple border-purple-200",
  "bg-green-50 text-success border-green-200",
];

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
        <div
          className="flex transition-transform duration-300 ease-in-out"
          style={{ transform: `translateX(-${idx * 100}%)` }}
        >
          {items.map((item, i) => (
            <div key={i} className="min-w-full">
              {renderItem(item, i)}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => { prev(); pauseAndResume(); }}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-text-dark shadow-sm transition hover:border-primary-purple hover:text-primary-purple active:scale-95"
          aria-label="Trước"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="flex gap-1.5">
          {items.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { setIdx(i); pauseAndResume(); }}
              className={`h-2 rounded-full transition-all duration-300 ${i === idx ? "w-6 bg-primary-purple" : "w-2 bg-gray-300 hover:bg-gray-400"}`}
              aria-label={`Slide ${i + 1}`}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => { next(); pauseAndResume(); }}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-text-dark shadow-sm transition hover:border-primary-purple hover:text-primary-purple active:scale-95"
          aria-label="Tiếp"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default function Commitment({
  commitments = staticCommitments,
}: {
  commitments?: CommitmentType[];
} = {}) {
  const renderCard = (commitment: CommitmentType, index: number) => {
    const Icon = iconMap[commitment.icon] ?? ShieldCheck;
    const tone = toneClasses[index % toneClasses.length];

    return (
      <article className="h-full rounded-2xl border border-gray-100 bg-white p-5 shadow-card sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${tone}`}>
            <Icon className="h-6 w-6" />
          </div>
          <span className="text-3xl font-black text-primary-purple/15">
            {String(commitment.id).padStart(2, "0")}
          </span>
        </div>

        <h3 className="mb-3 text-lg font-black leading-tight text-text-dark">{commitment.title}</h3>
        <p className="text-sm leading-relaxed text-text-muted">{commitment.description}</p>
      </article>
    );
  };

  return (
    <section id="commitment" className="section-padding bg-soft-cream">
      <div className="container-site">
        <div className="mb-10 text-center sm:mb-14">
          <div className="badge-purple mb-4">
            <ShieldCheck className="h-4 w-4" />
            CAM KẾT MINH BẠCH
          </div>
          <h2 className="heading-2 mb-4 text-text-dark">
            Cam kết của <span className="text-gradient-orange-purple">Sata Robo</span> với phụ huynh
          </h2>
          <p className="mx-auto max-w-2xl text-base text-text-muted sm:text-lg">
            Minh bạch về chất lượng học, kết quả đầu ra và quyền lợi của học viên.
          </p>
        </div>

        <div className="mb-10 md:hidden">
          <SlideCarousel items={commitments} renderItem={renderCard} />
        </div>

        <div className="mb-10 hidden gap-4 sm:gap-5 md:grid md:grid-cols-2 lg:grid-cols-3">
          {commitments.map((commitment, index) => (
            <div key={commitment.id} className="h-full transition hover:-translate-y-1 hover:shadow-card-hover">
              {renderCard(commitment, index)}
            </div>
          ))}
        </div>

        <div className="mx-auto max-w-3xl rounded-2xl border-2 border-primary-purple/20 bg-white p-6 text-center shadow-md sm:p-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-green-50 px-4 py-2 text-sm font-bold text-success">
            <ShieldCheck className="h-4 w-4" />
            Cam kết rõ ràng trước khi phụ huynh ra quyết định
          </div>
          <h3 className="mb-2 text-lg font-black text-text-dark sm:text-xl">Lớp nhỏ, học cụ rõ ràng, tiến độ minh bạch.</h3>
          <p className="mb-5 text-sm text-text-muted sm:text-base">
            Sata Robo ưu tiên sự minh bạch: quyền lợi học viên, các mốc thuyết trình và điều kiện cam kết đều được nói rõ ngay từ đầu.
          </p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <a
              href="#registration-form"
              className="btn-primary cta-pulse cta-shine"
              onClick={(event) => {
                event.preventDefault();
                document.getElementById("registration-form")?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              Đặt buổi học thử 1-1 miễn phí
            </a>
            <a href={SATA_ROBO_PHONE.zalo} target="_blank" rel="noopener noreferrer" className="btn-outline">
              Hỏi qua Zalo
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
