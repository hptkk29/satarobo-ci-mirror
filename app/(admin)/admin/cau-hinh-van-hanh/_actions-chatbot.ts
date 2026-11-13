"use server";
// Lưu / gỡ API key Anthropic của chatbot website (tab "Chatbot website", Cấu hình vận hành).
// Cổng: `settings:edit` — CÙNG cổng trang dùng để mở ô sửa (`canEditGlobal`), thực tế chỉ Quản trị tối cao.
// Nhật ký ghi 4 ký tự cuối, KHÔNG bao giờ ghi key (Nền #9).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { writeAudit } from "@/lib/audit/audit-log";
import { luuKhoaApi, xoaKhoaApi } from "@/lib/chatbot/khoa-api";

export type KetQuaKhoaChatbot = { ok: true } | { ok: false; loi: string };

const vao = z.object({ khoa: z.string().trim().min(1, "Chưa dán key").max(300) });

function tenNguoi(u: { id: string; name?: string | null; email?: string | null }): string {
  return u.name ?? u.email ?? u.id;
}

export async function luuKhoaChatbotAction(input: unknown): Promise<KetQuaKhoaChatbot> {
  const session = await auth();
  if (!session?.user) return { ok: false, loi: "Chưa đăng nhập" };
  if (!(await checkPermission("settings:edit"))) return { ok: false, loi: "Chỉ quản trị cấp cao nhất được khai API key" };
  const p = vao.safeParse(input);
  if (!p.success) return { ok: false, loi: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };

  const nguoi = tenNguoi(session.user);
  const kq = await luuKhoaApi(p.data.khoa, nguoi, new Date());
  if (!kq.ok) return kq;
  await writeAudit({
    actor: { id: session.user.id, name: nguoi },
    module: "settings",
    entityType: "IntegrationConfig",
    entityId: "ANTHROPIC_CHATBOT",
    action: "UPDATE",
    oldValues: null,
    newValues: { apiKey: `…${p.data.khoa.slice(-4)}` },
    reason: "Khai API key chatbot website",
  });
  revalidatePath("/admin/cau-hinh-van-hanh");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function xoaKhoaChatbotAction(): Promise<KetQuaKhoaChatbot> {
  const session = await auth();
  if (!session?.user) return { ok: false, loi: "Chưa đăng nhập" };
  if (!(await checkPermission("settings:edit"))) return { ok: false, loi: "Chỉ quản trị cấp cao nhất được gỡ API key" };
  await xoaKhoaApi();
  await writeAudit({
    actor: { id: session.user.id, name: tenNguoi(session.user) },
    module: "settings",
    entityType: "IntegrationConfig",
    entityId: "ANTHROPIC_CHATBOT",
    action: "DELETE",
    oldValues: null,
    newValues: null,
    reason: "Gỡ API key chatbot website",
  });
  revalidatePath("/admin/cau-hinh-van-hanh");
  revalidatePath("/", "layout");
  return { ok: true };
}
