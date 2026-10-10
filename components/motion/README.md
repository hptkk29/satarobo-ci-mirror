# Motion Wrappers (Client only)

Standardized Framer Motion components cho client site.

## Components

| Component | Use case |
|---|---|
| `<FadeIn>` | Hero text, headline trên trang load |
| `<RevealOnScroll>` | Section reveal khi scroll vào view |
| `<StaggerChildren>` + `staggerItem` | List/grid với animation tuần tự |

## Rules

1. ❌ KHÔNG import trực tiếp `framer-motion` ở component khác — dùng wrappers này.
2. ❌ KHÔNG dùng ở admin site (ESLint chặn).
3. ⚠️ Mobile-first: animation phải < 500ms, không block UX.
4. ⚠️ Tránh trên page quan trọng SEO (loading priority).
5. ✅ Lazy load wrappers nếu page chậm:
   ```tsx
   const FadeIn = dynamic(() =>
     import("@/components/motion/fade-in").then((m) => m.FadeIn)
   );
   ```

## Anti-patterns

❌ Animation chạy mỗi lần render
✅ Dùng `viewport={{ once: true }}` (default ở `RevealOnScroll`)

❌ Animation kéo dài > 1s
✅ Max 600ms — user mất kiên nhẫn

❌ Animation cho mọi component
✅ Strategic moments only (Hero, key CTAs, key sections)
