// lib/ai-lead/cai-dat.ts — ĐỌC tham số vận hành `ai.*` của AI Lead Gateway (registry: lib/settings/registry.ts, nhãn: nhan-van-hanh.ts).
//
// Mọi ngưỡng là THAM SỐ (OD-04), đọc bằng `getSetting` — không hằng ở chỗ dùng. Hằng bất biến duy nhất là `AN_TOAN_CUNG` (hop-dong.ts).
// Giá trị trong DB hỏng schema ⇒ `getSetting` tự rơi về mặc định (resolve.ts), nên tệp này không phải tự kiểm lại kiểu.
//
// ⚠️ CỔNG PROD (OD-08) — `ai.prodEnabled` + `ai.consentPolicyStatus`:
//   · Agent môi trường PROD chỉ được phục vụ khi `prodEnabled === true` VÀ `consentPolicyStatus === "APPROVED"`; thiếu một ⇒ chặn (`congProd`).
//   · FAIL-CLOSED ở mọi nhánh: không đọc được cài đặt ⇒ chặn; giá trị lạ ⇒ chặn; chỉ đúng hai giá trị trên mới mở.
//   · QUYỀN SỬA hai khoá này: registry KHÔNG có cơ chế quyền theo TỪNG khoá (chỉ `centerOverridable`/`qlcsSuaDuoc`, không có `quyenSua`). Hai khoá đều
//     `centerOverridable: false` nên chỉ đi qua `setGlobalSetting`, mà hàm đó đòi `actor.isSuperAdmin` — và `ai-leads:policy` chỉ seed cho SUPER_ADMIN, nghĩa là
//     HAI CỬA CÙNG MỘT NGƯỜI. Hệ quả cần biết: nếu sau này cấp `ai-leads:policy` cho vai khác, vai đó vẫn KHÔNG sửa được hai khoá này qua màn Cấu hình vận
//     hành (an toàn, nhưng quyền "nằm trên giấy"). Muốn thật sự tách, phải thêm cổng riêng ở Server Action của màn Cấu hình — việc của lát K, đã ghi trong báo cáo.
import { laProductionThat, type BienMoiTruong } from "@/lib/security/client-ip";
import { getSetting } from "@/lib/settings/service";
import { AN_TOAN_CUNG } from "./hop-dong";

export type CaiDatAiLead = {
  heartbeatSeconds: number;
  staleMultiplier: number;
  rateCatalogPerMin: number;
  rateIntakePerMin: number;
  rateIntakePerPsidPerMin: number;
  rateControlPerMin: number;
  rateNewConversationsPerDayPerPage: number;
  bodyMaxBytes: number;
  clockSkewMs: number;
  nonceTtlMinutes: number;
  catalogMaxAgeSeconds: number;
  probeTtlMinutes: number;
  slaClaimMinutes: number;
  slaResolveMinutes: number;
  draftExpireHours: number;
  queueMaxAgeHours: number;
  verifyTtlHours: number;
  disconnectHours: number;
  requestRetentionDays: number;
  rejectLogEnabled: boolean;
  rejectLogRetentionDays: number;
  prodEnabled: boolean;
  consentPolicyStatus: "PENDING_LEGAL" | "APPROVED";
  takeoverNeedsAgentConfirmation: boolean;
  autoCreateEnabled: boolean;
  inboxLinkTemplate: string;
};

/** Đọc TOÀN BỘ tham số một lượt (song song). Chỉ cấp toàn hệ thống — các khoá `ai.*` không override theo cơ sở. */
export async function docCaiDat(): Promise<CaiDatAiLead> {
  const [
    heartbeatSeconds, staleMultiplier, rateCatalogPerMin, rateIntakePerMin, rateIntakePerPsidPerMin, rateControlPerMin,
    rateNewConversationsPerDayPerPage, bodyMaxBytes, clockSkewMs, nonceTtlMinutes, catalogMaxAgeSeconds,
    probeTtlMinutes, slaClaimMinutes, slaResolveMinutes, draftExpireHours, queueMaxAgeHours,
    verifyTtlHours, disconnectHours, requestRetentionDays, rejectLogEnabled, rejectLogRetentionDays,
    prodEnabled, consentPolicyStatus, takeoverNeedsAgentConfirmation, autoCreateEnabled, inboxLinkTemplate,
  ] = await Promise.all([
    getSetting("ai.heartbeatSeconds"),
    getSetting("ai.staleMultiplier"),
    getSetting("ai.rate.catalogPerMin"),
    getSetting("ai.rate.intakePerMin"),
    getSetting("ai.rate.intakePerPsidPerMin"),
    getSetting("ai.rate.controlPerMin"),
    getSetting("ai.rate.newConversationsPerDayPerPage"),
    getSetting("ai.bodyMaxBytes"),
    getSetting("ai.clockSkewMs"),
    getSetting("ai.nonceTtlMinutes"),
    getSetting("ai.catalogMaxAgeSeconds"),
    getSetting("ai.probeTtlMinutes"),
    getSetting("ai.slaClaimMinutes"),
    getSetting("ai.slaResolveMinutes"),
    getSetting("ai.draftExpireHours"),
    getSetting("ai.queueMaxAgeHours"),
    getSetting("ai.verifyTtlHours"),
    getSetting("ai.disconnectHours"),
    getSetting("ai.requestRetentionDays"),
    getSetting("ai.rejectLogEnabled"),
    getSetting("ai.rejectLogRetentionDays"),
    getSetting("ai.prodEnabled"),
    getSetting("ai.consentPolicyStatus"),
    getSetting("ai.takeoverNeedsAgentConfirmation"),
    getSetting("ai.autoCreateEnabled"),
    getSetting("ai.inboxLinkTemplate"),
  ]);
  return {
    heartbeatSeconds, staleMultiplier, rateCatalogPerMin, rateIntakePerMin, rateIntakePerPsidPerMin, rateControlPerMin,
    rateNewConversationsPerDayPerPage, bodyMaxBytes, clockSkewMs, nonceTtlMinutes, catalogMaxAgeSeconds,
    probeTtlMinutes, slaClaimMinutes, slaResolveMinutes, draftExpireHours, queueMaxAgeHours,
    verifyTtlHours, disconnectHours, requestRetentionDays, rejectLogEnabled, rejectLogRetentionDays,
    prodEnabled, consentPolicyStatus, takeoverNeedsAgentConfirmation, autoCreateEnabled, inboxLinkTemplate,
  };
}

// ─── Suy ra từ tham số (THUẦN — test không cần DB) ───────────────────────────────────────────────────────────────────────

/** Trần thân hiệu lực: tham số nhưng KHÔNG BAO GIỜ vượt trần cứng tuyệt đối (cấu hình sai cũng không mở được thân khổng lồ). */
export function tranThanHieuLuc(c: Pick<CaiDatAiLead, "bodyMaxBytes">): number {
  return Math.min(c.bodyMaxBytes, AN_TOAN_CUNG.tranThanTuyetDoiByte);
}

/**
 * Thời gian nhớ nonce hiệu lực (ms): `max(ai.nonceTtlMinutes, 2 × ai.clockSkewMs)`. Một request hợp lệ còn dùng lại được trong cửa sổ `[ts−skew, ts+skew]`
 * (rộng 2×skew); nhớ nonce NGẮN HƠN cửa sổ đó là để hở khe phát lại — nên hai tham số không được cấu hình lệch nhau.
 */
export function nonceTtlHieuLucMs(c: Pick<CaiDatAiLead, "nonceTtlMinutes" | "clockSkewMs">): number {
  return Math.max(c.nonceTtlMinutes * 60_000, 2 * c.clockSkewMs);
}

/** Agent im lặng quá chừng này ⇒ STALE (= `ai.staleMultiplier` × nhịp, hợp đồng: mặc định 3 × 60 = 180 giây). */
export function nguongMatKetNoiMs(c: Pick<CaiDatAiLead, "heartbeatSeconds" | "staleMultiplier">): number {
  return c.heartbeatSeconds * c.staleMultiplier * 1000;
}

export type LyDoCongProd = "OK" | "PROD_CHUA_BAT" | "CHINH_SACH_CHUA_DUYET" | "PROD_CHUA_BAT_VA_CHINH_SACH_CHUA_DUYET" | "KHONG_DOC_DUOC_CAI_DAT";
export type KetQuaCongProd = {
  allowed: boolean;
  reason: LyDoCongProd;
  /** Khoá còn thiếu để mở cổng (hiển thị ở Trung tâm kết nối: `BLOCKED_BY_OWNER`). */
  thieu: readonly ("ai.prodEnabled" | "ai.consentPolicyStatus")[];
};

/**
 * Cổng PROD (OD-08), phần THUẦN. Mở ⇔ `prodEnabled === true` VÀ `consentPolicyStatus === "APPROVED"`. Mọi giá trị khác (kể cả truthy như "true",
 * 1, "APPROVED " có khoảng trắng) ⇒ ĐÓNG. Tham số nhận `unknown` để một giá trị sai kiểu lọt từ tầng trên vẫn bị chặn.
 */
export function tinhCongProd(x: { prodEnabled: unknown; consentPolicyStatus: unknown }): KetQuaCongProd {
  const prodOk = x.prodEnabled === true;
  const chinhSachOk = x.consentPolicyStatus === "APPROVED";
  if (prodOk && chinhSachOk) return { allowed: true, reason: "OK", thieu: [] };
  if (!prodOk && !chinhSachOk) {
    return { allowed: false, reason: "PROD_CHUA_BAT_VA_CHINH_SACH_CHUA_DUYET", thieu: ["ai.prodEnabled", "ai.consentPolicyStatus"] };
  }
  return prodOk
    ? { allowed: false, reason: "CHINH_SACH_CHUA_DUYET", thieu: ["ai.consentPolicyStatus"] }
    : { allowed: false, reason: "PROD_CHUA_BAT", thieu: ["ai.prodEnabled"] };
}

/**
 * FIX-03 — Agent `environment = TEST` có được chạy trên MÁY CHỦ NÀY không. FAIL-CLOSED: chỉ cho khi máy chủ KHÔNG phải production thật (dev · CI · preview/test).
 * Đo 28/10/2026 trên VPS (chỉ đọc, không in bí mật): PROD đặt `VERCEL_ENV=production`; TEST đặt `VERCEL_ENV=preview` + URL `test.satarobo.vn`. Cố ý KHÔNG thêm vế
 * "host là test.*" để cho phép: một biến URL lạc trên PROD sẽ mở cổng (hướng sai của lỗi). Quyết định dựa vào biến môi trường CỦA MÁY CHỦ, TUYỆT ĐỐI không
 * dựa vào một trường client gửi: `environment` của heartbeat/lead chỉ được SO với khoá (ENVIRONMENT_MISMATCH), không bao giờ là nguồn sự thật về nơi chạy.
 * Lý do tồn tại: Agent TEST không đi qua cổng PROD (`congProd`) nên nếu tạo được trên admin PROD thì nó tạo lead THẬT mà không cần duyệt chính sách.
 */
export function agentTestDuocChayTrenMayChu(env: BienMoiTruong = process.env): boolean {
  // DANH SÁCH CHO PHÉP, không phải phủ định `!laProductionThat`: biến khai sai kiểu («Production», «production » có khoảng trắng, «prod») sẽ lọt vế phủ định.
  // `VERCEL_ENV` có mặt ⇒ chỉ ba giá trị không-phải-production CHÍNH XÁC (đã chuẩn hoá hoa/thường + khoảng trắng); giá trị lạ ⇒ KHÔNG cho (coi như production).
  const v = env.VERCEL_ENV?.trim().toLowerCase();
  if (v) return v === "preview" || v === "development" || v === "test";
  return !laProductionThat(env);
}

export const LOI_AGENT_TEST_TREN_PROD =
  "Agent TEST không được tạo hoặc chạy trên hệ thống PROD — dùng Agent PROD (qua cổng PROD) hoặc làm việc trên môi trường TEST.";

/**
 * Cổng PROD đọc từ cài đặt. FAIL-CLOSED: lỗi đọc cài đặt ⇒ `allowed: false` (route PROD trả 503, không phải 5xx lạ). Chỉ gọi cho agent
 * `environment = PROD`; agent TEST không đi qua cổng này.
 */
export async function congProd(): Promise<KetQuaCongProd> {
  try {
    const [prodEnabled, consentPolicyStatus] = await Promise.all([getSetting("ai.prodEnabled"), getSetting("ai.consentPolicyStatus")]);
    return tinhCongProd({ prodEnabled, consentPolicyStatus });
  } catch {
    // KHÔNG log nội dung lỗi ở đây (lỗi Prisma có thể kèm giá trị cột) — chỗ gọi tự ghi `requestId` + mã.
    return { allowed: false, reason: "KHONG_DOC_DUOC_CAI_DAT", thieu: ["ai.prodEnabled", "ai.consentPolicyStatus"] };
  }
}
