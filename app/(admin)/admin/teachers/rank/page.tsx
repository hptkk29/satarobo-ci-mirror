// app/(admin)/admin/teachers/rank/page.tsx — RANK & CHỨNG NHẬN TRIAL: màn CON của mục Giáo viên (chốt 25/10/2026, trước ở /nhan-su/rank-gv).
//
// Chốt 25/10/2026: CHỈ Giám đốc · Quản trị tối cao · Đào tạo (`parttime_rank:approve`) đổi Rank, và đổi là ÁP NGAY từ ngày hiệu lực — bỏ đề
// xuất / chờ người khác duyệt. §6: Phòng Đào tạo Hội sở cấp chứng nhận Trial. Màn vẫn phải còn vì Giám đốc / Đào tạo KHÔNG có
// `employees:view-all` ⇒ không mở được danh sách / hồ sơ GV; đơn giá + chính sách hỗ trợ Trial ở danh mục `/cham-cong/don-gia-parttime`.
// Phạm vi xem = cơ sở mà người xem có `parttime_rank:view` (hỏi từng cơ sở — `coSoXemRank`, cùng hàm tab dùng).
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { hasRole } from "@/lib/auth/permissions";
import { docTrangRankDonGia } from "@/lib/parttime/rank-don-gia-db";
import { coSoXemRank } from "@/lib/parttime/quyen-rank";
import { hoSoMoDuoc } from "@/lib/teachers/quyen-ho-so";
import { PageHeader } from "@/components/admin/ui/page-header";
import { PageHelp } from "@/components/admin/ui/page-help";
import { NoPermission } from "@/components/admin/ui/states";
import { GiaoVienTabs } from "../_components/giao-vien-tabs";
import { RankGvMan } from "./_components/rank-gv-man";

export const metadata = { title: "Rank giáo viên | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function RankGvPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fteachers%2Frank");
  const me = session.user;
  const [coSo, doi, chungNhan, chinhSach, xemDanhSach] = await Promise.all([
    coSoXemRank(),
    checkPermission("parttime_rank:approve"),
    checkPermission("trial_cert:manage"),
    checkPermission("parttime_policy:manage"),
    // Cùng cổng với trang danh sách `/teachers` — tab "Danh sách" chỉ vẽ khi mở được (luật 12).
    checkPermission("employees:view-all", { centerId: (hasRole(me, "CENTER_MANAGER") ? me.centerId : null) ?? me.centerId ?? null }),
  ]);
  if (coSo.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[2400px]">
        <PageHeader title="Rank giáo viên" />
        <GiaoVienTabs active="rank" danhSach={xemDanhSach} rank={false} />
        <NoPermission permission="parttime_rank:view" what="Rank giáo viên" askWho="Quản lý cơ sở hoặc Nhân sự Hội sở" />
      </div>
    );
  }
  const du = await docTrangRankDonGia({ centerIds: coSo.map((c) => c.id), now: new Date() });
  const hoSoMo = await hoSoMoDuoc(
    me,
    du.giaoVien.map((g) => ({ id: g.userId, centerId: g.coSoGocId })),
  );

  return (
    <div className="mx-auto w-full max-w-[2400px]">
      <PageHeader
        title="Rank giáo viên"
        subtitle={
          doi
            ? "Rank đứng chính và chứng nhận Trial của giáo viên. Đổi Rank là áp ngay từ ngày hiệu lực bạn chọn."
            : "Rank đứng chính và chứng nhận Trial của giáo viên trong phạm vi bạn xem. Đổi Rank: Giám đốc · Quản trị tối cao · Đào tạo."
        }
      />
      <GiaoVienTabs active="rank" danhSach={xemDanhSach} rank />
      <PageHelp>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Giám đốc · Quản trị tối cao · Đào tạo</b> đổi Rank — có hiệu lực từ ngày chọn (mặc định hôm nay), không chờ ai duyệt. Tiết đã dạy trước
            ngày đó giữ Rank cũ; tháng đã khoá kỳ công không đổi được.
          </li>
          <li>
            <b>Phòng Đào tạo Hội sở</b> cấp / thu hồi chứng nhận Trial. Thu hồi từ ngày nào thì buổi Trial trước ngày đó vẫn được tính.
          </li>
          <li>Đơn giá theo Rank và chính sách hỗ trợ Trial nằm ở danh mục tính lương: Chấm công → Cấu hình → Đơn giá Parttime.</li>
        </ul>
      </PageHelp>
      <RankGvMan du={du} hoSoMo={[...hoSoMo]} quyen={{ doi, chungNhan, chinhSach, coSo }} />
    </div>
  );
}
