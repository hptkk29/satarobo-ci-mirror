"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  gifts as staticGifts,
  totalGiftValue as staticTotalGiftValue,
  type Gift as GiftType,
} from "./_data/gifts";
import { Gift, Flame } from "lucide-react";
import { PROGRAM_NAME, PROGRAM_END_LABEL } from "@/lib/uu-dai";

export default function Gifts({
  gifts = staticGifts,
  totalGiftValue = staticTotalGiftValue,
}: {
  gifts?: GiftType[];
  totalGiftValue?: string;
} = {}) {
  const [activeIdx, setActiveIdx] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchStartX = useRef<number | null>(null);

  const startAuto = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setActiveIdx((i) => (i + 1) % gifts.length);
    }, 3000);
  }, [gifts.length]);

  useEffect(() => {
    startAuto();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [startAuto]);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      if (diff > 0) setActiveIdx((i) => (i + 1) % gifts.length);
      else setActiveIdx((i) => (i - 1 + gifts.length) % gifts.length);
      startAuto();
    }
    touchStartX.current = null;
  };

  return (
    <section id="gifts" className="section-padding bg-white">
      <div className="container-site">
        <div className="text-center mb-10 sm:mb-14">
          <div className="badge-orange mb-4">
            <Gift className="w-4 h-4" />
            QUÀ TẶNG KHI BỐ MẸ ĐĂNG KÝ
          </div>
          <h2 className="heading-2 mb-4">
            Bộ Quà Tặng <span className="text-gradient-orange-purple">Giá Trị</span> Kèm Theo
          </h2>
          <p className="mb-3 text-sm font-semibold text-primary-purple sm:text-base">
            Nằm trong {PROGRAM_NAME}
          </p>
          <p className="text-base sm:text-lg text-text-muted max-w-2xl mx-auto">
            Mình tặng kèm <strong>4 món quà giá trị</strong> — không phải để &ldquo;câu&rdquo; bố mẹ,
            mà để con có khởi đầu thuận lợi nhất ngay từ ngày đầu.
          </p>
        </div>

        <div className="sm:hidden mb-10 relative overflow-hidden" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
          <div className="flex transition-transform duration-500 ease-in-out" style={{ transform: `translateX(-${activeIdx * 100}%)` }}>
            {gifts.map((gift, idx) => (
              <div key={gift.id} className="min-w-full px-1">
                <div className="relative card-base p-6 text-center overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-orange-purple"></div>
                  <div className="absolute top-3 right-3 w-7 h-7 rounded-full bg-soft-yellow text-primary-orange text-xs font-black flex items-center justify-center">
                    {idx + 1}
                  </div>
                  <div className="text-5xl mb-4">{gift.icon}</div>
                  <h3 className="font-bold text-base text-text-dark mb-2 leading-tight min-h-[3rem]">{gift.title}</h3>
                  <div className="inline-block px-3 py-1 bg-soft-yellow rounded-full mb-3">
                    <span className="text-sm font-black text-primary-orange">Trị giá {gift.value}</span>
                  </div>
                  <p className="text-xs text-text-muted leading-relaxed">{gift.description}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-center gap-2 mt-4">
            {gifts.map((_, idx) => (
              <button
                key={idx}
                onClick={() => { setActiveIdx(idx); startAuto(); }}
                className={`h-2 rounded-full transition-all duration-300 ${idx === activeIdx ? "w-6 bg-primary-orange" : "w-2 bg-gray-300"}`}
              />
            ))}
          </div>
        </div>

        <div className="hidden sm:grid sm:grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-6 mb-10">
          {gifts.map((gift, idx) => (
            <div key={gift.id} className="relative card-base p-6 text-center hover:shadow-xl hover:-translate-y-2 transition group overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-orange-purple"></div>
              <div className="absolute top-3 right-3 w-7 h-7 rounded-full bg-soft-yellow text-primary-orange text-xs font-black flex items-center justify-center">
                {idx + 1}
              </div>
              <div className="text-5xl sm:text-6xl mb-4 group-hover:scale-110 group-hover:rotate-6 transition">{gift.icon}</div>
              <h3 className="font-bold text-base sm:text-lg text-text-dark mb-2 leading-tight min-h-[3rem]">{gift.title}</h3>
              <div className="inline-block px-3 py-1 bg-soft-yellow rounded-full mb-3">
                <span className="text-sm font-black text-primary-orange">Trị giá {gift.value}</span>
              </div>
              <p className="text-xs sm:text-sm text-text-muted leading-relaxed">{gift.description}</p>
            </div>
          ))}
        </div>

        <div className="max-w-3xl mx-auto bg-gradient-orange-purple rounded-2xl p-6 sm:p-8 text-center text-white shadow-xl mb-8 relative overflow-hidden">
          <div className="absolute top-2 right-4 text-6xl opacity-20 pointer-events-none">🎁</div>
          <div className="absolute bottom-2 left-4 text-6xl opacity-20 pointer-events-none">✨</div>
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-white/20 rounded-full mb-3 backdrop-blur-sm">
              <Flame className="w-4 h-4" />
              <span className="text-xs sm:text-sm font-bold uppercase tracking-wide">Tổng giá trị quà tặng</span>
            </div>
            <div className="text-3xl sm:text-5xl font-black mb-2">{totalGiftValue}</div>
            <p className="text-sm sm:text-base font-medium opacity-95">TẶNG KÈM khi bố mẹ đăng ký trong chương trình</p>
          </div>
        </div>

        <div className="text-center">
          <a
            href="#registration-form"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById("registration-form")?.scrollIntoView({ behavior: "smooth" });
            }}
            className="btn-primary cta-pulse cta-shine text-base sm:text-lg"
          >
            🎁 ĐĂNG KÝ NHẬN QUÀ NGAY →
          </a>
          <p className="mt-3 text-xs sm:text-sm text-text-muted">
            ⏰ Quà tặng áp dụng cho phụ huynh đăng ký đến hết {PROGRAM_END_LABEL}
          </p>
        </div>
      </div>
    </section>
  );
}
