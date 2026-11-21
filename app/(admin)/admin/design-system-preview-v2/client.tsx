"use client";

import { HeroParticles } from "@/components/design-system/heroes/hero-particles";
import { SectionBase } from "@/components/design-system/sections/section-base";
import { SectionStats } from "@/components/design-system/sections/section-stats";
import { CourseCard } from "@/components/design-system/cards/course-card";
import { TestimonialCard } from "@/components/design-system/cards/testimonial-card";
import { BlogCard } from "@/components/design-system/cards/blog-card";
import { CTAPrimary } from "@/components/design-system/ctas/cta-primary";
import { CTASecondary } from "@/components/design-system/ctas/cta-secondary";
import { CTAGhost } from "@/components/design-system/ctas/cta-ghost";
import { Sparkles } from "@/components/design-system/effects/sparkles";
import { GlowOrb } from "@/components/design-system/effects/glow-orb";
import { AnimatedGridLines } from "@/components/design-system/effects/animated-grid-lines";
import { HoverLiftCard } from "@/components/design-system/effects/hover-lift-card";
import { tokens } from "@/lib/design-tokens";

export function DesignSystemV2Demo() {
  return (
    <div className="min-h-screen -m-6">
      {/* ═══════════════════════════════════════════════════════ */}
      {/* HERO — SUNRISE THEME (cam→trắng→tím + ALL effects)     */}
      {/* ═══════════════════════════════════════════════════════ */}
      <HeroParticles
        theme="sunrise"
        eyebrow="ROBOTICS & STEM K-12"
        title="Nuôi dưỡng thế hệ kỹ sư tương lai"
        subtitle="Strategic color: cam→trắng→tím gradient · particles + sparkles + glow orbs + grid lines"
        trustIndicators={[
          { text: "8 trường K-12 đối tác" },
          { text: "24 giải RoboSim 2026" },
          { text: "4,000+ học viên" },
        ]}
        effects={{
          particles: true,
          sparkles: true,
          glowOrbs: true,
          gridLines: true,
        }}
      >
        <CTAPrimary href="#" magnetic>
          Đăng ký tư vấn
        </CTAPrimary>
        <CTASecondary href="#">Xem khoá học</CTASecondary>
      </HeroParticles>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* PRODUCTS — SOFT-WARM (cam dominant)                     */}
      {/* ═══════════════════════════════════════════════════════ */}
      <SectionBase
        theme="soft-warm"
        eyebrow="🧡 KHOÁ HỌC (CAM ACCENT)"
        title="2 khoá học chủ lực"
        subtitle="Background soft-warm cam nhẹ + glow orb cam + cards hover lift + BorderBeam"
        glowOrb={{ color: "orange", position: "bottom-right" }}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          <CourseCard
            size="large"
            badge="LTR"
            title="Lập trình Robot (Sata1-8)"
            description="Khoá Robotics offline cho học sinh lớp 1-8 — robot vật lý, lớp 1:8, 2 cơ sở Đà Nẵng"
            href="#"
            price="Liên hệ tư vấn"
            duration="6 tháng"
            studentCount={1200}
          />
          <CourseCard
            size="large"
            badge="LTRS"
            title="Luyện thi RoboSim"
            description="Khoá luyện thi online + coaching 1-1 — pass vòng loại Sáng tạo Robotics R1/R2"
            href="#"
            price="Liên hệ tư vấn"
            duration="3-6 tháng"
            studentCount={800}
          />
        </div>
      </SectionBase>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* STATS — NEUTRAL (gradient numbers cam-tím)              */}
      {/* ═══════════════════════════════════════════════════════ */}
      <SectionStats
        eyebrow="THÀNH TỰU"
        title="Sata Robo qua 6 năm"
        stats={[
          { value: 2000, suffix: "+", label: "Học viên" },
          { value: 4, label: "Cơ sở Đà Nẵng" },
          { value: 24, label: "Giải RoboSim 2026" },
          { value: 6, suffix: "+", label: "Năm xây dựng" },
        ]}
      />

      {/* ═══════════════════════════════════════════════════════ */}
      {/* TESTIMONIALS — SOFT-COOL (tím dominant)                 */}
      {/* ═══════════════════════════════════════════════════════ */}
      <SectionBase
        theme="soft-cool"
        eyebrow="💜 PHỤ HUYNH NÓI GÌ (TÍM ACCENT)"
        title="Tin cậy từ 2,000+ gia đình"
        subtitle="Background soft-cool tím nhẹ + glow orb tím — Trust signal"
        glowOrb={{ color: "purple", position: "top-left" }}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <TestimonialCard
            quote="Con tôi học được 3 tháng đã có thể tự lập trình các robot đơn giản. Tư duy logic cải thiện rõ rệt."
            authorName="Chị Thanh Hà"
            authorRole="Phụ huynh lớp 5"
            rating={5}
          />
          <TestimonialCard
            quote="Giáo viên tận tâm, lớp ít học sinh nên con được chú ý cá nhân. Sata Robo thực sự hơn kỳ vọng của tôi."
            authorName="Anh Minh Đức"
            authorRole="Phụ huynh lớp 7"
            rating={5}
          />
          <TestimonialCard
            quote="Con tham gia thi RoboSim và đạt giải khu vực. Hành trình của con cùng Sata Robo là một trải nghiệm tuyệt vời."
            authorName="Chị Mai Lan"
            authorRole="Phụ huynh lớp 6"
            rating={5}
          />
        </div>
      </SectionBase>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* BLOG — WHITE neutral (content focus)                    */}
      {/* ═══════════════════════════════════════════════════════ */}
      <SectionBase
        theme="white"
        eyebrow="TIN TỨC"
        title="Cập nhật mới nhất"
        subtitle="Pure white background — content readability tối đa"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <BlogCard
            title="Tại sao trẻ em cần học lập trình Robot từ sớm?"
            excerpt="5 lý do khoa học chứng minh lập trình Robot giúp trẻ phát triển tư duy và kỹ năng mềm."
            href="#"
            publishedAt={new Date("2026-04-15")}
            readingTimeMin={5}
            authorName="Hồ Đắc Phúc"
            category="Phụ huynh"
          />
          <BlogCard
            title="Luyện thi RoboSim — Lộ trình pass vòng loại cho con"
            excerpt="Bí quyết chuẩn bị bài bản cho cuộc thi Sáng tạo Robotics 2026, bảng R1 và R2."
            href="#"
            publishedAt={new Date("2026-04-20")}
            readingTimeMin={7}
            authorName="Lê Minh Tâm"
            category="B2B"
          />
          <BlogCard
            title="RoboSim 2026 — 24 giải thưởng cho học viên Sata Robo"
            excerpt="Tổng kết hành trình thi đấu RoboSim 2026 toàn quốc với những con số ấn tượng."
            href="#"
            publishedAt={new Date("2026-04-25")}
            readingTimeMin={4}
            authorName="Trần Văn Hoà"
            category="Sự kiện"
          />
        </div>
      </SectionBase>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* FINAL CTA — TWILIGHT (tím→trắng→cam) + ALL EFFECTS      */}
      {/* ═══════════════════════════════════════════════════════ */}
      <section
        className={`relative overflow-hidden ${tokens.vibrantBg.ctaFinal} py-20`}
      >
        <Sparkles density="high" colors={["orange", "purple"]} />
        <GlowOrb color="orange" position="bottom-left" size="xl" />
        <GlowOrb color="purple" position="top-right" size="xl" />

        <div className="container max-w-4xl mx-auto px-4 text-center relative z-10">
          <h2 className={`${tokens.typography.display.h2} mb-4`}>
            Sẵn sàng bắt đầu?
          </h2>
          <p className={`${tokens.typography.body.lg} text-muted-foreground mb-8 max-w-2xl mx-auto`}>
            Đăng ký tư vấn miễn phí 1-1 với chuyên gia Sata Robo
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <CTAPrimary size="lg" magnetic href="#">
              Đăng ký tư vấn miễn phí
            </CTAPrimary>
            <CTASecondary size="lg" href="#">
              Gọi điện ngay
            </CTASecondary>
          </div>
          <p className="text-sm text-muted-foreground mt-6">
            ✓ Không cam kết · ✓ 1-1 với chuyên gia · ✓ Phản hồi trong 24h
          </p>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* EFFECTS SHOWCASE — riêng biệt để inspect từng effect    */}
      {/* ═══════════════════════════════════════════════════════ */}
      <SectionBase theme="white" eyebrow="DEBUG" title="Effects showcase">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* GlowOrb only */}
          <div className="relative h-64 rounded-2xl border border-border bg-card overflow-hidden">
            <GlowOrb color="orange" position="center" size="md" />
            <div className="absolute inset-0 flex items-center justify-center text-foreground font-semibold">
              &lt;GlowOrb color=&quot;orange&quot; /&gt;
            </div>
          </div>
          <div className="relative h-64 rounded-2xl border border-border bg-card overflow-hidden">
            <GlowOrb color="purple" position="center" size="md" />
            <div className="absolute inset-0 flex items-center justify-center text-foreground font-semibold">
              &lt;GlowOrb color=&quot;purple&quot; /&gt;
            </div>
          </div>
          <div className="relative h-64 rounded-2xl border border-border bg-card overflow-hidden">
            <GlowOrb color="mixed" position="center" size="md" />
            <div className="absolute inset-0 flex items-center justify-center text-foreground font-semibold">
              &lt;GlowOrb color=&quot;mixed&quot; /&gt;
            </div>
          </div>

          {/* AnimatedGridLines */}
          <div className="relative h-64 rounded-2xl border border-border bg-card overflow-hidden">
            <AnimatedGridLines color="orange" opacity={0.2} />
            <div className="absolute inset-0 flex items-center justify-center text-foreground font-semibold">
              GridLines orange
            </div>
          </div>
          <div className="relative h-64 rounded-2xl border border-border bg-card overflow-hidden">
            <AnimatedGridLines color="mixed" opacity={0.2} />
            <div className="absolute inset-0 flex items-center justify-center text-foreground font-semibold">
              GridLines mixed
            </div>
          </div>
          <div className="relative h-64 rounded-2xl border border-border bg-card overflow-hidden">
            <Sparkles density="high" colors={["orange", "purple"]} />
            <div className="absolute inset-0 flex items-center justify-center text-foreground font-semibold">
              Sparkles high density
            </div>
          </div>

          {/* HoverLiftCard demo */}
          <HoverLiftCard glowColor="orange">
            <div className="h-32 rounded-2xl border border-border bg-card p-6 flex items-center justify-center text-foreground font-semibold">
              HoverLift orange
            </div>
          </HoverLiftCard>
          <HoverLiftCard glowColor="purple">
            <div className="h-32 rounded-2xl border border-border bg-card p-6 flex items-center justify-center text-foreground font-semibold">
              HoverLift purple
            </div>
          </HoverLiftCard>
          <HoverLiftCard glowColor="none">
            <div className="h-32 rounded-2xl border border-border bg-card p-6 flex items-center justify-center text-foreground font-semibold">
              HoverLift no glow
            </div>
          </HoverLiftCard>
        </div>
      </SectionBase>

      {/* CTA showcase */}
      <SectionBase theme="aurora" eyebrow="CTAS" title="Magnetic effect">
        <div className="flex flex-wrap items-center justify-center gap-4">
          <CTAPrimary magnetic>Magnetic Primary</CTAPrimary>
          <CTAPrimary>Standard Primary</CTAPrimary>
          <CTASecondary>Secondary</CTASecondary>
          <CTAGhost>Ghost Link</CTAGhost>
        </div>
        <p className="text-center text-sm text-muted-foreground mt-6">
          Hover Magnetic Primary để thấy cursor-following effect (desktop only).
        </p>
      </SectionBase>

      {/* End spacer */}
      <div className="py-12 bg-card text-center text-xs text-muted-foreground">
        Phase 4.UI.1.1 Design System v2 · Strategic color + Vibrant effects
      </div>
    </div>
  );
}
