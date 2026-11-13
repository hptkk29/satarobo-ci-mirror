"use client";

// Nhật ký sự cố (Exception Center cơ bản). Sự cố do Agent báo qua /incidents, gộp theo ngày; không văn bản tự do, không PII.
// Hành động: Nhận (OPEN→ACKED) · Giao · Đóng (cần lý do) · Mở lại (cần lý do). Máy chủ đổi CÓ ĐIỀU KIỆN theo trạng thái đang thấy:
// hai người bấm cùng lúc thì người sau nhận "vừa được người khác xử lý" thay vì ghi đè.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { SuCoView } from "@/lib/ai-lead/dich-vu/ket-noi";
import { xuLySuCoAction } from "../_actions";
import { gioVn } from "../../_components/dinh-dang";
import { LOP_O_CHON } from "../../_components/lop";
import { NhanDon, type Tone } from "../../_components/nhan-trang-thai";
import { NutLyDo } from "../../_components/nut-ly-do";

const TONE_MUC: Record<SuCoView["severity"], Tone> = { LOW: "muted", MEDIUM: "info", HIGH: "warning", CRITICAL: "danger" };
const CHU_MUC: Record<SuCoView["severity"], string> = { LOW: "Thấp", MEDIUM: "Vừa", HIGH: "Cao", CRITICAL: "Nghiêm trọng" };
const CHU_TT: Record<SuCoView["state"], string> = { OPEN: "Mới", ACKED: "Đã nhận", RESOLVED: "Đã đóng" };
const TONE_TT: Record<SuCoView["state"], Tone> = { OPEN: "warning", ACKED: "info", RESOLVED: "muted" };

function DongSuCo({ s, nguoiXuLy, duocXuLy }: { s: SuCoView; nguoiXuLy: { id: string; name: string }[]; duocXuLy: boolean }) {
  const router = useRouter();
  const [dang, batDau] = useTransition();
  const [loi, datLoi] = useState<string | null>(null);
  const [nguoi, datNguoi] = useState(s.assigneeId ?? "");

  function chay(input: Record<string, unknown>) {
    datLoi(null);
    batDau(async () => {
      const r = await xuLySuCoAction({ id: s.id, ...input });
      if (!r.ok) datLoi(r.error);
      else router.refresh();
    });
  }

  return (
    <li className="grid gap-2 rounded-xl border border-border bg-card p-4" data-su-co={s.id} data-state={s.state}>
      <div className="flex flex-wrap items-center gap-2">
        <NhanDon tone={TONE_MUC[s.severity]}>{CHU_MUC[s.severity]}</NhanDon>
        <NhanDon tone={TONE_TT[s.state]}>{CHU_TT[s.state]}</NhanDon>
        <span className="min-w-0 break-words text-sm font-semibold">{s.detailCode}</span>
        <span className="text-xs text-muted-foreground">×{s.count}</span>
      </div>
      <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
        {s.agentName} · {s.category}
        {s.pageId ? <> · Page {s.pageId}</> : <> · không gắn Page</>} · lần đầu {gioVn(s.firstSeenAt)} · gần nhất {gioVn(s.lastSeenAt)}
        {s.lastCorrelationId ? <> · correlationId {s.lastCorrelationId}</> : null}
      </p>
      <p className="text-xs">Người phụ trách: {s.assigneeName ?? "chưa giao"}</p>
      {duocXuLy ? (
        <div className="flex flex-wrap items-end gap-2">
          {s.state === "OPEN" ? (
            <Button type="button" variant="outline" className="min-h-11" disabled={dang} onClick={() => chay({ hanhDong: "ACK" })}>
              Nhận
            </Button>
          ) : null}
          {s.state !== "RESOLVED" ? (
            <>
              <div className="grid gap-1">
                <label htmlFor={`gi-${s.id}`} className="text-xs text-muted-foreground">
                  Giao cho
                </label>
                <select id={`gi-${s.id}`} className={`${LOP_O_CHON} w-48`} value={nguoi} onChange={(e) => datNguoi(e.target.value)} disabled={dang}>
                  <option value="">— Chọn người —</option>
                  {nguoiXuLy.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="button" variant="outline" className="min-h-11" disabled={dang || !nguoi || nguoi === s.assigneeId} onClick={() => chay({ hanhDong: "GIAO", assigneeId: nguoi })}>
                Giao
              </Button>
              {s.assigneeId ? (
                <Button type="button" variant="ghost" className="min-h-11" disabled={dang} onClick={() => chay({ hanhDong: "BO_GIAO" })}>
                  Bỏ giao
                </Button>
              ) : null}
              <NutLyDo
                nhan="Đóng sự cố"
                tieuDe="Đóng sự cố này?"
                moTa="Ghi rõ đã xử lý thế nào. Nếu Agent báo lại cùng sự cố trong ngày, nó vẫn gộp vào dòng này."
                nhanXacNhan="Đóng sự cố"
                nguyHiem={false}
                thongBaoXong="Đã đóng sự cố."
                chay={(lyDo) => xuLySuCoAction({ id: s.id, hanhDong: "DONG", lyDo })}
              />
            </>
          ) : (
            <NutLyDo
              nhan="Mở lại"
              tieuDe="Mở lại sự cố?"
              moTa="Sự cố trở về trạng thái Mới."
              nhanXacNhan="Mở lại"
              nguyHiem={false}
              thongBaoXong="Đã mở lại sự cố."
              chay={(lyDo) => xuLySuCoAction({ id: s.id, hanhDong: "MO_LAI", lyDo })}
            />
          )}
        </div>
      ) : null}
      {loi ? (
        <p role="alert" className="text-sm text-state-danger-ink">
          {loi}
        </p>
      ) : null}
    </li>
  );
}

export function DanhSachSuCo({ rows, nguoiXuLy, duocXuLy }: { rows: SuCoView[]; nguoiXuLy: { id: string; name: string }[]; duocXuLy: boolean }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center">
        <p className="text-sm font-semibold">Không có sự cố nào khớp bộ lọc</p>
        <p className="mt-1 text-sm text-muted-foreground">Agent chưa báo sự cố, hoặc bộ lọc đang loại hết. Thử bỏ bớt bộ lọc.</p>
      </div>
    );
  }
  return (
    <ul className="grid gap-3 xl:grid-cols-2">
      {rows.map((s) => (
        <DongSuCo key={s.id} s={s} nguoiXuLy={nguoiXuLy} duocXuLy={duocXuLy} />
      ))}
    </ul>
  );
}
