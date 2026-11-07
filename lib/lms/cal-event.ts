// lib/lms/cal-event.ts — kiểu MỘT sự kiện trên lịch tháng.
//
// Tách khỏi `components/lms/month-calendar.tsx` (05/09/2026) vì ô ngày nay là client
// component: import kiểu từ file server component sẽ kéo cả module đó vào bundle
// trình duyệt. Kiểu thuần thì không kéo gì cả.
export type CalEvent = { iso: string; label: string; sublabel?: string };
