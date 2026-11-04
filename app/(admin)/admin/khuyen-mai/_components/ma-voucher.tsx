"use client";

// Mã voucher của MỘT chính sách: bảng mã (chép một chạm) + bật/tắt + form thêm mã.
//
// Hôm nay mã CHƯA áp vào đơn hàng (giảm giá trên đơn vẫn nhập tay kèm giải trình) — Sale đọc mã
// để tư vấn và ghi vào giải trình. Câu đó nằm ngay trên bảng, để không ai tưởng gõ mã vào đơn là
// hệ thống tự trừ tiền.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { formatVndPlain } from "@/lib/format/money";
import { cn } from "@/lib/utils";
import { batTatVoucherAction, themVoucherAction } from "../_actions";

export type VoucherDong = {
  id: string;
  ma: string;
  uuDai: string;
  donToiThieu: number;
  soLuong: number | null;
  /**
   * Đã dùng bao nhiêu lượt [28/09/2026].
   *
   * ⚠️ Kiểu này là bản CHÉP TAY của `VoucherView` (`lib/khuyen-mai/chinh-sach.ts`) — file
   * đó `server-only` nên component client không nhập thẳng được. Thêm/bớt trường thì phải
   * sửa CẢ HAI; `tsc` bắt được chiều thiếu (ở đây) nhưng KHÔNG bắt được chiều thừa.
   */
  daDung: number;
  dangBat: boolean;
  ghiChu: string | null;
};

/**
 * Nhãn một mã: "Đang bật" CHỈ khi mã bật VÀ văn bản còn hiệu lực. Mã của văn bản đã hết hạn/thu hồi mà
 * vẫn in "Đang bật" cạnh nhãn "Hết hạn" của chính văn bản là hai lời nói ngược nhau (rà 26/09, KM-R3).
 */
function NhanMa({ dangBat, conHieuLuc }: { dangBat: boolean; conHieuLuc: boolean }) {
  if (!dangBat) return <StatusPill tone="muted">Đã tắt</StatusPill>;
  if (!conHieuLuc) return <StatusPill tone="muted">Hết hiệu lực</StatusPill>;
  return <StatusPill tone="success">Đang bật</StatusPill>;
}

function NutChep({ ma }: { ma: string }) {
  const [da, setDa] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(ma);
          setDa(true);
          setTimeout(() => setDa(false), 1500);
        } catch {
          toast.error("Trình duyệt không cho chép — bôi đen mã để chép tay.");
        }
      }}
      aria-label={`Chép mã ${ma}`}
      className="inline-flex h-9 items-center gap-1.5 rounded-md sm:h-7 border border-border bg-card px-2 font-semibold tracking-wide text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {ma}
      {da ? (
        <Check className="h-3.5 w-3.5 text-state-success-ink" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      )}
    </button>
  );
}

function NutBatTat({ v, chinhSachId, khoaBat }: { v: VoucherDong; chinhSachId: string; khoaBat: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Chính sách đã thu hồi/hết hạn ⇒ không bật lại được (server cũng chặn) — không vẽ nút hứa suông.
  if (!v.dangBat && khoaBat) return null;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const kq = await batTatVoucherAction({ id: v.id, bat: !v.dangBat }, chinhSachId);
          if (kq.ok) {
            toast.success(v.dangBat ? `Đã tắt mã ${v.ma}` : `Đã bật mã ${v.ma}`);
            router.refresh();
          } else toast.error(kq.error);
        })
      }
      className="-mx-2 inline-flex min-h-10 items-center gap-1 px-2 text-sm font-medium text-primary-ink transition-colors hover:underline disabled:opacity-50"
    >
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
      {v.dangBat ? "Tắt" : "Bật lại"}
    </button>
  );
}

const LOP_O = "h-10";

function FormThemMa({ chinhSachId, xong }: { chinhSachId: string; xong: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [ma, setMa] = useState("");
  const [kieu, setKieu] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [phanTram, setPhanTram] = useState("");
  const [soTien, setSoTien] = useState<number | null>(null);
  const [giamToiDa, setGiamToiDa] = useState<number | null>(null);
  const [donToiThieu, setDonToiThieu] = useState<number | null>(null);
  const [soLuong, setSoLuong] = useState("");
  const [ghiChu, setGhiChu] = useState("");

  const maHopLe = /^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(ma.trim().toUpperCase());
  const pt = Number(phanTram);
  const giaTriHopLe = kieu === "PERCENT" ? Number.isInteger(pt) && pt >= 1 && pt <= 100 : (soTien ?? 0) >= 1000;
  const sl = soLuong.trim() === "" ? null : Number(soLuong);
  const slHopLe = sl === null || (Number.isInteger(sl) && sl >= 1);
  const du = maHopLe && giaTriHopLe && slHopLe;

  function gui() {
    if (!du) return;
    startTransition(async () => {
      const kq = await themVoucherAction({
        chinhSachId,
        ma: ma.trim().toUpperCase(),
        kieu,
        phanTram: kieu === "PERCENT" ? pt : null,
        soTien: kieu === "FIXED" ? soTien : null,
        giamToiDa: kieu === "PERCENT" ? giamToiDa : null,
        donToiThieu: donToiThieu ?? 0,
        soLuong: sl,
        ghiChu: ghiChu.trim() || undefined,
      });
      if (kq.ok) {
        toast.success(`Đã thêm mã ${ma.trim().toUpperCase()}`);
        xong();
        router.refresh();
      } else toast.error(kq.error);
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        gui();
      }}
      className="space-y-4 border-t border-border bg-muted/30 px-5 py-4"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-foreground">
            Mã <span className="text-state-danger-ink">*</span>
          </span>
          <Input
            value={ma}
            onChange={(e) => setMa(e.target.value.toUpperCase())}
            placeholder="BTS2026"
            maxLength={32}
            disabled={pending}
            className={cn(LOP_O, "font-semibold uppercase tracking-wide")}
            aria-invalid={ma !== "" && !maHopLe}
          />
          <span className="mt-1 block text-xs text-muted-foreground">3–32 ký tự: chữ, số, gạch.</span>
        </label>
        <fieldset className="block">
          <legend className="mb-1 block text-sm font-semibold text-foreground">Kiểu giảm</legend>
          <div className="inline-flex h-10 rounded-lg border border-border bg-card p-0.5">
            {(
              [
                ["PERCENT", "Theo %"],
                ["FIXED", "Số tiền"],
              ] as const
            ).map(([k, nhan]) => (
              <button
                key={k}
                type="button"
                onClick={() => setKieu(k)}
                aria-pressed={kieu === k}
                disabled={pending}
                className={cn(
                  "rounded-md px-3 text-sm font-medium transition-colors",
                  kieu === k ? "bg-primary-soft text-primary-ink" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {nhan}
              </button>
            ))}
          </div>
        </fieldset>
        {kieu === "PERCENT" ? (
          <>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-foreground">
                Giảm (%) <span className="text-state-danger-ink">*</span>
              </span>
              <Input
                inputMode="numeric"
                value={phanTram}
                onChange={(e) => setPhanTram(e.target.value.replace(/\D/g, "").slice(0, 3))}
                placeholder="10"
                disabled={pending}
                className={cn(LOP_O, "tabular-nums")}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-foreground">Giảm tối đa</span>
              <MoneyInput name="giamToiDa" value={giamToiDa} onValueChange={setGiamToiDa} placeholder="Không giới hạn" disabled={pending} />
            </label>
          </>
        ) : (
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-semibold text-foreground">
              Số tiền giảm <span className="text-state-danger-ink">*</span>
            </span>
            <MoneyInput name="soTien" value={soTien} onValueChange={setSoTien} placeholder="300.000" disabled={pending} />
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-foreground">Đơn tối thiểu</span>
          <MoneyInput name="donToiThieu" value={donToiThieu} onValueChange={setDonToiThieu} placeholder="0" disabled={pending} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-foreground">Số suất theo văn bản</span>
          <Input
            inputMode="numeric"
            value={soLuong}
            onChange={(e) => setSoLuong(e.target.value.replace(/\D/g, "").slice(0, 7))}
            placeholder="Không giới hạn"
            disabled={pending}
            className={cn(LOP_O, "tabular-nums")}
          />
          <span className="mt-1 block text-xs text-muted-foreground">Hệ thống chưa tự đếm lượt dùng — hết suất thì tắt mã.</span>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-semibold text-foreground">Ghi chú cho Sale</span>
          <Input
            value={ghiChu}
            onChange={(e) => setGhiChu(e.target.value)}
            maxLength={500}
            placeholder="VD: chỉ cho khách đăng ký tại sự kiện Back To School"
            disabled={pending}
            className={LOP_O}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!du || pending}>
          {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
          Thêm mã
        </Button>
        <Button type="button" variant="outline" onClick={xong} disabled={pending}>
          Huỷ
        </Button>
      </div>
    </form>
  );
}

export function MaVoucher({
  chinhSachId,
  vouchers,
  coQuanLy,
  conThemDuoc,
}: {
  chinhSachId: string;
  vouchers: VoucherDong[];
  coQuanLy: boolean;
  /** Chính sách chưa hết hạn/thu hồi — server chặn thêm mã vào văn bản đã hết hiệu lực. */
  conThemDuoc: boolean;
}) {
  const [moForm, setMoForm] = useState(false);
  return (
    <section aria-labelledby="tieu-de-ma" className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <h2 id="tieu-de-ma" className="text-base font-semibold text-foreground">
            Mã voucher
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Chưa tự trừ vào đơn hàng — khi áp cho khách, ghi mã vào phần giải trình giảm giá trên đơn.
          </p>
        </div>
        {coQuanLy && conThemDuoc && !moForm && (
          <Button type="button" variant="outline" onClick={() => setMoForm(true)}>
            Thêm mã
          </Button>
        )}
      </div>

      {moForm && <FormThemMa chinhSachId={chinhSachId} xong={() => setMoForm(false)} />}

      {vouchers.length === 0 ? (
        <p className="border-t border-border px-5 py-6 text-sm text-muted-foreground">
          Chính sách này không phát mã — Sale áp ưu đãi theo nội dung văn bản.
        </p>
      ) : (
        <div className="border-t border-border">
          <PhanTrangBang tenDonVi="mã" khoaGhiNho={`khuyen-mai-ma-${chinhSachId}`} cuonNgang className="[&>div:last-child]:px-5 [&>div:last-child]:pb-4">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {/* Dưới 640px bảng còn HAI cột: khối mã (mã + nhãn + ưu đãi xếp chồng) và nút.
                      Bản 4 cột ép ô ưu đãi còn "Giả…" và đẩy nút Tắt ra ngoài (smoke 26/09). */}
                  <th scope="col" className={cn(adminTh, "w-full sm:w-auto")}>
                    Mã
                  </th>
                  <th scope="col" className={cn(adminTh, "hidden w-full sm:table-cell")}>
                    Ưu đãi
                  </th>
                  <th scope="col" className={cn(adminTh, "hidden text-right sm:table-cell")}>
                    Đơn tối thiểu
                  </th>
                  <th scope="col" className={cn(adminTh, "hidden text-right sm:table-cell")}>
                    Số lượng
                  </th>
                  <th scope="col" className={cn(adminTh, "hidden sm:table-cell")}>
                    Trạng thái
                  </th>
                  {coQuanLy && (
                    <th scope="col" className={adminTh}>
                      <span className="sr-only">Thao tác</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {vouchers.map((v) => (
                  <tr key={v.id} className={cn(adminTr, !v.dangBat && "text-muted-foreground")}>
                    <td className={cn(adminTd, "max-w-0 align-top sm:max-w-none")}>
                      <NutChep ma={v.ma} />
                      {/* Dưới 640px cột Trạng thái + Ưu đãi ẩn — xếp chồng ngay dưới mã. */}
                      <div className="mt-1 sm:hidden">
                        <NhanMa dangBat={v.dangBat} conHieuLuc={conThemDuoc} />
                        <p className="mt-1 truncate">{v.uuDai}</p>
                        {v.ghiChu && <p className="truncate text-xs text-muted-foreground">{v.ghiChu}</p>}
                      </div>
                    </td>
                    <td className={cn(adminTd, "hidden max-w-0 sm:table-cell")}>
                      <p className="truncate">{v.uuDai}</p>
                      {v.ghiChu && <p className="truncate text-xs text-muted-foreground">{v.ghiChu}</p>}
                    </td>
                    <td className={cn(adminTd, "hidden text-right tabular-nums sm:table-cell")}>
                      {v.donToiThieu > 0 ? formatVndPlain(v.donToiThieu) : "—"}
                    </td>
                    <td className={cn(adminTd, "hidden text-right tabular-nums sm:table-cell")}>
                      {/* ⚠️ NAY IN "đã dùng" [28/09/2026] — và đây là ĐẢO có lý do.
                          Chú thích cũ: *"KHÔNG in 'đã dùng': `usedCount` chưa có đường ghi nào (chưa
                          nối đơn hàng) ⇒ con số sẽ đứng ở 0 mãi và Sale hứa suất thứ 31"*. Lý lẽ ấy
                          ĐÚNG vào 26/09 và SAI từ 28/09: `createOrderManualAction` nay ghi
                          `VoucherRedemption` + tăng `usedCount` trong cùng transaction tạo đơn.
                          Giấu con số sau khi đã có đường ghi là lỗi ngược lại của cùng luật 12 —
                          người vận hành không thấy mã sắp hết suất. */}
                      {v.soLuong == null
                        ? "Không giới hạn"
                        : `${v.daDung.toLocaleString("vi-VN")}/${v.soLuong.toLocaleString("vi-VN")} suất`}
                    </td>
                    <td className={cn(adminTd, "hidden sm:table-cell")}>
                      <NhanMa dangBat={v.dangBat} conHieuLuc={conThemDuoc} />
                    </td>
                    {coQuanLy && (
                      <td className={cn(adminTd, "text-right")}>
                        <NutBatTat v={v} chinhSachId={chinhSachId} khoaBat={!conThemDuoc} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        </div>
      )}
    </section>
  );
}
