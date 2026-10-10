"use client";

// Bước 1 MISA (30/09/2026) — lối "Phát hành qua MISA" trong ngăn lần thu, song song lối "Tải hoá đơn lên".
// docs/ke-toan-hoa-don/PLAN.md mục "Bước 1 — Phát hành qua MISA".
//
// ⚠️ Nút nào hiện / sáng đọc từ `dong.phatHanhMisa` (luật `nutPhatHanhMisa`) và `dong.misa` (`khoiMisa`) — đúng
// hai trường action đọc lại trên dòng loader dựng lại. Không tự suy điều kiện ở đây (luật 12).
// ⚠️ Xác nhận HAI BƯỚC, tại chỗ (không modal): bước 1 bày ĐÚNG những gì sẽ gửi (số tiền, người mua, ký hiệu,
// môi trường) — hoá đơn điện tử đã ký là chứng từ thuế, không xoá được; bấm nhầm là phải lập biên bản huỷ.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Loader2, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import { kyHieuTheoNam } from "@/lib/finance/hoa-don/ky-hieu";
import type { DongHangCho } from "@/lib/finance/hoa-don/dong-hang-cho";
import type { KhoiMisa } from "@/lib/finance/hoa-don/nut-phat-hanh-misa";
import {
  boPhatHanhLamTayAction,
  kiemTraLaiPhatHanhAction,
  phatHanhLaiAction,
  phatHanhQuaMisaAction,
} from "../_actions";

type MoiTruong = "sandbox" | "production" | "gia-lap";

const tien = (n: number) => `${n.toLocaleString("vi-VN")}đ`;
const homNay = () => new Date(`${new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)}T00:00:00Z`);

const MOI_TRUONG: Record<MoiTruong, { nhan: string; tone: PillTone; cau: string }> = {
  production: {
    nhan: "MISA · chính thức",
    tone: "brand",
    cau: "Hoá đơn THẬT — ký số, gửi cơ quan thuế. Không xoá được, sai phải lập hoá đơn huỷ / thay thế trên MISA.",
  },
  sandbox: {
    nhan: "MISA · thử (sandbox)",
    tone: "info",
    cau: "Môi trường thử của MISA — hoá đơn không có giá trị pháp lý, vẫn gửi email cho khách như thật.",
  },
  "gia-lap": {
    nhan: "Mô phỏng",
    tone: "warning",
    cau: "MÔ PHỎNG — không gọi MISA, không có giá trị pháp lý. Hệ thống không gửi email cho khách.",
  },
};

export function NhanMoiTruong({ moiTruong }: { moiTruong: MoiTruong }) {
  return <StatusPill tone={MOI_TRUONG[moiTruong].tone}>{MOI_TRUONG[moiTruong].nhan}</StatusPill>;
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
function baoKetQua(d: { trangThai: string; thongDiep: string | null }) {
  if (d.trangThai === "DA_XAC_NHAN") return void toast.success("Đã phát hành qua MISA — hoá đơn đã lưu số và tệp");
  if (d.trangThai === "LOI_PHAT_HANH") return void toast.error(`MISA từ chối: ${d.thongDiep ?? "không rõ lý do"}`);
  if (d.trangThai === "DANG_PHAT_HANH") {
    return void toast.warning(d.thongDiep ?? "Đang chờ MISA xác nhận — hệ thống tự kiểm tra lại sau ít phút");
  }
  toast.warning("Hoá đơn vừa đổi trạng thái — tải lại màn");
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
  const nut = dong.phatHanhMisa;

  if (!nut.hien) {
    return nut.cau ? <p className="text-sm text-muted-foreground">{nut.cau}</p> : null;
  }
  const moiTruong = nut.moiTruong ?? "production";
  const kyHieu = dong.kyHieuMau ? kyHieuTheoNam(dong.kyHieuMau, homNay()) : "—";

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
    baoKetQua(r.data);
    startTransition(() => router.refresh());
  }

  return (
    <section aria-label="Phát hành qua MISA" className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">Phát hành qua MISA</h4>
        <NhanMoiTruong moiTruong={moiTruong} />
      </div>

      {!xemLai ? (
        <>
          <p className="text-sm text-muted-foreground">
            Hệ thống gửi hoá đơn sang MISA meInvoice, ký số và tự lưu số, ký hiệu, tệp PDF/XML — không phải gõ lại ở
            MISA.
          </p>
          <div>
            <Button type="button" size="sm" disabled={!nut.bat} onClick={() => setXemLai(true)}>
              <Send aria-hidden /> Phát hành qua MISA…
            </Button>
          </div>
          {!nut.bat && nut.lyDo ? <p className="text-sm text-muted-foreground">{nut.lyDo}</p> : null}
        </>
      ) : (
        <fieldset className="flex flex-col gap-3" disabled={dangGui}>
          <legend className="sr-only">Xác nhận phát hành qua MISA</legend>
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
            <span>{MOI_TRUONG[moiTruong].cau}</span>
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
                  <Loader2 className="animate-spin" aria-hidden /> Đang gửi MISA…
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

  async function chay(viec: "kiem" | "lai" | "bo") {
    setDang(viec);
    setLoi(null);
    const goc = { orderId: dong.orderId, hoaDonId: misa.hoaDonId };
    if (viec === "bo") {
      const r = await boPhatHanhLamTayAction({ ...goc, phienBan: misa.phienBan });
      setDang(null);
      if (!r.ok) return setLoi(r.error);
      toast.success("Đã bỏ bản lỗi — lần thu về lại hàng chờ để làm tay ở MISA rồi tải lên");
      return startTransition(() => router.refresh());
    }
    const r =
      viec === "kiem"
        ? await kiemTraLaiPhatHanhAction(goc)
        : await phatHanhLaiAction({ ...goc, phienBan: misa.phienBan, moiTruongDaThay: misa.moiTruong ?? "production" });
    setDang(null);
    if (!r.ok) return setLoi(r.error);
    baoKetQua(r.data);
    startTransition(() => router.refresh());
  }

  return (
    <section
      aria-label={loiMisa ? "Lỗi phát hành MISA" : "Đang phát hành MISA"}
      className={
        loiMisa
          ? "flex flex-col gap-3 rounded-xl bg-state-danger-soft p-4 text-state-danger-ink"
          : "flex flex-col gap-3 rounded-xl bg-state-info-soft p-4 text-state-info-ink"
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">
          {loiMisa ? "MISA từ chối phát hành" : misa.so ? `Đã có số ${misa.so} — đang tải tệp` : "Đang chờ MISA xác nhận"}
        </h4>
        {misa.moPhong ? <StatusPill tone="warning">Mô phỏng</StatusPill> : null}
      </div>

      {loiMisa ? (
        <>
          <p className="text-sm">
            {misa.loiMa ? <span className="font-mono text-xs font-semibold">{misa.loiMa}</span> : null}
            {misa.loiMa && misa.thongDiep ? " · " : null}
            {misa.thongDiep ?? "MISA không nói lý do"}
          </p>
          <p className="text-sm">
            Chưa có hoá đơn nào được phát hành. Sửa thông tin trên đơn rồi <b>Phát hành lại</b>, hoặc <b>Bỏ</b> để làm
            tay ở MISA rồi tải lên.
          </p>
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
            <Button type="button" variant="destructive" size="sm" disabled={dang !== null} onClick={() => void chay("bo")}>
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
