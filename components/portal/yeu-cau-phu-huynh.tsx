"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { createParentRequest } from "@/app/(portal)/portal/yeu-cau/actions";
import { CancelButton } from "@/app/(portal)/portal/yeu-cau/_components/cancel-button";
import { buocHocBu, lyDoBaoNghi, noiDungBaoNghi, type BuocHocBu } from "@/lib/portal/hoc-bu-thuan";
import type { StudentMakeup } from "@/lib/portal/makeup";

// Cổng phụ huynh — "Xin nghỉ & học bù", dựng theo artifact Hoc-bu.dc.html. Mọi nút gọi ĐÚNG server action có sẵn (`createParentRequest`).
// Khác artifact (cố ý, để không nói dối): hệ thống chưa lưu "2 giờ bù trung tâm đề xuất" để ba mẹ chọn — nên với buổi vắng chưa có lịch,
// ba mẹ GỬI YÊU CẦU học bù kèm ngày mong muốn, trung tâm xếp giờ rồi báo lại; khi đã xếp thì hiện giờ học bù thật.

const CARD = "rounded-[20px] border border-border bg-card";
const NHAN = "text-xs font-bold uppercase tracking-[0.08em] text-[var(--sr-orange-text)]";
const O_NHAP = "w-full rounded-[10px] border border-border bg-card px-3 text-[15px] text-[var(--sr-ink)] outline-none focus:border-[var(--sr-purple)]";

export type YeuCauDaGui = {
  id: string;
  type: string;
  status: string;
  nhanLoai: string;
  nhanTrangThai: string;
  response: string | null;
  createdAt: string;
  ngay: string;
};

const KHAC: { type: "RESERVE" | "TRANSFER_CLASS" | "TRANSFER_CENTER" | "OTHER"; tieuDe: string; phu: string }[] = [
  { type: "RESERVE", tieuDe: "Bảo lưu", phu: "Tạm dừng học theo quy chế bảo lưu của trung tâm. Trung tâm lập hồ sơ sau khi nhận yêu cầu." },
  { type: "TRANSFER_CLASS", tieuDe: "Chuyển lớp", phu: "Đổi sang lớp cùng khoá, khác giờ học." },
  { type: "TRANSFER_CENTER", tieuDe: "Chuyển cơ sở", phu: "Chuyển sang cơ sở khác của trung tâm." },
  { type: "OTHER", tieuDe: "Yêu cầu khác", phu: "Gửi trung tâm, phản hồi trong giờ làm việc." },
];

function useGui() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const gui = (input: Parameters<typeof createParentRequest>[0], thanhCong: () => void) =>
    startTransition(async () => {
      const r = await createParentRequest(input);
      if (r.ok) {
        toast.success("Đã gửi yêu cầu");
        thanhCong();
        router.refresh();
      } else toast.error(r.error ?? "Lỗi gửi yêu cầu");
    });
  return { pending, gui };
}

function Buoc({ b }: { b: BuocHocBu[] }) {
  return (
    <ol aria-label="Tiến trình học bù" className="grid list-none grid-cols-[repeat(auto-fit,minmax(min(110px,100%),1fr))] gap-2 p-0">
      {b.map((s) => (
        <li key={s.ten} className="flex flex-col gap-2">
          <span
            aria-hidden="true"
            className={cn("h-1.5 rounded-full", s.tt === "xong" ? "bg-[var(--sr-orange)]" : s.tt === "dang" ? "bg-[var(--sr-purple)]" : "bg-[var(--sr-hairline)]")}
          />
          <span className={cn("text-xs leading-4", s.tt === "dang" ? "font-bold" : "font-medium", s.tt === "chua" ? "text-[var(--sr-ink-muted)]" : "")}>{s.ten}</span>
        </li>
      ))}
    </ol>
  );
}

function TheHocBu({ n, prefill }: { n: StudentMakeup["needList"][number]; prefill: boolean }) {
  const { pending, gui } = useGui();
  const [ghiChu, setGhiChu] = useState("");
  const [ngay, setNgay] = useState("");
  const buoc = buocHocBu({ status: n.status, yeuCauMo: n.yeuCauMo });
  const daXep = n.status === "SCHEDULED" && n.buoiBu;
  return (
    <article id={`bu-${n.id}`} className={cn(CARD, "flex flex-col gap-5 p-5 min-[560px]:p-6", prefill ? "outline outline-2 outline-[var(--sr-purple)]" : "")}>
      <div className="flex flex-wrap justify-between gap-2.5">
        <div className="flex min-w-0 flex-col gap-1">
          <div className={NHAN}>HỌC BÙ</div>
          <h2 className="text-[22px] font-bold leading-7">{n.lessonTitle}</h2>
          <div className="text-[13px] text-[var(--sr-ink-muted)]">
            {n.missedDate ? `Con vắng ${new Date(n.missedDate).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit" })} · ` : ""}
            {n.reason}
          </div>
        </div>
        <span className="h-fit rounded-full bg-[var(--sr-tint-orange)] px-3 py-[5px] text-xs font-bold">{n.ketQua.nhan}</span>
      </div>
      <Buoc b={buoc} />
      {daXep ? (
        <div className="rounded-[14px] border-2 border-[var(--sr-purple)] bg-[var(--sr-tint-purple)] p-4">
          <div className="text-[15px] font-bold">{n.buoiBu?.nhanNgay}</div>
          <div className="text-[13px] text-[var(--sr-ink-muted)]">{[n.buoiBu?.className, n.centerName].filter(Boolean).join(" · ")}</div>
        </div>
      ) : n.yeuCauMo ? (
        <div className="rounded-[14px] bg-[var(--sr-tint-purple)] p-4 text-sm leading-[21px]">
          Trung tâm đã nhận yêu cầu học bù của ba mẹ. Khi xếp xong giờ, lịch học bù sẽ hiện ngay tại đây.
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            gui(
              { type: "MAKEUP", makeupNeedId: n.id, preferredDate: ngay || null, content: ghiChu.trim().length >= 5 ? ghiChu.trim() : `Xin học bù ${n.lessonTitle}` },
              () => {
                setGhiChu("");
                setNgay("");
              },
            );
          }}
        >
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Ngày ba mẹ mong muốn (không bắt buộc)
            <input type="date" value={ngay} onChange={(e) => setNgay(e.target.value)} className={cn(O_NHAP, "h-[46px]")} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Ghi chú cho trung tâm (không bắt buộc)
            <textarea value={ghiChu} onChange={(e) => setGhiChu(e.target.value)} rows={2} placeholder="Ví dụ: con rảnh chiều thứ 4" className={cn(O_NHAP, "py-3")} />
          </label>
          <div>
            <button type="submit" disabled={pending} className="h-11 rounded-xl bg-[var(--sr-purple)] px-[18px] text-sm font-bold text-white disabled:opacity-70">
              {pending ? "Đang gửi…" : "Gửi yêu cầu học bù"}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}

function FormBaoNghi({ buoi }: { buoi: { id: string; label: string }[] }) {
  const { pending, gui } = useGui();
  const [sessionId, setSessionId] = useState("");
  const [lyDo, setLyDo] = useState<string>(lyDoBaoNghi[0] ?? "");
  const [ghiChu, setGhiChu] = useState("");
  const [bu, setBu] = useState(true);
  return (
    <article className={cn(CARD, "flex flex-col gap-4 p-5 min-[560px]:p-6")}>
      <h2 className="text-xl font-bold">Báo con nghỉ một buổi</h2>
      {buoi.length === 0 ? (
        <div className="rounded-[14px] border-2 border-dashed border-border p-4 text-sm text-[var(--sr-ink-muted)]">Chưa có buổi sắp tới nào để báo nghỉ.</div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!sessionId) return void toast.error("Vui lòng chọn buổi con nghỉ");
            gui({ type: "ABSENCE", sessionId, content: noiDungBaoNghi({ lyDo, ghiChu, muonBu: bu }) }, () => {
              setSessionId("");
              setGhiChu("");
            });
          }}
        >
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Buổi con nghỉ
            <select value={sessionId} onChange={(e) => setSessionId(e.target.value)} className={cn(O_NHAP, "h-[46px]")}>
              <option value="">— Chọn buổi —</option>
              {buoi.map((b) => (
                <option key={b.id} value={b.id}>{b.label}</option>
              ))}
            </select>
          </label>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="pb-2 text-sm font-semibold">Lý do</legend>
            <div className="flex flex-wrap gap-2">
              {lyDoBaoNghi.map((l) => (
                <label key={l} className="flex h-11 items-center gap-2 rounded-full border border-border px-3.5 text-sm">
                  <input type="radio" name="ly-do" checked={lyDo === l} onChange={() => setLyDo(l)} className="accent-[var(--sr-purple)]" />
                  {l}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Ghi chú cho thầy cô (không bắt buộc)
            <textarea value={ghiChu} onChange={(e) => setGhiChu(e.target.value)} rows={3} placeholder="Ví dụ: con về quê, thứ 2 mới về" className={cn(O_NHAP, "resize-y py-3")} />
          </label>
          <label className="flex items-center gap-2.5 text-sm">
            <input type="checkbox" checked={bu} onChange={(e) => setBu(e.target.checked)} className="size-[18px] accent-[var(--sr-purple)]" />
            Con muốn học bù buổi này
          </label>
          <div>
            <button type="submit" disabled={pending} className="h-11 rounded-xl bg-[var(--sr-orange)] px-[18px] text-sm font-bold text-[var(--sr-on-orange)] disabled:opacity-70">
              {pending ? "Đang gửi…" : "Gửi báo nghỉ"}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}

function YeuCauKhac() {
  const { pending, gui } = useGui();
  const [mo, setMo] = useState<(typeof KHAC)[number]["type"] | null>(null);
  const [noiDung, setNoiDung] = useState("");
  const [ngay, setNgay] = useState("");
  const dangMo = KHAC.find((k) => k.type === mo);
  return (
    <article className={cn(CARD, "flex flex-col gap-3 p-5")}>
      <h2 className="text-[17px] font-bold">Yêu cầu khác</h2>
      {KHAC.map((k) => (
        <button
          key={k.type}
          type="button"
          aria-expanded={mo === k.type}
          onClick={() => setMo(mo === k.type ? null : k.type)}
          className={cn("flex items-center gap-3 rounded-xl border bg-card p-3 text-left", mo === k.type ? "border-[var(--sr-purple)]" : "border-border")}
        >
          <span className="flex flex-[1_1_auto] flex-col gap-0.5">
            <span className="text-sm font-bold">{k.tieuDe}</span>
            <span className="text-xs leading-[17px] text-[var(--sr-ink-muted)]">{k.phu}</span>
          </span>
          <ChevronRight className={cn("size-4 flex-none text-[var(--sr-ink-muted)] transition-transform", mo === k.type ? "rotate-90" : "")} aria-hidden="true" />
        </button>
      ))}
      {dangMo ? (
        <form
          className="flex flex-col gap-2.5 rounded-xl bg-[var(--sr-tint-purple)] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            gui({ type: dangMo.type, content: noiDung, preferredDate: ngay || null }, () => {
              setNoiDung("");
              setNgay("");
              setMo(null);
            });
          }}
        >
          <div className="text-sm font-bold">{dangMo.tieuDe}</div>
          {dangMo.type === "RESERVE" ? (
            <label className="flex flex-col gap-1 text-[13px] font-semibold">
              Ngày dự kiến bắt đầu (không bắt buộc)
              <input type="date" value={ngay} onChange={(e) => setNgay(e.target.value)} className={cn(O_NHAP, "h-11")} />
            </label>
          ) : null}
          <textarea value={noiDung} onChange={(e) => setNoiDung(e.target.value)} rows={3} placeholder="Mô tả ngắn yêu cầu của ba mẹ…" className={cn(O_NHAP, "py-2.5")} />
          <div>
            <button type="submit" disabled={pending} className="h-10 rounded-[10px] bg-[var(--sr-purple)] px-4 text-[13px] font-bold text-white disabled:opacity-70">
              {pending ? "Đang gửi…" : "Gửi yêu cầu"}
            </button>
          </div>
        </form>
      ) : null}
    </article>
  );
}

export function YeuCauPhuHuynh({
  data,
  upcoming,
  requests,
  prefillNeedId,
}: {
  data: StudentMakeup;
  upcoming: { id: string; label: string }[];
  requests: YeuCauDaGui[];
  prefillNeedId: string | null;
}) {
  const cho = data.needList.filter((n) => !n.yeuCauMo).length;
  const dangBu = [...data.needList, ...data.history.filter((h) => h.status === "SCHEDULED")];
  const lichSu = [
    ...requests.map((r) => ({ id: `r${r.id}`, tieu: `${r.nhanLoai} · ${r.nhanTrangThai}`, phu: r.ngay, iso: r.createdAt, moi: r.status === "PENDING", huy: r.status === "PENDING" ? r.id : null, tra: r.response })),
    ...data.history
      .filter((h) => h.status === "COMPLETED" && h.completedAt)
      .map((h) => ({ id: `h${h.id}`, tieu: `Con đã học bù · ${h.lessonTitle}`, phu: new Date(h.completedAt as string).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit" }), iso: h.completedAt as string, moi: false, huy: null as string | null, tra: null as string | null })),
  ].sort((a, b) => b.iso.localeCompare(a.iso));

  return (
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <div className={NHAN}>{cho > 0 ? `${cho} VIỆC CHỜ BA MẸ` : "KHÔNG CÓ VIỆC CHỜ BA MẸ"}</div>
        <h1 className="font-display text-[28px] font-extrabold leading-[34px] min-[560px]:text-[32px] min-[560px]:leading-[38px]">Xin nghỉ &amp; học bù</h1>
        <div className="text-sm text-[var(--sr-ink-muted)]">
          Con nghỉ buổi nào, trung tâm xếp buổi bù đúng nội dung buổi đó{data.centerName ? ` tại cơ sở ${data.centerName}` : " tại cơ sở của con"}.
        </div>
      </header>

      <div className="flex flex-wrap items-start gap-5">
        <section className="flex min-w-0 flex-[999_1_520px] flex-col gap-5">
          {dangBu.map((n) => (
            <TheHocBu key={n.id} n={n} prefill={prefillNeedId === n.id} />
          ))}
          <FormBaoNghi buoi={upcoming} />
        </section>

        <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          <YeuCauKhac />

          <article className={cn(CARD, "flex flex-col gap-3 p-5")}>
            <h2 className="text-[17px] font-bold">Lịch sử</h2>
            {lichSu.length === 0 ? (
              <div className="text-[13px] text-[var(--sr-ink-muted)]">Chưa có yêu cầu nào.</div>
            ) : (
              <ol className="m-0 flex list-none flex-col gap-3.5 p-0">
                {lichSu.map((e) => (
                  <li key={e.id} className="flex gap-2.5">
                    <span aria-hidden="true" className={cn("mt-[5px] size-2.5 flex-none rounded-full", e.moi ? "bg-[var(--sr-orange)]" : "bg-[var(--sr-dash)]")} />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sm font-semibold">{e.tieu}</span>
                      <span className="text-xs text-[var(--sr-ink-muted)]">{e.phu}</span>
                      {e.tra ? <span className="text-xs leading-[17px]">Trung tâm: {e.tra}</span> : null}
                      {e.huy ? <span><CancelButton id={e.huy} /></span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </article>

          <article className="flex flex-col gap-2 rounded-[20px] bg-[var(--sr-tint-purple)] p-[18px] text-[13px] leading-5">
            <h2 className="text-[15px] font-bold">Cách học bù hoạt động</h2>
            <span>Buổi bù dạy đúng nội dung buổi con vắng, tại cơ sở của con.</span>
            <span>Sau buổi bù, thầy cô gửi nhận xét như buổi học thường.</span>
            <span>Không học bù ở cơ sở khác.</span>
          </article>
        </aside>
      </div>
    </div>
  );
}
