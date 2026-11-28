"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { thuHoiChungNhanAction } from "../_actions";
import { NUT_NGUY, NUT_NHO, O_NHAP } from "../../_components/ui/dieu-khien";
import { TrangThaiBadge } from "../../_components/ui/trang-thai-badge";
import { dinhDangNgay } from "@/lib/elearning-online/hien-thi";
import { hienThiMaChungNhan } from "@/lib/elearning-online/ma-chung-nhan";

export { HangChoCham, type LuotCho } from "./hang-cho-cham";

export type DongChungNhan = { id: string; code: string; status: "ISSUED" | "REVOKED"; studentId: string; studentName: string; versionNumber: number; finalScore: number | null; issuedAt: string; issuedByUserId: string | null; revokedReason: string | null };

/** Chứng nhận của một khoá: danh sách + thu hồi (lý do) + cấp tay cho học viên đã có quyền học. */
export function ChungNhanKhoa({ courseId, dong, tong, duocCap }: { courseId: string; dong: DongChungNhan[]; tong: number; duocCap: boolean }) {
  const router = useRouter();
  const [dangChay, chuyen] = useTransition();
  const [thu, setThu] = useState<{ studentId: string; ten: string; lyDo: string } | null>(null);
  return (
    <div>
      {dong.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">Chưa có chứng nhận nào.</p> : null}
      <ul className="divide-y divide-border">
        {dong.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
            <span className="font-mono text-xs">{hienThiMaChungNhan(c.code)}</span>
            <span className="min-w-0 flex-1 font-medium">{c.studentName}</span>
            <span className="text-xs text-muted-foreground">bản {c.versionNumber}{c.finalScore !== null ? ` · thi cuối ${c.finalScore}%` : ""} · {dinhDangNgay(c.issuedAt)} · {c.issuedByUserId ? "cấp tay" : "tự động"}</span>
            <TrangThaiBadge sac={c.status === "ISSUED" ? "success" : "muted"}>{c.status === "ISSUED" ? "Hiệu lực" : "Đã thu hồi"}</TrangThaiBadge>
            {c.status === "ISSUED" && duocCap ? <button type="button" className={NUT_NHO} onClick={() => setThu({ studentId: c.studentId, ten: c.studentName, lyDo: "" })}>Thu hồi</button> : null}
          </li>
        ))}
      </ul>
      <p className="px-4 py-2 text-xs text-muted-foreground">Tổng {tong} chứng nhận. Cấp tay ở tab “Quản lý học viên” (nút trên từng dòng). Chứng nhận được GIỮ NGUYÊN khi phát hành bản mới, đặt lại tiến độ hoặc thu hồi/hết hạn quyền học.</p>
      {thu ? (
        <div role="dialog" aria-label="Thu hồi chứng nhận" className="m-4 rounded-lg border border-state-danger/40 p-4">
          <p className="text-sm">Thu hồi chứng nhận của <strong>{thu.ten}</strong>? Tra cứu công khai sẽ báo “đã thu hồi”.</p>
          <label htmlFor="cn-lydo" className="mt-3 block text-[13px] font-medium">Lý do (≥ 10 ký tự)</label>
          <input id="cn-lydo" className={`${O_NHAP} mt-1`} value={thu.lyDo} onChange={(e) => setThu({ ...thu, lyDo: e.target.value })} />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className={NUT_NGUY}
              disabled={dangChay || thu.lyDo.trim().length < 10}
              onClick={() =>
                chuyen(async () => {
                  const r = await thuHoiChungNhanAction({ courseId, studentId: thu.studentId }, { reason: thu.lyDo.trim() });
                  if (!r.ok) return void toast.error(r.error.message);
                  toast.success("Đã thu hồi chứng nhận");
                  setThu(null);
                  router.refresh();
                })
              }
            >
              Thu hồi
            </button>
            <button type="button" className={NUT_NHO} onClick={() => setThu(null)}>Huỷ</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
