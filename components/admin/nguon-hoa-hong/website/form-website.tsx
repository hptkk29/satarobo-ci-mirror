"use client";

// components/admin/nguon-hoa-hong/website/form-website.tsx — Sheet TẠO / SỬA website Affiliate (+ nút «Thêm website» của đầu trang).
//
// ── Một luật, hai nơi chạy ─────────────────────────────────────────────────────────────────────────────────────
// KHÔNG có luật nào được viết ở đây. Kiểm tra là `chuanHoaNoiDungWebsite` · `kiemMaWebsite` (lib/affiliate/ghi-website-dau-vao.ts) — CHÍNH các hàm mà cổng ghi chạy lại trong transaction.
// Lỗi hiện CẠNH ô nó nói tới (`aria-invalid` + `role="alert"`) và lấy ô lỗi đầu tiên để focus; lỗi máy chủ mang `truong` được gắn đúng ô, các lỗi còn lại là banner.
//
// ── Nói thật (luật 12) ─────────────────────────────────────────────────────────────────────────────────────────
//  · Mã website KHÔNG đổi được sau khi tạo — ở chế độ sửa nó là chữ chỉ-đọc kèm câu nói rõ, không phải ô xám bấm được.
//  · Sửa chỉ gửi các trường THẬT SỰ đổi (biểu mẫu nào cũng giữ nguyên các ô còn lại): website cũ mang gốc URL không còn đúng luật mới vẫn sửa được tên.
//  · «Lưu» khoá khi chưa đổi gì và NÓI điều đó; không có nút nào mà máy chủ sẽ từ chối vì thiếu quyền (nơi gọi chỉ dựng component này khi `scope.has("affiliate_campaigns:manage")`).
//  · Khoá lạc quan: «vừa được người khác đổi» ⇒ banner + «Tải lại» (nói thẳng là bỏ các chỗ đang sửa).
//
// Hàm lưu được TIÊM (`luuTao`, `luuSua`) — mặc định là Server Action; test dựng bằng hàm giả.
import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Plus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { suaWebsiteAction, taoWebsiteAction } from "@/app/(admin)/admin/nguon-hoa-hong/website/_actions";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { chuanHoaMa } from "@/lib/affiliate/chung";
import type { CampaignChon, DongWebsite } from "@/lib/affiliate/doc-website";
import type { KetQuaSuaWebsite, KetQuaTaoWebsite } from "@/lib/affiliate/ghi-website";
import { DO_DAI_TEN_TOI_DA, chuanHoaNoiDungWebsite, kiemMaWebsite } from "@/lib/affiliate/ghi-website-dau-vao";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, LOI_O, NHAN_O, NUT_CHAN, NUT_NHO, O_NHAP, TEXTAREA } from "../classes";
import { OTenMien } from "./o-ten-mien";

type LuuTao = (vao: Record<string, unknown>) => Promise<KetQuaTaoWebsite>;
type LuuSua = (i: { id: string; updatedAtDaThay: string; vao: Record<string, unknown>; lyDo: string | null }) => Promise<KetQuaSuaWebsite>;
const LUU_TAO_MAC_DINH: LuuTao = (vao) => taoWebsiteAction({ vao });
const LUU_SUA_MAC_DINH: LuuSua = (i) => suaWebsiteAction(i);

type Truong = "code" | "name" | "baseUrl" | "allowedDomains" | "defaultCampaignId";
type Loi = Partial<Record<Truong, string>>;
const THU_TU_TRUONG: Truong[] = ["code", "name", "baseUrl", "allowedDomains", "defaultCampaignId"];
const laTruong = (t: string | undefined): t is Truong => t !== undefined && (THU_TU_TRUONG as string[]).includes(t);

const cungMang = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export type FormWebsiteProps = {
  cheDo: "tao" | "sua";
  /** Chỉ chế độ sửa. */
  website?: DongWebsite;
  campaignChon: readonly CampaignChon[];
  dong: () => void;
  luuTao?: LuuTao;
  luuSua?: LuuSua;
};

export function FormWebsite({ cheDo, website, campaignChon, dong, luuTao = LUU_TAO_MAC_DINH, luuSua = LUU_SUA_MAC_DINH }: FormWebsiteProps) {
  const router = useRouter();
  const id = useId();
  const sua = cheDo === "sua" && website !== undefined;

  const [ma, setMa] = useState("");
  const [ten, setTen] = useState(website?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(website?.baseUrl ?? "");
  const [domains, setDomains] = useState<string[]>(website ? [...website.allowedDomains] : []);
  const [theoDoi, setTheoDoi] = useState(website?.trackingEnabled ?? true);
  const [campaignId, setCampaignId] = useState(website?.defaultCampaignId ?? "");
  const [ghiChu, setGhiChu] = useState("");
  const [loi, setLoi] = useState<Loi>({});
  const [banner, setBanner] = useState<{ text: string; vuaDoi: boolean } | null>(null);
  const [dangLuu, setDangLuu] = useState(false);

  const idTruong = (t: Truong) => `${id}-${t}`;

  // Danh sách chọn campaign mặc định: campaign chưa kết thúc + (nếu có) campaign mặc định hiện tại dù ĐÃ KẾT THÚC — để ô hiển thị đúng thứ đang lưu thay vì lặng lẽ nhảy về «không chọn».
  const luaChonCampaign = useMemo(() => {
    const ds = campaignChon.map((c) => ({ id: c.id, nhan: `${c.name} (${c.code})`, ketThuc: false }));
    const hienTai = website?.defaultCampaign;
    if (hienTai && !ds.some((c) => c.id === hienTai.id)) ds.push({ id: hienTai.id, nhan: `${hienTai.name} (${hienTai.code}) — đã kết thúc`, ketThuc: true });
    return ds;
  }, [campaignChon, website]);

  /** Các trường thật sự khác bản đang lưu (chế độ sửa), đã chuẩn hoá — dùng cho cả nút Lưu lẫn payload. */
  const khac = useMemo(() => {
    if (!website) return null;
    return {
      name: ten.trim() !== website.name,
      noiDung: baseUrl.trim() !== website.baseUrl || !cungMang(domains, website.allowedDomains),
      trackingEnabled: theoDoi !== website.trackingEnabled,
      defaultCampaignId: (campaignId === "" ? null : campaignId) !== website.defaultCampaignId,
    };
  }, [website, ten, baseUrl, domains, theoDoi, campaignId]);
  const coDoi = khac ? khac.name || khac.noiDung || khac.trackingEnabled || khac.defaultCampaignId : true;

  function focusLoi(l: Loi) {
    const dau = THU_TU_TRUONG.find((t) => l[t]);
    if (dau) queueMicrotask(() => document.getElementById(idTruong(dau))?.focus());
  }

  async function luu() {
    if (dangLuu) return;
    setBanner(null);
    const l: Loi = {};
    if (!sua) {
      // Trống thì nói «nhập», không đọc luật định dạng cho một ô còn chưa gõ gì (ô trống + câu «gồm chữ HOA…» đọc như ô đã có giá trị mà sai).
      const lm = ma.trim() === "" ? "Nhập mã website (ví dụ QUATANG_EDU)." : kiemMaWebsite(chuanHoaMa(ma));
      if (lm) l.code = lm;
    }
    if (ten.trim() === "") l.name = "Nhập tên website.";
    else if (ten.trim().length < 2) l.name = "Tên website tối thiểu 2 ký tự.";
    else if (ten.trim().length > DO_DAI_TEN_TOI_DA) l.name = `Tên website tối đa ${DO_DAI_TEN_TOI_DA} ký tự.`;
    // Gốc URL + tên miền chỉ kiểm khi tạo, hoặc khi một trong hai đổi (website cũ có thể mang gốc URL không còn đúng luật mới).
    const nd = !sua || khac?.noiDung ? chuanHoaNoiDungWebsite({ baseUrl, allowedDomains: domains }) : null;
    if (nd && !nd.ok) {
      const t = laTruong(nd.truong) ? nd.truong : "baseUrl";
      l[t] = nd.loi;
    }
    setLoi(l);
    if (Object.keys(l).length > 0) {
      focusLoi(l);
      return;
    }

    setDangLuu(true);
    let r: KetQuaTaoWebsite | KetQuaSuaWebsite;
    try {
      if (!sua) {
        r = await luuTao({
          code: chuanHoaMa(ma),
          name: ten.trim(),
          baseUrl: nd && nd.ok ? nd.baseUrl : baseUrl.trim(),
          allowedDomains: nd && nd.ok ? nd.allowedDomains : domains,
          trackingEnabled: theoDoi,
          defaultCampaignId: campaignId === "" ? null : campaignId,
        });
      } else {
        const vao: Record<string, unknown> = {};
        if (khac?.name) vao.name = ten.trim();
        if (khac?.noiDung && nd && nd.ok) {
          vao.baseUrl = nd.baseUrl;
          vao.allowedDomains = nd.allowedDomains;
        }
        if (khac?.trackingEnabled) vao.trackingEnabled = theoDoi;
        if (khac?.defaultCampaignId) vao.defaultCampaignId = campaignId === "" ? null : campaignId;
        r = await luuSua({ id: website.id, updatedAtDaThay: website.capNhatLuc, vao, lyDo: ghiChu.trim() === "" ? null : ghiChu.trim() });
      }
    } catch {
      r = { ok: false, loi: "Không lưu được lúc này. Thử lại sau ít giây." };
    }
    setDangLuu(false);

    if (!r.ok) {
      if (laTruong(r.truong)) {
        const gan: Loi = { [r.truong]: r.loi };
        setLoi(gan);
        focusLoi(gan);
      } else {
        setBanner({ text: r.loi, vuaDoi: r.truong === "vuaDoi" });
      }
      return;
    }
    if ("doi" in r && !r.doi) toast.info("Không có gì thay đổi.");
    else toast.success(sua ? `Đã lưu website «${ten.trim()}».` : `Đã tạo website «${ten.trim()}».`);
    dong();
    router.refresh();
  }

  const xoaLoi = (t: Truong) => setLoi((cu) => (cu[t] ? { ...cu, [t]: undefined } : cu));
  const moTaLoi = (t: Truong) => (loi[t] ? `${idTruong(t)}-loi` : undefined);

  return (
    <Sheet open onOpenChange={(m) => !m && !dangLuu && dong()}>
      <SheetContent className="admin-scope w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border p-5 pr-12">
          <SheetTitle className="text-base font-semibold">{sua ? "Sửa website" : "Thêm website"}</SheetTitle>
          <SheetDescription>
            {sua ? `Website «${website.name}» — mã ${website.code}.` : "Website đối tác mà link giới thiệu được phép trỏ tới. Người dùng chỉ chọn trong danh sách này."}
          </SheetDescription>
        </SheetHeader>

        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void luu();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="space-y-5 p-5">
            {banner && (
              <div role="alert" className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink">
                <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="min-w-0 flex-1">{banner.text}</p>
                {banner.vuaDoi && (
                  <button
                    type="button"
                    onClick={() => {
                      dong();
                      router.refresh();
                    }}
                    className={cn(BTN_OUTLINE, NUT_NHO)}
                  >
                    Tải lại (bỏ phần đang sửa)
                  </button>
                )}
              </div>
            )}

            {sua ? (
              <div>
                <p className={NHAN_O}>Mã website</p>
                <p className="flex items-center gap-2 font-mono text-sm text-foreground">
                  <Lock aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                  {website.code}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Mã không đổi được sau khi tạo.</p>
              </div>
            ) : (
              <div>
                <label htmlFor={idTruong("code")} className={NHAN_O}>
                  Mã website
                </label>
                <input
                  id={idTruong("code")}
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={ma}
                  maxLength={60}
                  placeholder="Ví dụ: QUATANG_EDU"
                  onChange={(e) => {
                    setMa(e.target.value);
                    xoaLoi("code");
                  }}
                  aria-invalid={loi.code ? true : undefined}
                  aria-describedby={moTaLoi("code") ?? `${idTruong("code")}-mo-ta`}
                  className={cn(O_NHAP, "font-mono uppercase placeholder:normal-case")}
                />
                <p id={`${idTruong("code")}-mo-ta`} className="mt-1 text-xs text-muted-foreground">
                  Chữ HOA không dấu, số và gạch dưới, 3–40 ký tự. Không đổi được sau khi tạo.
                  {chuanHoaMa(ma) !== "" && chuanHoaMa(ma) !== ma ? (
                    <>
                      {" "}
                      Sẽ lưu là <span className="font-mono">{chuanHoaMa(ma)}</span>.
                    </>
                  ) : null}
                </p>
                {loi.code && (
                  <p id={moTaLoi("code")} role="alert" className={LOI_O}>
                    {loi.code}
                  </p>
                )}
              </div>
            )}

            <div>
              <label htmlFor={idTruong("name")} className={NHAN_O}>
                Tên website
              </label>
              <input
                id={idTruong("name")}
                type="text"
                autoComplete="off"
                value={ten}
                maxLength={DO_DAI_TEN_TOI_DA + 20}
                placeholder="Ví dụ: Quà tặng Sata Robo"
                onChange={(e) => {
                  setTen(e.target.value);
                  xoaLoi("name");
                }}
                aria-invalid={loi.name ? true : undefined}
                aria-describedby={moTaLoi("name")}
                className={O_NHAP}
              />
              {loi.name && (
                <p id={moTaLoi("name")} role="alert" className={LOI_O}>
                  {loi.name}
                </p>
              )}
            </div>

            <div>
              <label htmlFor={idTruong("baseUrl")} className={NHAN_O}>
                Gốc URL
              </label>
              <input
                id={idTruong("baseUrl")}
                type="text"
                inputMode="url"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={baseUrl}
                maxLength={300}
                placeholder="Ví dụ: https://quatang.edu.vn"
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  xoaLoi("baseUrl");
                }}
                aria-invalid={loi.baseUrl ? true : undefined}
                aria-describedby={moTaLoi("baseUrl") ?? `${idTruong("baseUrl")}-mo-ta`}
                className={O_NHAP}
              />
              <p id={`${idTruong("baseUrl")}-mo-ta`} className="mt-1 text-xs text-muted-foreground">
                Chỉ https, không đường dẫn (đường dẫn cụ thể khai ở «Trang đích»). Tên miền phải nằm trong danh sách bên dưới.
              </p>
              {loi.baseUrl && (
                <p id={moTaLoi("baseUrl")} role="alert" className={LOI_O}>
                  {loi.baseUrl}
                </p>
              )}
            </div>

            <div>
              <label htmlFor={idTruong("allowedDomains")} className={NHAN_O}>
                Tên miền được phép
              </label>
              <OTenMien
                id={idTruong("allowedDomains")}
                value={domains}
                onChange={(ds) => {
                  setDomains(ds);
                  xoaLoi("allowedDomains");
                }}
                loi={loi.allowedDomains}
              />
            </div>

            <div className="flex items-start gap-3">
              <Switch
                id={`${id}-theo-doi`}
                aria-label="Bật theo dõi"
                aria-describedby={`${id}-theo-doi-mo-ta`}
                checked={theoDoi}
                onCheckedChange={setTheoDoi}
                className="mt-0.5 data-[state=checked]:bg-primary data-[state=unchecked]:bg-border"
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Bật theo dõi</p>
                <p id={`${id}-theo-doi-mo-ta`} className="text-sm text-muted-foreground">
                  Tắt thì link giới thiệu trỏ về website này ngừng được ghi nhận, nhưng website vẫn nằm trong danh sách.
                </p>
              </div>
            </div>

            <div>
              <label htmlFor={idTruong("defaultCampaignId")} className={NHAN_O}>
                Campaign mặc định (tuỳ chọn)
              </label>
              <select
                id={idTruong("defaultCampaignId")}
                value={campaignId}
                onChange={(e) => {
                  setCampaignId(e.target.value);
                  xoaLoi("defaultCampaignId");
                }}
                aria-invalid={loi.defaultCampaignId ? true : undefined}
                aria-describedby={moTaLoi("defaultCampaignId") ?? `${idTruong("defaultCampaignId")}-mo-ta`}
                className={O_NHAP}
              >
                <option value="">Không chọn</option>
                {luaChonCampaign.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nhan}
                  </option>
                ))}
              </select>
              <p id={`${idTruong("defaultCampaignId")}-mo-ta`} className="mt-1 text-xs text-muted-foreground">
                Dùng khi link không nêu campaign. Việc gắn website vào campaign làm ở màn Campaign.
              </p>
              {loi.defaultCampaignId && (
                <p id={moTaLoi("defaultCampaignId")} role="alert" className={LOI_O}>
                  {loi.defaultCampaignId}
                </p>
              )}
            </div>

            {sua && (
              <div>
                <label htmlFor={`${id}-ghi-chu`} className={NHAN_O}>
                  Ghi chú thay đổi (tuỳ chọn)
                </label>
                <textarea id={`${id}-ghi-chu`} rows={2} maxLength={500} value={ghiChu} onChange={(e) => setGhiChu(e.target.value)} className={TEXTAREA} />
                <p className="mt-1 text-xs text-muted-foreground">Được ghi vào nhật ký cùng lần sửa này.</p>
              </div>
            )}
          </div>

          <div className="sticky bottom-0 z-10 mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-border bg-popover p-4">
            {sua && !coDoi && <p className="mr-auto text-sm text-muted-foreground">Chưa có thay đổi nào để lưu.</p>}
            <button type="button" onClick={dong} disabled={dangLuu} className={cn(BTN_OUTLINE, NUT_CHAN)}>
              Huỷ
            </button>
            <button type="submit" disabled={dangLuu || !coDoi} className={cn(BTN_PRIMARY, NUT_CHAN)}>
              {dangLuu && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
              {sua ? "Lưu thay đổi" : "Tạo website"}
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** Nút «Thêm website» của đầu trang + Sheet tạo. Nơi gọi CHỈ dựng khi `scope.has("affiliate_campaigns:manage")` ∧ cờ Affiliate bật — đúng hai điều kiện mà Server Action kiểm. */
export function NutThemWebsite({ campaignChon, luuTao }: { campaignChon: readonly CampaignChon[]; luuTao?: LuuTao }) {
  const [mo, setMo] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setMo(true)} className={BTN_PRIMARY}>
        <Plus aria-hidden className="h-4 w-4" />
        Thêm website
      </button>
      {mo && <FormWebsite cheDo="tao" campaignChon={campaignChon} dong={() => setMo(false)} luuTao={luuTao} />}
    </>
  );
}
