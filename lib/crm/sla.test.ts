// R1-06 — SLA engine (THUẦN, C6.1–C6.5). Pure.
import { describe, it, expect } from "vitest";
import { evaluateSla, isLeadIdle, slaInputFromLead } from "@/lib/crm/sla";
import { canTransitionLeadStatus } from "@/lib/leads/status";

const NOW = new Date("2026-06-09T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000, H = 3_600_000, D = 86_400_000;

describe("[R1-06] evaluateSla", () => {
  it("[R1-06-C6.1] SLA-0 chưa respond > 5'", () => {
    expect(evaluateSla({ firstMessageAt: ago(6 * MIN) }, NOW)).toContain("SLA-0");
    expect(evaluateSla({ firstMessageAt: ago(4 * MIN) }, NOW)).not.toContain("SLA-0");
    expect(evaluateSla({ firstMessageAt: ago(6 * MIN), respondedAt: ago(1 * MIN) }, NOW)).not.toContain("SLA-0");
  });

  it("[R1-06-C6.2] SLA-1 chưa bàn giao > 4h", () => {
    expect(evaluateSla({ qualifiedAt: ago(5 * H) }, NOW)).toContain("SLA-1");
    expect(evaluateSla({ qualifiedAt: ago(5 * H), handedAt: ago(1 * H) }, NOW)).not.toContain("SLA-1");
  });

  it("[R1-06-C6.3] SLA-2 chưa phân công > 30' (sau tiếp nhận)", () => {
    expect(evaluateSla({ receivedConfirmedAt: ago(40 * MIN) }, NOW)).toContain("SLA-2");
    expect(evaluateSla({ handedAt: ago(40 * MIN) }, NOW)).toContain("SLA-2"); // fallback handedAt
    expect(evaluateSla({ receivedConfirmedAt: ago(40 * MIN), assignedAt: ago(5 * MIN) }, NOW)).not.toContain("SLA-2");
  });

  it("[R1-06-C6.4] SLA-3 chưa liên hệ > 3h", () => {
    expect(evaluateSla({ assignedAt: ago(4 * H) }, NOW)).toContain("SLA-3");
    expect(evaluateSla({ assignedAt: ago(4 * H), firstContactAt: ago(1 * H) }, NOW)).not.toContain("SLA-3");
  });

  it("[R1-06-C6.5] SLA-4 lead im > 2 ngày; đã xử lý → không alert", () => {
    expect(evaluateSla({ lastActivityAt: ago(3 * D) }, NOW)).toContain("SLA-4");
    expect(evaluateSla({ lastActivityAt: ago(3 * D), resolved: true }, NOW)).not.toContain("SLA-4");
  });

  it("nhiều vi phạm cùng lúc", () => {
    const r = evaluateSla({ qualifiedAt: ago(5 * H), assignedAt: ago(4 * H) }, NOW);
    expect(r).toEqual(expect.arrayContaining(["SLA-1", "SLA-3"]));
  });
});

// GĐ5 — enum rút còn 10 giá trị: bậc ASSIGNED đã gộp vào MOI (việc "đã phân công" nay
// đọc ở `Lead.assignedToId`), nên luật idle chỉ còn xét đúng một trạng thái là MOI.
describe("[R7-01-C3] isLeadIdle", () => {
  it("MOI + 13h ago vượt ngưỡng 12h → idle", () => {
    expect(isLeadIdle({ status: "MOI", lastActivityAt: ago(13 * H) }, NOW, 12)).toBe(true);
  });
  it("MOI + 13h ago dưới ngưỡng 24h → không idle", () => {
    expect(isLeadIdle({ status: "MOI", lastActivityAt: ago(13 * H) }, NOW, 24)).toBe(false);
  });
  it("status DA_LIEN_HE → không idle (ngoài MOI)", () => {
    expect(isLeadIdle({ status: "DA_LIEN_HE", lastActivityAt: ago(13 * H) }, NOW, 12)).toBe(false);
  });
  it("lastActivityAt null → không idle", () => {
    expect(isLeadIdle({ status: "MOI", lastActivityAt: null }, NOW, 12)).toBe(false);
  });
});

// ĐỔI KHẲNG ĐỊNH (GĐ5). Bản cũ khoá ba điều nay KHÔNG còn đúng:
//   - "NEW→REGISTERED → ok:false" (chặn nhảy cóc vào bậc chốt),
//   - "AWAITING_DECISION→REGISTERED chưa có khoản ghi nhận → ok:false" (cổng tiền),
//   - "REGISTERED→ENROLLED → ok:true" (tiến từ đã-đăng-ký sang đã-nhập-học).
// Cả nhánh chặn `REGISTERED` trong `canTransitionLeadStatus` ĐÃ GỠ: sau khi ENROLLED
// gộp vào DA_DANG_KY, nhánh đó chặn luôn đường convert hợp lệ. Cổng tiền thật nằm ở
// `evaluatePaymentGuard` (lib/crm/convert-lead-v2.ts) — nơi có kiểm cả ca học bổng 100%.
// Khẳng định thứ ba cũng không kiểm được nữa: REGISTERED và ENROLLED nay là CÙNG một
// giá trị, so chúng là so chính nó (no-op), đã có test no-op phủ rồi.
describe("[R7-01-C4] canTransitionLeadStatus — permissive hoàn toàn", () => {
  it("nhảy thẳng vào DA_DANG_KY → ok:true (cổng tiền không nằm ở đây)", () => {
    expect(canTransitionLeadStatus("MOI", "DA_DANG_KY", { hasRecordedPayment: true }).ok).toBe(true);
  });
  it("vào DA_DANG_KY khi chưa có khoản ghi nhận → ok:true", () => {
    expect(
      canTransitionLeadStatus("CHO_QUYET_DINH", "DA_DANG_KY", { hasRecordedPayment: false }).ok,
    ).toBe(true);
  });
  it("vào DA_DANG_KY khi đã có khoản ghi nhận → ok:true", () => {
    expect(
      canTransitionLeadStatus("CHO_QUYET_DINH", "DA_DANG_KY", { hasRecordedPayment: true }).ok,
    ).toBe(true);
  });
  it("lùi bậc CHO_QUYET_DINH→DA_LIEN_HE → ok:true (permissive)", () => {
    expect(canTransitionLeadStatus("CHO_QUYET_DINH", "DA_LIEN_HE").ok).toBe(true);
  });
  it("rớt khỏi bậc chốt DA_DANG_KY→DA_MAT → ok:true", () => {
    expect(canTransitionLeadStatus("DA_DANG_KY", "DA_MAT").ok).toBe(true);
  });
});

// Đợt A (21/08/2026) — sửa lỗi: SLA-4 "lead im lặng" từng đọc `Lead.updatedAt`,
// nên MỌI lần ghi vào lead (bật cờ dùng chung, sửa ghi chú, đổi trạng thái) đều
// reset đồng hồ. Mốc đúng là `lastActivityAt`, thiếu thì lấy `createdAt`.
describe("[Đợt A] slaInputFromLead — mốc im lặng lấy đúng cột", () => {
  const nen = {
    qualifiedAt: null,
    handedAt: null,
    receivedConfirmedAt: null,
    assignedAt: null,
    firstContactAt: null,
  };

  it("có hoạt động thật → dùng lastActivityAt", () => {
    const hoatDong = ago(3 * D);
    const out = slaInputFromLead({ ...nen, lastActivityAt: hoatDong, createdAt: ago(30 * D) });
    expect(out.lastActivityAt).toEqual(hoatDong);
  });

  it("chưa có hoạt động nào → lấy createdAt làm mốc (không bỏ sót lead bị quên)", () => {
    const tao = ago(10 * D);
    const out = slaInputFromLead({ ...nen, lastActivityAt: null, createdAt: tao });
    expect(out.lastActivityAt).toEqual(tao);
  });

  it("lead im lặng lâu → SLA-4 kêu", () => {
    const input = slaInputFromLead({ ...nen, lastActivityAt: ago(5 * D), createdAt: ago(30 * D) });
    expect(evaluateSla(input, NOW)).toContain("SLA-4");
  });

  it("vừa có hoạt động → SLA-4 im", () => {
    const input = slaInputFromLead({ ...nen, lastActivityAt: ago(1 * H), createdAt: ago(30 * D) });
    expect(evaluateSla(input, NOW)).not.toContain("SLA-4");
  });

  it("KHÔNG còn đọc updatedAt — sửa vặt trên lead không được làm im đồng hồ", () => {
    // Lead im lặng 5 ngày nhưng vừa bị ghi (updatedAt = bây giờ) ⇒ vẫn phải kêu.
    const input = slaInputFromLead({
      ...nen,
      lastActivityAt: ago(5 * D),
      createdAt: ago(30 * D),
      // @ts-expect-error — cố tình truyền thừa để chắc hàm KHÔNG đụng tới nó
      updatedAt: NOW,
    });
    expect(evaluateSla(input, NOW)).toContain("SLA-4");
  });
});
