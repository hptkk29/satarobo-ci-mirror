# Illustrations

5 SVG illustrations cho hero sections + admin empty states. Pure SVG (no deps).

| Component | Use case | Size |
|---|---|---|
| `<HeroKidRobot>` | SP1 RoboSim Master hero | 500×400 |
| `<HeroClassroom>` | SP2 Offline class hero | 500×400 |
| `<HeroTeamWork>` | SP3 Sata Inno School / Về chúng tôi | 500×400 |
| `<HeroStemTools>` | SP4 SATAGO / features | 500×400 |
| `<EmptyStateIllustration>` | Admin empty list states | 400×280 |

## Style

- Flat illustration, brand colors (cam + tím).
- Minimal lines, no excessive detail.
- Friendly characters (robots smiling, kids engaged).
- Subtle floating decorative elements.

## Customizing

Tất cả nhận `className` để control kích thước/responsive:

```tsx
<HeroKidRobot className="max-w-md mx-auto" />
```

Brand color override sẽ cần edit SVG trực tiếp — illustration tham chiếu màu hex hardcoded `#F97316`/`#7C3AED` để tránh CSS scope conflicts.
