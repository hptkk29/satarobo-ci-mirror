"use server";

// Hồ sơ Bộ Công Thương mục 4 — phụ huynh tích ô "đồng ý Chính sách hoạt động của website"
// trước khi xem trang học phí.
//
// ⚠️ Luật E-bis #1: file "use server" CHỈ được export async function. Không export type,
// không export hằng — nội dung + version nằm ở `lib/legal/site-policy-content.ts`.
//
// KHÔNG đi `defineAction`/`can()`: đây là hành vi TỰ PHỤC VỤ trên chính tài khoản đang
// đăng nhập (cùng loại với `acceptChatPolicyAction`). Không action nào trong
// `lib/auth/permissions.ts` mô tả "đồng ý điều khoản", và mượn một action khác sẽ hỏng
// trên prod: dưới RBAC v2, action seed scope CENTER/ASSIGNED mà gọi không target thì luôn
// trả false — xanh ở local, chặn sạch phụ huynh trên prod.
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { recordSitePolicyAcceptance } from "@/lib/legal/site-policy";
import { ipKhachHang } from "@/lib/security/client-ip";

export async function acceptSitePolicyAction(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };

  // Server Action LÀ một endpoint HTTP riêng — chặn ở layout mà bỏ chỗ này thì cổng chỉ
  // là tấm màn. Nhân viên không được đóng dấu đồng ý hộ phụ huynh.
  //
  // VÌ SAO KHÔNG đi qua `can()` như luật no-inline-authz đòi: không permission key nào
  // trong `lib/auth/permissions.ts` mô tả "đồng ý điều khoản", và mượn key khác sẽ HỎNG
  // TRÊN PROD — dưới RBAC v2, action seed scope CENTER/ASSIGNED mà gọi không target thì
  // luôn trả false (`lib/auth/can.ts`), tức chặn sạch phụ huynh trong khi local vẫn xanh.
  // Đây là phân loại VAI QUAN HỆ của chính người đang đăng nhập, cùng lối với
  // `acceptChatPolicyAction`.
  // eslint-disable-next-line no-restricted-syntax -- xem lý do ngay trên
  if (session.user.role !== "PARENT") {
    return { ok: false, error: "Chỉ phụ huynh mới xác nhận được" };
  }

  // KHÔNG nhận version từ client: nhận vào là mở đường POST một version cũ.
  const h = await headers();
  await recordSitePolicyAcceptance(session.user.id, {
    ip: ipKhachHang(h), // luật IP dùng chung — bản cũ lấy phần tử ĐẦU của XFF (khách viết)
    userAgent: h.get("user-agent"),
  });

  // "layout" chứ KHÔNG phải "page": cổng chặn nằm ở layout của segment — revalidate mức
  // page thì layout vẫn dựng lại màn chính sách và người vừa bấm đồng ý bị đá về chỗ cũ.
  revalidatePath("/portal/hoc-phi", "layout");
  return { ok: true };
}
