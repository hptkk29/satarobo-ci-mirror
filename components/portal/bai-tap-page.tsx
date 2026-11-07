import { ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { MoCongHocSinh } from "@/components/portal/mo-cong-hoc-sinh";
import { NHAN_BAI, kieuBaiThi, type BaiThi, type TrangThaiBai } from "@/lib/portal/bai-tap-thuan";
import type { BaiTapData } from "@/lib/portal/bai-tap";
import { ngayVN } from "@/lib/format/date";

// Cổng phụ huynh — "Bài tập & bài thi", dựng theo artifact Bai-tap.dc.html.
// KHÔNG vẽ nút "Nhắc con tối nay" (chưa có chỗ gửi nhắc). Cột "Lời thầy cô" lấy từ nhận xét khi chấm bài; bài kiểm tra về nhà không có lời nhận xét.

const CARD = "rounded-[18px] border border-border bg-card";
const NHAN = "text-xs font-bold uppercase tracking-[0.08em] text-[var(--sr-orange-text)]";

const dmy = (iso: string | null) => (iso ? ngayVN(new Date(iso)).slice(0, 5) : "—");

function Chip({ tt }: { tt: TrangThaiBai }) {
  const cls =
    tt === "da-cham"
      ? "bg-[var(--sr-success-bg)] text-[var(--sr-success)]"
      : tt === "qua-han"
        ? "bg-[var(--sr-bad-bg)] text-[var(--sr-bad-ink)] border border-[var(--sr-bad-line)]"
        : tt === "cho-cham"
          ? "border border-border text-[var(--sr-ink-muted)]"
          : "bg-[var(--sr-tint-orange)] text-[var(--sr-ink)]";
  return <span className={cn("rounded-full px-3 py-[5px] text-xs font-bold", cls)}>{NHAN_BAI[tt]}</span>;
}

function TheThi({ t, now }: { t: BaiThi; now: Date }) {
  const k = kieuBaiThi(t, now);
  const sang = k === "dang-mo" || k === "sap-mo";
  const nhan = k === "dang-mo" ? "ĐANG MỞ" : k === "sap-mo" ? "SẮP DIỄN RA" : k === "da-thi" ? "ĐÃ THI" : "ĐÃ ĐÓNG";
  const khung = [
    t.moISO ? `Mở ${dmy(t.moISO)}` : null,
    t.dongISO ? `đóng ${dmy(t.dongISO)}` : null,
    `${t.phut} phút`,
  ].filter(Boolean).join(" · ");
  return (
    <article
      className={cn(
        "flex flex-col gap-2 rounded-[18px] p-5",
        k === "dang-mo" || k === "sap-mo" ? "bg-[var(--sr-purple)] text-white" : "border border-dashed border-[var(--sr-dash)] bg-card",
      )}
    >
      <div className={cn("text-[11px] font-bold tracking-[0.08em]", sang ? "text-[var(--sr-hero-eyebrow)]" : "text-[var(--sr-ink-muted)]")}>{nhan}</div>
      <div className="text-lg font-bold">{t.tieuDe}</div>
      <div className={cn("text-sm", sang ? "text-[var(--sr-hero-text)]" : "text-[var(--sr-ink-muted)]")}>
        {khung}
        {t.diem != null ? ` · điểm ${t.diem}` : ""}
      </div>
    </article>
  );
}

export function BaiTapPhuHuynh({ d, studentId, now }: { d: BaiTapData; studentId: string; now: Date }) {
  const t = d.tomTat;
  return (
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          {d.tenKhoa ? <div className={cn(NHAN, "break-words")}>{d.tenKhoa}</div> : null}
          <h1 className="font-display text-[28px] font-extrabold leading-[34px] min-[560px]:text-[32px] min-[560px]:leading-[38px]">Bài tập &amp; bài thi</h1>
          <div className="text-sm text-[var(--sr-ink-muted)]">Ba mẹ theo dõi tiến độ ở đây. Con làm bài trong Cổng học sinh.</div>
        </div>
        <MoCongHocSinh studentId={studentId} />
      </header>

      <section aria-label="Tóm tắt" className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-4">
        <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-[18px]">
          <div className="text-[13px] text-[var(--sr-ink-muted)]">Bài về nhà đã giao</div>
          <div className="text-[26px] font-bold">{t.giao}</div>
        </div>
        <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-[18px]">
          <div className="text-[13px] text-[var(--sr-ink-muted)]">Con đã nộp</div>
          <div className="text-[26px] font-bold text-[var(--sr-success)]">
            {t.daNop} <span className="text-[15px] font-medium text-[var(--sr-ink-muted)]">/ {t.giao}</span>
          </div>
        </div>
        <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-[18px]">
          <div className="text-[13px] text-[var(--sr-ink-muted)]">Điểm trung bình</div>
          <div className="text-[26px] font-bold">
            {t.diem ? t.diem.chu : "—"} {t.diem ? <span className="text-[15px] font-medium text-[var(--sr-ink-muted)]">/ 10</span> : null}
          </div>
        </div>
        <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-[18px]">
          <div className="text-[13px] text-[var(--sr-ink-muted)]">Bài thi kế tiếp</div>
          <div className="text-xl font-bold leading-[30px]">
            {d.thiKeTiep ? `${d.thiKeTiep.tieuDe}${d.thiKeTiep.moISO ? ` · ${dmy(d.thiKeTiep.moISO)}` : ""}` : "Chưa có"}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">Cần làm</h2>
        {t.canLam.length === 0 ? (
          <div className="rounded-[18px] border-2 border-dashed border-border px-5 py-6 text-sm text-[var(--sr-ink-muted)]">
            {t.giao === 0 ? "Chưa có bài về nhà nào được giao." : "Con đã nộp hết bài được giao."}
          </div>
        ) : (
          t.canLam.map((b) => (
            <article key={b.id} className="flex flex-wrap items-center gap-4 rounded-[18px] border-2 border-[var(--sr-orange)] bg-card p-[18px]">
              <span aria-hidden="true" className="flex size-12 flex-none items-center justify-center rounded-[14px] bg-[var(--sr-tint-orange)]">
                <ClipboardList className="size-[22px] text-[var(--sr-orange-text)]" />
              </span>
              <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
                <div className="text-xs font-bold uppercase text-[var(--sr-orange-text)]">{b.nhanPhu}</div>
                <div className="text-base font-bold">{b.tieuDe}</div>
                <div className="text-[13px] text-[var(--sr-ink-muted)]">{b.hanISO ? `Hạn nộp: ${dmy(b.hanISO)}` : "Không đặt hạn nộp"}</div>
              </div>
              <Chip tt={b.trangThai} />
            </article>
          ))
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">Đã nộp</h2>
        {t.daNopDs.length === 0 ? (
          <div className="rounded-[18px] border-2 border-dashed border-border px-5 py-6 text-sm text-[var(--sr-ink-muted)]">Con chưa nộp bài nào.</div>
        ) : (
          <div className={cn(CARD, "overflow-x-auto")}>
            <PhanTrangBang tenDonVi="bài">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--sr-ink-muted)]">
                    {["BÀI", "NỘP", "KẾT QUẢ", "LỜI THẦY CÔ"].map((h) => (
                      <th key={h} scope="col" className="border-b border-border px-[18px] py-3.5 font-bold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t.daNopDs.map((b) => (
                    <tr key={b.id}>
                      <td className="border-b border-border px-[18px] py-3.5">
                        <div className="font-semibold">{b.tieuDe}</div>
                        <div className="text-xs text-[var(--sr-ink-muted)]">{b.nhanPhu}</div>
                      </td>
                      <td className="border-b border-border px-[18px] py-3.5 text-[var(--sr-ink-muted)]">{dmy(b.nopISO)}</td>
                      <td className="border-b border-border px-[18px] py-3.5">
                        {b.trangThai === "da-cham" && b.diem ? (
                          <span className="rounded-full bg-[var(--sr-success-bg)] px-2.5 py-1 text-[13px] font-bold text-[var(--sr-success)]">
                            {b.diem.diem.toLocaleString("vi-VN")} / {b.diem.toiDa.toLocaleString("vi-VN")}
                          </span>
                        ) : (
                          <span className="rounded-full border border-border px-2.5 py-1 text-[13px] font-semibold text-[var(--sr-ink-muted)]">
                            {b.trangThai === "da-cham" ? "Đã chấm" : "Chờ thầy cô chấm"}
                          </span>
                        )}
                      </td>
                      <td className="border-b border-border px-[18px] py-3.5">{b.loiThay ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PhanTrangBang>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold">Bài thi</h2>
        {d.thi.length === 0 ? (
          <div className="rounded-[18px] border-2 border-dashed border-border px-5 py-6 text-sm text-[var(--sr-ink-muted)]">Chưa có bài thi nào được mở cho con.</div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-4">
            {d.thi.map((x) => (
              <TheThi key={x.id} t={x} now={now} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
