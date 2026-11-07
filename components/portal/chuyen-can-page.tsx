"use client";

import { NoiDungTrong } from "@/components/portal/sticker";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { NHAN_BAC, NHAN_BAC_NGAN, NHAN_KIEU, type KieuO } from "@/lib/portal/chuyen-can-thuan";
import type { ChuyenCan } from "@/lib/portal/chuyen-can";

// Cổng phụ huynh — "Chuyên cần & kết quả", dựng theo artifact Chuyen-can.dc.html.
// KHÔNG vẽ: tab chọn con (cổng đã có bộ chọn con ở thanh bên), thẻ "Học vượt để bắt kịp lớp" và ô "Đi trễ" (hệ thống chưa lưu
// học vượt / đi trễ cho phụ huynh xem). Lượt bù miễn phí chỉ hiện khi trung tâm đã mở sổ lượt cho con.

const CARD = "rounded-[20px] border border-border bg-card";
const H2 = "text-xl font-bold";
const MUTED = "text-[13px] text-[var(--sr-ink-muted)]";

const MAU_O: Record<KieuO, string> = {
  co: "bg-[var(--sr-orange)] text-[var(--sr-on-orange)]",
  bu: "bg-[var(--sr-success)] text-white",
  cho: "border-2 border-[var(--sr-bad)] bg-card text-[var(--sr-bad-ink)]",
  xep: "border-2 border-dashed border-[var(--sr-purple)] bg-card text-[var(--sr-purple-text)]",
  vang: "border border-dashed border-[var(--sr-bad)] bg-card text-[var(--sr-bad-ink)]",
  "chua-cham": "bg-[var(--sr-tint-orange)] text-[var(--sr-orange-text)]",
  ke: "border-2 border-[var(--sr-purple)] bg-[var(--sr-tint-purple)] text-[var(--sr-purple-text)]",
  sap: "bg-[var(--sr-soft-off)] text-[var(--sr-soft-off-ink)]",
  huy: "border border-dashed border-border bg-card text-[var(--sr-dash)] line-through",
  ngoai: "border border-dashed border-border bg-card text-[var(--sr-dash)]",
};
const THU_TU: KieuO[] = ["co", "bu", "cho", "xep", "vang", "chua-cham", "ke", "sap", "huy", "ngoai"];

export function ChuyenCanPage({ d }: { d: ChuyenCan }) {
  const [chonId, setChonId] = useState<string | null>(d.chonMacDinh);
  const tatCa = d.hang.flatMap((h) => h.o);
  const chon = tatCa.find((o) => o.id === chonId) ?? null;
  const coKieu = new Set(tatCa.map((o) => o.kieu));
  const nhan = (k: KieuO) => (k === "ngoai" ? (d.nhanNgoai ?? NHAN_KIEU.ngoai) : NHAN_KIEU[k]);
  const canhBaoHero = d.ketLuan.sac === "canh-bao";
  const eyebrow = [d.tenCon, d.tenKhoa, d.tenLop].filter(Boolean).join(" · ");
  const ngayConLai = tatCa.find((o) => o.kieu === "ke" || o.kieu === "sap");

  const o: { nhan: string; v: string; ghi: string; tone?: "ok" | "warn" }[] = [
    { nhan: "Lớp đã học", v: String(d.so.lopDaHoc), ghi: "buổi đã qua ngày" },
    { nhan: "Con đã học", v: String(d.so.conDaHoc), ghi: `có mặt ${d.so.coMat} · bù ${d.so.bu}`, tone: "ok" },
    { nhan: "Chờ học bù", v: String(d.so.choBu), ghi: d.so.choBu ? "chưa học bù" : "không có", tone: d.so.choBu ? "warn" : undefined },
    ...(d.so.vangKhongBu > 0 ? [{ nhan: "Vắng chưa có đơn bù", v: String(d.so.vangKhongBu), ghi: "nên gửi đơn học bù", tone: "warn" as const }] : []),
    ...(d.so.chuaCham > 0 ? [{ nhan: "Chưa chấm điểm danh", v: String(d.so.chuaCham), ghi: "giáo viên chưa chấm" }] : []),
    { nhan: "Còn lại", v: String(d.so.conLai), ghi: ngayConLai ? `từ buổi ${ngayConLai.n}` : "đã học hết" },
    {
      nhan: "Tỉ lệ có mặt",
      v: d.so.tiLe ? `${d.so.tiLe.phanTram}%` : "—",
      ghi: d.so.tiLe ? `${d.so.tiLe.coMat}/${d.so.tiLe.mauSo} buổi lớp đã học` : "chưa có buổi nào được chấm",
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-[22px]">
      <header className="flex flex-col gap-1.5">
        <div className="break-words text-xs font-bold uppercase tracking-[0.08em] text-[var(--sr-orange-text)]">{eyebrow}</div>
        <h1 className="font-display text-[28px] font-extrabold leading-[34px] min-[560px]:text-[32px] min-[560px]:leading-[38px]">Chuyên cần &amp; kết quả học</h1>
        <div className="text-sm text-[var(--sr-ink-muted)]">
          Cập nhật sau mỗi buổi điểm danh{d.capNhat ? ` · lần cuối ${d.capNhat}` : ""}
        </div>
      </header>

      <section
        aria-label="Kết luận"
        className={cn(
          "flex flex-wrap items-center gap-6 rounded-[22px] p-5 text-white min-[560px]:p-6",
          canhBaoHero ? "bg-[var(--sr-purple-deep)]" : "bg-[var(--sr-purple)]",
        )}
      >
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2">
          <div className="text-[13px] font-bold tracking-[0.06em] opacity-85">CON CÓ HỌC ĐỦ BUỔI KHÔNG?</div>
          <div className="font-display text-[24px] font-extrabold leading-[30px] min-[560px]:text-[28px] min-[560px]:leading-[34px]">{d.ketLuan.tieuDe}</div>
          <div className="text-[15px] leading-[23px]">{d.ketLuan.giaiThich}</div>
        </div>
        <div className="flex min-w-0 flex-[0_1_300px] flex-col gap-2.5">
          <div className="flex flex-col gap-1 rounded-[14px] bg-white/15 px-4 py-3.5">
            <div className="text-xs font-bold tracking-[0.06em] opacity-85">VIỆC CỦA BA MẸ</div>
            <div className="text-[15px] font-bold">{d.ketLuan.viec}</div>
          </div>
          <Link
            href={d.ketLuan.nut.href}
            className="inline-flex h-[46px] items-center justify-center rounded-xl bg-[var(--sr-orange)] text-sm font-bold text-[var(--sr-on-orange)]"
          >
            {d.ketLuan.nut.nhan}
          </Link>
        </div>
      </section>

      <section aria-labelledby="h-so" className={cn(CARD, "flex flex-col gap-4 p-[22px]")}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="h-so" className={H2}>Sổ buổi học</h2>
          <span className={MUTED}>
            Đã đăng ký {d.dangKy} buổi{d.hang.length > 1 ? ` · ${d.hang.length} học phần` : ""}
          </span>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(150px,100%),1fr))] gap-3">
          {o.map((k) => (
            <div
              key={k.nhan}
              className={cn(
                "flex flex-col gap-1 rounded-[14px] p-3.5",
                k.tone === "ok" ? "bg-[var(--sr-success-bg)]" : k.tone === "warn" ? "bg-[var(--sr-tint-orange)]" : "bg-background",
              )}
            >
              <div className="text-xs font-semibold text-[var(--sr-ink-muted)]">{k.nhan}</div>
              <div
                className={cn(
                  "font-display text-[30px] font-extrabold leading-[34px]",
                  k.tone === "ok" ? "text-[var(--sr-success)]" : k.tone === "warn" ? "text-[var(--sr-orange-text)]" : "",
                )}
              >
                {k.v}
              </div>
              <div className="text-xs leading-4 text-[var(--sr-ink-muted)]">{k.ghi}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-[14px] bg-background px-4 py-3.5 text-sm">
          <span className="font-bold">Phép cộng kiểm tra:</span>
          <span>{d.phep.ve}</span>
          <span className={cn("font-bold", d.phep.khop ? "text-[var(--sr-success)]" : "text-[var(--sr-bad-ink)]")}>{d.phep.khop ? "✓ " : "⚠ "}{d.phep.nhan}</span>
        </div>
      </section>

      {tatCa.length > 0 ? (
        <section aria-labelledby="h-map" className={cn(CARD, "flex flex-col gap-4 p-[22px]")}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="h-map" className={H2}>Từng buổi của cả khoá</h2>
            <span className={MUTED}>Bấm vào một buổi để xem chi tiết</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {THU_TU.filter((k) => coKieu.has(k)).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5 text-xs">
                <span aria-hidden="true" className={cn("box-border size-3.5 rounded", MAU_O[k])} />
                {nhan(k)}
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-3">
            {d.hang.map((h) => (
              <div key={h.ten} className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
                <div className="flex flex-[0_0_120px] flex-col">
                  <span className="text-[13px] font-bold">{h.ten}</span>
                  <span className="text-xs text-[var(--sr-ink-muted)]">{h.tom}</span>
                </div>
                <div className="grid min-w-0 flex-[1_1_420px] grid-cols-6 gap-1.5 min-[560px]:grid-cols-[repeat(12,minmax(0,1fr))]">
                  {h.o.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      aria-label={`Buổi ${b.n}: ${nhan(b.kieu)}`}
                      aria-pressed={b.id === chonId}
                      onClick={() => setChonId(b.id)}
                      className={cn(
                        "box-border aspect-square min-h-7 min-w-0 rounded-lg p-0 text-xs font-bold",
                        MAU_O[b.kieu],
                        b.id === chonId ? "outline outline-[3px] outline-offset-2 outline-[var(--sr-ink)]" : "",
                      )}
                    >
                      {b.n}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {chon ? (
            <div aria-live="polite" className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5 rounded-[14px] border border-border px-4 py-3.5">
              <span className="text-[15px] font-bold">Buổi {chon.n}{chon.ten ? ` · ${chon.ten}` : ""}</span>
              <span className={MUTED}>{chon.ngay}</span>
              <span className={cn("box-border rounded-full px-2.5 py-[3px] text-xs font-bold", MAU_O[chon.kieu])}>{nhan(chon.kieu)}</span>
              <span className="flex-[1_1_100%] text-sm leading-[21px]">{chon.ghi}</span>
            </div>
          ) : null}
        </section>
      ) : (
        <NoiDungTrong ten="doc-sach" className="rounded-2xl border-2 border-dashed border-border p-6 text-sm text-[var(--sr-ink-muted)]">Chưa có buổi học nào trong lớp của con.</NoiDungTrong>
      )}

      {d.luot ? (
        <section aria-labelledby="h-bu" className={cn(CARD, "flex max-w-[560px] flex-col gap-3.5 p-[22px]")}>
          <h2 id="h-bu" className={H2}>Lượt học bù miễn phí</h2>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-[40px] font-extrabold text-[var(--sr-purple-text)]">{d.luot.con}</span>
            <span className="text-[15px] text-[var(--sr-ink-muted)]">/ {d.luot.tong} lượt còn lại</span>
          </div>
          <div className="flex gap-1.5">
            {Array.from({ length: d.luot.tong }, (_, i) => {
              const tt = i < d.luot!.dung ? "dung" : i < d.luot!.dung + d.luot!.giu ? "giu" : "con";
              return (
                <span
                  key={i}
                  title={tt === "dung" ? "Đã dùng" : tt === "giu" ? "Đang giữ" : "Còn"}
                  className={cn(
                    "box-border h-3 flex-1 rounded-full",
                    tt === "dung" ? "bg-[var(--sr-dash)]" : tt === "giu" ? "border-2 border-[var(--sr-orange)] bg-card" : "bg-[var(--sr-purple)]",
                  )}
                />
              );
            })}
          </div>
          <div className="flex flex-col gap-1.5 text-[13px] leading-[19px]">
            <div className="flex justify-between gap-2.5"><span className="text-[var(--sr-ink-muted)]">Đã dùng</span><b>{d.luot.dung} lượt</b></div>
            <div className="flex justify-between gap-2.5"><span className="text-[var(--sr-ink-muted)]">Đang giữ cho buổi đã xếp</span><b>{d.luot.giu} lượt</b></div>
          </div>
          <div className="rounded-xl bg-[var(--sr-tint-purple)] px-3.5 py-3 text-[13px] leading-[19px]">
            Mỗi học phần đã đăng ký có 1 lượt bù, dùng lúc nào cũng được và không hết hạn. Hết lượt thì buổi bù tính phí bằng giá một buổi của khoá. Trung tâm xếp buổi bù tại cơ sở của con.
          </div>
          <Link href="/portal/yeu-cau" className="text-sm font-bold text-[var(--sr-purple-text)] hover:underline">Xin nghỉ &amp; học bù →</Link>
        </section>
      ) : null}

      <section aria-labelledby="h-cl" className={cn(CARD, "flex flex-col gap-[18px] p-[22px]")}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="h-cl" className={H2}>Con học có ổn không?</h2>
          <Link href="/portal/nhan-xet" className="text-sm font-bold text-[var(--sr-purple-text)] hover:underline">Đọc từng nhận xét →</Link>
        </div>
        {d.canhBao ? (
          <div
            className={cn(
              "flex gap-3 rounded-[14px] px-4 py-3.5",
              d.canhBao.loai === "tot" ? "bg-[var(--sr-success-bg)]" : "bg-[var(--sr-tint-orange)]",
            )}
          >
            <span aria-hidden="true" className="flex-none text-lg leading-[22px]">{d.canhBao.loai === "tot" ? "✓" : "!"}</span>
            <div className="flex min-w-0 flex-col gap-1">
              <b className="text-[15px]">{d.canhBao.tieuDe}</b>
              <span className="text-sm leading-[21px]">{d.canhBao.noi}</span>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border-2 border-dashed border-border p-4 text-sm text-[var(--sr-ink-muted)]">
            Chưa có phiếu nhận xét nào chấm tiêu chí để đánh giá.
          </div>
        )}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-5">
          <div className="flex flex-col gap-2.5">
            <div className="text-sm font-bold">Xếp loại từng buổi</div>
            {d.xepLoai.length > 0 ? (
              <>
                <div className="flex h-[120px] items-end gap-2 border-b border-border px-1">
                  {d.xepLoai.map((x) => (
                    <div key={x.n} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                      <span className="text-[10px] font-bold text-[var(--sr-ink-muted)]">{NHAN_BAC_NGAN[x.bac]}</span>
                      <div
                        className={cn("w-full max-w-9 rounded-t-md", x.bac === 3 ? "bg-[var(--sr-purple)]" : x.bac === 2 ? "bg-[var(--sr-purple-mid)]" : "bg-[var(--sr-orange)]")}
                        style={{ height: x.bac === 3 ? 84 : x.bac === 2 ? 60 : 36 }}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 px-1">
                  {d.xepLoai.map((x) => (
                    <span key={x.n} className="min-w-0 flex-1 text-center text-[11px] text-[var(--sr-ink-muted)]">B{x.n}</span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2.5 text-xs text-[var(--sr-ink-muted)]">
                  <span>{NHAN_BAC[3]} = giỏi</span><span>{NHAN_BAC[2]} = hoàn thành đủ</span><span>{NHAN_BAC[1]} = chưa tập trung</span>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border-2 border-dashed border-border p-4 text-sm text-[var(--sr-ink-muted)]">Chưa có buổi nào được chấm tiêu chí.</div>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <div className="text-sm font-bold">Điểm thầy cô chấm (trung bình)</div>
            {d.diem.length > 0 ? (
              d.diem.map((s) => (
                <div key={s.ten} className="flex flex-col gap-1">
                  <div className="flex justify-between text-[13px]"><span>{s.ten}</span><b>{s.chu} / 5</b></div>
                  <div className="h-2 rounded-full bg-[var(--sr-tint-purple)]">
                    <div className="h-2 rounded-full bg-[var(--sr-purple)]" style={{ width: `${Math.round((s.diem / 5) * 100)}%` }} />
                  </div>
                </div>
              ))
            ) : (
              <div className="text-[13px] text-[var(--sr-ink-muted)]">Chưa có điểm.</div>
            )}
            <div className="mt-1 grid grid-cols-2 gap-2.5">
              {/* «Bài tập & bài thi» tạm ẩn (03/11/2026): không vẽ ô này — nó là liên kết tới trang đã 404. */}
              {d.coBaiTap && (
                <Link href="/portal/bai-tap" className="flex flex-col gap-0.5 rounded-xl border border-border p-3 hover:bg-[var(--sr-tint-purple)]">
                  <span className="text-xs text-[var(--sr-ink-muted)]">Bài về nhà đã nộp</span>
                  <b className="text-lg">{d.baiVe.tong > 0 ? `${d.baiVe.nop} / ${d.baiVe.tong}` : "—"}</b>
                </Link>
              )}
              <Link href="/portal/hinh-anh" className="flex flex-col gap-0.5 rounded-xl border border-border p-3 hover:bg-[var(--sr-tint-purple)]">
                <span className="text-xs text-[var(--sr-ink-muted)]">Buổi có sản phẩm</span>
                <b className="text-lg">{d.sanPham ? `${d.sanPham.so} / ${d.sanPham.tong}` : "—"}</b>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <details className="rounded-2xl border border-border bg-card px-[18px] py-3.5 text-[13px] leading-5">
        <summary className="cursor-pointer text-sm font-bold">Các con số được tính thế nào?</summary>
        <div className="mt-2.5 flex flex-col gap-1.5">
          <div><b>Đã học</b> = buổi có mặt + buổi học bù đã học.</div>
          <div><b>Lớp đã học</b> = buổi của lớp đã qua ngày; buổi trung tâm huỷ và buổi ngoài phạm vi con đăng ký không tính.</div>
          <div><b>Chờ bù</b> = buổi vắng (có hoặc không phép) đã có đơn học bù nhưng chưa học bù xong.</div>
          <div><b>Còn lại</b> = buổi của lớp chưa diễn ra.</div>
          <div><b>Tỉ lệ có mặt</b> không tính buổi giáo viên chưa chấm điểm danh — chưa chấm không phải là vắng.</div>
        </div>
      </details>
    </div>
  );
}
