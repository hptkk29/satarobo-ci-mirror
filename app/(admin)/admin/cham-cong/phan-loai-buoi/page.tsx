// app/(admin)/admin/cham-cong/phan-loai-buoi/page.tsx — PHÂN LOẠI BUỔI.
//
// Vì sao màn này tồn tại: SR.QD.230 PL03 §4 trả công dạy theo LOẠI buổi (lớp Coach 100%, buổi
// ≤3 HV 75%, Workshop và Sự kiện 120%). Trước 07/09 hệ thống không có chỗ nào ghi "buổi này là
// workshop", nên danh mục công dạy bị khoá cứng ở 6 dòng (nguồn × vai) và BLĐ chỉ sửa được hệ số
// chứ không thêm được loại nào — đúng thứ chủ dự án yêu cầu "tự tạo tự add được qua hệ thống".
//
// Điều dễ vỡ:
//  · Danh mục DÙNG CHUNG toàn hệ thống ⇒ chỉ `hr_attendance:config` tại HỘI SỞ mới sửa được.
//    Người chỉ có `view` vào xem được nhưng không có nút sửa.
//  · Đúng MỘT dòng mặc định, ép bằng partial unique index ở DB chứ không bằng lời hứa ở action.
//  · Không có Xoá — chỉ tắt. `TeachingCreditType.categoryId` để `onDelete: Restrict`.
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { HO_CENTER_ID } from "@/lib/cham-cong/home-center";
import { ASK_WHO, loadModuleScope } from "@/lib/cham-cong/module-scope";
import { PageHeader } from "@/components/admin/ui/page-header";
import { PageHelp } from "@/components/admin/ui/page-help";
import { NoPermission } from "@/components/admin/ui/states";
import { ModuleNav } from "@/components/admin/cham-cong/module-nav";
import { ConfigTabs } from "@/components/admin/cham-cong/config-tabs";
import { CategoryList } from "./_components/category-list";

export const metadata = { title: "Phân loại buổi | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function PhanLoaiBuoiPage({
  searchParams,
}: {
  searchParams: Promise<{ ky?: string; coSo?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fcham-cong%2Fphan-loai-buoi");
  const sp = await searchParams;
  const ctx = { ky: sp.ky ?? null, coSo: sp.coSo ?? null };
  const scope = await loadModuleScope(session.user.id);
  const canView = scope.any("hr_attendance:view");
  const canEdit = scope.has("hr_attendance:config", HO_CENTER_ID);

  const head = (
    <>
      <PageHeader
        title="Phân loại buổi"
        subtitle="Buổi này là học chính thức, lớp Coach, bù, vượt, workshop hay sự kiện — quyết định buổi ăn hệ số công dạy nào."
      />
      <ModuleNav active="cauhinh" scope={scope} ctx={ctx} />
    </>
  );

  if (!canView && !canEdit) {
    return (
      <div className="max-w-6xl">
        {head}
        <NoPermission
          permission="hr_attendance:view"
          what="phân loại buổi"
          askWho={ASK_WHO["hr_attendance:view"]}
        />
      </div>
    );
  }

  const sdb = scopedDb(await resolveActor(session.user.id));
  const rows = await sdb.sessionCategory.findMany({
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
    include: { _count: { select: { sessions: true, creditTypes: true } } },
  });

  return (
    <div className="max-w-6xl">
      {head}
      <ConfigTabs active="phan-loai-buoi" scope={scope} ctx={ctx} />
      <PageHelp guideSlug="nhan-su-giao-vien">
        <p>
          Mỗi buổi học mang một phân loại. Phân loại quyết định buổi đó ăn dòng hệ số nào ở bảng{" "}
          <b>Loại công dạy</b> (màn Công dạy) — nhờ vậy Workshop tính 120% còn lớp Coach tính 100%
          mà không ai phải sửa mã nguồn.
        </p>
        <p className="mt-2">
          Buổi <b>chưa gán</b> phân loại được tính như dòng <b>Mặc định</b>. Luôn có đúng một dòng
          mặc định; đặt mặc định cho dòng khác thì dòng cũ tự nhả.
        </p>
        <p className="mt-2 rounded-lg bg-state-warning-soft p-2.5 text-state-warning-ink">
          <b>Cột &ldquo;Buổi trách nhiệm&rdquo; đang KHOÁ — chỉ đọc.</b> Theo SR.QD.230 PL04 §A.1.b,
          buổi bù/vượt/hỗ trợ của giáo viên cơ hữu nằm trong lương cơ bản và chỉ phần vượt định mức
          (50 buổi Fulltime · 30 hoặc 20 buổi Parttime) mới được 80.000đ/buổi. Bộ đếm định mức đó{" "}
          <b>chưa chạy</b>, nên ô nhập đã tạm ẩn — khai vào một ô không ai đọc là mời người sau tin
          rằng hệ thống đang chấp hành. Giá trị đã khai vẫn giữ nguyên, không mất.
        </p>
        <p className="mt-2">
          Không có nút xoá. Một phân loại đã bị buổi cũ trỏ tới mà xoá đi là mất dấu vì sao buổi đó
          từng có hệ số riêng — bỏ &ldquo;Đang dùng&rdquo; thì buổi cũ rơi về dòng mặc định và vẫn
          lần lại được.
        </p>
        <p className="mt-2">
          Buổi <b>trải nghiệm</b> không nằm ở đây: đó là loại buổi riêng (<code>TrialClassSession</code>
          ), đã được ba dòng &ldquo;Trải nghiệm&rdquo; trong bảng Loại công dạy lo.
        </p>
      </PageHelp>
      <CategoryList
        rows={rows.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          isDefault: r.isDefault,
          countsTowardQuota: r.countsTowardQuota,
          isActive: r.isActive,
          buoi: r._count.sessions,
          dongCongDay: r._count.creditTypes,
        }))}
        canEdit={canEdit}
      />
    </div>
  );
}
