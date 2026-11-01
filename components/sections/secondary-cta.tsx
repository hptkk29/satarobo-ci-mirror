"use client";

import Link from "next/link";
import { ArrowRight, Calendar, Phone } from "lucide-react";
import { FadeIn } from "@/components/motion/fade-in";
import { ShimmerButton } from "@/components/magic/shimmer-button";
import { SATA_ROBO_PHONE } from "@/lib/locations";
import { TRIAL_LABEL, TRIAL_LABEL_TITLE } from "@/lib/uu-dai";

// F-UI-3 — Final conversion section trước Footer. Dark zinc + purple
// gradient với grid mask + 2 glow halos để focus vào CTA chính.
export function SecondaryCta() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-zinc-950 via-purple-950 to-zinc-950 px-4 py-16 sm:px-6 lg:px-8">
      {/* Grid background với radial mask */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#262626_1px,transparent_1px),linear-gradient(to_bottom,#262626_1px,transparent_1px)] bg-[size:3rem_3rem] opacity-30 [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)]" />

      {/* 2 glow halos cho depth */}
      <div className="absolute left-1/4 top-0 h-96 w-96 rounded-full bg-orange-500/20 blur-3xl" />
      <div className="absolute bottom-0 right-1/4 h-96 w-96 rounded-full bg-purple-500/20 blur-3xl" />

      <div className="relative z-10 mx-auto max-w-4xl text-center">
        <FadeIn>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-4 py-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-500" />
            </span>
            <span className="text-xs font-medium text-orange-200 sm:text-sm">
              🔥 {TRIAL_LABEL_TITLE} — đang nhận lịch
            </span>
          </div>

          <h2 className="text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl md:text-5xl">
            Bắt đầu hành trình{" "}
            <span className="text-gradient-warm">Robotics</span>
            <br className="hidden sm:block" />
            của con <span className="text-gradient-tech">ngay hôm nay</span>
          </h2>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-zinc-300 sm:text-lg">
            Đăng ký{" "}
            <strong className="text-white">{TRIAL_LABEL}</strong> — không cần
            thẻ tín dụng, không ràng buộc. Cùng con khám phá thế giới Robot
            ngay!
          </p>
        </FadeIn>

        <FadeIn delay={0.2}>
          {/* Mobile: stack vertical, mỗi nút full width + h-14 → bằng nhau
              chính xác. Desktop: sm:flex-row + sm:w-auto + sm:h-auto. */}
          <div className="mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center sm:gap-4">
            <Link
              href="/lien-he?free-trial=true"
              className="block h-14 w-full sm:h-auto sm:w-auto"
            >
              <ShimmerButton
                background="linear-gradient(135deg, #F97316 0%, #EAB308 100%)"
                className="cta-pulse h-14 w-full px-8 text-base font-semibold sm:h-auto sm:w-auto sm:py-3.5"
              >
                <span className="flex items-center gap-2 text-white">
                  <Calendar className="h-5 w-5" />
                  Đặt {TRIAL_LABEL}
                  <ArrowRight className="h-4 w-4" />
                </span>
              </ShimmerButton>
            </Link>

            <a
              href={`tel:${SATA_ROBO_PHONE.tho}`}
              className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 text-base font-medium text-white backdrop-blur transition-colors hover:bg-white/10 sm:h-auto sm:w-auto sm:py-3.5"
            >
              <Phone className="h-5 w-5" />
              Gọi {SATA_ROBO_PHONE.hien}
            </a>
          </div>
        </FadeIn>

        <FadeIn delay={0.4}>
          <div className="mt-8 flex flex-wrap justify-center gap-4 text-xs text-zinc-400 sm:gap-6 sm:text-sm">
            <div className="flex items-center gap-1.5">
              <span className="text-green-400">✓</span> Không cần thẻ
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-green-400">✓</span> Không ràng buộc
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-green-400">✓</span> Hoàn 100% nếu không hài
              lòng
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-green-400">✓</span> Tư vấn 24/7
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
