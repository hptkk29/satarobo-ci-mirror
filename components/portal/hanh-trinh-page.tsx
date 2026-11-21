import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HanhTrinh } from "@/lib/portal/hanh-trinh";
import { type DongBai, type HocPhanHanhTrinh, type TrangThaiDong } from "@/lib/portal/hanh-trinh-thuan";

// Cổng phụ huynh — "Hành trình", dựng theo artifact Hanh-trinh.dc.html.
// Màu qua token `--sr-*`; sáng/tối tự đổi. Lưới `flex-wrap` + `flex-basis` đúng như artifact nên
// ở màn hẹp cột bên (tuần này, lịch tháng) rơi xuống dưới danh sách bài.

const CARD = "rounded-[20px] border border-border bg-card";

const CHIP: Record<TrangThaiDong, string> = {
  xong: "bg-[var(--sr-success-bg)] text-[var(--sr-success)]",
  "da-bu": "bg-[var(--sr-success-bg)] text-[var(--sr-success)]",
  "vang-cho-bu": "bg-[var(--sr-tint-orange)] text-foreground",
  vang: "bg-[var(--sr-tint-orange)] text-foreground",
  "chua-cham": "border border-border text-muted-foreground",
  huy: "border border-border text-muted-foreground line-through",
  tiep: "bg-[var(--sr-purple)] text-white",
  sap: "border border-border text-muted-foreground",
  moc: "bg-[var(--sr-tint-orange)] text-[var(--sr-orange-text)] font-bold",
};

const SO: Record<TrangThaiDong, string> = {
  xong: "bg-[var(--sr-orange)] text-[var(--sr-on-orange)]",
  "da-bu": "bg-[var(--sr-orange)] text-[var(--sr-on-orange)]",
  "vang-cho-bu": "bg-[var(--sr-tint-orange)] text-foreground",
  vang: "bg-[var(--sr-tint-orange)] text-foreground",
  "chua-cham": "border-2 border-border text-muted-foreground",
  huy: "border-2 border-border text-muted-foreground",
  tiep: "bg-[var(--sr-purple)] text-white",
  sap: "border-2 border-border text-muted-foreground",
  moc: "border-2 border-border text-muted-foreground",
};

function ThongKe({
  nhan,
  so,
  hau,
  mau,
  ghi,
}: {
  nhan: string;
  so: number | string;
  hau: string;
  mau?: string;
  /** Một dòng nhỏ dưới con số — chỉ khi có điều cần nói thêm. */
  ghi?: string | null;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-[18px]">
      <div className="text-[13px] text-muted-foreground">{nhan}</div>
      <div className={cn("text-[26px] font-bold leading-tight", mau)}>
        {so} <span className="text-[15px] font-medium text-muted-foreground">{hau}</span>
      </div>
      {ghi ? <div className="text-xs leading-[17px] text-muted-foreground">{ghi}</div> : null}
    </div>
  );
}

function ThanhBuoi({ hp }: { hp: HocPhanHanhTrinh }) {
  const song = hp.dong.filter((d) => d.trangThai !== "huy");
  return (
    <div
      role="img"
      aria-label={`${hp.ten}: đã học ${hp.daHoc} trên ${hp.tong} buổi`}
      className="flex h-5 w-[220px] max-w-full items-center gap-[3px] rounded-full bg-[var(--sr-tint-purple)] px-1"
    >
      {song.map((d) => (
        <span
          key={d.id}
          className={cn(
            "h-[11px] flex-1 rounded-full",
            d.past ? "bg-[var(--sr-orange)]" : d.trangThai === "tiep" ? "bg-[var(--sr-purple)]" : "bg-border",
          )}
        />
      ))}
    </div>
  );
}

function DongBaiHoc({ d }: { d: DongBai }) {
  const ten = d.chuaCoTen ? "Chưa có tên bài" : d.tieuDe;
  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-3.5 border-b border-border px-2 py-3",
        d.trangThai === "tiep" && "rounded-xl border-b-transparent bg-[var(--sr-tint-purple)]",
      )}
    >
      <span
        className={cn(
          "flex size-[34px] flex-none items-center justify-center rounded-full text-[13px] font-bold",
          SO[d.trangThai],
        )}
      >
        {d.order}
      </span>
      <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
        <span className={cn("text-[15px]", d.chuaCoTen ? "font-medium text-muted-foreground" : "font-semibold")}>{ten}</span>
        <span className="text-xs text-muted-foreground">
          {d.nhanThu}, {d.ngayNgan}
        </span>
      </div>
      <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", CHIP[d.trangThai])}>{d.nhan}</span>
      {d.trangThai === "xong" || d.trangThai === "da-bu" ? (
        <span className="flex gap-3 text-[13px] font-semibold">
          <Link href="/portal/hinh-anh" className="text-[var(--sr-purple-text)] hover:underline">
            Sản phẩm
          </Link>
          <Link href="/portal/nhan-xet" className="text-[var(--sr-purple-text)] hover:underline">
            Nhận xét
          </Link>
        </span>
      ) : null}
      {d.trangThai === "vang-cho-bu" ? (
        <Link
          href="/portal/yeu-cau"
          className="flex h-9 items-center rounded-[10px] bg-[var(--sr-ink)] px-3 text-[13px] font-semibold text-[var(--background)]"
        >
          Chọn giờ bù
        </Link>
      ) : null}
    </li>
  );
}

function HocPhanChiTiet({ hp }: { hp: HocPhanHanhTrinh }) {
  const coBaiChuaTen = hp.dong.some((d) => d.chuaCoTen);
  return (
    <article className={cn(CARD, "flex flex-col gap-3.5 p-[22px]")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-xl font-bold">{hp.tieuDe}</h2>
          <div className="text-[13px] text-muted-foreground">
            {hp.batDau && hp.ketThuc ? `${hp.batDau} – ${hp.ketThuc}` : ""} · đã học {hp.daHoc}/{hp.tong} buổi
          </div>
        </div>
        <ThanhBuoi hp={hp} />
      </div>
      <ol className="m-0 flex list-none flex-col p-0">
        {hp.dong.map((d) => (
          <DongBaiHoc key={d.id} d={d} />
        ))}
      </ol>
      {coBaiChuaTen ? (
        <div className="text-xs leading-[18px] text-muted-foreground">
          Một số buổi chưa có tên bài vì giáo trình của lớp chưa được gắn đủ; tên sẽ hiện khi trung tâm cập nhật.
        </div>
      ) : null}
    </article>
  );
}

function HocPhanSapToi({ hp }: { hp: HocPhanHanhTrinh }) {
  return (
    <article className={cn(CARD, "flex flex-col gap-3.5 p-[22px]")}>
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold">{hp.tieuDe}</h2>
        <div className="text-[13px] text-muted-foreground">{hp.batDau ? `Dự kiến từ ${hp.batDau}` : "Chưa xếp lịch"}</div>
      </div>
      <div className="flex flex-wrap gap-2">
        {hp.dong.map((d) => (
          <span
            key={d.id}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px]",
              d.laMoc ? "bg-[var(--sr-tint-orange)]" : "border border-border",
            )}
          >
            <b className="font-semibold text-muted-foreground">{d.order}</b>
            {d.chuaCoTen ? "Chưa có tên bài" : d.tieuDe}
          </span>
        ))}
      </div>
    </article>
  );
}

export function HanhTrinhPage({ d, xem }: { d: HanhTrinh; xem: "lo-trinh" | "lich" }) {
  const t = d.tomTat;
  const loTrinh = xem === "lo-trinh";
  const tab = (active: boolean) =>
    cn(
      "flex h-10 items-center rounded-[9px] px-4 text-sm",
      active ? "bg-card font-bold text-foreground" : "font-semibold text-muted-foreground",
    );
  const lichHref = (y: number, m0: number) => `/portal/lich?xem=lich&y=${y}&m=${m0}`;

  return (
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--sr-orange-text)]">
            {[d.tenKhoa, d.tenLop ? `LỚP ${d.tenLop}` : null].filter(Boolean).join(" · ")}
          </div>
          <h1 className="font-display text-[26px] font-extrabold leading-8 min-[560px]:text-[30px] min-[560px]:leading-9">
            {d.tieuDe}
          </h1>
          {d.dongLich ? <div className="text-sm text-muted-foreground">{d.dongLich}</div> : null}
        </div>
        <nav aria-label="Kiểu xem" className="flex gap-1 rounded-xl bg-[var(--sr-tint-purple)] p-1">
          <Link href="/portal/lich" aria-current={loTrinh ? "page" : undefined} className={tab(loTrinh)}>
            Lộ trình
          </Link>
          <Link href="/portal/lich?xem=lich" aria-current={!loTrinh ? "page" : undefined} className={tab(!loTrinh)}>
            Lịch tháng
          </Link>
        </nav>
      </header>

      <section aria-label="Tóm tắt" className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-4">
        <ThongKe nhan="Lớp đã học" so={t.daHoc} hau={`/ ${t.tong} buổi`} />
        <ThongKe
          nhan="Con có mặt"
          so={t.coMat}
          hau={t.mauSoCoMat > 0 ? `/ ${t.mauSoCoMat} buổi` : "buổi"}
          mau="text-[var(--sr-success)]"
        />
        <ThongKe
          nhan="Buổi cần học bù"
          so={t.canBu}
          hau={t.canBu > 0 ? "chờ chọn giờ" : "buổi"}
          mau={t.canBu > 0 ? "text-[var(--sr-orange-text)]" : undefined}
          ghi={t.canBuLopKhac > 0 ? `Thêm ${t.canBuLopKhac} buổi vắng ở lớp trước đang chờ bù` : null}
        />
        <ThongKe nhan="Còn lại" so={t.conLai} hau="buổi" />
      </section>

      <div className="flex flex-wrap items-start gap-5">
        {loTrinh ? (
          <section className="flex min-w-0 flex-[999_1_520px] flex-col gap-4">
            {d.hocPhan.length === 0 ? (
              <article className={cn(CARD, "p-6 text-sm text-muted-foreground")}>
                Chưa có buổi học nào được xếp lịch cho con.
              </article>
            ) : (
              d.hocPhan.map((hp) =>
                hp.chiTiet ? <HocPhanChiTiet key={hp.ma || "chung"} hp={hp} /> : <HocPhanSapToi key={hp.ma} hp={hp} />,
              )
            )}
          </section>
        ) : null}

        <aside
          className={cn(
            "flex min-w-0 flex-col gap-4",
            loTrinh ? "flex-[1_1_300px]" : "max-w-[640px] flex-[1_1_100%]",
          )}
        >
          {d.tuanNay ? (
            <article className="flex flex-col gap-2.5 rounded-[20px] bg-[var(--sr-purple)] p-5 text-white">
              <div className="text-[11px] font-bold tracking-[0.08em] text-[var(--sr-hero-eyebrow)]">{d.tuanNay.nhan}</div>
              <div className="font-display text-[26px] font-extrabold leading-[30px]">{d.tuanNay.tieuDe}</div>
              <div className="text-sm text-[var(--sr-hero-text)]">{d.tuanNay.dong}</div>
              <Link
                href="/portal/yeu-cau"
                className="mt-1.5 flex h-11 items-center justify-center rounded-xl border border-[var(--sr-hero-line)] text-sm font-semibold text-white"
              >
                Báo con nghỉ buổi này
              </Link>
            </article>
          ) : null}

          <article className={cn(CARD, "flex flex-col gap-3 p-[18px]")}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold">{d.lich.nhanThang}</h2>
              <div className="flex gap-1">
                <Link
                  href={lichHref(d.lich.truoc.y, d.lich.truoc.m0)}
                  scroll={false}
                  aria-label="Tháng trước"
                  className="flex size-8 items-center justify-center rounded-lg border border-border bg-card"
                >
                  <ChevronLeft className="size-3.5" aria-hidden="true" />
                </Link>
                <Link
                  href={lichHref(d.lich.sau.y, d.lich.sau.m0)}
                  scroll={false}
                  aria-label="Tháng sau"
                  className="flex size-8 items-center justify-center rounded-lg border border-border bg-card"
                >
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                </Link>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-muted-foreground">
              {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((x) => (
                <span key={x}>{x}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[13px]">
              {d.lich.o.map((o) => (
                <span
                  key={o.key}
                  className={cn(
                    "flex h-[34px] items-center justify-center rounded-full",
                    !o.trongThang && o.kieu === "khong" && "text-[var(--sr-ink-muted)] opacity-60",
                    o.kieu === "xong" && "bg-[var(--sr-orange)] font-bold text-[var(--sr-on-orange)]",
                    o.kieu === "tiep" && "bg-[var(--sr-purple)] font-bold text-white",
                    o.kieu === "sap" && "border-2 border-[var(--sr-purple)] font-bold text-[var(--sr-purple-text)]",
                    o.homNay && o.kieu === "khong" && "font-bold underline",
                  )}
                >
                  {o.ngay}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" className="size-2.5 rounded-full bg-[var(--sr-orange)]" />
                Đã học
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" className="size-2.5 rounded-full bg-[var(--sr-purple)]" />
                Buổi kế tiếp
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" className="size-2.5 rounded-full border-2 border-[var(--sr-purple)]" />
                Sắp tới
              </span>
            </div>
          </article>

          {d.moc ? (
            <article className="flex flex-col gap-2 rounded-[20px] bg-[var(--sr-tint-orange)] p-[18px]">
              <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.08em]">
                <CalendarDays className="size-3.5" aria-hidden="true" />
                {d.moc.nhan}
              </div>
              <div className="text-[17px] font-bold">
                {d.moc.tieuDe} · {d.moc.ngay}
              </div>
              <div className="text-[13px] leading-5">Con trình bày sản phẩm tự làm trước lớp.</div>
            </article>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
