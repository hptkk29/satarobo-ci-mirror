"use client";

// Màn quản trị pháp nhân: bảng pháp nhân (thêm · sửa · ngừng/mở lại · xoá), khối "Đơn vị đang gắn", và lịch sử thay đổi.
// Luật + audit ở server (`lib/org/legal-entity-admin.ts`); ở đây chỉ gom đầu vào và nói THẬT vì sao nút tắt (số đơn vị / hoá đơn đang dựa vào).
// Mọi thay đổi đổi/ngừng/xoá/gắn đều đòi LÝ DO (≥10 ký tự) — server kiểm lại.

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/admin/ui/status-pill";
import type { MucLichSuPhapNhan } from "@/lib/org/legal-entity-admin";
import { doiTrangThaiPhapNhanAction, ganPhapNhanChoDonViAction, suaPhapNhanAction, taoPhapNhanAction, xoaPhapNhanAction } from "../_actions";

const TOI_THIEU_LY_DO = 10;

export type DongPhapNhanUi = {
  id: string;
  taxCode: string;
  legalName: string;
  address: string | null;
  isPrimary: boolean;
  isActive: boolean;
  daXoa: boolean;
  tacDong: { donVi: number; hoaDon: number; cauHinhHoaDon: number };
};
export type DonViUi = { id: string; code: string; name: string; type: string; legalEntityId: string | null };

const TEN_HANH_DONG: Record<string, string> = {
  TAO_PHAP_NHAN: "Thêm pháp nhân",
  SUA_PHAP_NHAN: "Sửa pháp nhân",
  NGUNG_PHAP_NHAN: "Ngừng pháp nhân",
  MO_LAI_PHAP_NHAN: "Mở lại pháp nhân",
  XOA_PHAP_NHAN: "Xoá pháp nhân",
  GAN_PHAP_NHAN_CHO_DON_VI: "Gắn pháp nhân cho đơn vị",
};
const ddmmyyyyHhmm = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

type Nhap =
  | { loai: "TAO"; taxCode: string; legalName: string; address: string }
  | { loai: "SUA"; id: string; taxCode: string; legalName: string; address: string; khoaMst: boolean; lyDo: string }
  | { loai: "NGUNG" | "MO_LAI" | "XOA"; id: string; ten: string; lyDo: string };

export function QuanLyPhapNhan({ danhSach, donVi, lichSu }: { danhSach: DongPhapNhanUi[]; donVi: DonViUi[]; lichSu: MucLichSuPhapNhan[] }) {
  const router = useRouter();
  const id = useId();
  const [dangLuu, startTransition] = useTransition();
  const [nhap, setNhap] = useState<Nhap | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  // `hienTaiId` = pháp nhân đơn vị ĐANG gắn lúc mở form ("" = chưa gắn); `legalEntityId` = giá trị ĐANG CHỌN trong ô. Hai thứ tách riêng
  // để (a) ô chọn luôn khớp state, (b) biết người dùng đã đổi gì chưa — mở form KHÔNG được tự đổi liên kết.
  const [gan, setGan] = useState<{ orgUnitId: string; legalEntityId: string; hienTaiId: string; lyDo: string } | null>(null);
  const [loiGan, setLoiGan] = useState<string | null>(null);
  const dongPn = (pid: string | null) => (pid ? danhSach.find((p) => p.id === pid) : undefined);
  const tenPn = (pid: string | null) => (pid ? (dongPn(pid)?.legalName ?? "—") : "Chưa gắn");
  const dungDuoc = danhSach.filter((p) => p.isActive && !p.daXoa);
  /** Pháp nhân đang gắn mà KHÔNG còn dùng được ⇒ chữ nói rõ vì sao; còn dùng được (hoặc chưa gắn) ⇒ null. */
  const lyDoHetHan = (pid: string | null): string | null => {
    if (!pid) return null;
    const p = dongPn(pid);
    if (!p) return "không xác định được";
    return p.daXoa ? "đã xoá" : !p.isActive ? "đã ngừng" : null;
  };

  function xong(thongBao: string) {
    toast.success(thongBao);
    setNhap(null);
    setGan(null);
    startTransition(() => router.refresh());
  }

  function luu() {
    if (!nhap) return;
    setLoi(null);
    startTransition(async () => {
      const r =
        nhap.loai === "TAO"
          ? await taoPhapNhanAction({ taxCode: nhap.taxCode, legalName: nhap.legalName, address: nhap.address || null })
          : nhap.loai === "SUA"
            ? await suaPhapNhanAction({ id: nhap.id, taxCode: nhap.khoaMst ? undefined : nhap.taxCode, legalName: nhap.legalName, address: nhap.address || null, lyDo: nhap.lyDo })
            : nhap.loai === "XOA"
              ? await xoaPhapNhanAction({ id: nhap.id, lyDo: nhap.lyDo })
              : await doiTrangThaiPhapNhanAction({ id: nhap.id, hanhDong: nhap.loai, lyDo: nhap.lyDo });
      if (!r.ok) return setLoi(r.error);
      xong("Đã lưu");
    });
  }

  function luuGan() {
    if (!gan || gan.legalEntityId === gan.hienTaiId) return; // chưa đổi gì ⇒ không gửi (server cũng từ chối "đã gắn đúng pháp nhân này")
    setLoiGan(null);
    startTransition(async () => {
      const r = await ganPhapNhanChoDonViAction({ orgUnitId: gan.orgUnitId, legalEntityId: gan.legalEntityId === "" ? null : gan.legalEntityId, lyDo: gan.lyDo });
      if (!r.ok) return setLoiGan(r.error);
      xong("Đã gắn pháp nhân cho đơn vị");
    });
  }

  const hienTaiHetHan = gan ? lyDoHetHan(gan.hienTaiId || null) : null;
  const ganChuaDoi = gan ? gan.legalEntityId === gan.hienTaiId : false;
  const canLyDo = nhap && nhap.loai !== "TAO";
  const lyDoDu = !canLyDo || nhap.lyDo.trim().length >= TOI_THIEU_LY_DO;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Pháp nhân</h2>
          <Button type="button" onClick={() => { setLoi(null); setNhap({ loai: "TAO", taxCode: "", legalName: "", address: "" }); }} disabled={nhap !== null}>
            Thêm pháp nhân
          </Button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Pháp nhân</th>
                <th className="px-3 py-2 font-medium">MST</th>
                <th className="px-3 py-2 font-medium">Trạng thái</th>
                <th className="px-3 py-2 font-medium">Đang dựa vào</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {danhSach.map((p) => (
                <tr key={p.id} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium">{p.legalName}</div>
                    {p.address ? <div className="text-xs text-muted-foreground">{p.address}</div> : null}
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums">{p.taxCode}</td>
                  <td className="px-3 py-2">
                    {p.daXoa ? <StatusPill tone="muted">Đã xoá</StatusPill> : p.isActive ? <StatusPill tone="success">Hoạt động</StatusPill> : <StatusPill tone="muted">Ngừng</StatusPill>}
                    {p.isPrimary ? <span className="ml-1 text-xs text-muted-foreground">· gốc</span> : null}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {p.tacDong.donVi} đơn vị · {p.tacDong.hoaDon} hoá đơn · {p.tacDong.cauHinhHoaDon} dòng cấu hình hoá đơn
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {p.daXoa || !p.isActive ? (
                        <Button type="button" variant="outline" size="sm" disabled={nhap !== null} onClick={() => { setLoi(null); setNhap({ loai: "MO_LAI", id: p.id, ten: p.legalName, lyDo: "" }); }}>
                          Mở lại
                        </Button>
                      ) : (
                        <>
                          <Button type="button" variant="outline" size="sm" disabled={nhap !== null} onClick={() => { setLoi(null); setNhap({ loai: "SUA", id: p.id, taxCode: p.taxCode, legalName: p.legalName, address: p.address ?? "", khoaMst: p.tacDong.hoaDon > 0 || p.tacDong.cauHinhHoaDon > 0, lyDo: "" }); }}>
                            Sửa
                          </Button>
                          {p.isPrimary ? null : (
                            <>
                              <Button type="button" variant="outline" size="sm" disabled={nhap !== null} onClick={() => { setLoi(null); setNhap({ loai: "NGUNG", id: p.id, ten: p.legalName, lyDo: "" }); }}>
                                Ngừng
                              </Button>
                              <Button type="button" variant="outline" size="sm" disabled={nhap !== null || p.tacDong.donVi > 0} title={p.tacDong.donVi > 0 ? `Còn ${p.tacDong.donVi} đơn vị đang gắn — gắn đơn vị đó sang pháp nhân khác trước` : undefined} onClick={() => { setLoi(null); setNhap({ loai: "XOA", id: p.id, ten: p.legalName, lyDo: "" }); }}>
                                Xoá
                              </Button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          MST khoá khi đã có hoá đơn hoặc dòng cấu hình hoá đơn dựa vào (đổi MST là đổi danh tính pháp lý): nhập sai thì ngừng pháp nhân và thêm cái mới. Đổi quan hệ cơ sở–pháp nhân KHÔNG sửa hoá đơn đã lưu — mỗi hoá đơn tự giữ pháp nhân lúc phát hành.
        </p>
      </section>

      {nhap ? (
        <form
          className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            luu();
          }}
        >
          <h3 className="text-base font-semibold">
            {nhap.loai === "TAO" ? "Thêm pháp nhân" : nhap.loai === "SUA" ? "Sửa pháp nhân" : nhap.loai === "NGUNG" ? `Ngừng "${nhap.ten}"` : nhap.loai === "MO_LAI" ? `Mở lại "${nhap.ten}"` : `Xoá "${nhap.ten}"`}
          </h3>
          {nhap.loai === "TAO" || nhap.loai === "SUA" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor={`${id}-ten`}>Tên pháp nhân</Label>
                <Input id={`${id}-ten`} className="mt-1.5" value={nhap.legalName} disabled={dangLuu} onChange={(e) => setNhap({ ...nhap, legalName: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`${id}-mst`}>Mã số thuế</Label>
                <Input id={`${id}-mst`} className="mt-1.5 font-mono tabular-nums" inputMode="numeric" value={nhap.taxCode} disabled={dangLuu || (nhap.loai === "SUA" && nhap.khoaMst)} onChange={(e) => setNhap({ ...nhap, taxCode: e.target.value })} />
                {nhap.loai === "SUA" && nhap.khoaMst ? <p className="mt-1 text-xs text-state-warning-ink">MST đã khoá: có hoá đơn hoặc cấu hình hoá đơn dựa vào.</p> : null}
              </div>
              <div>
                <Label htmlFor={`${id}-dc`}>Địa chỉ</Label>
                <Input id={`${id}-dc`} className="mt-1.5" value={nhap.address} disabled={dangLuu} onChange={(e) => setNhap({ ...nhap, address: e.target.value })} />
              </div>
            </div>
          ) : null}
          {nhap.loai !== "TAO" ? (
            <div>
              <Label htmlFor={`${id}-ly`}>Lý do (bắt buộc, ghi vào lịch sử)</Label>
              <Input id={`${id}-ly`} className="mt-1.5" value={nhap.lyDo} disabled={dangLuu} onChange={(e) => setNhap({ ...nhap, lyDo: e.target.value })} />
              <p className="mt-1 text-xs text-muted-foreground">Tối thiểu {TOI_THIEU_LY_DO} ký tự · đang có {nhap.lyDo.trim().length}</p>
            </div>
          ) : null}
          {loi ? (
            <p role="alert" className="text-sm text-state-danger-ink">
              {loi}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={dangLuu || !lyDoDu}>
              Lưu
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={dangLuu} onClick={() => setNhap(null)}>
              Huỷ
            </Button>
          </div>
        </form>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Đơn vị đang gắn</h2>
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Đơn vị</th>
                <th className="px-3 py-2 font-medium">Pháp nhân hiện tại</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {donVi.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs font-bold">{u.code}</span> <span className="ml-1">{u.name}</span>
                  </td>
                  <td className="px-3 py-2">
                    {tenPn(u.legalEntityId)}
                    {lyDoHetHan(u.legalEntityId) ? <span className="ml-1.5 text-xs text-state-warning-ink">({lyDoHetHan(u.legalEntityId)} — không còn hợp lệ)</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button type="button" variant="outline" size="sm" disabled={gan !== null} onClick={() => { setLoiGan(null); setGan({ orgUnitId: u.id, legalEntityId: u.legalEntityId ?? "", hienTaiId: u.legalEntityId ?? "", lyDo: "" }); }}>
                      Đổi
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {gan ? (
          <form
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
            onSubmit={(e) => {
              e.preventDefault();
              luuGan();
            }}
          >
            <h3 className="text-base font-semibold">Đổi pháp nhân của {donVi.find((u) => u.id === gan.orgUnitId)?.code}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor={`${id}-gpn`}>Pháp nhân</Label>
                <select id={`${id}-gpn`} className="mt-1.5 h-9 w-full rounded-lg border border-border bg-card px-2.5 text-sm" value={gan.legalEntityId} disabled={dangLuu} onChange={(e) => setGan({ ...gan, legalEntityId: e.target.value })}>
                  <option value="">(Gỡ — chưa gắn pháp nhân)</option>
                  {/* Pháp nhân đang gắn nhưng hết hạn dùng: vẫn HIỆN (được chọn sẵn, đúng với state) nhưng KHOÁ — không chọn lại được sau khi rời. */}
                  {hienTaiHetHan && gan ? (
                    <option value={gan.hienTaiId} disabled>
                      {dongPn(gan.hienTaiId) ? `${dongPn(gan.hienTaiId)!.legalName} · MST ${dongPn(gan.hienTaiId)!.taxCode}` : "Pháp nhân không xác định"} — {hienTaiHetHan}, không còn hợp lệ
                    </option>
                  ) : null}
                  {dungDuoc.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.legalName} · MST {p.taxCode}
                    </option>
                  ))}
                </select>
                {hienTaiHetHan ? (
                  <p role="note" className="mt-1.5 text-xs text-state-warning-ink">
                    Pháp nhân đang gắn {hienTaiHetHan} nên không còn hợp lệ để phát hành hoá đơn. Mở form này không tự đổi gì — chọn pháp nhân khác hoặc “Gỡ” để bỏ liên kết.
                  </p>
                ) : null}
                {ganChuaDoi ? <p className="mt-1.5 text-xs text-muted-foreground">Chưa đổi gì — chọn pháp nhân khác hoặc “Gỡ” rồi mới Lưu được.</p> : null}
              </div>
              <div>
                <Label htmlFor={`${id}-gly`}>Lý do (bắt buộc)</Label>
                <Input id={`${id}-gly`} className="mt-1.5" value={gan.lyDo} disabled={dangLuu} onChange={(e) => setGan({ ...gan, lyDo: e.target.value })} />
                <p className="mt-1 text-xs text-muted-foreground">Tối thiểu {TOI_THIEU_LY_DO} ký tự · đang có {gan.lyDo.trim().length}</p>
              </div>
            </div>
            {loiGan ? (
              <p role="alert" className="text-sm text-state-danger-ink">
                {loiGan}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={dangLuu || ganChuaDoi || gan.lyDo.trim().length < TOI_THIEU_LY_DO}>
                Lưu
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={dangLuu} onClick={() => setGan(null)}>
                Huỷ
              </Button>
            </div>
          </form>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Lịch sử thay đổi</h2>
        {lichSu.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có thay đổi nào được ghi.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Lúc</th>
                  <th className="px-3 py-2 font-medium">Người làm</th>
                  <th className="px-3 py-2 font-medium">Việc</th>
                  <th className="px-3 py-2 font-medium">Đối tượng</th>
                  <th className="px-3 py-2 font-medium">Lý do</th>
                </tr>
              </thead>
              <tbody>
                {lichSu.map((m) => (
                  <tr key={m.id} className="border-t border-border align-top">
                    <td className="px-3 py-2 tabular-nums">{ddmmyyyyHhmm(m.luc)}</td>
                    <td className="px-3 py-2">{m.nguoi}</td>
                    <td className="px-3 py-2">{TEN_HANH_DONG[m.hanhDong] ?? m.hanhDong}</td>
                    <td className="px-3 py-2">{m.doiTuong}</td>
                    <td className="px-3 py-2 text-muted-foreground">{m.lyDo ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
