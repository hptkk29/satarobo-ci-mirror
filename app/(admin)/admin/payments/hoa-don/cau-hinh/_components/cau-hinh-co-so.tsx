"use client";

// Màn "Cấu hình ký hiệu hoá đơn" của MỘT cơ sở (PR2): các dòng (pháp nhân · ký hiệu nguyên chuỗi · khoảng ngày hiệu
// lực), thêm / sửa / tắt, và lịch sử thay đổi. Luật kiểm nằm ở `lib/finance/hoa-don/cau-hinh-co-so.ts`; server kiểm lại.
// Thay đổi cấu hình KHÔNG sửa hoá đơn đã lưu — hoá đơn chụp riêng pháp nhân + ký hiệu của nó.

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { kiemCauHinhCoSo } from "@/lib/finance/hoa-don/cau-hinh-co-so";
import type { DongCauHinh, LichSuCauHinh } from "@/lib/finance/hoa-don/cau-hinh-co-so-db";
import { luuCauHinhHoaDonAction } from "../_actions";

type PhapNhanLua = { ma: string; ten: string; maSoThue: string; bat: boolean };

const ddmmyyyy = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const THU_VIEN_HANH_DONG: Record<string, string> = {
  TAO_CAU_HINH_HOA_DON: "Thêm",
  SUA_CAU_HINH_HOA_DON: "Sửa",
  TAT_CAU_HINH_HOA_DON: "Tắt",
};

type Nhap = {
  id?: string;
  phapNhanMa: string;
  kyHieu: string;
  hieuLucTu: string;
  hieuLucDen: string;
  dangBat: boolean;
  ghiChu: string;
  lyDo: string;
};

export function CauHinhCoSo({
  centerId,
  tenCoSo,
  dong,
  lichSu,
  phapNhan,
  namHienTai,
}: {
  centerId: string;
  tenCoSo: string;
  dong: DongCauHinh[];
  lichSu: LichSuCauHinh[];
  phapNhan: PhapNhanLua[];
  namHienTai: string;
}) {
  const router = useRouter();
  const [dangLuu, startTransition] = useTransition();
  const id = useId();
  const [nhap, setNhap] = useState<Nhap | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const tenPn = (ma: string) => phapNhan.find((p) => p.ma === ma)?.ten ?? ma;

  function moThem() {
    setLoi(null);
    setNhap({
      phapNhanMa: phapNhan.find((p) => p.bat)?.ma ?? "",
      kyHieu: "",
      hieuLucTu: `${namHienTai}-01-01`,
      hieuLucDen: `${namHienTai}-12-31`,
      dangBat: true,
      ghiChu: "",
      lyDo: "",
    });
  }
  function moSua(d: DongCauHinh, tat = false) {
    setLoi(null);
    setNhap({
      id: d.id,
      phapNhanMa: d.phapNhanMa,
      kyHieu: d.kyHieu,
      hieuLucTu: d.hieuLucTu,
      hieuLucDen: d.hieuLucDen,
      dangBat: tat ? false : d.dangBat,
      ghiChu: d.ghiChu ?? "",
      lyDo: "",
    });
  }

  function luu() {
    if (!nhap) return;
    const daCo = dong.filter((d) => d.id !== nhap.id);
    const l = kiemCauHinhCoSo({ centerId, ...nhap }, daCo, phapNhan);
    if (l.length > 0) return setLoi(l[0]!);
    setLoi(null);
    startTransition(async () => {
      const r = await luuCauHinhHoaDonAction({
        id: nhap.id,
        centerId,
        phapNhanMa: nhap.phapNhanMa,
        kyHieu: nhap.kyHieu,
        hieuLucTu: nhap.hieuLucTu,
        hieuLucDen: nhap.hieuLucDen,
        dangBat: nhap.dangBat,
        ghiChu: nhap.ghiChu || null,
        lyDo: nhap.lyDo || null,
      });
      if (!r.ok) return setLoi(r.error);
      toast.success(nhap.id ? "Đã cập nhật cấu hình" : "Đã thêm cấu hình");
      setNhap(null);
      router.refresh();
    });
  }

  const dangSua = Boolean(nhap?.id);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Cơ sở <span className="font-medium text-foreground">{tenCoSo}</span>. Mỗi dòng nói: vào khoảng ngày này, cơ sở phát hành hoá đơn bằng{" "}
          <span className="font-medium text-foreground">pháp nhân và ký hiệu</span> nào. Đổi cấu hình <b>không</b> sửa hoá đơn đã lưu.
        </p>
        <Button type="button" onClick={moThem} disabled={nhap !== null}>
          Thêm cấu hình
        </Button>
      </div>

      {dong.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-4 py-6 text-sm text-muted-foreground">
          Cơ sở này chưa khai cấu hình hoá đơn — màn đang dùng ký hiệu và pháp nhân MẶC ĐỊNH của hệ thống. Thêm cấu hình để ký hiệu điền sẵn đúng với thực tế.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Ký hiệu</th>
                <th className="px-3 py-2 font-medium">Pháp nhân</th>
                <th className="px-3 py-2 font-medium">Hiệu lực</th>
                <th className="px-3 py-2 font-medium">Trạng thái</th>
                <th className="px-3 py-2 font-medium">Ghi chú</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {dong.map((d) => (
                <tr key={d.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono tabular-nums">{d.kyHieu}</td>
                  <td className="px-3 py-2">{tenPn(d.phapNhanMa)}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {ddmmyyyy(d.hieuLucTu)} → {ddmmyyyy(d.hieuLucDen)}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill tone={d.dangBat ? "success" : "muted"}>{d.dangBat ? "Đang bật" : "Đã tắt"}</StatusPill>
                  </td>
                  <td className="max-w-[16rem] truncate px-3 py-2 text-muted-foreground">{d.ghiChu ?? ""}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <Button type="button" variant="ghost" size="sm" onClick={() => moSua(d)} disabled={nhap !== null}>
                      Sửa
                    </Button>
                    {d.dangBat ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => moSua(d, true)} disabled={nhap !== null}>
                        Tắt
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nhap ? (
        <form
          className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            luu();
          }}
        >
          <h2 className="text-base font-semibold">{dangSua ? (nhap.dangBat ? "Sửa cấu hình" : "Tắt cấu hình") : "Thêm cấu hình"}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={`${id}-pn`}>Pháp nhân phát hành</Label>
              <select
                id={`${id}-pn`}
                className="mt-1.5 h-9 w-full rounded-lg border border-border bg-card px-2.5 text-sm"
                value={nhap.phapNhanMa}
                disabled={dangLuu}
                onChange={(e) => setNhap({ ...nhap, phapNhanMa: e.target.value })}
              >
                {phapNhan.map((p) => (
                  <option key={p.ma} value={p.ma} disabled={!p.bat}>
                    {p.ten} · MST {p.maSoThue}
                    {p.bat ? "" : " (đang tắt)"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor={`${id}-kh`}>Ký hiệu (nguyên chuỗi)</Label>
              <Input
                id={`${id}-kh`}
                className="mt-1.5 uppercase tabular-nums"
                value={nhap.kyHieu}
                maxLength={10}
                placeholder="Ví dụ 1C26MAI"
                disabled={dangLuu}
                autoComplete="off"
                onChange={(e) => setNhap({ ...nhap, kyHieu: e.target.value.toUpperCase() })}
              />
            </div>
            <div>
              <Label htmlFor={`${id}-tu`}>Hiệu lực từ ngày</Label>
              <Input id={`${id}-tu`} type="date" className="mt-1.5" value={nhap.hieuLucTu} disabled={dangLuu} onChange={(e) => setNhap({ ...nhap, hieuLucTu: e.target.value })} />
            </div>
            <div>
              <Label htmlFor={`${id}-den`}>Đến hết ngày</Label>
              <Input id={`${id}-den`} type="date" className="mt-1.5" value={nhap.hieuLucDen} disabled={dangLuu} onChange={(e) => setNhap({ ...nhap, hieuLucDen: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor={`${id}-gc`}>Ghi chú</Label>
              <Input id={`${id}-gc`} className="mt-1.5" value={nhap.ghiChu} maxLength={300} disabled={dangLuu} onChange={(e) => setNhap({ ...nhap, ghiChu: e.target.value })} />
            </div>
            {dangSua ? (
              <div className="sm:col-span-2">
                <Label htmlFor={`${id}-ld`}>Lý do thay đổi (bắt buộc, ghi vào lịch sử)</Label>
                <Input id={`${id}-ld`} className="mt-1.5" value={nhap.lyDo} maxLength={300} disabled={dangLuu} onChange={(e) => setNhap({ ...nhap, lyDo: e.target.value })} />
              </div>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Một dòng chỉ trong <b>một năm</b> và ký hiệu mang hai số của năm đó. Sang năm mới: thêm dòng mới. Hai dòng đang bật của cùng cơ sở không được chồng ngày.
          </p>
          {loi ? (
            <p role="alert" className="text-sm text-state-danger-ink">
              {loi}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={dangLuu}>
              {dangLuu ? "Đang lưu…" : "Lưu"}
            </Button>
            <Button type="button" variant="outline" disabled={dangLuu} onClick={() => setNhap(null)}>
              Huỷ
            </Button>
          </div>
        </form>
      ) : null}

      <section aria-label="Lịch sử thay đổi" className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Lịch sử thay đổi</h2>
        {lichSu.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có thay đổi nào được ghi.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card text-sm">
            {lichSu.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
                <span className="font-medium">{THU_VIEN_HANH_DONG[h.hanhDong] ?? h.hanhDong}</span>
                <span className="tabular-nums text-muted-foreground">{new Date(h.luc).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</span>
                <span className="text-muted-foreground">{h.nguoiSua}</span>
                {h.lyDo ? <span className="w-full text-muted-foreground">Lý do: {h.lyDo}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
