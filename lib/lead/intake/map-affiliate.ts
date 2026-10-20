// lib/lead/intake/map-affiliate.ts — biểu mẫu đặt trên website đối tác, gửi qua link/QR/mã giới thiệu (AFF-P1, docs/source-commission/12 §2.4).
//
// Endpoint: `POST /api/public/affiliate/v1/intake`. Đây là đường CÔNG KHAI, nên lược đồ ở đây là hợp đồng bảo mật:
//   · `.strict()` — khoá lạ bị TỪ CHỐI, không lặng lẽ bỏ qua. Trình duyệt/đối tác gửi `affiliateId`, `employeeId`, `sourceId`, `rate`, `commission`… là gửi thứ máy chủ KHÔNG BAO GIỜ tin;
//     im lặng nhận phần còn lại sẽ làm người viết biểu mẫu tưởng rằng chúng có tác dụng.
//   · Mọi thứ quyết định nguồn / người hưởng / tiền (đối tác, membership, campaign, nguồn, thời hạn bảo vệ) đọc lại từ DB theo `token` ở `lib/affiliate/nhan-referral.ts`.
//   · `idempotencyKey` do trình duyệt sinh MỘT LẦN cho mỗi biểu mẫu (gửi lặp / bấm đúp / mạng chập chờn không đẻ lead hai lần).
//   · `hp` — ô ẩn chống bot (người thật luôn để rỗng).
//
// Mapper THUẦN: không DB. Trả `MappedLead` cho `ingestIntakeLead` (cùng đường ghi lead duy nhất của mọi nguồn ngoài).
import { z } from "zod";
import { canonicalPhone } from "@/lib/phone";
import { centerHintFromCode, parentNameFallback, str } from "./normalize";
import type { MapResult } from "./types";

export const AFFILIATE_HONEYPOT = "hp";

/** Nguồn kỹ thuật ghi vào `Lead.source` / `IntakeContext.source`. Không nằm trong `DUONG_VAO_MAC_DINH` có chủ đích: referral không hợp lệ ⇒ rơi UNKNOWN (xem tay), không bị gắn nhầm «Quảng cáo». */
export const NGUON_KY_THUAT_AFFILIATE = "affiliate";

const chuoi = (max: number) => z.string().max(max).optional();

export const affiliateIntakeSchema = z
  .object({
    v: z.literal(1).optional(),
    token: z.string().min(1).max(40),
    /** Id lượt bấm do `/r/:token` truyền qua `clk`. Tuỳ chọn; máy chủ kiểm nó thuộc đúng link. */
    clickId: z.string().max(40).nullish(),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Khoá chống gửi lặp không hợp lệ."),
    parentName: chuoi(100),
    phone: z.string().min(1).max(20),
    email: chuoi(120),
    children: z
      .array(z.object({ fullName: z.string().max(100), schoolName: chuoi(150), gradeLevel: chuoi(50) }).strict())
      .max(5)
      .optional(),
    centerCode: chuoi(20),
    note: chuoi(500),
    consentMarketing: z.boolean().optional(),
    utm: z.record(z.string().max(40), z.string().max(200)).optional(),
    [AFFILIATE_HONEYPOT]: chuoi(200),
  })
  .strict();

export type DauVaoAffiliateIntake = z.infer<typeof affiliateIntakeSchema>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** `eventId` của lead = khoá chống gửi lặp (Lead.eventId UNIQUE). Tiền tố tách khỏi mọi nguồn khác. */
export function eventIdAffiliate(idempotencyKey: string): string {
  return `${NGUON_KY_THUAT_AFFILIATE}:${idempotencyKey}`;
}

export function mapAffiliateIntake(input: DauVaoAffiliateIntake): MapResult {
  const phone = canonicalPhone(input.phone);
  if (!phone) return { ok: false, error: "Số điện thoại không hợp lệ." };

  const warnings: string[] = [];
  const noteLines: string[] = [];

  const children: { fullName: string; schoolName: string | null; gradeLevel: string | null }[] = [];
  for (const c of input.children ?? []) {
    const ten = str(c.fullName);
    if (!ten) continue;
    const khoa = (x: string) => x.trim().replace(/\s+/g, " ").toLowerCase();
    if (children.some((x) => khoa(x.fullName) === khoa(ten))) continue;
    children.push({ fullName: ten, schoolName: str(c.schoolName), gradeLevel: str(c.gradeLevel) });
  }

  let parentName = str(input.parentName) ?? "";
  if (!parentName) {
    parentName = parentNameFallback(children[0]?.fullName ?? null);
    warnings.push("Phiếu không có tên phụ huynh — cần hỏi lại khi gọi.");
  }

  const emailTho = str(input.email);
  const email = emailTho && EMAIL_RE.test(emailTho) ? emailTho : null;
  if (emailTho && !email) warnings.push(`Email "${emailTho}" không đọc được — chưa lưu.`);

  const note = str(input.note);
  if (note) noteLines.push(note);

  return {
    ok: true,
    lead: {
      parentName,
      phone,
      email,
      facebookUrl: null,
      leadSource: null,
      centerHint: centerHintFromCode(input.centerCode),
      children: children.map((c) => ({ fullName: c.fullName, schoolName: c.schoolName, gradeLevel: c.gradeLevel, interestedCourseId: null })),
      employeeCode: null,
      noteLines,
      // Đồng ý nhận tin do KHÁCH tick — mặc định KHÔNG (khác biểu mẫu nội bộ, nơi nhân viên nhập hộ).
      consentMarketing: input.consentMarketing === true,
      externalId: null,
      warnings,
    },
  };
}
