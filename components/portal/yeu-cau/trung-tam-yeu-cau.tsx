import Link from "next/link";
import { CalendarX2, MapPin, MessageSquareText, PauseCircle, Repeat, Shuffle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CancelButton } from "@/app/(portal)/portal/yeu-cau/_components/cancel-button";
import { LOAI_YEU_CAU, type SlugYeuCau } from "@/lib/portal/yeu-cau-loai";

// «Gửi yêu cầu đến trung tâm» — MÀN CHỌN LOẠI + theo dõi (board M-Yeu-cau, thiết kế lại 13/11/2026).
//  · Điện thoại: một cột — các loại yêu cầu (thẻ bấm được) rồi tới yêu cầu đã gửi.
//  · Màn rộng (≥ 1024px): hai cột — bên trái chọn loại (đứng yên khi cuộn), bên phải theo dõi yêu cầu, chia rõ «Đang chờ trung tâm» / «Đã xử lý».
// Server component: không state, chỉ liên kết + nút huỷ/rút đơn có sẵn. Mọi ngày giờ do máy chủ định dạng theo lịch VN (không tính ở trình duyệt).

export type YeuCauDaGui = {
  id: string;
  /** Loại đã quy về slug màn gửi — chọn biểu tượng + màu. */
  slug: SlugYeuCau;
  status: string;
  nhanLoai: string;
  nhanTrangThai: string;
  noiDung: string;
  response: string | null;
  /** `13/11/2026` — ngày gửi. */
  ngay: string;
  /** Các dòng sự kiện đã định dạng, vd `Buổi nghỉ` → `Thứ Sáu, 14/11/2026 · 18:00`, `Ba mẹ đề xuất bù` → `Thứ Hai, 17/11/2026 · 18:30`. */
  chiTiet: { nhan: string; giaTri: string }[];
  /** Có nút huỷ / rút đơn không (máy chủ quyết: buổi còn ở tương lai, đơn đang chờ hoặc đã tiếp nhận). */
  hanhDong: { nhan: string; nhanXacNhan: string; thanhCong: string } | null;
};

const ICON: Record<SlugYeuCau, { Icon: LucideIcon; nen: string; mau: string }> = {
  "hoc-bu": { Icon: Repeat, nen: "bg-[var(--sr-tint-purple)]", mau: "text-[var(--sr-purple-text)]" },
  nghi: { Icon: CalendarX2, nen: "bg-[#e6f0ff]", mau: "text-[#1d4ed8]" },
  "bao-luu": { Icon: PauseCircle, nen: "bg-[#fff1d6]", mau: "text-[#7a4a00]" },
  "doi-lop": { Icon: Shuffle, nen: "bg-[#e3f4ee]", mau: "text-[#0f5c55]" },
  "doi-co-so": { Icon: MapPin, nen: "bg-[#fff1e4]", mau: "text-[#c2570c]" },
  khac: { Icon: MessageSquareText, nen: "bg-[#f1eef3]", mau: "text-[#6b5a78]" },
};

const SAC: Record<string, string> = {
  PENDING: "bg-[#fff1d6] text-[#7a4a00]",
  APPROVED: "bg-[#e3f4ee] text-[#0f5c55]",
  REJECTED: "bg-[#fde8e8] text-[#b42318]",
  CANCELLED: "bg-[#f1eef3] text-[#6b5a78]",
};

function TheYeuCau({ r }: { r: YeuCauDaGui }) {
  const { Icon, nen, mau } = ICON[r.slug];
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className={cn("flex size-10 flex-none items-center justify-center rounded-xl", nen, mau)} aria-hidden="true">
          <Icon className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <b className="text-[15px] leading-5">{r.nhanLoai}</b>
          <span className="text-xs text-[var(--sr-ink-muted)]">Gửi ngày {r.ngay}</span>
        </div>
        <span className={cn("flex-none whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold", SAC[r.status] ?? SAC.CANCELLED)}>{r.nhanTrangThai}</span>
      </div>

      {r.chiTiet.length > 0 ? (
        <dl className="grid gap-2 rounded-xl bg-[var(--sr-tint-purple)] px-3 py-2.5 text-[13px] leading-[19px] min-[480px]:grid-cols-2">
          {r.chiTiet.map((c) => (
            <div key={c.nhan} className="min-w-0">
              <dt className="text-xs text-[var(--sr-ink-muted)]">{c.nhan}</dt>
              <dd className="break-words font-semibold">{c.giaTri}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <p className="line-clamp-3 break-words text-[13px] leading-[19px] text-[var(--sr-ink-soft,#3a2d48)]">{r.noiDung}</p>

      {r.response ? (
        <p className="break-words rounded-xl border border-border px-3 py-2 text-[13px] leading-[19px]">
          <b>Trung tâm:</b> {r.response}
        </p>
      ) : null}

      {r.hanhDong ? (
        <div className="flex justify-end border-t border-border pt-2">
          <CancelButton id={r.id} nhan={r.hanhDong.nhan} nhanXacNhan={r.hanhDong.nhanXacNhan} thanhCong={r.hanhDong.thanhCong} />
        </div>
      ) : null}
    </article>
  );
}

export function TrungTamYeuCau({
  tenCon,
  soBuoiCanBu,
  daGui,
}: {
  tenCon: string;
  /** Số buổi con vắng còn CHỜ ba mẹ gửi yêu cầu bù — hiện thành huy hiệu cam trên thẻ «Học bù». */
  soBuoiCanBu: number;
  daGui: YeuCauDaGui[];
}) {
  const dangCho = daGui.filter((r) => r.status === "PENDING");
  // «Đang theo dõi» = đang chờ + đơn xin nghỉ đã tiếp nhận mà còn rút được (con chưa tới buổi đó): ba mẹ cần thấy chúng ở trên cùng.
  const dangTheoDoi = daGui.filter((r) => r.status === "PENDING" || r.hanhDong !== null);
  const daXong = daGui.filter((r) => !dangTheoDoi.includes(r));
  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-display text-[28px] font-extrabold leading-[34px] min-[560px]:text-[32px] min-[560px]:leading-[38px]">Gửi yêu cầu đến trung tâm</h1>
        <p className="max-w-[60ch] text-sm leading-[22px] text-[var(--sr-ink-muted)]">
          Chọn việc ba mẹ cần cho {tenCon || "con"}. Trung tâm phản hồi trong giờ làm việc, thường trong ngày.
        </p>
      </header>

      <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:items-start lg:gap-10">
        <section aria-labelledby="loai-t" className="flex flex-col gap-3 lg:sticky lg:top-4">
          <h2 id="loai-t" className="text-lg font-bold">
            Ba mẹ cần gì?
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5 lg:grid-cols-2">
            {LOAI_YEU_CAU.map((l) => {
              const { Icon, nen, mau } = ICON[l.slug];
              const badge = l.slug === "hoc-bu" && soBuoiCanBu > 0 ? `${soBuoiCanBu} buổi` : null;
              return (
                <Link
                  key={l.slug}
                  href={`/portal/yeu-cau/${l.slug}`}
                  className="relative flex min-h-[112px] flex-col gap-1.5 rounded-[18px] border border-border bg-card p-4 text-foreground no-underline transition-colors hover:bg-[var(--sr-tint-purple)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sr-purple)]"
                >
                  <span className={cn("flex size-10 items-center justify-center rounded-xl", nen, mau)}>
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <b className="text-[15px] leading-5">{l.ten}</b>
                  <span className="text-xs leading-[17px] text-[var(--sr-ink-muted)]">{l.mo}</span>
                  {badge ? <span className="absolute right-3 top-3 rounded-full bg-[#f06a1f] px-2 py-0.5 text-xs font-bold text-white">{badge}</span> : null}
                </Link>
              );
            })}
          </div>
        </section>

        <div className="flex min-w-0 flex-col gap-7">
          <section aria-labelledby="cho-t" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 id="cho-t" className="text-lg font-bold">
                Đang theo dõi
              </h2>
              <span className="text-[13px] text-[var(--sr-ink-muted)]">{dangCho.length > 0 ? `${dangCho.length} yêu cầu trung tâm chưa xử lý` : "Trung tâm đã xử lý hết yêu cầu"}</span>
            </div>
            {dangTheoDoi.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-border p-5 text-center text-sm leading-[21px] text-[var(--sr-ink-muted)]">
                Ba mẹ chưa gửi yêu cầu nào. Chọn một loại trong mục «Ba mẹ cần gì?» để bắt đầu.
              </div>
            ) : (
              dangTheoDoi.map((r) => <TheYeuCau key={r.id} r={r} />)
            )}
          </section>

          {daXong.length > 0 ? (
            <section aria-labelledby="xong-t" className="flex flex-col gap-3">
              <h2 id="xong-t" className="text-lg font-bold">
                Đã xử lý
              </h2>
              {daXong.map((r) => (
                <TheYeuCau key={r.id} r={r} />
              ))}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
