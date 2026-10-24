"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { diemDanhBuoiAction } from "../_actions";

/**
 * EL-09 — TICK "ĐÃ DỰ" cho bài dạng `LIVE_SESSION`.
 *
 * ⚠️ Màn này TỪNG KHÔNG TỒN TẠI. `diemDanhBuoiAction` được khai từ EL-09 nhưng
 * grep toàn kho ra **0 màn nào gọi** — tức không ai tick được.
 *
 * Hệ quả không tự lộ ra: bài "Buổi trực tiếp" không bao giờ lên `DONE`, nên mọi
 * khoá kết hợp (có ít nhất một buổi trực tiếp bắt buộc) đứng mãi ở "đang học" —
 * chứng nhận không cấp được, báo cáo tuân thủ đếm thiếu, và con số "công nhận tương
 * đương" trên báo cáo vĩnh viễn bằng 0. Người học thấy mình đã đi học thật, hệ thống
 * thì không.
 */

export type DongDiemDanh = {
  enrollmentId: string;
  tenNguoiHoc: string;
  daDu: boolean;
  nguoiTick: string | null;
};

export function AttendancePanel(props: {
  lessonId: string;
  dsHoc: DongDiemDanh[];
}) {
  const router = useRouter();
  const [dangChay, batDau] = useTransition();
  // ⚠️ Đọc THẲNG từ props, không giữ bản sao trong `useState`: state không đồng bộ
  // khi props đổi đã là lỗi lặp lại bốn lần trong module này.
  const [dangLam, setDangLam] = useState<string | null>(null);

  const tick = (enrollmentId: string, daDu: boolean) =>
    batDau(async () => {
      setDangLam(enrollmentId);
      const r = await diemDanhBuoiAction({
        enrollmentId,
        lessonId: props.lessonId,
        daDu,
      });
      setDangLam(null);
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success(daDu ? "Đã ghi có mặt" : "Đã bỏ đánh dấu");
      if (r.data.cuonLoi) {
        // Điểm danh đã vào sổ nhưng khoá chưa cuộn — nói ra, đừng để người tick
        // tưởng mọi thứ trọn vẹn rồi người học đi hỏi vì sao khoá vẫn chưa xong.
        toast.error(
          "Đã ghi có mặt, nhưng chưa cập nhật được tiến độ khoá — báo kỹ thuật.",
        );
      }
      router.refresh();
    });

  const soDu = props.dsHoc.filter((x) => x.daDu).length;

  return (
    <div className="space-y-3">
      <div className="rounded-md border p-3 text-sm">
        <p className="font-medium">Điểm danh buổi trực tiếp</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {soDu}/{props.dsHoc.length} người đã được ghi có mặt. Bài này chỉ tính là
          xong khi có người tick — không có đường tự động nào.
        </p>
      </div>

      {props.dsHoc.length === 0 ? (
        // Danh sách rỗng KHÁC lỗi tải: nói rõ nguyên nhân và bước tiếp.
        <p className="rounded-md bg-muted px-3 py-2 text-sm">
          Chưa ai được giao khoá này, nên chưa có ai để điểm danh. Giao bài ở màn
          &quot;Giao bài&quot; trước.
        </p>
      ) : (
        <ul className="space-y-1">
          {props.dsHoc.map((h) => (
            <li
              key={h.enrollmentId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
            >
              <span>
                {h.tenNguoiHoc}
                {h.nguoiTick ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    do {h.nguoiTick} ghi
                  </span>
                ) : null}
              </span>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={h.daDu}
                  disabled={dangChay}
                  onChange={(e) => tick(h.enrollmentId, e.target.checked)}
                />
                {dangLam === h.enrollmentId ? "đang ghi…" : "đã dự"}
              </label>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Bỏ tick sẽ xoá cả mốc xác nhận — dùng khi ghi nhầm người, không dùng để sửa
        ngày.
      </p>
    </div>
  );
}
