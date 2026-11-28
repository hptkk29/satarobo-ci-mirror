"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { datHanMucAction, dieuChinhTonKhoAction, luuQuaAction, xuLyYeuCauAction } from "../_actions";

type HanhDong = "DUYET" | "TU_CHOI" | "HOAN_TAT";
const NHAN: Record<HanhDong, string> = { DUYET: "Duyệt", TU_CHOI: "Từ chối", HOAN_TAT: "Đã giao quà" };

/** Nút xử lý một yêu cầu. Từ chối bắt buộc nhập lý do; «Đã giao quà» TRỪ coin chính thức nên có bước xác nhận hai lần bấm. */
export function NutXuLy({ redemptionId, trangThai }: { redemptionId: string; trangThai: "REQUESTED" | "APPROVED" }) {
  const router = useRouter();
  const [dang, start] = useTransition();
  const [xacNhan, setXacNhan] = useState<HanhDong | null>(null);
  const [lyDo, setLyDo] = useState("");

  const chay = (hanhDong: HanhDong) =>
    start(async () => {
      const r = await xuLyYeuCauAction({ redemptionId, hanhDong, ghiChu: lyDo || undefined });
      if (r.ok) {
        toast.success(hanhDong === "TU_CHOI" ? "Đã từ chối và hoàn coin" : hanhDong === "HOAN_TAT" ? "Đã ghi nhận giao quà và trừ coin" : "Đã duyệt");
        setXacNhan(null);
        setLyDo("");
        router.refresh();
      } else toast.error(r.error);
    });

  const hanhDong: HanhDong[] = trangThai === "REQUESTED" ? ["DUYET", "TU_CHOI"] : ["HOAN_TAT", "TU_CHOI"];
  if (xacNhan) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {xacNhan === "TU_CHOI" ? <input value={lyDo} onChange={(e) => setLyDo(e.target.value)} placeholder="Lý do từ chối" aria-label="Lý do từ chối" className="h-8 rounded-md border border-border bg-background px-2 text-sm" /> : null}
        <Button size="sm" disabled={dang || (xacNhan === "TU_CHOI" && lyDo.trim().length < 3)} onClick={() => chay(xacNhan)}>
          {dang ? "Đang xử lý…" : `Xác nhận ${NHAN[xacNhan].toLowerCase()}`}
        </Button>
        <Button size="sm" variant="ghost" disabled={dang} onClick={() => setXacNhan(null)}>
          Huỷ
        </Button>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      {hanhDong.map((h) => (
        <Button key={h} size="sm" variant={h === "TU_CHOI" ? "outline" : "default"} onClick={() => (h === "DUYET" ? chay(h) : setXacNhan(h))} disabled={dang}>
          {NHAN[h]}
        </Button>
      ))}
    </div>
  );
}

const o = "h-9 rounded-md border border-border bg-background px-2 text-sm";

export function FormQua({ qua }: { qua?: { id: string; name: string; description: string | null; coinCost: number; isActive: boolean; sortOrder: number } }) {
  const router = useRouter();
  const [dang, start] = useTransition();
  const [name, setName] = useState(qua?.name ?? "");
  const [moTa, setMoTa] = useState(qua?.description ?? "");
  const [coin, setCoin] = useState(String(qua?.coinCost ?? ""));
  const [mo, setMo] = useState(qua?.isActive ?? true);
  const luu = () =>
    start(async () => {
      const r = await luuQuaAction({ id: qua?.id, name, description: moTa, coinCost: coin, isActive: mo, sortOrder: qua?.sortOrder ?? 0 });
      if (r.ok) {
        toast.success(qua ? "Đã lưu quà" : "Đã thêm quà");
        if (!qua) {
          setName("");
          setMoTa("");
          setCoin("");
        }
        router.refresh();
      } else toast.error(r.error);
    });
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs text-muted-foreground">
        Tên quà
        <input value={name} onChange={(e) => setName(e.target.value)} className={`${o} mt-1 block w-48`} />
      </label>
      <label className="text-xs text-muted-foreground">
        Mô tả
        <input value={moTa} onChange={(e) => setMoTa(e.target.value)} className={`${o} mt-1 block w-56`} />
      </label>
      <label className="text-xs text-muted-foreground">
        Giá (coin)
        <input type="number" min={1} value={coin} onChange={(e) => setCoin(e.target.value)} className={`${o} mt-1 block w-24`} />
      </label>
      <label className="flex h-9 items-center gap-1.5 text-sm">
        <input type="checkbox" checked={mo} onChange={(e) => setMo(e.target.checked)} /> Đang mở
      </label>
      <Button size="sm" onClick={luu} disabled={dang}>
        {dang ? "Đang lưu…" : qua ? "Lưu" : "Thêm quà"}
      </Button>
    </div>
  );
}

export function FormTonKho({ giftId, coSo }: { giftId: string; coSo: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [dang, start] = useTransition();
  const [centerId, setCenterId] = useState(coSo[0]?.id ?? "");
  const [delta, setDelta] = useState("");
  const [lyDo, setLyDo] = useState("");
  const luu = () =>
    start(async () => {
      const r = await dieuChinhTonKhoAction({ giftId, centerId, delta, reason: lyDo });
      if (r.ok) {
        toast.success("Đã điều chỉnh tồn kho");
        setDelta("");
        setLyDo("");
        router.refresh();
      } else toast.error(r.error);
    });
  if (coSo.length === 0) return <span className="text-xs text-muted-foreground">Không có cơ sở nào để nhập kho</span>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={centerId} onChange={(e) => setCenterId(e.target.value)} aria-label="Cơ sở" className={o}>
        {coSo.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <input type="number" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="+nhập / −xuất" aria-label="Số lượng điều chỉnh" className={`${o} w-28`} />
      <input value={lyDo} onChange={(e) => setLyDo(e.target.value)} placeholder="Lý do" aria-label="Lý do" className={`${o} w-40`} />
      <Button size="sm" variant="outline" onClick={luu} disabled={dang || !delta || lyDo.trim().length < 3}>
        {dang ? "…" : "Điều chỉnh"}
      </Button>
    </div>
  );
}

export function FormHanMuc({ teacherUserId, capHienTai }: { teacherUserId: string; capHienTai: number | null }) {
  const router = useRouter();
  const [dang, start] = useTransition();
  const [cap, setCap] = useState(capHienTai === null ? "" : String(capHienTai));
  const luu = () =>
    start(async () => {
      const r = await datHanMucAction({ teacherUserId, capPerMonth: cap });
      if (r.ok) {
        toast.success("Đã lưu hạn mức");
        router.refresh();
      } else toast.error(r.error);
    });
  return (
    <div className="flex items-center gap-2">
      <input type="number" min={0} value={cap} onChange={(e) => setCap(e.target.value)} aria-label="Hạn mức coin mỗi tháng" className={`${o} w-28`} />
      <Button size="sm" variant="outline" onClick={luu} disabled={dang || cap === ""}>
        {dang ? "…" : "Lưu"}
      </Button>
    </div>
  );
}
