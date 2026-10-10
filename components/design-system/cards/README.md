# Cards

6 card variants cho different content types.

| Component | Use case | Has hover effect |
|---|---|---|
| `<CourseCard>` | Khoá học (`/khoa-hoc`, `/khoa-hoc/<slug>`) | ✅ BorderBeam |
| `<BlogCard>` | Blog posts (`/tin-tuc`) | ✅ Subtle scale |
| `<EmployeeCard>` | Nhân sự (`/vinh-danh/tat-ca`, `/ve-chung-toi`) | ✅ if `href` provided |
| `<JobCard>` | Tin tuyển dụng (`/tuyen-dung`) | ✅ Border + arrow shift |
| `<TestimonialCard>` | Phụ huynh review (homepage, sales pages) | ❌ Static |
| `<StatCard>` | Compact inline stat trong grids | ❌ Static |

## Style baseline

- Background `bg-white`
- Border `border-neutral-200`, hover `border-orange-300` (nếu có hover)
- Shadow subtle → premium on hover (`tokens.shadows.card`)
- Radius `rounded-2xl` (16px) — premium feel
- Padding 6 mobile, 8 desktop

## Color accents

- **Cam** cho main CTA elements (price, "Xem chi tiết" arrow)
- **Tím** cho secondary labels, links
- **Neutral** cho metadata (time, dates, counts)

## Hover behavior

Cards với `href`:
- Border `orange-300`
- Shadow tăng cấp (subtle → md)
- Title text → cam
- Image scale 1.05 (`group-hover:scale-105`)
- Arrow icon translate-x

Cards không có `href` (TestimonialCard, StatCard): static.

## Heavy animation (BorderBeam) — only CourseCard

`<CourseCard>` có Magic UI BorderBeam vì là high-conversion element. Các cards khác keep tối giản.
