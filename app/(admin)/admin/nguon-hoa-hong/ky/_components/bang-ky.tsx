// app/(admin)/admin/nguon-hoa-hong/ky/_components/bang-ky.tsx — BẢNG CÁC KỲ (06 §5.4): Kỳ · Cơ sở · Trạng thái · Cơ sở tính · Hoa hồng · Điều chỉnh · Chặn · Đã tính · Đã khoá · Đã xuất (Trạng thái đứng sớm để ở 375px/768px, khi bảng cuộn ngang, nó vẫn nằm trong màn).
//
// Phân trang Ở TẦNG TRUY VẤN (`docDanhSachKy`, 25 dòng/trang) + `DieuHuongTrangLink`; bộ lọc trạng thái nằm trên URL (06 §3: lọc ở client cho bảng dày là phản mục tiêu).
// Cả dòng là vùng bấm (luật 12): `<tr relative cursor-pointer>` + liên kết ở ô Kỳ mang `after:inset-0` — bấm là chọn đúng kỳ (tháng × cơ sở) ở phần trên của màn.
//
// Ba cột mốc thời gian chỉ in NGÀY (dd/MM, giờ VN) để cả mười cột nằm vừa ~976px của khung admin ở 1280px mà không bị cắt cột Trạng thái; ngày giờ đầy đủ ở `title`
// và ở dòng mốc của kỳ đang chọn. Kỳ trước mốc cutover: dòng mờ + nhãn "Sổ cũ" thay trạng thái (engine mới không ghi kỳ đó).
// Người khoá KHÔNG có cột thứ 11 (bảng đã ~900px): gộp vào ô "Đã khoá" dạng `dd/MM · Tên` (tên cắt bằng CSS, đủ tên ở `title`); kỳ cũ không rõ người ⇒ `dd/MM · —`.
// ⚠️ Trần 7,5rem của ô là SỐ ĐO (khung 974px ở 1280px): 8rem vừa khít (còn dư vài px), 8,5rem đã đẩy cột "Đã xuất" ra ngoài vùng cuộn. Muốn rộng hơn thì phải bớt chỗ khác trước.
//
// DƯỚI xl bảng 10 cột (min 900px) KHÔNG vừa khung admin — đo chụp thật: 343px ở 375, 464px ở 768 (sidebar 256px), ~720px ở 1024 (chỉ 976px ở 1280) — nên cuộn ngang mà không có dấu hiệu.
// Thay bằng danh sách thẻ (khuôn của bảng khiếu nại): cùng dữ liệu, cùng link chọn kỳ, cùng aria-current. Hai bản cùng có trong cây DOM, CSS (`hidden xl:block` / `xl:hidden`) chọn bản hiện;
// thẻ có tên link riêng ("Mở kỳ …") để hai bản không trùng tên. (Đặc tả giao việc ghi `md`; ảnh chụp 768px cho thấy bảng vẫn bị cắt ở đó nên ngưỡng là xl.)
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { VO_BANG, CHIP, CHIP_ACTIVE, CHIP_IDLE } from "@/components/admin/nguon-hoa-hong/classes";
import { TrangThaiKyPill } from "@/components/admin/nguon-hoa-hong/trang-thai-ky-pill";
import { EmptyState } from "@/components/admin/ui/states";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { DieuHuongTrangLink } from "@/components/ui/dieu-huong-trang-link";
import { ngayGioVN } from "@/lib/hoa-hong/dinh-dang";
import { TRANG_THAI_KY, type TrangThaiKy } from "@/lib/hoa-hong/ky-hoa-hong";
import { NHAN_TRANG_THAI_KY, ngayNganVN, nhanThangKy } from "@/lib/hoa-hong/ky-man-hinh";
import { dinhDangDong } from "@/lib/hoa-hong/vi-sao";
import type { DanhSachKy } from "@/lib/hoa-hong/ky-doc";
import { hrefVoi } from "@/lib/nguon-hoa-hong/url";
import { cn } from "@/lib/utils";

const TH = cn(adminTh, "px-3");
const TD = cn(adminTd, "px-3");
const TIEN = "text-right tabular-nums";

function Moc({ d }: { d: Date | null }) {
  return d ? <time dateTime={d.toISOString()} title={ngayGioVN(d)}>{ngayNganVN(d)}</time> : <span aria-label="chưa có" className="text-muted-foreground">—</span>;
}

/** Tên người khoá hoặc gạch có nhãn đọc ra — `null` là "không biết", không phải "không có ai". */
function NguoiKhoa({ ten }: { ten: string | null }) {
  return ten ? (
    <span data-nguoi-khoa title={`Khoá bởi ${ten}`}>{ten}</span>
  ) : (
    <span data-nguoi-khoa aria-label="chưa rõ người khoá" title="Kỳ này không ghi người khoá (khoá từ trước khi có cột này, hoặc tài khoản không còn)" className="text-muted-foreground">—</span>
  );
}

export function BangKy({
  ds,
  basePath,
  kyCutover,
  thangDangChon,
  coSoDangChon,
  trangThai,
}: {
  ds: DanhSachKy;
  basePath: string;
  kyCutover: string;
  thangDangChon: string;
  coSoDangChon: string | null;
  trangThai: TrangThaiKy | null;
}) {
  const href = (q: { trangthai?: TrangThaiKy | null; trang?: number }) =>
    hrefVoi(basePath, { coSo: coSoDangChon, thang: thangDangChon, trangthai: q.trangthai === undefined ? trangThai : q.trangthai, trang: q.trang ?? null });

  return (
    <section aria-label="Các kỳ hoa hồng" className="mb-4">
      <h2 className="mb-2 text-sm font-semibold text-foreground">Các kỳ hoa hồng</h2>
      <nav aria-label="Lọc theo trạng thái kỳ" className="mb-3 flex flex-wrap items-center gap-2">
        <Link href={href({ trangthai: null })} aria-current={trangThai === null ? "page" : undefined} className={cn(CHIP, trangThai === null ? CHIP_ACTIVE : CHIP_IDLE)}>
          Mọi trạng thái
        </Link>
        {TRANG_THAI_KY.map((t) => (
          <Link key={t} href={href({ trangthai: t })} aria-current={trangThai === t ? "page" : undefined} className={cn(CHIP, trangThai === t ? CHIP_ACTIVE : CHIP_IDLE)}>
            {NHAN_TRANG_THAI_KY[t]}
          </Link>
        ))}
      </nav>

      {ds.tong === 0 ? (
        <EmptyState
          title={trangThai ? "Không có kỳ nào ở trạng thái này" : "Chưa có kỳ hoa hồng nào"}
          description={
            trangThai
              ? "Bỏ bộ lọc trạng thái để xem mọi kỳ."
              : "Kỳ được mở khi có khoản thu đầu tiên của tháng được quét, hoặc khi kế toán bấm Tính ở trên."
          }
          action={
            trangThai ? (
              <Link href={href({ trangthai: null })} className="text-sm font-medium text-primary-ink hover:underline">
                Xem mọi trạng thái
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className={cn(VO_BANG, "hidden xl:block")}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th scope="col" className={TH}>Kỳ</th>
                    <th scope="col" className={TH}>Cơ sở</th>
                    <th scope="col" className={TH}>Trạng thái</th>
                    <th scope="col" className={cn(TH, "text-right")}>Cơ sở tính</th>
                    <th scope="col" className={cn(TH, "text-right")}>Hoa hồng</th>
                    <th scope="col" className={cn(TH, "text-right")}>Điều chỉnh</th>
                    <th scope="col" className={cn(TH, "text-right")}>Chặn</th>
                    <th scope="col" className={TH}>Đã tính</th>
                    <th scope="col" className={TH}>Đã khoá</th>
                    <th scope="col" className={TH}>Đã xuất</th>
                  </tr>
                </thead>
                <tbody>
                  {ds.dong.map((r) => {
                    const cu = r.period < kyCutover;
                    const dangChon = r.period === thangDangChon && r.centerId === coSoDangChon;
                    return (
                      <tr
                        key={r.id}
                        aria-current={dangChon ? "true" : undefined}
                        className={cn(adminTr, "relative cursor-pointer", dangChon && "bg-primary-soft/40", cu && "text-muted-foreground")}
                      >
                        <td className={cn(TD, "font-medium tabular-nums")}>
                          <Link
                            href={hrefVoi(basePath, { coSo: r.centerId, thang: r.period, trangthai: trangThai })}
                            className="hover:underline focus-visible:ring-2 focus-visible:ring-ring after:absolute after:inset-0"
                          >
                            {nhanThangKy(r.period)}
                          </Link>
                        </td>
                        <td className={TD}>{r.coSo}</td>
                        <td className={TD}>
                          {cu ? <span title="Kỳ thuộc sổ cũ — xem tại /crm/commission">Sổ cũ</span> : <TrangThaiKyPill status={r.status} />}
                        </td>
                        <td className={cn(TD, TIEN)}>{dinhDangDong(r.coSoTinh)}</td>
                        <td className={cn(TD, TIEN)}>{dinhDangDong(r.hoaHong)}</td>
                        <td className={cn(TD, TIEN, r.dieuChinh < 0 && "text-state-danger-ink")}>{dinhDangDong(r.dieuChinh)}</td>
                        <td className={cn(TD, TIEN, r.soChan > 0 && "font-semibold text-state-warning-ink")}>{r.soChan}</td>
                        <td className={TD}><Moc d={r.lastCalculatedAt} /></td>
                        <td className={TD}>
                          {r.lockedAt ? (
                            <span className="inline-block max-w-[7.5rem] truncate align-bottom">
                              <Moc d={r.lockedAt} /> · <NguoiKhoa ten={r.khoaBoi} />
                            </span>
                          ) : (
                            <Moc d={null} />
                          )}
                        </td>
                        <td className={TD}><Moc d={r.exportedAt} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <ul aria-label="Các kỳ hoa hồng, dạng thẻ" className={cn(VO_BANG, "divide-y divide-border xl:hidden")}>
            {ds.dong.map((r) => {
              const cu = r.period < kyCutover;
              const dangChon = r.period === thangDangChon && r.centerId === coSoDangChon;
              return (
                <li
                  key={r.id}
                  aria-current={dangChon ? "true" : undefined}
                  className={cn("relative px-4 py-3 pr-9", dangChon ? "bg-primary-soft/40" : "hover:bg-muted/40", cu && "text-muted-foreground")}
                >
                  <ChevronRight aria-hidden className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <Link
                      href={hrefVoi(basePath, { coSo: r.centerId, thang: r.period, trangthai: trangThai })}
                      aria-label={`Mở kỳ ${nhanThangKy(r.period)} · ${r.coSo}`}
                      className="font-medium tabular-nums text-foreground after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {nhanThangKy(r.period)}
                    </Link>
                    {cu ? <span title="Kỳ thuộc sổ cũ — xem tại /crm/commission" className="text-xs font-semibold">Sổ cũ</span> : <TrangThaiKyPill status={r.status} />}
                  </div>
                  <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span>{r.coSo}</span>
                    <span>Hoa hồng <b className="font-semibold tabular-nums text-foreground">{dinhDangDong(r.hoaHong)}</b></span>
                    {r.soChan > 0 && <span className="font-semibold tabular-nums text-state-warning-ink">Chặn {r.soChan}</span>}
                  </p>
                  <p className="mt-0.5 break-words text-xs tabular-nums text-muted-foreground">
                    Cơ sở tính {dinhDangDong(r.coSoTinh)}
                    {r.dieuChinh !== 0 && <span className={cn(r.dieuChinh < 0 && "text-state-danger-ink")}> · Điều chỉnh {dinhDangDong(r.dieuChinh)}</span>}
                    {r.lockedAt && (
                      <>
                        {" "}· Khoá <Moc d={r.lockedAt} /> · <NguoiKhoa ten={r.khoaBoi} />
                      </>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground tabular-nums">
          {ds.tong > 0 && `${(ds.trang - 1) * ds.coTrang + 1}–${Math.min(ds.trang * ds.coTrang, ds.tong)} / ${ds.tong} kỳ`}
        </p>
        <DieuHuongTrangLink trang={ds.trang} soTrang={ds.soTrang} hrefCua={(t) => href({ trang: t })} />
      </div>
    </section>
  );
}
