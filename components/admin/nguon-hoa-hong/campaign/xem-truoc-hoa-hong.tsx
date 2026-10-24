// components/admin/nguon-hoa-hong/campaign/xem-truoc-hoa-hong.tsx — XEM TRƯỚC «hoa hồng dự kiến» của campaign với một đối tác mẫu (AFF-L1). Server Component thuần trình bày: số liệu do
// `docXemTruocHoaHongCampaign` tính bằng CHÍNH hàm tính của engine (không bộ mô phỏng thứ hai).
//
// Nói thật (luật 12): đây là MỘT khoản mẫu — câu giả định in ngay dưới kết quả; vai không có người chỉ vào TRẦN, không hiện tiền; «Chưa tính được» luôn kèm LÝ DO (không bao giờ "0đ" cho thứ chưa biết).
// Không dùng `<table>`: danh sách vai ngắn (≤ 9) nên là danh sách mô tả, tránh lưới `bang-coverage`.
import Link from "next/link";
import type { KetQuaXemTruocHoaHong } from "@/lib/affiliate/xem-truoc-hoa-hong";
import { dinhDangPhanTram } from "@/lib/hoa-hong/phan-tram";
import { dinhDangDong } from "@/lib/hoa-hong/vi-sao";
import { cn } from "@/lib/utils";

const phanTram = (x: number): string => `${dinhDangPhanTram(String(Math.round(x * 1_000_000) / 1_000_000))}%`;

export function XemTruocHoaHong({ ketQua, daChonDoiTac, hrefTran }: { ketQua: KetQuaXemTruocHoaHong | null; daChonDoiTac: boolean; hrefTran: string | null }) {
  return (
    <section aria-label="Xem trước hoa hồng dự kiến" className="mt-4 space-y-2 rounded-xl border border-border bg-card px-4 py-3">
      <h3 className="text-sm font-semibold text-foreground">Xem trước hoa hồng dự kiến</h3>
      <Noi dung={ketQua} daChonDoiTac={daChonDoiTac} hrefTran={hrefTran} />
    </section>
  );
}

function Noi({ dung, daChonDoiTac, hrefTran }: { dung: KetQuaXemTruocHoaHong | null; daChonDoiTac: boolean; hrefTran: string | null }) {
  if (dung === null) {
    return (
      <p className="text-sm text-muted-foreground">
        {daChonDoiTac ? "Không tìm thấy đối tác này." : "Chọn một đối tác ở mục "}
        {!daChonDoiTac && (
          <Link href="#xem-truoc-nguon" className="font-semibold text-primary-ink underline underline-offset-2 hover:no-underline">
            Xem trước nguồn
          </Link>
        )}
        {!daChonDoiTac && " bên dưới để xem đối tác đó sẽ nhận bao nhiêu trên một khoản học phí mẫu."}
      </p>
    );
  }
  if (dung.loai === "NGUON_XEM_TAY") return <p className="text-sm text-state-warning-ink">Chưa tính được: nguồn của đối tác này cần xem tay — {dung.lyDo}</p>;
  if (dung.loai === "CHUA_CO_CHINH_SACH") return <p className="text-sm text-muted-foreground">Campaign chưa có chính sách riêng nào (nháp hoặc đang áp) nên chưa có gì để xem trước.</p>;
  if (dung.loai === "CHONG_LAN") return <p className="text-sm text-state-danger-ink">Có hai quy tắc cùng hạng cho cùng một vai — cấu hình mâu thuẫn, engine sẽ không ghi gì: {dung.lyDo}</p>;
  if (dung.loai === "VUOT_TRAN") {
    return (
      <p role="alert" className="text-sm text-state-danger-ink">
        Tổng các vai trên khoản mẫu là <b>{phanTram(dung.tiLe)}</b>, vượt trần <b>{phanTram(dung.tran)}</b> — chính sách này sẽ bị chặn lúc kích hoạt, và nếu cố tình có hiệu lực thì cả khoản không sinh dòng nào.{" "}
        {hrefTran ? (
          <Link href={hrefTran} className="font-semibold underline underline-offset-2 hover:no-underline">
            Nâng trần ở Cấu hình vận hành
          </Link>
        ) : (
          "Nâng trần là thao tác của quản trị hệ thống (Cấu hình vận hành). Hệ thống không tự cắt vai nào."
        )}
      </p>
    );
  }
  const aff = dung.vai.find((v) => v.roleCode === "AFFILIATE");
  const vuotGanTran = dung.tiLeTuongDuong >= dung.tran;
  return (
    <div className="space-y-3">
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[11rem_minmax(0,1fr)]">
        <dt className="text-muted-foreground">Campaign</dt>
        <dd>{dung.campaign}</dd>
        <dt className="text-muted-foreground">Nguồn (đã giải)</dt>
        <dd>{dung.nguon}</dd>
        <dt className="text-muted-foreground">Đối tác mẫu</dt>
        <dd>{dung.doiTac}</dd>
        <dt className="text-muted-foreground">Sự kiện</dt>
        <dd>{dung.suKien}</dd>
        <dt className="text-muted-foreground">Cơ sở tính</dt>
        <dd className="tabular-nums">{dinhDangDong(dung.coSo)} thực thu sau VAT</dd>
        <dt className="text-muted-foreground">Chính sách</dt>
        <dd>
          {dung.chinhSach.policyCode} · v{dung.chinhSach.versionNo} · {dung.chinhSach.trangThai === "DRAFT" ? "bản nháp (xem trước nếu kích hoạt)" : "đang áp"}
        </dd>
      </dl>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {dung.vai.map((v) => (
          <li key={v.roleCode} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2 text-sm">
            <span className={cn("font-medium", v.roleCode === "AFFILIATE" ? "text-foreground" : "text-muted-foreground")}>{v.vai}</span>
            <span className="text-muted-foreground">{v.quyTac ?? "—"}</span>
            <span className={cn("tabular-nums", v.soTien === null ? "text-muted-foreground" : "font-semibold text-foreground")}>{v.soTien === null ? (v.ghiChu ?? "—") : dinhDangDong(v.soTien)}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm">
        Hoa hồng dự kiến của đối tác:{" "}
        <b className="tabular-nums">{aff?.soTien == null ? "không có (campaign chưa có mức cho vai đối tác)" : dinhDangDong(aff.soTien)}</b>. Tổng các vai trên khoản mẫu{" "}
        <b className={cn(vuotGanTran && "text-state-warning-ink")}>{phanTram(dung.tiLeTuongDuong)}</b> / trần <b>{phanTram(dung.tran)}</b>.
      </p>
      <p className="text-xs text-muted-foreground">
        Giả định: một khoản học phí mẫu, giao dịch ở Hội sở, đối tác là người hưởng duy nhất — các vai khác (Sale, quản lý cơ sở…) không có người trong ví dụ nên chỉ tính vào trần. Cửa sổ ghi công 90 ngày không
        được đo. Muốn thử trên khoản thu thật: bước «Thử tính» trong trình soạn chính sách.
      </p>
    </div>
  );
}
