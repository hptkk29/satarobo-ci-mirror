// app/(admin)/admin/link-gioi-thieu/page.tsx — «Link giới thiệu của tôi» của NHÂN SỰ trên host admin. Nội dung màn: `components/admin/link-gioi-thieu/man-link-gioi-thieu.tsx`
// (dùng chung với site giáo viên). Không khoá RBAC riêng — quyền là dữ liệu sở hữu, `userId` từ PHIÊN.
import { redirect } from "next/navigation";

import { ManLinkGioiThieu } from "@/components/admin/link-gioi-thieu/man-link-gioi-thieu";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Link giới thiệu của tôi", robots: { index: false } };

export default async function LinkGioiThieuPage({ searchParams }: { searchParams: Promise<{ q?: string; tt?: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  // Gọi THẲNG (không bọc JSX): trang trả về đúng cây của màn, test dựng tĩnh được.
  return ManLinkGioiThieu({ userId: session.user.id, sp: await searchParams, trang: "/link-gioi-thieu" });
}
