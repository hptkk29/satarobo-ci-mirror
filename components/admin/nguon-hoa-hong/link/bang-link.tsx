"use client";

// components/admin/nguon-hoa-hong/link/bang-link.tsx — BẢNG LINK / QR / MÃ của tab «Link / QR / Mã»: Đối tác · Campaign · Website · Trang đích & URL cuối · Loại · Trạng thái · Lượt bấm · Referral · Tạo lúc · Thao tác.
//
// ── Cột và nút nói thật (luật 12) ───────────────────────────────────────────────────────────────────────────
//  · Cột «Thao tác» và mọi nút ghi CHỈ có khi `coTheGhi` (nơi gọi truyền `scope.has("affiliate_links:manage")` ∧ cờ Affiliate — ĐÚNG hai điều kiện mà Server Action kiểm). Người chỉ có
//    `affiliates:view` không nhận token đầy đủ (tầng đọc đã che) nên cũng không có nút sao chép / QR — chúng không có gì để sao chép.
//  · «Sao chép» / «QR» / «Xoay mã» CHỈ vẽ cho link ĐANG DÙNG ĐƯỢC (`trangThai = ACTIVE` ∧ `lyDoKhongDung = null`): sao chép link của campaign đang tạm dừng là đưa người ta một link khách bấm vào bị từ chối;
//    «Thu hồi» vẫn có cho link ACTIVE dù chuỗi đang hỏng (thu hồi luôn làm được). Link đã thu hồi KHÔNG có nút nào (không bật lại được).
//  · «Referral» là referral HỢP LỆ (VALID) gắn vào link; «URL cuối» là nơi khách thật sự tới (người chỉ xem: địa chỉ sạch, không token).
//  · «Lượt bấm» là lượt bấm HỢP LỆ; lượt bấm vào link đã chết/không hợp lệ hiện thành dòng phụ riêng — không trộn vào con số chính.
//  · Cả hai dạng link sao chép được: dạng NGẮN `<gốc cấu hình>/r/<mã>` (QR / in ấn — đo được lượt bấm) và dạng TRỰC TIẾP `…?aff=&cmp=` (đặt trên site đối tác).
//  · KHÔNG nhận hàm làm prop từ trang (hàm không vượt được ranh giới Server → Client Component): thanh phân trang `<DieuHuongTrangLink>` do TRANG vẽ.
//  · Đo ở 1280px (khung ~976px): cột «Campaign» và «Tạo lúc» chỉ hiện từ `xl`; dưới đó campaign nằm ở dòng phụ của đối tác và ngày tạo ở dòng phụ của lượt bấm.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Link2, QrCode, RotateCw, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { taoQrAction, thuHoiLinkAction, xoayLinkAction } from "@/app/(admin)/admin/nguon-hoa-hong/link/_actions";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import type { DongLink } from "@/lib/affiliate/doc-link";
import { LY_DO_TOI_THIEU_LINK, NHAN_LOAI_LINK } from "@/lib/affiliate/ghi-link-dau-vao";
import { cn } from "@/lib/utils";
import { VO_BANG } from "../classes";
import { soVN } from "../nhan-nguon";
import { HopThoaiLyDo, type KetQuaViec } from "../website/hop-thoai-ly-do";
import { QrDialog, type KetQuaQrGiaoDien } from "./qr-dialog";
import { TrangThaiLinkPill } from "./trang-thai-link-pill";

const TH = cn(adminTh, "px-3");
const TD = cn(adminTd, "px-3");
const PHU_XL = "hidden xl:table-cell";
const NUT_ICON =
  "inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:h-8 md:w-8";

type ThuHoi = (i: { id: string; updatedAtDaThay: string; lyDo: string | null }) => Promise<KetQuaViec>;
type TaoQr = (i: { id: string }) => Promise<KetQuaQrGiaoDien>;
const THU_HOI_MAC_DINH: ThuHoi = (i) => thuHoiLinkAction(i);
const XOAY_MAC_DINH: ThuHoi = (i) => xoayLinkAction(i);
const TAO_QR_MAC_DINH: TaoQr = (i) => taoQrAction(i);

type HanhDong = { loai: "thu-hoi" | "xoay"; id: string } | { loai: "qr"; id: string; kq: KetQuaQrGiaoDien | null };

const ngayVN = (iso: string) => new Date(iso).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" });

export function BangLink({
  dong,
  coTheGhi,
  thuHoi = THU_HOI_MAC_DINH,
  xoay = XOAY_MAC_DINH,
  taoQr = TAO_QR_MAC_DINH,
}: {
  dong: readonly DongLink[];
  /** `scope.has("affiliate_links:manage")` ∧ cờ Affiliate. Page tính, bảng không đoán (luật 7: bắt buộc). */
  coTheGhi: boolean;
  thuHoi?: ThuHoi;
  xoay?: ThuHoi;
  taoQr?: TaoQr;
}) {
  const router = useRouter();
  const [hd, setHd] = useState<HanhDong | null>(null);
  const dongDangChon = hd ? (dong.find((d) => d.id === hd.id) ?? null) : null;
  const dongHop = () => setHd(null);
  const taiLai = () => router.refresh();

  async function chep(nhan: string, link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast.success(`Đã sao chép ${nhan}.`);
    } catch {
      toast.error(`Không sao chép được — hãy sao chép thủ công: ${link}`);
    }
  }

  async function moQr(d: DongLink) {
    setHd({ loai: "qr", id: d.id, kq: null });
    let kq: KetQuaQrGiaoDien;
    try {
      kq = await taoQr({ id: d.id });
    } catch {
      kq = { ok: false, loi: "Không dựng được QR lúc này. Thử lại sau ít giây." };
    }
    setHd((cu) => (cu && cu.loai === "qr" && cu.id === d.id ? { loai: "qr", id: d.id, kq } : cu));
  }

  return (
    <>
      <div className={VO_BANG}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th scope="col" className={TH}>
                  Đối tác
                </th>
                <th scope="col" className={cn(TH, PHU_XL)}>
                  Campaign
                </th>
                <th scope="col" className={TH}>
                  Website
                </th>
                <th scope="col" className={TH}>
                  Trang đích · URL cuối
                </th>
                <th scope="col" className={TH}>
                  Loại
                </th>
                <th scope="col" className={TH}>
                  Trạng thái
                </th>
                <th scope="col" className={cn(TH, "text-right")}>
                  Lượt bấm
                </th>
                <th scope="col" className={cn(TH, "text-right")}>
                  Referral
                </th>
                <th scope="col" className={cn(TH, PHU_XL)}>
                  Tạo lúc
                </th>
                {coTheGhi && (
                  <th scope="col" className={cn(TH, "text-right")}>
                    Thao tác
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {dong.map((d) => {
                const dangDung = d.trangThai === "ACTIVE" && d.lyDoKhongDung === null;
                return (
                  <tr key={d.id} className={adminTr}>
                    <td className={cn(TD, "max-w-[14rem]")}>
                      <span className="block truncate font-medium text-foreground" title={d.doiTac.ten}>
                        {d.doiTac.ten}
                      </span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">{d.doiTac.ma}</span>
                      <span className="block truncate text-xs text-muted-foreground xl:hidden" title={d.campaign.ten}>
                        {d.campaign.ten}
                      </span>
                    </td>
                    <td className={cn(TD, PHU_XL, "max-w-[11rem]")}>
                      <span className="block truncate text-foreground" title={d.campaign.ten}>
                        {d.campaign.ten}
                      </span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">{d.campaign.ma}</span>
                    </td>
                    <td className={cn(TD, "max-w-[11rem]")}>
                      <span className="block truncate text-foreground" title={d.website.ten}>
                        {d.website.ten}
                      </span>
                      <span className="block truncate font-mono text-xs text-muted-foreground" title={d.website.host}>
                        {d.website.host}
                      </span>
                    </td>
                    <td className={cn(TD, "max-w-[15rem]")}>
                      <span className="block truncate font-mono text-xs text-foreground" title={`${d.website.host}${d.landingPath}`}>
                        {d.landingPath}
                      </span>
                      {/* URL cuối: một định nghĩa ở tầng đọc (`urlCuoi`) — người chỉ xem nhận địa chỉ SẠCH (không token). Link đã thu hồi: không có. */}
                      <span data-url-cuoi className="block truncate font-mono text-xs text-muted-foreground" title={d.urlCuoi ?? undefined}>
                        {d.urlCuoi ?? "—"}
                      </span>
                    </td>
                    <td className={TD}>
                      <span className="block text-foreground">{NHAN_LOAI_LINK[d.loai]}</span>
                      <span className="block font-mono text-xs text-muted-foreground" title={d.nhan ?? undefined}>
                        {d.token}
                      </span>
                      {d.nhan && <span className="block max-w-[9rem] truncate text-xs text-muted-foreground">{d.nhan}</span>}
                    </td>
                    <td className={cn(TD, "max-w-[12rem]")}>
                      <TrangThaiLinkPill trangThai={d.trangThai} lyDoKhongDung={d.lyDoKhongDung} />
                      {d.lyDoKhongDung && <span className="mt-1 block text-xs text-muted-foreground">{d.lyDoKhongDung}</span>}
                      {d.trangThai === "REVOKED" && d.lyDoThuHoi && (
                        <span className="mt-1 block truncate text-xs text-muted-foreground" title={d.lyDoThuHoi}>
                          {d.lyDoThuHoi}
                        </span>
                      )}
                    </td>
                    <td className={cn(TD, "text-right tabular-nums")}>
                      <span className="block font-semibold text-foreground">{soVN(d.soLuotBam)}</span>
                      {d.soLuotBamLoi > 0 && (
                        <span className="block text-xs text-muted-foreground" title="Lượt bấm vào link đã thu hồi hoặc không còn hợp lệ">
                          +{soVN(d.soLuotBamLoi)} không hợp lệ
                        </span>
                      )}
                      <span className="block text-xs text-muted-foreground xl:hidden">{ngayVN(d.taoLuc)}</span>
                    </td>
                    <td className={cn(TD, "text-right tabular-nums")} title="Referral hợp lệ: khách để lại thông tin qua link này và được ghi nhận cho đối tác">
                      <span data-so-referral className="block font-semibold text-foreground">
                        {soVN(d.soReferral)}
                      </span>
                    </td>
                    <td className={cn(TD, PHU_XL, "tabular-nums text-muted-foreground")}>{ngayVN(d.taoLuc)}</td>
                    {coTheGhi && (
                      <td className={cn(TD, "text-right")}>
                        {d.trangThai === "ACTIVE" && (
                          <span className="inline-flex flex-nowrap items-center justify-end gap-2">
                            {dangDung && d.lienKetNgan && (
                              <button type="button" onClick={() => void chep("link ngắn (dùng cho QR, in ấn)", d.lienKetNgan!)} aria-label={`Sao chép link ngắn của ${d.doiTac.ten}`} title="Sao chép link ngắn (QR, in ấn)" className={NUT_ICON}>
                                <Copy aria-hidden className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {dangDung && d.lienKetTrucTiep && (
                              <button type="button" onClick={() => void chep("link trực tiếp (đặt trên website đối tác)", d.lienKetTrucTiep!)} aria-label={`Sao chép link trực tiếp của ${d.doiTac.ten}`} title="Sao chép link trực tiếp (?aff=&cmp=)" className={NUT_ICON}>
                                <Link2 aria-hidden className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {dangDung && (
                              <button type="button" onClick={() => void moQr(d)} aria-label={`Xem mã QR của ${d.doiTac.ten}`} title="Mã QR" className={NUT_ICON}>
                                <QrCode aria-hidden className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {dangDung && (
                              <button type="button" onClick={() => setHd({ loai: "xoay", id: d.id })} aria-label={`Xoay mã link của ${d.doiTac.ten}`} title="Xoay mã (thu hồi và phát mã mới)" className={NUT_ICON}>
                                <RotateCw aria-hidden className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button type="button" onClick={() => setHd({ loai: "thu-hoi", id: d.id })} aria-label={`Thu hồi link của ${d.doiTac.ten}`} title="Thu hồi link" className={NUT_ICON}>
                              <Undo2 aria-hidden className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {hd && dongDangChon && coTheGhi && hd.loai === "thu-hoi" && (
        <HopThoaiLyDo
          tieuDe={`Thu hồi link của «${dongDangChon.doiTac.ten}»`}
          moTa="Link ngừng được ghi nhận ngay: khách bấm vào vẫn tới trang đích nhưng không còn gắn người giới thiệu. Thu hồi KHÔNG hoàn tác được — muốn dùng tiếp phải phát link mới."
          nhanXacNhan="Thu hồi link"
          nguyHiem
          lyDoToiThieu={LY_DO_TOI_THIEU_LINK}
          hanhDong={(lyDo) => thuHoi({ id: dongDangChon.id, updatedAtDaThay: dongDangChon.capNhatLuc, lyDo })}
          thongBaoXong="Đã thu hồi link."
          dong={dongHop}
          taiLai={taiLai}
        />
      )}
      {hd && dongDangChon && coTheGhi && hd.loai === "xoay" && (
        <HopThoaiLyDo
          tieuDe={`Xoay mã link của «${dongDangChon.doiTac.ten}»`}
          moTa="Link hiện tại bị thu hồi và một link MỚI (cùng đối tác, website, đường dẫn, loại) được phát ngay. QR / link đã in hoặc đã đặt ở nơi khác sẽ ngừng hoạt động — nhớ thay bằng link mới."
          nhanXacNhan="Xoay mã"
          lyDoToiThieu={LY_DO_TOI_THIEU_LINK}
          hanhDong={(lyDo) => xoay({ id: dongDangChon.id, updatedAtDaThay: dongDangChon.capNhatLuc, lyDo })}
          thongBaoXong="Đã xoay mã: link mới đã được phát."
          dong={dongHop}
          taiLai={taiLai}
        />
      )}
      {hd && dongDangChon && coTheGhi && hd.loai === "qr" && <QrDialog tenDoiTac={dongDangChon.doiTac.ten} kq={hd.kq} dong={dongHop} />}
    </>
  );
}
