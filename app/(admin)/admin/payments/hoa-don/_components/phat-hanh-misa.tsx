"use client";

// Bước 1 MISA (30/09/2026) — lối "Phát hành qua MISA" trong ngăn lần thu, song song lối "Tải hoá đơn lên".
// docs/ke-toan-hoa-don/PLAN.md mục "Bước 1 — Phát hành qua MISA".
//
// ⚠️ Nút nào hiện / sáng đọc từ `dong.phatHanhMisa` (luật `nutPhatHanhMisa`) và `dong.misa` (`khoiMisa`) — đúng
// hai trường action đọc lại trên dòng loader dựng lại. Không tự suy điều kiện ở đây (luật 12).
// ⚠️ Xác nhận HAI BƯỚC, tại chỗ (không modal): bước 1 bày ĐÚNG những gì sẽ gửi (số tiền, người mua, ký hiệu,
// môi trường) — hoá đơn điện tử đã ký là chứng từ thuế, không xoá được; bấm nhầm là phải lập biên bản huỷ.

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileText, Loader2, RefreshCw, Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import { kyHieuTheoNam } from "@/lib/finance/hoa-don/ky-hieu";
import type { DongHangCho } from "@/lib/finance/hoa-don/dong-hang-cho";
import type { KetQuaGuiNhap } from "@/lib/finance/hoa-don/gui-nhap-vin";
import { queryHoaDon } from "@/lib/finance/hoa-don/loc-hang-cho";
import { useLocUrl } from "./loc-url";
import type { KhoiMisa } from "@/lib/finance/hoa-don/nut-phat-hanh-misa";
import { TEN_NHA_CUNG_CAP_API, type NhaCungCapApi } from "@/lib/finance/hoa-don/phap-nhan";
import {
  boKhoiNhapHoaDonVinAction,
  boPhatHanhLamTayAction,
  guiNhapHoaDonVinAction,
  kiemTraLaiPhatHanhAction,
  phatHanhLaiAction,
  phatHanhQuaMisaAction,
} from "../_actions";

type MoiTruong = "sandbox" | "production" | "gia-lap";

const tien = (n: number) => `${n.toLocaleString("vi-VN")}đ`;
const homNay = () => new Date(`${new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)}T00:00:00Z`);

/** Tên nhà cung cấp in trên màn: MISA (giữ nguyên chữ cũ) hoặc VIN-HOADON. `tenDayDu` dùng ở câu «gửi hoá đơn sang …». */
function tenNcc(ncc: NhaCungCapApi) {
  return { ten: TEN_NHA_CUNG_CAP_API[ncc], tenDayDu: ncc === "MISA_MEINVOICE" ? "MISA meInvoice" : "VIN-HOADON" };
}

function moiTruongInfo(ncc: NhaCungCapApi): Record<MoiTruong, { nhan: string; tone: PillTone; cau: string }> {
  const { ten } = tenNcc(ncc);
  return {
    production: {
      nhan: `${ten} · chính thức`,
      tone: "brand",
      cau: `Hoá đơn THẬT — ký số, gửi cơ quan thuế. Không xoá được, sai phải lập hoá đơn huỷ / thay thế trên ${ten}.`,
    },
    sandbox: {
      nhan: `${ten} · thử (sandbox)`,
      tone: "info",
      cau: `Môi trường thử của ${ten} — hoá đơn không có giá trị pháp lý, vẫn gửi email cho khách như thật.`,
    },
    "gia-lap": {
      nhan: "Mô phỏng",
      tone: "warning",
      cau: `MÔ PHỎNG — không gọi ${ten}, không có giá trị pháp lý. Hệ thống không gửi email cho khách.`,
    },
  };
}

export function NhanMoiTruong({ moiTruong, nhaCungCap = "MISA_MEINVOICE" }: { moiTruong: MoiTruong; nhaCungCap?: NhaCungCapApi }) {
  const m = moiTruongInfo(nhaCungCap)[moiTruong];
  return <StatusPill tone={m.tone}>{m.nhan}</StatusPill>;
}

/** Nhãn cho bản hoá đơn MÔ PHỎNG đã "xuất" — không bao giờ được trông như hoá đơn thật. */
export function CanhBaoMoPhong() {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-state-warning-soft px-3.5 py-2.5 text-sm font-medium text-state-warning-ink">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>MÔ PHỎNG — không có giá trị pháp lý. Đừng gửi bản này cho khách.</span>
    </p>
  );
}

/** Câu thông báo sau một bước của máy phát hành — cùng một luật cho nút phát hành, kiểm tra lại, phát hành lại. */
function baoKetQua(d: { trangThai: string; thongDiep: string | null }, ncc: NhaCungCapApi) {
  const { ten } = tenNcc(ncc);
  if (d.trangThai === "DA_XAC_NHAN") return void toast.success(`Đã phát hành qua ${ten} — hoá đơn đã lưu số và tệp`);
  if (d.trangThai === "LOI_PHAT_HANH") return void toast.error(`${ten} từ chối: ${d.thongDiep ?? "không rõ lý do"}`);
  if (d.trangThai === "DANG_PHAT_HANH") {
    return void toast.warning(d.thongDiep ?? `Đang chờ ${ten} xác nhận — hệ thống tự kiểm tra lại sau ít phút`);
  }
  toast.warning("Hoá đơn vừa đổi trạng thái — tải lại màn");
}

/** Kết quả «Gửi nháp»: nói rõ ĐÃ lưu nháp hay chưa, nhà cung cấp trả gì, và dữ liệu đã gửi để kế toán đối chiếu. Kể cả khi bị từ chối cũng hiện (đó chính là điều cần biết). Chữ trên màn KHÔNG nêu tên nhà cung cấp (chủ dự án 09/11/2026: đổi nhà cung cấp thì không phải sửa màn). */
export function KetQuaNhapVin({ kq }: { kq: KetQuaGuiNhap }) {
  const tt = kq.tomTat;
  return (
    <div
      role="status"
      className={
        kq.ok
          ? "flex flex-col gap-2 rounded-lg bg-state-success-soft px-3.5 py-2.5 text-sm text-state-success-ink"
          : "flex flex-col gap-2 rounded-lg bg-state-warning-soft px-3.5 py-2.5 text-sm text-state-warning-ink"
      }
    >
      {kq.ok ? (
        <p className="flex items-start gap-2 font-medium">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>Nhà cung cấp hoá đơn đã nhận bản nháp (chưa ký, chưa có số hoá đơn). Mã giao dịch: <span className="tabular-nums">{kq.maGiaoDich}</span></span>
        </p>
      ) : (
        <p className="flex items-start gap-2 font-medium">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{kq.daGui ? "Nhà cung cấp chưa nhận bản nháp" : "Chưa gửi nháp"} — {kq.thongDiep}</span>
        </p>
      )}
      {tt ? (
        <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-foreground">
          <dt className="text-muted-foreground">Đã gửi: người mua</dt>
          <dd className="min-w-0 [overflow-wrap:anywhere]">{tt.nguoiMuaTen || "—"}{tt.nguoiMuaMst ? ` · MST ${tt.nguoiMuaMst}` : ""}</dd>
          <dt className="text-muted-foreground">Ký hiệu · MST bán</dt>
          <dd className="tabular-nums">{tt.kyHieu} · {tt.mstNguoiBan}</dd>
          <dt className="text-muted-foreground">Tổng tiền</dt>
          <dd className="font-semibold tabular-nums">{tien(tt.tongThanhToan)} ({tt.soDong} dòng)</dd>
          {kq.refId ? (
            <>
              <dt className="text-muted-foreground">Mã nháp</dt>
              <dd className="min-w-0 break-all text-xs tabular-nums">{kq.refId}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {kq.ok ? <p className="text-xs text-muted-foreground">Vào trang quản trị của nhà cung cấp hoá đơn, tìm theo mã nháp ở trên để đối chiếu, rồi <b>xoá bản nháp</b> sau khi xem.</p> : null}
    </div>
  );
}

/**
 * «Bỏ khỏi Nháp» (11/11/2026): dòng đã GỬI NHÁP (`dong.daGuiNhap`, đọc từ loader — không tự suy) nằm ở tab «Nháp & đang phát hành»; bấm nhầm «Gửi nháp» (vd lần thu cọc còn cần GỘP với lần thu
 * khác) thì đưa nó về «Chờ xuất». Vẽ ĐỘC LẬP với nút Phát hành (đường lui không được biến mất chỉ vì phát hành đang tắt). Xác nhận hai bước tại chỗ. Nói thật: bản nháp trên nhà cung cấp hoá đơn
 * KHÔNG bị xoá (cổng không có lệnh xoá) — kế toán xoá ở trang của họ; nó không chặn hoá đơn thật.
 */
export function BoKhoiNhap({ dong }: { dong: DongHangCho }) {
  const router = useRouter();
  const pathname = usePathname();
  const loc = useLocUrl();
  const [, startTransition] = useTransition();
  const [chacChan, setChacChan] = useState(false);
  const [dangBo, setDangBo] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  if (!dong.daGuiNhap) return null;
  const luc = new Date(dong.daGuiNhap.luc).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });

  async function bo() {
    setDangBo(true);
    setLoi(null);
    const r = await boKhoiNhapHoaDonVinAction({ orderId: dong.orderId, lanThuKey: dong.key });
    setDangBo(false);
    if (!r.ok) return setLoi(r.error);
    toast.success("Đã đưa lần thu về «Chờ xuất» — gộp hoặc phát hành như bình thường");
    // Sang tab «Chờ xuất» và giữ dòng đang chọn: ở lại tab «Nháp» thì dòng vừa bỏ biến mất khỏi danh sách đang mở.
    startTransition(() => router.replace(`${pathname}?${queryHoaDon(loc, { ngan: "cho", chon: dong.key })}`, { scroll: false }));
  }

  return (
    <section aria-label="Bản nháp đã gửi" className="flex flex-col gap-2.5 rounded-xl border border-border p-4">
      <h4 className="text-sm font-semibold text-foreground">Đã gửi nháp lúc {luc}</h4>
      <p className="text-sm text-muted-foreground">
        Lần thu này đang nằm ở tab «Nháp &amp; đang phát hành». Gửi nhầm (vd cần <b>gộp</b> với lần thu khác trước khi phát hành)? Bỏ khỏi «Nháp» để lần thu về lại «Chờ xuất».
      </p>
      <p className="text-xs text-muted-foreground">
        Chỉ đổi trong hệ thống này: bản nháp đã gửi vẫn còn ở trang quản trị của nhà cung cấp hoá đơn — vào đó <b>xoá bản nháp</b>. Nó không ký, không có số hoá đơn và không chặn hoá đơn thật sau này.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {!chacChan ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setChacChan(true)}>
            <Undo2 aria-hidden /> Bỏ khỏi «Nháp» — về Chờ xuất
          </Button>
        ) : (
          <>
            <Button type="button" size="sm" disabled={dangBo} onClick={() => void bo()}>
              {dangBo ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden /> Đang bỏ…
                </>
              ) : (
                <>
                  <Undo2 aria-hidden /> Bấm lần nữa để bỏ khỏi «Nháp»
                </>
              )}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={dangBo} onClick={() => setChacChan(false)}>
              Không bỏ
            </Button>
          </>
        )}
      </div>
      {loi ? (
        <p role="alert" className="text-sm text-state-danger-ink">
          {loi}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Dòng hàng chờ: nút "Phát hành qua MISA" + bước xác nhận. Không hiện ⇒ không vẽ gì (hoặc câu `cau` khi có
 * việc phải làm tay — hoá đơn thay thế).
 */
export function PhatHanhQuaMisa({ dong }: { dong: DongHangCho }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [xemLai, setXemLai] = useState(false);
  const [dangGui, setDangGui] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const [dangGuiNhap, setDangGuiNhap] = useState(false);
  const [ketQuaNhap, setKetQuaNhap] = useState<KetQuaGuiNhap | null>(null);
  const [loiNhap, setLoiNhap] = useState<string | null>(null);
  const nut = dong.phatHanhMisa;

  if (!nut.hien) {
    return nut.cau ? <p className="text-sm text-muted-foreground">{nut.cau}</p> : null;
  }
  const moiTruong = nut.moiTruong ?? "production";
  const { ten, tenDayDu } = tenNcc(nut.nhaCungCap);
  const kyHieu = dong.kyHieuMau ? kyHieuTheoNam(dong.kyHieuMau, homNay()) : "—";

  async function guiNhap() {
    setDangGuiNhap(true);
    setLoiNhap(null);
    setKetQuaNhap(null);
    const r = await guiNhapHoaDonVinAction({ orderId: dong.orderId, lanThuKey: dong.key, soTienDaThay: dong.soTien });
    setDangGuiNhap(false);
    if (!r.ok) return setLoiNhap(r.error);
    setKetQuaNhap(r.data);
  }

  async function phatHanh() {
    setDangGui(true);
    setLoi(null);
    // Số tiền + môi trường ĐÃ THẤY ở bước xác nhận: đổi sau lúc màn vẽ ⇒ server từ chối, không phát hành
    // một tờ khác tờ người bấm vừa soát.
    const r = await phatHanhQuaMisaAction({
      orderId: dong.orderId,
      lanThuKey: dong.key,
      soTienDaThay: dong.soTien,
      moiTruongDaThay: moiTruong,
    });
    setDangGui(false);
    if (!r.ok) return setLoi(r.error);
    setXemLai(false);
    baoKetQua(r.data, nut.nhaCungCap);
    startTransition(() => router.refresh());
  }

  return (
    <section aria-label={`Phát hành qua ${ten}`} className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">Phát hành qua {ten}</h4>
        <NhanMoiTruong moiTruong={moiTruong} nhaCungCap={nut.nhaCungCap} />
      </div>

      {!xemLai ? (
        <>
          <p className="text-sm text-muted-foreground">
            Hệ thống gửi hoá đơn sang {tenDayDu}, ký số và tự lưu số, ký hiệu, tệp PDF/XML — không phải gõ lại ở{" "}
            {ten}.
          </p>
          <div>
            <Button type="button" size="sm" disabled={!nut.bat} onClick={() => setXemLai(true)}>
              <Send aria-hidden /> Phát hành qua {ten}…
            </Button>
          </div>
          {!nut.bat && nut.lyDo ? <p className="text-sm text-muted-foreground">{nut.lyDo}</p> : null}
          {/* «Gửi nháp» — CHỈ khi nhà cung cấp là VIN và nút Phát hành đang sáng (cùng điều kiện, cùng cổng ở máy chủ). Không tạo hoá đơn, không ký, không khoá khoản. */}
          {nut.nhaCungCap === "VIN_HOADON" && nut.bat ? (
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <p className="text-sm text-muted-foreground">
                Muốn thử trước? Gửi một bản <b>nháp</b> sang nhà cung cấp hoá đơn bằng đúng dữ liệu lần thu này để xem họ nhận có đúng không — <b>không ký, không tạo hoá đơn, không khoá khoản</b>. Bản nháp xoá được ở trang quản trị của nhà cung cấp.
              </p>
              <div>
                <Button type="button" size="sm" variant="outline" disabled={dangGuiNhap} onClick={() => void guiNhap()}>
                  {dangGuiNhap ? (
                    <>
                      <Loader2 className="animate-spin" aria-hidden /> Đang gửi nháp…
                    </>
                  ) : (
                    <>
                      <FileText aria-hidden /> Gửi nháp (không ký)
                    </>
                  )}
                </Button>
              </div>
              {loiNhap ? (
                <p role="alert" className="text-sm text-state-danger-ink">
                  {loiNhap}
                </p>
              ) : null}
              {ketQuaNhap ? <KetQuaNhapVin kq={ketQuaNhap} /> : null}
            </div>
          ) : null}
        </>
      ) : (
        <fieldset className="flex flex-col gap-3" disabled={dangGui}>
          <legend className="sr-only">Xác nhận phát hành qua {ten}</legend>
          <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Số tiền</dt>
            <dd className="font-semibold tabular-nums text-foreground">{tien(dong.soTien)}</dd>
            <dt className="text-muted-foreground">Người mua</dt>
            <dd className="min-w-0 text-foreground [overflow-wrap:anywhere]">
              {dong.tenKhach || "—"}
              {dong.coTtHoaDon ? <span className="text-muted-foreground"> · theo TT hoá đơn trên đơn</span> : null}
            </dd>
            <dt className="text-muted-foreground">Email nhận</dt>
            <dd className="min-w-0 text-foreground [overflow-wrap:anywhere]">
              {moiTruong === "gia-lap" ? (
                <span className="text-muted-foreground">Không gửi (mô phỏng)</span>
              ) : (
                (dong.emailNhan ?? <span className="text-muted-foreground">Khách chưa có email</span>)
              )}
            </dd>
            <dt className="text-muted-foreground">Ký hiệu</dt>
            <dd className="font-medium tabular-nums text-foreground">{kyHieu}</dd>
          </dl>
          <p
            className={
              moiTruong === "production"
                ? "flex items-start gap-2 rounded-lg bg-state-danger-soft px-3.5 py-2.5 text-sm text-state-danger-ink"
                : "flex items-start gap-2 rounded-lg bg-state-warning-soft px-3.5 py-2.5 text-sm text-state-warning-ink"
            }
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{moiTruongInfo(nut.nhaCungCap)[moiTruong].cau}</span>
          </p>
          {loi ? (
            <p role="alert" className="text-sm text-state-danger-ink">
              {loi}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void phatHanh()}>
              {dangGui ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden /> Đang gửi {ten}…
                </>
              ) : (
                `Phát hành ${tien(dong.soTien)}`
              )}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setXemLai(false)}>
              Thôi
            </Button>
          </div>
        </fieldset>
      )}
    </section>
  );
}

/** Ngăn "Phát hành MISA": bản ĐANG phát hành (Kiểm tra lại) hoặc LỖI (Phát hành lại · Bỏ, làm tay). */
export function KhoiPhatHanhMisa({ dong, misa }: { dong: DongHangCho; misa: KhoiMisa }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [dang, setDang] = useState<null | "kiem" | "lai" | "bo">(null);
  const [xacNhanBo, setXacNhanBo] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const loiMisa = misa.trangThai === "LOI_PHAT_HANH";
  const { ten } = tenNcc(misa.nhaCungCap);

  async function chay(viec: "kiem" | "lai" | "bo") {
    setDang(viec);
    setLoi(null);
    const goc = { orderId: dong.orderId, hoaDonId: misa.hoaDonId };
    if (viec === "bo") {
      const r = await boPhatHanhLamTayAction({ ...goc, phienBan: misa.phienBan });
      setDang(null);
      if (!r.ok) return setLoi(r.error);
      toast.success(
        misa.nhaCungCap === "VIN_HOADON"
          ? `Đã bỏ bản lỗi — lần thu về lại hàng chờ. Bấm «Gửi nháp (không ký)» để ký tay bằng USB token, hoặc làm tay ở ${ten} rồi tải lên`
          : `Đã bỏ bản lỗi — lần thu về lại hàng chờ để làm tay ở ${ten} rồi tải lên`,
      );
      return startTransition(() => router.refresh());
    }
    const r =
      viec === "kiem"
        ? await kiemTraLaiPhatHanhAction(goc)
        : await phatHanhLaiAction({ ...goc, phienBan: misa.phienBan, moiTruongDaThay: misa.moiTruong ?? "production" });
    setDang(null);
    if (!r.ok) return setLoi(r.error);
    baoKetQua(r.data, misa.nhaCungCap);
    startTransition(() => router.refresh());
  }

  return (
    <section
      aria-label={loiMisa ? `Lỗi phát hành ${ten}` : `Đang phát hành ${ten}`}
      className={
        loiMisa
          ? "flex flex-col gap-3 rounded-xl bg-state-danger-soft p-4 text-state-danger-ink"
          : "flex flex-col gap-3 rounded-xl bg-state-info-soft p-4 text-state-info-ink"
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">
          {loiMisa ? `${ten} từ chối phát hành` : misa.so ? `Đã có số ${misa.so} — đang tải tệp` : `Đang chờ ${ten} xác nhận`}
        </h4>
        {misa.moPhong ? <StatusPill tone="warning">Mô phỏng</StatusPill> : null}
      </div>

      {loiMisa ? (
        <>
          <p className="text-sm">
            {misa.loiMa ? <span className="font-mono text-xs font-semibold">{misa.loiMa}</span> : null}
            {misa.loiMa && misa.thongDiep ? " · " : null}
            {misa.thongDiep ?? `${ten} không nói lý do`}
          </p>
          <p className="text-sm">
            Chưa có hoá đơn nào được phát hành. Sửa thông tin trên đơn rồi <b>Phát hành lại</b>, hoặc <b>Bỏ</b> để làm
            tay ở {ten} rồi tải lên.
          </p>
          {misa.nhaCungCap === "VIN_HOADON" && misa.boLamTay.bat ? (
            <p className="text-sm">
              Chưa ký được bằng chứng thư số? Bấm <b>Bỏ, làm tay</b> (2 lần) để lần thu về lại hàng chờ, rồi dùng nút <b>Gửi nháp (không ký)</b> ở khung phát hành này — kế toán ký bản nháp bằng USB token trên trang của nhà cung cấp.
            </p>
          ) : null}
        </>
      ) : (
        <>
          {misa.thongDiep ? <p className="text-sm">{misa.thongDiep}</p> : null}
          <p className="text-sm">
            Đã gửi {misa.soLanGui} lần{misa.guiLucLabel ? ` · lần cuối ${misa.guiLucLabel}` : ""}. Hệ thống tự kiểm
            tra lại 10 phút một lần — không cần làm hoá đơn tay cho lần thu này.
          </p>
        </>
      )}

      {loi ? (
        <p role="alert" className="text-sm font-medium text-state-danger-ink">
          {loi}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {misa.kiemTraLai.bat ? (
          <Button type="button" variant="outline" size="sm" disabled={dang !== null} onClick={() => void chay("kiem")}>
            {dang === "kiem" ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />} Kiểm tra lại
          </Button>
        ) : null}
        {loiMisa ? (
          <Button
            type="button"
            size="sm"
            disabled={!misa.phatHanhLai.bat || dang !== null}
            onClick={() => void chay("lai")}
          >
            {dang === "lai" ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />} Phát hành lại
          </Button>
        ) : null}
        {loiMisa && misa.boLamTay.bat ? (
          xacNhanBo ? (
            // Repo chưa khai `--destructive-foreground` ⇒ chữ rơi về màu của khung đỏ (đỏ sẫm trên nền đỏ, không đọc được); chữ trắng tường minh — tiền lệ nut-ly-do.tsx.
            <Button type="button" variant="destructive" size="sm" className="text-white" disabled={dang !== null} onClick={() => void chay("bo")}>
              {dang === "bo" ? <Loader2 className="animate-spin" aria-hidden /> : null} Bấm lần nữa để bỏ
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" disabled={dang !== null} onClick={() => setXacNhanBo(true)}>
              Bỏ, làm tay
            </Button>
          )
        ) : null}
      </div>
      {[misa.kiemTraLai, misa.phatHanhLai, misa.boLamTay]
        .filter((n) => !n.bat && n.lyDo)
        .slice(0, 1)
        .map((n) => (
          <p key={n.lyDo} className="text-sm">
            {n.lyDo}
          </p>
        ))}
    </section>
  );
}
