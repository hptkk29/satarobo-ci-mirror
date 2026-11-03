"use client";

// Thẻ việc của màn "Công việc của tôi" (site GV · SR.QD.238 · P2 → P3b). Dùng trên điện thoại giữa giờ nên mọi nút cao
// 44px, "Từ chối" mở ô lý do ngay tại chỗ (không modal), và "Nhận cả N buổi" chỉ hiện khi nhóm có từ 2 buổi.
//
// Mỗi lần bấm gửi kèm PHIÊN BẢN đang nhìn (`phienBan`) — lịch vừa đổi thì máy chủ từ chối đúng mục đó. "Nhận cả lớp"
// hiện LỖI TỪNG DÒNG ngay dưới dòng bị từ chối (không chỉ một câu chung).
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowRight, Check, CheckCheck, DoorOpen, MapPin, TimerReset, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PhanCongCuaToi } from "@/lib/parttime/bang-phan-cong";
import { nhanNhieuAction, quyetDinhAction } from "../_actions";

const THU = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

/** Ô ngày (cùng khuôn với màn Dạy thay). `ngay` là "YYYY-MM-DD" theo giờ VN. */
export function ONgayNho({ ngay, homNay }: { ngay: string; homNay: boolean }) {
  const d = new Date(`${ngay}T00:00:00.000Z`);
  return (
    <div
      className={cn(
        "flex w-12 shrink-0 flex-col items-center self-start rounded-lg py-1.5",
        homNay ? "bg-primary text-primary-foreground" : "bg-primary-soft text-primary-ink",
      )}
    >
      <span className="text-[11px] font-semibold uppercase leading-none">{THU[d.getUTCDay()]}</span>
      <span className="mt-1 text-lg font-extrabold leading-none tabular-nums">{ngay.slice(8, 10)}</span>
      <span className="mt-1 text-[11px] leading-none tabular-nums">Th{Number(ngay.slice(5, 7))}</span>
    </div>
  );
}

const CHIP = "inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold";

const HOAT_DONG: Record<PhanCongCuaToi["activity"], string> = {
  REGULAR_CLASS: "Dạy chính",
  MAKEUP: "Học bù",
  ADVANCE: "Học vượt",
  TRIAL: "Trải nghiệm",
  SPECIAL: "Đặc biệt",
};

const TRANG_THAI: Partial<Record<PhanCongCuaToi["status"], { nhan: string; cls: string }>> = {
  WAITING_ACCEPTANCE: { nhan: "Chờ bạn nhận", cls: "bg-state-warning-soft text-state-warning-ink" },
  ACCEPTED: { nhan: "Đã gán", cls: "bg-state-success-soft text-state-success-ink" },
  ACTIVE: { nhan: "Đã gán", cls: "bg-state-success-soft text-state-success-ink" },
  COMPLETED: { nhan: "Đã chốt", cls: "bg-muted text-muted-foreground" },
};

export function NhanVai({ x, coTrangThai = false }: { x: PhanCongCuaToi; coTrangThai?: boolean }) {
  const tt = coTrangThai ? TRANG_THAI[x.status] : undefined;
  return (
    <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
      <span
        className={cn(
          CHIP,
          x.role === "MAIN_TEACHER" ? "bg-primary-soft text-primary-ink" : "bg-state-info-soft text-state-info-ink",
        )}
      >
        {x.role === "MAIN_TEACHER" ? "Đứng chính" : "Trợ giảng"}
      </span>
      <span className={cn(CHIP, "bg-muted text-muted-foreground")}>
        {x.assignmentType === "SUBSTITUTE" ? "Dạy thay" : x.assignmentType === "CUTOVER" ? "Lớp đang dạy — cần xác nhận" : HOAT_DONG[x.activity]}
      </span>
      {tt && <span className={cn(CHIP, tt.cls)}>{tt.nhan}</span>}
    </span>
  );
}

/** Giờ · có mặt trước · nơi — ba thứ người đi dạy cần biết, theo đúng thứ tự đó. */
export function DongThongTin({ x }: { x: PhanCongCuaToi }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {x.coMatTruoc && (
        <span className="inline-flex items-center gap-1 font-medium text-foreground">
          <TimerReset className="h-3.5 w-3.5" aria-hidden />
          Có mặt trước <span className="tabular-nums">{x.coMatTruoc}</span>
        </span>
      )}
      {x.tenCoSo && (
        <span className="inline-flex min-w-0 items-center gap-1">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{x.tenCoSo}</span>
        </span>
      )}
      {x.phong && (
        <span className="inline-flex items-center gap-1">
          <DoorOpen className="h-3.5 w-3.5" aria-hidden />
          Phòng {x.phong}
        </span>
      )}
    </div>
  );
}

/** Lịch đổi ⇒ "trước → sau" (từ audit). Lời mời cũ còn chờ ⇒ phải xác nhận lại; phân công đã gán (20/10/2026) ⇒ chỉ báo. */
export function ThayDoi({ x }: { x: PhanCongCuaToi }) {
  if (!x.doiLich) return null;
  return (
    <div className="mt-2 rounded-lg bg-state-warning-soft px-3 py-2 text-xs text-state-warning-ink">
      <p className="font-semibold">{x.status === "WAITING_ACCEPTANCE" ? "Phân công đã thay đổi — vui lòng xác nhận lại" : "Lịch buổi đã đổi"}</p>
      {x.thayDoi && (
        <p className="mt-1 flex flex-wrap items-center gap-1.5 tabular-nums">
          <s>
            {dm(x.thayDoi.truoc.ngay)} {x.thayDoi.truoc.gioBatDau}–{x.thayDoi.truoc.gioKetThuc}
          </s>
          <ArrowRight className="h-3.5 w-3.5" aria-label="thành" />
          <b>
            {dm(x.thayDoi.sau.ngay)} {x.thayDoi.sau.gioBatDau}–{x.thayDoi.sau.gioKetThuc}
          </b>
        </p>
      )}
    </div>
  );
}

const NUT =
  "inline-flex min-h-11 whitespace-nowrap items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const NUT_CHINH = cn(NUT, "bg-primary text-primary-foreground hover:bg-primary/90");
const NUT_PHU = cn(NUT, "border border-border bg-card text-foreground hover:bg-muted");

export function NhomCho({ ten, phu, ds, homNay }: { ten: string; phu: string | null; ds: PhanCongCuaToi[]; homNay: string }) {
  const [dang, batDau] = useTransition();
  const [loiDong, setLoiDong] = useState<Record<string, string>>({});
  const nhanHet = () =>
    batDau(async () => {
      const r = await nhanNhieuAction({ muc: ds.map((x) => ({ assignmentId: x.id, phienBan: x.phienBan })) });
      setLoiDong(Object.fromEntries(r.ketQua.filter((k) => !k.ok).map((k) => [k.assignmentId, k.loi ?? "Chưa nhận được"])));
      if (r.ok) toast.success(r.message);
      else toast.error(r.error);
    });
  return (
    <section className="t-card min-w-0 overflow-hidden" aria-label={ten}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 font-semibold text-foreground">{ten}</h3>
          <p className="truncate text-xs text-muted-foreground">{[phu, `${ds.length} buổi chờ nhận`].filter(Boolean).join(" · ")}</p>
        </div>
        {ds.length >= 2 && (
          <button type="button" onClick={nhanHet} disabled={dang} className={cn(NUT_CHINH, "w-full sm:w-auto")}>
            <CheckCheck className="h-4 w-4" aria-hidden />
            {dang ? "Đang nhận…" : `Nhận cả ${ds.length} buổi`}
          </button>
        )}
      </header>
      <ul className="divide-y divide-border">
        {ds.map((x) => (
          <DongCho key={x.id} x={x} homNay={x.ngay === homNay} khoa={dang} loi={loiDong[x.id] ?? null} />
        ))}
      </ul>
    </section>
  );
}

function DongCho({ x, homNay, khoa, loi }: { x: PhanCongCuaToi; homNay: boolean; khoa: boolean; loi: string | null }) {
  const [tuChoi, setTuChoi] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const [dang, batDau] = useTransition();
  const idLyDo = useId();
  const idLoi = useId();
  const lyDoDu = lyDo.trim().length >= 5;

  const gui = (quyetDinh: "ACCEPTED" | "DECLINED") =>
    batDau(async () => {
      const r = await quyetDinhAction(
        quyetDinh === "ACCEPTED"
          ? { assignmentId: x.id, phienBan: x.phienBan, quyetDinh }
          : { assignmentId: x.id, phienBan: x.phienBan, quyetDinh, lyDo },
      );
      if (r.ok) toast.success(r.message);
      else toast.error(r.error);
    });

  return (
    <li className="px-4 py-3.5 sm:px-5" aria-describedby={loi ? idLoi : undefined}>
      <div className="flex gap-3">
        <ONgayNho ngay={x.ngay} homNay={homNay} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-sm font-semibold tabular-nums text-foreground">
              {x.gioBatDau}–{x.gioKetThuc}
              {homNay && <span className={cn(CHIP, "ml-2 bg-primary-soft align-middle text-primary-ink")}>Hôm nay</span>}
            </p>
            <NhanVai x={x} />
          </div>
          <DongThongTin x={x} />
          {x.nguoiPhan && <p className="mt-0.5 truncate text-xs text-muted-foreground">Phân bởi {x.nguoiPhan}</p>}
          <ThayDoi x={x} />
          {loi && (
            <p id={idLoi} role="status" className="mt-2 text-xs font-medium text-state-danger-ink">
              Chưa nhận được: {loi}
            </p>
          )}
        </div>
      </div>

      {/* Nút đặt NGOÀI cột chữ: ở 320px cột cạnh ô ngày chỉ còn ~200px, "Từ chối" bị bẻ hai dòng. Từ sm thì thụt vào
          thẳng cột chữ (ô ngày 3rem + khoảng 0.75rem). */}
      <div className="sm:pl-[3.75rem]">
        {!tuChoi ? (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:flex">
            <button type="button" onClick={() => gui("ACCEPTED")} disabled={dang || khoa} className={NUT_CHINH}>
              <Check className="h-4 w-4" aria-hidden />
              {dang ? "Đang lưu…" : "Xác nhận nhận"}
            </button>
            <button type="button" onClick={() => setTuChoi(true)} disabled={dang || khoa} className={NUT_PHU}>
              <X className="h-4 w-4" aria-hidden />
              Từ chối
            </button>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <label htmlFor={idLyDo} className="block text-xs font-medium text-muted-foreground">
              Vì sao bạn không nhận được buổi này? (quản lý cơ sở sẽ đọc)
            </label>
            <textarea
              id={idLyDo}
              value={lyDo}
              onChange={(e) => setLyDo(e.target.value)}
              rows={2}
              maxLength={500}
              autoFocus
              placeholder="Ví dụ: trùng lịch thi, đang ốm…"
              aria-invalid={lyDo.length > 0 && !lyDoDu}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 aria-[invalid=true]:border-state-danger-ink"
            />
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <button
                type="button"
                onClick={() => gui("DECLINED")}
                disabled={!lyDoDu || dang}
                className={cn(NUT, "border border-state-danger-soft bg-card text-state-danger-ink hover:bg-state-danger-soft")}
              >
                {dang ? "Đang gửi…" : "Gửi từ chối"}
              </button>
              <button type="button" onClick={() => setTuChoi(false)} disabled={dang} className={NUT_PHU}>
                Thôi
              </button>
            </div>
            {lyDo.length > 0 && !lyDoDu && <p className="text-xs text-state-danger-ink">Ghi ít nhất 5 ký tự.</p>}
          </div>
        )}
      </div>
    </li>
  );
}
