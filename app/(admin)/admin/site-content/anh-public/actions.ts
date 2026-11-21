"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { assertPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { writeAudit } from "@/lib/audit/audit-log";
import { layOAnh } from "@/lib/pub-anh/danh-muc";
import {
  PUB_ANH_PAGE_KEY,
  dongGoiGhiDe,
  hostChoPhep,
  lyDoUrlKhongHopLe,
  phanTichGhiDe,
  tiLeKhop,
} from "@/lib/pub-anh/ghi-de-thuan";

type KetQua = { ok: true } | { ok: false; error: string };

const luuSchema = z.object({
  id: z.string(),
  url: z.string().max(1000),
  w: z.number().int(),
  h: z.number().int(),
});
const datLaiSchema = z.object({ id: z.string() });

/** Sau khi đổi ảnh, mọi trang public (ISR) phải dựng lại — ảnh nằm trong PubRoot của layout nên revalidate theo layout gốc. */
function lamMoiTrangPublic() {
  revalidatePath("/", "layout");
}

/**
 * Thay ảnh của MỘT ô ảnh public. Cổng: đăng nhập → `site-content:edit` (cùng quyền với màn "Nội dung website": Quản trị tối cao,
 * Quản lý cơ sở, Marketing) → mã ảnh phải là ô có thật → URL phải là ảnh đã tải lên kho (host + thư mục) → tỉ lệ khung phải khớp ô.
 * Ảnh đã được CẮT đúng tỉ lệ ở trình duyệt; máy chủ chỉ kiểm lại điều đó, không xử lý ảnh.
 */
export async function luuAnhPublicAction(input: unknown): Promise<KetQua> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  try {
    await assertPermission("site-content:edit");
  } catch {
    return { ok: false, error: "Không có quyền" };
  }

  const p = luuSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  const { id, url, w, h } = p.data;

  const o = layOAnh(id);
  if (!o) return { ok: false, error: "Không có ô ảnh này" };

  const hosts = hostChoPhep(process.env.R2_PUBLIC_URL);
  const lyDo = lyDoUrlKhongHopLe(url, hosts);
  if (lyDo) return { ok: false, error: lyDo };
  const g = phanTichGhiDe(JSON.stringify({ url, w, h }), hosts);
  if (!g) return { ok: false, error: "Kích thước ảnh không hợp lệ" };
  if (!tiLeKhop(o.w, o.h, g.w, g.h)) {
    return { ok: false, error: "Tỉ lệ ảnh không khớp khung của trang — hãy chọn lại ảnh và cắt theo khung" };
  }

  const sdb = scopedDb(await resolveActor(session.user.id));
  const cu = await sdb.sitePageContent.findUnique({
    where: { pageKey_contentKey: { pageKey: PUB_ANH_PAGE_KEY, contentKey: id } },
    select: { contentValue: true },
  });
  await sdb.sitePageContent.upsert({
    where: { pageKey_contentKey: { pageKey: PUB_ANH_PAGE_KEY, contentKey: id } },
    update: { contentValue: dongGoiGhiDe(g), updatedById: session.user.id },
    create: { pageKey: PUB_ANH_PAGE_KEY, contentKey: id, contentValue: dongGoiGhiDe(g), updatedById: session.user.id },
  });
  await writeAudit({
    actor: { id: session.user.id, name: session.user.name ?? session.user.email ?? "Người dùng" },
    module: "site-content",
    entityType: "PubAnh",
    entityId: id,
    action: "pub-anh.replaced",
    oldValues: cu ? { anh: phanTichGhiDe(cu.contentValue, hosts)?.url ?? null } : { anh: null },
    newValues: { anh: g.url },
  }).catch(() => {});

  lamMoiTrangPublic();
  revalidatePath("/site-content/anh-public");
  return { ok: true };
}

/** Quay về ảnh mặc định của ô: xoá dòng ghi đè. Không có dòng thì vẫn `ok` (idempotent). */
export async function datLaiAnhPublicAction(input: unknown): Promise<KetQua> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  try {
    await assertPermission("site-content:edit");
  } catch {
    return { ok: false, error: "Không có quyền" };
  }

  const p = datLaiSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  const { id } = p.data;
  if (!layOAnh(id)) return { ok: false, error: "Không có ô ảnh này" };

  const sdb = scopedDb(await resolveActor(session.user.id));
  const xoa = await sdb.sitePageContent.deleteMany({ where: { pageKey: PUB_ANH_PAGE_KEY, contentKey: id } });
  if (xoa.count > 0) {
    await writeAudit({
      actor: { id: session.user.id, name: session.user.name ?? session.user.email ?? "Người dùng" },
      module: "site-content",
      entityType: "PubAnh",
      entityId: id,
      action: "pub-anh.reset",
    }).catch(() => {});
  }

  lamMoiTrangPublic();
  revalidatePath("/site-content/anh-public");
  return { ok: true };
}
