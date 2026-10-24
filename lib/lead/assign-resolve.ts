// lib/lead/assign-resolve.ts — LEAD NÀY VỀ TAY AI, VÀ LƯỢT CÓ BỊ TIÊU KHÔNG.
//
// Hàm THUẦN: không DB, không auth, không `new Date()`. Mọi thứ cần biết (người nhập là
// ai, có phải sale không, mã aff tra ra ai, đã có lead trùng SĐT chưa) đều do caller tra
// sẵn rồi truyền vào. Nhờ vậy ma trận 11 dòng kiểm được bằng test chạy trong 5ms, không
// cần Postgres — xem `assign-resolve.test.ts`.
//
// ═══════════════════════════════════════════════════════════════════════════════
// HAI Ý TRỤ CỘT, đừng sửa mà không đọc:
//
//  1. **Cơ sở đích LUÔN là cơ sở KHÁCH chọn**, không phải cơ sở của người nhập. Sale
//     CS1 nhập phiếu cho khách chọn CS2 thì lead thuộc pool CS2. Không có ngoại lệ.
//
//  2. **Chỉ nhánh AUTO tiêu lượt.** Đây là lý do cột "Lượt đã nhận" trong màn quản lý
//     luôn THẤP HƠN "Tổng lead đang giữ", và đó không phải lỗi: lead sale tự nhập, lead
//     quản lý giao tay, lead import có sẵn tên sale — không cái nào tiêu lượt của vòng.
//     Cho chúng tiêu lượt thì ai chăm nhập tay sẽ bị vòng chia "trừ" lại, tức là phạt
//     đúng người làm nhiều.
// ═══════════════════════════════════════════════════════════════════════════════

/** Lead vào hệ thống bằng đường nào. */
export type LeadEntryPoint = "FORM" | "IMPORT" | "LANDING" | "MANAGER" | "RESHUFFLE";

/** Người mà mã affiliate trên landing page tra ra được. `null` = không có/mã sai. */
export type AffiliateActor = {
  userId: string;
  /** `User.centerId`. Null là dữ liệu THẬT đang có trên prod — phải xử lý. */
  centerId: string | null;
  /** Có giữ vai sale không. Marketing/GV phát link vẫn tra ra người, nhưng không nhận lead. */
  isSale: boolean;
};

export type ResolveAssignmentInput = {
  /** Cơ sở KHÁCH chọn trên biểu mẫu — đích của mọi quyết định dưới đây. */
  targetCenterId: string;
  /** User đang đăng nhập. `null` khi phiếu tới từ landing page công khai. */
  createdById: string | null;
  /** `User.centerId` của người nhập. */
  createdByCenterId: string | null;
  /** Người nhập có giữ vai sale không. */
  createdByIsSale: boolean;
  entryPoint: LeadEntryPoint;
  /**
   * Chủ lead đã CHỈ ĐỊNH SẴN: cột sale trong file Excel, hoặc người quản lý chọn khi
   * giao tay. Caller phải tra ra tài khoản THẬT trước khi truyền; không khớp ⇒ `null`.
   * Hàm này không đoán ai là ai.
   */
  explicitOwnerId?: string | null;
  /** Mã affiliate đã tra. Chỉ có nghĩa ở `entryPoint = "LANDING"`. */
  aff?: AffiliateActor | null;
  /**
   * Lead CŨ trùng SĐT (đã chuẩn hoá `84…`) và CHƯA soft-delete. Caller tra trước.
   * `ownerId` có thể null: lead cũ đang "Chưa phân công".
   */
  duplicateOf?: { leadId: string; ownerId: string | null } | null;
};

/** `AUTO` = giao cho vòng luân phiên chọn người; các nhánh còn lại đã biết chủ. */
export type AssignmentDecision =
  | {
      kind: "DUPLICATE";
      leadId: string;
      ownerId: string | null;
      source: "DUPLICATE";
      consumedTurn: false;
    }
  | {
      kind: "OWNER";
      ownerId: string;
      source: "SELF" | "MANAGER" | "IMPORT" | "AFFILIATE";
      consumedTurn: false;
    }
  | { kind: "AUTO"; source: "AUTO"; consumedTurn: true };

const AUTO: AssignmentDecision = { kind: "AUTO", source: "AUTO", consumedTurn: true };

/**
 * Hai cơ sở có phải MỘT không.
 *
 * `null` KHÔNG BAO GIỜ khớp — kể cả `null === null`. `User.centerId` bỏ trống là dữ
 * liệu thật trên prod; coi hai giá trị trống là "cùng cơ sở" thì lead sẽ được gán cho
 * người không thuộc cơ sở nào, và cách ly cơ sở thủng ngay tại cửa.
 */
function cungCoSo(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a === b;
}

/**
 * Quyết định chủ lead + có tiêu lượt không. Xem bảng 11 dòng trong test cùng tên.
 *
 * Ném lỗi ĐÚNG MỘT trường hợp: quản lý bấm giao tay mà không chọn người. Rơi xuống
 * AUTO ở đó là nút bấm hụt vẫn báo thành công còn lead thì đi đâu không ai biết.
 */
export function resolveAssignment(input: ResolveAssignmentInput): AssignmentDecision {
  // ── [11] TRÙNG SĐT — chạy TRƯỚC tất cả ─────────────────────────────────────
  // Đặt sau bất kỳ quy tắc nào là mở đường cướp lead: gõ lại số của khách rồi bấm
  // lưu, phiếu về tay người vừa gõ. Trùng thì giữ nguyên chủ cũ, không đụng bộ đếm.
  if (input.duplicateOf) {
    return {
      kind: "DUPLICATE",
      leadId: input.duplicateOf.leadId,
      ownerId: input.duplicateOf.ownerId,
      source: "DUPLICATE",
      consumedTurn: false,
    };
  }

  switch (input.entryPoint) {
    // ── CHIA LẠI theo cấu hình cơ sở (nút "Chia lại lead", 03/09/2026) ───────
    // LUÔN về vòng chia, kể cả khi lead đã có chủ và kể cả khi người bấm là sale
    // của chính cơ sở đó. Đây là điểm khác biệt với `FORM`: ở đó "sale đúng cơ sở
    // tự nhập" được giữ phiếu của mình (ca [1]), còn ở đây quản lý đang CỐ Ý yêu
    // cầu rút thăm lại — giữ nguyên chủ cũ thì nút không làm gì cả, đúng lỗi đã
    // gặp: báo "đã chia lại" mà lead không đổi tay.
    //
    // Mã aff cũng bị bỏ qua vì cùng lý do như `FORM`.
    case "RESHUFFLE":
      return AUTO;

    // ── [4] Quản lý giao tay / đổi chủ ───────────────────────────────────────
    case "MANAGER": {
      if (!input.explicitOwnerId) {
        throw new Error("Giao tay phải chỉ định NGƯỜI NHẬN — không có thì không giao.");
      }
      return {
        kind: "OWNER",
        ownerId: input.explicitOwnerId,
        source: "MANAGER",
        consumedTurn: false,
      };
    }

    // ── [5] / [6] Import Excel ───────────────────────────────────────────────
    case "IMPORT": {
      // Cột sale trong file THẮNG mọi thứ khác (kể cả mã aff dính kèm trong dữ liệu
      // cũ): người nhập file đã nói rõ ai giữ phiếu nào.
      if (input.explicitOwnerId) {
        return {
          kind: "OWNER",
          ownerId: input.explicitOwnerId,
          source: "IMPORT",
          consumedTurn: false,
        };
      }
      return AUTO;
    }

    // ── [1] / [2] / [3] Biểu mẫu nội bộ ──────────────────────────────────────
    case "FORM": {
      // Mã aff CỐ Ý bị bỏ qua ở đây: không bỏ thì ai cũng ép được lead về tay mình
      // bằng cách thêm `?ref=` vào đường dẫn biểu mẫu nội bộ.
      const laSaleDungCoSo =
        !!input.createdById &&
        input.createdByIsSale &&
        cungCoSo(input.createdByCenterId, input.targetCenterId);
      if (laSaleDungCoSo) {
        return {
          kind: "OWNER",
          ownerId: input.createdById as string,
          source: "SELF",
          consumedTurn: false,
        };
      }
      return AUTO;
    }

    // ── [7] / [8] / [9] / [10] Landing page affiliate ────────────────────────
    case "LANDING": {
      const aff = input.aff;
      // Ba vế phải đúng CẢ BA: tra ra người · người đó là sale · đúng cơ sở khách
      // chọn. Thiếu vế nào cũng về vòng chia — đặc biệt vế cơ sở, nếu không thì
      // người CS1 phát link kéo được lead CS2 về mình.
      if (aff && aff.isSale && cungCoSo(aff.centerId, input.targetCenterId)) {
        return {
          kind: "OWNER",
          ownerId: aff.userId,
          source: "AFFILIATE",
          consumedTurn: false,
        };
      }
      return AUTO;
    }
  }
}
