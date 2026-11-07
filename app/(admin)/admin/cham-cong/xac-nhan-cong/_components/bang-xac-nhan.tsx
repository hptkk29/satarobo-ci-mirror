"use client";

// Màn quản lý P2.2: bảng ai đã/chưa xác nhận công + khiếu nại có nút xử lý. Nút hiện ⇔ server nhận:
// xử lý khiếu nại theo `hanhDongHopLe("QL", …)` (cùng bảng server kiểm) và chỉ khi trang tính `xuLyDuoc`
// (= `hr_attendance:approve` ở khối); xác nhận thay chỉ khi `xacNhanThayDuoc` (= `close-period`).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD, PILL } from "@/components/admin/cham-cong/classes";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { cn } from "@/lib/utils";
import type { DongBaoCaoXacNhan } from "@/lib/cham-cong/xac-nhan-cong";
import {
  canGhiChu,
  hanhDongHopLe,
  NHAN_HANH_DONG,
  NHAN_LOAI_KHIEU_NAI,
  type HanhDongKhieuNai,
  type LoaiKhieuNai,
  type TrangThaiKhieuNai,
  type TrangThaiXacNhan,
} from "@/lib/cham-cong/xac-nhan-cong-thuan";
import { moiXacNhanCongAction, qlKhieuNaiAction, xacNhanThayAction } from "@/lib/cham-cong/xac-nhan-cong-actions";

const TH = "whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const TD = "px-3 py-2.5 text-sm text-foreground";

const NHAN: Record<TrangThaiXacNhan, { text: string; cls: string }> = {
  CHUA_XAC_NHAN: { text: "Chưa xác nhận", cls: "bg-state-warning-soft text-state-warning-ink" },
  DA_XAC_NHAN: { text: "Đã xác nhận", cls: "bg-state-success-soft text-state-success-ink" },
  CAN_XAC_NHAN_LAI: { text: "Cần xác nhận lại", cls: "bg-state-danger-soft text-state-danger-ink" },
  HR_XAC_NHAN_THAY: { text: "Đã xác nhận thay", cls: "bg-muted text-muted-foreground" },
};

const NHAN_KN: Record<string, string> = {
  OPEN: "Mới",
  IN_REVIEW: "Đang xem",
  WAITING_EMPLOYEE: "Chờ nhân sự",
  RESOLVED: "Đã giải quyết",
  REJECTED: "Từ chối",
  CLOSED: "Đã đóng",
};

const ngay = (d: Date | string) => new Date(d).toISOString().slice(0, 10).split("-").reverse().slice(0, 2).join("/");

export function BangXacNhan({
  coSo,
  ky,
  dong,
  xacNhanThayDuoc,
}: {
  coSo: string;
  ky: string;
  dong: DongBaoCaoXacNhan[];
  xacNhanThayDuoc: boolean;
}) {
  const router = useRouter();
  const [dangSua, setDangSua] = useState<string | null>(null);
  const [lyDo, setLyDo] = useState("");
  const [pending, start] = useTransition();
  const luu = (userId: string) =>
    start(async () => {
      const r = await xacNhanThayAction({ userId, centerId: coSo, ky, lyDo });
      if (r.ok) {
        toast.success("Đã xác nhận thay");
        setDangSua(null);
        setLyDo("");
        router.refresh();
      } else toast.error(r.error);
    });
  return (
    <PhanTrangBang cuonNgang tenDonVi="người" khoaGhiNho="xac-nhan-cong">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="border-b border-border">
          <tr>
            <th scope="col" className={TH}>Nhân sự</th>
            <th scope="col" className={TH}>Trạng thái</th>
            <th scope="col" className={TH}>Công</th>
            <th scope="col" className={TH}>Khiếu nại mở</th>
            {xacNhanThayDuoc && <th scope="col" className={TH}><span className="sr-only">Xác nhận thay</span></th>}
          </tr>
        </thead>
        <tbody>
          {dong.map((d) => (
            <tr key={d.userId} className="border-b border-border/60 align-top last:border-0">
              <td className={cn(TD, "font-medium")}>{d.ten}</td>
              <td className={TD}>
                <span className={cn(PILL, NHAN[d.trangThai].cls)}>{NHAN[d.trangThai].text}</span>
              </td>
              <td className={cn(TD, "tabular-nums")}>{d.cong}</td>
              <td className={cn(TD, "tabular-nums", d.soKhieuNaiMo > 0 && "font-semibold text-state-danger-ink")}>{d.soKhieuNaiMo}</td>
              {xacNhanThayDuoc && (
                <td className={TD}>
                  {d.trangThai === "DA_XAC_NHAN" || d.trangThai === "HR_XAC_NHAN_THAY" ? null : dangSua === d.userId ? (
                    <div className="flex min-w-[16rem] flex-col gap-2">
                      <input
                        aria-label="Lý do xác nhận thay"
                        placeholder="Lý do (bắt buộc), vd: đã nghỉ việc"
                        value={lyDo}
                        onChange={(e) => setLyDo(e.target.value)}
                        className={FIELD}
                      />
                      <div className="flex gap-2">
                        <button type="button" onClick={() => luu(d.userId)} disabled={pending} className={cn(BTN_PRIMARY, "h-8 px-3 text-xs")}>
                          {pending ? "Đang lưu…" : "Xác nhận thay"}
                        </button>
                        <button type="button" onClick={() => setDangSua(null)} disabled={pending} className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}>
                          Huỷ
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setDangSua(d.userId)} className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}>
                      Xác nhận thay
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </PhanTrangBang>
  );
}

export type KhieuNaiQL = {
  id: string;
  ten: string;
  category: string;
  critical: boolean;
  status: string;
  workDate: Date | null;
  linkedRequestId: string | null;
  messages: { body: string; statusTo: string; createdAt: Date; laNhanSu: boolean }[];
};

export function DanhSachKhieuNai({ khieuNai, xuLyDuoc }: { khieuNai: KhieuNaiQL[]; xuLyDuoc: boolean }) {
  return (
    <ul className="space-y-3">
      {khieuNai.map((k) => (
        <MotKhieuNai key={k.id} k={k} xuLyDuoc={xuLyDuoc} />
      ))}
    </ul>
  );
}

function MotKhieuNai({ k, xuLyDuoc }: { k: KhieuNaiQL; xuLyDuoc: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ghiChu, setGhiChu] = useState("");
  const [maDon, setMaDon] = useState("");
  const hanhDong = xuLyDuoc ? hanhDongHopLe("QL", k.status as TrangThaiKhieuNai) : [];
  const lam = (h: HanhDongKhieuNai) =>
    start(async () => {
      const r = await qlKhieuNaiAction({ id: k.id, hanhDong: h, ghiChu, maDon: maDon || null });
      if (r.ok) {
        toast.success(NHAN_HANH_DONG[h]);
        setGhiChu("");
        setMaDon("");
        router.refresh();
      } else toast.error(r.error);
    });
  return (
    <li className="rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-foreground">
          {k.ten} · {NHAN_LOAI_KHIEU_NAI[k.category as LoaiKhieuNai] ?? k.category}
          {k.workDate ? ` · ngày ${ngay(k.workDate)}` : ""}
        </span>
        <span className="flex items-center gap-2">
          {k.critical && ["OPEN", "IN_REVIEW", "WAITING_EMPLOYEE"].includes(k.status) && (
            <span className={cn(PILL, "bg-state-danger-soft text-state-danger-ink")}>Chặn chốt kỳ</span>
          )}
          <span className="text-xs text-muted-foreground">{NHAN_KN[k.status] ?? k.status}</span>
        </span>
      </div>
      <ol className="mt-2 space-y-1">
        {k.messages.map((m, i) => (
          <li key={i} className={cn("rounded-md px-2 py-1", m.laNhanSu ? "bg-muted" : "bg-background")}>
            <span className="text-xs text-muted-foreground">{m.laNhanSu ? "Nhân sự" : "Quản lý"}: </span>
            {m.body}
          </li>
        ))}
      </ol>
      {k.linkedRequestId && <p className="mt-1 text-xs text-muted-foreground">Xử lý bằng đơn: {k.linkedRequestId}</p>}
      {hanhDong.length > 0 && (
        <div className="mt-2 space-y-2">
          {hanhDong.some(canGhiChu) && (
            <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
              <input
                aria-label="Nội dung xử lý"
                placeholder="Nội dung trả lời / kết luận (bắt buộc khi kết luận)"
                value={ghiChu}
                onChange={(e) => setGhiChu(e.target.value)}
                className={FIELD}
              />
              <input
                aria-label="Mã đơn đã dùng để sửa (tuỳ chọn)"
                placeholder="Mã đơn đã sửa (tuỳ chọn)"
                value={maDon}
                onChange={(e) => setMaDon(e.target.value)}
                className={FIELD}
              />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {hanhDong.map((h) => (
              <button key={h} type="button" onClick={() => lam(h)} disabled={pending} className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}>
                {NHAN_HANH_DONG[h]}
              </button>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * P2.6 — người chốt kỳ mời những ai còn chưa xác nhận / cần xác nhận lại (chuông + đẩy; ZNS khi đã bật mẫu).
 * Trang chỉ vẽ nút khi server SẼ nhận: có `close-period` · kỳ đã kết thúc · chưa chốt · còn người cần mời.
 */
export function NutMoiXacNhan({ coSo, ky, soCanMoi }: { coSo: string; ky: string; soCanMoi: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className={cn(BTN_OUTLINE, "min-h-9")}
      onClick={() =>
        start(async () => {
          const r = await moiXacNhanCongAction({ centerId: coSo, ky });
          if (r.ok) {
            toast.success(r.note ?? "Đã gửi lời mời");
            router.refresh();
          } else toast.error(r.error);
        })
      }
    >
      {pending ? "Đang gửi…" : `Mời ${soCanMoi} người xác nhận`}
    </button>
  );
}
