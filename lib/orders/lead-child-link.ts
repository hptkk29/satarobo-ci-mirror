// lib/orders/lead-child-link.ts — con của đơn.
//
// 🔴 PHÁT BIỂU CŨ ĐÃ BỊ ĐẢO [18/09/2026]. ~~N-2 · quyết định B4 (24/08/2026): MỘT ĐƠN –
// MỘT CON~~ — chủ dự án chốt ngược: *"một phụ huynh đăng ký cho hai con trong cùng một
// đơn là chuyện thường ở đây, và module thu học phí linh hoạt vốn đã tính theo từng con.
// Phát biểu 'một đơn một con' SAI VỚI THỰC TẾ."*
//
// Nguồn sự thật "khoản này của ai" nay là **DÒNG ĐƠN** (`items[].leadChildId`). Cột
// `Order.leadChildId` tụt xuống thành số SUY RA cho ca một con — tiện cho báo cáo hiện
// tại, và `null` một cách thành thật khi đơn phục vụ nhiều con. Xem `NỢ-13`/`NỢ-14`
// trong `docs/hop-nhat-main-test-1609.md`.
//
// VÌ SAO CÓ FILE NÀY: đơn vị sinh doanh thu là ĐỨA TRẺ, không phải phụ huynh. Trước N-2
// `Order` chỉ có `leadId` (cấp phụ huynh) nên mọi phép "doanh thu theo học sinh", "lead
// đã chuyển đổi", "tỷ lệ chốt theo con" đều không tính được — C-02/C-03/C-05 và mẫu số
// của D-04/D-05 đứng vì chỗ này.
//
// LUẬT SUY — chỉ suy khi KHÔNG THỂ SAI:
//   • người dùng CHỌN con  → dùng đúng con đó, sau khi kiểm nó thuộc đúng phiếu;
//   • không chọn, phiếu có ĐÚNG 1 con → suy ra con đó (không có lựa chọn nào khác);
//   • không chọn, phiếu có 0 hoặc ≥ 2 con → `null`. **KHÔNG ĐOÁN.**
//
// Gán bừa một đứa là chuyển doanh thu của đứa này sang đứa kia — sai âm thầm, và báo cáo
// vẫn cộng ra đúng tổng nên không ai phát hiện. `null` thì tệ hơn về mặt đầy đủ nhưng
// THÀNH THẬT: hàm đọc (`lib/reports/revenue-by-child.ts`) bắt buộc hiện một dòng "chưa
// quy được về con" thay vì lặng lẽ bỏ khoản đó ra khỏi báo cáo.

/** Con của một phiếu khách — đủ dữ kiện để kiểm "con này có thuộc phiếu kia không". */
export type OrderLeadChildRef = { id: string; leadId: string };

export type OrderLeadChildResolution =
  | {
      ok: true;
      /** `null` = chưa quy được về con nào (0 hoặc ≥ 2 con mà người dùng không chọn). */
      leadChildId: string | null;
      /** true = do hệ thống SUY (phiếu đúng 1 con), false = người dùng chọn / bỏ trống. */
      inferred: boolean;
    }
  | {
      ok: false;
      code: "LEAD_CHILD_NEEDS_LEAD" | "LEAD_CHILD_NOT_IN_LEAD";
      message: string;
    };

/**
 * Suy con từ danh sách con của phiếu — dùng chung cho đường tạo đơn và script rà đơn cũ.
 * ĐÚNG 1 con ⇒ con đó; còn lại ⇒ `null`.
 */
export function inferLeadChildIdFromChildren(
  children: readonly OrderLeadChildRef[],
): string | null {
  return children.length === 1 ? children[0]!.id : null;
}

/**
 * Con của ĐƠN suy từ CÁC DÒNG — chốt 18/09/2026 (NỢ-13).
 *
 * 🔴 ĐẢO MỘT PHÁT BIỂU CŨ. Chú thích đầu tệp viết "MỘT ĐƠN – MỘT CON" và ô chọn cấp đơn
 * từng là nguồn duy nhất. Chủ dự án chốt ngược: *"một phụ huynh đăng ký cho hai con
 * trong cùng một đơn là chuyện thường ở đây, và module thu học phí linh hoạt vốn đã tính
 * theo từng con"*. Nên nguồn sự thật nay là **DÒNG ĐƠN** (`items[].leadChildId`), còn cột
 * `Order.leadChildId` tụt xuống thành **số suy ra cho ca một con** — tiện cho báo cáo, và
 * `null` một cách THÀNH THẬT khi đơn phục vụ nhiều con.
 *
 * Luật suy, vẫn là "chỉ suy khi KHÔNG THỂ SAI":
 *   • mọi dòng có khai con đều trỏ CÙNG một đứa → đứa đó;
 *   • không dòng nào khai            → `null` (nơi gọi rơi về nhánh suy-từ-phiếu);
 *   • hai đứa trở lên                → `null`. **KHÔNG ĐOÁN**, và đây nay là ca THƯỜNG
 *     chứ không còn là ngoại lệ hiếm.
 *
 * Trả `null` chứ không ném: đơn hai con là HỢP LỆ, không phải lỗi người dùng.
 */
export function conDonTuCacDong(
  items: readonly { leadChildId?: string | null }[],
): string | null {
  const ids = [
    ...new Set(items.map((it) => it.leadChildId?.trim()).filter((v): v is string => !!v)),
  ];
  return ids.length === 1 ? ids[0]! : null;
}

/**
 * Con của đơn khi CHỐT GHI DANH (convert): quy tắc một đơn – một con nên chỉ quy được
 * khi lượt chốt có ĐÚNG một học viên và học viên đó gắn với một `LeadChild`.
 *
 * Lượt chốt 2 con đẻ ra MỘT đơn backfill chung (`createBackfillOrderPaymentInTx`) —
 * khoản tiền đó thật sự của cả hai, không có cách chia nào đúng ⇒ để `null` và để báo
 * cáo nói ra. Muốn tách thì phải tách thành 2 đơn, đúng như quyết định B4 đã lường.
 */
export function inferLeadChildIdForConvert(
  students: readonly { leadChildId?: string | null }[],
): string | null {
  if (students.length !== 1) return null;
  const id = students[0]?.leadChildId?.trim();
  return id ? id : null;
}

/**
 * Quyết định `Order.leadChildId` cho một lượt tạo đơn.
 *
 * `children` PHẢI là danh sách con của đúng `leadId` đã đọc qua `scopedDb(actor)` — nhờ
 * vậy phiếu ngoài cơ sở trả mảng rỗng và lựa chọn của client rơi vào nhánh từ chối, chứ
 * không có đường nào gắn đơn vào con của cơ sở khác.
 */
export function resolveOrderLeadChildId(input: {
  leadId: string | null | undefined;
  requestedLeadChildId: string | null | undefined;
  children: readonly OrderLeadChildRef[];
}): OrderLeadChildResolution {
  const leadId = input.leadId?.trim() || null;
  const requested = input.requestedLeadChildId?.trim() || null;

  if (!requested) {
    // Không chọn: chỉ suy khi phiếu có đúng 1 con. Không có phiếu ⇒ không có con nào.
    if (!leadId) return { ok: true, leadChildId: null, inferred: false };
    const suy = inferLeadChildIdFromChildren(input.children);
    return { ok: true, leadChildId: suy, inferred: suy !== null };
  }

  if (!leadId) {
    return {
      ok: false,
      code: "LEAD_CHILD_NEEDS_LEAD",
      message: "Chọn học sinh thì đơn phải gắn với phiếu khách hàng.",
    };
  }

  // Kiểm CẢ `leadId` của con, không chỉ sự tồn tại: `children` được nạp theo `leadId`
  // nên về lý là thừa, nhưng chỗ gọi sau này có thể truyền danh sách rộng hơn và lúc đó
  // đây là thứ duy nhất chặn "gắn đơn của phiếu A vào con của phiếu B".
  const found = input.children.find((c) => c.id === requested && c.leadId === leadId);
  if (!found) {
    return {
      ok: false,
      code: "LEAD_CHILD_NOT_IN_LEAD",
      message: "Học sinh đã chọn không thuộc phiếu khách hàng này.",
    };
  }

  return { ok: true, leadChildId: found.id, inferred: false };
}
