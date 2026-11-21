"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { datPinAction, luuNhapAction, nopBaiAction, phatDeAction, xacNhanPinAction } from "@/app/(portal)/portal/disc/_actions-so";
import { cn } from "@/lib/utils";
import { CAU_LY_DO_CHAN, laCheDoTreEm, type LyDoChanBai } from "@/lib/disc/so-gia-dinh/dinh-tuyen-bai";
import type { KetQuaNopBaiSo } from "@/lib/disc/so-gia-dinh/ghi";
import type { CachLam, MaBoDe } from "@/lib/disc/so-gia-dinh/kieu";
import type { LanLamVM } from "@/lib/disc/so-gia-dinh/man-hinh";

import { H2, KHUNG, MAU_TRUC, NUT_CAM, NUT_VIEN, OTron } from "./chung";

/**
 * Màn «Làm bài» — board Disc-lam-bai.dc.html (bước chọn người + cách làm → làm bài → kết quả).
 * Bộ câu hỏi của engine dùng thang tần suất / đồng ý theo từng câu (không phải «nhất – ít nhất»), nên màn làm bài vẽ theo `thang` server gửi.
 * Câu hỏi chỉ có {viTri, nội dung}: client không thấy trục / chiều đảo. Bản nháp lưu ở server (vé mã hoá + câu đã trả lời).
 */

export type NguoiLamBaiVM = {
  readonly id: string;
  readonly ten: string;
  readonly chu: string;
  readonly phu: string;
  readonly nhanTrangThai: string;
  readonly chinh: "D" | "I" | "S" | "C" | null;
  readonly tuLam: { readonly duoc: boolean; readonly boDe?: MaBoDe; readonly lyDo?: LyDoChanBai };
  readonly gocNhin: { readonly duoc: boolean; readonly boDe?: MaBoDe; readonly lyDo?: LyDoChanBai };
  readonly coNhap: { readonly TU_LAM: boolean; readonly GOC_NHIN: boolean };
  readonly lichSu: readonly LanLamVM[];
};

type De = {
  boDe: string;
  cauDan: string;
  cauMoiMan: number;
  thang: readonly { gia: number; nhan: string; mat?: string }[];
  cau: readonly { viTri: number; noiDung: string }[];
  ve: string;
  traLoi: Readonly<Record<string, number>>;
  tiepTuc: boolean;
};

type Buoc = "chon" | "dat-pin" | "lam" | "tre-xong" | "xong";

/** Chế độ trẻ em: phủ kín màn hình (che luôn menu / thanh tab của cổng) — rời ra chỉ bằng nút «Thoát» + PIN. Tải lại trang thì thoát được (hàng rào trải nghiệm, không phải bảo mật). */
const KHOA_MAN_HINH = "fixed inset-0 z-[60] overflow-y-auto bg-background p-4 sm:p-8";

const gioHienTai = () => new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

export function ManLamBai({ nguoi, chonId, chonCach, coPin: coPinBanDau, tenChuSo }: { nguoi: readonly NguoiLamBaiVM[]; chonId: string | null; chonCach: CachLam | null; coPin: boolean; tenChuSo: string }) {
  const router = useRouter();
  const [buoc, setBuoc] = useState<Buoc>("chon");
  const [id, setId] = useState<string | null>(chonId ?? nguoi[0]?.id ?? null);
  const [cach, setCach] = useState<CachLam | null>(chonCach);
  const [de, setDe] = useState<De | null>(null);
  const [traLoi, setTraLoi] = useState<Record<string, number>>({});
  const [trang, setTrang] = useState(0);
  const [loi, setLoi] = useState<string | null>(null);
  const [daLuuLuc, setDaLuuLuc] = useState<string | null>(null);
  const [ketQua, setKetQua] = useState<KetQuaNopBaiSo | null>(null);
  const [coPin, setCoPin] = useState(coPinBanDau);
  const [pinMoi, setPinMoi] = useState("");
  const [pinThoat, setPinThoat] = useState("");
  const [hoiThoat, setHoiThoat] = useState(false);
  const [dang, batDau] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nguoiChon = nguoi.find((n) => n.id === id) ?? null;
  const cachKha = (n: NguoiLamBaiVM, c: CachLam) => (c === "TU_LAM" ? n.tuLam : n.gocNhin);
  const cachHopLe = nguoiChon && cach && cachKha(nguoiChon, cach).duoc ? cach : null;
  const boChon = nguoiChon && cachHopLe ? cachKha(nguoiChon, cachHopLe).boDe : undefined;
  const cheDoTreEm = !!boChon && !!cachHopLe && laCheDoTreEm(boChon, cachHopLe);

  // Rời trang khi đang làm dở: nhắc (bản nháp đã lưu server, nhưng câu vừa bấm có thể chưa kịp).
  useEffect(() => {
    if (buoc !== "lam") return;
    const f = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, [buoc]);

  const luuNhap = useCallback(
    (veDe: string, tl: Record<string, number>, ngay = false) => {
      if (!id || !cachHopLe) return;
      if (timer.current) clearTimeout(timer.current);
      const chay = async () => {
        const r = await luuNhapAction({ thanhVienId: id, cachLam: cachHopLe, ve: veDe, traLoi: tl });
        if (r.ok) setDaLuuLuc(gioHienTai());
      };
      if (ngay) void chay();
      else timer.current = setTimeout(() => void chay(), 700);
    },
    [id, cachHopLe],
  );

  const bamDau = () => {
    if (!id || !cachHopLe) return;
    if (cheDoTreEm && !coPin) {
      setBuoc("dat-pin");
      return;
    }
    batDau(async () => {
      setLoi(null);
      const r = await phatDeAction({ thanhVienId: id, cachLam: cachHopLe });
      if (!r.ok) {
        setLoi(r.error);
        return;
      }
      setDe(r.de);
      setTraLoi({ ...r.de.traLoi });
      const daCo = Object.keys(r.de.traLoi).length;
      setTrang(Math.min(Math.floor(daCo / r.de.cauMoiMan), Math.ceil(r.de.cau.length / r.de.cauMoiMan) - 1));
      setBuoc("lam");
    });
  };

  const dat = (viTri: number, gia: number) => {
    if (!de) return;
    const moi = { ...traLoi, [String(viTri)]: gia };
    setTraLoi(moi);
    luuNhap(de.ve, moi);
  };

  const soTrang = de ? Math.ceil(de.cau.length / de.cauMoiMan) : 0;
  const cauTrang = de ? de.cau.slice(trang * de.cauMoiMan, (trang + 1) * de.cauMoiMan) : [];
  const trangDu = cauTrang.length > 0 && cauTrang.every((c) => traLoi[String(c.viTri)] !== undefined);
  const daLam = Object.keys(traLoi).length;

  const nop = () =>
    batDau(async () => {
      if (!de || !id || !cachHopLe) return;
      setLoi(null);
      const r = await nopBaiAction({ thanhVienId: id, cachLam: cachHopLe, ve: de.ve, traLoi });
      if (!r.ok) {
        setLoi(r.error);
        return;
      }
      setKetQua(r);
      setBuoc(cheDoTreEm ? "tre-xong" : "xong");
      router.refresh();
    });

  const thoatCheDoTre = () =>
    batDau(async () => {
      setLoi(null);
      const r = await xacNhanPinAction({ pin: pinThoat });
      if (!r.ok) {
        setLoi(r.error);
        return;
      }
      setPinThoat("");
      setHoiThoat(false);
      if (buoc === "tre-xong") setBuoc("xong");
      else router.push("/portal/disc");
    });

  const dongPin = (
    <div role="group" aria-label="Thoát chế độ trẻ em" className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-4">
      <b className="text-sm">Nhập mã PIN của chủ sổ</b>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Mã PIN" inputMode="numeric" maxLength={4} value={pinThoat} onChange={(e) => setPinThoat(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="••••" className="h-11 w-28 rounded-xl border border-border bg-background px-3 text-center tracking-[0.3em] text-foreground" />
        <button type="button" disabled={pinThoat.length !== 4 || dang} onClick={thoatCheDoTre} className={cn(NUT_CAM, "h-11 rounded-xl px-4 text-sm disabled:opacity-50")}>Mở khoá</button>
        {buoc === "lam" ? <button type="button" onClick={() => setHoiThoat(false)} className={cn(NUT_VIEN, "h-11 rounded-xl px-4 text-sm")}>Ở lại làm bài</button> : null}
      </div>
      {loi ? <span role="alert" className="text-sm text-[var(--sr-bad-ink)]">{loi}</span> : null}
    </div>
  );

  /* ── Bước: đặt PIN (chế độ trẻ em lần đầu) ── */
  if (buoc === "dat-pin" && nguoiChon) {
    return (
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4">
        <section className={cn(KHUNG, "flex flex-col gap-3 p-6")}>
          <h2 className={H2}>Đặt mã PIN trước khi đưa máy cho {nguoiChon.ten}</h2>
          <p className="m-0 text-sm leading-[22px] text-[var(--sr-ink-muted)]">Khi {nguoiChon.ten} làm bài, màn hình bị khoá ở chế độ trẻ em: bé không thấy báo cáo của người khác và không tự thoát ra được. Bạn nhập mã PIN này để mở khoá. Chỉ cần đặt một lần.</p>
          <input aria-label="Mã PIN 4 số" inputMode="numeric" maxLength={4} value={pinMoi} onChange={(e) => setPinMoi(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="••••" className="h-12 w-32 rounded-xl border border-border bg-background px-3 text-center text-lg tracking-[0.3em] text-foreground" />
          {loi ? <span role="alert" className="text-sm text-[var(--sr-bad-ink)]">{loi}</span> : null}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pinMoi.length !== 4 || dang}
              onClick={() =>
                batDau(async () => {
                  const r = await datPinAction({ pin: pinMoi });
                  if (!r.ok) setLoi(r.error);
                  else {
                    setCoPin(true);
                    setPinMoi("");
                    setBuoc("chon");
                    setLoi(null);
                  }
                })
              }
              className={cn(NUT_CAM, "h-11 rounded-xl px-4 text-sm disabled:opacity-50")}
            >
              Lưu mã PIN
            </button>
            <button type="button" onClick={() => setBuoc("chon")} className={cn(NUT_VIEN, "h-11 rounded-xl px-4 text-sm")}>Quay lại</button>
          </div>
        </section>
      </div>
    );
  }

  /* ── Bước: làm bài ── */
  if (buoc === "lam" && de && nguoiChon) {
    const tenTrang = cachHopLe === "GOC_NHIN" ? `${tenChuSo} trả lời về ${nguoiChon.ten}` : `${nguoiChon.ten} tự làm`;
    const tiLe = Math.round((daLam / de.cau.length) * 100);
    return (
      <div className={cn(cheDoTreEm ? KHOA_MAN_HINH : "contents")}>
      <div className={cn("mx-auto flex w-full flex-col gap-4", cheDoTreEm ? "max-w-[860px]" : "max-w-[1160px]")}>
        {cheDoTreEm ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] bg-[var(--sr-purple)] px-4 py-3 text-white">
            <span className="text-xs font-bold tracking-[0.06em]">CHẾ ĐỘ TRẺ EM · ĐƯA MÁY CHO {nguoiChon.ten.toUpperCase()} · BỐ MẸ KHÔNG CHỌN THAY CON</span>
            <button type="button" onClick={() => setHoiThoat(true)} className="min-h-9 rounded-lg bg-white/20 px-3 text-xs font-semibold">Thoát (cần PIN)</button>
          </div>
        ) : null}
        {hoiThoat ? dongPin : null}
        <article className={cn(KHUNG, "flex flex-col gap-4 rounded-[22px] p-6")}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-bold text-[var(--sr-purple-text)]">{tenTrang} · bộ {de.boDe}</span>
            <span className="text-[var(--sr-ink-muted)]">
              Câu {trang * de.cauMoiMan + 1}–{trang * de.cauMoiMan + cauTrang.length} / {de.cau.length}
              {daLuuLuc ? ` · ✓ Đã lưu nháp lúc ${daLuuLuc}` : ""}
            </span>
          </div>
          <div aria-hidden className="h-2 overflow-hidden rounded-full bg-[var(--sr-bar-off)]"><div className="h-full rounded-full bg-[var(--sr-orange)]" style={{ width: `${tiLe}%` }} /></div>
          <p className="m-0 text-base font-semibold leading-6">{de.cauDan}</p>
          <div className="flex flex-col gap-5">
            {cauTrang.map((c) => (
              <fieldset key={c.viTri} className="m-0 flex flex-col gap-2.5 border-0 p-0">
                <legend className="mb-2 text-[17px] font-semibold leading-6">{c.noiDung}</legend>
                <div role="radiogroup" aria-label={c.noiDung} className="grid grid-cols-[repeat(auto-fit,minmax(min(120px,100%),1fr))] gap-2">
                  {de.thang.map((m) => {
                    const chon = traLoi[String(c.viTri)] === m.gia;
                    return (
                      <button
                        key={m.gia}
                        type="button"
                        role="radio"
                        aria-checked={chon}
                        onClick={() => dat(c.viTri, m.gia)}
                        className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl border-2 px-2 py-2 text-center text-[13px] font-semibold", chon ? "border-[var(--sr-purple)] bg-[var(--sr-tint-purple)] text-[var(--sr-purple-text)]" : "border-border bg-card hover:bg-[var(--sr-soft-off)]")}
                      >
                        {m.mat ? <span aria-hidden className="text-2xl">{m.mat}</span> : null}
                        <span>{m.nhan}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
          {loi ? <span role="alert" className="text-sm text-[var(--sr-bad-ink)]">{loi}</span> : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button type="button" disabled={trang === 0} onClick={() => { setTrang(trang - 1); window.scrollTo({ top: 0 }); }} className={cn(NUT_VIEN, "h-11 rounded-xl px-4 text-sm disabled:opacity-40")}>Câu trước</button>
            <span className="text-xs text-[var(--sr-ink-muted)]">{trangDu ? "Đã trả lời hết các câu trên màn này." : "Trả lời hết các câu trên màn này để đi tiếp."}</span>
            {trang + 1 < soTrang ? (
              <button type="button" disabled={!trangDu} onClick={() => { luuNhap(de.ve, traLoi, true); setTrang(trang + 1); window.scrollTo({ top: 0 }); }} className={cn(NUT_CAM, "h-11 rounded-xl px-5 text-sm disabled:opacity-50")}>Câu tiếp</button>
            ) : (
              <button type="button" disabled={!trangDu || daLam < de.cau.length || dang} onClick={nop} className={cn(NUT_CAM, "h-11 rounded-xl px-5 text-sm disabled:opacity-50")}>{dang ? "Đang chấm…" : "Nộp bài"}</button>
            )}
          </div>
        </article>
        {!cheDoTreEm ? (
          <button type="button" onClick={() => { luuNhap(de.ve, traLoi, true); router.push("/portal/disc"); }} className="self-start text-sm font-semibold text-[var(--sr-purple-text)] underline">Lưu nháp và làm tiếp sau</button>
        ) : null}
      </div>
      </div>
    );
  }

  /* ── Bước: bé làm xong (chế độ trẻ em) ── */
  if (buoc === "tre-xong" && ketQua) {
    return (
      <div className={KHOA_MAN_HINH}>
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4">
        <section className="flex flex-col items-center gap-3 rounded-[22px] bg-[linear-gradient(120deg,var(--sr-purple)_0%,var(--sr-purple-mid)_55%,var(--sr-orange)_140%)] p-8 text-center text-white">
          <span aria-hidden className="text-5xl">🤖</span>
          <h2 className="m-0 font-display text-[26px] font-extrabold">Cảm ơn {ketQua.ten}!</h2>
          <p className="m-0 text-base leading-6">Con đã làm xong rồi. Giờ đưa máy lại cho bố mẹ nhé.</p>
        </section>
        {dongPin}
      </div>
      </div>
    );
  }

  /* ── Bước: kết quả ── */
  if (buoc === "xong" && ketQua) {
    const so = (["D", "I", "S", "C"] as const).map((k) => ({ k, a: ketQua.truoc?.[k] ?? null, b: ketQua.diem[k] }));
    return (
      <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4">
        <article className={cn(KHUNG, "flex flex-col gap-3.5 rounded-[22px] p-6")}>
          <h2 className="m-0 font-display text-2xl font-extrabold">Đã lưu kết quả của {ketQua.ten}</h2>
          <p className="m-0 text-sm leading-[22px]">
            {ketQua.cachLam === "TU_LAM" ? `${ketQua.ten} tự làm bài` : `Bạn trả lời về ${ketQua.ten}`} · nhãn <b>{ketQua.nhan}</b> · bộ {ketQua.boDe}. Kế hoạch đang chạy không đổi giữa chừng; bạn chọn có cập nhật theo kết quả mới hay không.
          </p>
          <div className="flex flex-col gap-2">
            <b className="text-sm">{ketQua.truoc ? "So với lần trước (cùng bộ câu hỏi)" : "Điểm lần này"}</b>
            {so.map((r) => (
              <div key={r.k} className="grid grid-cols-[28px_1fr_auto] items-center gap-2.5 text-sm">
                <b>{r.k}</b>
                <div className="relative h-3 rounded-full bg-[var(--sr-bar-off)]">
                  {r.a !== null ? <div className={cn("absolute inset-y-0 left-0 rounded-full opacity-40", MAU_TRUC[r.k].dac)} style={{ width: `${r.a}%` }} /> : null}
                  <div className={cn("absolute inset-y-1 left-0 rounded-full", MAU_TRUC[r.k].dac)} style={{ width: `${r.b}%` }} />
                </div>
                <span>{r.a !== null ? `${Math.round(r.a)} → ` : ""}<b>{Math.round(r.b)}</b></span>
              </div>
            ))}
            {ketQua.truoc ? <span className="text-xs text-[var(--sr-ink-muted)]">Vạch mờ: lần trước · vạch đậm: lần mới</span> : null}
          </div>
          <div className="flex flex-wrap gap-2.5">
            <Link href={`/portal/disc?muc=ca-nhan&nguoi=${encodeURIComponent(ketQua.thanhVienId)}`} className={cn(NUT_CAM, "h-11")}>Xem báo cáo cá nhân</Link>
            {ketQua.daCoPhanTich ? <Link href="/portal/disc?muc=the-cap" className={cn(NUT_VIEN, "h-11")}>Xem thẻ cặp mới</Link> : null}
            <button type="button" onClick={() => { setBuoc("chon"); setDe(null); setTraLoi({}); setKetQua(null); setCach(null); }} className={cn(NUT_VIEN, "h-11")}>Làm cho người khác</button>
            <Link href="/portal/disc" className={cn(NUT_VIEN, "h-11")}>Về báo cáo gia đình</Link>
          </div>
        </article>
      </div>
    );
  }

  /* ── Bước: chọn ── */
  const tomTat = nguoiChon && cachHopLe && boChon ? `${nguoiChon.ten} · ${cachHopLe === "TU_LAM" ? "tự làm" : "theo góc nhìn của bạn"} · bộ ${boChon}` : "Chọn người và cách làm";
  const coNhap = !!nguoiChon && !!cachHopLe && nguoiChon.coNhap[cachHopLe];
  return (
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-[22px]">
      <section aria-labelledby="h-ai" className="flex flex-col gap-3">
        <h2 id="h-ai" className={H2}>1. Làm cho ai?</h2>
        <div role="radiogroup" aria-labelledby="h-ai" className="grid grid-cols-[repeat(auto-fit,minmax(min(250px,100%),1fr))] gap-3">
          {nguoi.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={m.id === id} onClick={() => { setId(m.id); if (cach && !cachKha(m, cach).duoc) setCach(null); }} className={cn("flex items-center gap-3 rounded-2xl border-2 bg-card p-3.5 text-left", m.id === id ? "border-[var(--sr-purple)]" : "border-border")}>
              <OTron chu={m.chu} chinh={m.chinh} />
              <span className="flex min-w-0 flex-col"><b className="break-words text-base">{m.ten}</b><span className="text-xs text-[var(--sr-ink-muted)]">{m.phu}</span><span className="text-xs font-semibold text-[var(--sr-purple-text)]">{m.nhanTrangThai}</span></span>
            </button>
          ))}
        </div>
      </section>

      {nguoiChon ? (
        <section aria-labelledby="h-cach" className="flex flex-col gap-3">
          <h2 id="h-cach" className={H2}>2. Ai trả lời?</h2>
          <div role="radiogroup" aria-labelledby="h-cach" className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-3">
            {([["TU_LAM", `${nguoiChon.ten} tự làm`, "Hồ sơ chính thức"], ["GOC_NHIN", "Theo góc nhìn của bạn", "Ước lượng"]] as const).map(([c, ten, chip]) => {
              const k = cachKha(nguoiChon, c);
              const chonRoi = cach === c;
              return (
                <button key={c} type="button" role="radio" aria-checked={chonRoi} aria-disabled={!k.duoc} onClick={() => k.duoc && setCach(c)} className={cn("flex flex-col gap-1.5 rounded-2xl border-2 p-4 text-left", chonRoi ? "border-[var(--sr-purple)] bg-card" : "border-border bg-card", !k.duoc && "cursor-not-allowed opacity-60")}>
                  <span className="flex items-center justify-between gap-2"><b className="text-base">{ten}</b><span className="rounded-full bg-[var(--sr-tint-purple)] px-2.5 py-[3px] text-xs font-bold text-[var(--sr-purple-text)]">{chip}</span></span>
                  <span className="text-sm leading-5 text-[var(--sr-ink-muted)]">
                    {c === "TU_LAM" ? (k.duoc && laCheDoTreEm(k.boDe!, "TU_LAM") ? "Bé cầm máy làm bài ở chế độ trẻ em; bố mẹ không chọn thay con." : "Chính người đó trả lời các câu hỏi.") : "Bạn trả lời theo những gì bạn quan sát được. Hồ sơ được gắn nhãn «ước lượng»."}
                  </span>
                  <span className="text-xs font-semibold">{k.duoc ? `Bộ ${k.boDe}` : CAU_LY_DO_CHAN[k.lyDo!]}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {nguoiChon ? (
        <section aria-labelledby="h-ls" className={cn(KHUNG, "flex flex-col gap-3 rounded-[20px] p-[22px]")}>
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="h-ls" className={H2}>Các lần làm của {nguoiChon.ten}</h2><span className="text-xs text-[var(--sr-ink-muted)]">Mỗi lần làm được lưu riêng, không ghi đè</span></div>
          {nguoiChon.lichSu.length === 0 ? <span className="text-sm text-[var(--sr-ink-muted)]">Chưa có lần làm nào.</span> : nguoiChon.lichSu.map((x) => (
            <div key={x.id} className={cn("flex flex-wrap items-center gap-x-3.5 gap-y-1 rounded-[14px] border p-3", x.dangDung ? "border-[var(--sr-success)] bg-[var(--sr-success-bg)]" : "border-border")}>
              <span className="flex min-w-0 flex-[1_1_200px] flex-col"><b className="text-sm">{x.lan} · {x.ngay}</b><span className="text-xs text-[var(--sr-ink-muted)]">{x.kieu}</span></span>
              <span className="flex min-w-0 flex-[2_1_240px] flex-col"><span className="text-[13px]">{x.diem}</span><span className="text-xs text-[var(--sr-ink-muted)]">{x.nhan} · {x.chenh}</span></span>
              <span className="flex-none rounded-full bg-[var(--sr-soft-off)] px-2.5 py-[3px] text-[11px] font-bold text-[var(--sr-ink-muted)]">{x.ghiDangDung}</span>
            </div>
          ))}
          <span className="text-xs text-[var(--sr-ink-muted)]">Thẻ cặp và báo cáo gia đình luôn dùng <b>lần tự làm mới nhất</b>. Chưa tự làm thì dùng lần ước lượng mới nhất.</span>
        </section>
      ) : null}

      <div className="sticky bottom-24 z-10 flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-border bg-card px-5 py-3.5 shadow-[0_6px_20px_var(--sr-shadow)] min-[900px]:bottom-4">
        <span className="flex min-w-0 flex-col"><b className="text-sm">{tomTat}</b><span className="text-xs text-[var(--sr-ink-muted)]">{coNhap ? "Còn bản nháp — sẽ làm tiếp từ chỗ đang dở." : "Mất khoảng 10–15 phút. Có lưu nháp, làm tiếp được."}</span></span>
        {loi ? <span role="alert" className="w-full text-sm text-[var(--sr-bad-ink)]">{loi}</span> : null}
        <button type="button" disabled={!cachHopLe || dang} onClick={bamDau} className={cn(NUT_CAM, "h-11 rounded-xl px-5 text-sm disabled:opacity-50")}>{dang ? "Đang mở bài…" : coNhap ? "Làm tiếp bài đang dở" : "Bắt đầu làm bài"}</button>
      </div>
    </div>
  );
}
