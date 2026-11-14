"use client";

// Bảng "Chứng từ ngân hàng" của MỘT cơ sở (P7-E). Mỗi dòng là một khoản thu kế toán đã ĐÁNH DẤU cần sao kê / ủy nhiệm chi.
// Nút nào hiện ra đọc từ `dong.nut` (server suy từ CHÍNH máy trạng thái mà action dùng) — nút và action không thể lệch nhau (luật 12).
// Mọi thao tác kiểm lại ở server (cờ → quyền → phạm vi cơ sở → trạng thái); bảng này không quyết định gì.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import { formatDateTimeVN } from "@/lib/format/date";
import { formatVnd } from "@/lib/utils";
import {
  NHAN_LOAI_CHUNG_TU_THIEU,
  NHAN_TRANG_THAI_CHUNG_TU,
  TOI_THIEU_LY_DO_CHUNG_TU,
  TRANG_THAI_CHUNG_TU,
  type TrangThaiChungTu,
} from "@/lib/finance/hoa-don/chung-tu-ngan-hang";
import type { DongChungTu, KhoanTimThay } from "@/lib/finance/hoa-don/chung-tu-ngan-hang-db";
import {
  danhDauCanChungTuAction,
  huyDanhDauChungTuAction,
  kiemTraChungTuAction,
  timKhoanTheoMaDonAction,
  yeuCauBoSungLaiChungTuAction,
} from "../_actions";
import { taiChungTuLen } from "./tai-tep-chung-tu";

const TONE: Record<TrangThaiChungTu, PillTone> = {
  CHO_BO_SUNG: "warning",
  DA_TAI_LEN: "info",
  DA_KIEM_TRA: "success",
  CAN_BO_SUNG_LAI: "danger",
};

const NHAN_KHOAN: Record<string, string> = { PENDING: "Chờ kế toán", CONFIRMED: "Đã xác nhận", REJECTED: "Đã từ chối", REFUNDED: "Đã hoàn" };

type FormMo = { paymentId: string; kieu: "BO_SUNG_LAI" | "HUY" | "KIEM_TRA" };

export function BangChungTuNganHang({
  coSoId,
  tenCoSo,
  dong,
  locTrangThai,
  khoOk,
}: {
  coSoId: string;
  tenCoSo: string;
  dong: DongChungTu[];
  locTrangThai: TrangThaiChungTu | null;
  khoOk: boolean;
}) {
  const router = useRouter();
  const [dangChay, startTransition] = useTransition();
  const [loc, setLoc] = useState<TrangThaiChungTu | null>(locTrangThai);
  const [formMo, setFormMo] = useState<FormMo | null>(null);
  const [lyDo, setLyDo] = useState("");
  const [pct, setPct] = useState<Record<string, number>>({});
  const tepRef = useRef<HTMLInputElement>(null);
  const dangChonTep = useRef<string | null>(null);

  // Tìm khoản để đánh dấu
  const [maDon, setMaDon] = useState("");
  const [ketQuaTim, setKetQuaTim] = useState<{ maDon: string; khoan: KhoanTimThay[] } | null | undefined>(undefined);
  const [lyDoDanhDau, setLyDoDanhDau] = useState("");

  const dem = (t: TrangThaiChungTu) => dong.filter((d) => d.trangThai === t).length;
  const hienThi = loc ? dong.filter((d) => d.trangThai === loc) : dong;

  function chay(f: () => Promise<{ ok: true } | { ok: false; error: string }>, thanhCong: string) {
    startTransition(async () => {
      const r = await f();
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(thanhCong);
      setFormMo(null);
      setLyDo("");
      router.refresh();
    });
  }

  function tim() {
    startTransition(async () => {
      const r = await timKhoanTheoMaDonAction({ coSoId, maDon });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setKetQuaTim(r.data);
    });
  }

  async function chonTep(file: File | undefined) {
    const paymentId = dangChonTep.current;
    if (tepRef.current) tepRef.current.value = "";
    if (!file || !paymentId) return;
    setPct((p) => ({ ...p, [paymentId]: 0 }));
    try {
      await taiChungTuLen({ paymentId, file, ghiChu: "", onPct: (n) => setPct((p) => ({ ...p, [paymentId]: n })) });
      toast.success("Đã tải chứng từ lên — chờ kiểm tra");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Tải chứng từ không thành công");
    } finally {
      setPct((p) => {
        const { [paymentId]: _bo, ...con } = p;
        return con;
      });
    }
  }

  const lyDoDu = lyDo.trim().length >= TOI_THIEU_LY_DO_CHUNG_TU;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Cơ sở: <span className="font-medium text-foreground">{tenCoSo}</span> · Loại chứng từ theo dõi: {NHAN_LOAI_CHUNG_TU_THIEU}
      </p>

      <section aria-label="Thêm khoản cần chứng từ" className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Thêm khoản cần bổ sung chứng từ</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Nhập mã đơn để chọn khoản. Khoản nguồn «nhập lịch sử» và khoản đang chờ kế toán đều đánh dấu được. Đánh dấu KHÔNG xác nhận khoản thu.
        </p>
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            tim();
          }}
        >
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Mã đơn</span>
            <Input value={maDon} onChange={(e) => setMaDon(e.target.value)} placeholder="ORD-261004-000007" className="h-9 w-64" aria-label="Mã đơn" />
          </label>
          <Button type="submit" size="sm" disabled={dangChay || maDon.trim().length < 3}>
            Tìm khoản
          </Button>
        </form>
        {ketQuaTim === null ? <p className="mt-3 text-sm text-muted-foreground">Không tìm thấy đơn này trong cơ sở đang làm việc.</p> : null}
        {ketQuaTim ? (
          <div className="mt-3 space-y-2">
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">Lý do cần chứng từ (ít nhất {TOI_THIEU_LY_DO_CHUNG_TU} ký tự)</span>
              <Input value={lyDoDanhDau} onChange={(e) => setLyDoDanhDau(e.target.value)} className="h-9" aria-label="Lý do cần chứng từ" />
            </label>
            {ketQuaTim.khoan.length === 0 ? <p className="text-sm text-muted-foreground">Đơn {ketQuaTim.maDon} chưa có khoản thu nào.</p> : null}
            <ul className="divide-y divide-border rounded-lg border border-border">
              {ketQuaTim.khoan.map((k) => (
                <li key={k.paymentId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium">{formatVnd(k.soTien)}</span> · {formatDateTimeVN(k.ngayThu)} · {NHAN_KHOAN[k.trangThaiKhoan] ?? k.trangThaiKhoan}
                    {k.nhapLichSu ? <StatusPill tone="muted" className="ml-2">Nhập lịch sử</StatusPill> : null}
                    <span className="ml-2 text-xs text-muted-foreground">…{k.paymentId.slice(-8)}</span>
                  </span>
                  {k.lyDoKhong ? (
                    <span className="text-xs text-muted-foreground">{k.lyDoKhong}</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={dangChay || lyDoDanhDau.trim().length < TOI_THIEU_LY_DO_CHUNG_TU}
                      onClick={() =>
                        chay(async () => {
                          const r = await danhDauCanChungTuAction({ paymentId: k.paymentId, lyDo: lyDoDanhDau });
                          if (r.ok) {
                            setKetQuaTim(undefined);
                            setLyDoDanhDau("");
                            setMaDon("");
                          }
                          return r;
                        }, "Đã đánh dấu khoản cần chứng từ")
                      }
                    >
                      Đánh dấu cần chứng từ
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section aria-label="Danh sách chứng từ">
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Lọc theo trạng thái">
          <Button size="sm" variant={loc === null ? "default" : "outline"} onClick={() => setLoc(null)}>
            Tất cả ({dong.length})
          </Button>
          {TRANG_THAI_CHUNG_TU.map((t) => (
            <Button key={t} size="sm" variant={loc === t ? "default" : "outline"} onClick={() => setLoc(t)}>
              {NHAN_TRANG_THAI_CHUNG_TU[t]} ({dem(t)})
            </Button>
          ))}
        </div>

        {!khoOk ? (
          <p className="mb-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            Kho lưu chứng từ chưa được cấu hình — vẫn đánh dấu và theo dõi được, nhưng chưa tải tệp lên hay tải về được. Báo người vận hành.
          </p>
        ) : null}

        <input ref={tepRef} type="file" accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg" className="hidden" onChange={(e) => void chonTep(e.target.files?.[0])} />

        {hienThi.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            {dong.length === 0 ? "Chưa có khoản nào được đánh dấu cần chứng từ ở cơ sở này." : "Không có hồ sơ nào ở trạng thái này."}
          </p>
        ) : (
          <PhanTrangBang tenDonVi="hồ sơ">
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[1100px] text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Đơn · Khoản thu</th>
                    <th className="px-3 py-2">Học viên / phụ huynh</th>
                    <th className="px-3 py-2 text-right">Số tiền</th>
                    <th className="px-3 py-2">Ngày thu</th>
                    <th className="px-3 py-2">Khoản · Hoá đơn</th>
                    <th className="px-3 py-2">Chứng từ thiếu</th>
                    <th className="px-3 py-2">Trạng thái</th>
                    <th className="px-3 py-2">Đánh dấu · Tải lên</th>
                    <th className="px-3 py-2">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {hienThi.map((d) => {
                    const dangMo = formMo?.paymentId === d.paymentId ? formMo : null;
                    return (
                      <tr key={d.id} className="border-t border-border align-top">
                        <td className="px-3 py-2">
                          <div className="font-medium">{d.maDon}</div>
                          <div className="text-xs text-muted-foreground">…{d.paymentId.slice(-8)}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div>{d.hocVien ?? "—"}</div>
                          {d.phuHuynh ? <div className="text-xs text-muted-foreground">PH: {d.phuHuynh}</div> : null}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatVnd(d.soTien)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{formatDateTimeVN(d.ngayThu)}</td>
                        <td className="px-3 py-2">
                          <div>{NHAN_KHOAN[d.trangThaiKhoan] ?? d.trangThaiKhoan}</div>
                          {d.nhapLichSu ? <div className="text-xs text-muted-foreground">Nhập lịch sử</div> : null}
                          <div className="text-xs text-muted-foreground">{d.hoaDon ? `HĐ ${d.hoaDon}` : "Chưa có hoá đơn"}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div>{NHAN_LOAI_CHUNG_TU_THIEU}</div>
                          <div className="max-w-[220px] text-xs text-muted-foreground">{d.lyDoDanhDau}</div>
                        </td>
                        <td className="px-3 py-2">
                          <StatusPill tone={TONE[d.trangThai]}>{NHAN_TRANG_THAI_CHUNG_TU[d.trangThai]}</StatusPill>
                          {d.trangThai === "CAN_BO_SUNG_LAI" && d.canBoSungLyDo ? <div className="mt-1 max-w-[220px] text-xs text-muted-foreground">{d.canBoSungLyDo}</div> : null}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <div>
                            {d.nguoiDanhDau} · {formatDateTimeVN(d.danhDauLuc)}
                          </div>
                          {d.tepTen ? (
                            <div className="mt-1 text-muted-foreground">
                              {d.tepTen}
                              {d.nguoiTaiLen ? ` · ${d.nguoiTaiLen}` : ""}
                              {d.taiLenLuc ? ` · ${formatDateTimeVN(d.taiLenLuc)}` : ""}
                            </div>
                          ) : null}
                          {d.nguoiKiemTra && d.kiemTraLuc ? (
                            <div className="text-muted-foreground">
                              Kiểm tra: {d.nguoiKiemTra} · {formatDateTimeVN(d.kiemTraLuc)}
                            </div>
                          ) : null}
                          {d.ghiChu ? <div className="text-muted-foreground">Ghi chú: {d.ghiChu}</div> : null}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1.5">
                            {d.nut.taiLen && khoOk ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={dangChay || pct[d.paymentId] !== undefined}
                                onClick={() => {
                                  dangChonTep.current = d.paymentId;
                                  tepRef.current?.click();
                                }}
                              >
                                {pct[d.paymentId] !== undefined ? `Đang tải ${pct[d.paymentId]}%` : d.tepTen ? "Thay tệp" : "Tải chứng từ lên"}
                              </Button>
                            ) : null}
                            {d.nut.taiVe && khoOk ? (
                              <a href={`/payments/hoa-don/chung-tu-ngan-hang/${d.id}/tai-ve`} className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium hover:bg-muted/50">
                                Tải về
                              </a>
                            ) : null}
                            {d.nut.kiemTra ? (
                              <Button size="sm" variant="outline" disabled={dangChay} onClick={() => setFormMo({ paymentId: d.paymentId, kieu: "KIEM_TRA" })}>
                                Đã kiểm tra
                              </Button>
                            ) : null}
                            {d.nut.yeuCauBoSungLai ? (
                              <Button size="sm" variant="outline" disabled={dangChay} onClick={() => setFormMo({ paymentId: d.paymentId, kieu: "BO_SUNG_LAI" })}>
                                Cần bổ sung lại
                              </Button>
                            ) : null}
                            {d.nut.huyDanhDau ? (
                              <Button size="sm" variant="ghost" disabled={dangChay} onClick={() => setFormMo({ paymentId: d.paymentId, kieu: "HUY" })}>
                                Huỷ đánh dấu
                              </Button>
                            ) : null}
                          </div>
                          {dangMo ? (
                            <div className="mt-2 space-y-1.5">
                              <Input
                                value={lyDo}
                                onChange={(e) => setLyDo(e.target.value)}
                                className="h-8"
                                aria-label={dangMo.kieu === "KIEM_TRA" ? "Ghi chú kiểm tra" : "Lý do"}
                                placeholder={dangMo.kieu === "KIEM_TRA" ? "Ghi chú (không bắt buộc)" : `Lý do (ít nhất ${TOI_THIEU_LY_DO_CHUNG_TU} ký tự)`}
                              />
                              <div className="flex gap-1.5">
                                <Button
                                  size="sm"
                                  disabled={dangChay || (dangMo.kieu !== "KIEM_TRA" && !lyDoDu)}
                                  onClick={() => {
                                    if (dangMo.kieu === "KIEM_TRA") chay(() => kiemTraChungTuAction({ paymentId: d.paymentId, ghiChu: lyDo }), "Đã ghi nhận kiểm tra chứng từ");
                                    else if (dangMo.kieu === "BO_SUNG_LAI") chay(() => yeuCauBoSungLaiChungTuAction({ paymentId: d.paymentId, lyDo }), "Đã yêu cầu bổ sung lại");
                                    else chay(() => huyDanhDauChungTuAction({ paymentId: d.paymentId, lyDo }), "Đã huỷ đánh dấu");
                                  }}
                                >
                                  Xác nhận
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => { setFormMo(null); setLyDo(""); }}>
                                  Bỏ qua
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </PhanTrangBang>
        )}
      </section>
    </div>
  );
}
