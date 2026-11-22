"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { datPinAction, luuThanhVienAction, xoaThanhVienAction } from "@/app/(portal)/portal/disc/_actions-so";
import { cn } from "@/lib/utils";
import { CAU_LY_DO_CHAN, boDeChoBai, tuoiTuNamSinh, type LyDoChanBai } from "@/lib/disc/so-gia-dinh/dinh-tuyen-bai";
import type { ManThanhVienVM, ThanhVienQuanLyVM } from "@/lib/disc/so-gia-dinh/man-hinh";
import { CHU_VAI, VAI_GIA_DINH, coHoiLop, type VaiGiaDinh } from "@/lib/disc/so-gia-dinh/vai";

import { DiscNav, H2, KHUNG, NUT_CAM, NUT_VIEN, OTron, TieuDeDisc } from "./chung";

/** Tab «Thành viên & quyền» — board Disc-gia-dinh.dc.html. Thêm/sửa/xoá thật; quan hệ chỉ-đọc (suy từ vai); quyền xem = ma trận doc 18 mục 8. */

const LOP_TUY_CHON: readonly { v: string; t: string }[] = [
  { v: "mam-non", t: "Mầm non" },
  ...Array.from({ length: 12 }, (_, i) => ({ v: String(i + 1), t: `Lớp ${i + 1}` })),
  { v: "tren-12", t: "Trên lớp 12" },
];

const CHIP: Record<ThanhVienQuanLyVM["trangThai"], string> = {
  xong: "bg-[var(--sr-success-bg)] text-[var(--sr-success)]",
  uoc: "border border-dashed border-[var(--sr-purple)] bg-card text-[var(--sr-purple-text)]",
  dang: "bg-[var(--sr-tint-orange)] text-[var(--sr-orange-text)]",
  chua: "bg-[var(--sr-soft-off)] text-[var(--sr-ink-muted)]",
};

type Form = { id?: string; ten: string; vaiTro: VaiGiaDinh; namSinh: string; lop: string; studentId: string };
const RONG: Form = { ten: "", vaiTro: "con", namSinh: "", lop: "", studentId: "" };

function Dong({ children }: { children: React.ReactNode }) {
  return <label className="flex flex-col gap-1.5 text-sm">{children}</label>;
}

export function ManThanhVien({ vm }: { vm: ManThanhVienVM }) {
  const router = useRouter();
  const [f, setF] = useState<Form>(RONG);
  const [loi, setLoi] = useState<string | null>(null);
  const [xoaId, setXoaId] = useState<string | null>(null);
  const [cheDo, setCheDo] = useState<"giu-bai" | "xoa-bai">("giu-bai");
  const [hieu, setHieu] = useState(false);
  const [dang, batDau] = useTransition();
  const [pin, setPin] = useState("");
  const [pinTb, setPinTb] = useState<string | null>(null);

  const dangSua = f.id !== undefined;
  const chuSo = vm.thanhVien.find((t) => t.laChuSo);
  const day = !dangSua && vm.thanhVien.length >= vm.toiDa;

  const suy = useMemo(() => {
    const ns = f.namSinh.trim() === "" ? null : Number(f.namSinh);
    const tuoi = tuoiTuNamSinh(Number.isFinite(ns as number) ? ns : null, vm.namNay);
    const lop = coHoiLop(f.vaiTro) && f.lop ? f.lop : null;
    const tuLam = boDeChoBai({ vaiTro: f.vaiTro, lop, tuoi }, "TU_LAM");
    const gocNhin = boDeChoBai({ vaiTro: f.vaiTro, lop, tuoi }, "GOC_NHIN");
    return { tuoi, tuLam, gocNhin };
  }, [f.namSinh, f.vaiTro, f.lop, vm.namNay]);

  const chonSua = (t: ThanhVienQuanLyVM) => {
    setLoi(null);
    setF({ id: t.id, ten: t.ten, vaiTro: t.vaiTro, namSinh: t.namSinh ? String(t.namSinh) : "", lop: t.lop ?? "", studentId: t.studentId ?? "" });
    document.getElementById("h-them")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const luu = () =>
    batDau(async () => {
      setLoi(null);
      const ns = f.namSinh.trim() === "" ? null : Number(f.namSinh);
      const r = await luuThanhVienAction({
        ...(f.id ? { id: f.id } : {}),
        ten: f.ten,
        vaiTro: f.vaiTro,
        namSinh: ns !== null && Number.isInteger(ns) ? ns : null,
        lop: coHoiLop(f.vaiTro) && f.lop ? f.lop : null,
        studentId: f.studentId || null,
      });
      if (!r.ok) setLoi(r.error);
      else {
        setF(RONG);
        router.refresh();
      }
    });

  const xoa = () =>
    batDau(async () => {
      if (!xoaId) return;
      const r = await xoaThanhVienAction({ id: xoaId, cheDo });
      if (!r.ok) setLoi(r.error);
      else {
        setXoaId(null);
        setHieu(false);
        router.refresh();
      }
    });

  const tenXoa = vm.thanhVien.find((t) => t.id === xoaId)?.ten ?? "";
  const loiBo = (l: LyDoChanBai) => CAU_LY_DO_CHAN[l];
  const nutKhoa = dang || f.ten.trim().length === 0 || (coHoiLop(f.vaiTro) && !f.lop && f.namSinh.trim() === "") || day;

  return (
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-[22px]">
      <DiscNav dang="thanh-vien" />
      <TieuDeDisc
        kicker={`${vm.tenGiaDinh} · quản trị: ${chuSo?.ten ?? "chủ sổ"}`}
        tieuDe="Thành viên & quyền xem"
        phu="Mỗi người làm bài theo đúng tuổi. Bạn là chủ sổ nên tự thêm, sửa, xoá thành viên — không cần mời hay xác thực người kia."
      />

      <section aria-labelledby="h-tv" className="flex flex-col gap-3">
        <h2 id="h-tv" className={H2}>Thành viên ({vm.thanhVien.length}/{vm.toiDa})</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-3">
          {vm.thanhVien.map((m) => (
            <div key={m.id} className={cn(KHUNG, "flex flex-col gap-3 p-4")}>
              <div className="flex items-center gap-3">
                <OTron chu={m.chu} chinh={m.chinh} uocLuong={m.trangThai === "uoc"} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <b className="break-words text-base">{m.ten}{m.laChuSo ? " (chủ sổ)" : ""}</b>
                  <span className="text-xs text-[var(--sr-ink-muted)]">{CHU_VAI[m.vaiTro]} · {m.phu}</span>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span><b>Tự làm:</b> {m.boTuLam ? `bộ ${m.boTuLam}` : (m.lyDoTuLam ? "không (xem ghi chú)" : "—")}</span>
                <span className="text-[var(--sr-ink-muted)]">·</span>
                <span><b>Góc nhìn:</b> {m.boGocNhin ? `bộ ${m.boGocNhin}` : "chưa hỗ trợ"}</span>
              </div>
              {m.lyDoTuLam ? <span className="rounded-lg bg-[var(--sr-soft-off)] px-3 py-2 text-xs">{loiBo(m.lyDoTuLam as LyDoChanBai)}</span> : null}
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded-full px-2.5 py-[3px] text-xs font-bold", CHIP[m.trangThai])}>{m.nhanTrangThai}</span>
                <span className="text-xs text-[var(--sr-ink-muted)]">{m.ghiTrangThai}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={`/portal/disc/lam-bai?nguoi=${encodeURIComponent(m.id)}`} className={cn(NUT_CAM, "h-10")}>Làm bài</Link>
                <button type="button" onClick={() => chonSua(m)} className={cn(NUT_VIEN, "h-10")}>Sửa</button>
                {!m.laChuSo ? <button type="button" onClick={() => { setXoaId(m.id); setCheDo("giu-bai"); setHieu(false); setLoi(null); }} className={cn(NUT_VIEN, "h-10 text-[var(--sr-bad-ink)]")}>Xoá</button> : null}
              </div>
            </div>
          ))}
        </div>

        {xoaId ? (
          <div role="group" aria-label="Xác nhận xoá thành viên" className="flex flex-col gap-3 rounded-2xl border-2 border-[var(--sr-bad)] bg-[var(--sr-bad-bg)] p-[18px]">
            <b className="text-base">Xoá {tenXoa} khỏi gia đình?</b>
            <span className="text-sm leading-[21px]">Báo cáo cả nhà sẽ tính lại. Thẻ cặp có {tenXoa} sẽ biến mất. Bạn chọn cách xử lý các lần làm bài của {tenXoa}:</span>
            <div role="radiogroup" aria-label="Xử lý các lần làm bài" className="flex flex-col gap-2">
              {([["giu-bai", "Giữ các lần làm bài", "Chuyển sang mục «chưa xếp»; không còn tính vào thẻ cặp hay báo cáo."], ["xoa-bai", "Xoá luôn các lần làm bài", "Xoá vĩnh viễn điểm và các bản phân tích có dùng điểm này."]] as const).map(([k, t, g]) => (
                <label key={k} className={cn("flex cursor-pointer items-start gap-2.5 rounded-xl border bg-card p-3 text-sm", cheDo === k ? "border-[var(--sr-purple)]" : "border-border")}>
                  <input type="radio" name="che-do-xoa" checked={cheDo === k} onChange={() => setCheDo(k)} className="mt-1" />
                  <span className="flex flex-col"><b>{t}</b><span className="text-xs text-[var(--sr-ink-muted)]">{g}</span></span>
                </label>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hieu} onChange={(e) => setHieu(e.target.checked)} />Tôi hiểu, không hoàn tác được</label>
            {loi ? <span role="alert" className="text-sm text-[var(--sr-bad-ink)]">{loi}</span> : null}
            <div className="flex gap-2">
              <button type="button" disabled={!hieu || dang} onClick={xoa} className="min-h-10 rounded-[10px] bg-[var(--sr-bad)] px-3.5 text-[13px] font-bold text-white disabled:opacity-50">{dang ? "Đang xoá…" : "Xoá thành viên"}</button>
              <button type="button" onClick={() => setXoaId(null)} className={cn(NUT_VIEN, "h-10")}>Huỷ</button>
            </div>
          </div>
        ) : null}
      </section>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))] gap-5">
        <section aria-labelledby="h-them" className={cn(KHUNG, "flex flex-col gap-3.5 rounded-[20px] p-[22px]")}>
          <h2 id="h-them" className={H2}>{dangSua ? `Sửa thông tin ${f.ten || "thành viên"}` : "Thêm thành viên"}</h2>
          {day ? <span role="status" className="rounded-xl bg-[var(--sr-soft-off)] px-3.5 py-2.5 text-sm">Sổ gia đình có tối đa {vm.toiDa} thành viên.</span> : null}
          <Dong>
            <span className="font-semibold">Tên gọi trong nhà</span>
            <input type="text" value={f.ten} maxLength={30} onChange={(e) => setF({ ...f, ten: e.target.value })} placeholder="Ví dụ: Ông ngoại, Bà nội, Cô Hằng, Su…" className="h-11 rounded-xl border border-border bg-background px-3 text-foreground" />
          </Dong>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="font-semibold">Quan hệ với bạn (chủ sổ)</span>
            <div role="radiogroup" aria-label="Quan hệ" className="flex flex-wrap gap-2">
              {VAI_GIA_DINH.map((v) => (
                <button key={v} type="button" role="radio" aria-checked={f.vaiTro === v} disabled={chuSo?.id === f.id && coHoiLop(v)} onClick={() => setF({ ...f, vaiTro: v, lop: coHoiLop(v) ? f.lop : "" })} className={cn("min-h-10 rounded-full border px-3.5 text-[13px] font-semibold disabled:opacity-40", f.vaiTro === v ? "border-transparent bg-[var(--sr-purple)] text-white" : "border-border bg-card")}>
                  {CHU_VAI[v]}
                </button>
              ))}
            </div>
          </div>
          <Dong>
            <span className="font-semibold">Năm sinh {coHoiLop(f.vaiTro) ? "" : "(tuỳ chọn)"}</span>
            <span className="flex flex-wrap items-center gap-2">
              <button type="button" aria-label="Giảm 1 năm" onClick={() => setF({ ...f, namSinh: String((Number(f.namSinh) || vm.namNay - 10) - 1) })} className="size-11 rounded-xl border border-border bg-card text-lg">−</button>
              <input type="number" inputMode="numeric" min={1920} max={vm.namNay} value={f.namSinh} onChange={(e) => setF({ ...f, namSinh: e.target.value })} className="h-11 w-28 rounded-xl border border-border bg-background px-3 text-center text-foreground" />
              <button type="button" aria-label="Tăng 1 năm" onClick={() => setF({ ...f, namSinh: String(Math.min(vm.namNay, (Number(f.namSinh) || vm.namNay - 12) + 1)) })} className="size-11 rounded-xl border border-border bg-card text-lg">+</button>
              {suy.tuoi !== null ? <span className="text-xs text-[var(--sr-ink-muted)]">{suy.tuoi} tuổi</span> : null}
            </span>
          </Dong>
          {coHoiLop(f.vaiTro) ? (
            <Dong>
              <span className="font-semibold">Lớp đang học</span>
              <select value={f.lop} onChange={(e) => setF({ ...f, lop: e.target.value })} className="h-11 rounded-xl border border-border bg-background px-3 text-foreground">
                <option value="">— Chọn lớp (hoặc để hệ thống suy từ năm sinh) —</option>
                {LOP_TUY_CHON.map((l) => (
                  <option key={l.v} value={l.v}>{l.t}</option>
                ))}
              </select>
            </Dong>
          ) : null}
          {vm.hocVienChuaNoi.length > 0 && coHoiLop(f.vaiTro) ? (
            <Dong>
              <span className="font-semibold">Nối với học viên của Sata Robo (tuỳ chọn)</span>
              <select value={f.studentId} onChange={(e) => setF({ ...f, studentId: e.target.value })} className="h-11 rounded-xl border border-border bg-background px-3 text-foreground">
                <option value="">— Không nối —</option>
                {vm.hocVienChuaNoi.map((h) => (
                  <option key={h.id} value={h.id}>{h.ten}</option>
                ))}
              </select>
            </Dong>
          ) : null}
          <div className="flex flex-col gap-1.5 rounded-[14px] bg-[var(--sr-soft-off)] p-3.5 text-[13px] leading-5">
            <span className="text-xs font-bold tracking-[0.06em] text-[var(--sr-ink-muted)]">HỆ THỐNG TỰ SUY RA{suy.tuoi !== null ? ` · ${suy.tuoi} TUỔI` : ""}</span>
            <span><b>Tự làm:</b> {suy.tuLam.duoc ? `bộ ${suy.tuLam.boDe}` : loiBo(suy.tuLam.lyDo)}</span>
            <span><b>Theo góc nhìn của bạn:</b> {suy.gocNhin.duoc ? `bộ ${suy.gocNhin.boDe}` : loiBo(suy.gocNhin.lyDo)}</span>
          </div>
          {loi && !xoaId ? <span role="alert" className="text-sm text-[var(--sr-bad-ink)]">{loi}</span> : null}
          <div className="flex gap-2">
            <button type="button" disabled={nutKhoa} onClick={luu} className={cn(NUT_CAM, "h-11 rounded-xl px-4 text-sm disabled:opacity-50")}>{dang ? "Đang lưu…" : dangSua ? "Lưu thay đổi" : "Thêm thành viên"}</button>
            {dangSua ? <button type="button" onClick={() => { setF(RONG); setLoi(null); }} className={cn(NUT_VIEN, "h-11 rounded-xl px-4 text-sm")}>Huỷ sửa</button> : null}
          </div>
        </section>

        <section aria-labelledby="h-qh" className={cn(KHUNG, "flex flex-col gap-3 rounded-[20px] p-[22px]")}>
          <h2 id="h-qh" className={H2}>Quan hệ giữa các cặp</h2>
          {vm.quanHe.length === 0 ? <span className="text-sm text-[var(--sr-ink-muted)]">Thêm ít nhất 2 thành viên để thấy các cặp.</span> : vm.quanHe.map((r) => (
            <div key={r.cap} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border pb-2 last:border-b-0">
              <b className="min-w-0 flex-[1_1_160px] text-sm">{r.cap}</b>
              <span className="text-sm">{r.loai}</span>
              <span className="rounded-full bg-[var(--sr-tint-purple)] px-2.5 py-[3px] text-xs font-bold text-[var(--sr-purple-text)]">{r.tag}</span>
            </div>
          ))}
          <span className="text-xs text-[var(--sr-ink-muted)]">Quan hệ do hệ thống suy ra từ vai trò (đổi vai ở phần Sửa thì quan hệ và báo cáo tự tính lại).</span>
        </section>
      </div>

      <section aria-labelledby="h-xem" className={cn(KHUNG, "flex flex-col gap-2.5 rounded-[20px] p-[22px]")}>
        <h2 id="h-xem" className={H2}>Ai được xem sổ này</h2>
        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm leading-[21px]">
          <li><b>Chỉ bạn (chủ sổ)</b> đọc được toàn bộ: thành viên, điểm, báo cáo, thẻ cặp, kế hoạch.</li>
          <li><b>Chế độ trẻ em:</b> khi bé làm bài trên máy này, màn bị khoá cho tới khi nhập mã PIN của bạn; bé chỉ thấy bài của chính bé.</li>
          <li><b>Giáo viên, nhân viên trung tâm, phụ huynh khác:</b> không có đường xem nội dung DISC của gia đình bạn. Quản trị hệ thống chỉ xem thống kê ẩn danh.</li>
        </ul>
        <span className="text-xs text-[var(--sr-ink-muted)]">Không dùng dữ liệu DISC cho quảng cáo hay tuyển sinh.</span>
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <b className="text-sm">Mã PIN thoát chế độ trẻ em {vm.coPin ? "(đã đặt)" : "(chưa đặt)"}</b>
          <div className="flex flex-wrap items-center gap-2">
            <input aria-label="Mã PIN 4 số" inputMode="numeric" pattern="\d{4}" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="••••" className="h-11 w-28 rounded-xl border border-border bg-background px-3 text-center tracking-[0.3em] text-foreground" />
            <button type="button" disabled={pin.length !== 4 || dang} onClick={() => batDau(async () => { const r = await datPinAction({ pin }); setPinTb(r.ok ? "Đã lưu mã PIN." : r.error); if (r.ok) { setPin(""); router.refresh(); } })} className={cn(NUT_VIEN, "h-11 rounded-xl px-4 text-sm disabled:opacity-50")}>{vm.coPin ? "Đổi mã PIN" : "Đặt mã PIN"}</button>
            {pinTb ? <span role="status" className="text-xs text-[var(--sr-ink-muted)]">{pinTb}</span> : null}
          </div>
          <span className="text-xs text-[var(--sr-ink-muted)]">Mã PIN chỉ để bé không tự thoát màn làm bài — không thay cho mật khẩu đăng nhập của bạn.</span>
        </div>
        {vm.soBaiChuaXep > 0 ? <span className="text-xs text-[var(--sr-ink-muted)]">Có {vm.soBaiChuaXep} lần làm bài ở mục «chưa xếp» (của thành viên đã xoá, bạn chọn giữ). Chúng không tính vào báo cáo.</span> : null}
      </section>
    </div>
  );
}
