import "server-only";
// lib/entitlements/gate-xep-lop.ts — GATE D: CHỖ DUY NHẤT trả lời "dòng đơn này có đang đi theo mô hình PHẠM VI HỌC (cờ BẬT) không" cho các đường
// GHI DANH cũ (`convertLeadV2`, `docDuLieuChuyenDoi`/`chuyenDoiDonAction`).
//
// Vì sao cần: hai đường đó tự suy `Enrollment.buoiBatDau = tổng − mua + 1` ("học các buổi CUỐI", quyết định 28/09) và sinh phiếu học bù theo
// `xetXepVaoLop`. Với dòng SCOPE khi cờ BẬT, bài bắt đầu / bài bỏ qua / học vượt do QUYỀN HỌC quyết (`tinhBatDauKhiXepLop`, chốt ở
// `xep-lop-tu-don.ts`). Để hai nguồn cùng ghi một cột là mua 12 buổi mà bắt đầu ở bài 37.
//
// CỜ TẮT / ĐƠN THƯỜNG ⇒ trả "không" sau 0–2 câu đọc, đường cũ chạy NGUYÊN CHỮ. Đơn không có dấu SCOPE trên bất kỳ dòng nào ⇒ KHÔNG đọc cờ.
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { docPhamViDong } from "@/lib/orders/pham-vi/doc-dong";
import { laThuHocPhiTheoPhamViBat } from "./feature";

/** Cờ phạm vi của MỘT cơ sở (theo `Center.id`). Cơ sở chưa ánh xạ OrgUnit ⇒ `false` (cùng luật `cap-tu-don.ts`). */
export async function phamViDangBatChoCoSo(centerId: string | null | undefined): Promise<boolean> {
  if (!centerId) return false;
  const orgUnitId = await orgUnitIdForCenter(centerId);
  if (!orgUnitId) return false;
  return laThuHocPhiTheoPhamViBat(orgUnitId);
}

/** Id các dòng đơn mang dấu SCOPE khi cờ BẬT cho cơ sở của đơn; rỗng nếu cờ TẮT hoặc không dòng nào có dấu (khi đó không đọc cờ). */
export async function dongPhamViDangBat(
  centerId: string | null | undefined,
  dong: readonly { readonly id: string; readonly metadata: unknown }[],
): Promise<ReadonlySet<string>> {
  const coDau = dong.filter((d) => docPhamViDong(d.metadata) !== null).map((d) => d.id);
  if (coDau.length === 0) return new Set();
  return (await phamViDangBatChoCoSo(centerId)) ? new Set(coDau) : new Set();
}
