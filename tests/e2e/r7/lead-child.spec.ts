/**
 * R7-01 — Lead có N con (LeadChild) + guard chuyển trạng thái sang DA_DANG_KY.
 * Postgres LOCAL (.env.test).
 *
 * - Tạo 1 lead + N LeadChild (quan hệ 1-N + cascade khi xoá lead).
 * - Cổng tiền trước khi chốt: `evaluatePaymentGuard` (convert v2).
 *
 * GĐ5 (25/08/2026) — nhánh chặn trong `canTransitionLeadStatus` ĐÃ GỠ: sau khi gộp
 *   ENROLLED vào DA_DANG_KY, nhánh đó chặn luôn đường convert hợp lệ. Điều nghiệp vụ
 *   cần bảo vệ ("chưa ghi nhận tiền thì không chốt") không đổi, chỉ dời chỗ sang
 *   `evaluatePaymentGuard`; ca 05/06 đã viết lại theo cổng mới.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import { canTransitionLeadStatus } from "../../../lib/leads/status";
import { evaluatePaymentGuard } from "../../../lib/crm/convert-lead-v2";
import { leadChildSchema } from "../../../lib/validators/lead";

test.describe("[R7-01] LeadChild + transition guard", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[R7-01-01] 1 lead có N LeadChild (1-N) + đọc kèm children", async () => {
    const lead = await db.lead.create({
      data: {
        parentName: "Chị Hoa",
        phone: "0911111111",
        status: "MOI",
        children: {
          create: [
            { fullName: "Bé An", ageYears: 8 },
            { fullName: "Bé Bình", ageYears: 10 },
            { fullName: "Bé Châu", ageYears: 6, trialStatus: "SCHEDULED" },
          ],
        },
      },
      include: { children: true },
    });
    expect(lead.children).toHaveLength(3);
    expect(lead.children.map((c) => c.fullName).sort()).toEqual(["Bé An", "Bé Bình", "Bé Châu"]);
    expect(lead.children.every((c) => c.leadId === lead.id)).toBe(true);
  });

  test("[R7-01-02] xoá lead → cascade xoá LeadChild", async () => {
    const lead = await db.lead.create({
      data: { parentName: "Anh Tú", phone: "0922222222", children: { create: [{ fullName: "Bé X" }] } },
      include: { children: true },
    });
    expect(await db.leadChild.count({ where: { leadId: lead.id } })).toBe(1);
    await db.lead.delete({ where: { id: lead.id } });
    expect(await db.leadChild.count({ where: { leadId: lead.id } })).toBe(0);
  });

  test("[R7-01-03] leadChildSchema: thiếu fullName → invalid; hợp lệ → default trialStatus NONE", () => {
    expect(leadChildSchema.safeParse({ fullName: "" }).success).toBe(false);
    const ok = leadChildSchema.safeParse({ fullName: "Bé Y", ageYears: 7 });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.trialStatus).toBe("NONE");
  });

  // ─── GĐ5 — cổng tiền dời chỗ, lưới đi theo ────────────────────────────────
  //
  // Ba ca 04/05/06 trước đây khoá nhánh chặn trong `canTransitionLeadStatus`. Nhánh đó
  // đã gỡ (sau khi gộp ENROLLED vào DA_DANG_KY nó chặn luôn đường convert hợp lệ), nên
  // khoá nó nữa là khoá một thứ không còn tồn tại.
  //
  // Điều NGHIỆP VỤ cần bảo vệ vẫn y nguyên: KHÔNG được chốt khi chưa ghi nhận tiền.
  // Cổng thật của nó nay là `evaluatePaymentGuard` trong convert. Lưới chuyển sang đó.

  test("[R7-01-04] chuyển trạng thái nay KHÔNG còn là cổng tiền — mọi cặp đều qua", () => {
    // Ghi lại hành vi mới cho tường minh: ai đọc test này sẽ không đi tìm nhánh chặn
    // đã bị gỡ, mà biết ngay phải nhìn sang evaluatePaymentGuard.
    expect(canTransitionLeadStatus("MOI", "DA_DANG_KY").ok).toBe(true);
    expect(canTransitionLeadStatus("CHO_QUYET_DINH", "DA_MAT").ok).toBe(true);
  });

  test("[R7-01-05] CHƯA ghi nhận tiền + còn phải thu → CHẶN chốt", () => {
    const r = evaluatePaymentGuard({ hasRecordedPayment: false, totalFinalPrice: 6_000_000 });
    expect(r.ok).toBe(false);
  });

  test("[R7-01-06] đã ghi nhận tiền → MỞ chốt", () => {
    const r = evaluatePaymentGuard({ hasRecordedPayment: true, totalFinalPrice: 6_000_000 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scholarshipFull).toBe(false);
  });

  test("[R7-01-06b] học bổng toàn phần (phải thu = 0) → MỞ chốt dù chưa có khoản nào", () => {
    // Ngoại lệ có thật của nghiệp vụ: miễn 100% thì không có gì để thu.
    const r = evaluatePaymentGuard({ hasRecordedPayment: false, totalFinalPrice: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scholarshipFull).toBe(true);
  });

  test("[R7-01-07] enum DA_DANG_KY tồn tại trong DB (migration applied) — ghi/đọc được", async () => {
    const lead = await db.lead.create({
      data: { parentName: "PH Reg", phone: "0933333333", status: "DA_DANG_KY" },
      select: { status: true },
    });
    expect(lead.status).toBe("DA_DANG_KY");
  });
});
