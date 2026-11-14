// Sata Robo Design Tokens — LIGHT TONE
// Phase 4.UI.1 foundation. Single source of truth — import từ đây thay vì hardcode.
//
// @example
//   import { tokens } from "@/lib/design-tokens";
//   <div className={tokens.spacing.section}>
//     <h2 className={tokens.typography.heading.h2}>...</h2>
//   </div>

export const tokens = {
  colors: {
    // Primary brand accents (used sparingly — 8% cam + 2% tím)
    orange: {
      50: "#FFF7ED",
      100: "#FFEDD5",
      400: "#FB923C",
      500: "#F97316", // ⭐ MAIN ACCENT
      600: "#EA580C", // Hover
      700: "#C2410C",
    },
    purple: {
      50: "#FAF5FF",
      100: "#F3E8FF",
      400: "#A78BFA",
      600: "#9333EA",
      700: "#7C3AED", // ⭐ SECONDARY ACCENT
      900: "#581C87",
    },

    // Neutrals dominant 85%
    neutral: {
      white: "#FFFFFF",
      offWhite: "#FAFAFA",
      light: "#F5F5F5",
      border: "#E5E5E5",
      muted: "#737373",
      text: "#262626",
      dark: "#171717",
    },

    // Semantic (admin status)
    success: { bg: "#D1FAE5", text: "#065F46", main: "#10B981" },
    warning: { bg: "#FEF3C7", text: "#92400E", main: "#F59E0B" },
    error: { bg: "#FEE2E2", text: "#991B1B", main: "#EF4444" },
    info: { bg: "#DBEAFE", text: "#1E40AF", main: "#3B82F6" },
  },

  // Background utilities (Tailwind classes)
  bg: {
    primary: "bg-white",
    alternate: "bg-neutral-50",
    accent: "bg-gradient-to-b from-white to-orange-50/30",
    soft: "bg-orange-50/40",
    cardSoft: "bg-gradient-to-br from-white to-neutral-50",
    // Hero light gradient — subtle warm white → orange-50/40 → purple-50/30
    heroLight: "bg-gradient-to-br from-white via-orange-50/40 to-purple-50/30",
  },

  // Gradients — DÙNG TIẾT KIỆM (3 strategic places only)
  gradients: {
    numberAccent: "from-orange-500 to-purple-700",
    ctaPremium: "from-orange-500 to-purple-700",
    heroLight: "from-white via-orange-50/40 to-purple-50/30",
  },

  // Typography scale
  typography: {
    display: {
      h1: "text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight text-neutral-900",
      h2: "text-3xl md:text-5xl font-bold tracking-tight text-neutral-900",
    },
    heading: {
      h3: "text-2xl md:text-3xl font-semibold tracking-tight text-neutral-900",
      h4: "text-xl md:text-2xl font-semibold text-neutral-900",
      h5: "text-lg font-semibold text-neutral-900",
    },
    body: {
      lg: "text-lg leading-relaxed text-neutral-800",
      base: "text-base leading-relaxed text-neutral-800",
      sm: "text-sm text-neutral-700",
      muted: "text-base text-neutral-600",
    },
    eyebrow: "text-xs md:text-sm uppercase tracking-widest font-semibold text-orange-600",
    pullQuote: "text-xl md:text-2xl italic leading-relaxed text-neutral-800",
  },

  // Spacing
  spacing: {
    section: "py-16",
    sectionSm: "py-16",
    container: "container mx-auto px-4 md:px-6 lg:px-8",
    containerNarrow: "container mx-auto px-4 max-w-4xl",
    card: "p-6 md:p-8",
    cardSm: "p-4 md:p-6",
    gap: {
      sm: "gap-4",
      md: "gap-6 md:gap-8",
      lg: "gap-8 md:gap-12",
    },
  },

  // Shadows — subtle premium feel
  shadows: {
    none: "shadow-none",
    subtle: "shadow-[0_1px_3px_rgb(0,0,0,0.04)]",
    card: "shadow-[0_1px_3px_rgb(0,0,0,0.04)] hover:shadow-[0_4px_12px_rgb(0,0,0,0.08)] transition-shadow duration-300",
    premium: "shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-shadow duration-300",
    elevated: "shadow-[0_10px_40px_rgb(0,0,0,0.06)]",
  },

  // Border radius
  radius: {
    card: "rounded-xl",
    cardLg: "rounded-2xl",
    button: "rounded-lg",
    badge: "rounded-full",
    sm: "rounded-md",
  },

  // Animation duration constants (ms)
  duration: {
    fast: 150,
    base: 300,
    slow: 600,
    hero: 800,
  },

  // Borders
  borders: {
    subtle: "border border-neutral-200",
    accent: "border border-orange-200",
    interactive: "border border-neutral-200 hover:border-orange-300 transition-colors",
  },

  // Phase 4.UI.1.1 — Vibrant gradient backgrounds (strategic placement)
  vibrantBg: {
    // Hero CHÍNH — wow effect (1 lần per page max)
    sunrise: "bg-gradient-to-br from-orange-50/60 via-white to-purple-50/40",
    twilight: "bg-gradient-to-br from-purple-50/40 via-white to-orange-50/60",
    // Section-specific
    softWarm: "bg-gradient-to-b from-white via-orange-50/40 to-white", // Sản phẩm (cam dominant)
    softCool: "bg-gradient-to-b from-white via-purple-50/30 to-white", // Testimonials/About (tím dominant)
    softWarmInverse: "bg-gradient-to-b from-orange-50/40 via-white to-white",
    softCoolInverse: "bg-gradient-to-b from-purple-50/30 via-white to-white",
    // Aurora — special moments
    aurora: "bg-gradient-to-br from-orange-50/30 via-white to-purple-50/30",
    // Final CTA
    ctaFinal: "bg-gradient-to-r from-orange-50/60 via-white to-purple-50/60",
  },

  // Phase 4.UI.1.1 — Effect utility classes (hover, glow)
  effects: {
    // Glow orb backgrounds (for absolute decoration)
    glowOrb: {
      orange: "bg-orange-300/40 blur-3xl",
      purple: "bg-purple-300/40 blur-3xl",
      mixed: "bg-gradient-to-br from-orange-300/30 to-purple-300/30 blur-3xl",
    },
    // Sparkle colors (hex for SVG/canvas)
    sparkle: {
      orange: "#F97316",
      purple: "#7C3AED",
    },
    // Hover state classes
    hoverLift: "hover:-translate-y-1 hover:shadow-lg transition-all duration-300",
    hoverBorder: "hover:border-orange-300 transition-colors duration-200",
    hoverGlow: "hover:shadow-[0_0_30px_rgba(249,115,22,0.15)] transition-shadow duration-300",
  },
} as const;

// Convenience re-exports
export const colors = tokens.colors;
export const bg = tokens.bg;
export const gradients = tokens.gradients;
export const typography = tokens.typography;
export const spacing = tokens.spacing;
export const shadows = tokens.shadows;
export const radius = tokens.radius;
export const duration = tokens.duration;
export const borders = tokens.borders;
export const vibrantBg = tokens.vibrantBg;
export const effects = tokens.effects;
