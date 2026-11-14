import { Download } from "lucide-react";
import { NoiDungTrong } from "@/components/portal/sticker";
import { cn } from "@/lib/utils";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import type { StudentBilling } from "@/lib/portal/billing-student";
import { soTienCoDau, tongPhieuThuHienThi, xepPhieuThuVaDieuChinh } from "@/lib/portal/phieu-thu";
import { nhanTamHoanThu, ngayVN } from "@/lib/portal/tam-hoan-thu";
import { NHAN_DA_NOP, tomTatHocPhi, vnd, type HocPhiTrangThai } from "@/lib/portal/tong-quan-thuan";
import type { MucHoaDon } from "@/lib/portal/hoa-don-phu-huynh";
import { HoaDonPhuHuynh } from "@/components/portal/hoa-don-phu-huynh";
import { SATA_ROBO_PHONE } from "@/lib/locations";

// Cổng phụ huynh — "Học phí", dựng theo artifact Hoc-phi.dc.html.
// KHÔNG vẽ: khối "Đăng ký học tiếp" (chọn gói + lấy mã QR) và khung QR — cổng phụ huynh chưa có luồng tạo đơn / phát mã QR; cột tải
// phiếu thu — chưa có đường tải. Chỉ hiện khoản kế toán ĐÃ XÁC NHẬN (AC1); khoản chờ / bị từ chối chỉ đếm, không lộ số tiền.
// Trạng thái học phí CHỈ có hai nhãn «Đã nộp» / «Chưa nộp» (chủ dự án 03/11/2026) — mọi thông tin khác (còn bao nhiêu, hạn,
// bảo lưu) ở dòng chữ phụ, không phải chip. Mục «Hoá đơn» (kế toán đã xuất) ở cuối trang, tải qua /portal/hoa-don/<id>/tai-ve.

const CARD = "rounded-[18px] border border-border bg-card";
const MUTED = "text-[13px] text-[var(--sr-ink-muted)]";

// Chip trạng thái: «Chưa có khoản học phí» (CHUA_CO) không phải trạng thái nộp ⇒ không vẽ chip.
const CHIP_TT: Record<Exclude<HocPhiTrangThai, "CHUA_CO">, string> = {
  CHUA_NOP: "bg-[var(--sr-tint-orange)] text-[var(--sr-orange-text)]",
  DA_NOP: "bg-[var(--sr-success-bg)] text-[var(--sr-success)]",
};

export function HocPhiPhuHuynh({
  d,
  studentName,
  methodLabels,
  hoaDon,
}: {
  d: StudentBilling;
  studentName: string;
  methodLabels: Record<string, string>;
  /** Mục «Hoá đơn». Cờ hoá đơn tắt (`bat:false`) ⇒ không vẽ mục. */
  hoaDon: MucHoaDon;
}) {
  const tt = tomTatHocPhi({ ...d, paid: d.paid });
  const phieu = xepPhieuThuVaDieuChinh(d.receipts);
  const goc = phieu.filter((r) => r.paymentType !== "ADJUSTMENT");
  const khoa = [d.courseName, d.className].filter(Boolean).join(" · ");
  const dongKhoa = (enrollmentId: string | null) => {
    const r = d.rows.find((x) => x.enrollmentId === enrollmentId);
    return r ? [r.courseName, r.className].filter(Boolean).join(" · ") : null;
  };

  return (
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--sr-orange-text)]">CHỈ HIỆN KHOẢN KẾ TOÁN ĐÃ XÁC NHẬN</div>
        <h1 className="font-display text-[28px] font-extrabold leading-[34px] min-[560px]:text-[32px] min-[560px]:leading-[38px]">Học phí</h1>
      </header>

      {d.tamHoanThu ? (
        <div role="status" className="rounded-[14px] bg-[var(--sr-tint-orange)] px-4 py-3 text-sm leading-5">
          {nhanTamHoanThu(d.tamHoanThu.denNgay)}. Con đang bảo lưu nên chưa có khoản nào phải đóng gấp.
        </div>
      ) : null}
      {d.pendingCount > 0 || d.rejectedCount > 0 ? (
        <div role="status" className="flex flex-col gap-1 rounded-[14px] bg-[var(--sr-tint-orange)] px-4 py-3 text-sm leading-5">
          {d.pendingCount > 0 ? (
            <p>
              Có <b>{d.pendingCount}</b> khoản đang chờ kế toán xác nhận. Số tiền sẽ hiện ở mục “Đã đóng” sau khi được xác nhận.
            </p>
          ) : null}
          {d.rejectedCount > 0 ? (
            <p>
              Có <b>{d.rejectedCount}</b> khoản bị từ chối — vui lòng liên hệ trung tâm ({SATA_ROBO_PHONE.hien}) để được hỗ trợ.
            </p>
          ) : null}
        </div>
      ) : null}

      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-4">
        <article className={cn(CARD, "flex flex-col gap-2 p-5")}>
          <div className={MUTED}>Đang học</div>
          <div className="text-lg font-bold">{khoa || "Chưa có khoá học"}</div>
          {tt.trangThai === "CHUA_CO" ? (
            <div className="text-[13px] text-[var(--sr-ink-muted)]">
              {tt.tieuDe} · {tt.phu}
            </div>
          ) : (
            <div className="flex flex-col items-start gap-1.5">
              <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", CHIP_TT[tt.trangThai])}>
                {tt.tieuDe}
              </span>
              <span className="text-[13px] text-[var(--sr-ink-muted)]">{tt.phu}</span>
            </div>
          )}
        </article>
        {/* Thẻ «Tiếp theo» CHỈ khi có khoản đến hạn thật (còn nợ + có hạn + không bảo lưu) — chủ dự án 03/11/2026:
            "nếu không có khoản đến hạn thì bỏ đi". Không vẽ khung rỗng «Chưa có hạn đóng». */}
        {d.outstanding > 0 && d.nextDueDate && !d.tamHoanThu ? (
          <article className="flex flex-col gap-2 rounded-[18px] bg-[var(--sr-tint-orange)] p-5">
            <div className="text-[13px]">Tiếp theo</div>
            <div className="text-lg font-bold">Hạn đóng {ngayVN(d.nextDueDate)}</div>
            <div className="text-[13px]">Còn {vnd(d.outstanding)}</div>
          </article>
        ) : null}
        <article className={cn(CARD, "flex flex-col gap-2 p-5")}>
          <div className={MUTED}>Đã đóng cho {studentName}</div>
          <div className="text-lg font-bold">{vnd(d.paid)}</div>
          <div className={MUTED}>{goc.length} phiếu thu đã xác nhận</div>
        </article>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">Phiếu thu</h2>
        {phieu.length === 0 ? (
          <NoiDungTrong ten="tim-kiem" className="rounded-[18px] border-2 border-dashed border-border px-5 py-6 text-sm text-[var(--sr-ink-muted)]">Chưa có phiếu thu nào được xác nhận.</NoiDungTrong>
        ) : (
          <div className={cn(CARD, "overflow-x-auto")}>
            <PhanTrangBang tenDonVi="phiếu thu">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--sr-ink-muted)]">
                    <th scope="col" className="border-b border-border px-[18px] py-3.5 font-bold">NỘI DUNG</th>
                    <th scope="col" className="border-b border-border px-[18px] py-3.5 font-bold">NGÀY</th>
                    <th scope="col" className="border-b border-border px-[18px] py-3.5 text-right font-bold">SỐ TIỀN</th>
                    <th scope="col" className="border-b border-border px-[18px] py-3.5 font-bold">TRẠNG THÁI</th>
                  </tr>
                </thead>
                <tbody>
                  {phieu.map((r) =>
                    r.paymentType === "ADJUSTMENT" ? (
                      <tr key={r.id} className="bg-[var(--sr-tint-purple)]/40">
                        <td className="border-b border-border py-4 pl-8 pr-[18px]">
                          <div className="font-semibold">Điều chỉnh phiếu thu</div>
                          {r.lyDoDieuChinh ? <div className="text-xs text-[var(--sr-ink-muted)]">Lý do: {r.lyDoDieuChinh}</div> : null}
                        </td>
                        <td className="border-b border-border px-[18px] py-4 text-[var(--sr-ink-muted)]">{ngayVN(r.confirmedAt ?? r.paidDate)}</td>
                        <td className={cn("border-b border-border px-[18px] py-4 text-right font-bold", r.amount < 0 ? "text-[var(--sr-bad-ink)]" : "text-[var(--sr-success)]")}>
                          {soTienCoDau(r.amount)}
                        </td>
                        <td className="border-b border-border px-[18px] py-4 text-[var(--sr-ink-muted)]">—</td>
                      </tr>
                    ) : (
                      <tr key={r.id}>
                        <td className="border-b border-border px-[18px] py-4">
                          <div className="font-semibold">{dongKhoa(r.enrollmentId) ?? `Học phí${r.orderCode ? ` · ${r.orderCode}` : ""}`}</div>
                          <div className="text-xs text-[var(--sr-ink-muted)]">
                            {r.studentName ?? studentName} · {methodLabels[r.method] ?? r.method}
                            {r.receiptCode ? ` · ${r.receiptCode}` : ""}
                            {r.daBiDieuChinh ? " · Đã điều chỉnh" : ""}
                          </div>
                          {/* PHIẾU THU cho đơn cũ và đơn mới KHÔNG yêu cầu hoá đơn [12/11/2026]; đơn có yêu cầu hoá đơn thì hoá đơn hiện ở mục Hoá đơn. */}
                          {r.coPhieuThuTai ? (
                            <a
                              href={`/portal/hoa-don/phieu-thu/${r.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Tải phiếu thu ${r.receiptCode ?? ""}`.trim()}
                              className="mt-1.5 inline-flex min-h-11 items-center gap-1.5 text-[13px] font-semibold text-[var(--sr-purple-text)] hover:underline"
                            >
                              <Download className="size-4" aria-hidden="true" />
                              Tải phiếu thu (PDF)
                            </a>
                          ) : null}
                        </td>
                        <td className="border-b border-border px-[18px] py-4 text-[var(--sr-ink-muted)]">{ngayVN(r.paidDate)}</td>
                        {/* Số tiền của phiếu gốc GIỮ NGUYÊN — khớp biên lai phụ huynh đang cầm. */}
                        <td className="border-b border-border px-[18px] py-4 text-right font-bold">{vnd(r.amount)}</td>
                        <td className="border-b border-border px-[18px] py-4">
                          <span className="rounded-full bg-[var(--sr-success-bg)] px-2.5 py-1 text-xs font-bold text-[var(--sr-success)]">{NHAN_DA_NOP}</span>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} className="px-[18px] py-4 font-bold">Tổng đã xác nhận</td>
                    <td className="px-[18px] py-4 text-right font-bold">{vnd(tongPhieuThuHienThi(phieu))}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </PhanTrangBang>
          </div>
        )}
        <div className="text-xs leading-[18px] text-[var(--sr-ink-muted)]">
          Cần hỗ trợ học phí: Hotline{" "}
          <a href={`tel:${SATA_ROBO_PHONE.tho}`} className="font-semibold text-[var(--sr-purple-text)]">
            {SATA_ROBO_PHONE.hien}
          </a>
        </div>
      </section>

      {hoaDon.bat ? <HoaDonPhuHuynh items={hoaDon.items} /> : null}
    </div>
  );
}
