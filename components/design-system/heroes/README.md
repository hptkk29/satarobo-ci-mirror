# Heroes

3 variants theo 3-level animation breakdown.

| Variant | Use case | Animation level |
|---|---|---|
| `<HeroParticles>` | Trang chủ, /khoa-hoc overview | 1 — Heavy (particles + gradient text) |
| `<HeroSplit>` | Product pages SP1-SP4, /ve-chung-toi | 1-2 — Medium (FadeIn + reveal) |
| `<HeroMinimal>` | /tin-tuc, /tuyen-dung, /lien-he, legal | 3 — Minimal (FadeIn only) |

## Light tone principles

- Background dominant trắng (>70%).
- Cam particles trên light bg (visible, không quá đậm).
- Gradient ở eyebrow badge only — KHÔNG ở H1.
- Generous whitespace — premium feel.
- Subtle circuit decoration ở góc (opacity 30%).

## Common props

| Prop | Type | Notes |
|---|---|---|
| `eyebrow` | string | Small uppercase tag above title |
| `title` | string (required) | Main heading |
| `subtitle` | string | Description |
| `children` | ReactNode | CTAs (CTAPrimary + CTASecondary/Ghost) |

## Usage

```tsx
import { HeroParticles } from "@/components/design-system/heroes/hero-particles";
import { CTAPrimary } from "@/components/design-system/ctas/cta-primary";
import { CTAGhost } from "@/components/design-system/ctas/cta-ghost";

<HeroParticles
  eyebrow="ROBOTICS & STEM K-12"
  title="Nuôi dưỡng thế hệ kỹ sư tương lai"
  subtitle="Hơn 4,000 học viên tin tưởng Sata Robo"
  trustIndicators={[{ text: "8 trường K-12 đối tác" }]}
>
  <CTAPrimary href="/lien-he">Đăng ký tư vấn</CTAPrimary>
  <CTAGhost href="/khoa-hoc">Xem khoá học</CTAGhost>
</HeroParticles>
```
