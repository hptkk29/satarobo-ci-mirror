"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { suaBaiAction } from "../_actions";
import { GOI_Y_O, NHAN_O, NUT_PHU, O_NHAP_GOC } from "../../_components/ui/dieu-khien";
import { keHoachXemMienPhi, nhanBaiDangMienPhi, soBaiDauDangMienPhi, soBaiDuDieuKienXemMienPhi, type ChuongXemMienPhi } from "../_lib/xem-mien-phi";

/**
 * QoChuong — khối "Xem miễn phí": đặt MỘT LẦN "N bài đầu tiên" cho xem thử không cần mua (cờ `freePreview` của từng bài).
 * Không có đường ghi riêng: mỗi bài lệch đi qua `suaBaiAction` (cùng cổng quyền + kiểm bản nháp như nút "Sửa" ở từng dòng).
 * Lỗi giữa chừng ⇒ báo rõ đã đổi mấy bài; bấm lại là hoàn tất phần còn lại (kế hoạch chỉ gồm bài còn lệch).
 */
export function XemMienPhiThe({ chuong }: { chuong: ChuongXemMienPhi[] }) {
  const router = useRouter();
  const [dangChay, chuyen] = useTransition();
  const toiDa = soBaiDuDieuKienXemMienPhi(chuong);
  const dang = nhanBaiDangMienPhi(chuong);
  const [n, setN] = useState(() => String(soBaiDauDangMienPhi(chuong)));
  const soN = Math.max(0, Math.min(toiDa, Math.floor(Number(n) || 0)));

  const apDung = () =>
    chuyen(async () => {
      const kh = keHoachXemMienPhi(chuong, soN);
      if (kh.length === 0) return void toast.success("Không có bài nào cần đổi");
      let xong = 0;
      for (const k of kh) {
        const r = await suaBaiAction({ lessonId: k.lessonId, freePreview: k.freePreview });
        if (!r.ok) {
          toast.error(`${r.error.message} (đã đổi ${xong}/${kh.length} bài — bấm Áp dụng lại để hoàn tất)`);
          if (xong > 0) router.refresh();
          return;
        }
        xong += 1;
      }
      toast.success(`Đã đặt ${soN} bài đầu tiên xem miễn phí`);
      router.refresh();
    });

  return (
    <section aria-label="Xem miễn phí" className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-[15px] font-semibold">Xem miễn phí</h3>
      <p className="mt-1 text-[13px] text-muted-foreground">Cho xem thử các bài này mà không cần mua khoá. Bài kiểm tra, thi cuối khoá và bài ẩn không áp dụng.</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="xmp-n" className={NHAN_O}>Miễn phí</label>
          <input id="xmp-n" type="number" min={0} max={toiDa} inputMode="numeric" className={`${O_NHAP_GOC} w-20`} value={n} onChange={(e) => setN(e.target.value)} />
        </div>
        <span className="pb-2 text-sm">bài đầu tiên</span>
        <button type="button" className={NUT_PHU} disabled={dangChay || toiDa === 0} onClick={apDung}>{dangChay ? "Đang áp dụng…" : "Áp dụng"}</button>
      </div>
      <p className={GOI_Y_O}>
        Áp dụng đặt ĐÚNG số bài này: các bài miễn phí khác (kể cả bài bạn đã đánh dấu tay) sẽ bị tắt. Hoặc đánh dấu “Miễn phí” ở từng bài (nút Sửa). {dang.length ? `Đang miễn phí: ${dang.join(", ")}.` : "Hiện chưa bài nào miễn phí."}
        {toiDa === 0 ? " Chưa có bài nào đủ điều kiện." : ` Tối đa ${toiDa} bài.`}
      </p>
    </section>
  );
}
