// lib/orders/pham-vi-don.ts — "NGƯỜI NÀY ĐƯỢC THẤY NHỮNG ĐƠN NÀO". THUẦN, không DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TỒN TẠI [25/09/2026]
//
// Chủ dự án: *"nhớ rule sale nào thì thấy đơn hàng của sale đó"*.
//
// Trước bản này `/admin/orders` chỉ có MỘT tầng lọc — `scopedDb` cách ly theo CƠ SỞ — nên
// mọi sale trong cùng một cơ sở đọc được đơn của nhau, kể cả số tiền và tên khách.
//
// ⚠️ **CÁI BẪY, và nó đã suýt làm hỏng bản vá này.** Phản xạ đầu tiên là viết
// *"không có `orders:manage` ⇒ chỉ thấy đơn của mình"*. Đo `prisma/seed-roles.ts` thì
// luật đó **xoá trắng màn hình của Kế toán cơ sở**:
//
//   | vai              | manage | create | view |
//   |------------------|--------|--------|------|
//   | HO_ACCOUNTANT    |   ✅   |   ✅   |  ✅  |
//   | CENTER_MANAGER   |   ✅   |   ✅   |  ✅  |
//   | CENTER_SALES_CSM |   ❌   |   ✅   |  ✅  |
//   | CENTER_ACCOUNTANT|   ❌   |   ❌   |  ✅  |   ← không bao giờ tạo đơn
//
// Kế toán cơ sở không tạo đơn bao giờ ⇒ "đơn của mình" = rỗng ⇒ họ mở danh sách ra và
// thấy **0 dòng**, trong khi việc của họ là đối soát TẤT CẢ. Đó đúng là lớp lỗi ghi trong
// CLAUDE.md: *"cho một vai mới vào một màn cũ ⇒ đo lại mọi giả định"*, chỉ khác chiều.
//
// Luật đúng là hình dạng của VAI SALE: **có `orders:create` mà KHÔNG có `orders:manage`**.
// Nó cũng chính là hai nhánh của `checkOrderCreateOwnership` (`lib/orders/create-guard.ts`)
// — người nào lúc TẠO bị buộc phải gắn lead của mình thì lúc XEM cũng chỉ thấy đúng tập
// ấy. Một luật, hai đầu.
//
// ⚠️ **Cố ý KHÔNG thêm quyền mới `orders:view-all`.** RBAC v2 đọc quyền từ DB, nên giữa
// lúc merge và lúc bấm `seed-prod-roles.yml` sẽ có một quãng **chưa ai có quyền mới** —
// nếu "thấy tất cả" nấp sau quyền đó thì trong quãng ấy Quản lý và Kế toán đều rơi xuống
// "chỉ thấy đơn của mình". Luật suy từ hai quyền ĐANG CÓ thì không có quãng nguy hiểm nào.

/**
 * `TAT_CA` = không lọc thêm gì (vẫn còn cách ly cơ sở của `scopedDb`).
 * `THEO_LEAD` = chỉ đơn gắn lead mà `userId` đang phụ trách.
 */
export type PhamViDon =
  | { kieu: "TAT_CA" }
  | { kieu: "THEO_LEAD"; userId: string };

/**
 * Người này được thấy những đơn nào.
 *
 * ⚠️ Ba tham số đều BẮT BUỘC (luật 7). `canCreate` đặc biệt dễ quên vì nó nghe như chuyện
 * của nút "Tạo đơn" — nhưng chính nó là thứ phân biệt Sale với Kế toán, và quên nó là
 * Kế toán cơ sở mất sạch danh sách mà không ca test nào đỏ.
 */
export function phamViDon(q: {
  canManage: boolean;
  canCreate: boolean;
  userId: string;
}): PhamViDon {
  if (q.canManage) return { kieu: "TAT_CA" };
  // Không tạo được đơn thì không phải vai bán hàng — giữ nguyên tầm nhìn cũ.
  if (!q.canCreate) return { kieu: "TAT_CA" };
  return { kieu: "THEO_LEAD", userId: q.userId };
}

/**
 * Mảnh `where` của Prisma cho phạm vi trên. `null` = không thêm điều kiện nào.
 *
 * ⚠️ Lọc theo **lead đang phụ trách**, KHÔNG theo `createdById` — chủ dự án chốt
 * 25/09/2026. Hệ quả phải biết, và nó là CHỦ ĐÍCH chứ không phải bỏ sót:
 *   · bàn giao lead sang sale khác ⇒ sale cũ **thôi thấy** đơn mình từng lập;
 *   · quản lý lập đơn hộ cho khách của sale ⇒ sale **vẫn thấy**.
 * Cùng nguyên tắc với cổng tạo đơn: *"nhận lead phải đi qua đường phân công"*.
 *
 * ⚠️ Đơn KHÔNG gắn lead (`leadId = null`, khách vãng lai) rơi ra ngoài tầm nhìn của sale.
 * Đúng: `checkOrderCreateOwnership` không cho họ lập loại đơn đó, nên không có đơn nào
 * của họ bị mất — và đơn vãng lai là việc của quản lý.
 */
export function loPhamViDon(pv: PhamViDon): { lead: { assignedToId: string } } | null {
  if (pv.kieu === "TAT_CA") return null;
  return { lead: { assignedToId: pv.userId } };
}

/** Câu giải thích in trên màn khi tầm nhìn đang bị thu hẹp. `null` = không thu hẹp. */
export function moTaPhamVi(pv: PhamViDon): string | null {
  if (pv.kieu === "TAT_CA") return null;
  // Nói RÕ vì sao danh sách ngắn. Im lặng ở đây là để sale tưởng hệ thống mất đơn rồi đi
  // hỏi — hoặc tệ hơn, tưởng đơn của mình chưa được lưu và lập lại một đơn thứ hai.
  return "Bạn đang xem các đơn gắn với khách do bạn phụ trách.";
}
