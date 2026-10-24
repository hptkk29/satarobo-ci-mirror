// Cấu hình ký hiệu / pháp nhân hoá đơn theo cơ sở (PR2, docs/ke-toan-hoa-don/NANG-CAP-2026-10.md).
// Cùng luật chọn cơ sở với bàn chứng từ: MỘT cơ sở làm việc — một cơ sở thì tự chọn, nhiều cơ sở thì phải chọn trước.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { PageHeader } from "@/components/admin/ui/page-header";
import { EmptyState } from "@/components/admin/ui/states";
import { laHoaDonBat } from "@/lib/finance/hoa-don/feature";
import { napCoSoLocHoaDon } from "@/lib/finance/hoa-don/hang-cho";
import { chonCoSoLamViec, thangVN } from "@/lib/finance/hoa-don/loc-hang-cho";
import { docCauHinhCoSo, docLichSuCauHinh, docPhapNhanCuaCayToChuc } from "@/lib/finance/hoa-don/cau-hinh-co-so-db";
import { phapNhanTheoCayToChuc } from "@/lib/finance/hoa-don/cau-hinh-co-so";
import { CAU_HINH_HOA_DON_MAC_DINH } from "@/lib/finance/hoa-don/phap-nhan";
import { CauHinhCoSo } from "./_components/cau-hinh-co-so";

export const metadata = { title: "Cấu hình ký hiệu hoá đơn | Admin" };
export const dynamic = "force-dynamic";

export default async function CauHinhHoaDonPage({ searchParams }: { searchParams: Promise<{ coSo?: string }> }) {
  if (!(await laHoaDonBat())) notFound();
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=%2Fpayments%2Fhoa-don%2Fcau-hinh");
  if (!(await checkAnyPermission(PAGE_GATES["/payments/hoa-don/cau-hinh"]))) redirect("/dashboard?error=unauthorized");

  const [sp, actor] = await Promise.all([searchParams, resolveActor(session.user.id)]);
  const cacCoSo = await napCoSoLocHoaDon(actor);
  const coSoId = chonCoSoLamViec(sp.coSo ?? null, cacCoSo);
  const coSo = cacCoSo.find((c) => c.id === coSoId) ?? null;
  const dong = coSo ? await docCauHinhCoSo(actor, [coSo.id]) : [];
  const lichSu = await docLichSuCauHinh(dong.map((d) => d.id));
  // Chọn cơ sở ⇒ tự chọn pháp nhân theo CÂY TỔ CHỨC (khớp MST). Link sang Cây tổ chức chỉ hiện cho người mở được màn đó (luật 12).
  const theoCay = phapNhanTheoCayToChuc(coSo ? await docPhapNhanCuaCayToChuc(coSo.id) : null, CAU_HINH_HOA_DON_MAC_DINH.phapNhan);
  const coTheMoCay = await checkAnyPermission(PAGE_GATES["/to-chuc"]);

  return (
    <div>
      <PageHeader
        title="Cấu hình ký hiệu hoá đơn"
        subtitle="Mỗi cơ sở khai pháp nhân phát hành và ký hiệu theo khoảng ngày. Màn Hoá đơn điện tử dùng cấu hình này để điền sẵn."
        actions={
          <Link href="/payments/hoa-don" className="text-sm font-medium text-primary hover:underline">
            ← Về Hoá đơn điện tử
          </Link>
        }
      />
      {cacCoSo.length > 1 ? (
        <form method="get" className="mb-4 flex items-center gap-2">
          <label htmlFor="co-so" className="text-sm text-muted-foreground">
            Cơ sở
          </label>
          <select
            id="co-so"
            name="coSo"
            defaultValue={coSoId ?? ""}
            className="h-9 rounded-lg border border-border bg-card py-0 pl-2.5 pr-8 text-sm text-foreground outline-none focus:border-primary"
          >
            {coSoId ? null : (
              <option value="" disabled>
                Chọn cơ sở…
              </option>
            )}
            {cacCoSo.map((c) => (
              <option key={c.id} value={c.id}>
                {`${c.ma} · ${c.ten}`}
              </option>
            ))}
          </select>
          <button type="submit" className="h-9 rounded-lg border border-border bg-card px-3 text-sm hover:bg-muted/50">
            Xem
          </button>
        </form>
      ) : null}
      {coSo ? (
        <CauHinhCoSo
          key={coSo.id}
          centerId={coSo.id}
          tenCoSo={`${coSo.ma} · ${coSo.ten}`}
          dong={dong}
          lichSu={lichSu}
          theoCay={theoCay}
          coTheMoCay={coTheMoCay}
          phapNhan={CAU_HINH_HOA_DON_MAC_DINH.phapNhan.map((p) => ({ ma: p.ma, ten: p.ten, maSoThue: p.maSoThue, bat: p.bat }))}
          namHienTai={thangVN(new Date()).slice(0, 4)}
        />
      ) : (
        <EmptyState
          title={cacCoSo.length > 0 ? "Chọn cơ sở để bắt đầu" : "Bạn chưa được giao cơ sở nào để làm hoá đơn"}
          description={cacCoSo.length > 0 ? "Cấu hình được khai theo từng cơ sở." : "Liên hệ quản trị để được cấp quyền kế toán tại cơ sở."}
        />
      )}
    </div>
  );
}
