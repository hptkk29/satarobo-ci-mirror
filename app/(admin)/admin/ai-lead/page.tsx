// app/(admin)/admin/ai-lead/page.tsx — Hồ sơ chờ AI (AI Lead Gateway, lát C). Danh sách + bộ lọc (trên URL).
// Đủ bốn trạng thái của DESIGN.md §5: tải (Suspense + khung chờ) · rỗng · lỗi · KHÔNG CÓ QUYỀN (nói rõ thiếu quyền nào, hỏi ai).
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { EmptyState, ErrorState, NoPermission } from "@/components/admin/ui/states";
import { PageHeader } from "@/components/admin/ui/page-header";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { canViewLeadPii, checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { SO_DONG_TOI_DA, danhSach, type KetQuaDanhSach, type LocDanhSach } from "@/lib/ai-lead/dich-vu/duyet";
import { BangHoSo } from "./_ho-so/bang-ho-so";
import { BoLoc } from "./_ho-so/bo-loc";
import { KhungChoDanhSach } from "./_ho-so/khung-cho";
import { NutTaiLai } from "./_components/nut-tai-lai";
import { CO_LOC, docBoLoc, queryTuLoc } from "./_ho-so/doc-bo-loc";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hồ sơ chờ AI | Admin Sata Robo" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function HoSoChoAiPage({ searchParams }: { searchParams: SP }) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fai-lead");
  const tieuDe = (
    <PageHeader title="Hồ sơ chờ AI" subtitle="Hồ sơ khách do AI Messenger gửi, chờ nhân viên bổ sung, duyệt hoặc từ chối." />
  );
  if (!(await checkAnyPermission([...PAGE_GATES["/ai-lead"]]))) {
    return (
      <div>
        {tieuDe}
        <NoPermission what="Hồ sơ chờ AI" permission="ai-leads:view" askWho="quản trị viên hệ thống (Quản lý cơ sở và Marketing Hội sở có quyền này theo mặc định)" />
      </div>
    );
  }

  const loc = docBoLoc(await searchParams);
  return (
    <div className="mx-auto w-full max-w-[120rem]">
      {tieuDe}
      {/* Suspense thay cho loading.tsx: loading.tsx cấp /ai-lead sẽ phủ cả /cau-hinh và /ket-noi của lát khác. */}
      <Suspense key={JSON.stringify(loc)} fallback={<KhungChoDanhSach />}>
        <NoiDungDanhSach loc={loc} userId={session.user.id} />
      </Suspense>
    </div>
  );
}

async function NoiDungDanhSach({ loc, userId }: { loc: LocDanhSach; userId: string }) {
  const [actor, coPii] = await Promise.all([resolveActor(userId), canViewLeadPii()]);
  const now = new Date();

  let kq: KetQuaDanhSach;
  try {
    kq = await danhSach(actor, loc, coPii, now);
  } catch {
    // Không đưa nội dung lỗi ra màn (lỗi Prisma có thể kèm giá trị cột = PII). Sentry đã bắt ở tầng trên khi cần.
    return <ErrorState description="Không đọc được danh sách hồ sơ. Tải lại trang; nếu vẫn lỗi, báo bộ phận kỹ thuật kèm giờ xảy ra." action={<NutTaiLai href={`?${queryTuLoc(loc)}`} />} />;
  }

  const khoaTrang = JSON.stringify(loc);
  return (
    <>
      <BoLoc loc={loc} pages={kq.tuyChon.pages} coSo={kq.tuyChon.coSo} coTheTimTheoTen={coPii} />
      {kq.hang.length === 0 ? (
        <EmptyState
          title={CO_LOC(loc) ? "Không có hồ sơ nào khớp bộ lọc" : "Chưa có hồ sơ nào đang chờ"}
          description={
            CO_LOC(loc)
              ? "Nới bộ lọc (ví dụ chọn «Tất cả» ở Trạng thái) hoặc xoá lọc để xem toàn bộ hồ sơ trong phạm vi của bạn."
              : "Khi AI Messenger thu được thông tin khách mà cần nhân viên xử lý, hồ sơ sẽ hiện ở đây. Bạn sẽ thấy hồ sơ của các cơ sở mình phụ trách."
          }
        />
      ) : (
        <>
          <p className="mb-2 text-sm text-muted-foreground" aria-live="polite">
            {kq.biCat
              ? `Hiện ${kq.hang.length} hồ sơ đứng đầu trong ${kq.tong} hồ sơ khớp (tối đa ${SO_DONG_TOI_DA}). Thu hẹp bộ lọc để xem phần còn lại.`
              : `${kq.tong} hồ sơ khớp bộ lọc. Hồ sơ gần hạn xử lý nhất đứng đầu.`}
          </p>
          <BangHoSo hang={kq.hang} now={now} khoaTrang={khoaTrang} />
        </>
      )}
    </>
  );
}
