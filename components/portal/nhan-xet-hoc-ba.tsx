"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  chonMacDinh,
  gomHocPhan,
  nangLucCaKhoa,
  tongHop,
  type BuoiNX,
  type PhieuView,
  type XuHuongTC,
} from "@/lib/portal/nhan-xet-thuan";
import type { NhanXetData } from "@/lib/portal/nhan-xet";

// Cổng phụ huynh — "Nhận xét & học bạ", dựng theo artifact Nhan-xet.dc.html (3 kiểu xem: Từng buổi · Tổng hợp cả khoá · Học bạ khoá).
// KHÔNG vẽ (chưa có nơi ghi): nút "Cảm ơn thầy", "Gợi ý trò chuyện với con", nút "Tải PDF" khi học bạ chưa phát hành,
// ô "Nhận xét theo giai đoạn" giả. Mọi phần có dữ liệu đều đọc từ phiếu nhận xét + học bạ thật.

const CARD = "rounded-[20px] border border-border bg-card";
const NHAN = "text-xs font-bold uppercase tracking-[0.08em] text-[var(--sr-orange-text)]";
const H2 = "text-xl font-bold";
const MUTED = "text-xs text-[var(--sr-ink-muted)]";
const KHUNG_TRONG = "rounded-2xl border-2 border-dashed border-border p-6 text-sm leading-[21px] text-[var(--sr-ink-muted)]";

const TABS = ["Từng buổi", "Tổng hợp cả khoá", "Học bạ khoá"] as const;

// Nhãn mức của điểm năng lực trong học bạ ĐÃ PHÁT HÀNH — cùng bảng với /portal/hoc-ba.
const MUC_HOC_BA: Record<number, string> = { 1: "Cần cố gắng", 2: "Đạt", 3: "Khá", 4: "Tốt" };

function Vach({ n }: { n: number }) {
  const mau = n >= 4 ? "bg-[var(--sr-success)]" : n === 3 ? "bg-[var(--sr-orange)]" : "bg-[var(--sr-bad)]";
  return (
    <span role="img" aria-label={`${n} trên 5 vạch`} className="flex gap-[3px]">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cn("h-2 w-3.5 rounded-[3px]", i <= n ? mau : "bg-[var(--sr-bar-off)]")} />
      ))}
    </span>
  );
}

function ChungText({ chung }: { chung: PhieuView["chung"] }) {
  return (
    <div className="flex flex-col gap-2 rounded-[14px] bg-[var(--sr-tint-purple)] px-5 py-[18px] text-[15px] leading-6">
      {chung.map((d, i) => (
        <p key={i} className="whitespace-pre-line">
          {d.nhan ? <b>{d.nhan}: </b> : null}
          {d.text}
        </p>
      ))}
    </div>
  );
}

function ChiTietBuoi({ b }: { b: BuoiNX }) {
  const p = b.phieu;
  if (b.kieu === "huy") return <div className={KHUNG_TRONG}>Buổi này đã huỷ nên không có nhận xét.</div>;
  if (b.kieu === "chua")
    return (
      <div className={KHUNG_TRONG}>
        Buổi này chưa diễn ra. Nhận xét hiện ở đây sau khi thầy cô chấm phiếu.
      </div>
    );
  if (b.kieu === "cho-phieu")
    return (
      <div className={KHUNG_TRONG}>
        Thầy cô chưa gửi nhận xét cho buổi này. Nhận xét hiện ở đây ngay khi thầy cô chấm xong phiếu.
      </div>
    );
  if (b.kieu === "vang" || !p)
    return (
      <div className="flex flex-col items-start gap-2.5 rounded-2xl border-2 border-dashed border-[var(--sr-bad-line)] bg-[var(--sr-bad-bg)] p-6">
        <b className="text-base">Con vắng buổi này nên chưa có nhận xét</b>
        {b.vangGhi ? <span className="text-sm leading-[21px]">{b.vangGhi}</span> : null}
        {b.canBu ? (
          <Link
            href="/portal/yeu-cau"
            className="inline-flex h-11 items-center rounded-xl bg-[var(--sr-orange)] px-4 text-sm font-bold text-[var(--sr-on-orange)]"
          >
            Chọn giờ học bù
          </Link>
        ) : null}
      </div>
    );
  return (
    <>
      {p.chung.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-bold tracking-[0.06em] text-[var(--sr-purple-text)]">ĐÁNH GIÁ CHUNG</h3>
          <ChungText chung={p.chung} />
        </section>
      ) : null}
      {p.deXuat ? (
        <section className="flex flex-col gap-1.5 rounded-2xl bg-[var(--sr-tint-orange)] px-[18px] py-4">
          <h3 className="text-[13px] font-bold tracking-[0.06em] text-[var(--sr-orange-text)]">ĐỀ XUẤT CỦA THẦY CÔ</h3>
          <div className="whitespace-pre-line text-[15px] leading-[23px]">{p.deXuat}</div>
        </section>
      ) : null}
      {p.nhom.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-1.5">
            <h3 className="text-[13px] font-bold tracking-[0.06em] text-[var(--sr-purple-text)]">
              {p.soTieuChi} TIÊU CHÍ THẦY CÔ ĐÃ CHẤM
            </h3>
            <span className={MUTED}>Càng nhiều vạch càng tốt · 5 vạch là mức cao nhất</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-3">
            {p.nhom.map((g) => (
              <div key={g.ten} className="flex flex-col gap-3 rounded-2xl border border-border px-4 py-3.5">
                <div className="text-sm font-bold">{g.ten}</div>
                {g.tc.map((c) => (
                  <div key={c.id} className="flex flex-col gap-[5px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold">{c.ten}</span>
                      <Vach n={c.vach} />
                    </div>
                    <div className="text-[13px] leading-[19px] text-[var(--sr-ink-body)]">{c.mo}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <div className="flex flex-wrap items-center gap-2.5">
        <Link
          href="/portal/tin-nhan"
          className="flex h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold hover:bg-[var(--sr-tint-purple)]"
        >
          <MessageCircle className="size-4" aria-hidden="true" />
          Hỏi thêm thầy cô
        </Link>
        <Link href="/portal/hinh-anh" className="flex h-11 items-center px-2 text-sm font-semibold text-[var(--sr-purple-text)] hover:underline">
          Xem sản phẩm buổi này
        </Link>
      </div>
    </>
  );
}

function TuongTac({ xh }: { xh: XuHuongTC }) {
  const m =
    xh === "tang"
      ? { t: "▲ tiến bộ", c: "text-[var(--sr-success)]" }
      : xh === "giam"
        ? { t: "▼ giảm", c: "text-[var(--sr-bad-ink)]" }
        : xh === "giu"
          ? { t: "— giữ", c: "text-[var(--sr-ink-muted)]" }
          : { t: "—", c: "text-[var(--sr-ink-muted)]" };
  return <td className={cn("text-center text-[11px] font-bold", m.c)}>{m.t}</td>;
}

export function NhanXetHocBa({ d }: { d: NhanXetData }) {
  const [xem, setXem] = useState(0);
  const sx = useMemo(() => [...d.buoi].sort((a, b) => a.n - b.n), [d.buoi]);
  const daHoc = (id: string) => sx.find((b) => b.id === id)?.kieu !== "chua" && sx.find((b) => b.id === id)?.kieu !== "huy";
  const nhom = useMemo(() => gomHocPhan(sx, daHoc), [sx]); // eslint-disable-line react-hooks/exhaustive-deps
  const [chonId, setChonId] = useState<string | null>(() => chonMacDinh(sx));
  const chon = sx.find((b) => b.id === chonId) ?? sx[0] ?? null;
  const [hp, setHp] = useState<number>(() => Math.max(0, nhom.findIndex((g) => g.ids.includes(chonMacDinh(sx) ?? ""))));
  const th = useMemo(() => tongHop(sx), [sx]);
  const nl = useMemo(() => nangLucCaKhoa(sx), [sx]);
  const chi = chon ? sx.findIndex((b) => b.id === chon.id) : -1;

  const moBuoi = (id: string) => {
    setChonId(id);
    setHp(Math.max(0, nhom.findIndex((g) => g.ids.includes(id))));
    setXem(0);
  };
  const dichChuyen = (buoc: number) => {
    const b = sx[chi + buoc];
    if (b) moBuoi(b.id);
  };
  const g = nhom[hp] ?? nhom[0];
  const ods = g ? g.ids.map((id) => sx.find((b) => b.id === id)).filter((b): b is BuoiNX => !!b) : [];
  const hb = d.hocBa;
  const chinhThuc = !!hb?.isOfficial;

  const eyebrow = [d.tenCon, d.tenKhoa, d.tenLop].filter(Boolean).join(" · ");

  return (
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className={cn(NHAN, "break-words")}>
            {eyebrow ? `${eyebrow} · ` : ""}
            {th.soPhieu} PHIẾU NHẬN XÉT
          </div>
          <h1 className="font-display text-[28px] font-extrabold leading-[34px] min-[560px]:text-[32px] min-[560px]:leading-[38px]">
            Thầy cô nói gì về {d.tenCon || "con"}
          </h1>
        </div>
        <div role="tablist" aria-label="Kiểu xem" className="flex flex-wrap gap-1 rounded-xl bg-[var(--sr-tint-purple)] p-1">
          {TABS.map((l, k) => (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={k === xem}
              onClick={() => setXem(k)}
              className={cn(
                "h-10 rounded-[9px] px-4 text-sm",
                k === xem ? "bg-card font-bold text-[var(--sr-ink)] shadow-sm" : "font-semibold text-[var(--sr-ink-muted)]",
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </header>

      {xem === 0 ? (
        sx.length === 0 || !chon || !g ? (
          <div className={KHUNG_TRONG}>Chưa có buổi học nào để hiện nhận xét.</div>
        ) : (
          <div className="flex flex-wrap items-start gap-5">
            <aside aria-label="Chọn buổi" className={cn(CARD, "flex min-w-0 max-w-full flex-[1_1_300px] flex-col gap-3.5 p-[18px]")}>
              <div role="tablist" aria-label="Học phần" className="grid grid-cols-[repeat(auto-fit,minmax(64px,1fr))] gap-1.5">
                {nhom.map((h, i) => (
                  <button
                    key={h.ma}
                    type="button"
                    role="tab"
                    aria-selected={i === hp}
                    onClick={() => {
                      setHp(i);
                      const co = h.ids.map((id) => sx.find((b) => b.id === id)).filter((b): b is BuoiNX => !!b);
                      const dahoc = co.filter((b) => b.kieu !== "chua" && b.kieu !== "huy");
                      const dich = dahoc.length ? dahoc[dahoc.length - 1] : co[0];
                      if (dich) setChonId(dich.id);
                    }}
                    className={cn(
                      "flex flex-col items-center gap-px rounded-[10px] px-1 py-2",
                      i === hp
                        ? "bg-[var(--sr-purple)] text-white"
                        : cn("border border-border bg-card", h.tom === "chưa học" ? "text-[var(--sr-soft-off-ink)]" : "text-[var(--sr-ink)]"),
                    )}
                  >
                    <span className="text-[13px] font-bold">{h.ten}</span>
                    <span className="text-[11px]">{h.tom}</span>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-6 gap-1.5">
                {ods.map((b) => {
                  const sel = b.id === chon.id;
                  const kieu =
                    b.kieu === "phieu"
                      ? "border border-border bg-background text-[var(--sr-ink)]"
                      : b.kieu === "vang"
                        ? "border-2 border-[var(--sr-bad)] bg-card text-[var(--sr-bad-ink)]"
                        : b.kieu === "cho-phieu"
                          ? "border border-dashed border-[var(--sr-dash)] bg-card text-[var(--sr-ink)]"
                          : "bg-[var(--sr-soft-off)] text-[var(--sr-soft-off-ink)]";
                  const aria = `Buổi ${b.n}${b.kieu === "vang" ? " — vắng" : b.kieu === "chua" ? " — chưa học" : b.kieu === "cho-phieu" ? " — chờ nhận xét" : b.kieu === "huy" ? " — đã huỷ" : b.moi ? " — nhận xét mới" : ""}`;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      aria-label={aria}
                      aria-pressed={sel}
                      onClick={() => setChonId(b.id)}
                      className={cn(
                        "relative flex aspect-square min-h-10 items-center justify-center rounded-[10px] text-sm font-bold",
                        sel ? "border-0 bg-[var(--sr-purple)] text-white" : kieu,
                      )}
                    >
                      <span>{b.n}</span>
                      {b.moi ? <span aria-hidden="true" className="absolute right-[5px] top-[5px] size-2 rounded-full bg-[var(--sr-orange)]" /> : null}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-[var(--sr-ink-muted)]">
                <span className="inline-flex items-center gap-[5px]"><span className="size-2 rounded-full bg-[var(--sr-orange)]" />Nhận xét mới</span>
                <span className="inline-flex items-center gap-[5px]"><span className="box-border size-2.5 rounded-[3px] border-2 border-[var(--sr-bad)]" />Vắng</span>
                <span className="inline-flex items-center gap-[5px]"><span className="box-border size-2.5 rounded-[3px] border border-dashed border-[var(--sr-dash)]" />Chờ nhận xét</span>
                <span className="inline-flex items-center gap-[5px]"><span className="size-2.5 rounded-[3px] bg-[var(--sr-soft-off)]" />Chưa học</span>
              </div>
            </aside>

            <article className={cn(CARD, "flex min-w-0 flex-[999_1_520px] flex-col gap-5 p-4 min-[560px]:p-6")}>
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className={NHAN}>BUỔI {chon.n} · {chon.ngay}</div>
                  <h2 className="font-display text-[22px] font-extrabold leading-7 min-[560px]:text-[26px] min-[560px]:leading-8">
                    {chon.ten || `Buổi ${chon.n}`}
                  </h2>
                  <div className="text-[13px] text-[var(--sr-ink-muted)]">
                    {chon.phieu
                      ? `${chon.phieu.giaoVien ?? "Giáo viên"} · chấm lúc ${chon.phieu.chamLuc ?? "—"}`
                      : chon.kieu === "chua"
                        ? "Chưa diễn ra"
                        : ""}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  {([-1, 1] as const).map((buoc) => {
                    const co = !!sx[chi + buoc];
                    return (
                      <button
                        key={buoc}
                        type="button"
                        aria-label={buoc < 0 ? "Buổi trước" : "Buổi sau"}
                        disabled={!co}
                        onClick={() => dichChuyen(buoc)}
                        className={cn(
                          "flex size-10 items-center justify-center rounded-[10px] border border-border bg-card",
                          co ? "text-[var(--sr-ink)]" : "cursor-not-allowed text-[var(--sr-dash)]",
                        )}
                      >
                        {buoc < 0 ? <ChevronLeft className="size-[18px]" aria-hidden="true" /> : <ChevronRight className="size-[18px]" aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              </div>
              <ChiTietBuoi b={chon} />
            </article>
          </div>
        )
      ) : null}

      {xem === 1 ? (
        th.soPhieu === 0 ? (
          <div className={KHUNG_TRONG}>
            Chưa có phiếu nhận xét nào. Bảng tổng hợp hiện ở đây sau khi thầy cô chấm phiếu buổi đầu tiên.
          </div>
        ) : (
          <>
            <section aria-label="Tóm tắt" className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-3.5">
              {[
                { nhan: "Phiếu nhận xét đã nhận", v: `${th.soPhieu} / ${th.soCoMat}`, ghi: th.soPhieu >= th.soCoMat ? "đủ cho mọi buổi con có mặt" : `${th.soCoMat - th.soPhieu} buổi con có mặt chưa có phiếu`, mau: "" },
                { nhan: "Tiêu chí tiến bộ", v: `${th.tienBo} / ${th.hang.length}`, ghi: "3 phiếu đầu so với 3 phiếu gần nhất", mau: "text-[var(--sr-success)]" },
                { nhan: "Tiêu chí giảm", v: `${th.giam} / ${th.hang.length}`, ghi: "cùng cách so như trên", mau: "" },
                ...(th.soDeXuat > 0 ? [{ nhan: "Đề xuất của thầy cô", v: String(th.soDeXuat), ghi: "đọc đủ ở danh sách bên dưới", mau: "" }] : []),
              ].map((k) => (
                <div key={k.nhan} className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-4">
                  <span className={MUTED}>{k.nhan}</span>
                  <b className={cn("font-display text-[26px] leading-[30px]", k.mau)}>{k.v}</b>
                  <span className="text-xs leading-[17px] text-[var(--sr-ink-muted)]">{k.ghi}</span>
                </div>
              ))}
            </section>

            <section aria-labelledby="h-nhiet" className={cn(CARD, "flex flex-col gap-3.5 p-[22px]")}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="h-nhiet" className={H2}>{th.hang.length} tiêu chí qua từng buổi</h2>
                <span className={MUTED}>Mỗi ô là mức thầy cô chấm ở buổi đó · bấm ô để mở buổi</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-separate border-spacing-1 text-xs" style={{ minWidth: Math.max(560, 200 + th.cot.length * 38 + 70) }}>
                  <thead>
                    <tr>
                      <th scope="col" className="px-1.5 text-left font-semibold text-[var(--sr-ink-muted)]">Tiêu chí</th>
                      {th.cot.map((c) => (
                        <th key={c.buoiId} scope="col" className="w-10 font-semibold text-[var(--sr-ink-muted)]">B{c.n}</th>
                      ))}
                      <th scope="col" className="w-[70px] font-semibold text-[var(--sr-ink-muted)]">Xu hướng*</th>
                    </tr>
                  </thead>
                  <tbody>
                    {th.hang.map((r) => (
                      <tr key={r.id}>
                        <th scope="row" className="whitespace-nowrap px-1.5 text-left font-medium">
                          <span className="text-[var(--sr-ink-muted)]">{r.nhom} · </span>
                          {r.ten}
                        </th>
                        {r.o.map((x) => (
                          <td key={x.buoiId} className="p-0">
                            {x.loai === "muc" ? (
                              <button
                                type="button"
                                aria-label={`Buổi ${x.n}, ${r.ten}: ${x.vach} trên 5 vạch`}
                                onClick={() => moBuoi(x.buoiId)}
                                className="h-[30px] w-full min-w-8 rounded-md text-xs font-bold"
                                style={{ background: `var(--sr-lv-${x.muc})`, color: `var(--sr-lv-${x.muc}-ink)` }}
                              >
                                {x.vach}
                              </button>
                            ) : (
                              <button
                                type="button"
                                aria-label={`Buổi ${x.n}: ${x.loai === "vang" ? "vắng" : "chưa có phiếu"}`}
                                onClick={() => moBuoi(x.buoiId)}
                                className={cn(
                                  "h-[30px] w-full min-w-8 rounded-md border border-dashed bg-card text-[11px] font-bold",
                                  x.loai === "vang" ? "border-[var(--sr-bad)] text-[var(--sr-bad-ink)]" : "border-[var(--sr-dash)] text-[var(--sr-ink-muted)]",
                                )}
                              >
                                {x.loai === "vang" ? "V" : "–"}
                              </button>
                            )}
                          </td>
                        ))}
                        <TuongTac xh={r.xh} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[11px] text-[var(--sr-ink-muted)]">
                {([[1, "5 vạch · tốt nhất"], [2, "4 vạch"], [3, "3 vạch"], [4, "2 vạch"], [5, "1 vạch · cần cố gắng"]] as const).map(([lv, t]) => (
                  <span key={lv} className="inline-flex items-center gap-[5px]">
                    <span className="size-3 rounded-[3px]" style={{ background: `var(--sr-lv-${lv})` }} />
                    {t}
                  </span>
                ))}
                <span>V = vắng</span>
                <span>* trung bình 3 phiếu đầu so với 3 phiếu gần nhất</span>
              </div>
              {th.manh && th.yeu ? (
                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-3">
                  <div className="flex flex-col gap-1 rounded-[14px] bg-[var(--sr-success-bg)] px-4 py-3.5">
                    <span className="text-xs font-bold tracking-[0.06em] text-[var(--sr-success)]">MẠNH NHẤT</span>
                    <b className="text-[15px]">{th.manh.ten} — trung bình {th.manh.tb}/5 vạch</b>
                  </div>
                  <div className="flex flex-col gap-1 rounded-[14px] bg-[var(--sr-tint-orange)] px-4 py-3.5">
                    <span className="text-xs font-bold tracking-[0.06em] text-[var(--sr-orange-text)]">CẦN CỐ GẮNG THÊM</span>
                    <b className="text-[15px]">{th.yeu.ten} — trung bình {th.yeu.tb}/5 vạch</b>
                  </div>
                </div>
              ) : null}
            </section>

            {th.deXuat.length > 0 ? (
              <section aria-labelledby="h-dx" className={cn(CARD, "flex flex-col gap-1.5 p-[22px]")}>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id="h-dx" className={H2}>Tất cả đề xuất của thầy cô</h2>
                  <span className={MUTED}>{th.deXuat.length} đề xuất · mới nhất ở trên</span>
                </div>
                {th.deXuat.map((x) => (
                  <div key={x.buoiId} className="flex gap-3.5 border-t border-[var(--sr-tint-purple)] py-3.5">
                    <button
                      type="button"
                      aria-label={`Mở buổi ${x.n}`}
                      onClick={() => moBuoi(x.buoiId)}
                      className="size-11 flex-none rounded-xl bg-[var(--sr-tint-orange)] text-sm font-bold text-[var(--sr-ink)]"
                    >
                      B{x.n}
                    </button>
                    <div className="flex min-w-0 flex-col gap-[3px]">
                      <span className={MUTED}>Buổi {x.n} · {x.ngay}</span>
                      <span className="text-[15px] leading-[23px]">{x.text}</span>
                    </div>
                  </div>
                ))}
              </section>
            ) : null}

            {th.chung.length > 0 ? (
              <section aria-labelledby="h-tc" className={cn(CARD, "flex flex-col gap-2.5 p-[22px]")}>
                <h2 id="h-tc" className={cn(H2, "mb-1.5")}>Toàn bộ đánh giá chung</h2>
                {th.chung.map((c) => (
                  <details key={c.buoiId} className="rounded-[14px] border border-border px-4 py-3">
                    <summary className="cursor-pointer text-sm font-bold">
                      Buổi {c.n} · {c.ngay}{c.ten ? ` · ${c.ten}` : ""}
                    </summary>
                    <div className="mt-2.5 flex flex-col gap-1.5 text-sm leading-[22px]">
                      {c.chung.map((x, i) => (
                        <p key={i} className="whitespace-pre-line">{x.nhan ? <b>{x.nhan}: </b> : null}{x.text}</p>
                      ))}
                    </div>
                  </details>
                ))}
              </section>
            ) : null}
          </>
        )
      ) : null}

      {xem === 2 ? (
        <>
          <section className="flex flex-wrap items-center justify-between gap-[18px] rounded-[22px] bg-[var(--sr-purple)] p-4 text-white min-[560px]:p-6">
            <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-1.5">
              <div className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--sr-hero-eyebrow)]">
                {["HỌC BẠ", d.tenKhoa ?? hb?.courseName, d.tenLop ?? hb?.className].filter(Boolean).join(" · ")}
              </div>
              <div className="font-display text-[22px] font-extrabold leading-7 min-[560px]:text-[26px] min-[560px]:leading-8">
                {chinhThuc ? "Học bạ đã phát hành" : "Bản tạm tính — chưa phát hành"}
              </div>
              <div className="text-sm leading-[21px]">
                {chinhThuc
                  ? "Đây là học bạ chính thức do trung tâm phát hành. Số liệu bên dưới là bản đã đóng băng lúc phát hành."
                  : "Học bạ chính thức do giáo viên chủ nhiệm hoàn thiện và trung tâm phát hành khi kết khoá. Trước đó, số liệu dưới đây cập nhật theo từng buổi."}
              </div>
            </div>
            {chinhThuc && hb?.reportCardId ? (
              <a
                href={`/api/portal/report-card/${hb.reportCardId}`}
                className="flex h-[46px] items-center rounded-xl border border-white/40 px-[18px] text-sm font-semibold text-white"
              >
                Tải PDF học bạ
              </a>
            ) : null}
          </section>

          <section aria-label="Chuyên cần cả khoá" className="grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-3.5">
            {[
              { nhan: "Buổi đã học", v: `${d.coMat} / ${d.tong}`, ghi: `lớp đã qua ${d.daQua} buổi` },
              {
                nhan: "Tỉ lệ có mặt",
                v: d.diHoc.mauSo > 0 ? `${Math.round((d.coMat / d.diHoc.mauSo) * 100)}%` : "—",
                ghi: d.diHoc.mauSo > 0 ? `${d.coMat}/${d.diHoc.mauSo} buổi` : d.diHoc.tieuDe,
              },
              { nhan: "Vắng chờ bù", v: String(d.canBuSo.length), ghi: d.canBuSo.length ? `buổi ${d.canBuSo.join(", ")}` : "không có buổi nào" },
              // «Bài tập & bài thi» tạm ẩn (03/11/2026): bỏ ô «Bài về nhà đã nộp».
              ...(d.coBaiTap
                ? [
                    {
                      nhan: "Bài về nhà đã nộp",
                      v: d.baiVe.tong > 0 ? `${d.baiVe.nop} / ${d.baiVe.tong}` : "—",
                      ghi: d.baiVe.tong === 0 ? "chưa có bài về nhà" : d.baiVe.chuaNop > 0 ? `${d.baiVe.chuaNop} bài chưa nộp` : "đã nộp hết",
                    },
                  ]
                : []),
            ].map((k) => (
              <div key={k.nhan} className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-4">
                <span className={MUTED}>{k.nhan}</span>
                <b className="font-display text-[28px]">{k.v}</b>
                <span className={MUTED}>{k.ghi}</span>
              </div>
            ))}
          </section>
          <Link href="/portal/ket-qua" className="-mt-2 self-start text-sm font-bold text-[var(--sr-purple-text)] hover:underline">
            Xem chuyên cần từng buổi →
          </Link>

          <section aria-labelledby="h-ky" className={cn(CARD, "flex flex-col gap-3.5 p-[22px]")}>
            <h2 id="h-ky" className={H2}>Nhận xét theo giai đoạn</h2>
            {hb && hb.periodComments.length > 0 ? (
              hb.periodComments.map((k, i) => (
                <div key={i} className="flex flex-col gap-2 rounded-[14px] bg-[var(--sr-tint-purple)] p-4">
                  <b className="text-[15px]">{k.period}</b>
                  <div className="whitespace-pre-line text-sm leading-[22px]">{k.comment}</div>
                </div>
              ))
            ) : (
              <div className={KHUNG_TRONG}>Chưa có nhận xét theo giai đoạn.</div>
            )}
          </section>

          <section aria-labelledby="h-nl" className={cn(CARD, "flex flex-col gap-3.5 p-[22px]")}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="h-nl" className={H2}>Đánh giá năng lực cả khoá</h2>
              <span className={MUTED}>
                {chinhThuc && hb && hb.scores.length > 0 ? "Điểm chính thức theo tiêu chí của khoá" : `Tạm tính từ ${th.soPhieu} phiếu nhận xét buổi`}
              </span>
            </div>
            {chinhThuc && hb && hb.scores.length > 0 ? (
              <ul className="flex flex-col divide-y divide-border">
                {hb.scores.map((sc) => (
                  <li key={sc.criterionId} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-sm">
                    <span className="font-semibold">{sc.name}</span>
                    <span className="text-[var(--sr-ink-muted)]">
                      {MUC_HOC_BA[sc.level] ?? sc.level}
                      {sc.note ? ` · ${sc.note}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : nl.length > 0 ? (
              <>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3">
                  {nl.map((gr) => (
                    <div key={gr.ten} className="flex flex-col gap-2.5 rounded-2xl border border-border px-4 py-3.5">
                      <div className="flex justify-between gap-2"><b className="text-sm">{gr.ten}</b><span className={MUTED}>{gr.tom}</span></div>
                      {gr.tc.map((c) => (
                        <div key={c.ten} className="flex flex-col gap-1">
                          <div className="flex justify-between gap-2 text-[13px]">
                            <span>{c.ten}</span>
                            <span className="text-[var(--sr-ink-muted)]">{c.dau} → <b className="text-[var(--sr-ink)]">{c.cuoi}</b></span>
                          </div>
                          <div className="h-2 rounded-full bg-[var(--sr-tint-purple)]">
                            <div className="h-2 rounded-full bg-[var(--sr-purple)]" style={{ width: `${c.phanTram}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="text-xs leading-[18px] text-[var(--sr-ink-muted)]">
                  Hai số là trung bình 3 phiếu đầu → 3 phiếu gần nhất, đổi sang thang 5 vạch (1–5 vạch). Khi học bạ được phát hành, phần này thay bằng điểm năng lực chính thức theo tiêu chí của khoá kèm ghi chú của giáo viên.
                </div>
              </>
            ) : (
              <div className={KHUNG_TRONG}>Chưa có phiếu nhận xét nào có chấm tiêu chí để tạm tính.</div>
            )}
          </section>

          <section aria-labelledby="h-tk" className={cn(CARD, "flex flex-col gap-2.5 p-[22px]")}>
            <h2 id="h-tk" className={H2}>Nhận xét tổng kết &amp; kết quả</h2>
            {chinhThuc && (hb?.finalComment || hb?.completionStatus) ? (
              <div className="flex flex-col gap-2 rounded-[14px] bg-[var(--sr-tint-purple)] p-[18px] text-sm leading-[22px]">
                {hb?.finalComment ? <p className="whitespace-pre-line">{hb.finalComment}</p> : null}
                {hb?.completionStatus ? <p><b>Kết quả: </b>{hb.completionStatus}</p> : null}
              </div>
            ) : (
              <div className={KHUNG_TRONG}>
                Có khi kết khoá (sau buổi {d.tong || 48}): nhận xét tổng kết của giáo viên chủ nhiệm và kết quả hoàn thành khoá.
              </div>
            )}
          </section>

          {hb && hb.olderPublished.length > 0 ? (
            <section aria-labelledby="h-cu" className={cn(CARD, "flex flex-col gap-1.5 p-[22px]")}>
              <h2 id="h-cu" className={cn(H2, "mb-1.5")}>Học bạ các khoá trước</h2>
              {hb.olderPublished.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-2.5 border-t border-[var(--sr-tint-purple)] py-3">
                  <div className="flex flex-col gap-0.5">
                    <b className="text-[15px]">{[c.courseName, c.className].filter(Boolean).join(" · ") || "Học bạ"}</b>
                    <span className={MUTED}>
                      {c.publishedDate ? `Phát hành ${new Date(c.publishedDate).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}` : "Đã phát hành"}
                    </span>
                  </div>
                  <a href={`/api/portal/report-card/${c.id}`} className="flex h-10 items-center rounded-[10px] border border-border px-3.5 text-[13px] font-semibold hover:bg-[var(--sr-tint-purple)]">
                    Tải PDF
                  </a>
                </div>
              ))}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
