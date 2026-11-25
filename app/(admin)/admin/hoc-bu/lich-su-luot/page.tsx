import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { resolveActor } from "@/lib/auth/actor";
import { nguoiHocBu } from "@/lib/hoc-bu/pham-vi";
import { docLichSuLuot } from "@/lib/hoc-bu/lich-su-luot-db";
import { chuanHoaTim } from "@/lib/hoc-bu/loc";
import { PageHeader } from "@/components/admin/ui/page-header";
import { PageHelp } from "@/components/admin/ui/page-help";
import { EmptyState } from "@/components/admin/ui/states";
import { DieuHuongTrangLink } from "@/components/ui/dieu-huong-trang-link";
import { OLoc, OTim } from "../_components/bo-loc";
import { BangLichSu } from "./_components/bang-lich-su";

// "Lịch sử cấp lượt" (17/11/2026) — mọi lần QLCS cấp thêm / giảm lượt học bù, duyệt học vượt (duyệt bao nhiêu buổi), theo đơn; + / − ra sao, ai làm, vì sao; QLCS sửa được.
// Gác `makeup:waive` (cùng quyền cấp / giảm / duyệt). Phạm vi cơ sở ép ở `docLichSuLuot` qua cơ sở của học viên.
export const metadata = { title: "Lịch sử cấp lượt học bù | Admin" };
export const dynamic = "force-dynamic";

const SO_DONG = 30;
const NGUON = ["qlcs", "vuot", "don"] as const;

export default async function LichSuLuotPage({ searchParams }: { searchParams: Promise<{ page?: string; nguon?: string; q?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkAnyPermission([...PAGE_GATES["/hoc-bu/lich-su-luot"]]))) redirect("/hoc-bu");
  const sp = await searchParams;
  const nguon = NGUON.find((n) => n === sp.nguon);
  const tim = chuanHoaTim(sp.q);
  const actor = nguoiHocBu(await resolveActor(session.user.id), null);
  const { dong, tong, trang, soTrang } = await docLichSuLuot(actor, { trang: Number(sp.page) || 1, soDong: SO_DONG, nguon, tim });

  const hrefTrang = (t: number) => {
    const p = new URLSearchParams();
    if (nguon) p.set("nguon", nguon);
    if (tim) p.set("q", tim);
    if (t > 1) p.set("page", String(t));
    const q = p.toString();
    return q ? `/hoc-bu/lich-su-luot?${q}` : "/hoc-bu/lich-su-luot";
  };

  return (
    <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
      <PageHeader
        title="Lịch sử cấp lượt học bù"
        subtitle={`${tong} bút toán — QLCS cấp thêm / giảm, duyệt học vượt, theo đơn`}
        actions={
          <Link href="/hoc-bu/duyet-hoc-vuot" className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-muted sm:min-h-9">
            Duyệt học vượt →
          </Link>
        }
      />
      <PageHelp>
        <p>
          Mỗi dòng là một lần điều chỉnh <b>hạn mức lượt học bù miễn phí</b> của học viên: <b>+</b> là cộng thêm, <b>−</b> là rút bớt. Dòng “Duyệt học vượt” ghi số buổi bù mà Sale xin và QLCS đã duyệt.
          Bấm <b>Sửa</b> để chỉnh một lần cấp / một lần duyệt: sổ lượt chỉ ghi thêm, nên hệ thống thêm một bút toán <b>bù trừ</b> (bút toán gốc giữ nguyên, cột Lượt hiện “hiệu lực” sau khi sửa).
          Lượt cấp tự động theo gói và lượt giữ chỗ / đã dùng khi xếp case không liệt kê ở đây.
        </p>
      </PageHelp>

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <OTim giaTri={tim ?? ""} goiY="Tìm học viên — tên hoặc mã HV" />
        <OLoc
          nhan="Nguồn"
          thamSo="nguon"
          giaTri={nguon ?? ""}
          tatCa="Tất cả"
          luaChon={[
            { value: "qlcs", label: "QLCS cấp / giảm / sửa" },
            { value: "vuot", label: "Duyệt học vượt" },
            { value: "don", label: "Theo đơn khoá học" },
          ]}
        />
      </div>

      {dong.length === 0 ? (
        <EmptyState
          title={tim || nguon ? "Không có bút toán nào khớp bộ lọc" : "Chưa có lần cấp lượt nào"}
          description={tim || nguon ? "Đổi bộ lọc hoặc xoá chuỗi tìm để xem lại tất cả." : "Khi QLCS cấp thêm / giảm lượt hoặc duyệt học vượt, từng lần sẽ hiện ở đây."}
        />
      ) : (
        <>
          <BangLichSu dong={dong} coTheSua />
          <DieuHuongTrangLink className="mt-4" trang={trang} soTrang={soTrang} hrefCua={hrefTrang} />
        </>
      )}
    </div>
  );
}
