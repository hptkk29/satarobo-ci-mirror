// app/(admin)/admin/cham-cong/don-gia-parttime/page.tsx — ĐƠN GIÁ PARTTIME: danh mục tính lương giáo viên Parttime (24/10/2026).
//
// Vì sao màn này tồn tại: đơn giá SR.QD.238 (tiết đứng chính theo Rank · trợ giảng · trực đủ ca / nửa ca) và chính sách hỗ trợ Trial là
// THAM SỐ TÍNH LƯƠNG, không phải hồ sơ người — chủ dự án chốt 24/10 dời chúng khỏi màn Rank sang danh mục tính lương, cạnh "Phân loại
// buổi" (hệ số công dạy). Rank của từng giáo viên nằm ở hồ sơ GV; màn này chỉ nói mỗi bậc được trả bao nhiêu.
//
// Điều dễ vỡ:
//  · Bảng đơn giá CHỈ ĐỌC: đổi giá là ban hành phiên bản chính sách mới (`CompensationPolicyVersion`, ngày hiệu lực) — sửa tại chỗ là
//    hồi tố mọi tiết đã dạy.
//  · Chính sách hỗ trợ Trial có ngày hiệu lực, không hồi tố; cấu hình CHỒNG ngày ⇒ coi như chưa có (lưới tính 0đ) — màn nói rõ.
//  · Quyền xem / sửa hỏi MỘT hàm `quyenDonGia` — cùng hàm với tab trong `ConfigTabs`.
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ASK_WHO, loadModuleScope } from "@/lib/cham-cong/module-scope";
import { quyenDonGia } from "@/lib/parttime/quyen-don-gia";
import { docDanhMucDonGia, docDanhSachCoSo } from "@/lib/parttime/rank-don-gia-db";
import { PageHeader } from "@/components/admin/ui/page-header";
import { PageHelp } from "@/components/admin/ui/page-help";
import { NoPermission } from "@/components/admin/ui/states";
import { ModuleNav } from "@/components/admin/cham-cong/module-nav";
import { ConfigTabs } from "@/components/admin/cham-cong/config-tabs";
import { DonGiaParttime } from "./_components/don-gia-parttime";

export const metadata = { title: "Đơn giá Parttime | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function DonGiaParttimePage({ searchParams }: { searchParams: Promise<{ ky?: string; coSo?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fcham-cong%2Fdon-gia-parttime");
  const sp = await searchParams;
  const ctx = { ky: sp.ky ?? null, coSo: sp.coSo ?? null };
  const scope = await loadModuleScope(session.user.id);
  const coSoTatCa = await docDanhSachCoSo();
  const quyen = await quyenDonGia(coSoTatCa.map((c) => c.id));

  const head = (
    <>
      <PageHeader
        title="Đơn giá Parttime"
        subtitle="Giáo viên Parttime được trả bao nhiêu cho mỗi tiết, mỗi ca trực và mỗi học viên Trial có mặt — theo chính sách đang áp."
      />
      <ModuleNav active="cauhinh" scope={scope} ctx={ctx} />
    </>
  );
  if (!quyen.xem) {
    return (
      <div className="max-w-6xl">
        {head}
        <NoPermission permission="parttime_rank:view" what="đơn giá Parttime" askWho={ASK_WHO["hr_attendance:view"]} />
      </div>
    );
  }
  // Chính sách Trial "đang áp hôm nay" in cho các cơ sở người xem thấy; người chỉ có quyền đặt chính sách (Hội sở) thấy mọi cơ sở.
  const coSoHien = quyen.coSoXem.length ? quyen.coSoXem : coSoTatCa.map((c) => c.id);
  const du = await docDanhMucDonGia({ centerIds: coSoHien, now: new Date() });

  return (
    <div className="max-w-6xl">
      {head}
      <ConfigTabs active="don-gia-parttime" scope={scope} ctx={ctx} />
      <PageHelp>
        <p>
          Tiền <b>dự kiến</b> trên lưới Phân công giáo viên và tiền <b>đã xác nhận</b> ở Đối soát đều đọc đơn giá ở đây, theo phiên bản chính sách
          có hiệu lực tại <b>ngày buổi dạy</b>. Rank của từng giáo viên quyết định dòng &ldquo;Đứng chính&rdquo; nào được áp — xem và đề xuất ở hồ sơ
          giáo viên.
        </p>
        <p className="mt-2">
          Đổi đơn giá là ban hành phiên bản chính sách mới có ngày hiệu lực, không sửa tại đây. Công tắc tiền Parttime hiện đang <b>tắt</b>: các số
          này là để xem trước và đối soát, chưa phải số chi.
        </p>
      </PageHelp>
      <DonGiaParttime du={du} suaDuoc={quyen.sua} coSo={coSoTatCa} />
    </div>
  );
}
