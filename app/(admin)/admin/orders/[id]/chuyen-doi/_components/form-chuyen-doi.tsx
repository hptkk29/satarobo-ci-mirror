"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Check, Hourglass, ShieldCheck, UserPlus } from "lucide-react";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { NUT_CHINH, NUT_VIEN, O_NHAP, O_VAN_BAN, Truong } from "@/app/(admin)/admin/students/_components/ho-so/o-nhap";
import type { DongChuyenDoi, LopUngVien, PhuHuynhChuyenDoi } from "@/lib/orders/chuyen-doi-don";
import {
  canKhaiHocVuot,
  kiemBuoiBatDau,
  kiemSoBuoiBu,
  tuDuyetHocVuot,
  vaiChonDuoc,
  vaiThayLop,
  xetTheoBuoiBatDau,
  type VaiXepLop,
  type XetTheoBuoiBatDau,
} from "@/lib/lms/xep-lop-theo-buoi-bat-dau";
import { GIOI_TINH_OPTIONS } from "@/lib/students/gioi-tinh";
import { chuyenDoiDonAction, doiBuoiBatDauAction } from "../_actions";

/**
 * Form CHUYỂN ĐỔI — một khối phụ huynh, rồi mỗi con một khối: thông tin bé · buổi bắt đầu · lớp · học vượt · đồng ý hình ảnh.
 *
 * ── HÌNH THỨC (DESIGN.md · mode Operate) ─────────────────────────────────────────────────────────────────────
 * Người dùng tới để làm xong một việc nên không có gì để "thuyết phục": mỗi con một `<section>` viền mỏng, ô nhập cùng từ vựng với màn Hồ sơ học viên
 * (`O_NHAP`, `Truong`) để một ô không trông khác nhau ở hai nơi. KHÔNG thẻ lồng thẻ, KHÔNG viền màu một cạnh.
 *
 * ── LỚP [27/10/2026] ──────────────────────────────────────────────────────────────────────────────────────
 * Ô CHỌN LỚP là hộp chọn CÓ TÌM KIẾM (gõ tên / mã lớp / cơ sở): vài trăm lớp thì cuộn dropdown là việc của người không có thời gian. Danh sách lọc THEO VAI và
 * THEO buổi bắt đầu Sale vừa nhập (tính lại ngay, cùng hàm với máy chủ): Sale chỉ thấy lớp mình xếp được; Quản lý cơ sở thấy cả lớp vượt trần; Quản trị tối cao thấy mọi cơ sở.
 * Phán quyết của lớp ĐANG CHỌN nằm ngay dưới ô — đó là thứ người xếp lớp đọc để quyết, không phải chú thích phụ.
 *
 * ── KHÔNG CÒN "Xếp bé này" ────────────────────────────────────────────────────────────────────────────────
 * Dòng nào đã CHỌN LỚP thì được xếp; chưa chọn thì bỏ qua và quay lại lúc khác. Con không có dòng đơn (chưa đăng ký / chưa đóng tiền) không bao giờ hiện ở đây.
 *
 * ── RESPONSIVE: 320px → 8k ───────────────────────────────────────────────────────────────────────────────
 * trần 104rem đặt ở trang; lưới ô `grid-cols-1 sm:grid-cols-2 xl:grid-cols-4` — dưới 640px xếp dọc; mọi chuỗi dài `min-w-0` + `truncate`/`break-words`; thanh hành động `sticky bottom-0`
 * (safe-area) để ở màn cao 8k không phải cuộn tìm nút.
 */

type Khai = {
  tenBe: string;
  ngaySinh: string;
  gioiTinh: string;
  lopTruong: string;
  truong: string;
  classId: string;
  buoiBatDau: string;
  hocVuot: boolean;
  soBuoiBu: string;
  dongY: boolean;
};

type PhKhai = {
  ten: string;
  email: string;
  quanHe: string;
  gioiTinh: string;
  ngaySinh: string;
  facebook: string;
  diaChi: string;
  tinh: string;
  phuong: string;
};

const LOP_TRUONG = Array.from({ length: 12 }, (_, i) => String(i + 1));

const so = (s: string): number | null => {
  const t = s.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
};

/** Phán quyết của một lớp cho một dòng với buổi bắt đầu hiện hành. Dòng SCOPE: quyền học quyết, không xét ở đây. */
function xetLop(d: DongChuyenDoi, buoiBatDau: number | null, lop: LopUngVien, tran: number): XetTheoBuoiBatDau | null {
  if (d.phamVi) return null;
  return xetTheoBuoiBatDau({
    tongSoBuoiKhoa: d.tongSoBuoiKhoa,
    soBuoiMua: d.soBuoiMua,
    buoiBatDau,
    soBuoiDaQua: lop.soBuoiDaQua,
    tran,
  });
}

export function FormChuyenDoi({
  orderId,
  maDon,
  phuHuynh,
  dong,
  vai,
  tran,
  donHocBong,
}: {
  orderId: string;
  maDon: string;
  phuHuynh: PhuHuynhChuyenDoi;
  dong: DongChuyenDoi[];
  vai: VaiXepLop;
  /** Trần học vượt của cơ sở đơn (QLCS chỉnh được). */
  tran: number;
  donHocBong: boolean;
}) {
  const router = useRouter();
  const [dangLuu, batDau] = useTransition();

  const [ph, setPh] = useState<PhKhai>({
    ten: phuHuynh.ten,
    email: phuHuynh.email,
    quanHe: phuHuynh.quanHe,
    gioiTinh: phuHuynh.gioiTinh,
    ngaySinh: phuHuynh.ngaySinh,
    facebook: phuHuynh.facebook,
    diaChi: phuHuynh.diaChi,
    tinh: phuHuynh.tinh,
    phuong: phuHuynh.phuong,
  });
  const suaPh = (t: Partial<PhKhai>) => setPh((c) => ({ ...c, ...t }));

  const [khai, setKhai] = useState<Record<string, Khai>>(() =>
    Object.fromEntries(
      dong.map((d) => [
        d.orderItemId,
        {
          tenBe: d.tenBe,
          ngaySinh: d.ngaySinh,
          gioiTinh: d.gioiTinh,
          lopTruong: d.lopTruong,
          truong: d.truong,
          classId: "",
          buoiBatDau: d.khoangBuoi ? String(d.khoangBuoi.macDinh) : "",
          hocVuot: false,
          soBuoiBu: "",
          dongY: false,
        } satisfies Khai,
      ]),
    ),
  );
  const sua = (id: string, t: Partial<Khai>) => setKhai((c) => ({ ...c, [id]: { ...c[id]!, ...t } }));

  /** Dòng chưa chuyển đổi VÀ đã chọn lớp ⇒ sẽ được xếp. */
  const daChon = useMemo(() => dong.filter((d) => d.enrollmentId === null && khai[d.orderItemId]?.classId), [dong, khai]);

  const soChoDuyet = useMemo(
    () =>
      daChon.filter((d) => {
        const k = khai[d.orderItemId]!;
        const lop = d.lop.find((l) => l.id === k.classId);
        const x = lop ? xetLop(d, so(k.buoiBatDau) ?? d.khoangBuoi?.macDinh ?? null, lop, tran) : null;
        return x !== null && canKhaiHocVuot(x) && !tuDuyetHocVuot(vai);
      }).length,
    [daChon, khai, tran, vai],
  );

  function luu() {
    if (!ph.ten.trim()) return void toast.error("Chưa nhập họ tên phụ huynh");
    if (daChon.length === 0) return void toast.error("Chưa chọn lớp cho bé nào");
    const dongGui: {
      orderItemId: string;
      tenBe: string;
      ngaySinh: string | null;
      gioiTinh: "MALE" | "FEMALE" | "OTHER" | null;
      lopTruong: number | null;
      truong: string | null;
      classId: string;
      buoiBatDau: number | null;
      hocVuot: { soBuoiBu: number } | null;
      dongYHinhAnh: boolean;
    }[] = [];
    for (const d of daChon) {
      const k = khai[d.orderItemId]!;
      const nhan = k.tenBe.trim() || d.tenDong;
      if (k.tenBe.trim().length < 2) return void toast.error(`Chưa nhập tên học viên cho "${d.tenDong}"`);
      const lop = d.lop.find((l) => l.id === k.classId);
      if (!lop) return void toast.error(`Lớp của "${nhan}" không còn trong danh sách — chọn lại`);
      let buoiBatDau: number | null = null;
      if (d.khoangBuoi) {
        buoiBatDau = so(k.buoiBatDau);
        const sai = kiemBuoiBatDau({ tongSoBuoiKhoa: d.tongSoBuoiKhoa, soBuoiMua: d.soBuoiMua }, buoiBatDau);
        if (sai) return void toast.error(`${nhan}: ${sai}`);
      }
      const x = xetLop(d, buoiBatDau ?? d.khoangBuoi?.macDinh ?? null, lop, tran);
      if (x && !vaiChonDuoc(vai, x)) return void toast.error(`${nhan}: ${x.cau}`);
      let hocVuot: { soBuoiBu: number } | null = null;
      if (x && canKhaiHocVuot(x)) {
        if (!k.hocVuot) return void toast.error(`${nhan}: tích xác nhận học vượt ${x.soBuoiCanBu} buổi để kịp tiến độ lớp`);
        const b = so(k.soBuoiBu);
        const sai = kiemSoBuoiBu(x.soBuoiCanBu, b ?? undefined);
        if (sai || b === null) return void toast.error(`${nhan}: ${sai ?? "Nhập số buổi học bù"}`);
        hocVuot = { soBuoiBu: b };
      }
      dongGui.push({
        orderItemId: d.orderItemId,
        tenBe: k.tenBe.trim(),
        ngaySinh: k.ngaySinh || null,
        gioiTinh: (k.gioiTinh || null) as "MALE" | "FEMALE" | "OTHER" | null,
        lopTruong: k.lopTruong ? Number(k.lopTruong) : null,
        truong: k.truong.trim() || null,
        classId: k.classId,
        buoiBatDau,
        hocVuot,
        dongYHinhAnh: k.dongY,
      });
    }
    batDau(async () => {
      const kq = await chuyenDoiDonAction({
        orderId,
        phuHuynh: {
          ten: ph.ten.trim(),
          email: ph.email.trim(),
          quanHe: ph.quanHe.trim() || null,
          gioiTinh: (ph.gioiTinh || null) as "MALE" | "FEMALE" | "OTHER" | null,
          ngaySinh: ph.ngaySinh || null,
          facebook: ph.facebook.trim() || null,
          diaChi: ph.diaChi.trim() || null,
          tinh: ph.tinh.trim() || null,
          phuong: ph.phuong.trim() || null,
        },
        dong: dongGui,
      });
      if (!kq.ok) {
        toast.error(kq.error, { duration: 12_000 });
        return;
      }
      const phan = [`Đã xếp ${kq.soCon} học viên vào lớp`];
      if (kq.soPhieuHocBu > 0) phan.push(`tạo ${kq.soPhieuHocBu} dòng cần bù`);
      if (kq.soChoDuyet > 0) phan.push(`${kq.soChoDuyet} yêu cầu học vượt chờ Quản lý cơ sở duyệt`);
      toast.success(phan.join(" · "), { duration: 10_000 });
      router.push(`/orders/${orderId}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5 pb-24">
      {donHocBong && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-sm text-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-state-success-ink" aria-hidden />
          <span className="min-w-0">Đơn {maDon} được Quản trị tối cao cấp <b>học bổng 100%</b> — chuyển đổi không cần tiền về.</span>
        </p>
      )}

      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Phụ huynh</h2>
        <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
          <Truong id="ph-ten" nhan="Họ tên" batBuoc>
            <input id="ph-ten" className={O_NHAP} value={ph.ten} maxLength={120} onChange={(e) => suaPh({ ten: e.target.value })} />
          </Truong>
          <Truong
            id="ph-sdt"
            nhan="Số điện thoại"
            goiY="Số điện thoại là khoá nhận diện phụ huynh và là số đăng nhập cổng phụ huynh nên không đổi ở đây. Sai số thì sửa ở màn đơn."
          >
            <input id="ph-sdt" className={O_NHAP} value={phuHuynh.sdt || "—"} readOnly data-chi-doc="" />
          </Truong>
          <Truong id="ph-email" nhan="Email" goiY="Lấy từ đơn; trống thì lấy từ phiếu lead hoặc email nhận hoá đơn của đơn.">
            <input id="ph-email" type="email" className={O_NHAP} value={ph.email} maxLength={200} onChange={(e) => suaPh({ email: e.target.value })} placeholder="phuhuynh@email.com" />
          </Truong>
          <Truong id="ph-quan-he" nhan="Quan hệ với bé">
            <input id="ph-quan-he" className={O_NHAP} value={ph.quanHe} maxLength={60} onChange={(e) => suaPh({ quanHe: e.target.value })} placeholder="Mẹ, Bố, Ông, Bà…" />
          </Truong>
        </div>
        <details className="group mt-3">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline sm:min-h-8">
            Thông tin thêm của phụ huynh
            <span className="text-xs font-normal text-muted-foreground">(không bắt buộc — có thì nhập, không có vẫn chuyển đổi được)</span>
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            <Truong id="ph-gt" nhan="Giới tính">
              <select id="ph-gt" className={O_NHAP} value={ph.gioiTinh} onChange={(e) => suaPh({ gioiTinh: e.target.value })}>
                <option value="">— Chưa chọn —</option>
                {GIOI_TINH_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Truong>
            <Truong id="ph-ns" nhan="Ngày sinh">
              <input id="ph-ns" type="date" className={O_NHAP} value={ph.ngaySinh} onChange={(e) => suaPh({ ngaySinh: e.target.value })} />
            </Truong>
            <Truong id="ph-fb" nhan="Link Facebook" className="sm:col-span-2">
              <input id="ph-fb" className={O_NHAP} value={ph.facebook} maxLength={300} onChange={(e) => suaPh({ facebook: e.target.value })} placeholder="https://facebook.com/…" />
            </Truong>
            <Truong id="ph-dc" nhan="Địa chỉ (số nhà, đường)" className="sm:col-span-2">
              <input id="ph-dc" className={O_NHAP} value={ph.diaChi} maxLength={300} onChange={(e) => suaPh({ diaChi: e.target.value })} />
            </Truong>
            <Truong id="ph-tinh" nhan="Tỉnh / Thành">
              <input id="ph-tinh" className={O_NHAP} value={ph.tinh} maxLength={120} onChange={(e) => suaPh({ tinh: e.target.value })} />
            </Truong>
            <Truong id="ph-phuong" nhan="Phường / Xã">
              <input id="ph-phuong" className={O_NHAP} value={ph.phuong} maxLength={120} onChange={(e) => suaPh({ phuong: e.target.value })} />
            </Truong>
          </div>
        </details>
        <p className="mt-3 text-xs text-muted-foreground">
          Điền sẵn từ đơn {maDon} và phiếu lead. Thông tin nhập ở đây được ghi vào hồ sơ học viên và đồng bộ về phiếu lead.
        </p>
      </section>

      {dong.length === 0 && (
        <p className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
          Đơn này không có dòng khoá học nào để xếp lớp.
        </p>
      )}

      {dong.map((d, i) => (
        <KhoiCon
          key={d.orderItemId}
          stt={i + 1}
          orderId={orderId}
          dong={d}
          khai={khai[d.orderItemId]!}
          vai={vai}
          tran={tran}
          onSua={(t) => sua(d.orderItemId, t)}
        />
      ))}

      <div className="sticky bottom-0 -mx-4 border-t border-border bg-background/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 text-sm">
            <p className="text-foreground">
              {daChon.length === 0 ? "Chưa chọn lớp cho bé nào" : `Sẽ xếp ${daChon.length} học viên vào lớp`}
            </p>
            {soChoDuyet > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-state-warning-ink">
                <Hourglass className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {soChoDuyet} bé có yêu cầu học vượt cần Quản lý cơ sở duyệt
              </p>
            )}
          </div>
          <button type="button" className={NUT_CHINH} onClick={luu} disabled={dangLuu || daChon.length === 0}>
            <UserPlus className="h-4 w-4" aria-hidden />
            {dangLuu ? "Đang xếp lớp…" : "Xếp vào lớp"}
          </button>
        </div>
      </div>
    </div>
  );
}

function KhoiCon({
  stt,
  orderId,
  dong,
  khai,
  vai,
  tran,
  onSua,
}: {
  stt: number;
  orderId: string;
  dong: DongChuyenDoi;
  khai: Khai;
  vai: VaiXepLop;
  tran: number;
  onSua: (t: Partial<Khai>) => void;
}) {
  const daXep = dong.enrollmentId !== null;
  const id = `be-${stt}`;
  const k = dong.khoangBuoi;
  const buoi = so(khai.buoiBatDau);
  const saiBuoi = !daXep && k ? kiemBuoiBatDau({ tongSoBuoiKhoa: dong.tongSoBuoiKhoa, soBuoiMua: dong.soBuoiMua }, buoi) : null;

  // Lớp hiện cho vai này, theo buổi bắt đầu đang nhập. Lớp ĐẦY ẩn hẳn (không ai chọn được kể cả Quản trị tối cao) — đếm riêng để nói cho người dùng.
  const { opts, soAnDay, soAnVuot } = useMemo(() => {
    let anDay = 0;
    let anVuot = 0;
    const ra: ComboboxOption[] = [];
    for (const l of dong.lop) {
      if (l.daDay) {
        anDay++;
        continue;
      }
      const x = xetLop(dong, buoi ?? k?.macDinh ?? null, l, tran);
      if (x && !vaiThayLop(vai, x)) {
        anVuot++;
        continue;
      }
      ra.push({ value: l.id, label: nhanLop(l) });
    }
    return { opts: ra, soAnDay: anDay, soAnVuot: anVuot };
  }, [dong, buoi, k, tran, vai]);

  // Lớp đang chọn có thể rơi khỏi danh sách khi Sale đổi buổi bắt đầu — báo, không tự xoá câm.
  const lopChon = dong.lop.find((l) => l.id === khai.classId) ?? null;
  const xetChon = lopChon ? xetLop(dong, buoi ?? k?.macDinh ?? null, lopChon, tran) : null;
  const rotKhoiDs = !!lopChon && !opts.some((o) => o.value === lopChon.id);
  const canBu = xetChon && canKhaiHocVuot(xetChon) ? xetChon.soBuoiCanBu : 0;
  const saiBu = canBu > 0 && khai.hocVuot ? kiemSoBuoiBu(canBu, so(khai.soBuoiBu) ?? undefined) : null;

  return (
    <section className={`rounded-xl border bg-card transition-colors duration-150 ${daXep ? "border-border" : khai.classId ? "border-primary/40" : "border-border"}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-6 min-w-6 items-center justify-center whitespace-nowrap rounded-md bg-muted px-1.5 text-xs font-semibold text-muted-foreground">{stt}</span>
            <h2 className="min-w-0 break-words text-sm font-bold text-foreground">{dong.tenKhoa ?? dong.tenDong}</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Mua <b className="tabular-nums text-foreground">{dong.soBuoiMua ?? dong.tongSoBuoiKhoa ?? "—"} buổi</b>
            {dong.tongSoBuoiKhoa ? <> trên khoá {dong.tongSoBuoiKhoa} buổi</> : null}
            {dong.phamVi && <> · quyền học quyết bài bắt đầu sau khi xếp lớp</>}
          </p>
        </div>
        {daXep && (
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-state-success-soft px-2.5 py-1 text-xs font-medium text-state-success-ink">
            <Check className="h-3.5 w-3.5" aria-hidden />
            Đã xếp lớp{dong.buoiBatDauDaLuu && dong.buoiBatDauDaLuu > 1 ? ` · từ buổi ${dong.buoiBatDauDaLuu}` : ""}
          </span>
        )}
      </header>

      {daXep ? (
        vai === "ADMIN" && k && !dong.phamVi ? (
          <SuaBuoiBatDau orderId={orderId} dong={dong} />
        ) : null
      ) : (
        <div className="space-y-5 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            <Truong id={`${id}-ten`} nhan="Tên học viên" batBuoc goiY="Tên bé, không phải tên phụ huynh. Nếu bé đã có hồ sơ với cùng phụ huynh và cùng ngày sinh, hệ dùng lại hồ sơ cũ thay vì tạo trùng.">
              <input id={`${id}-ten`} className={O_NHAP} value={khai.tenBe} maxLength={120} onChange={(e) => onSua({ tenBe: e.target.value })} placeholder="VD: Nguyễn Bảo Minh" />
            </Truong>
            <Truong id={`${id}-ns`} nhan="Ngày sinh">
              <input id={`${id}-ns`} type="date" className={O_NHAP} value={khai.ngaySinh} onChange={(e) => onSua({ ngaySinh: e.target.value })} />
            </Truong>
            <Truong id={`${id}-gt`} nhan="Giới tính">
              <select id={`${id}-gt`} className={O_NHAP} value={khai.gioiTinh} onChange={(e) => onSua({ gioiTinh: e.target.value })}>
                <option value="">— Chưa chọn —</option>
                {GIOI_TINH_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Truong>
            <Truong id={`${id}-lt`} nhan="Lớp đang học ở trường">
              <select id={`${id}-lt`} className={O_NHAP} value={khai.lopTruong} onChange={(e) => onSua({ lopTruong: e.target.value })}>
                <option value="">— Chưa rõ —</option>
                {LOP_TRUONG.map((n) => (
                  <option key={n} value={n}>Lớp {n}</option>
                ))}
              </select>
            </Truong>
            <Truong id={`${id}-truong`} nhan="Trường đang học" className="sm:col-span-2">
              <input id={`${id}-truong`} className={O_NHAP} value={khai.truong} maxLength={200} onChange={(e) => onSua({ truong: e.target.value })} placeholder="VD: Tiểu học Trần Văn Ơn" />
            </Truong>
            {k && !k.muaDuKhoa && (
              <Truong
                id={`${id}-bd`}
                nhan="Bắt đầu học từ buổi"
                goiY={`Bé mua ${dong.soBuoiMua} buổi nên bắt đầu được từ buổi ${k.min} tới buổi ${k.max}. Lớp nào chưa học tới buổi này thì xếp vào để giữ chỗ; lớp đã học qua buổi này thì bé phải học vượt (học bù) phần đã qua.`}
                phu={saiBuoi ? <span className="text-state-danger-ink">{saiBuoi}</span> : `Từ ${k.min} đến ${k.max}`}
              >
                <input id={`${id}-bd`} inputMode="numeric" className={`${O_NHAP} tabular-nums`} value={khai.buoiBatDau} onChange={(e) => onSua({ buoiBatDau: e.target.value.replace(/\D/g, "") })} aria-invalid={!!saiBuoi} />
              </Truong>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Chọn lớp</p>
            {dong.lop.length === 0 ? (
              <p className="rounded-lg border border-state-warning-ink/30 bg-state-warning-soft px-3 py-2.5 text-xs text-state-warning-ink">
                Không có lớp nào của khoá này đang nhận học viên{vai === "ADMIN" ? "" : " ở cơ sở của đơn"}. Mở lớp mới hoặc đổi cơ sở của đơn trước.
              </p>
            ) : (
              <>
                <Combobox
                  id={`${id}-lop`}
                  options={opts}
                  value={khai.classId || null}
                  onValueChange={(v) => onSua({ classId: v ?? "", hocVuot: false, soBuoiBu: "" })}
                  placeholder="Gõ tên lớp, mã lớp hoặc cơ sở để tìm…"
                  emptyText={saiBuoi ? "Sửa buổi bắt đầu để xem lớp" : "Không có lớp nào phù hợp"}
                  className="sm:h-9"
                />
                <p className="text-xs text-muted-foreground">
                  {opts.length} lớp {vai === "SALE" ? "xếp được" : "hiện có"}
                  {soAnDay > 0 && ` · ${soAnDay} lớp đã đầy không hiện`}
                  {soAnVuot > 0 && ` · ${soAnVuot} lớp học trước quá trần ${tran} buổi (chỉ Quản lý cơ sở xếp được)`}
                </p>
              </>
            )}

            {lopChon && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 sm:p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-0 break-words text-sm font-medium text-foreground">{lopChon.ten}</span>
                  {lopChon.maLop && <span className="whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{lopChon.maLop}</span>}
                  {lopChon.tenCoSo && <span className={`whitespace-nowrap text-xs ${lopChon.khacCoSo ? "font-medium text-state-warning-ink" : "text-muted-foreground"}`}>{lopChon.tenCoSo}{lopChon.khacCoSo ? " · khác cơ sở của đơn" : ""}</span>}
                </div>
                <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {lopChon.lich && <span>{lopChon.lich}</span>}
                  <span className="whitespace-nowrap tabular-nums">Sĩ số {lopChon.siSo}/{lopChon.siSoToiDa}</span>
                  <span className="whitespace-nowrap tabular-nums">{lopChon.soBuoiDaQua === 0 ? "Chưa học buổi nào" : `Đã học ${lopChon.soBuoiDaQua} buổi`}</span>
                </p>
                {xetChon ? (
                  <p className={`mt-2 flex items-start gap-1.5 text-xs ${rotKhoiDs || xetChon.loai === "qua_tran" ? "text-state-danger-ink" : canBu > 0 ? "text-state-warning-ink" : "text-state-success-ink"}`}>
                    {canBu > 0 || rotKhoiDs ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
                    <span>{rotKhoiDs ? "Lớp này không còn xếp được với buổi bắt đầu hiện tại — chọn lớp khác hoặc sửa buổi bắt đầu. " : ""}{xetChon.cau}</span>
                  </p>
                ) : (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span>Dòng mua theo phạm vi học — bài bắt đầu và phần học vượt do quyền học chốt sau khi xếp lớp.</span>
                  </p>
                )}

                {canBu > 0 && (
                  <div className="mt-3 space-y-3 border-t border-border pt-3">
                    <label className="flex min-h-11 cursor-pointer items-start gap-2.5 text-sm sm:min-h-0">
                      <input type="checkbox" checked={khai.hocVuot} onChange={(e) => onSua({ hocVuot: e.target.checked, soBuoiBu: e.target.checked && !khai.soBuoiBu ? String(canBu) : khai.soBuoiBu })} className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary" />
                      <span className="min-w-0">
                        Xác nhận tạo <b className="tabular-nums">{canBu}</b> buổi học vượt (học bù) để bé kịp tiến độ lớp
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {tuDuyetHocVuot(vai)
                            ? "Bạn có quyền duyệt nên yêu cầu được duyệt ngay."
                            : "Quản lý cơ sở sẽ duyệt số buổi này; duyệt xong, trần buổi học bù miễn phí của bé tăng thêm đúng số buổi bù bạn nhập."}
                        </span>
                      </span>
                    </label>
                    {khai.hocVuot && (
                      <div className="max-w-xs">
                        <Truong
                          id={`${id}-bu`}
                          nhan="Học bù trong bao nhiêu buổi"
                          goiY="Một buổi bù có thể dạy nhiều bài, nên trao đổi với phụ huynh để rút ngắn thời gian bù. Số này không vượt số buổi bé phải học vượt, và chính là số lượt cộng thêm vào trần học bù miễn phí."
                          phu={saiBu ? <span className="text-state-danger-ink">{saiBu}</span> : `Từ 1 đến ${canBu}`}
                        >
                          <input id={`${id}-bu`} inputMode="numeric" className={`${O_NHAP} tabular-nums`} value={khai.soBuoiBu} onChange={(e) => onSua({ soBuoiBu: e.target.value.replace(/\D/g, "") })} aria-invalid={!!saiBu} />
                        </Truong>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <label className="flex min-h-11 cursor-pointer items-start gap-2.5 text-sm sm:min-h-0">
            <input type="checkbox" checked={khai.dongY} onChange={(e) => onSua({ dongY: e.target.checked })} className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary" />
            <span className="min-w-0">
              Phụ huynh đồng ý cho trung tâm sử dụng hình ảnh/video của học viên trong lớp cho mục đích lưu trữ &amp; truyền thông (NĐ 13/2023).
              <span className="mt-0.5 block text-xs text-muted-foreground">Người tick và thời điểm được ghi nhật ký; hiện ở cổng phụ huynh, phụ huynh rút lại được bất cứ lúc nào.</span>
            </span>
          </label>
        </div>
      )}
    </section>
  );
}

function nhanLop(l: LopUngVien): string {
  return [l.ten, l.maLop ? `(${l.maLop})` : null, l.tenCoSo, `sĩ số ${l.siSo}/${l.siSoToiDa}`, l.soBuoiDaQua > 0 ? `đã học ${l.soBuoiDaQua} buổi` : "chưa học"]
    .filter(Boolean)
    .join(" · ");
}

/** CHỈ Quản trị tối cao [chốt 27/10/2026]: đổi buổi bắt đầu của ghi danh đã chuyển đổi — máy chủ đồng bộ ghi danh, yêu cầu học vượt, dòng cần bù, sổ lượt. */
function SuaBuoiBatDau({ orderId, dong }: { orderId: string; dong: DongChuyenDoi }) {
  const router = useRouter();
  const [dang, batDau] = useTransition();
  const [mo, setMo] = useState(false);
  const [buoi, setBuoi] = useState(String(dong.buoiBatDauDaLuu ?? 1));
  const [bu, setBu] = useState("");
  const [lyDo, setLyDo] = useState("");
  const k = dong.khoangBuoi!;
  const sai = kiemBuoiBatDau({ tongSoBuoiKhoa: dong.tongSoBuoiKhoa, soBuoiMua: dong.soBuoiMua }, so(buoi));

  function gui() {
    if (sai) return void toast.error(sai);
    if (lyDo.trim().length < 10) return void toast.error("Ghi lý do ít nhất 10 ký tự");
    batDau(async () => {
      const kq = await doiBuoiBatDauAction({
        orderId,
        enrollmentId: dong.enrollmentId!,
        buoiBatDau: Number(buoi),
        soBuoiBu: bu ? Number(bu) : null,
        lyDo: lyDo.trim(),
      });
      if (!kq.ok) return void toast.error(kq.error, { duration: 12_000 });
      toast.success(kq.canBu > 0 ? `Đã đổi sang buổi ${kq.buoiBatDau} · bé cần bù ${kq.canBu} buổi` : `Đã đổi sang buổi ${kq.buoiBatDau}`);
      setMo(false);
      setLyDo("");
      router.refresh();
    });
  }

  return (
    <div className="p-4 sm:p-5">
      {!mo ? (
        <button type="button" className={NUT_VIEN} onClick={() => setMo(true)}>
          Sửa buổi bắt đầu
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Đổi buổi bắt đầu thì ghi danh, yêu cầu học vượt, dòng cần bù và trần học bù của bé đổi theo trong cùng một lần. Chỉ Quản trị tối cao làm được.
          </p>
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            <Truong id={`sua-${dong.orderItemId}-bd`} nhan="Buổi bắt đầu mới" phu={sai ? <span className="text-state-danger-ink">{sai}</span> : `Từ ${k.min} đến ${k.max}`}>
              <input id={`sua-${dong.orderItemId}-bd`} inputMode="numeric" className={`${O_NHAP} tabular-nums`} value={buoi} onChange={(e) => setBuoi(e.target.value.replace(/\D/g, ""))} aria-invalid={!!sai} />
            </Truong>
            <Truong id={`sua-${dong.orderItemId}-bu`} nhan="Số buổi học bù (nếu phải bù)" goiY="Bỏ trống: giữ số cũ, hoặc bằng số buổi phải bù nếu bé chưa có yêu cầu học vượt.">
              <input id={`sua-${dong.orderItemId}-bu`} inputMode="numeric" className={`${O_NHAP} tabular-nums`} value={bu} onChange={(e) => setBu(e.target.value.replace(/\D/g, ""))} />
            </Truong>
            <Truong id={`sua-${dong.orderItemId}-ly`} nhan="Lý do" batBuoc className="sm:col-span-2">
              <textarea id={`sua-${dong.orderItemId}-ly`} className={O_VAN_BAN} value={lyDo} maxLength={500} onChange={(e) => setLyDo(e.target.value)} placeholder="VD: Phụ huynh xin dời bé sang học từ buổi 5" />
            </Truong>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={NUT_CHINH} onClick={gui} disabled={dang}>
              {dang ? "Đang lưu…" : "Lưu buổi bắt đầu"}
            </button>
            <button type="button" className={NUT_VIEN} onClick={() => setMo(false)} disabled={dang}>
              Huỷ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

