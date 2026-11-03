// components/cham-cong/khoi-ngu-canh.tsx — PHẦN TÓM TẮT trong thẻ "Hôm nay" của màn Chấm công khi người đó có việc Parttime
// (tiết dạy / trợ giảng / trực). Chỉ THAY dòng ca của thẻ — thẻ, đồng hồ vé, nhãn định vị và MỘT nút "Chấm công" giữ nguyên.
// Dùng chung admin + site GV ⇒ CHỈ token `:root` (không `primary-soft` / `primary-ink`). Không có công / tiền ở đây (§46).
import Link from "next/link";
import type { NguCanhChamCong, TietHienThi } from "@/lib/parttime/ngu-canh-cham-cong";
import { duongHoSo, type SiteHoSo } from "@/lib/parttime/nhan-tuan-thu";

const MAU_BUOC = {
  success: "text-state-success-ink",
  warning: "text-state-warning-ink",
  danger: "text-state-danger-ink",
  info: "text-state-info-ink",
  muted: "text-muted-foreground",
} as const;

/**
 * Hồ sơ buổi GỌN trên thẻ Chấm công: chỉ hai việc của học viên (điểm danh · nhận xét) — chấm vào / ra đã có ngay trên thẻ.
 * Lối tắt "Điểm danh lớp" dẫn sang màn điểm danh ĐÃ CÓ; KHÔNG phải nút chấm công thứ hai, và chấm vào KHÔNG điểm danh hộ.
 * Không chặn chấm vào / ra vì thiếu điểm danh hay nhận xét — chỉ nói ra.
 */
function HoSoGon({ t, site }: { t: TietHienThi; site: SiteHoSo }) {
  const n = t.hoSo;
  if (!n) return null;
  const dd = n.buoc.find((b) => b.ma === "DIEM_DANH");
  const nx = n.buoc.find((b) => b.ma === "NHAN_XET");
  const canDiemDanh = !!dd && !dd.xong;
  // Nhắc khi lớp ĐÃ bắt đầu mà chưa đủ điểm danh — làm nổi trên thẻ, không gửi thông báo.
  const nhac = canDiemDanh && t.daBatDau;
  return (
    <div className={nhac ? "mt-1 rounded-md bg-state-warning-soft px-2 py-1.5 text-state-warning-ink" : "mt-1"}>
      {nhac && <p className="text-xs font-semibold">Cần điểm danh học viên</p>}
      {dd && (
        <p className={MAU_BUOC[dd.tone]} title={dd.chiTiet}>
          Điểm danh học viên: <span className="tabular-nums">{dd.nhan.replace(/^Điểm danh /, "")}</span>
          {dd.xong ? " ✓" : " — chưa hoàn thành"}
        </p>
      )}
      {nx && nx.ma === "NHAN_XET" && !nx.choBuocTruoc && (
        <p className={MAU_BUOC[nx.tone]} title={nx.chiTiet}>
          {nx.nhan}
          {nx.xong ? " ✓" : nx.conThieu ? ` · còn thiếu ${nx.conThieu}` : ""}
        </p>
      )}
      {canDiemDanh && t.dich && (
        <Link
          href={duongHoSo(t.dich, site, "diem-danh")}
          className="mt-1 inline-flex min-h-9 items-center rounded-md border border-border bg-background px-2.5 text-xs font-semibold text-foreground hover:bg-muted pointer-coarse:min-h-11"
        >
          Điểm danh lớp
        </Link>
      )}
    </div>
  );
}

export function KhoiNguCanh({ nc, site }: { nc: NguCanhChamCong; site: SiteHoSo }) {
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
          <HoSoGon t={t} site={site} />
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
