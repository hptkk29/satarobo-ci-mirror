"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { HvDauTrang, HvThe, NUT_CAM } from "@/components/portal/hv-ui";
import { HvTabs } from "@/components/portal/hv-tabs";
import { Sticker } from "@/components/portal/sticker";
import { moTaLuot, type BaiCanLam, type BaiDaNop, type KieuThi, type ThiTho } from "@/lib/portal/hv-bai-tap-thuan";

// Màn "Bài tập & bài thi" — artifact HV-Bai-tap / M-HV-Bai-tap.
// Khác bản thiết kế (có lý do): nộp bài làm ở trang riêng (/bai-tap/[id]) vì nộp thật cần tải tệp lên R2; không có chip "+20 coin"
// (hệ thống chưa tự cộng coin khi nộp bài); không có thẻ "Báo cáo cuối học phần" (chưa có dữ liệu buổi báo cáo).

type BaiThiDong = ThiTho & { lop: string | null; kieu: KieuThi };
type Tab = "can" | "da" | "thi";

const BUOC = [
  "Đọc lại đề và xem ảnh mô hình em đã lắp ở lớp.",
  "Làm bài trên giấy hoặc trên máy — không cần đẹp, cần đúng ý.",
  "Chụp ảnh hoặc quay video ngắn rồi bấm Nộp bài.",
];

export function HvBaiTapTrang({
  tenKhoa,
  canLam,
  daNop,
  thi,
}: {
  tenKhoa: string | null;
  canLam: BaiCanLam[];
  daNop: BaiDaNop[];
  thi: BaiThiDong[];
}) {
  const [tab, setTab] = useState<Tab>("can");
  return (
    <>
      <HvDauTrang nhan={tenKhoa?.toUpperCase()} tieuDe="Bài tập & bài thi" />
      <HvTabs<Tab>
        nhan="Loại bài"
        muc={[
          { id: "can", ten: canLam.length ? `Cần làm (${canLam.length})` : "Cần làm" },
          { id: "da", ten: "Đã nộp" },
          { id: "thi", ten: "Bài thi" },
        ]}
        gia={tab}
        doi={setTab}
        className="max-w-[560px]"
      />

      {tab === "can" &&
        (canLam.length === 0 ? (
          <section className="flex flex-wrap items-center gap-[18px] rounded-[22px] bg-[var(--sr-success-bg)] p-7">
            <Sticker ten="an-mung" cao={104} />
            <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1.5">
              <h2 className="m-0 font-display text-[28px] font-extrabold leading-[34px] text-[var(--sr-success)]">Em nộp hết bài rồi!</h2>
              <div className="text-[15px] leading-[23px]">Có bài mới là em thấy ở đây. Điểm của các bài đã nộp nằm ở mục “Đã nộp”.</div>
            </div>
          </section>
        ) : (
          canLam.map((b) => (
            <HvThe key={b.id} vien="cam" className="gap-[18px] p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1.5">
                  <div className="text-xs font-bold text-[var(--sr-orange-text)]">BÀI VỀ NHÀ{b.buoi !== null ? ` · BUỔI ${b.buoi}` : ""}</div>
                  <h2 className="m-0 break-words text-[22px] font-bold leading-[29px]">{b.ten}</h2>
                  <div className="text-sm text-muted-foreground">{b.han.nhan || "Chưa đặt hạn nộp"}</div>
                </div>
              </div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-3">
                {BUOC.map((t, i) => (
                  <div key={t} className="flex gap-3 rounded-2xl bg-background p-3.5">
                    <span className="grid size-[30px] shrink-0 place-items-center rounded-full bg-[var(--sr-purple)] text-sm font-bold text-white">{i + 1}</span>
                    <span className="text-sm leading-[21px]">{t}</span>
                  </div>
                ))}
              </div>
              <Link href={`/portal/hoc-sinh/bai-tap/${b.id}`} className={cn(NUT_CAM, "h-12 self-start text-[15px]")}>
                Làm bài và nộp
              </Link>
            </HvThe>
          ))
        ))}

      {tab === "da" &&
        (daNop.length === 0 ? (
          <p className="m-0 rounded-[22px] border border-dashed border-[var(--sr-dash)] bg-card p-8 text-center text-[15px] text-muted-foreground">
            Em chưa nộp bài nào. Nộp bài xong là em thấy ở đây.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {daNop.map((d) => (
              <article key={d.id} className="flex flex-wrap items-center gap-4 rounded-[20px] border border-border bg-card p-[18px]">
                <span
                  className={cn(
                    "grid min-h-[60px] min-w-[60px] shrink-0 place-items-center rounded-[18px] px-1 font-display text-[22px] font-extrabold",
                    d.choCham ? "bg-[var(--sr-tint-purple)] text-muted-foreground" : "bg-[var(--sr-success-bg)] text-[var(--sr-success)]",
                    d.diem && !d.diem.thang10 && "text-base",
                  )}
                >
                  {d.diem ? d.diem.chu : "…"}
                </span>
                <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
                  <div className="text-xs font-bold text-muted-foreground">
                    {[d.buoi !== null ? `Buổi ${d.buoi}` : null, d.ngayNop ? `nộp ${d.ngayNop}` : null, d.tre ? "nộp trễ" : null].filter(Boolean).join(" · ")}
                  </div>
                  <b className="break-words text-base">{d.ten}</b>
                  <span className="text-sm leading-[21px] text-[var(--sr-ink-body)]">
                    {d.choCham ? "Đang chờ thầy cô chấm" : (d.loi ?? "Thầy cô đã chấm bài này.")}
                  </span>
                </div>
              </article>
            ))}
          </div>
        ))}

      {tab === "thi" &&
        (thi.length === 0 ? (
          <p className="m-0 rounded-[22px] border border-dashed border-[var(--sr-dash)] bg-card p-8 text-center text-[15px] text-muted-foreground">
            Chưa có bài thi nào cho em. Có bài thi là em thấy ở đây.
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] items-start gap-4">
            {thi.map((t) => (
              <HvThe key={t.id} as="article" vien={t.kieu === "lam-duoc" || t.kieu === "dang-lam" ? "tim" : undefined} className="gap-2.5">
                <div className="text-xs font-bold tracking-[0.06em] text-[var(--sr-purple-text)]">
                  {t.kieu === "lam-duoc" ? "LÀM TRÊN MÁY · ĐANG MỞ" : t.kieu === "dang-lam" ? "EM ĐANG LÀM DỞ" : t.kieu === "het-luot" ? "EM ĐÃ LÀM XONG" : t.kieu === "chua-mo" ? "CHƯA MỞ" : "ĐÃ ĐÓNG"}
                </div>
                <b className="break-words text-xl">{t.title}</b>
                <div className="text-sm text-muted-foreground">{moTaLuot(t)}</div>
                {t.totalScore !== null && (t.kieu === "het-luot" || t.kieu === "lam-duoc") && (
                  <div className="text-sm font-bold text-[var(--sr-success)]">Điểm lần gần nhất: {String(t.totalScore).replace(".", ",")}</div>
                )}
                {(t.kieu === "lam-duoc" || t.kieu === "dang-lam") && (
                  <Link href={`/portal/hoc-sinh/bai-thi/${t.id}`} className={cn(NUT_CAM, "h-[46px] self-start text-[15px]")}>
                    {t.kieu === "dang-lam" ? "Làm tiếp" : t.attemptsUsed > 0 ? "Làm lại" : "Bắt đầu làm bài"}
                  </Link>
                )}
              </HvThe>
            ))}
          </div>
        ))}
    </>
  );
}
