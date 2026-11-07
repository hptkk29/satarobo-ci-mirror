"use client";

// components/admin/nguon-hoa-hong/website/bang-website.tsx — BẢNG WEBSITE của tab «Website»: mỗi dòng một website (tên · gốc URL · tên miền · theo dõi · trạng thái · trang đích · campaign đang dùng)
// và các việc trên dòng (sửa · ngừng/bật lại · xoá · mở Sheet trang đích).
//
// ── Cột ghi thật, nút ghi thật (luật 12) ───────────────────────────────────────────────────────────────────
//  · Cả dòng là vùng bấm: `<tr relative cursor-pointer>` + nút tên website mang `after:inset-0` mở Sheet «Trang đích» (xem + thử địa chỉ — mở được với quyền xem). Ô «Thao tác» nằm TRÊN lớp phủ (`z-10`).
//  · Cột «Thao tác» và mọi nút ghi CHỈ có khi `coTheGhi` (nơi gọi truyền `scope.has("affiliate_campaigns:manage")` ∧ cờ Affiliate — ĐÚNG hai điều kiện mà Server Action kiểm); không phải nút xám.
//  · Nút «Xoá» CHỈ vẽ ở website trống (không trang đích, không campaign) — đúng điều kiện mà `kiemXoaWebsite` ở máy chủ chấp nhận; website đã dùng chỉ ngừng được.
//  · «Campaign đang dùng» CHỈ ĐỌC ở đây: việc gắn/gỡ website vào campaign thuộc màn Campaign.
//  · Đo ở 1280px (khung ~976px): đủ 6 cột + «Thao tác» chỉ vừa khi ẨN cột «Tên miền» (chỉ hiện từ `2xl`; dưới đó số tên miền nằm ở dòng phụ của cột Website) và cột «Campaign» chỉ hiện từ `xl`.
//    Cột «Thao tác» tràn ra ngoài khung là nút ghi nằm ngoài tầm với — đã thấy ở bản đầu (đo 13/10), nên đừng thêm cột mà chưa đo lại ở 1280px.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Power, PowerOff, Trash2 } from "lucide-react";
import { doiTrangThaiWebsiteAction, xoaWebsiteAction } from "@/app/(admin)/admin/nguon-hoa-hong/website/_actions";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import type { CampaignChon, DongWebsite } from "@/lib/affiliate/doc-website";
import { LY_DO_TOI_THIEU_WEBSITE, NHAN_TRANG_THAI_WEBSITE } from "@/lib/affiliate/ghi-website-dau-vao";
import { cn } from "@/lib/utils";
import { VO_BANG } from "../classes";
import { FormWebsite } from "./form-website";
import { HopThoaiLyDo } from "./hop-thoai-ly-do";
import { TrangDichSheet } from "./trang-dich-sheet";

/** Bảng 7 cột chen trong khung ~976px (sidebar 256px) ⇒ ô hẹp hơn mặc định (px-3, không px-5). */
const TH = cn(adminTh, "px-3");
const TD = cn(adminTd, "px-3");
const PHU_2XL = "hidden 2xl:table-cell";
const PHU_XL = "hidden xl:table-cell";

type HanhDong = { loai: "sua" | "trang-dich" | "ngung" | "bat-lai" | "xoa"; id: string };

const NUT_ICON =
  "inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:h-8 md:w-8";

export function BangWebsite({ dong, campaignChon, coTheGhi }: { dong: readonly DongWebsite[]; campaignChon: readonly CampaignChon[]; coTheGhi: boolean }) {
  const router = useRouter();
  const [hd, setHd] = useState<HanhDong | null>(null);
  const dongDangChon = hd ? (dong.find((w) => w.id === hd.id) ?? null) : null;
  const dongHop = () => setHd(null);
  const taiLai = () => router.refresh();

  return (
    <>
      <div className={VO_BANG}>
        <PhanTrangBang cuonNgang tenDonVi="website">
          <table className="w-full min-w-[480px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th scope="col" className={TH}>
                  Website
                </th>
                <th scope="col" className={cn(TH, PHU_2XL)}>
                  Tên miền
                </th>
                <th scope="col" className={TH}>
                  Theo dõi
                </th>
                <th scope="col" className={TH}>
                  Trạng thái
                </th>
                <th scope="col" className={cn(TH, "text-right")}>
                  Trang đích
                </th>
                <th scope="col" className={cn(TH, PHU_XL)}>
                  Campaign đang dùng
                </th>
                {coTheGhi && (
                  <th scope="col" className={cn(TH, "text-right")}>
                    Thao tác
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {dong.map((w) => {
                const soBat = w.trangDich.filter((t) => t.isActive).length;
                const coTheXoa = w.trangDich.length === 0 && w.campaigns.length === 0;
                return (
                  <tr key={w.id} className={cn(adminTr, "relative cursor-pointer")}>
                    <td className={cn(TD, "max-w-[14rem]")}>
                      <button
                        type="button"
                        onClick={() => setHd({ loai: "trang-dich", id: w.id })}
                        title="Xem trang đích và thử địa chỉ"
                        className="block max-w-full truncate text-left font-medium text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring after:absolute after:inset-0"
                      >
                        {w.name}
                      </button>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {w.code} · {w.baseUrl.replace(/^https:\/\//, "")}
                        {w.allowedDomains.length > 1 && <span className="2xl:hidden"> · +{w.allowedDomains.length - 1} tên miền</span>}
                      </span>
                    </td>
                    <td className={cn(TD, PHU_2XL, "max-w-[14rem]")}>
                      <span className="block truncate font-mono text-xs text-foreground" title={w.allowedDomains.join(", ")}>
                        {w.allowedDomains[0]}
                      </span>
                      {w.allowedDomains.length > 1 && <span className="block text-xs text-muted-foreground">+{w.allowedDomains.length - 1} tên miền khác</span>}
                    </td>
                    <td className={TD}>
                      {w.trackingEnabled ? (
                        <StatusPill tone="success" className="text-state-success-ink">
                          Bật
                        </StatusPill>
                      ) : (
                        <StatusPill tone="muted">Tắt</StatusPill>
                      )}
                    </td>
                    <td className={TD}>
                      <StatusPill tone={w.status === "ACTIVE" ? "success" : "muted"} className={w.status === "ACTIVE" ? "text-state-success-ink" : undefined}>
                        {NHAN_TRANG_THAI_WEBSITE[w.status]}
                      </StatusPill>
                    </td>
                    <td className={cn(TD, "text-right tabular-nums")}>
                      {w.trangDich.length === 0 ? (
                        <span className="text-muted-foreground">Chưa có</span>
                      ) : (
                        <>
                          <span className="block">{soBat} đang bật</span>
                          <span className="block text-xs text-muted-foreground">trên {w.trangDich.length} trang</span>
                        </>
                      )}
                    </td>
                    <td className={cn(TD, PHU_XL, "max-w-[11rem]")}>
                      {w.campaigns.length === 0 ? (
                        <span className="block truncate text-muted-foreground">Chưa gắn campaign nào</span>
                      ) : (
                        <>
                          <span className="block truncate text-foreground" title={w.campaigns.map((c) => c.name).join(", ")}>
                            {w.campaigns[0]!.name}
                          </span>
                          {w.campaigns.length > 1 && <span className="block text-xs text-muted-foreground">+{w.campaigns.length - 1} campaign khác</span>}
                        </>
                      )}
                    </td>
                    {/* Dưới `md` bảng cuộn ngang ⇒ ô Thao tác DÍNH mép phải; `z-10` để nằm TRÊN lớp phủ bấm-cả-dòng. */}
                    {coTheGhi && (
                      <td className={cn(TD, "sticky right-0 z-10 bg-card text-right md:relative md:bg-transparent")}>
                        <span className="inline-flex items-center justify-end gap-2">
                          <button type="button" onClick={() => setHd({ loai: "sua", id: w.id })} aria-label={`Sửa website ${w.name}`} title="Sửa website" className={NUT_ICON}>
                            <Pencil aria-hidden className="h-3.5 w-3.5" />
                          </button>
                          {w.status === "ACTIVE" ? (
                            <button type="button" onClick={() => setHd({ loai: "ngung", id: w.id })} aria-label={`Ngừng website ${w.name}`} title="Ngừng website" className={NUT_ICON}>
                              <PowerOff aria-hidden className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <button type="button" onClick={() => setHd({ loai: "bat-lai", id: w.id })} aria-label={`Bật lại website ${w.name}`} title="Bật lại website" className={NUT_ICON}>
                              <Power aria-hidden className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {coTheXoa && (
                            <button type="button" onClick={() => setHd({ loai: "xoa", id: w.id })} aria-label={`Xoá website ${w.name}`} title="Xoá website (chỉ khi chưa dùng)" className={NUT_ICON}>
                              <Trash2 aria-hidden className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>

      {hd && dongDangChon && hd.loai === "trang-dich" && <TrangDichSheet website={dongDangChon} coTheGhi={coTheGhi} dong={dongHop} />}
      {hd && dongDangChon && coTheGhi && hd.loai === "sua" && <FormWebsite cheDo="sua" website={dongDangChon} campaignChon={campaignChon} dong={dongHop} />}
      {hd && dongDangChon && coTheGhi && hd.loai === "ngung" && (
        <HopThoaiLyDo
          tieuDe={`Ngừng website «${dongDangChon.name}»`}
          moTa={
            <>
              Link giới thiệu trỏ về website này sẽ không còn hợp lệ cho tới khi bật lại; dữ liệu và trang đích được giữ nguyên.
              {dongDangChon.campaigns.length > 0 && (
                <>
                  {" "}
                  Website đang gắn <b>{dongDangChon.campaigns.length}</b> campaign (<b>{dongDangChon.campaigns.filter((c) => c.status === "ACTIVE").length}</b> đang chạy).
                </>
              )}
            </>
          }
          nhanXacNhan="Ngừng website"
          lyDoToiThieu={LY_DO_TOI_THIEU_WEBSITE}
          hanhDong={(lyDo) => doiTrangThaiWebsiteAction({ id: dongDangChon.id, updatedAtDaThay: dongDangChon.capNhatLuc, den: "INACTIVE", lyDo })}
          thongBaoXong={`Đã ngừng website «${dongDangChon.name}».`}
          dong={dongHop}
          taiLai={taiLai}
        />
      )}
      {hd && dongDangChon && coTheGhi && hd.loai === "bat-lai" && (
        <HopThoaiLyDo
          tieuDe={`Bật lại website «${dongDangChon.name}»`}
          moTa="Link giới thiệu trỏ về website này hợp lệ trở lại (nếu campaign và đối tác của link cũng đang hoạt động)."
          nhanXacNhan="Bật lại"
          lyDoToiThieu={0}
          hanhDong={(lyDo) => doiTrangThaiWebsiteAction({ id: dongDangChon.id, updatedAtDaThay: dongDangChon.capNhatLuc, den: "ACTIVE", lyDo })}
          thongBaoXong={`Đã bật lại website «${dongDangChon.name}».`}
          dong={dongHop}
          taiLai={taiLai}
        />
      )}
      {hd && dongDangChon && coTheGhi && hd.loai === "xoa" && (
        <HopThoaiLyDo
          tieuDe={`Xoá website «${dongDangChon.name}»`}
          moTa="Xoá hẳn website và không hoàn tác được. Chỉ xoá được website chưa gắn campaign và chưa có trang đích — website đã dùng thì chỉ ngừng."
          nhanXacNhan="Xoá website"
          nguyHiem
          lyDoToiThieu={LY_DO_TOI_THIEU_WEBSITE}
          hanhDong={(lyDo) => xoaWebsiteAction({ id: dongDangChon.id, updatedAtDaThay: dongDangChon.capNhatLuc, lyDo })}
          thongBaoXong={`Đã xoá website «${dongDangChon.name}».`}
          dong={dongHop}
          taiLai={taiLai}
        />
      )}
    </>
  );
}
