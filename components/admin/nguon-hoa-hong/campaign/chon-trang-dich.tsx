"use client";

// components/admin/nguon-hoa-hong/campaign/chon-trang-dich.tsx — Sheet «Trang đích được dùng» của MỘT website trong MỘT campaign (AFF-L6).
//
// Luật (hiển thị đúng điều máy chủ thi hành, `datTrangDichCampaign`): KHÔNG chọn trang nào = mọi trang đích đang bật của website dùng được; CÓ chọn = chỉ các trang đã chọn. Cổng thật ở máy chủ
// (mọi id thuộc đúng website · đang bật + bật theo dõi · campaign chưa kết thúc). Thu hẹp mà làm chết link đang chạy ⇒ máy chủ TỪ CHỐI kèm số link; Sheet hiện số đó và hỏi lại, bấm «Vẫn thu hẹp»
// mới gửi `xacNhan: true` — người bấm không bao giờ làm hỏng link đang chạy mà không biết. Trang đang tắt hiện nhưng `disabled` (chọn nó là hứa suông).
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { datTrangDichCampaignAction } from "@/app/(admin)/admin/nguon-hoa-hong/campaign/_actions";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LY_DO_TOI_THIEU_CAMPAIGN, type KetQuaDatTrangDich, type WebsiteGanView } from "@/lib/affiliate/ghi-campaign-dau-vao";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, NUT_CHAN } from "../classes";

export type DatTrangDich = (i: { campaignId: string; siteId: string; landingPageIds: string[]; xacNhan: boolean; lyDo: string | null }) => Promise<KetQuaDatTrangDich>;
export const DAT_TRANG_DICH_MAC_DINH: DatTrangDich = (i) => datTrangDichCampaignAction(i);

/** Câu mô tả lựa chọn hiện tại của một website trong campaign (dùng ở bảng và ở Sheet). */
export function moTaTrangDaChon(w: Pick<WebsiteGanView, "trangDich" | "trangDaChon">): string {
  if (w.trangDaChon.length === 0) {
    const bat = w.trangDich.filter((t) => t.isActive && t.trackingEnabled).length;
    return `Mọi trang đích đang bật (${bat})`;
  }
  return `${w.trangDaChon.length} trang đã chọn`;
}

export function ChonTrangDich({
  campaignId,
  website,
  dong,
  dat = DAT_TRANG_DICH_MAC_DINH,
}: {
  campaignId: string;
  website: WebsiteGanView;
  dong: () => void;
  dat?: DatTrangDich;
}) {
  const router = useRouter();
  const uid = useId();
  const [chon, setChon] = useState<string[]>(website.trangDaChon);
  const [dangLuu, setDangLuu] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const [hoi, setHoi] = useState<number | null>(null);
  const [lyDo, setLyDo] = useState("");

  const bat = (id: string) => setChon((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  async function luu(xacNhan: boolean) {
    if (dangLuu) return;
    setLoi(null);
    setDangLuu(true);
    let r: KetQuaDatTrangDich;
    try {
      r = await dat({ campaignId, siteId: website.id, landingPageIds: chon, xacNhan, lyDo: xacNhan ? lyDo.trim() : null });
    } catch {
      r = { ok: false, loi: "Không lưu được lúc này. Thử lại sau ít giây." };
    }
    setDangLuu(false);
    if (!r.ok) {
      if (r.canXacNhan) {
        setHoi(r.soLinkAnhHuong ?? 0);
        return;
      }
      setHoi(null);
      setLoi(r.loi);
      return;
    }
    toast.success(chon.length === 0 ? "Đã bỏ hạn chế: mọi trang đích đang bật dùng được." : `Đã chọn ${chon.length} trang đích.`);
    dong();
    router.refresh();
  }

  return (
    <Sheet open onOpenChange={(m) => !m && !dangLuu && dong()}>
      <SheetContent className="admin-scope w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border p-5 pr-12">
          <SheetTitle className="text-base font-semibold">Trang đích — {website.ten}</SheetTitle>
          <SheetDescription>
            Không chọn trang nào = campaign dùng được MỌI trang đích đang bật của website. Có chọn = chỉ các trang đã chọn (áp cho cả Admin lẫn cổng đối tác).
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 p-5">
          {website.trangDich.length === 0 ? (
            <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">Website chưa có trang đích nào — thêm ở tab Website.</p>
          ) : (
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-foreground">Trang đích được dùng ({chon.length === 0 ? "tất cả" : `${chon.length} đã chọn`})</legend>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {website.trangDich.map((t) => {
                  const khoa = !t.isActive || !t.trackingEnabled;
                  const da = chon.includes(t.id);
                  return (
                    <li key={t.id} className="flex items-start gap-3 px-4 py-3">
                      <input
                        id={`${uid}-${t.id}`}
                        type="checkbox"
                        checked={da}
                        // Trang đã được chọn từ trước mà nay tắt vẫn cho BỎ chọn (không kẹt); chỉ không cho chọn MỚI.
                        disabled={dangLuu || (khoa && !da)}
                        onChange={() => {
                          setHoi(null);
                          bat(t.id);
                        }}
                        className="mt-1 h-4 w-4"
                      />
                      <label htmlFor={`${uid}-${t.id}`} className="min-w-0 flex-1 text-sm">
                        <span className="block break-all font-mono text-foreground">
                          {t.host}
                          {t.pathPattern}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {t.label ? `${t.label} · ` : ""}
                          {!t.isActive ? "Đang tắt — bật ở tab Website" : !t.trackingEnabled ? "Đang tắt theo dõi — bật ở tab Website" : t.pathPattern.endsWith("/*") ? "Mọi trang dưới đường dẫn này" : "Đúng một trang"}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}

          {hoi !== null && (
            <div role="alert" data-can-xac-nhan className="flex items-start gap-2 rounded-lg bg-state-warning-soft px-3 py-2.5 text-sm text-state-warning-ink">
              <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Thu hẹp này làm <b>{hoi}</b> link đang hoạt động không còn hiệu lực (khách bấm sẽ tới trang đích sạch, không gắn người giới thiệu). Lịch sử lượt bấm và referral vẫn giữ nguyên.
              </p>
            </div>
          )}
          {hoi !== null && (
            <div>
              <label htmlFor={`${uid}-ly-do`} className="mb-1 block text-sm font-semibold text-foreground">
                Lý do thu hẹp <span className="font-normal text-muted-foreground">(tối thiểu {LY_DO_TOI_THIEU_CAMPAIGN} ký tự, lưu vào nhật ký)</span>
              </label>
              <textarea
                id={`${uid}-ly-do`}
                value={lyDo}
                onChange={(e) => setLyDo(e.target.value)}
                rows={2}
                maxLength={500}
                disabled={dangLuu}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          )}
          {loi && (
            <p role="alert" className="rounded-lg bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink">
              {loi}
            </p>
          )}
        </div>
        <div className="sticky bottom-0 z-10 mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-border bg-popover p-4">
          <button type="button" onClick={dong} disabled={dangLuu} className={cn(BTN_OUTLINE, NUT_CHAN)}>
            Huỷ
          </button>
          <button type="button" onClick={() => void luu(hoi !== null)} disabled={dangLuu || website.trangDich.length === 0 || (hoi !== null && lyDo.trim().length < LY_DO_TOI_THIEU_CAMPAIGN)} className={cn(BTN_PRIMARY, NUT_CHAN)}>
            {dangLuu && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
            {hoi !== null ? "Vẫn thu hẹp" : "Lưu"}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
