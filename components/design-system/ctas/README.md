# CTAs

5 CTA variants. Mỗi page tối đa 1 `<CTAGradient>` (premium reserve).

| Component | Use case | Visual |
|---|---|---|
| `<CTAPrimary>` | Important action | Cam shimmer button (Magic UI) |
| `<CTASecondary>` | Secondary action | Outline tím #7C3AED |
| `<CTAGhost>` | Inline link | Text + arrow, hover bg neutral-50 |
| `<CTAGradient>` | High-converting hero CTA | Gradient cam→tím (premium) |
| `<CTAFloating>` | Mobile contact button | Floating bottom-right, mobile-only |

## Common props

Tất cả CTAs support polymorphic:
- `href: string` → render `<Link>` (Next.js)
- Không truyền `href` → render `<button>` với standard button attrs

## Sizes

`<CTAPrimary>`, `<CTASecondary>`, `<CTAGradient>` support `size`:
- `sm` — compact lists
- `md` — default
- `lg` — hero CTAs

## Hierarchy rule

```
1 page = 1 primary action + 1 secondary action max
1 page = 1 gradient CTA max (high-converting hero only)
Multiple ghost CTAs allowed (navigation/inline)
```
