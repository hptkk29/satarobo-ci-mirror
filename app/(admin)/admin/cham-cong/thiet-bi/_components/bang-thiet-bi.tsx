"use client";

// Bảng thiết bị chấm công (P2.3). Nút theo `hanhDongThietBiHopLe` — cùng bảng chuyển trạng thái server kiểm —
// và chỉ khi trang tính `quanLyDuoc` (= `hr_attendance:device-reset` ở khối).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD, PILL } from "@/components/admin/cham-cong/classes";
import { cn } from "@/lib/utils";
import {
  hanhDongThietBiHopLe,
  NHAN_HANH_DONG_THIET_BI,
  type HanhDongThietBi,
  type TrangThaiThietBi,
} from "@/lib/cham-cong/thiet-bi-thuan";
import { datLaiThietBiAction, doiTrangThaiThietBiAction } from "../_actions";

export type NguoiVaThietBi = {
  userId: string;
  ten: string;
  may: {
    id: string;
    deviceName: string | null;
    status: TrangThaiThietBi;
    registeredAt: Date;
    lastUsedAt: Date | null;
    revokeReason: string | null;
    /** Đã bị "Đặt lại" tháo khoá — không còn gắn với trình duyệt nào, không còn thao tác gì trên dòng này. */
    daDatLai: boolean;
  }[];
};

const NHAN: Record<TrangThaiThietBi, { text: string; cls: string }> = {
  TRUSTED: { text: "Tin cậy", cls: "bg-state-success-soft text-state-success-ink" },
  PENDING: { text: "Chờ duyệt", cls: "bg-state-warning-soft text-state-warning-ink" },
  REVOKED: { text: "Đã thu hồi", cls: "bg-muted text-muted-foreground" },
  LOST: { text: "Báo mất", cls: "bg-state-danger-soft text-state-danger-ink" },
};

const ngay = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10).split("-").reverse().join("/") : "—");

export function BangThietBi({ coSo, dong, quanLyDuoc }: { coSo: string; dong: NguoiVaThietBi[]; quanLyDuoc: boolean }) {
  return (
    <ul className="divide-y divide-border">
      {dong.map((d) => (
        <MotNguoi key={d.userId} coSo={coSo} d={d} quanLyDuoc={quanLyDuoc} />
      ))}
    </ul>
  );
}

function MotNguoi({ coSo, d, quanLyDuoc }: { coSo: string; d: NguoiVaThietBi; quanLyDuoc: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [lyDo, setLyDo] = useState("");
  const [moDatLai, setMoDatLai] = useState(false);
  // Đặt lại được khi còn ÍT NHẤT một máy chưa tháo khoá và không báo mất — gồm cả máy đã THU HỒI (thu hồi nhầm chiếc
  // điện thoại duy nhất thì "Đặt lại" là đường trả nó về; ẩn nút đúng lúc này là ca nghiệm thu test 11/10 vấp).
  // Cùng luật với server (`biDatLai`) để nút hiện ⇔ có máy để tháo.
  const datLaiDuoc = d.may.some((m) => m.status !== "LOST" && !m.daDatLai);
  const chay = (fn: () => Promise<{ ok: true; note?: string } | { ok: false; error: string }>, xong: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(r.note ?? xong);
        setLyDo("");
        setMoDatLai(false);
        router.refresh();
      } else toast.error(r.error);
    });
  const lam = (id: string, h: HanhDongThietBi) =>
    chay(() => doiTrangThaiThietBiAction({ id, coSo, hanhDong: h, lyDo }), NHAN_HANH_DONG_THIET_BI[h]);

  return (
    <li className="py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-foreground">{d.ten}</span>
        {quanLyDuoc && datLaiDuoc && !moDatLai && (
          <button type="button" onClick={() => setMoDatLai(true)} className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}>
            Đặt lại thiết bị
          </button>
        )}
      </div>
      {d.may.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">Chưa có máy nào được ghi nhận.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {d.may.map((m) => {
            const hd = quanLyDuoc && !m.daDatLai ? hanhDongThietBiHopLe(m.status) : [];
            return (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                <span className="min-w-0">
                  <span className="font-medium text-foreground">{m.deviceName ?? "Không rõ máy"}</span>
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    · đăng ký {ngay(m.registeredAt)} · dùng gần nhất {ngay(m.lastUsedAt)}
                    {m.revokeReason ? ` · ${m.revokeReason}` : ""}
                    {m.daDatLai ? " · đã đặt lại (không còn gắn với trình duyệt nào)" : ""}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <span className={cn(PILL, NHAN[m.status].cls)}>{NHAN[m.status].text}</span>
                  {hd.map((h) => (
                    <button key={h} type="button" disabled={pending} onClick={() => lam(m.id, h)} className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}>
                      {NHAN_HANH_DONG_THIET_BI[h]}
                    </button>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {quanLyDuoc && (d.may.some((m) => !m.daDatLai && hanhDongThietBiHopLe(m.status).some((h) => h !== "TIN_CAY")) || moDatLai) && (
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            aria-label="Lý do (bắt buộc khi thu hồi / báo mất / đặt lại)"
            placeholder="Lý do (bắt buộc khi thu hồi / báo mất / đặt lại)"
            value={lyDo}
            onChange={(e) => setLyDo(e.target.value)}
            className={cn(FIELD, "min-w-[16rem] flex-1")}
          />
          {moDatLai && (
            <>
              <p className="w-full text-xs text-muted-foreground">
                Mọi máy của người này (trừ máy đã báo mất) sẽ không còn được nhận ra — lần chấm kế tiếp, kể cả trên chính
                điện thoại đang dùng, đăng ký như máy mới.
              </p>
              <button
                type="button"
                disabled={pending}
                onClick={() => chay(() => datLaiThietBiAction({ userId: d.userId, coSo, lyDo }), "Đã đặt lại")}
                className={cn(BTN_PRIMARY, "h-8 px-3 text-xs")}
              >
                Xác nhận đặt lại
              </button>
              <button type="button" onClick={() => setMoDatLai(false)} className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}>
                Huỷ
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}
