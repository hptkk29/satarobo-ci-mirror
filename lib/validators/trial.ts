import { z } from "zod";

// =============================================================================
// TRIAL CLASS VALIDATORS — Phase T1.4
// =============================================================================

const nullableStr = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

export const trialClassStatusSchema = z.enum([
  "SCHEDULED",
  "CONFIRMED",
  "ATTENDED",
  "MISSED",
  "POSTPONED",
  "ENROLLED",
  "REJECTED",
]);

export const childGraspSchema = z.enum(["EXCELLENT", "GOOD", "AVERAGE", "POOR"]);

export const trialUpdateSchema = z.object({
  scheduledAt: z
    .string()
    .refine((v) => !Number.isNaN(new Date(v).getTime()), "Lịch không hợp lệ"),
  status: trialClassStatusSchema,
  teacherId: nullableStr,
  roomId: nullableStr,
  classId: nullableStr,
  notes: nullableStr,
});
export type TrialUpdateInput = z.infer<typeof trialUpdateSchema>;

export const trialFeedbackSchema = z.object({
  childEnjoyed: z.boolean().optional().nullable(),
  childGrasp: childGraspSchema.optional().nullable(),
  teacherSuggestion: nullableStr,
  parentFeedback: nullableStr,
  recommendedCourseId: nullableStr,
});
export type TrialFeedbackInput = z.infer<typeof trialFeedbackSchema>;
