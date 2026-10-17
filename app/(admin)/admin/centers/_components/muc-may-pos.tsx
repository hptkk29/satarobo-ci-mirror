"use client";

// Mục "Máy POS quẹt thẻ" của trang cơ sở (`/centers/<id>/edit`) — khai máy SmartPOS Techcombank thuộc cơ sở NÀY, ngay sau mục
// "Thanh toán" (cùng nhóm "tiền về đâu"). docs/pos-hai-nut-khai-may.md §2, Việc 2 (09/10/2026): dời từ tab "Máy POS" của
// Cấu hình vận hành. Server cha: `centers/[id]/edit/page.tsx` → loader `docMucMayPos` (gác HAI lớp; không quyền ⇒ trang không
// dựng mục này, nên component không bao giờ phải tự kiểm quyền XEM).
//
// ── NẰM TRONG <form> CỦA CƠ SỞ ───────────────────────────────────────────────────────────────────────────────────
// `CenterForm` là `<form action>` bọc mọi mục. Ba hệ quả, đều đã đo (§2.1 N3):
//   1. `components/ui/button.tsx` KHÔNG đặt `type` mặc định ⇒ MỌI nút để trần trong mục này là nút SUBMIT của form cơ sở
//      (Enter ở ô "Tên cơ sở", hoặc một cú bấm lạc ⇒ `updateCenter` + rời trang). Nên mọi nút ở đây có `type` tường minh.
//   2. Hộp thoại (base-ui `DialogPortal`) ra `document.body` ⇒ `<form>` của nó KHÔNG lồng trong form cơ sở ở DOM.
//   3. …nhưng sự kiện React vẫn NỔI qua portal lên tổ tiên trong cây React ⇒ submit của hộp thoại `stopPropagation`.
//
// ── CƠ SỞ CỐ ĐỊNH ────────────────────────────────────────────────────────────────────────────────────────────────
// Máy ở đây luôn thuộc cơ sở của TRANG. Hộp thoại không có ô chọn cơ sở (đặc tả), nên UI không còn đường đổi cơ sở của máy
// (V30). `suaMayPosAction` vẫn nhận `centerId` — ta luôn gửi đúng `coSo.id` nên nhánh "đổi cơ sở" của action không chạy.
//
// ── VÌ SAO KHÔNG CÓ NÚT XOÁ ──────────────────────────────────────────────────────────────────────────────────────
// Máy thôi dùng thì TẮT. Giao dịch cũ của máy vẫn phải tra được "máy này đặt ở cơ sở nào", và xoá dòng là cắt đứt câu trả
// lời đó. Tắt thì lần import sau các giao dịch MỚI của máy rơi vào "Thiết bị chưa gán cơ sở" — đúng thứ người tắt muốn.
//
// ── VÌ SAO TẮT PHẢI XÁC NHẬN, BẬT THÌ KHÔNG ─────────────────────────────────────────────────────────────────────
// Tắt có hệ quả người bấm không thấy ngay: giao dịch thẻ mới của máy thôi tự khớp và dồn sang "Cần xử lý" ở màn khác. Gạt nhầm
// một công tắc 20px là đủ gây ra cả một ngày giao dịch phải gắn tay. Bật lại chỉ khôi phục đường khớp — không cần hỏi.
//
// ── VÌ SAO MÃ THIẾT BỊ KHÔNG SỬA ĐƯỢC ───────────────────────────────────────────────────────────────────────────
// Mã là thứ đem so KHỚP ĐÚNG với cột "Mã thiết bị" của file ngân hàng. Gõ sai thì tắt dòng sai rồi khai dòng mới — giữ vết mã
// nào từng thuộc cơ sở nào.
//
// Hộp thoại Thêm / Sửa / xác nhận Tắt là dùng lại hộp thoại của tab cũ (chủ dự án chốt); danh sách là thẻ `divide-y` cùng nếp
// mục "Thanh toán" ngay trên (bảng 10 cột cũ ép cuộn ngang trong khung `max-w-4xl`, và cột "Cơ sở" nay thừa).
import Link from "next/link";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { ArrowRight, Info, Loader2, Pencil, Plus, TriangleAlert } from "lucide-react";
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
import { StatusPill } from "@/components/admin/ui/status-pill";
import { ngayVN } from "@/lib/format/date";
import { cn } from "@/lib/utils";
import {
  CAU_NHAC_IMPORT_LAI,
  NEO_MAY_POS,
  TIEU_DE_MUC_MAY_POS,
  type DongAgentMay,
  type DongMayCoSo,
  type MucMayPosView,
} from "@/lib/payments/pos/may-o-co-so";
import { batTatMayPosAction, suaMayPosAction, taoMayPosAction } from "../_may-pos-actions";
import { Section } from "./center-form";

/** Nơi import file giao dịch thẻ — màn Biến động số dư, lọc nguồn "Thẻ POS". */
const DUONG_IMPORT = "/bien-dong-so-du?nguon=the";

/** Trần độ dài — khớp đúng zod ở `_may-pos-actions.ts`, để ô nhập chặn trước khi server từ chối. */
const TRAN = { maThietBi: 64, maQuay: 64, ten: 120, maTcb: 64 } as const;

/** Lỗi không lường trước (mạng rớt, server ném) — không để nó văng cả trang ra màn lỗi. */
const LOI_KHONG_RO = "Không lưu được do lỗi kết nối hoặc máy chủ. Thử lại sau ít phút.";

/** Ô mã: mono khi có, gạch ngang mờ khi trống — một chỗ cho mọi ô mã của máy. */
function MaHoacGach({ gia }: { gia: string | null }) {
  return gia ? (
    <span className="break-all font-mono">{gia}</span>
  ) : (
    <span className="text-muted-foreground">
      <span aria-hidden>—</span>
      <span className="sr-only">Chưa khai</span>
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

function Muc({ nhan, children }: { nhan: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{nhan}</dt>
      <dd className="mt-0.5 text-foreground">{children}</dd>
    </div>
  );
}

/** Dòng trạng thái POS Agent cạnh máy. Chỉ được dựng khi loader đã đọc (người xem có `payments:import-pos`). */
function DongAgent({ a }: { a: DongAgentMay }) {
  if (a.kieu === "CHUA_KHOP") {
    return (
      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-state-warning-ink">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>{a.cau}</span>
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span>POS Agent</span>
      <StatusPill tone={a.tone}>{a.nhan}</StatusPill>
      {a.phien ? (
        <span
          className={cn(
            "tabular-nums",
            a.phienTone === "danger" && "font-semibold text-state-danger-ink",
            a.phienTone === "warning" && "text-state-warning-ink",
          )}
        >
          Phiên: {a.phien}
        </span>
      ) : null}
      <Link
        href={`/bien-dong-so-du/pos-agent#the-${a.agentId}`}
        aria-label="Xem sức khoẻ POS Agent"
        className="inline-flex min-h-11 items-center gap-0.5 whitespace-nowrap font-semibold text-primary underline-offset-2 hover:underline sm:min-h-0"
      >
        Chi tiết
        <ArrowRight className="size-3" aria-hidden />
      </Link>
    </p>
  );
}

function HangMay({
  r,
  sua,
  dangDoi,
  onSua,
  onBat,
  onTat,
}: {
  r: DongMayCoSo;
  sua: boolean;
  dangDoi: boolean;
  onSua: () => void;
  onBat: () => void;
  onTat: () => void;
}) {
  const trangThai = (
    <StatusPill tone={r.active ? "success" : "muted"}>{r.active ? "Đang dùng" : "Đã tắt"}</StatusPill>
  );
  return (
    <li className="space-y-2.5 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1 basis-52">
          {r.ten ? (
            <>
              <p className="truncate text-sm font-semibold text-foreground" title={r.ten}>
                {r.ten}
              </p>
              <p className="break-all font-mono text-xs text-muted-foreground">{r.maThietBi}</p>
            </>
          ) : (
            <p className="break-all font-mono text-sm font-semibold text-foreground">{r.maThietBi}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {sua ? (
            // Nhãn bọc công tắc: bấm vào chữ trạng thái cũng gạt được (vùng chạm ≥ 44px trên màn hẹp).
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 sm:min-h-9">
              <Switch
                checked={r.active}
                disabled={dangDoi}
                onCheckedChange={(v) => (v ? onBat() : onTat())}
                aria-label={`${r.active ? "Tắt" : "Bật"} máy ${r.maThietBi}`}
              />
              {dangDoi ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  Đang lưu…
                </span>
              ) : (
                trangThai
              )}
            </label>
          ) : (
            trangThai
          )}
          {sua ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11 px-2.5 text-primary sm:min-h-9"
              onClick={onSua}
              aria-label={`Sửa máy ${r.maThietBi}`}
            >
              <Pencil aria-hidden />
              Sửa
            </Button>
          ) : null}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
        <Muc nhan="Mã quầy">
          <MaHoacGach gia={r.maQuay} />
        </Muc>
        <Muc nhan="Mã cửa hàng">
          <MaHoacGach gia={r.maCuaHang} />
        </Muc>
        <Muc nhan="Mã nhà cung cấp">
          <MaHoacGach gia={r.maNhaCungCap} />
        </Muc>
        <Muc nhan="Mã TCB quầy">
          <MaHoacGach gia={r.maTcbQuay} />
        </Muc>
        <Muc nhan="Ngày khai">
          <span className="tabular-nums">{ngayVN(r.taoLuc)}</span>
        </Muc>
      </dl>

      {r.agent ? <DongAgent a={r.agent} /> : null}
    </li>
  );
}

export function MucMayPos({ view }: { view: MucMayPosView }) {
  const { coSo, quyen, may } = view;
  // `null` = đóng; `"moi"` = thêm; còn lại = id máy đang sửa.
  const [dangMo, datDangMo] = useState<string | null>(null);
  const [dangCho, batDau] = useTransition();
  const [idDangDoi, datIdDangDoi] = useState<string | null>(null);
  const [canTat, datCanTat] = useState<DongMayCoSo | null>(null);
  const mayDangSua = dangMo && dangMo !== "moi" ? (may.find((r) => r.id === dangMo) ?? null) : null;

  function doiTrangThai(r: DongMayCoSo, active: boolean) {
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

  const nutThem = quyen.them ? (
    <Button type="button" className="min-h-11 sm:min-h-9" onClick={() => datDangMo("moi")}>
      <Plus aria-hidden />
      Thêm máy POS
    </Button>
  ) : null;

  return (
    <Section
      id={NEO_MAY_POS}
      title={TIEU_DE_MUC_MAY_POS}
      hint={
        <>
          Máy quẹt thẻ SmartPOS Techcombank đặt ở cơ sở này. Mỗi máy thuộc đúng một cơ sở và quyết định cơ sở của mọi giao dịch
          thẻ nó quẹt. Máy chưa khai — hoặc đang tắt — thì giao dịch thẻ của nó không tự khớp được với phiếu thu: chúng vào
          “Thiết bị chưa gán cơ sở” ở màn Biến động số dư.
        </>
      }
    >
      {may.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center sm:px-5">
          <p className="text-sm font-medium text-foreground">
            {quyen.sua ? "Chưa khai máy POS nào ở cơ sở này" : "Cơ sở này chưa có máy POS nào"}
          </p>
          <p className="mx-auto mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">
            Chưa có máy nào thì <b className="font-semibold text-foreground">mọi giao dịch thẻ</b> của cơ sở này rơi vào
            “Thiết bị chưa gán cơ sở”, và nút Thẻ POS trên đơn báo “Chưa khai máy POS”.
            {quyen.sua ? " Mã thiết bị lấy ở cột “Mã thiết bị” trong file giao dịch tải từ Techcombank." : null}
          </p>
          {nutThem ? <div className="mt-4 inline-flex">{nutThem}</div> : null}
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {may.map((r) => (
              <HangMay
                key={r.id}
                r={r}
                sua={quyen.sua}
                dangDoi={dangCho && idDangDoi === r.id}
                onSua={() => datDangMo(r.id)}
                onBat={() => doiTrangThai(r, true)}
                onTat={() => datCanTat(r)}
              />
            ))}
          </ul>
          {nutThem ? <div className="flex flex-wrap items-center gap-3">{nutThem}</div> : null}
        </>
      )}

      {quyen.lyDoKhongThem ? (
        // Nút bị ẩn phải NÓI vì sao ngay trên màn — `title` không hiện trên cảm ứng và trình đọc màn hình thường bỏ qua.
        <p className="text-xs leading-relaxed text-state-warning-ink">{quyen.lyDoKhongThem}</p>
      ) : null}

      {quyen.sua ? (
        // Câu nhắc là LỜI DẶN, không phải liên kết — nên không tô màu link. Link thật (khi người xem mở được màn đó) nằm riêng
        // ở cuối, có mũi tên.
        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {CAU_NHAC_IMPORT_LAI}
            {view.moDuocBienDong ? (
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
          </span>
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Bạn chỉ <b className="font-semibold text-foreground">xem</b> danh sách máy. Khai / sửa / bật-tắt máy POS là việc của
          Kế toán Hội sở (nhìn được mọi cơ sở) — máy quyết định cơ sở của mọi giao dịch thẻ nó quẹt.
        </p>
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
        {/* `admin-scope`: Dialog render qua PORTAL ra ngoài khung admin ⇒ thiếu class này là nút lấy `--primary` CAM của :root
            thay vì tím admin (tiền lệ `chon-lead.tsx`). */}
        <DialogContent className="admin-scope sm:max-w-md">
          <DialogHeader>
            {/* Mã thiết bị là MỘT chuỗi dài không dấu cách (`SP_GINI_X990_V9E1013321`) ⇒ ở 375px nó đè lên nút đóng. `pr-8` chừa
                chỗ nút ×, `overflow-wrap:anywhere` cho phép ngắt. */}
            <DialogTitle className="pr-8 [overflow-wrap:anywhere]">Tắt máy {canTat?.maThietBi}?</DialogTitle>
            <DialogDescription>
              Từ lần import sau, giao dịch thẻ mới của máy này sẽ vào &quot;Thiết bị chưa gán cơ sở&quot; và phải gắn tay, cho
              tới khi bật lại. Giao dịch đã ghi nhận giữ nguyên.
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
    </Section>
  );
}

function HopThoaiMay({
  may,
  coSo,
  dong,
}: {
  may: DongMayCoSo | null;
  coSo: MucMayPosView["coSo"];
  dong: () => void;
}) {
  const laSua = may !== null;
  const [dangCho, batDau] = useTransition();
  const [maThietBi, datMaThietBi] = useState(may?.maThietBi ?? "");
  const [maQuay, datMaQuay] = useState(may?.maQuay ?? "");
  const [ten, datTen] = useState(may?.ten ?? "");
  const [maTcb, datMaTcb] = useState<Record<KhoaMaTcb, string>>({
    maCuaHang: may?.maCuaHang ?? "",
    maNhaCungCap: may?.maNhaCungCap ?? "",
    maTcbQuay: may?.maTcbQuay ?? "",
  });
  const [loi, datLoi] = useState<string | null>(null);
  // Cùng luật zod phía server (`maTcbTuyChon`): khoảng trắng GIỮA mã = dán nhầm hai ô. Báo ngay khi gõ.
  const maTcbSai = (k: KhoaMaTcb) => /\s/.test(maTcb[k].trim());
  const coMaTcbSai = O_MA_TCB.some((o) => maTcbSai(o.khoa));

  // Cùng luật với zod phía server (`maThietBiSchema`): báo NGAY khi gõ, đừng để người dùng bấm Lưu rồi mới biết. Server vẫn là cổng thật.
  const maCoKhoangTrang = !laSua && /\s/.test(maThietBi.trim());
  const choLuu = !dangCho && !coMaTcbSai && (laSua || (!!maThietBi.trim() && !maCoKhoangTrang));

  function luu(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Hộp thoại ra khỏi <form> cơ sở ở DOM, nhưng sự kiện React vẫn nổi qua portal lên tổ tiên trong cây React.
    e.stopPropagation();
    if (!choLuu) return;
    datLoi(null);
    batDau(async () => {
      try {
        const kq = laSua
          ? // SỬA KHÔNG gửi `centerId`: nó nghĩa là "CHUYỂN máy sang cơ sở này", mà hộp thoại không có ý định đó. Gửi `centerId` của
            // TRANG thì trang CS1 cũ đổi tên một máy vừa được chuyển sang CS2 sẽ kéo máy về CS1 (docs/pos-hai-nut-khai-may.md, ca
            // `[HN2-RD-01]`). TẠO thì gửi — máy mới thuộc cơ sở của trang.
            await suaMayPosAction({
              id: may.id,
              maQuay,
              ten,
              maCuaHang: maTcb.maCuaHang,
              maNhaCungCap: maTcb.maNhaCungCap,
              maTcbQuay: maTcb.maTcbQuay,
            })
          : await taoMayPosAction({
              maThietBi,
              maQuay,
              ten,
              centerId: coSo.id,
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
      {/* Bảy ô ⇒ hộp cao hơn màn 375×667 — giới hạn theo khung nhìn và cuộn TRONG hộp. */}
      <DialogContent className="admin-scope max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <form onSubmit={luu} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle className="pr-8 [overflow-wrap:anywhere]">
              {laSua ? `Sửa máy ${may.maThietBi}` : "Thêm máy POS"}
            </DialogTitle>
            <DialogDescription>
              {laSua
                ? "Mã thiết bị không đổi được. Khai sai mã thì tắt dòng này và khai một dòng mới."
                : 'Mã thiết bị phải khớp ĐÚNG cột "Mã thiết bị" trong file giao dịch của Techcombank.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {/* CƠ SỞ CỐ ĐỊNH theo trang: chữ chỉ-đọc, không phải ô chọn (đặc tả + V30). */}
            <div className="space-y-1.5">
              <p className="text-sm font-medium leading-none text-foreground">Cơ sở đặt máy</p>
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">{coSo.ten}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Máy luôn thuộc cơ sở của trang này.
                {laSua ? " Muốn chuyển máy sang cơ sở khác, báo bên kỹ thuật." : null}
              </p>
            </div>
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
                  className={cn("text-xs", maCoKhoangTrang ? "text-state-danger-ink" : "text-muted-foreground")}
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
            {/* GĐ2 POS — ba mã Techcombank cấp trên portal merchant. Không là khoá khớp giao dịch (khoá vẫn là mã thiết bị); dùng
                cho đồng bộ tự động sau này nên phải dán ĐÚNG chuỗi. */}
            <div role="group" aria-labelledby="pos-nhom-ma-tcb" className="space-y-3 border-t border-border pt-3">
              <p id="pos-nhom-ma-tcb" className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Mã Techcombank cấp</span> — không bắt buộc, lấy trên portal
                merchant. Dán đúng chuỗi.
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
