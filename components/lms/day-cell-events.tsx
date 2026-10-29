"use client";

// Danh sách lớp trong MỘT ô ngày của lịch tháng, có phân trang tại chỗ.
//
// ─────────────────────────────────────────────────────────────────────────────
// Vì sao (chủ dự án 05/09/2026)
//
// Ô ngày cũ in 4 lớp rồi bỏ phần còn lại sau một dòng "+3" / "+4" — con số đó không
// bấm được và không dẫn đi đâu, nên ngày đông lớp là ngày KHÔNG XEM ĐƯỢC: muốn biết
// lớp thứ năm là lớp nào thì không có đường nào trong màn này.
//
// Nay: mặc định 5 lớp/ngày; quá 5 thì có nút lên/xuống ở góc dưới bên phải để lật
// sang trang tiếp theo CỦA RIÊNG ô ngày đó.
//
// Client component vì trạng thái trang thuộc TỪNG ô: đưa lên URL thì một lưới tháng
// có tới 42 ô, mỗi ô một tham số — địa chỉ không đọc nổi và mỗi lần lật là một vòng
// tải lại toàn trang. `MonthCalendar` vẫn là Server Component, chỉ phần thân ô này
// chạy ở trình duyệt.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import type { CalEvent } from "@/lib/lms/cal-event";
import { MOI_TRANG, tinhTrangNgay } from "@/lib/lms/phan-trang-ngay";

export function DayCellEvents({ events }: { events: CalEvent[] }) {
  const [trang, setTrang] = useState(0);

  const { soTrang, trangHienTai, dau, coPhanTrang } = tinhTrangNgay(events.length, trang);
  const hienRa = events.slice(dau, dau + MOI_TRANG);

  const nut =
    "flex h-4 w-4 items-center justify-center rounded border border-neutral-300 " +
    "text-neutral-600 enabled:hover:bg-neutral-100 enabled:hover:text-neutral-900 " +
    "disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-orange-400";

  return (
    <div className="space-y-0.5">
      {hienRa.map((e) => (
        <div
          // Khoá theo NỘI DUNG + vị trí thật trong danh sách, không theo chỉ số của
          // lát cắt: dùng chỉ số lát cắt thì lật trang là React tưởng cùng phần tử
          // và giữ nguyên DOM cũ.
          key={`${dau}-${e.label}-${e.sublabel ?? ""}`}
          className="truncate rounded bg-orange-100 px-1 text-[10px] text-orange-800"
          title={`${e.label}${e.sublabel ? ` · ${e.sublabel}` : ""}`}
        >
          {e.sublabel ? `${e.sublabel} ` : ""}
          {e.label}
        </div>
      ))}

      {coPhanTrang && (
        // Góc DƯỚI BÊN PHẢI của ô ngày (chủ dự án). `justify-end` + nằm cuối khối
        // nội dung là đủ — ô ngày không cố định chiều cao nên không cần định vị tuyệt
        // đối, và định vị tuyệt đối ở đây sẽ đè lên dòng lớp cuối khi ô bị bóp hẹp.
        <div className="flex items-center justify-end gap-1 pt-0.5">
          <span className="text-[9px] tabular-nums text-neutral-400">
            {trangHienTai + 1}/{soTrang}
          </span>
          <button
            type="button"
            className={nut}
            disabled={trangHienTai === 0}
            onClick={() => setTrang(trangHienTai - 1)}
            aria-label="Trang trước của ngày này"
          >
            <ChevronUp className="h-3 w-3" aria-hidden />
          </button>
          <button
            type="button"
            className={nut}
            disabled={trangHienTai >= soTrang - 1}
            onClick={() => setTrang(trangHienTai + 1)}
            aria-label="Trang sau của ngày này"
          >
            <ChevronDown className="h-3 w-3" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
