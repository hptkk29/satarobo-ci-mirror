// FL2-03 — Validate bàn giao (transfer) lead: chặn chọn cơ sở/sale đích TRÙNG nguồn.
// THUẦN (testable Vitest). Lỗi trả về theo format dự án {code EN, message VI}.
// Quy tắc: bàn giao phải THỰC SỰ đổi tay — đổi sale HOẶC đổi cơ sở. Nếu sale đích =
// sale nguồn → vô nghĩa; nếu cơ sở không đổi mà cũng không đổi sale → không có gì để
// bàn giao.

export type TransferTargetError = { code: string; message: string };

/**
 * @param fromCenterId cơ sở hiện tại của lead (null = chưa rõ)
 * @param fromSaleId   sale đang phụ trách (null = chưa gán)
 * @param toCenterId   cơ sở đích đã chuẩn hoá (rỗng = giữ nguyên)
 * @param toSaleId     sale đích đã chọn (rỗng = chia theo chế độ cơ sở mới)
 */
export function validateTransferTarget(input: {
  fromCenterId: string | null;
  fromSaleId: string | null;
  toCenterId: string | null;
  toSaleId: string | null;
}): { ok: true } | { ok: false; error: TransferTargetError } {
  const toCenter = input.toCenterId || input.fromCenterId || null;
  const centerChanged = !!toCenter && toCenter !== input.fromCenterId;

  // 1) Sale đích trùng sale nguồn → chặn (dù có đổi cơ sở hay không).
  if (input.toSaleId && input.toSaleId === input.fromSaleId) {
    return {
      ok: false,
      error: {
        code: "SAME_SALE",
        message: "Sale nhận phải khác sale đang phụ trách — không thể bàn giao cho chính mình.",
      },
    };
  }

  // 2) Không chỉ định sale mới VÀ không đổi cơ sở → không có gì để bàn giao.
  if (!input.toSaleId && !centerChanged) {
    return {
      ok: false,
      error: {
        code: "NO_CHANGE",
        message: "Cơ sở và sale đích trùng nguồn — chọn cơ sở khác hoặc sale khác để bàn giao.",
      },
    };
  }

  return { ok: true };
}

/**
 * Sale NHẬN khi chuyển lead có chỉ định người (01/10/2026). Trước đây `transferLead` chỉ kiểm
 * vai SALES_CSM — nên chuyển sang một sale ĐÃ NGHỈ, hoặc sale thuộc cơ sở KHÁC cơ sở đích, đều
 * lọt: lead nằm ở cơ sở A mà chủ là người cơ sở B ⇒ scopedDb lọc mất, người nhận mở không ra.
 * Cùng luật với gán tay (`lib/lead/assign-guard.ts`): còn làm việc + đúng cơ sở của lead.
 */
export function validateTransferRecipient(input: {
  sale: { isActive: boolean; centerId: string | null } | null;
  toCenterId: string | null;
}): { ok: true } | { ok: false; error: TransferTargetError } {
  if (!input.sale) {
    return { ok: false, error: { code: "RECIPIENT_INVALID", message: "Sale nhận không hợp lệ." } };
  }
  if (!input.sale.isActive) {
    return {
      ok: false,
      error: { code: "RECIPIENT_INACTIVE", message: "Sale nhận đã nghỉ việc — chọn người khác." },
    };
  }
  if (!input.toCenterId || input.sale.centerId !== input.toCenterId) {
    return {
      ok: false,
      error: {
        code: "RECIPIENT_WRONG_CENTER",
        message: "Sale nhận không thuộc cơ sở đích — chọn sale của đúng cơ sở lead sẽ chuyển tới.",
      },
    };
  }
  return { ok: true };
}
