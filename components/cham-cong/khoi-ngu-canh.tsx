// components/cham-cong/khoi-ngu-canh.tsx — PHẦN TÓM TẮT trong thẻ "Hôm nay" của màn Chấm công khi người đó có việc Parttime
// (tiết dạy / trợ giảng / trực). Chỉ THAY dòng ca của thẻ — thẻ, đồng hồ vé, nhãn định vị và MỘT nút "Chấm công" giữ nguyên.
// Dùng chung admin + site GV ⇒ CHỈ token `:root` (không `primary-soft` / `primary-ink`). Không có công / tiền ở đây (§46).
import type { NguCanhChamCong } from "@/lib/parttime/ngu-canh-cham-cong";

export function KhoiNguCanh({ nc }: { nc: NguCanhChamCong }) {
  const t = nc.nextTeaching;
  return (
    <div className="mt-2 space-y-2 text-sm text-muted-foreground">
      {nc.normalShift && (
        <p>
          <span className="font-medium text-foreground">Ca:</span> {nc.normalShift.ten}
          {nc.normalShift.timeLabel && <span className="font-mono tabular-nums"> {nc.normalShift.timeLabel}</span>}
        </p>
      )}
      {nc.operationsDuty && (
        <p>
          <span className="font-medium text-foreground">Ca trực {nc.operationsDuty.shiftCode}:</span>{" "}
          <span className="font-mono tabular-nums">{nc.operationsDuty.gio}</span>
          {nc.operationsDuty.khacCoSo && <> · ở {nc.operationsDuty.khacCoSo}</>}
        </p>
      )}
      {t && (
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground">{t.tieuDe}</p>
          <p className="text-base font-semibold text-foreground">{t.nhanLop}</p>
          <p>
            <span className="font-mono tabular-nums">{t.gio}</span> · {t.nhanVai}
            {t.khacCoSo && <> · ở {t.khacCoSo}</>}
          </p>
          <p>
            Có mặt trước <strong className="tabular-nums text-foreground">{t.coMatTruoc}</strong>
          </p>
          {t.bangChung && <p>Chấm công: <span className="text-foreground">{t.bangChung}</span></p>}
        </div>
      )}
      {nc.teaching.length > 1 && (
        <p>
          {nc.teaching.length} tiết dạy hôm nay
          {nc.sauDo && (
            <>
              {" "}· Sau đó: <span className="text-foreground">{nc.sauDo.nhanLop}</span> <span className="font-mono tabular-nums">{nc.sauDo.gio}</span>
            </>
          )}
        </p>
      )}
      {nc.warnings.map((w) => (
        <p key={w.ma} role="note" className="rounded-lg bg-state-warning-soft px-3 py-2 text-xs text-state-warning-ink">
          {w.cau}
          {w.ma === "KHONG_LICH" && " Vẫn chấm được — Quản lý sẽ rà cờ “ngoài lịch”."}
        </p>
      ))}
    </div>
  );
}
