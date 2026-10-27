// app/(teacher)/teacher/phan-cong/cong-o/page.tsx — "Ô công cần xem" (GĐ6, kỳ ≥ 2026-11). Công Parttime tính KHI ĐỌC theo ô: ô đủ lượt
// quét được tính tự động; ô thiếu / trễ lượt hiện ở đây để giáo viên PHẢN ÁNH (hạn tới lúc chốt kỳ). Số đọc từ CHÍNH loader của màn
// admin (`docCongOCuaNguoi` → `docCongOThang`, luật 12b) — chỉ lọc theo người đăng nhập. `userId` từ PHIÊN, không từ tham số.
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { auth } from "@/lib/auth";
import { vnYmd } from "@/lib/time/vn";
import { docCongOCuaNguoi } from "@/lib/phan-cong/cong-o-db";
import { luatKy } from "@/lib/phan-cong/cong-o";
import { docKyLuatMoi } from "@/lib/phan-cong/ky-luat-db";
import { NHAN_LY_DO_O } from "@/lib/phan-cong/phan-anh";
import { PageHeader } from "../../_components/ui/page-header";
import { EmptyState } from "../../_components/ui/empty-state";
import { TheDieuHuong } from "../../_components/ui/the-dieu-huong";
import { FormPhanAnh } from "./_components/form-phan-anh";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ô công cần xem | Giáo viên Sata Robo" };

const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
function thangLech(thang: string, n: number) {
  const [y, m] = thang.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

export default async function OCongCanXem({ searchParams }: { searchParams: Promise<{ thang?: string }> }) {
  const session = await auth();
  if (!session?.user) return null; // layout đã gate
  const sp = await searchParams;
  const now = new Date();
  const thang = sp.thang && /^\d{4}-\d{2}$/.test(sp.thang) ? sp.thang : vnYmd(now).slice(0, 7);
  const homQua = vnYmd(new Date(now.getTime() - 86_400_000));
  const [kq, tuKy] = await Promise.all([docCongOCuaNguoi({ userId: session.user.id, periodKey: thang, den: homQua }), docKyLuatMoi()]);
  const canXem = kq.o.filter((o) => o.trangThai === "CAN_XEM");
  const tuDong = kq.o.length - canXem.length;
  const tenCoSo = new Map(kq.coSo.map((c) => [c.id, c.ten]));

  return (
    <div className="space-y-4">
      <PageHeader title="Ô công cần xem" subtitle={`Tháng ${thang.slice(5, 7)}/${thang.slice(0, 4)}`} />
      <TheDieuHuong href="/teacher/phan-cong" icon={ClipboardCheck} title="Công việc của tôi" quayLai className="sm:max-w-xl" />
      <nav aria-label="Tháng" className="flex items-center gap-3 text-sm">
        <Link href={`/teacher/phan-cong/cong-o?thang=${thangLech(thang, -1)}`} className="text-primary underline-offset-2 hover:underline">
          ← Tháng trước
        </Link>
        <Link href={`/teacher/phan-cong/cong-o?thang=${thangLech(thang, 1)}`} className="text-primary underline-offset-2 hover:underline">
          Tháng sau →
        </Link>
      </nav>

      {luatKy(thang, tuKy) !== "MOI" ? (
        <EmptyState
          icon={ClipboardCheck}
          title={`Tháng này đi cách tính cũ`}
          description={`Ô công tự động và phản ánh chỉ áp cho kỳ đi luật công mới${tuKy ? ` (từ ${tuKy.slice(5, 7)}/${tuKy.slice(0, 4)})` : ""}. Công tháng này xem ở “Công tháng của tôi”.`}
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Tới {dm(kq.den)}: <b className="text-foreground">{tuDong}</b> ô đã tính tự động · <b className="text-foreground">{canXem.length}</b> ô cần
            bạn xem. Ô cần xem chỉ được tính khi bạn phản ánh và quản lý cơ sở duyệt — trước khi kỳ chốt.
          </p>
          {canXem.length === 0 ? (
            <EmptyState icon={ClipboardCheck} title="Không có ô nào cần xem." description="Mọi ô có việc đều đủ lượt quét." />
          ) : (
            <ul className="space-y-3" data-o-can-xem>
              {canXem.map((o) => (
                <li key={`${o.centerId}-${o.ngay}-${o.ca}`} className="space-y-2 rounded-lg border border-border bg-card p-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                    <b className="tabular-nums">
                      {dm(o.ngay)} · ca {o.ca}
                    </b>
                    <span className="text-muted-foreground">{tenCoSo.get(o.centerId) ?? ""}</span>
                    <span>{o.ma}</span>
                    <span className="text-state-warning-ink">{o.lyDo.map((l) => NHAN_LY_DO_O[l] ?? l).join(", ")}</span>
                  </div>
                  <FormPhanAnh centerId={o.centerId} ngay={o.ngay} ca={o.ca} phanAnh={o.phanAnh} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
