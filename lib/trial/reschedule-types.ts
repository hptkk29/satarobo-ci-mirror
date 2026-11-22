// lib/trial/reschedule-types.ts — GĐ3.
//
// Type chuỗi thuần cho luật dời lịch. Tách khỏi `@prisma/client` để
// `reschedule-rules.ts` test được mà không phải nạp Prisma Client.
// Giá trị khớp đúng enum trong schema; lệch là test enum sẽ bắt.

export type TrialEnrollmentStatusV2 = "ACTIVE" | "COMPLETED" | "WITHDRAWN";
export type TrialSessionStatusV2 = "SCHEDULED" | "COMPLETED" | "CANCELLED";
