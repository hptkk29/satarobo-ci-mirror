"use client";

// components/cham-cong/xac-nhan-cong-cua-toi.tsx — P2.2: nhân sự XÁC NHẬN bảng công tháng hoặc KHIẾU NẠI.
// Dùng chung site GV (`/teacher/bang-cong`) và admin (`/cham-cong/lich-ca`).
//
// DỄ VỠ: thư mục dùng chung với site GV ⇒ KHÔNG import `components/admin/**`, CHỈ token `:root`.
// Luật 12: nút nào hiện thì server nhận — "Xác nhận" chỉ hiện khi kỳ đã hết, chưa chốt, không còn khiếu
// nại mở; nút khiếu nại theo `hanhDongHopLe("NV", …)` — cùng bảng mà server kiểm.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { BangCongCuaToi } from "@/lib/cham-cong/xac-nhan-cong";
import {
  canGhiChu,
  hanhDongHopLe,
  KHIEU_NAI_DANG_MO,
  LOAI_KHIEU_NAI,
  NHAN_HANH_DONG,
  NHAN_LOAI_KHIEU_NAI,
  ngayKhacNhau,
  type HanhDongKhieuNai,
  type LoaiKhieuNai,
  type TrangThaiXacNhan,
} from "@/lib/cham-cong/xac-nhan-cong-thuan";
import { moKhieuNaiAction, nvKhieuNaiAction, xacNhanCongAction } from "@/lib/cham-cong/xac-nhan-cong-actions";

const FIELD =
  "h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring";
const BTN_PRIMARY =
  "inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50";
const BTN_OUTLINE =
  "inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50";
const PILL = "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold";

const NHAN_TRANG_THAI: Record<TrangThaiXacNhan, { text: string; cls: string }> = {
  CHUA_XAC_NHAN: { text: "Chưa xác nhận", cls: "bg-state-warning-soft text-state-warning-ink" },
  DA_XAC_NHAN: { text: "Đã xác nhận", cls: "bg-state-success-soft text-state-success-ink" },
  CAN_XAC_NHAN_LAI: { text: "Cần xác nhận lại — số liệu đã đổi", cls: "bg-state-danger-soft text-state-danger-ink" },
  HR_XAC_NHAN_THAY: { text: "Quản lý đã xác nhận thay", cls: "bg-muted text-muted-foreground" },
};

const NHAN_KN: Record<string, string> = {
  OPEN: "Đang chờ xử lý",
  IN_REVIEW: "Quản lý đang xem",
  WAITING_EMPLOYEE: "Chờ bạn trả lời",
  RESOLVED: "Đã giải quyết",
  REJECTED: "Bị từ chối",
  CLOSED: "Đã đóng",
};

const fmtNgay = (d: Date | string) => new Date(d).toISOString().slice(0, 10).split("-").reverse().slice(0, 2).join("/");

export function XacNhanCongCuaToi({ bang }: { bang: BangCongCuaToi[] }) {
  if (bang.length === 0) return null;
  return (
    <section aria-labelledby="xac-nhan-cong" className="space-y-3">
      <h2 id="xac-nhan-cong" className="text-base font-semibold text-foreground">
        Xác nhận công tháng {bang[0]!.periodKey.split("-").reverse().join("/")}
      </h2>
      <p className="text-xs text-muted-foreground">
        Bạn xác nhận <b>công ngày</b> (ca, giờ làm, đi muộn / về sớm, nghỉ, tăng ca). Công dạy theo buổi chưa nằm trong
        phần xác nhận này. Thấy sai thì gửi khiếu nại — quản lý xử lý xong bạn xác nhận lại.
      </p>
      {bang.map((b) => (
        <MotCoSo key={b.centerId} b={b} ten={b.tenCoSo} />
      ))}
    </section>
  );
}

function MotCoSo({ b, ten }: { b: BangCongCuaToi; ten: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [moForm, setMoForm] = useState(false);
  const [loai, setLoai] = useState<LoaiKhieuNai>("MISSING_CHECKIN");
  const [ngay, setNgay] = useState("");
  const [moTa, setMoTa] = useState("");
  const dangMo = b.khieuNai.some((k) => (KHIEU_NAI_DANG_MO as readonly string[]).includes(k.status));
  const xacNhanDuoc = b.kyDaKetThuc && !b.kyDaKhoa && !dangMo && b.trangThai !== "DA_XAC_NHAN" && b.anhChup.ngay.length > 0;
  const khieuNaiDuoc = !b.kyDaKhoa;
  const doi = b.trangThai === "CAN_XAC_NHAN_LAI" && b.anhChupDaXacNhan ? ngayKhacNhau(b.anhChupDaXacNhan, b.anhChup) : [];
  const nhan = NHAN_TRANG_THAI[b.trangThai];

  const xacNhan = () =>
    start(async () => {
      const r = await xacNhanCongAction({ centerId: b.centerId, ky: b.periodKey, vanTay: b.vanTay });
      if (r.ok) toast.success(r.note ?? "Đã xác nhận");
      else toast.error(r.error);
      router.refresh();
    });
  const guiKhieuNai = () =>
    start(async () => {
      const r = await moKhieuNaiAction({ centerId: b.centerId, ky: b.periodKey, ngay: ngay || null, loai, moTa });
      if (r.ok) {
        toast.success(r.note ?? "Đã gửi");
        setMoForm(false);
        setMoTa("");
        setNgay("");
        router.refresh();
      } else toast.error(r.error);
    });

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-foreground">{ten}</span>
        <span className={cn(PILL, nhan.cls)}>{nhan.text}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <dt className="text-muted-foreground">Công</dt>
        <dd className="font-semibold tabular-nums text-foreground">{b.anhChup.tong.cong}</dd>
        <dt className="text-muted-foreground">Ngày nghỉ phép</dt>
        <dd className="tabular-nums text-foreground">{b.anhChup.tong.ngayPhep}</dd>
        <dt className="text-muted-foreground">Phút đi muộn</dt>
        <dd className="tabular-nums text-foreground">{b.anhChup.tong.phutTre}</dd>
        <dt className="text-muted-foreground">Phút về sớm</dt>
        <dd className="tabular-nums text-foreground">{b.anhChup.tong.phutVeSom}</dd>
      </dl>
      {doi.length > 0 && (
        <div className="rounded-lg border border-state-danger/40 bg-state-danger-soft p-3 text-sm text-state-danger-ink">
          <p className="font-semibold">Số liệu đã đổi sau khi bạn xác nhận:</p>
          <ul className="mt-1 list-disc pl-5">
            {doi.map((x) => (
              <li key={x.d}>
                Ngày {fmtNgay(x.d)}: {x.truoc} → {x.sau}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!b.kyDaKetThuc && <p className="text-xs text-muted-foreground">Kỳ chưa kết thúc — xác nhận sau ngày cuối tháng.</p>}
      {b.kyDaKhoa && <p className="text-xs text-muted-foreground">Kỳ đã chốt sổ — cần sửa thì liên hệ quản lý.</p>}
      {dangMo && <p className="text-xs text-muted-foreground">Còn khiếu nại chưa có kết luận — xác nhận sau khi có kết luận.</p>}

      <div className="flex flex-wrap gap-2">
        {xacNhanDuoc && (
          <button type="button" onClick={xacNhan} disabled={pending} className={BTN_PRIMARY}>
            {pending ? "Đang lưu…" : b.trangThai === "CAN_XAC_NHAN_LAI" ? "Xác nhận lại" : "Xác nhận bảng công"}
          </button>
        )}
        {khieuNaiDuoc && !moForm && (
          <button type="button" onClick={() => setMoForm(true)} className={BTN_OUTLINE}>
            Khiếu nại
          </button>
        )}
      </div>

      {moForm && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <select aria-label="Loại khiếu nại" value={loai} onChange={(e) => setLoai(e.target.value as LoaiKhieuNai)} className={FIELD}>
              {LOAI_KHIEU_NAI.map((l) => (
                <option key={l} value={l}>
                  {NHAN_LOAI_KHIEU_NAI[l]}
                </option>
              ))}
            </select>
            <select aria-label="Ngày (không bắt buộc)" value={ngay} onChange={(e) => setNgay(e.target.value)} className={FIELD}>
              <option value="">Cả tháng / nhiều ngày</option>
              {b.anhChup.ngay.map((x) => (
                <option key={x.d} value={x.d}>
                  Ngày {fmtNgay(x.d)} ({x.ma ?? "—"})
                </option>
              ))}
            </select>
          </div>
          <textarea
            aria-label="Mô tả khiếu nại"
            placeholder="Mô tả cụ thể (tối thiểu 10 ký tự), vd: ngày 02 tôi quét vào 7:40 nhưng bảng ghi thiếu giờ vào"
            value={moTa}
            onChange={(e) => setMoTa(e.target.value)}
            rows={3}
            className={cn(FIELD, "h-auto py-2")}
          />
          <div className="flex gap-2">
            <button type="button" onClick={guiKhieuNai} disabled={pending} className={BTN_PRIMARY}>
              {pending ? "Đang gửi…" : "Gửi khiếu nại"}
            </button>
            <button type="button" onClick={() => setMoForm(false)} disabled={pending} className={BTN_OUTLINE}>
              Huỷ
            </button>
          </div>
        </div>
      )}

      {b.khieuNai.length > 0 && (
        <ul className="space-y-2">
          {b.khieuNai.map((k) => (
            <KhieuNaiCuaToi key={k.id} k={k} />
          ))}
        </ul>
      )}
    </div>
  );
}

function KhieuNaiCuaToi({ k }: { k: BangCongCuaToi["khieuNai"][number] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ghiChu, setGhiChu] = useState("");
  const hanhDong = hanhDongHopLe("NV", k.status);
  const lam = (h: HanhDongKhieuNai) =>
    start(async () => {
      const r = await nvKhieuNaiAction({ id: k.id, hanhDong: h, ghiChu });
      if (r.ok) {
        toast.success(NHAN_HANH_DONG[h]);
        setGhiChu("");
        router.refresh();
      } else toast.error(r.error);
    });
  return (
    <li className="rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-foreground">
          {NHAN_LOAI_KHIEU_NAI[k.category as LoaiKhieuNai] ?? k.category}
          {k.workDate ? ` · ngày ${fmtNgay(k.workDate)}` : ""}
        </span>
        <span className="text-xs text-muted-foreground">{NHAN_KN[k.status] ?? k.status}</span>
      </div>
      <ol className="mt-2 space-y-1">
        {k.messages.map((m, i) => (
          <li key={i} className={cn("rounded-md px-2 py-1", m.laCuaToi ? "bg-muted" : "bg-background")}>
            <span className="text-xs text-muted-foreground">{m.laCuaToi ? "Bạn" : "Quản lý"}: </span>
            {m.body}
          </li>
        ))}
      </ol>
      {hanhDong.length > 0 && (
        <div className="mt-2 space-y-2">
          {hanhDong.some(canGhiChu) && (
            <input
              aria-label="Nội dung trả lời"
              placeholder="Nội dung (bắt buộc khi trả lời / khiếu nại tiếp)"
              value={ghiChu}
              onChange={(e) => setGhiChu(e.target.value)}
              className={FIELD}
            />
          )}
          <div className="flex flex-wrap gap-2">
            {hanhDong.map((h) => (
              <button key={h} type="button" onClick={() => lam(h)} disabled={pending} className={BTN_OUTLINE}>
                {NHAN_HANH_DONG[h]}
              </button>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}
