"use client";

// Khu «Ký USB token» (hub/13): hoá đơn của pháp nhân ký USB đang chờ ký + máy ký đã ghép. Luật ở máy chủ (`_ky-usb-actions.ts`, `ky-usb-lenh.ts`); màn chỉ hiện nút khi bấm được
// và nói rõ vì sao khi không (luật 12). Mã ghép máy hiện ĐÚNG MỘT LẦN rồi biến mất khỏi trạng thái.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import type { DongChoKyUsb, TrangThaiLenhHienThi } from "@/lib/finance/hoa-don/ky-usb/hang-cho-ky-usb";
import type { DongMayKy } from "@/lib/finance/hoa-don/ky-usb/may-ky";
import { huyLenhKyUsbAction, kiemTraLaiKyUsbAction, kyLoUsbAction, taoLenhKyUsbAction, taoMaGhepMayKyAction, thuHoiMayKyAction } from "../_ky-usb-actions";

const tien = (n: number) => `${n.toLocaleString("vi-VN")}đ`;
const gio = (iso: string) => new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

const NHAN_LENH: Record<TrangThaiLenhHienThi | "CHUA_CO_LENH", { nhan: string; tone: PillTone }> = {
  CHUA_CO_LENH: { nhan: "Chưa có lệnh ký", tone: "muted" },
  CHO_KY: { nhan: "Chờ ký", tone: "info" },
  DANG_KY: { nhan: "Đang ký (chờ ứng dụng ký)", tone: "warning" },
  LOI_KY: { nhan: "Lỗi ký", tone: "danger" },
  HET_HAN: { nhan: "Lệnh hết hạn", tone: "muted" },
  HUY: { nhan: "Đã huỷ", tone: "muted" },
  DA_KY: { nhan: "Đã ký", tone: "success" },
};
const NHAN_MAY: Record<DongMayKy["trangThai"], { nhan: string; tone: PillTone }> = {
  CHO_GHEP: { nhan: "Chờ nhập mã", tone: "info" },
  DANG_DUNG: { nhan: "Đang dùng", tone: "success" },
  HET_HAN: { nhan: "Hết hạn", tone: "muted" },
  DA_THU_HOI: { nhan: "Đã thu hồi", tone: "muted" },
};

/** Lệnh còn sống (CHO_KY / DANG_KY) ⇒ không tạo thêm lệnh. Các trạng thái cuối (lỗi, hết hạn, huỷ) ⇒ tạo lệnh MỚI được. */
export const coTheTaoLenh = (d: DongChoKyUsb): boolean => d.lenh === null || !["CHO_KY", "DANG_KY"].includes(d.lenh.trangThai);
export const coTheKy = (d: DongChoKyUsb): boolean => d.lenh?.trangThai === "CHO_KY";

export function KyUsbHangCho({ dong, may, nguoiXemId }: { dong: DongChoKyUsb[]; may: DongMayKy[]; nguoiXemId: string }) {
  const router = useRouter();
  const [dangLam, startTransition] = useTransition();
  const [chon, setChon] = useState<ReadonlySet<string>>(new Set());
  const [tenMay, setTenMay] = useState("");
  const [maMoi, setMaMoi] = useState<{ ma: string; hetHan: string } | null>(null);
  const [tomTat, setTomTat] = useState<string[]>([]);
  const [huyId, setHuyId] = useState<string | null>(null);
  const [lyDoHuy, setLyDoHuy] = useState("");

  const dongDaChon = dong.filter((d) => chon.has(d.hoaDonId));
  const choTao = dongDaChon.filter(coTheTaoLenh);
  const choKy = dongDaChon.filter(coTheKy);
  const toggle = (id: string) => setChon((c) => (c.has(id) ? new Set([...c].filter((x) => x !== id)) : new Set([...c, id])));

  function chay(viec: () => Promise<{ ok: true; data: { thanhCong: number; loi: { id: string; error: string | null }[] } } | { ok: false; error: string }>, thanhCongCau: (n: number) => string) {
    startTransition(async () => {
      const r = await viec();
      if (!r.ok) {
        setTomTat([r.error]);
        toast.error(r.error);
        return;
      }
      setTomTat(r.data.loi.map((l) => l.error ?? "Lỗi không rõ"));
      if (r.data.thanhCong > 0) toast.success(thanhCongCau(r.data.thanhCong));
      if (r.data.loi.length > 0) toast.error(`${r.data.loi.length} mục không làm được — xem chi tiết bên dưới`);
      setChon(new Set());
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Hoá đơn của pháp nhân <b>ký bằng USB token</b>. Quy trình: <b>Tạo lệnh ký</b> → người ký bấm <b>Ký</b> (nhận ký) → ứng dụng ký trên máy Windows có cắm token lấy từng lệnh, hỏi PIN và ký. Người ký phải
        <b> khác</b> người tạo lệnh (luật tách nhiệm vụ).
      </p>

      <section aria-label="Máy ký" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">Máy ký của tôi</h3>
        {may.length === 0 ? <p className="text-sm text-muted-foreground">Chưa ghép máy nào. Ghép máy để ứng dụng ký trên máy Windows lấy được việc của bạn.</p> : null}
        <ul className="flex flex-col divide-y divide-border text-sm">
          {may.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="font-medium">{m.tenMay}</span>
              <StatusPill tone={NHAN_MAY[m.trangThai].tone}>{NHAN_MAY[m.trangThai].nhan}</StatusPill>
              {m.lanDungCuoi ? <span className="text-xs text-muted-foreground">dùng lần cuối {gio(m.lanDungCuoi)}</span> : null}
              {m.trangThai === "CHO_GHEP" || m.trangThai === "DANG_DUNG" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  disabled={dangLam}
                  onClick={() =>
                    startTransition(async () => {
                      const r = await thuHoiMayKyAction({ mayId: m.id });
                      if (!r.ok) toast.error(r.error);
                      else toast.success("Đã thu hồi máy");
                      router.refresh();
                    })
                  }
                >
                  Thu hồi
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const r = await taoMaGhepMayKyAction({ tenMay });
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              setMaMoi(r.data);
              setTenMay("");
              router.refresh();
            });
          }}
        >
          <div>
            <Label htmlFor="ky-usb-ten-may">Tên máy (để bạn nhận ra)</Label>
            <Input id="ky-usb-ten-may" className="mt-1.5 w-64" value={tenMay} maxLength={60} placeholder="Ví dụ: Máy kế toán bàn 2" disabled={dangLam} onChange={(e) => setTenMay(e.target.value)} />
          </div>
          <Button type="submit" size="sm" disabled={dangLam || tenMay.trim() === ""}>
            Ghép máy mới
          </Button>
        </form>
        {maMoi ? (
          <div role="status" className="rounded-lg border border-[color:var(--state-warning)] bg-[color:var(--state-warning-soft)] p-3 text-sm">
            <p>
              Nhập mã này vào ứng dụng ký trước <b>{gio(maMoi.hetHan)}</b>. Mã chỉ hiện <b>một lần</b> và chỉ dùng được <b>một lần</b>:
            </p>
            <p className="my-2 select-all font-mono text-2xl tracking-widest" aria-label="Mã ghép máy">
              {maMoi.ma}
            </p>
            <Button type="button" size="sm" variant="outline" onClick={() => setMaMoi(null)}>
              Đã nhập xong, ẩn mã
            </Button>
          </div>
        ) : null}
      </section>

      <section aria-label="Hoá đơn chờ ký USB" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Hoá đơn chờ ký ({dong.length})</h3>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={dangLam || choTao.length === 0} onClick={() => chay(() => taoLenhKyUsbAction({ hoaDonIds: choTao.map((d) => d.hoaDonId) }), (n) => `Đã tạo ${n} lệnh ký`)}>
              Tạo lệnh ký ({choTao.length})
            </Button>
            <Button type="button" size="sm" disabled={dangLam || choKy.length === 0} onClick={() => chay(() => kyLoUsbAction({ lenhIds: choKy.map((d) => d.lenh!.id) }), (n) => `Đã nhận ký ${n} lệnh — mở ứng dụng ký để ký`)}>
              Ký lô ({choKy.length})
            </Button>
          </div>
        </div>
        {tomTat.length > 0 ? (
          <ul role="alert" className="list-disc rounded-lg border border-[color:var(--state-danger)] bg-[color:var(--state-danger-soft)] py-2 pl-7 pr-3 text-sm text-[color:var(--state-danger)]">
            {[...new Set(tomTat)].map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        ) : null}
        {dong.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card px-4 py-6 text-sm text-muted-foreground">Không có hoá đơn nào của pháp nhân ký USB đang chờ ký.</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="w-8 px-3 py-2" />
                  <th className="px-3 py-2 font-medium">Người mua</th>
                  <th className="px-3 py-2 font-medium">Pháp nhân</th>
                  <th className="px-3 py-2 text-right font-medium">Số tiền</th>
                  <th className="px-3 py-2 font-medium">Lệnh ký</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {dong.map((d) => {
                  const nhan = NHAN_LENH[d.lenh?.trangThai ?? "CHUA_CO_LENH"];
                  const duocChon = coTheTaoLenh(d) || coTheKy(d);
                  return (
                    <tr key={d.hoaDonId} className="border-t border-border align-top">
                      <td className="px-3 py-2">
                        <input type="checkbox" aria-label={`Chọn hoá đơn của ${d.nguoiMua || "khách"}`} disabled={dangLam || !duocChon} checked={chon.has(d.hoaDonId)} onChange={() => toggle(d.hoaDonId)} />
                      </td>
                      <td className="min-w-[8rem] px-3 py-2">{d.nguoiMua || "—"}</td>
                      <td className="max-w-[12rem] truncate px-3 py-2 text-muted-foreground" title={d.phapNhanTen}>
                        {d.phapNhanTen}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{tien(d.soTien)}</td>
                      <td className="px-3 py-2">
                        <StatusPill tone={nhan.tone}>{nhan.nhan}</StatusPill>
                        {d.lenh?.trangThai === "CHO_KY" && d.lenh.nguoiYeuCauId === nguoiXemId ? (
                          <p className="mt-1 text-xs text-muted-foreground">Bạn tạo lệnh này — cần một kế toán KHÁC bấm Ký.</p>
                        ) : null}
                        {d.lenh?.trangThai === "LOI_KY" && d.lenh.lyDo ? <p className="mt-1 text-xs text-[color:var(--state-danger)]">{d.lenh.lyDo}</p> : null}
                        {d.thongDiep ? <p className="mt-1 max-w-xs text-xs text-muted-foreground">{d.thongDiep}</p> : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {d.daGui ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={dangLam}
                            onClick={() =>
                              startTransition(async () => {
                                const r = await kiemTraLaiKyUsbAction({ hoaDonId: d.hoaDonId });
                                if (!r.ok) toast.error(r.error);
                                else toast.success("Đã tra cứu lại với nhà cung cấp");
                                router.refresh();
                              })
                            }
                          >
                            Kiểm tra lại
                          </Button>
                        ) : null}
                        {d.lenh?.trangThai === "CHO_KY" ? (
                          <Button type="button" variant="ghost" size="sm" disabled={dangLam} onClick={() => (setHuyId(d.lenh!.id), setLyDoHuy(""))}>
                            Huỷ lệnh
                          </Button>
                        ) : null}
                        {huyId === d.lenh?.id ? (
                          <form
                            className="mt-2 flex flex-col items-end gap-2"
                            onSubmit={(e) => {
                              e.preventDefault();
                              startTransition(async () => {
                                const r = await huyLenhKyUsbAction({ lenhId: d.lenh!.id, lyDo: lyDoHuy });
                                if (!r.ok) toast.error(r.error);
                                else toast.success("Đã huỷ lệnh");
                                setHuyId(null);
                                router.refresh();
                              });
                            }}
                          >
                            <Input aria-label="Lý do huỷ" value={lyDoHuy} maxLength={500} placeholder="Lý do huỷ (tối thiểu 10 ký tự)" disabled={dangLam} onChange={(e) => setLyDoHuy(e.target.value)} />
                            <div className="flex gap-2">
                              <Button type="submit" size="sm" disabled={dangLam || lyDoHuy.trim().length < 10}>
                                Xác nhận huỷ
                              </Button>
                              <Button type="button" size="sm" variant="outline" onClick={() => setHuyId(null)}>
                                Thôi
                              </Button>
                            </div>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
