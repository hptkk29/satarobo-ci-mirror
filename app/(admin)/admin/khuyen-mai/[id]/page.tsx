// app/(admin)/admin/khuyen-mai/[id]/page.tsx — MỘT văn bản khuyến mãi.
//
// Thứ tự đọc = thứ tự Sale cần khi đang tư vấn: ưu đãi (in lớn nhất) → điều kiện → áp ở đâu,
// khoá nào → văn bản gốc → mã voucher. Thông tin quản trị (ai ban hành, lúc nào) nằm cuối cột
// phải, nhỏ — người tra cứu hiếm khi cần nó.
//
// Văn bản đã thu hồi: dải báo đỏ NGAY dưới tiêu đề kèm lý do — Sale mở từ thông báo phải thấy
// "đừng hứa nữa" trước khi đọc tới phần ưu đãi.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { auth } from "@/lib/auth";
import { checkAnyPermission, checkPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { ngayVN } from "@/lib/format/thoi-gian-vn";
import { ngayGioVN } from "@/lib/format/date";
import { docChinhSach } from "@/lib/khuyen-mai/chinh-sach";
import { NHAN_TRANG_THAI, trangThaiTai } from "@/lib/khuyen-mai/hieu-luc";
import { khoangVi, nhacThoiGian, TONE_TRANG_THAI } from "../_components/dinh-dang";
import { MaVoucher } from "../_components/ma-voucher";
import { NutThuHoi } from "../_components/nut-thu-hoi";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chính sách khuyến mãi | Admin Sata Robo" };

function Muc({ tieuDe, children }: { tieuDe: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-semibold text-foreground">{tieuDe}</dt>
      <dd className="mt-1 text-sm text-foreground">{children}</dd>
    </div>
  );
}

export default async function ChiTietKhuyenMaiPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkAnyPermission([...PAGE_GATES["/khuyen-mai"]]))) redirect("/dashboard?error=unauthorized");

  const { id } = await params;
  const [coQuanLy, cs] = await Promise.all([checkPermission("promotions:manage"), docChinhSach(id)]);
  if (!cs) notFound();

  const homNay = ngayVN(new Date());
  const tt = trangThaiTai(cs, homNay);
  const nhac = nhacThoiGian(tt, cs.tuNgay, cs.ketThuc, homNay);
  const conHieuLuc = tt === "dang_ap_dung" || tt === "sap_ap_dung";

  return (
    <div className="space-y-5">
      <Link
        href="/khuyen-mai"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Tất cả khuyến mãi
      </Link>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{cs.ten}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
            <span className="font-semibold tabular-nums text-foreground">{cs.maVanBan}</span>
            <StatusPill tone={TONE_TRANG_THAI[tt]}>{NHAN_TRANG_THAI[tt]}</StatusPill>
            <span className="tabular-nums text-muted-foreground">
              {khoangVi(cs.tuNgay, cs.daTungHieuLuc ? cs.ketThuc : cs.denNgay)}
              {nhac ? ` · ${nhac}` : ""}
            </span>
          </div>
        </div>
        {coQuanLy && !cs.thuHoiLuc && (
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            <Link
              href={`/khuyen-mai/${cs.id}/sua`}
              className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Sửa
            </Link>
            {conHieuLuc && <NutThuHoi id={cs.id} maVanBan={cs.maVanBan} />}
          </div>
        )}
      </header>

      {cs.thuHoiLuc && (
        <div role="status" className="rounded-xl border border-state-danger/30 bg-state-danger-soft px-5 py-3.5 text-sm">
          <p className="font-semibold text-state-danger-ink">
            Đã thu hồi lúc {ngayGioVN(cs.thuHoiLuc)} — không còn áp dụng, đừng hứa ưu đãi này với khách.
          </p>
          {cs.lyDoThuHoi && <p className="mt-0.5 text-state-danger-ink">Lý do: {cs.lyDoThuHoi}</p>}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3 lg:items-start">
        <article className="rounded-xl border border-border bg-card px-5 py-5 lg:col-span-2 sm:px-6">
          <h2 className="text-sm font-semibold text-foreground">Ưu đãi khách nhận được</h2>
          <p className="mt-2 max-w-prose whitespace-pre-line text-lg font-medium leading-relaxed text-foreground">
            {cs.noiDungUuDai}
          </p>
          <h2 className="mt-6 text-sm font-semibold text-foreground">Điều kiện áp dụng</h2>
          {cs.dieuKien ? (
            <p className="mt-2 max-w-prose whitespace-pre-line text-sm leading-relaxed text-foreground">{cs.dieuKien}</p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Văn bản không nêu điều kiện riêng.</p>
          )}
        </article>

        <aside className="rounded-xl border border-border bg-card px-5 py-5">
          <dl className="space-y-4">
            <Muc tieuDe="Áp dụng tại">
              {cs.toanHeThong ? (
                "Toàn hệ thống"
              ) : cs.coSo.length > 0 ? (
                <span className="flex flex-wrap gap-1.5">
                  {cs.coSo.map((c) => (
                    <span key={c.id} className="inline-flex whitespace-nowrap rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                      {c.ten}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="text-state-danger-ink">Cơ sở được chọn đã ngừng hoạt động</span>
              )}
            </Muc>
            <Muc tieuDe="Khoá học">
              {cs.moiKhoa ? (
                "Mọi khoá"
              ) : cs.khoaHoc.length > 0 ? (
                <span className="flex flex-wrap gap-1.5">
                  {cs.khoaHoc.map((k) => (
                    <span key={k.id} className="inline-flex whitespace-nowrap rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                      {k.ten}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="text-state-danger-ink">Khoá được chọn đã bị gỡ</span>
              )}
            </Muc>
            <Muc tieuDe="Văn bản gốc">
              {cs.tep ? (
                <a
                  href={cs.tep.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full items-center gap-1.5 font-medium text-primary-ink hover:underline"
                >
                  <FileText className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="truncate">{cs.tep.ten}</span>
                </a>
              ) : (
                <span className="text-muted-foreground">Chưa đính kèm bản ký</span>
              )}
            </Muc>
            <Muc tieuDe="Ban hành">
              <span className="tabular-nums text-muted-foreground">
                {ngayGioVN(cs.taoLuc)}
                {cs.capNhatLuc.getTime() - cs.taoLuc.getTime() > 60_000 && (
                  <>
                    <br />
                    Sửa lần cuối {ngayGioVN(cs.capNhatLuc)}
                  </>
                )}
              </span>
            </Muc>
          </dl>
        </aside>
      </div>

      <MaVoucher chinhSachId={cs.id} vouchers={cs.vouchers} coQuanLy={coQuanLy} conThemDuoc={conHieuLuc} />
    </div>
  );
}
