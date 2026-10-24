// app/(admin)/admin/nhan-su/rank-gv/page.tsx — RANK & ĐƠN GIÁ GIÁO VIÊN (lưới phân công GV · PR4, 24/10/2026).
//
// SR.QD.238 §3: Quản lý cơ sở ĐỀ XUẤT Rank, Ban lãnh đạo DUYỆT; §6 + Điều 4: Phòng Đào tạo Hội sở cấp chứng nhận Trial. Công tắc
// hỗ trợ Trial theo ngày hiệu lực là của chủ dự án (không phải công tắc tiền Parttime). Mọi thay đổi từ ngày chọn trở đi — không hồi tố.
// Phạm vi xem = cơ sở mà người xem có `parttime_rank:view` (hỏi từng cơ sở bằng `checkPermission`, không suy từ vai).
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { docDanhSachCoSo, docTrangRankDonGia } from "@/lib/parttime/rank-don-gia-db";
import { PageHeader } from "@/components/admin/ui/page-header";
import { PageHelp } from "@/components/admin/ui/page-help";
import { NoPermission } from "@/components/admin/ui/states";
import { RankGvMan } from "./_components/rank-gv-man";

export const metadata = { title: "Rank & Đơn giá giáo viên | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function RankGvPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fnhan-su%2Frank-gv");
  const sp = await searchParams;
  const coSoTatCa = await docDanhSachCoSo();
  const [xem, deXuat, duyet, chungNhan, chinhSach] = await Promise.all([
    Promise.all(coSoTatCa.map((c) => checkPermission("parttime_rank:view", { centerId: c.id }))),
    Promise.all(coSoTatCa.map((c) => checkPermission("parttime_rank:propose", { centerId: c.id }))),
    checkPermission("parttime_rank:approve"),
    checkPermission("trial_cert:manage"),
    checkPermission("parttime_policy:manage"),
  ]);
  const coSo = coSoTatCa.filter((_, i) => xem[i]);
  if (coSo.length === 0) {
    return (
      <div className="max-w-6xl">
        <PageHeader title="Rank & Đơn giá giáo viên" />
        <NoPermission permission="parttime_rank:view" what="Rank & đơn giá giáo viên" askWho="Quản lý cơ sở hoặc Nhân sự Hội sở" />
      </div>
    );
  }
  const du = await docTrangRankDonGia({ centerIds: coSo.map((c) => c.id), now: new Date() });
  const tab = sp.tab === "don-gia" || sp.tab === "trial" ? sp.tab : "rank";

  return (
    <div className="max-w-6xl 2xl:max-w-none">
      <PageHeader
        title="Rank & Đơn giá giáo viên"
        subtitle="Rank đứng chính theo ngày hiệu lực, chứng nhận Trial, đơn giá SR.QD.238 và chính sách hỗ trợ Trial. Đổi gì cũng có hiệu lực từ ngày chọn — không sửa ngày đã qua."
      />
      <PageHelp>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Quản lý cơ sở</b> lập đề xuất Rank kèm căn cứ (thâm niên · tỷ lệ tái tục · năng lực); <b>Ban lãnh đạo</b> duyệt hoặc từ chối. Người lập không
            tự duyệt. Giá chỉ đổi sau khi duyệt, từ ngày hiệu lực ghi trong đề xuất.
          </li>
          <li>
            <b>Phòng Đào tạo Hội sở</b> cấp / thu hồi chứng nhận Trial. Thu hồi từ ngày nào thì buổi Trial trước ngày đó vẫn được tính.
          </li>
          <li>Hỗ trợ Trial chỉ tính khi chính sách bật tại ngày buổi + giáo viên có chứng nhận + được phân công trước giờ + học viên có mặt.</li>
        </ul>
      </PageHelp>
      <RankGvMan
        du={du}
        tab={tab}
        quyen={{ deXuatTai: coSoTatCa.filter((_, i) => deXuat[i]).map((c) => c.id), duyet, chungNhan, chinhSach, coSo, toi: session.user.id }}
      />
    </div>
  );
}
