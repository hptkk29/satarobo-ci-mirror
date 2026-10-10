"use client";

// Bảng máy SmartPOS + hộp thoại thêm/sửa. Server Component cha: `tab-may-pos.tsx`.
//
// ── VÌ SAO KHÔNG CÓ NÚT XOÁ ─────────────────────────────────────────────────────────────
// Máy thôi dùng thì TẮT. Giao dịch cũ của máy vẫn phải tra được "máy này đặt ở cơ sở nào",
// và xoá dòng là cắt đứt câu trả lời đó. Tắt thì lần import sau các giao dịch MỚI của máy
// rơi vào "Thiết bị chưa gán cơ sở" — đúng thứ người tắt muốn.
//
// ── VÌ SAO TẮT PHẢI XÁC NHẬN, BẬT THÌ KHÔNG ────────────────────────────────────────────
// Tắt có hệ quả người bấm không thấy ngay trên màn này: giao dịch thẻ mới của máy thôi tự
// khớp và dồn sang "Cần xử lý" ở màn khác. Gạt nhầm một công tắc 20px trong bảng là đủ gây
// ra cả một ngày giao dịch phải gắn tay. Bật lại thì chỉ khôi phục đường khớp — không cần hỏi.
// (Cùng nếp với bảng Phương thức thanh toán ngay tab bên cạnh.)
//
// ── VÌ SAO MÃ THIẾT BỊ KHÔNG SỬA ĐƯỢC ──────────────────────────────────────────────────
// Mã là thứ đem so KHỚP ĐÚNG với cột "Mã thiết bị" của file ngân hàng. Gõ sai thì tắt dòng
// sai rồi khai dòng mới — giữ vết mã nào từng thuộc cơ sở nào.
import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { ArrowRight, Info, Loader2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { ngayVN } from "@/lib/format/date";
import { cn } from "@/lib/utils";
import { batTatMayPosAction, suaMayPosAction, taoMayPosAction } from "../_may-pos-actions";

export type DongMayPos = {
  id: string;
  maThietBi: string;
  maQuay: string | null;
  ten: string | null;
  /** GĐ2 POS — mã do Techcombank cấp trên portal merchant (cho đồng bộ tự động GĐ4). */
  maCuaHang: string | null;
  maNhaCungCap: string | null;
  maTcbQuay: string | null;
  centerId: string;
  /** Null khi cơ sở nằm ngoài tầm nhìn (không nên xảy ra — scopedDb đã lọc máy). */
  tenCoSo: string | null;
  active: boolean;
  /** ISO. */
  taoLuc: string;
};

export type CoSoChon = { id: string; name: string };

/** Câu nhắc chủ dự án yêu cầu hiện trên màn (docs/pos-the-smartpos.md). */
export const CAU_NHAC_IMPORT_LAI =
  "Khai máy xong, import lại file để khớp các giao dịch đang 'Thiết bị chưa gán cơ sở'.";

/** Nơi import file giao dịch thẻ — màn Biến động số dư, lọc nguồn "Thẻ POS". */
const DUONG_IMPORT = "/bien-dong-so-du?nguon=the";

/** Trần độ dài — khớp đúng zod ở `_may-pos-actions.ts`, để ô nhập chặn trước khi server từ chối. */
const TRAN = { maThietBi: 64, maQuay: 64, ten: 120, maTcb: 64 } as const;

/** Ô mã trong bảng: mono khi có, gạch ngang mờ khi trống — một chỗ cho cả ba cột mã TCB. */
function MaHoacGach({ gia }: { gia: string | null }) {
  return gia ? (
    <span className="font-mono text-xs">{gia}</span>
  ) : (
    <span className="text-muted-foreground" aria-label="Chưa khai">
      —
    </span>
  );
}

/** Ba ô mã TCB của hộp thoại: id ô · nhãn (đúng chữ portal) · gợi ý. Thứ tự = thứ tự trên màn. */
const O_MA_TCB = [
  { khoa: "maCuaHang", id: "pos-ma-cua-hang", nhan: "Mã cửa hàng (TCB)", goiY: "VD CH9TSGU9" },
  { khoa: "maNhaCungCap", id: "pos-ma-ncc", nhan: "Mã nhà cung cấp (merchant_code)", goiY: "VD NCCPH6KE" },
  { khoa: "maTcbQuay", id: "pos-ma-tcb-quay", nhan: "Mã TCB quầy", goiY: "Khác “Mã quầy” ở trên" },
] as const;
type KhoaMaTcb = (typeof O_MA_TCB)[number]["khoa"];

/** Lỗi không lường trước (mạng rớt, server ném) — không để nó văng cả trang ra màn lỗi. */
const LOI_KHONG_RO = "Không lưu được do lỗi kết nối hoặc máy chủ. Thử lại sau ít phút.";

// Ô dính mép phải phải có nền ĐỤC, nếu không cột cuộn qua sẽ hiện xuyên lên nó. Hai màu dưới
// là bản đục của đúng hai lớp trong suốt mà bảng đang dùng: `bg-muted/40` (đầu bảng) và
// `hover:bg-muted/50` (dòng) — trộn trên nền thẻ, không phải một màu mới.
const NEN_DAU_BANG = "bg-[color-mix(in_oklab,var(--muted)_40%,var(--card))]";
const NEN_O_DINH = "bg-card group-hover:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))]";

export function BangMayPos({
  rows,
  coSo,
  moDuocBienDong,
  choSua,
}: {
  rows: DongMayPos[];
  coSo: CoSoChon[];
  /** Người xem mở được màn Biến động số dư không — không thì không vẽ link (luật 12). */
  moDuocBienDong: boolean;
  /**
   * Thêm / sửa / bật-tắt được không — ĐÚNG cổng mà ba action hỏi ở server (quyền + phạm vi mọi
   * cơ sở, `nhapPosDuocMoiCoSo`). Sai thì bảng chỉ để xem: vẽ nút mà action chắc chắn từ chối
   * là lời hứa suông (luật 12). Ca `[MPOS-06]`.
   */
  choSua: boolean;
}) {
  // `null` = đóng; `"moi"` = thêm; còn lại = id máy đang sửa.
  const [dangMo, datDangMo] = useState<string | null>(null);
  const [dangCho, batDau] = useTransition();
  const [idDangDoi, datIdDangDoi] = useState<string | null>(null);
  const [canTat, datCanTat] = useState<DongMayPos | null>(null);
  const mayDangSua = dangMo && dangMo !== "moi" ? (rows.find((r) => r.id === dangMo) ?? null) : null;
  const khongCoCoSo = coSo.length === 0;

  function doiTrangThai(r: DongMayPos, active: boolean) {
    datIdDangDoi(r.id);
    batDau(async () => {
      try {
        const kq = await batTatMayPosAction({ id: r.id, active });
        if (kq.ok) {
          toast.success(
            active
              ? `Đã bật máy ${r.maThietBi}. ${CAU_NHAC_IMPORT_LAI}`
              : `Đã tắt máy ${r.maThietBi}.`,
          );
        } else {
          toast.error(kq.error);
        }
      } catch {
        toast.error(LOI_KHONG_RO);
      } finally {
        datIdDangDoi(null);
        datCanTat(null);
      }
    });
  }

  const nutThem = choSua ? (
    <Button type="button" className="min-h-11" disabled={khongCoCoSo} onClick={() => datDangMo("moi")}>
      <Plus aria-hidden />
      Thêm máy POS
    </Button>
  ) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-prose space-y-2">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Mỗi máy gắn với <b className="font-semibold text-foreground">một cơ sở</b>. Máy{" "}
            <b className="font-semibold text-foreground">đang tắt</b> cũng không tự khớp — giao
            dịch mới của nó vào danh sách <b className="font-semibold text-foreground">Cần xử lý</b>{" "}
            ở màn Biến động số dư.
          </p>
          {/* Câu nhắc là LỜI DẶN, không phải liên kết — nên không tô màu link. Link thật (khi
              người xem mở được màn đó) nằm riêng ở cuối, có mũi tên. */}
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed">
            <Info className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <p className="text-foreground">
              {CAU_NHAC_IMPORT_LAI}
              {moDuocBienDong ? (
                <>
                  {" "}
                  <Link
                    href={DUONG_IMPORT}
                    className="inline-flex items-center gap-0.5 whitespace-nowrap font-semibold text-primary underline-offset-2 hover:underline"
                  >
                    Mở Biến động số dư
                    <ArrowRight className="h-3 w-3" aria-hidden />
                  </Link>
                </>
              ) : null}
            </p>
          </div>
        </div>
        {rows.length > 0 ? nutThem : null}
      </div>

      {!choSua ? (
        <p className="text-xs text-muted-foreground">
          Bạn chỉ <b className="font-semibold text-foreground">xem</b> danh sách máy. Khai / sửa / bật-tắt
          máy POS là việc của Kế toán Hội sở (nhìn được mọi cơ sở) — máy quyết định cơ sở của mọi
          giao dịch thẻ nó quẹt.
        </p>
      ) : khongCoCoSo ? (
        // Nút bị khoá phải NÓI vì sao ngay trên màn — `title` không hiện trên cảm ứng và
        // trình đọc màn hình thường bỏ qua.
        <p className="text-xs text-state-warning-ink">
          Bạn chưa quản lý cơ sở nào đang hoạt động nên chưa khai được máy. Cần được gán vai
          ở một cơ sở (hoặc ở Hội sở) — hỏi Quản trị hệ thống.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-5 py-10 text-center">
          <p className="text-sm font-medium text-foreground">Chưa khai máy POS nào</p>
          <p className="mx-auto mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">
            Chưa có máy nào thì <b className="font-semibold text-foreground">mọi giao dịch thẻ</b>{" "}
            đều rơi vào &quot;Thiết bị chưa gán cơ sở&quot;. Mã thiết bị lấy ở cột &quot;Mã thiết
            bị&quot; trong file giao dịch tải từ Techcombank.
          </p>
          <div className="mt-4 inline-flex">{nutThem}</div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <PhanTrangBang tenDonVi="máy" cuonNgang>
            <table className="w-full border-collapse">
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <th className={cn(adminTh, "px-4")}>Mã thiết bị</th>
                  <th className={cn(adminTh, "px-4")}>Mã quầy</th>
                  <th className={cn(adminTh, "px-4")}>Tên máy</th>
                  <th className={cn(adminTh, "px-4")}>Cơ sở</th>
                  <th className={cn(adminTh, "px-4")}>Trạng thái</th>
                  <th className={cn(adminTh, "px-4")} title="Mã cửa hàng (TCB) — portal merchant">
                    Mã cửa hàng
                  </th>
                  <th className={cn(adminTh, "px-4")} title="Mã nhà cung cấp (merchant_code) — portal merchant">
                    Mã nhà cung cấp
                  </th>
                  <th className={cn(adminTh, "px-4")}>Mã TCB quầy</th>
                  <th className={cn(adminTh, "px-4")}>Ngày khai</th>
                  {/* Dính mép phải: cuộn ngang (màn hẹp, tên cơ sở dài) vẫn thấy nút Sửa. */}
                  <th
                    className={cn(
                      adminTh,
                      "sticky right-0 z-10 w-px border-l border-border/60 px-3 text-right",
                      NEN_DAU_BANG,
                    )}
                  >
                    <span className="sr-only">Hành động</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const dangDoiDongNay = dangCho && idDangDoi === r.id;
                  return (
                    <tr key={r.id} className={cn(adminTr, "group")}>
                      <td className={cn(adminTd, "px-4 font-mono font-medium")}>{r.maThietBi}</td>
                      <td className={cn(adminTd, "px-4")}>
                        {r.maQuay ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className={cn(adminTd, "px-4")}>
                        {r.ten ? (
                          <span className="block max-w-[180px] truncate" title={r.ten}>
                            {r.ten}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className={cn(adminTd, "px-4")}>
                        {r.tenCoSo ? (
                          <span className="block max-w-[200px] truncate" title={r.tenCoSo}>
                            {r.tenCoSo}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Không rõ</span>
                        )}
                      </td>
                      <td className={cn(adminTd, "px-4 py-2")}>
                        <div className="flex items-center gap-2">
                          {choSua ? (
                            <Switch
                              checked={r.active}
                              disabled={dangDoiDongNay}
                              onCheckedChange={(v) => (v ? doiTrangThai(r, true) : datCanTat(r))}
                              aria-label={`${r.active ? "Tắt" : "Bật"} máy ${r.maThietBi}`}
                            />
                          ) : null}
                          {dangDoiDongNay ? (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                              Đang lưu…
                            </span>
                          ) : (
                            <StatusPill tone={r.active ? "success" : "muted"}>
                              {r.active ? "Đang dùng" : "Đã tắt"}
                            </StatusPill>
                          )}
                        </div>
                      </td>
                      <td className={cn(adminTd, "px-4")}>
                        <MaHoacGach gia={r.maCuaHang} />
                      </td>
                      <td className={cn(adminTd, "px-4")}>
                        <MaHoacGach gia={r.maNhaCungCap} />
                      </td>
                      <td className={cn(adminTd, "px-4")}>
                        <MaHoacGach gia={r.maTcbQuay} />
                      </td>
                      <td className={cn(adminTd, "px-4 tabular-nums")}>{ngayVN(r.taoLuc)}</td>
                      <td
                        className={cn(
                          adminTd,
                          "sticky right-0 z-10 border-l border-border/60 px-3 py-1.5 text-right transition-colors",
                          NEN_O_DINH,
                        )}
                      >
                        {choSua ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2.5"
                            onClick={() => datDangMo(r.id)}
                            aria-label={`Sửa máy ${r.maThietBi}`}
                          >
                            <Pencil aria-hidden />
                            Sửa
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </PhanTrangBang>
        </div>
      )}

      {dangMo === "moi" ? (
        <HopThoaiMay key="moi" may={null} coSo={coSo} dong={() => datDangMo(null)} />
      ) : mayDangSua ? (
        <HopThoaiMay key={mayDangSua.id} may={mayDangSua} coSo={coSo} dong={() => datDangMo(null)} />
      ) : null}

      <Dialog
        open={canTat !== null}
        onOpenChange={(mo) => {
          if (!mo && !dangCho) datCanTat(null);
        }}
      >
        {/* `admin-scope`: Dialog render qua PORTAL ra ngoài khung admin ⇒ thiếu class này là nút
            lấy `--primary` CAM của :root thay vì tím admin (tiền lệ `chon-lead.tsx`). */}
        <DialogContent className="admin-scope sm:max-w-md">
          <DialogHeader>
            {/* Mã thiết bị là MỘT chuỗi dài không dấu cách (`SP_GINI_X990_V9E1013321`) ⇒ ở 375px
                nó đè lên nút đóng. `pr-8` chừa chỗ nút ×, `overflow-wrap:anywhere` cho phép ngắt. */}
            <DialogTitle className="pr-8 [overflow-wrap:anywhere]">Tắt máy {canTat?.maThietBi}?</DialogTitle>
            <DialogDescription>
              Từ lần import sau, giao dịch thẻ mới của máy này sẽ vào &quot;Thiết bị chưa gán cơ
              sở&quot; và phải gắn tay, cho tới khi bật lại. Giao dịch đã ghi nhận giữ nguyên.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => datCanTat(null)} disabled={dangCho}>
              Giữ máy bật
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={dangCho}
              onClick={() => canTat && doiTrangThai(canTat, false)}
            >
              {dangCho ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {dangCho ? "Đang tắt…" : "Tắt máy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HopThoaiMay({
  may,
  coSo,
  dong,
}: {
  may: DongMayPos | null;
  coSo: CoSoChon[];
  dong: () => void;
}) {
  const laSua = may !== null;
  const [dangCho, batDau] = useTransition();
  const [maThietBi, datMaThietBi] = useState(may?.maThietBi ?? "");
  const [maQuay, datMaQuay] = useState(may?.maQuay ?? "");
  const [ten, datTen] = useState(may?.ten ?? "");
  const [centerId, datCenterId] = useState(may?.centerId ?? (coSo.length === 1 ? coSo[0]!.id : ""));
  const [maTcb, datMaTcb] = useState<Record<KhoaMaTcb, string>>({
    maCuaHang: may?.maCuaHang ?? "",
    maNhaCungCap: may?.maNhaCungCap ?? "",
    maTcbQuay: may?.maTcbQuay ?? "",
  });
  const [loi, datLoi] = useState<string | null>(null);
  // Cùng luật zod phía server (`maTcbTuyChon`): khoảng trắng GIỮA mã = dán nhầm hai ô. Báo ngay khi gõ.
  const maTcbSai = (k: KhoaMaTcb) => /\s/.test(maTcb[k].trim());
  const coMaTcbSai = O_MA_TCB.some((o) => maTcbSai(o.khoa));

  // Cơ sở hiện tại của máy có thể không nằm trong danh sách CHỌN ĐƯỢC (cơ sở đã ngừng).
  // Vẫn phải hiện TÊN của nó trên ô chọn, không phải mã thô.
  const luaChon: CoSoChon[] =
    may && !coSo.some((c) => c.id === may.centerId)
      ? [{ id: may.centerId, name: may.tenCoSo ?? "Cơ sở hiện tại" }, ...coSo]
      : coSo;
  const tenDangChon = luaChon.find((c) => c.id === centerId)?.name;

  // Cùng luật với zod phía server (`maThietBiSchema`): báo NGAY khi gõ, đừng để người dùng
  // bấm Lưu rồi mới biết. Server vẫn là cổng thật.
  const maCoKhoangTrang = !laSua && /\s/.test(maThietBi.trim());
  const choLuu =
    !dangCho && !!centerId && !coMaTcbSai && (laSua || (!!maThietBi.trim() && !maCoKhoangTrang));

  function luu(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!choLuu) return;
    datLoi(null);
    batDau(async () => {
      try {
        const kq = laSua
          ? await suaMayPosAction({
              id: may.id,
              maQuay,
              ten,
              centerId,
              maCuaHang: maTcb.maCuaHang,
              maNhaCungCap: maTcb.maNhaCungCap,
              maTcbQuay: maTcb.maTcbQuay,
            })
          : await taoMayPosAction({
              maThietBi,
              maQuay,
              ten,
              centerId,
              maCuaHang: maTcb.maCuaHang,
              maNhaCungCap: maTcb.maNhaCungCap,
              maTcbQuay: maTcb.maTcbQuay,
            });
        if (kq.ok) {
          toast.success(
            laSua
              ? `Đã lưu máy ${may.maThietBi}.`
              : `Đã khai máy ${maThietBi.trim()}. ${CAU_NHAC_IMPORT_LAI}`,
          );
          dong();
        } else {
          // KHÔNG đóng hộp thoại: đóng là mất thứ người dùng vừa gõ.
          datLoi(kq.error);
        }
      } catch {
        datLoi(LOI_KHONG_RO);
      }
    });
  }

  const idLoi = "pos-loi";
  const idGoiYMa = "pos-ma-goi-y";

  return (
    <Dialog
      open
      onOpenChange={(mo) => {
        if (!mo && !dangCho) dong();
      }}
    >
      {/* GĐ2: bảy ô ⇒ hộp cao hơn màn 375×667 — giới hạn theo khung nhìn và cuộn TRONG hộp. */}
      <DialogContent className="admin-scope max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <form onSubmit={luu} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle className="pr-8 [overflow-wrap:anywhere]">{laSua ? `Sửa máy ${may.maThietBi}` : "Thêm máy POS"}</DialogTitle>
            <DialogDescription>
              {laSua
                ? "Mã thiết bị không đổi được. Khai sai mã thì tắt dòng này và khai một dòng mới."
                : "Mã thiết bị phải khớp ĐÚNG cột \"Mã thiết bị\" trong file giao dịch của Techcombank."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pos-ma-thiet-bi">
                Mã thiết bị
                {laSua ? null : (
                  <span className="text-state-danger-ink" aria-hidden>
                    *
                  </span>
                )}
              </Label>
              <Input
                id="pos-ma-thiet-bi"
                value={maThietBi}
                onChange={(e) => datMaThietBi(e.target.value)}
                disabled={laSua || dangCho}
                required={!laSua}
                aria-required={!laSua}
                maxLength={TRAN.maThietBi}
                autoFocus={!laSua}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-invalid={maCoKhoangTrang || undefined}
                aria-describedby={laSua ? undefined : idGoiYMa}
                className="font-mono"
              />
              {laSua ? null : (
                <p
                  id={idGoiYMa}
                  className={cn(
                    "text-xs",
                    maCoKhoangTrang ? "text-state-danger-ink" : "text-muted-foreground",
                  )}
                >
                  {maCoKhoangTrang
                    ? "Mã thiết bị không được chứa khoảng trắng — có thể bạn đã dán nhầm hai ô."
                    : "Dán nguyên mã, không khoảng trắng."}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pos-ma-quay">
                Mã quầy <span className="font-normal text-muted-foreground">(không bắt buộc)</span>
              </Label>
              <Input
                id="pos-ma-quay"
                value={maQuay}
                onChange={(e) => datMaQuay(e.target.value)}
                disabled={dangCho}
                maxLength={TRAN.maQuay}
                autoFocus={laSua}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pos-ten">
                Tên máy <span className="font-normal text-muted-foreground">(không bắt buộc)</span>
              </Label>
              <Input
                id="pos-ten"
                value={ten}
                onChange={(e) => datTen(e.target.value)}
                disabled={dangCho}
                maxLength={TRAN.ten}
                autoComplete="off"
                placeholder="Ví dụ: Máy quầy lễ tân CS1"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pos-co-so">
                Cơ sở đặt máy
                <span className="text-state-danger-ink" aria-hidden>
                  *
                </span>
              </Label>
              <Select value={centerId} onValueChange={(v) => datCenterId(v ?? "")} disabled={dangCho}>
                <SelectTrigger id="pos-co-so" className="w-full" aria-required>
                  {/* CON của `SelectValue` — không bao giờ rơi về mã cơ sở thô. */}
                  <SelectValue placeholder="Chọn cơ sở">{tenDangChon}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {luaChon.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* GĐ2 POS — ba mã Techcombank cấp trên portal merchant. Không là khoá khớp giao dịch (khoá
                vẫn là mã thiết bị); dùng cho đồng bộ tự động sau này nên phải dán ĐÚNG chuỗi. */}
            <div role="group" aria-labelledby="pos-nhom-ma-tcb" className="space-y-3 border-t border-border pt-3">
              <p id="pos-nhom-ma-tcb" className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Mã Techcombank cấp</span> — không bắt buộc, lấy trên
                portal merchant. Dán đúng chuỗi.
              </p>
              {O_MA_TCB.map((o) => (
                <div key={o.khoa} className="space-y-1.5">
                  <Label htmlFor={o.id}>{o.nhan}</Label>
                  <Input
                    id={o.id}
                    value={maTcb[o.khoa]}
                    onChange={(e) => datMaTcb((s) => ({ ...s, [o.khoa]: e.target.value }))}
                    disabled={dangCho}
                    maxLength={TRAN.maTcb}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder={o.goiY}
                    aria-invalid={maTcbSai(o.khoa) || undefined}
                    aria-describedby={maTcbSai(o.khoa) ? `${o.id}-loi` : undefined}
                    className="font-mono placeholder:font-sans"
                  />
                  {maTcbSai(o.khoa) ? (
                    <p id={`${o.id}-loi`} className="text-xs text-state-danger-ink">
                      Mã không được chứa khoảng trắng — có thể bạn đã dán nhầm hai ô.
                    </p>
                  ) : null}
                </div>
              ))}
            </div>

            {loi ? (
              <p
                id={idLoi}
                role="alert"
                className="rounded-lg bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink"
              >
                {loi}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={dong} disabled={dangCho}>
              Huỷ
            </Button>
            <Button type="submit" disabled={!choLuu} aria-describedby={loi ? idLoi : undefined}>
              {dangCho ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {dangCho ? "Đang lưu…" : laSua ? "Lưu thay đổi" : "Khai máy"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
