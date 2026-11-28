"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { doiTrangThaiBanAction } from "../_actions";
import { GOI_Y_O, NHAN_O, NUT_PHU, O_CHON, O_NHAP } from "../../_components/ui/dieu-khien";
import { NHAN_BAN } from "@/lib/elearning-online/hien-thi";

/** Đổi trạng thái BÁN của khoá (không đổi nội dung). Mở bán/hẹn giờ chỉ khi đã có bản phát hành — server từ chối nếu chưa. */
export function DoiTrangThaiBan({ courseId, hienTai, moBanLuc, daPhatHanh, duocSua }: { courseId: string; hienTai: string; moBanLuc: string | null; daPhatHanh: boolean; duocSua: boolean }) {
  const router = useRouter();
  const [dangChay, chuyen] = useTransition();
  const [tt, setTt] = useState(hienTai);
  const [luc, setLuc] = useState(moBanLuc ? moBanLuc.slice(0, 16) : "");
  if (!duocSua) return null;
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        chuyen(async () => {
          const r = await doiTrangThaiBanAction({ courseId, saleStatus: tt as "ON_SALE", saleOpensAt: tt === "SCHEDULED" && luc ? new Date(luc).toISOString() : null });
          if (!r.ok) return void toast.error(r.error.message);
          toast.success(`Đã chuyển sang “${NHAN_BAN[r.data.sau]?.nhan ?? r.data.sau}”`);
          router.refresh();
        });
      }}
    >
      <div>
        <label htmlFor="tt-ban" className={NHAN_O}>Trạng thái bán</label>
        <select id="tt-ban" className={O_CHON} value={tt} onChange={(e) => setTt(e.target.value)}>
          {Object.entries(NHAN_BAN).map(([k, v]) => (
            <option key={k} value={k} disabled={!daPhatHanh && (k === "ON_SALE" || k === "SCHEDULED")}>{v.nhan}</option>
          ))}
        </select>
      </div>
      {tt === "SCHEDULED" ? (
        <div>
          <label htmlFor="tt-luc" className={NHAN_O}>Mở bán lúc</label>
          <input id="tt-luc" type="datetime-local" className={O_NHAP} value={luc} onChange={(e) => setLuc(e.target.value)} />
        </div>
      ) : null}
      <button type="submit" className={NUT_PHU} disabled={dangChay || tt === hienTai}>Đổi</button>
      {!daPhatHanh ? <p className={`${GOI_Y_O} basis-full`}>Chưa có bản phát hành nên chưa mở bán được.</p> : null}
    </form>
  );
}
