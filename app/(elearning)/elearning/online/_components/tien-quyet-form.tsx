"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { datTienQuyetAction } from "../_actions";
import { GOI_Y_O, NHAN_O, NUT_PHU, O_CHON } from "../../_components/ui/dieu-khien";

/** Khoá tiên quyết: Không · Khuyến nghị · Bắt buộc. “Bắt buộc” chỉ được kiểm khi MUA (cần dữ liệu hoàn thành khoá trước) — xem hợp đồng bàn giao. */
export function TienQuyetForm({ courseId, mode, khoaTienQuyetId, khoaKhac }: { courseId: string; mode: "NONE" | "RECOMMENDED" | "REQUIRED"; khoaTienQuyetId: string | null; khoaKhac: { id: string; code: string; name: string }[] }) {
  const router = useRouter();
  const [dangChay, chuyen] = useTransition();
  const [m, setM] = useState(mode);
  const [k, setK] = useState(khoaTienQuyetId ?? "");
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        chuyen(async () => {
          const r = await datTienQuyetAction({ courseId, mode: m, prerequisiteCourseId: m === "NONE" ? null : k || null });
          if (!r.ok) return void toast.error(r.error.message);
          toast.success("Đã lưu khoá tiên quyết");
          router.refresh();
        });
      }}
    >
      <div>
        <label htmlFor="tq-mode" className={NHAN_O}>Khoá tiên quyết</label>
        <select id="tq-mode" className={O_CHON} value={m} onChange={(e) => setM(e.target.value as typeof m)}>
          <option value="NONE">Không</option>
          <option value="RECOMMENDED">Khuyến nghị</option>
          <option value="REQUIRED">Bắt buộc</option>
        </select>
      </div>
      {m !== "NONE" ? (
        <div className="min-w-[220px]">
          <label htmlFor="tq-khoa" className={NHAN_O}>Khoá</label>
          <select id="tq-khoa" className={O_CHON} value={k} onChange={(e) => setK(e.target.value)}>
            <option value="">— Chọn khoá —</option>
            {khoaKhac.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.code})</option>)}
          </select>
        </div>
      ) : null}
      <button type="submit" className={NUT_PHU} disabled={dangChay}>Lưu</button>
      <p className={`${GOI_Y_O} basis-full`}>Không tạo vòng (A cần B, B cần A). “Bắt buộc” do bước mua kiểm; hiện chưa có luồng mua nên chưa chặn ai.</p>
    </form>
  );
}
