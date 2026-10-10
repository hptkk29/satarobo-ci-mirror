# Decorations

SVG/canvas decorations dùng làm absolute overlay trong heroes/sections. Subtle — light tone.

| Component | Mục đích | Animation |
|---|---|---|
| `<CircuitPattern>` | Mạch điện neon signature Sata Robo | Static |
| `<DotGrid>` | Notion/Linear dot grid background | Static |
| `<Sparkles>` | Random sparkles cam-tím decoration | Static (SSR-stable) |
| `<OrbitIcons>` | Icons xoay tròn (ecosystem viz) | Magic UI OrbitingCircles |
| `<BeamConnector>` + `<BeamConnectorGroup>` | Animated lines giữa nodes | Magic UI AnimatedBeam |

## Light tone rules

- Color qua className `text-orange-100`, `text-purple-100`, `text-neutral-200` — opacity 30-50%.
- KHÔNG dùng `text-orange-500` cho pattern (quá đậm trên light bg).
- Default opacity 30-50% để không lấn át content.

## Usage

```tsx
<section className="relative">
  <CircuitPattern className="absolute top-0 right-0 w-1/3 h-1/2 text-orange-200 opacity-30" />
  {/* content */}
</section>
```
