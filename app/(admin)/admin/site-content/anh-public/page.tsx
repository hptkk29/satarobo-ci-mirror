import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkAnyPermission, checkPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { scopedDb } from "@/lib/db-scope";
import { PageHelp } from "@/components/admin/ui/page-help";
import { THU_TU_NHOM_TRANG, moiOAnh } from "@/lib/pub-anh/danh-muc";
import { PUB_ANH_PAGE_KEY, hostChoPhep, phanTichGhiDe } from "@/lib/pub-anh/ghi-de-thuan";
import { AnhPublicClient, type OAnhView } from "./client";

export const metadata = { title: "Ảnh giao diện public | Admin" };
export const dynamic = "force-dynamic";

export default async function AnhPublicPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Cùng cổng với "Nội dung website" (/site-content): xem = site-content:view, sửa = site-content:edit.
  if (!(await checkAnyPermission(PAGE_GATES["/site-content"]))) redirect("/dashboard");
  const coQuyenSua = await checkPermission("site-content:edit");

  const actor = await resolveActor(session.user.id);
  const dong = await scopedDb(actor).sitePageContent.findMany({
    where: { pageKey: PUB_ANH_PAGE_KEY },
    select: { contentKey: true, contentValue: true },
  });
  const hosts = hostChoPhep(process.env.R2_PUBLIC_URL);
  const daThay = new Map<string, string>();
  for (const d of dong) {
    const g = phanTichGhiDe(d.contentValue, hosts);
    if (g) daThay.set(d.contentKey, g.url);
  }

  const oAnh: OAnhView[] = moiOAnh().map((o) => ({
    id: o.id,
    w: o.w,
    h: o.h,
    macDinh: o.macDinh,
    nhomTrang: [...o.nhomTrang],
    daThay: daThay.get(o.id) ?? null,
  }));
  const coNhom = new Set(oAnh.flatMap((o) => o.nhomTrang));
  const nhom = THU_TU_NHOM_TRANG.filter((n) => coNhom.has(n));

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <nav aria-label="Đường dẫn" className="mb-1 text-sm text-muted-foreground">
          <Link href="/site-content" className="hover:underline">
            Hình ảnh & nội dung trang
          </Link>{" "}
          / Ảnh giao diện public
        </nav>
        <h1 className="text-2xl font-bold text-foreground">Ảnh giao diện public</h1>
        <p className="mt-1 text-sm text-muted-foreground">Thay ảnh trên website satarobo.vn (ảnh chụp lớp học, học viên, linh vật, ảnh minh hoạ khoá học…) mà không cần nhờ lập trình viên.</p>
      </div>

      <PageHelp>
        <p>
          Bấm <b>Đổi ảnh</b> ở ảnh cần thay, chọn ảnh mới từ máy. Hệ thống tự cắt đúng khung của trang (bạn kéo thanh để chọn phần giữ lại), nén gọn rồi đăng lên. Trang công khai cập nhật trong vòng ít phút.
          <b> Về mặc định</b> sẽ trả ảnh về bản gốc. Với ảnh chụp, hãy chọn ảnh gốc từ điện thoại/máy ảnh (cạnh dài từ 1600px) để ảnh nét trên màn hình sắc nét. Linh vật nền trong suốt nên dùng PNG hoặc WebP có nền trong suốt.
        </p>
      </PageHelp>

      {!coQuyenSua && <p className="mb-4 rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">Bạn chỉ có quyền xem. Cần quyền sửa nội dung website để đổi ảnh.</p>}

      <AnhPublicClient oAnh={oAnh} nhom={nhom} coQuyenSua={coQuyenSua} />
    </div>
  );
}
