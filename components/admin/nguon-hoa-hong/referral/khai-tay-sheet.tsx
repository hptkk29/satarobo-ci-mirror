"use client";

// components/admin/nguon-hoa-hong/referral/khai-tay-sheet.tsx — Sheet «Khai tay referral» (AFF-L3b): ghi một lượt giới thiệu NGOÀI ĐỜI (không qua link/QR/mã).
//
// ── Nút nói thật (luật 12) ───────────────────────────────────────────────────────────────────────────────────────
// Trang CHỈ dựng Sheet này khi `scope.has("affiliate_referrals:manage")` ∧ module bật — đúng hai điều kiện mà `khaiTayReferralAction` kiểm. Sheet có BỐN lựa chọn + lý do + bằng chứng và KHÔNG CÓ ô tiền, tỉ lệ hay nguồn:
// nguồn do cấu hình campaign giải, hoa hồng do chính sách tính. Lượt khai xong vào «Cần xem tay» và phải được DUYỆT (nên một lượt khai tay chưa chiếm hồ sơ khách).
// Ô tìm phiếu: gõ MÃ phiếu (6 ký tự cuối) hoặc tên khách; tên/SĐT hiện đã che theo quyền của người xem. Hàm gọi máy chủ được TIÊM — mặc định là Server Action; test dựng bằng hàm giả.
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { khaiTayReferralAction, timPhieuKhaiTayAction, type KetQuaTimPhieuAction } from "@/app/(admin)/admin/nguon-hoa-hong/referral/_actions";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { LuaChonKhaiTay, KetQuaTimPhieu } from "@/lib/affiliate/doc-xu-ly-referral";
import type { KetQuaKhaiTay } from "@/lib/affiliate/ghi-referral-xu-ly";
import { CACH_KHAI_TAY, NHAN_CACH_KHAI_TAY, khaiTayReferralSchema, type CachKhaiTay } from "@/lib/affiliate/khai-tay-referral";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, LOI_O, NHAN_O, NUT_CHAN, O_NHAP, TEXTAREA } from "../classes";

type Khai = (input: unknown) => Promise<KetQuaKhaiTay>;
type Tim = (input: { q: string }) => Promise<KetQuaTimPhieuAction>;
const KHAI_MAC_DINH: Khai = (i) => khaiTayReferralAction(i);
const TIM_MAC_DINH: Tim = (i) => timPhieuKhaiTayAction(i);

type Truong = "cap" | "leadId" | "method" | "lyDo" | "ghiChu";
type Loi = Partial<Record<Truong, string>>;

export function KhaiTaySheet({
  luaChon,
  khai = KHAI_MAC_DINH,
  tim = TIM_MAC_DINH,
  triggerClassName,
}: {
  luaChon: readonly LuaChonKhaiTay[];
  khai?: Khai;
  tim?: Tim;
  triggerClassName?: string;
}) {
  const uid = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cap, setCap] = useState("");
  const [method, setMethod] = useState<CachKhaiTay>("OFFLINE");
  const [q, setQ] = useState("");
  const [ketQua, setKetQua] = useState<KetQuaTimPhieu[] | null>(null);
  const [chonPhieu, setChonPhieu] = useState<KetQuaTimPhieu | null>(null);
  const [lyDo, setLyDo] = useState("");
  const [ghiChu, setGhiChu] = useState("");
  const [loi, setLoi] = useState<Loi>({});
  const [chung, setChung] = useState<string | null>(null);
  const [dangTim, batDauTim] = useTransition();
  const [dangGui, batDau] = useTransition();

  function lamMoi() {
    setCap("");
    setMethod("OFFLINE");
    setQ("");
    setKetQua(null);
    setChonPhieu(null);
    setLyDo("");
    setGhiChu("");
    setLoi({});
    setChung(null);
  }

  function timPhieu() {
    setChung(null);
    batDauTim(async () => {
      const r = await tim({ q });
      if (r.ok) setKetQua(r.phieu);
      else setChung(r.loi);
    });
  }

  function nop() {
    const chonCap = luaChon.find((l) => `${l.partyId}|${l.campaignId}` === cap);
    const dauVao = { partyId: chonCap?.partyId ?? "", campaignId: chonCap?.campaignId ?? "", leadId: chonPhieu?.id ?? "", method, lyDo, ghiChu };
    // Cùng bộ kiểm với máy chủ.
    const kiem = khaiTayReferralSchema.safeParse(dauVao);
    if (!kiem.success) {
      const o: Loi = {};
      for (const i of kiem.error.issues) {
        const k = i.path[0];
        const ten: Truong | null = k === "partyId" || k === "campaignId" ? "cap" : k === "leadId" || k === "method" || k === "lyDo" || k === "ghiChu" ? k : null;
        if (ten && !o[ten]) o[ten] = i.message;
      }
      setLoi(o);
      return;
    }
    setLoi({});
    setChung(null);
    batDau(async () => {
      let r: KetQuaKhaiTay;
      try {
        r = await khai(kiem.data);
      } catch {
        setChung("Không gửi được lúc này. Thử lại sau ít giây.");
        return;
      }
      if (r.ok) {
        toast.success("Đã khai tay — lượt này nằm ở «Cần xem tay», cần được duyệt.");
        setOpen(false);
        lamMoi();
        router.refresh();
        return;
      }
      const ten: Truong | null = r.truong === "partyId" || r.truong === "campaignId" ? "cap" : r.truong === "leadId" ? "leadId" : r.truong === "lyDo" || r.truong === "ghiChu" ? r.truong : null;
      if (ten) setLoi({ [ten]: r.loi });
      else setChung(r.loi);
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) lamMoi();
      }}
    >
      <SheetTrigger className={cn(BTN_PRIMARY, triggerClassName)}>Khai tay referral</SheetTrigger>
      <SheetContent className="admin-scope w-full gap-0 overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border p-5 pr-12">
          <SheetTitle className="text-base font-semibold">Khai tay referral</SheetTitle>
          <SheetDescription>Ghi một lượt giới thiệu ngoài đời. Lượt này vào «Cần xem tay» và cần được duyệt — chưa ghi người giới thiệu vào hồ sơ khách.</SheetDescription>
        </SheetHeader>
        <form
          noValidate
          className="space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            nop();
          }}
        >
          {chung && (
            <p role="alert" className="text-sm text-state-danger-ink">
              {chung}
            </p>
          )}

          <div>
            <label htmlFor={`${uid}-cap`} className={NHAN_O}>
              Đối tác · Campaign
            </label>
            <select id={`${uid}-cap`} className={O_NHAP} value={cap} onChange={(e) => setCap(e.target.value)} aria-invalid={loi.cap ? true : undefined} disabled={dangGui}>
              <option value="">— Chọn —</option>
              {luaChon.map((l) => (
                <option key={`${l.partyId}|${l.campaignId}`} value={`${l.partyId}|${l.campaignId}`}>
                  {l.doiTac} ({l.maDoiTac}) · {l.campaign}
                </option>
              ))}
            </select>
            {loi.cap ? <p role="alert" className={LOI_O}>{loi.cap}</p> : luaChon.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">Chưa có đối tác nào đang hoạt động trong một campaign đang chạy.</p> : null}
          </div>

          <fieldset>
            <legend className={NHAN_O}>Cách đến</legend>
            <div className="space-y-1.5">
              {CACH_KHAI_TAY.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm">
                  <input type="radio" name={`${uid}-method`} value={c} checked={method === c} onChange={() => setMethod(c)} disabled={dangGui} />
                  {NHAN_CACH_KHAI_TAY[c]}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor={`${uid}-q`} className={NHAN_O}>
              Phiếu khách
            </label>
            {chonPhieu ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="font-mono text-xs">#{chonPhieu.maRutGon}</span>
                {chonPhieu.ten && <span>{chonPhieu.ten}</span>}
                <button type="button" className="ml-auto text-sm font-medium text-primary-ink hover:underline" onClick={() => setChonPhieu(null)} disabled={dangGui}>
                  Đổi phiếu
                </button>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <input
                    id={`${uid}-q`}
                    className={O_NHAP}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        timPhieu();
                      }
                    }}
                    placeholder="Mã phiếu (6 ký tự) hoặc tên khách"
                    aria-invalid={loi.leadId ? true : undefined}
                    disabled={dangGui}
                  />
                  <button type="button" className={cn(BTN_OUTLINE, NUT_CHAN)} onClick={timPhieu} disabled={dangTim || dangGui}>
                    {dangTim ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Search aria-hidden className="h-4 w-4" />}
                    Tìm
                  </button>
                </div>
                {ketQua !== null && (
                  <ul className="mt-2 divide-y divide-border rounded-lg border border-border" aria-label="Kết quả tìm phiếu">
                    {ketQua.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Không thấy phiếu nào trong phạm vi của bạn.</li>}
                    {ketQua.map((p) => (
                      <li key={p.id}>
                        <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setChonPhieu(p)}>
                          <span className="font-mono text-xs">#{p.maRutGon}</span>
                          <span className="min-w-0 flex-1 truncate">{p.ten ?? "—"}</span>
                          {p.sdt && <span className="text-xs text-muted-foreground">{p.sdt}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {loi.leadId && <p role="alert" className={LOI_O}>{loi.leadId}</p>}
          </div>

          <div>
            <label htmlFor={`${uid}-ly-do`} className={NHAN_O}>
              Lý do
            </label>
            <textarea id={`${uid}-ly-do`} className={TEXTAREA} rows={3} maxLength={500} value={lyDo} onChange={(e) => setLyDo(e.target.value)} aria-invalid={loi.lyDo ? true : undefined} placeholder="Vì sao đây là lượt giới thiệu của đối tác này." disabled={dangGui} />
            {loi.lyDo ? <p role="alert" className={LOI_O}>{loi.lyDo}</p> : <p className="mt-1 text-xs text-muted-foreground">Ít nhất 10 ký tự. Không ghi SĐT hay email của khách.</p>}
          </div>

          <div>
            <label htmlFor={`${uid}-ghi-chu`} className={NHAN_O}>
              Ghi chú bằng chứng
            </label>
            <textarea id={`${uid}-ghi-chu`} className={TEXTAREA} rows={3} maxLength={2000} value={ghiChu} onChange={(e) => setGhiChu(e.target.value)} aria-invalid={loi.ghiChu ? true : undefined} placeholder="Căn cứ cụ thể: biên nhận, ai xác nhận, sự kiện nào, ngày nào…" disabled={dangGui} />
            {loi.ghiChu && <p role="alert" className={LOI_O}>{loi.ghiChu}</p>}
          </div>

          <p className="text-xs text-muted-foreground">Hoa hồng, tỉ lệ và nguồn không nhập tay: nguồn do cấu hình campaign quyết, hoa hồng do chính sách tính khi khách đóng tiền.</p>

          <div className="flex flex-wrap items-center gap-2 pb-2">
            <button type="submit" className={cn(BTN_PRIMARY, NUT_CHAN, "min-w-28")} disabled={dangGui}>
              {dangGui && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
              {dangGui ? "Đang ghi…" : "Ghi lượt khai tay"}
            </button>
            <button type="button" className={cn(BTN_OUTLINE, NUT_CHAN)} onClick={() => setOpen(false)} disabled={dangGui}>
              Huỷ
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
