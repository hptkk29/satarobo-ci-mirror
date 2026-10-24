// components/admin/nguon-hoa-hong/affiliate/nguon-xem-truoc.tsx — MỘT dòng «nguồn khách đối tác này sẽ được gán trong campaign X, và vì sao» (AFF-L3a). Chỉ VẼ kết quả của `giaiNguonCuaDoiTac`
// (qua `xemTruocNguon`, lib/affiliate/ghi-campaign-dau-vao.ts) — không có thứ tự ưu tiên thứ hai ở đây. Thiếu cấu hình ⇒ «Cần xem tay» KÈM LÝ DO, không bao giờ «không rõ».
// Không hook, không `"use client"`: dùng được ở cả server lẫn client.
import { TriangleAlert } from "lucide-react";
import type { KetQuaXemTruoc } from "@/lib/affiliate/ghi-campaign-dau-vao";
import { NHAN_TU_DAU } from "@/lib/affiliate/giai-nguon";

export function NguonXemTruoc({ ketQua }: { ketQua: KetQuaXemTruoc }) {
  if (ketQua.loai === "XEM_TAY") {
    return (
      <span data-nguon="xem-tay" className="flex items-start gap-1.5 text-sm text-state-warning-ink">
        <TriangleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          <b className="font-semibold">Cần xem tay</b> — {ketQua.lyDo}
        </span>
      </span>
    );
  }
  return (
    <span data-nguon="co-nguon" className="block text-sm text-foreground">
      <span className="font-medium">{ketQua.nguon ? ketQua.nguon.ten : "Nguồn không còn tồn tại"}</span>
      <span className="text-muted-foreground"> · {NHAN_TU_DAU[ketQua.tu]}</span>
      {ketQua.canhBao && (
        <span className="mt-0.5 flex items-start gap-1.5 text-state-warning-ink">
          <TriangleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{ketQua.canhBao}</span>
        </span>
      )}
    </span>
  );
}
