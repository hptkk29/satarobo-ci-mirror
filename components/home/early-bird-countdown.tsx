"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Flame, CalendarClock } from "lucide-react";
import { FadeIn } from "@/components/motion/fade-in";
import {
  getNextOpeningDate,
  formatVietnameseDateLong,
} from "@/lib/opening-date";
import {
  DISCOUNT_HEADLINE,
  MAX_DISCOUNT_OFFLINE,
  PROGRAM_END,
  PROGRAM_END_LABEL,
  PROGRAM_NAME,
  TOTAL_GIFT_VALUE,
} from "@/lib/uu-dai";

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
  openingDate: Date;
}

function getTimeLeft(): TimeLeft {
  const now = new Date();
  // Đếm ngược tới HẠN THẬT của chương trình ưu đãi (PROGRAM_END = 31/12/2026).
  // KHÔNG dùng getOpeningCountdownTarget: mốc đó là 00:00 Chủ nhật và tự
  // reset mỗi tuần → hạn giả tái sinh vô tận.
  const openingDate = getNextOpeningDate(now);
  const diff = PROGRAM_END.getTime() - now.getTime();
  if (diff <= 0) {
    // Hết hạn chương trình → mọi ô về 0.
    return {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      expired: true,
      openingDate,
    };
  }
  return {
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((diff / (1000 * 60)) % 60),
    seconds: Math.floor((diff / 1000) % 60),
    expired: false,
    openingDate,
  };
}

const pad = (n: number) => n.toString().padStart(2, "0");

export function EarlyBirdCountdown() {
  const [time, setTime] = useState<TimeLeft | null>(null);

  useEffect(() => {
    setTime(getTimeLeft());
    const id = window.setInterval(() => setTime(getTimeLeft()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Don't render anything until client-mounted (avoid SSR mismatch).
  if (!time) return null;

  const openingDateLabel = formatVietnameseDateLong(time.openingDate);

  return (
    <section className="relative overflow-hidden bg-gradient-to-r from-rose-500 via-orange-500 to-amber-500 py-16">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 [background-image:radial-gradient(rgba(255,255,255,0.18)_1px,transparent_1px)] [background-size:24px_24px] opacity-50"
      />
      <div className="container mx-auto px-4 max-w-5xl relative z-10">
        <FadeIn>
          <div className="grid md:grid-cols-[1fr_auto] gap-6 md:gap-10 items-center text-white">
            <div>
              <div className="inline-flex items-center gap-2 bg-white/15 backdrop-blur ring-1 ring-white/30 rounded-full px-3 py-1 mb-3">
                <Flame className="w-3.5 h-3.5" />
                <span className="text-xs font-bold uppercase tracking-wider">
                  Ưu đãi DUY NHẤT
                </span>
              </div>
              <h2 className="text-2xl md:text-3xl font-black leading-tight mb-2">
                {PROGRAM_NAME} — Giảm đến {MAX_DISCOUNT_OFFLINE}% học phí
              </h2>
              <p className="text-sm md:text-base opacity-95 max-w-xl">
                {DISCOUNT_HEADLINE} + bộ quà tặng{" "}
                <strong>{TOTAL_GIFT_VALUE}</strong>. Ưu đãi áp dụng đến hết{" "}
                <strong>{PROGRAM_END_LABEL}</strong>.
              </p>
            </div>

            <div className="flex justify-start md:justify-end items-stretch gap-2 sm:gap-3">
              <CountdownBlock value={time.days} label="Ngày" />
              <CountdownBlock value={time.hours} label="Giờ" />
              <CountdownBlock value={time.minutes} label="Phút" />
              <CountdownBlock value={time.seconds} label="Giây" pulse />
            </div>
          </div>

          <div className="mt-8 flex flex-col sm:flex-row items-center gap-3 sm:gap-4">
            <Link
              href="/lien-he?free-trial=true"
              className="inline-flex items-center gap-2 bg-white text-orange-600 hover:bg-orange-50 font-bold px-6 py-3 rounded-xl shadow-xl hover:-translate-y-0.5 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
            >
              Đăng ký nhận ưu đãi
              <ArrowRight className="w-4 h-4" />
            </Link>
            <div className="inline-flex items-center gap-2 text-xs sm:text-sm text-white/90">
              <CalendarClock className="w-4 h-4" />
              <span>Khai giảng Thứ 7, {openingDateLabel}</span>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

function CountdownBlock({
  value,
  label,
  pulse = false,
}: {
  value: number;
  label: string;
  pulse?: boolean;
}) {
  return (
    <div className="flex flex-col items-center bg-white/15 backdrop-blur ring-1 ring-white/30 rounded-xl px-3 py-2 sm:px-4 sm:py-3 min-w-[58px] sm:min-w-[72px]">
      <span
        className={`text-2xl sm:text-3xl md:text-4xl font-black tabular-nums leading-none ${
          pulse ? "animate-pulse" : ""
        }`}
      >
        {pad(value)}
      </span>
      <span className="text-[10px] sm:text-xs uppercase tracking-wider opacity-90 mt-1">
        {label}
      </span>
    </div>
  );
}
