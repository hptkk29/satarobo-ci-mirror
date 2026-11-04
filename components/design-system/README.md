# Sata Robo Design System (Phase 4.UI.1)

Reusable design system với tone **LIGHT**: white dominant (70%), Orange `#F97316` accent (8%), Purple `#7C3AED` secondary (2%).

Mood: **Premium & Trusted** (Stripe / Linear / Notion style).

## Folder layout

```
components/design-system/
├── heroes/        — 3 hero variants (light tone)
├── sections/      — 5 section wrappers
├── cards/         — 6 card types (course/blog/employee/job/testimonial/stat)
├── ctas/          — 5 CTA variants (primary/secondary/ghost/gradient/floating)
├── decorations/   — 5 SVG/canvas decorations
├── illustrations/ — 5 SVG hero illustrations + empty-state
└── admin/         — 4 polished admin components (KHÔNG heavy animation)
```

## Design tokens

Single source of truth tại [`lib/design-tokens.ts`](../../lib/design-tokens.ts):
- `tokens.colors` — palette
- `tokens.bg` — background utility classes
- `tokens.gradients` — 3 strategic gradient strings
- `tokens.typography` — heading/body/eyebrow class strings
- `tokens.spacing` — section/container/gap class strings
- `tokens.shadows` — subtle/card/premium/elevated
- `tokens.radius` — card/button/badge
- `tokens.borders` — subtle/accent/interactive

→ Import từ đây thay vì hardcode classes.

## Library scope (ESLint enforced)

| Library | Where | Why |
|---|---|---|
| **shadcn/ui** (`components/ui/`) | Cả 2 site | Radix primitives — accessible |
| **Magic UI** (`components/magic/`) | CLIENT only | Particles, NumberTicker, ShimmerButton, BorderBeam |
| **Motion wrappers** (`components/motion/`) | CLIENT only | FadeIn, RevealOnScroll, StaggerChildren |
| **Recharts** (`components/charts/`) | ADMIN only | Data viz |
| **Design system** | Mixed — heroes/sections/cards/ctas/decorations/illustrations = client; admin/ = admin | Built on top of above |

## Animation level breakdown

| Level | Where | Components |
|---|---|---|
| 1 — Heavy | Hero landing, key CTAs | HeroParticles, CourseCard (BorderBeam) |
| 1-2 — Medium | Product hero, reveal sections | HeroSplit, SectionStats |
| 3 — Minimal | Content pages, admin | HeroMinimal, all cards, all admin components |
| 0 — None | Static text, legal pages | StatCard, TestimonialCard |

## Light tone enforcement

✅ Background dominant trắng (>70% surface).
✅ Cam chỉ ở CTAs + accents + hover (<10% surface).
✅ Tím chỉ ở decorative + secondary CTAs (<5% surface).
✅ Gradients chỉ ở 3 strategic places: hero subtle bg, premium CTA, number stats.
❌ KHÔNG dark dramatic gradients.
❌ KHÔNG vibrant backgrounds.

## Demo

Preview tất cả components: `/admin/design-system-preview` (SUPER_ADMIN only).

## Phase 4.UI.2 will refactor

Phase này chỉ tạo library. Phase 4.UI.2 sẽ refactor 16 existing pages dùng design system này.
