"use client";

import { NumberTicker } from "@/components/magic/number-ticker";
import { RevealOnScroll } from "@/components/motion/reveal-on-scroll";

interface HonorStatsCounterProps {
  totalHonors: number;
  totalAwards: number;
  companyYears: number;
}

function Stat({ value, label, suffix = "" }: { value: number; label: string; suffix?: string }) {
  return (
    <div className="text-center">
      <div className="text-5xl md:text-6xl font-bold bg-gradient-to-br from-purple-600 to-orange-500 bg-clip-text text-transparent mb-2">
        <NumberTicker value={value} className="text-transparent bg-clip-text" />
        {suffix}
      </div>
      <div className="text-sm md:text-base text-gray-600 uppercase tracking-wider">
        {label}
      </div>
    </div>
  );
}

export function HonorStatsCounter({
  totalHonors,
  totalAwards,
  companyYears,
}: HonorStatsCounterProps) {
  return (
    <section className="bg-gray-50 py-16">
      <div className="container max-w-5xl mx-auto px-4">
        <div className="grid grid-cols-3 gap-8">
          <RevealOnScroll>
            <Stat value={totalHonors} label="Nhân sự được vinh danh" />
          </RevealOnScroll>
          <RevealOnScroll delay={0.15}>
            <Stat value={totalAwards} label="Giải thưởng đã trao" />
          </RevealOnScroll>
          <RevealOnScroll delay={0.3}>
            <Stat value={companyYears} label="Năm xây dựng" suffix="+" />
          </RevealOnScroll>
        </div>
      </div>
    </section>
  );
}
