import { describe, it, expect } from "vitest";
import { isInstallmentPlanActive } from "./installment-plan";

describe("[KHTG-01] isInstallmentPlanActive — chỉ REJECTED làm kế hoạch mất hiệu lực", () => {
  it("null (đơn không cần duyệt) → còn hiệu lực", () => {
    expect(isInstallmentPlanActive(null)).toBe(true);
    expect(isInstallmentPlanActive(undefined)).toBe(true);
  });

  it("APPROVED → còn hiệu lực", () => {
    expect(isInstallmentPlanActive("APPROVED")).toBe(true);
  });

  it("PENDING_APPROVAL → CÒN hiệu lực (đảo luật 13/09/2026)", () => {
    // Đây là cả nội dung bản vá. Luật cũ loại PENDING_APPROVAL, trong khi
    // `materializeInstallmentRequests` (đã đảo 03/08/2026) vẫn sinh phiếu thu theo đợt
    // ngay lúc lưu kế hoạch ⇒ sổ phiếu có đợt 1, còn QR in cả học phí.
    expect(isInstallmentPlanActive("PENDING_APPROVAL")).toBe(true);
  });

  it("REJECTED → MẤT hiệu lực", () => {
    // Khớp với `revertInstallmentRequests`: phiếu theo đợt bị VOID, phiếu "thu toàn
    // đơn" được dựng lại.
    expect(isInstallmentPlanActive("REJECTED")).toBe(false);
  });

  it("giá trị lạ → còn hiệu lực (fail-open có chủ đích)", () => {
    // Fail-OPEN ở đây là đúng chiều an toàn tiền: nhận đúng số tiền đợt đang tới hạn.
    // Fail-closed (coi giá trị lạ là mất hiệu lực) sẽ đòi khách đóng CẢ học phí — tức
    // lấy nhiều hơn số phải thu, hại hơn hẳn. Cổng chống lách duyệt không nằm ở đây
    // mà ở đường TỰ CHỐT đơn (`confirmSettledOrder`, `payos-ingest`).
    expect(isInstallmentPlanActive("KHONG_BIET")).toBe(true);
    expect(isInstallmentPlanActive("")).toBe(true);
  });
});
