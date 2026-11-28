"use server";

// Phụ huynh bấm «Tôi đã đọc và đồng ý» Quy định đào tạo (SR.VH.205) — 12/11/2026.
// ⚠️ Luật E-bis #1: file "use server" CHỈ export async function (nội dung + version ở lib/legal/quy-dinh-dao-tao-content.ts).
// Không đi `can()`: hành vi TỰ PHỤC VỤ trên chính tài khoản đang đăng nhập — cùng lối với `acceptSitePolicyAction`
// (xem lý do RBAC v2 ở app/(portal)/portal/hoc-phi/actions.ts). Không nhận version từ client.
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { ghiDongYQuyDinh } from "@/lib/legal/quy-dinh-dao-tao";
import { ipKhachHang } from "@/lib/security/client-ip";

export async function dongYQuyDinhAction(): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  // Nhân viên không được đóng dấu đồng ý hộ phụ huynh.
  // eslint-disable-next-line no-restricted-syntax -- phân loại vai quan hệ của chính người đăng nhập, xem hoc-phi/actions.ts
  if (session.user.role !== "PARENT") return { ok: false, error: "Chỉ phụ huynh mới xác nhận được" };

  const h = await headers();
  await ghiDongYQuyDinh(session.user.id, { ip: ipKhachHang(h), userAgent: h.get("user-agent") });
  // "layout": cổng nằm ở portal/layout.tsx — revalidate mức page thì người vừa đồng ý vẫn bị màn cổng giữ lại.
  revalidatePath("/portal", "layout");
  return { ok: true };
}
