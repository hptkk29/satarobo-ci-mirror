import Link from "next/link";
import { ListOrdered, Plus, Shapes } from "lucide-react";
import { EmptyState } from "@/components/admin/ui/states";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { Khoi, TrangQuanTri } from "../_components/ui/trang";
import { TrangThaiBadge } from "../_components/ui/trang-thai-badge";
import { NUT_CHINH, NUT_PHU, O_CHON_GOC, O_NHAP_GOC, NHAN_O } from "../_components/ui/dieu-khien";
import { can } from "@/lib/auth/can";
import { docDanhMuc, docDanhSachKhoa } from "@/lib/elearning-online/doc";
import { NHAN_BAN, chuVietTatKhoa, dinhDangTien, nhanNoiDungKhoa, nhanThoiHan } from "@/lib/elearning-online/hien-thi";
import { vaoTrangOnline } from "./_lib/vao";

/**
 * QoKhoa — DANH SÁCH KHOÁ ONLINE (thiết kế `3-e-learning/nguon/QoKhoa`). Tách bạch khỏi "Khoá học" nội bộ.
 * Quyền xem: `onl:course:view` (Marketing chỉ đọc). Nút tạo/danh mục/sắp thứ tự chỉ vẽ khi có `onl:course:manage`.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Khoá online | Sata Robo", robots: { index: false, follow: false } };

type SP = Record<string, string | string[] | undefined>;
const mot = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const CO_TRANG = 10;

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const v = await vaoTrangOnline("onl:course:view", "Khoá online");
  if ("chan" in v) return v.chan;
  const quanLy = can(v.actor, "onl:course:manage");
  const sp = await searchParams;
  const q = mot(sp.q);
  const dm = mot(sp.dm);
  const ban = mot(sp.ban);
  const trang = Math.max(1, Number(mot(sp.trang)) || 1);

  const [kq, danhMuc] = await Promise.all([docDanhSachKhoa({ q, categoryId: dm || undefined, saleStatus: ban || undefined, trang, coTrang: CO_TRANG }), docDanhMuc()]);
  const tongTrang = Math.max(1, Math.ceil(kq.tong / CO_TRANG));
  const href = (t: number) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (dm) p.set("dm", dm);
    if (ban) p.set("ban", ban);
    if (t > 1) p.set("trang", String(t));
    const s = p.toString();
    return `/elearning/online${s ? `?${s}` : ""}`;
  };

  return (
    <TrangQuanTri rong="rong">
      <PageHeader
        title="Khoá online"
        subtitle="Khoá bán cho học viên. Tách khỏi khoá nội bộ của nhân viên và lớp ở trung tâm."
        actions={
          quanLy ? (
            <>
              <Link href="/elearning/online/danh-muc" className={NUT_PHU}>
                <Shapes className="h-4 w-4" aria-hidden />
                Danh mục
              </Link>
              <Link href="/elearning/online/sap-xep" className={NUT_PHU}>
                <ListOrdered className="h-4 w-4" aria-hidden />
                Sắp thứ tự hiển thị
              </Link>
              <Link href="/elearning/online/tao" className={NUT_CHINH}>
                <Plus className="h-4 w-4" aria-hidden />
                Tạo khoá online
              </Link>
            </>
          ) : null
        }
      />

      <form method="get" className="grid gap-3 sm:grid-cols-[1fr_200px_200px_auto] sm:items-end" role="search" aria-label="Lọc khoá online">
        <div>
          <label className={NHAN_O} htmlFor="q">
            Tìm khoá
          </label>
          <input id="q" name="q" defaultValue={q} placeholder="Tên hoặc mã khoá" className={`${O_NHAP_GOC} w-full`} />
        </div>
        <div>
          <label className={NHAN_O} htmlFor="dm">
            Danh mục
          </label>
          <select id="dm" name="dm" defaultValue={dm} className={`${O_CHON_GOC} w-full`}>
            <option value="">Mọi danh mục</option>
            {danhMuc.map((d) => (
              <option key={d.id} value={d.id}>
                {d.parentId ? `— ${d.name}` : d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={NHAN_O} htmlFor="ban">
            Bán
          </label>
          <select id="ban" name="ban" defaultValue={ban} className={`${O_CHON_GOC} w-full`}>
            <option value="">Mọi trạng thái</option>
            {Object.entries(NHAN_BAN).map(([k, x]) => (
              <option key={k} value={k}>
                {x.nhan}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={NUT_PHU}>
          Lọc
        </button>
      </form>

      <Khoi sat>
        {kq.dong.length === 0 ? (
          <EmptyState
            title={q || dm || ban ? "Không có khoá nào khớp bộ lọc" : "Chưa có khoá online nào"}
            description={quanLy && !(q || dm || ban) ? "Bấm “Tạo khoá online” để bắt đầu." : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <caption className="sr-only">Danh sách khoá online</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-4 py-3 font-medium">STT</th>
                  <th scope="col" className="px-2 py-3 font-medium">Khoá</th>
                  <th scope="col" className="px-2 py-3 text-right font-medium">Giá</th>
                  <th scope="col" className="px-2 py-3 font-medium">Thời hạn</th>
                  <th scope="col" className="px-2 py-3 text-right font-medium">Bài</th>
                  <th scope="col" className="px-2 py-3 text-right font-medium">HV</th>
                  <th scope="col" className="px-2 py-3 font-medium">Nội dung</th>
                  <th scope="col" className="px-2 py-3 font-medium">Bán</th>
                </tr>
              </thead>
              <tbody>
                {kq.dong.map((k, i) => {
                  const nd = nhanNoiDungKhoa(k);
                  const b = NHAN_BAN[k.saleStatus] ?? { nhan: k.saleStatus, sac: "muted" as const };
                  return (
                    <tr key={k.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">{(trang - 1) * CO_TRANG + i + 1}</td>
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-3">
                          <span aria-hidden className="flex h-10 w-14 shrink-0 items-center justify-center rounded-md bg-[#2a1745] text-[11px] font-bold text-[#f4a34a]">
                            {chuVietTatKhoa(k.code)}
                          </span>
                          <div className="min-w-0">
                            <Link href={`/elearning/online/khoa/${k.id}`} className="font-medium text-primary-ink underline underline-offset-[3px]">
                              {k.name}
                            </Link>
                            <p className="truncate text-xs text-muted-foreground">
                              {k.code}
                              {k.categoryName ? ` · ${k.categoryName}` : ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-3 text-right tabular-nums">{dinhDangTien(k.salePrice)}</td>
                      <td className="px-2 py-3">{nhanThoiHan(k.validityMonths)}</td>
                      <td className="px-2 py-3 text-right tabular-nums">{k.soBaiBanChay}</td>
                      <td className="px-2 py-3 text-right tabular-nums">{k.soHocVienConQuyen}</td>
                      <td className="px-2 py-3">
                        <TrangThaiBadge sac={nd.sac}>{nd.nhan}</TrangThaiBadge>
                      </td>
                      <td className="px-2 py-3">
                        <TrangThaiBadge sac={b.sac}>{b.nhan}</TrangThaiBadge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Khoi>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {kq.tong} khoá · trang {Math.min(trang, tongTrang)}/{tongTrang}
        </span>
        <nav aria-label="Phân trang" className="flex gap-2">
          {trang > 1 ? (
            <Link className={NUT_PHU} href={href(trang - 1)}>
              Trước
            </Link>
          ) : null}
          {trang < tongTrang ? (
            <Link className={NUT_PHU} href={href(trang + 1)}>
              Sau
            </Link>
          ) : null}
        </nav>
      </div>
      <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
        STT là thứ tự khoá trên trang Khoá học online của public site. Đổi STT bằng nút “Sắp thứ tự hiển thị”, không kéo thả trong bảng.
      </p>
    </TrangQuanTri>
  );
}
