# Effects — Vibrant Light Tone Enhancements (Phase 4.UI.1.1)

5 components để upgrade visual hierarchy + delight users. **Strategic use only** — không lạm dụng.

## Components

| Component | Use case | Performance |
|---|---|---|
| `<Sparkles>` | Hero, final CTA section (1/page max) | Low — Framer animation |
| `<GlowOrb>` | Hero/section corners để add depth | Zero — pure CSS blur |
| `<AnimatedGridLines>` | Sata Robo signature hero | Low — SVG SMIL |
| `<HoverLiftCard>` | Wrap cards (course, blog, product) | Zero — only on hover |
| `<MagneticCTA>` | Wrap primary CTAs (hero, final) | Low — only on hover |

## Strategic placement rules

✅ **DO**
- 1 `<Sparkles>` per page max (hero hoặc final CTA, không cả 2).
- `<GlowOrb>` ở góc section để add depth — không quá 2 orbs/section.
- `<AnimatedGridLines>` chỉ ở Sata Robo "wow" hero — không universal.
- `<HoverLiftCard>` wrap mọi interactive card.
- `<MagneticCTA>` wrap primary CTAs (1-2 per page).

❌ **DON'T**
- Stack nhiều Sparkles trong 1 section.
- AnimatedGridLines ở mọi section (heavy).
- MagneticCTA cho secondary buttons / text links.
- Import vào admin site (ESLint blocks).

## Strategic color mapping

| Section purpose | Theme | Effects allowed |
|---|---|---|
| Hero CHÍNH | `sunrise` | Particles + Sparkles + GlowOrbs + GridLines |
| Products | `softWarm` | GlowOrb cam + HoverLiftCard |
| Stats | `neutral` | NumberTicker gradient |
| Testimonials/About | `softCool` | GlowOrb tím only |
| Blog/Legal | `white` | None |
| Final CTA | `twilight`/`ctaFinal` | Sparkles + GlowOrbs + MagneticCTA |

## Performance

- All effects respect `prefers-reduced-motion` (Framer Motion defaults).
- Sparkles: `useEffect` generates positions client-side để tránh SSR hydration mismatch.
- AnimatedGridLines: SVG SMIL không re-render React.
- HoverLift / Magnetic: only kick in on `:hover` — desktop only.
