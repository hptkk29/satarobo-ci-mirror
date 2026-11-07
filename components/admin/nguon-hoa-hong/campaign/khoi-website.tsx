"use client";

// components/admin/nguon-hoa-hong/campaign/khoi-website.tsx — KHỐI «Website» của trang chi tiết campaign: website nào được đặt link của campaign này.
//
// CHỈ gắn / gỡ và liệt kê: tạo và sửa website là việc của tab Website. Website TẮT hiện ở danh sách (kèm cảnh báo — nó không tính vào điều kiện kích hoạt) nhưng KHÔNG gắn mới được.
//
// ── Nút nói thật (luật 12) ────────────────────────────────────────────────────────────────────────────────────
// · Nút «Gỡ» của từng dòng vẽ theo `kiemGoWebsite` (CÙNG hàm với cổng ghi): campaign đang chạy không có nút gỡ ở website bật cuối cùng — thay bằng câu nói vì sao.
// · Form gắn chỉ vẽ khi `coTheGhi` (người xem có `affiliate_campaigns:manage`) và campaign chưa ENDED; ô chọn chỉ cho website BẬT chưa gắn (website tắt có mặt nhưng `disabled`, kèm chữ «đang tắt»).
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Unlink } from "lucide-react";
import { toast } from "sonner";
import { ganWebsiteAction, goWebsiteAction } from "@/app/(admin)/admin/nguon-hoa-hong/campaign/_actions";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { kiemGoWebsite, type KetQuaViecCon, type TrangThaiCampaign, type WebsiteGanView, type WebsiteView } from "@/lib/affiliate/ghi-campaign-dau-vao";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD, LOI_O, NHAN_O, NUT_NHO, VO_BANG } from "../classes";
import { ChonTrangDich, moTaTrangDaChon, type DatTrangDich } from "./chon-trang-dich";
import { HopThoaiLyDo } from "./hop-thoai-ly-do";
import { INK_THEO_TONE } from "../trang-thai-nguon-pill";

type Gan = (i: { campaignId: string; siteId: string }) => Promise<KetQuaViecCon>;
type Go = (i: { campaignId: string; siteId: string; lyDo: string | null }) => Promise<KetQuaViecCon>;
const GAN_MAC_DINH: Gan = (i) => ganWebsiteAction(i);
const GO_MAC_DINH: Go = (i) => goWebsiteAction(i);

const TH = cn(adminTh, "px-3");
const TD = cn(adminTd, "px-3");

export function KhoiWebsite({
  campaignId,
  trangThai,
  daGan,
  tatCa,
  coTheGhi,
  gan = GAN_MAC_DINH,
  go = GO_MAC_DINH,
  datTrang,
}: {
  campaignId: string;
  trangThai: TrangThaiCampaign;
  /** Website đã gắn vào campaign này. */
  daGan: readonly WebsiteGanView[];
  /** Mọi website trong hệ thống (để chọn gắn thêm). */
  tatCa: readonly WebsiteView[];
  /** Người xem có `affiliate_campaigns:manage` không. BẮT BUỘC (luật 7). */
  coTheGhi: boolean;
  gan?: Gan;
  go?: Go;
  /** Hàm lưu trang đích được chọn (tiêm cho test; mặc định là Server Action). */
  datTrang?: DatTrangDich;
}) {
  const [goSite, setGoSite] = useState<WebsiteView | null>(null);
  const [chonTrangId, setChonTrangId] = useState<string | null>(null);
  const chonTrang = chonTrangId === null ? null : (daGan.find((w) => w.id === chonTrangId) ?? null);
  const soBat = daGan.filter((w) => w.status === "ACTIVE").length;
  const khoaChung = trangThai === "ENDED";
  return (
    <div>
      {daGan.length === 0 ? (
        <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">Chưa gắn website nào. Campaign cần ít nhất một website đang bật mới kích hoạt được.</p>
      ) : (
        <div className={VO_BANG}>
          <PhanTrangBang tenDonVi="website" cuonNgang>
            <table className="w-full min-w-[560px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th scope="col" className={TH}>
                    Website
                  </th>
                  <th scope="col" className={TH}>
                    Địa chỉ
                  </th>
                  <th scope="col" className={TH}>
                    Trạng thái
                  </th>
                  <th scope="col" className={TH}>
                    Trang đích được dùng
                  </th>
                  {coTheGhi && !khoaChung && (
                    <th scope="col" className={cn(TH, "text-right")}>
                      Thao tác
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {daGan.map((w) => {
                  const cong = kiemGoWebsite({ trangThai, daGan: true, soWebsiteBatConLai: soBat - (w.status === "ACTIVE" ? 1 : 0) });
                  return (
                    <tr key={w.id} className={adminTr}>
                      <td className={TD}>
                        <span className="font-medium">{w.ten}</span>
                        <span className="block font-mono text-xs text-muted-foreground">{w.code}</span>
                      </td>
                      <td className={cn(TD, "max-w-[18rem] truncate text-muted-foreground")} title={w.baseUrl}>
                        {w.baseUrl}
                      </td>
                      <td className={TD}>
                        {w.status === "ACTIVE" ? (
                          <StatusPill tone="success" className={INK_THEO_TONE.success}>
                            Đang bật
                          </StatusPill>
                        ) : (
                          <span title="Website đang tắt — không tính vào điều kiện kích hoạt campaign.">
                            <StatusPill tone="warning" className={INK_THEO_TONE.warning}>
                              Đang tắt
                            </StatusPill>
                          </span>
                        )}
                      </td>
                      <td className={cn(TD, "max-w-[14rem] whitespace-normal")} data-trang-dich-campaign>
                        <span className={w.trangDaChon.length > 0 ? "font-medium text-foreground" : "text-muted-foreground"}>{moTaTrangDaChon(w)}</span>
                      </td>
                      {coTheGhi && !khoaChung && (
                        <td className={cn(TD, "text-right whitespace-normal")}>
                          <button type="button" onClick={() => setChonTrangId(w.id)} aria-label={`Chọn trang đích của website ${w.ten}`} className={cn(BTN_OUTLINE, NUT_NHO, "mr-2")}>
                            Trang đích
                          </button>
                          {cong.ok ? (
                            <button type="button" onClick={() => setGoSite(w)} aria-label={`Gỡ website ${w.ten} khỏi campaign`} className={cn(BTN_OUTLINE, NUT_NHO)}>
                              <Unlink aria-hidden className="h-3.5 w-3.5" />
                              Gỡ
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground">Website bật cuối cùng — gắn website khác hoặc tạm dừng trước khi gỡ</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </PhanTrangBang>
        </div>
      )}

      {coTheGhi && !khoaChung && <FormGan campaignId={campaignId} daGan={daGan} tatCa={tatCa} gan={gan} />}

      {chonTrang && coTheGhi && !khoaChung && <ChonTrangDich campaignId={campaignId} website={chonTrang} dong={() => setChonTrangId(null)} dat={datTrang} />}

      {goSite && (
        <HopThoaiLyDo
          tieuDe={`Gỡ website «${goSite.ten}» khỏi campaign`}
          moTa="Link đã tạo trên website này cho campaign không còn hợp lệ từ lúc gỡ. Gắn lại được bất cứ lúc nào."
          nhanXacNhan="Gỡ website"
          nguyHiem
          canLyDo={false}
          lyDoToiThieu={0}
          thanhCong="Đã gỡ website."
          xacNhan={(lyDo) => go({ campaignId, siteId: goSite.id, lyDo })}
          dong={() => setGoSite(null)}
        />
      )}
    </div>
  );
}

function FormGan({ campaignId, daGan, tatCa, gan }: { campaignId: string; daGan: readonly WebsiteView[]; tatCa: readonly WebsiteView[]; gan: Gan }) {
  const router = useRouter();
  const uid = useId();
  const [siteId, setSiteId] = useState("");
  const [loi, setLoi] = useState<string | null>(null);
  const [dangLuu, setDangLuu] = useState(false);
  const daGanId = new Set(daGan.map((w) => w.id));
  const chuaGan = tatCa.filter((w) => !daGanId.has(w.id));

  async function nop(e: React.FormEvent) {
    e.preventDefault();
    if (dangLuu) return;
    if (siteId === "") {
      setLoi("Chọn website muốn gắn.");
      return;
    }
    setLoi(null);
    setDangLuu(true);
    let r: KetQuaViecCon;
    try {
      r = await gan({ campaignId, siteId });
    } catch {
      r = { ok: false, loi: "Không lưu được lúc này. Thử lại sau ít giây." };
    }
    setDangLuu(false);
    if (!r.ok) {
      setLoi(r.loi);
      return;
    }
    toast.success("Đã gắn website vào campaign.");
    setSiteId("");
    router.refresh();
  }

  return (
    <form onSubmit={nop} noValidate aria-label="Gắn website vào campaign" className="mt-4 flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1 sm:max-w-md">
        <label htmlFor={`${uid}-site`} className={NHAN_O}>
          Gắn thêm website
        </label>
        <select
          id={`${uid}-site`}
          value={siteId}
          onChange={(e) => {
            setSiteId(e.target.value);
            setLoi(null);
          }}
          disabled={chuaGan.length === 0}
          aria-invalid={loi ? true : undefined}
          aria-describedby={loi ? `${uid}-loi` : undefined}
          className={FIELD}
        >
          <option value="">{chuaGan.length === 0 ? "— Không còn website nào để gắn —" : "— Chọn website —"}</option>
          {chuaGan.map((w) => (
            <option key={w.id} value={w.id} disabled={w.status !== "ACTIVE"}>
              {w.ten}
              {w.status !== "ACTIVE" ? " (đang tắt — bật lại ở tab Website)" : ""}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={dangLuu || chuaGan.length === 0} className={BTN_PRIMARY}>
        {dangLuu ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Plus aria-hidden className="h-4 w-4" />}
        Gắn website
      </button>
      {loi && (
        <p id={`${uid}-loi`} role="alert" className={cn(LOI_O, "basis-full")}>
          {loi}
        </p>
      )}
    </form>
  );
}
