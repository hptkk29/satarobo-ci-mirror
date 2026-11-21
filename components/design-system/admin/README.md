# Admin polished components

Utility-first components cho admin pages. **KHÔNG animation daily-blocking** — chỉ hover effects subtle.

| Component | Use case |
|---|---|
| `<StatCardAdmin>` | Dashboard stat tiles với trend indicator |
| `<StatusBadge>` | Lead/job/honor status pills (success/warning/error/info/neutral) |
| `<EmptyStateAdmin>` | Empty list state với illustration |
| `<DataTableShell>` | Polished wrapper cho admin tables (header + body + footer) |

## Design rules

- Background `bg-white`
- Border `border-neutral-200` (subtle)
- Shadow `tokens.shadows.subtle` hoặc `card` only
- Hover: shadow `md` only (no scale, no color shift dramatic)
- Animation duration ≤ 200ms

## NO admin animations

❌ KHÔNG dùng Magic UI, Framer Motion ở admin (ESLint chặn).
❌ KHÔNG dùng gradient backgrounds.
❌ KHÔNG dùng particles, beams, shimmer.

✅ Tailwind CSS transitions (`transition-colors`, `transition-shadow`) only.

## Example

```tsx
import { StatCardAdmin } from "@/components/design-system/admin/stat-card-admin";
import { StatusBadge } from "@/components/design-system/admin/status-badge";
import { Users } from "lucide-react";

<StatCardAdmin
  label="Leads tháng 5"
  value={132}
  trend={{ direction: "up", value: "+7%" }}
  icon={<Users className="w-4 h-4" />}
  iconColor="orange"
/>

<StatusBadge variant="success">Đang hoạt động</StatusBadge>
```
