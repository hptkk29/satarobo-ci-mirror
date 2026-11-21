"use client";

import { AnimatedGradientText } from "@/components/magic/animated-gradient-text";
import { Particles } from "@/components/magic/particles";
import { FadeIn } from "@/components/motion/fade-in";

interface HonorHeroProps {
  title: string;
  subtitle: string;
}

export function HonorHero({ title, subtitle }: HonorHeroProps) {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-purple-900 via-purple-700 to-orange-600 text-white py-24 md:py-32">
      {/* Particles background (Magic UI thay implementation framer tay cũ) */}
      <Particles
        className="absolute inset-0"
        quantity={30}
        ease={80}
        color="#ffffff"
        refresh
      />

      <div className="container relative z-10 max-w-4xl mx-auto px-4 text-center">
        <FadeIn>
          <div className="mb-4 flex justify-center">
            <AnimatedGradientText
              colorFrom="#FED7AA"
              colorTo="#DDD6FE"
              speed={1.5}
            >
              <span className="text-sm md:text-base uppercase tracking-widest font-semibold">
                Hall of Fame · Sata Robo
              </span>
            </AnimatedGradientText>
          </div>

          <h1 className="text-4xl md:text-6xl font-bold mb-6 leading-tight">
            {title}
          </h1>
          <p className="text-lg md:text-xl text-white/90 max-w-2xl mx-auto">
            {subtitle}
          </p>
        </FadeIn>
      </div>
    </section>
  );
}
