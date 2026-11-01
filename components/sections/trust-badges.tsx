"use client";

import { FadeIn } from "@/components/motion/fade-in";

// F-UI-2.5 — Social proof row ngay sau Hero. Achievements snapshot;
// TODO: pull từ DB khi có dashboard count students/centers thực tế.
const ACHIEVEMENTS = [
  { value: "1,000+", label: "Học viên đã đào tạo" },
  { value: "2", label: "Cơ sở Đà Nẵng + Online" },
  { value: "98%", label: "PH tiếp tục khoá tiếp theo" },
  { value: "50+", label: "Giải thưởng cuộc thi" },
];

export function TrustBadges() {
  return (
    <section className="border-y border-gray-100 bg-white px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <FadeIn>
          <p className="mb-8 text-center text-xs font-semibold uppercase tracking-wider text-gray-500 sm:text-sm">
            Tin tưởng bởi 2,000+ phụ huynh & học sinh
          </p>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="mb-10 grid grid-cols-2 gap-6 sm:gap-8 md:grid-cols-4 sm:mb-12">
            {ACHIEVEMENTS.map((a) => (
              <div key={a.label} className="text-center">
                <div className="text-2xl font-bold text-gradient-warm sm:text-3xl md:text-4xl">
                  {a.value}
                </div>
                <div className="mt-1 text-xs text-gray-600 sm:text-sm">
                  {a.label}
                </div>
              </div>
            ))}
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
