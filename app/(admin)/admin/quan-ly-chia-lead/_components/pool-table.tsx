"use client";
// Tab 1 — bảng cấu hình pool. Mọi thao tác đi qua Server Action (quyền kiểm ở đó).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { History, MoreHorizontal, UserPlus } from "lucide-react";
import type { DongPool } from "@/lib/lead/pool-board";
import {
  datLaiLuotAction,
  themSaleVaoPoolAction,
  tatNhanLeadAction,
  batNhanLeadAction,
  chinhLuotAction,
} from "../_actions";

type Props = {
  centerId: string;
  rows: DongPool[];
  /** Sale của cơ sở CHƯA có mặt trong bảng — nguồn cho nút "Thêm sale vào pool". */
  chuaCoTrongPool: { id: string; name: string | null }[];
  /** Quản trị mới thấy "chỉnh lượt thủ công" (và nút đặt lại lượt ở page). */
  laQuanTri: boolean;
};

function ngayGio(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  });
}

export function PoolTable({ centerId, rows, chuaCoTrongPool, laQuanTri }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tatId, setTatId] = useState<string | null>(null);
  const [lyDo, setLyDo] = useState("");
  const [batId, setBatId] = useState<string | null>(null);
  const [chinhId, setChinhId] = useState<string | null>(null);
  const [soLuot, setSoLuot] = useState("");
  const [lyDoChinh, setLyDoChinh] = useState("");
  const [themId, setThemId] = useState("");
  const [moDatLai, setMoDatLai] = useState(false);
  const [lyDoDatLai, setLyDoDatLai] = useState("");

  // MIN của vòng đang bật — hiện trong hộp xác nhận để người bấm biết trước hậu quả.
  const min = rows.filter((r) => r.dangNhan).reduce((m, r) => Math.min(m, r.viTriVong), Infinity);
  const minHienThi = Number.isFinite(min) ? min : 0;

  function chay(fn: () => Promise<{ ok: boolean; error?: string }>, xongThi: () => void) {
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error ?? "Thao tác không thành công");
        return;
      }
      toast.success("Đã cập nhật");
      xongThi();
      router.refresh();
    });
  }

  const oCls =
    "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";

  return (
    <div className="space-y-4">
      {chuaCoTrongPool.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-4">
          <label className="min-w-[220px] flex-1">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              Thêm sale vào pool
            </span>
            <select
              value={themId}
              onChange={(e) => setThemId(e.target.value)}
              className={oCls}
            >
              <option value="">— chọn người —</option>
              {chuaCoTrongPool.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name ?? s.id}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!themId || pending}
            onClick={() =>
              chay(() => themSaleVaoPoolAction({ centerId, userId: themId }), () => setThemId(""))
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <UserPlus className="h-4 w-4" /> Thêm vào pool
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Sale</th>
              <th className="px-4 py-3">Nhận lead</th>
              <th className="px-4 py-3 text-right">Lượt đã nhận</th>
              <th className="px-4 py-3 text-right">Tổng lead đang giữ</th>
              <th className="px-4 py-3">Lần chia gần nhất</th>
              <th className="px-4 py-3">Ghi chú</th>
              {laQuanTri && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={laQuanTri ? 7 : 6} className="px-4 py-8 text-center text-muted-foreground">
                  Cơ sở này chưa có sale nào.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.userId} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium text-foreground">{r.name ?? "(không tên)"}</div>
                  <div className="text-xs text-muted-foreground">{r.email ?? ""}</div>
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => (r.dangNhan ? setTatId(r.userId) : setBatId(r.userId))}
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      r.dangNhan
                        ? "bg-state-success-soft text-state-success-ink"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {r.dangNhan ? "Đang nhận" : "Tạm nghỉ"}
                  </button>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-foreground">{r.luotDaNhan}</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {r.tongDangGiu}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{ngayGio(r.lanChiaGanNhat)}</td>
                <td className="px-4 py-3 max-w-[220px] truncate text-muted-foreground" title={r.lyDoTam ?? ""}>
                  {r.lyDoTam ?? (r.daCoHang ? "" : "Chưa từng được chia")}
                </td>
                {laQuanTri && (
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      title="Chỉnh lượt thủ công"
                      onClick={() => {
                        setChinhId(r.userId);
                        setSoLuot(String(r.viTriVong));
                      }}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/quan-ly-chia-lead/lich-su?co_so=${centerId}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <History className="h-4 w-4" /> Lịch sử thay đổi pool
        </Link>
        {laQuanTri && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setMoDatLai(true)}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            Đặt lại lượt toàn cơ sở
          </button>
        )}
      </div>

      {/* ⚠️ GIỮ NGUYÊN VĂN — đây là câu trả lời cho khiếu nại hay gặp nhất về bảng này. */}
      <p className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        Cột <strong>Lượt đã nhận</strong> chỉ đếm lead do hệ thống chia tự động. Lead do
        quản lý giao tay, lead sale tự nhập và lead import từ Excel có sẵn tên sale thì
        không tiêu lượt, nên <strong>Tổng lead đang giữ</strong> thường cao hơn{" "}
        <strong>Lượt đã nhận</strong>. Đây không phải lỗi.
      </p>

      {/* Tắt — BẮT BUỘC lý do */}
      {tatId && (
        <Hop
          tieuDe="Tắt nhận lead"
          moTa="Người này sẽ thôi nhận lead tự động. Bộ đếm lượt giữ nguyên, không bị xoá."
          onDong={() => {
            setTatId(null);
            setLyDo("");
          }}
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              Lý do (bắt buộc)
            </span>
            <input
              autoFocus
              value={lyDo}
              onChange={(e) => setLyDo(e.target.value)}
              placeholder="Nghỉ phép, chuyển việc…"
              className={oCls}
            />
          </label>
          <button
            type="button"
            disabled={!lyDo.trim() || pending}
            onClick={() =>
              chay(
                () => tatNhanLeadAction({ centerId, userId: tatId, reason: lyDo }),
                () => {
                  setTatId(null);
                  setLyDo("");
                },
              )
            }
            className="w-full rounded-lg bg-state-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Tắt nhận lead
          </button>
        </Hop>
      )}

      {/* Bật lại — nói rõ hậu quả TRƯỚC khi bấm */}
      {batId && (
        <Hop
          tieuDe="Bật lại nhận lead"
          moTa={`Lượt sẽ được đặt lại về ${minHienThi} để không nhận dồn lead.`}
          onDong={() => setBatId(null)}
        >
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              chay(() => batNhanLeadAction({ centerId, userId: batId }), () => setBatId(null))
            }
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            Bật lại
          </button>
        </Hop>
      )}

      {/* Đặt lại lượt toàn cơ sở — chỉ Quản trị. Về MIN, KHÔNG về 0. */}
      {moDatLai && laQuanTri && (
        <Hop
          tieuDe="Đặt lại lượt toàn cơ sở"
          moTa={`Mọi người đang nhận lead sẽ về mức ${minHienThi} — mức THẤP NHẤT hiện tại, không phải 0. Số lead mỗi người đã nhận vẫn giữ nguyên.`}
          onDong={() => {
            setMoDatLai(false);
            setLyDoDatLai("");
          }}
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              Lý do (bắt buộc)
            </span>
            <input
              autoFocus
              value={lyDoDatLai}
              onChange={(e) => setLyDoDatLai(e.target.value)}
              placeholder="San lại đầu kỳ, sự cố chia lệch…"
              className={oCls}
            />
          </label>
          <button
            type="button"
            disabled={!lyDoDatLai.trim() || pending}
            onClick={() =>
              chay(
                () => datLaiLuotAction({ centerId, reason: lyDoDatLai }),
                () => {
                  setMoDatLai(false);
                  setLyDoDatLai("");
                },
              )
            }
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            Đặt lại lượt
          </button>
        </Hop>
      )}

      {/* Chỉnh lượt thủ công — chỉ Quản trị */}
      {chinhId && laQuanTri && (
        <Hop
          tieuDe="Chỉnh lượt thủ công"
          moTa="Chỉ dùng khi bộ đếm lệch vì sự cố. Thao tác này được ghi vào lịch sử pool."
          onDong={() => {
            setChinhId(null);
            setLyDoChinh("");
          }}
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Số lượt</span>
            <input
              type="number"
              min={0}
              value={soLuot}
              onChange={(e) => setSoLuot(e.target.value)}
              className={oCls}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              Lý do (bắt buộc)
            </span>
            <input
              value={lyDoChinh}
              onChange={(e) => setLyDoChinh(e.target.value)}
              className={oCls}
            />
          </label>
          <button
            type="button"
            disabled={!lyDoChinh.trim() || pending}
            onClick={() =>
              chay(
                () =>
                  chinhLuotAction({
                    centerId,
                    userId: chinhId,
                    turns: Number(soLuot),
                    reason: lyDoChinh,
                  }),
                () => {
                  setChinhId(null);
                  setLyDoChinh("");
                },
              )
            }
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            Lưu
          </button>
        </Hop>
      )}
    </div>
  );
}

/** Hộp xác nhận tối giản — không kéo thêm thư viện cho một màn quản trị. */
function Hop({
  tieuDe,
  moTa,
  onDong,
  children,
}: {
  tieuDe: string;
  moTa: string;
  onDong: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md space-y-3 rounded-xl border border-border bg-card p-5 shadow-lg">
        <h3 className="text-sm font-bold text-foreground">{tieuDe}</h3>
        <p className="text-sm text-muted-foreground">{moTa}</p>
        {children}
        <button
          type="button"
          onClick={onDong}
          className="w-full rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
        >
          Huỷ
        </button>
      </div>
    </div>
  );
}
