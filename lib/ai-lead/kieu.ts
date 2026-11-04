// lib/ai-lead/kieu.ts — KIỂU dùng chung của AI Lead Gateway. THUẦN. Mọi union suy từ hằng ở `hop-dong.ts` (một nguồn).
// Kiểu của request/response suy từ zod ở `schemas.ts` (`z.infer`) — tệp này KHÔNG khai lại.
import type {
  CAPABILITIES,
  DETAIL_CODES,
  FB_NAME_SOURCES,
  HANDOFF_REASONS,
  HANH_DONG_HANDOFF,
  HANH_DONG_LEAD_INTAKE,
  INCIDENT_CATEGORIES,
  INTENTS,
  MOI_TRUONG,
  OWNER_MODE,
  SEVERITIES,
  TRANG_THAI_CONTRACT,
  TRANG_THAI_HANDOFF,
  TRANG_THAI_LEAD_INTAKE,
  TRANG_THAI_PAGE,
  TRUONG_HOI_TIEP,
} from "./hop-dong";

export type Intent = (typeof INTENTS)[number];
export type FbNameSource = (typeof FB_NAME_SOURCES)[number];
export type HandoffReason = (typeof HANDOFF_REASONS)[number];
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];
export type Severity = (typeof SEVERITIES)[number];
export type DetailCode = (typeof DETAIL_CODES)[number];
export type Capability = (typeof CAPABILITIES)[number];
export type MoiTruong = (typeof MOI_TRUONG)[number];
export type TrangThaiContract = (typeof TRANG_THAI_CONTRACT)[number];
export type TrangThaiPage = (typeof TRANG_THAI_PAGE)[number];

export type TrangThaiLeadIntake = (typeof TRANG_THAI_LEAD_INTAKE)[number];
export type HanhDongLeadIntake = (typeof HANH_DONG_LEAD_INTAKE)[number];
export type TruongHoiTiep = (typeof TRUONG_HOI_TIEP)[number];

export type TrangThaiHandoff = (typeof TRANG_THAI_HANDOFF)[number];
export type OwnerMode = (typeof OWNER_MODE)[number];
export type HanhDongHandoff = (typeof HANH_DONG_HANDOFF)[number];

/** Trạng thái nội bộ của hội thoại (design §4.2) — ĐỒNG BỘ với enum Prisma `AiLeadOwnerState` (lưới [AIL-KT-01]). */
export type OwnerState = "AI_ACTIVE" | "HANDOFF_REQUESTED" | "TAKEOVER_PENDING" | "HUMAN_ACTIVE" | "PAUSED";

/** Một cơ sở trong catalog của MỘT Page (đúng hình `CatalogCampus` của hợp đồng). */
export type CoSoCatalog = {
  campusCode: string;
  name: string;
  address: string;
  acceptingLeads: boolean;
};

/** Phản hồi quyết định của `/lead-intakes` — KHÔNG có `receiptId`/`meta` (thêm ở tầng route). */
export type QuyetDinhLeadIntake =
  | { status: "ACCEPTED"; nextAction: "ACKNOWLEDGE_GENERIC" }
  | { status: "NEED_INFO"; nextAction: "ASK_FIELDS"; askFields: readonly TruongHoiTiep[] }
  | { status: "HUMAN_QUEUED"; nextAction: "TELL_STAFF_WILL_CONTACT" }
  | { status: "INVALID_SELECTION"; nextAction: "RE_ASK_CAMPUS"; refreshCatalog: true };
