"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { diemDanhBuoiAction } from "../_actions";
import { EmptyState } from "@/components/admin/ui/states";

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
      <p className="text-sm text-muted-foreground">
        <strong className="text-foreground">
          {soDu}/{props.dsHoc.length}
        </strong>{" "}
        người đã được ghi có mặt. Bài này chỉ tính là xong khi có người tick — không có
        đường tự động nào.
      </p>

      {props.dsHoc.length === 0 ? (
        // Danh sách rỗng KHÁC lỗi tải: nói rõ nguyên nhân và bước tiếp.
        <EmptyState
          title="Chưa có ai để điểm danh"
          description="Chưa ai được giao khoá này. Giao khoá ở màn “Giao khoá” trước."
        />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {props.dsHoc.map((h) => (
            <li
              key={h.enrollmentId}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
            >
              <span className="min-w-0">
                <span className="font-medium">{h.tenNguoiHoc}</span>
                {h.nguoiTick ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    do {h.nguoiTick} ghi
                  </span>
                ) : null}
              </span>
              <label className="flex min-h-9 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
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

      <p className="text-sm text-muted-foreground">
        Bỏ tick sẽ xoá cả mốc xác nhận — dùng khi ghi nhầm người, không dùng để sửa
        ngày.
      </p>
    </div>
  );
}
