# Sections

5 section wrappers cho content pages.

| Component | Background | Use case |
|---|---|---|
| `<SectionBase>` | White | Default content sections |
| `<SectionAlternate>` | `bg-neutral-50` | Alternating với SectionBase (rhythm) |
| `<SectionCircuit>` | White + circuit pattern decoration | Brand-defining sections (features, stats) |
| `<SectionStats>` | White, gradient numbers cam→tím | Counter stats với NumberTicker |
| `<SectionMarquee>` | `bg-neutral-50` | Horizontal scrolling (logos, testimonials) |

## Alternating pattern

```
Section 1: <SectionBase>           // white
Section 2: <SectionAlternate>      // off-white
Section 3: <SectionCircuit>        // white + decoration
Section 4: <SectionAlternate>      // off-white
Section 5: <SectionStats>          // white + counter
Section 6: <SectionMarquee>        // off-white (partners)
```

→ Eye-friendly, không monotone.

## Common header

Tất cả sections support optional centered header:
- `eyebrow` — uppercase tag (cam)
- `title` — H2 main heading
- `subtitle` — description (text-neutral-600)

Khi không truyền 3 props này, section render direct `children` không header.
