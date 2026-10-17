"use client";

// Ngăn xử lý MỘT lần thu — docs/ke-toan-hoa-don/PLAN.md §4 + §10.
//
// ⚠️ Người gọi PHẢI đặt `key={dong.key}`: đổi dòng là mount lại từ đầu, mọi ô (tệp đã chọn, số hoá
// đơn) về rỗng. Không có `key` thì PDF của khách A (có MST, CCCD) nằm lại trong ô chọn tệp khi kế
// toán sang khách B — bẫy "router.refresh không reset form" (memory feedback_router_refresh…).
// ⚠️ Nút nào sáng / tắt đọc từ `dong.hanhDong` (luật thuần `hanhDongChoDong`), không tự suy ở đây.

import Link from "next/link";
import { useId, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Download, FileText, Loader2, Upload } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { cn } from "@/lib/utils";
import { kyHieuTheoNam } from "@/lib/finance/hoa-don/ky-hieu";
import type { DongHangCho, ToneDong } from "@/lib/finance/hoa-don/dong-hang-cho";
import { LY_DO_DA_XUAT_NGOAI, LY_DO_KHONG_XUAT_CO_DINH } from "@/lib/finance/hoa-don/ly-do-khong-xuat";
import {
  ganGhiDanhHoaDonAction,
  goHoaDonAction,
  guiLaiEmailHoaDonAction,
  huyHoaDonAction,
  khongTrungHoaDonAction,
  khongXuatHoaDonAction,
  luuHoaDonNhapAction,
  xacNhanHoaDonAction,
  xemTruocGanGhiDanhAction,
} from "../_actions";
import type { XemTruocGanGhiDanh } from "@/lib/finance/hoa-don/gan-ghi-danh";
import { TOI_THIEU_LY_DO_HOA_DON } from "@/lib/finance/hoa-don/trang-thai-hoa-don";
import { taiTepHoaDon } from "./tai-tep-hoa-don";
import { queryHoaDon } from "@/lib/finance/hoa-don/loc-hang-cho";
import { khoaGop } from "@/lib/finance/hoa-don/lan-thu";
import { useLocUrl } from "./loc-url";
import { CanhBaoMoPhong, KhoiPhatHanhMisa, PhatHanhQuaMisa } from "./phat-hanh-misa";

const tien = (n: number) => `${n.toLocaleString("vi-VN")}đ`;

// Trạng thái email là CẢ CÂU (có địa chỉ) — pill `whitespace-nowrap` tràn khỏi ngăn (smoke 27/09). Cùng
// lối chấm màu + chữ với khối Hoá đơn trên trang đơn.
const CHU_TONE: Record<ToneDong, string> = {
  success: "text-state-success-ink",
  warning: "text-state-warning-ink",
  danger: "text-state-danger-ink",
  info: "text-state-info-ink",
  muted: "text-muted-foreground",
};
const CHAM_TONE: Record<ToneDong, string> = {
  success: "bg-state-success",
  warning: "bg-state-warning",
  danger: "bg-state-danger",
  info: "bg-state-info",
  muted: "bg-muted-foreground/50",
};
const ddmmyyyy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
const homNayVn = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const coTep = (f: File) => `${f.name} · ${Math.max(1, Math.round(f.size / 1024))} KB`;

export function NganLanThu({ dong }: { dong: DongHangCho }) {
  const hd = dong.hoaDon;
  // GĐ 8 — lối ra chưa chọn đứng ĐẦU: nó nói vì sao nút Xác nhận tắt VÀ việc phải làm. Hoá đơn đã chốt /
  // đã đánh dấu không xuất thì lối ra không còn là việc của ai — không in (in là mời làm việc đã xong).
  const ngoaiLe = dong.hanhDong.ngoaiLe;
  const cauNgoaiLe =
    ngoaiLe && !ngoaiLe.daChon && hd?.trangThai !== "DA_XAC_NHAN" && hd?.trangThai !== "KHONG_XUAT" ? ngoaiLe.cau : null;
  const lech = [
    cauNgoaiLe,
    // Câu lối ra THIẾU đã mở đầu bằng đúng số thiếu — không nhắc lại.
    dong.thieu > 0 && !(cauNgoaiLe && ngoaiLe?.loai === "THEO_SO_DA_THU") && `Thiếu ${tien(dong.thieu)} so với ${dong.nhanDot ?? "đợt"}`,
    dong.traTruoc > 0 && `${tien(dong.traTruoc)} trả trước cho đợt sau`,
    dong.ngoaiDot > 0 && `${tien(dong.ngoaiDot)} không thuộc đợt nào`,
    dong.tienTha > 0 && `Dung sai làm tròn được tha ${tien(dong.tienTha)}`,
  ].filter((x): x is string => Boolean(x));

  return (
    <div className="flex flex-col gap-5 p-5">
      <section aria-label="Lần thu">
        <div className="flex items-start justify-between gap-3">
          <p className="text-2xl font-bold tabular-nums tracking-tight text-foreground">{tien(dong.soTien)}</p>
          <StatusPill tone={dong.tone}>{dong.nhan}</StatusPill>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {[dong.nhanDot, dong.ngayThuLabel, dong.nguonLabel].filter(Boolean).join(" · ")}
        </p>

        <dl className="mt-4 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Khách</dt>
          <dd className="min-w-0 truncate font-medium text-foreground">
            {dong.tenKhach || "—"}
            {dong.sdt ? <span className="font-normal text-muted-foreground"> · {dong.sdt}</span> : null}
          </dd>
          <dt className="text-muted-foreground">Đơn hàng</dt>
          <dd className="min-w-0 truncate">
            <Link href={`/orders/${dong.orderId}`} className="font-medium text-primary hover:underline">
              {dong.maDon}
            </Link>
          </dd>
          <dt className="text-muted-foreground">Cơ sở</dt>
          <dd className="min-w-0 truncate text-foreground">{dong.coSo.ten || "—"}</dd>
          <dt className="text-muted-foreground">Email nhận</dt>
          <dd className="min-w-0 truncate text-foreground">
            {dong.emailNhan ?? <span className="text-muted-foreground">Khách chưa có email</span>}
          </dd>
        </dl>
        {dong.coTtHoaDon ? (
          <p className="mt-3">
            <StatusPill tone="info">Có TT hoá đơn</StatusPill>
            <span className="ml-2 text-xs text-muted-foreground">Phụ huynh đã khai người mua trên đơn</span>
          </p>
        ) : null}
      </section>

      {lech.length + dong.hanhDong.canhBao.length > 0 ? (
        <section aria-label="Cần lưu ý" className="rounded-lg bg-state-warning-soft px-3.5 py-3">
          <ul className="flex flex-col gap-1.5 text-sm text-state-warning-ink">
            {[...lech, ...dong.hanhDong.canhBao].map((c) => (
              <li key={c} className="flex gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {dong.gopVoi.length > 0 && !hd ? <GopLanThu dong={dong} /> : null}

      {dong.coTheGanGhiDanh ? <GanGhiDanh key={`gan:${dong.key}`} dong={dong} /> : null}

      {dong.hoaDonDaHuy.length > 0 ? <HoaDonDaHuy dong={dong} /> : null}

      {hd?.trangThai === "DA_XAC_NHAN" ? (
        // Khoá theo TRẠNG THÁI hoá đơn, không theo ngăn: bản "cần điều chỉnh" vẫn là bản đã xác nhận —
        // hiện ô tải lên ở đây là mời gắn tệp thứ hai lên khoản đang bị khoá.
        <div className="flex flex-col gap-4">
          {dong.canDieuChinh.length > 0 ? (
            <section aria-label="Cần điều chỉnh" className="rounded-lg bg-state-danger-soft px-3.5 py-3 text-sm text-state-danger-ink">
              <p className="font-semibold">Tiền của lần thu đã đổi sau khi xuất hoá đơn</p>
              <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5">
                {dong.canDieuChinh.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <p className="mt-2">
                Hoá đơn cần sửa thì huỷ ở dưới — các khoản trở lại hàng chờ để tải hoá đơn đúng.
              </p>
            </section>
          ) : null}
          <HoaDonDaXuat hd={hd} />
          {dong.email ? <EmailChoKhach key={`email:${hd.id}`} dong={dong} hoaDonId={hd.id} email={dong.email} /> : null}
          <HuyHoaDon key={`huy:${hd.id}`} dong={dong} hoaDonId={hd.id} />
        </div>
      ) : hd && dong.misa ? (
        // Bước 1 MISA — bản ĐANG / LỖI phát hành: không có bước tải lên (khoản đang bị giữ bởi lượt phát hành).
        <KhoiPhatHanhMisa key={`misa:${dong.misa.hoaDonId}:${dong.misa.phienBan}`} dong={dong} misa={dong.misa} />
      ) : hd?.trangThai === "KHONG_XUAT" ? (
        // Theo TRẠNG THÁI hoá đơn (29/09 — Q3): bản "Đã xuất ngoài hệ thống" mà tiền đổi sau lúc đánh dấu
        // nằm ở ngăn "Cần điều chỉnh" — vẫn là bản không xuất, việc tiếp là GỠ DẤU (không có nút huỷ).
        <div className="flex flex-col gap-4">
          {dong.canDieuChinh.length > 0 ? (
            <section aria-label="Cần điều chỉnh" className="rounded-lg bg-state-danger-soft px-3.5 py-3 text-sm text-state-danger-ink">
              <p className="font-semibold">Tiền của lần thu đã đổi sau khi đánh dấu đã xuất ngoài hệ thống</p>
              <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5">
                {dong.canDieuChinh.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <p className="mt-2">Gỡ dấu ở dưới — các khoản trở lại hàng chờ để tải hoá đơn điều chỉnh lên.</p>
            </section>
          ) : null}
          <DaDanhDauKhongXuat dong={dong} hoaDonId={hd.id} />
        </div>
      ) : (
        <ol className="flex flex-col gap-5">
          <Buoc so={1} ten="Phiếu thu">
            <p className="text-sm text-muted-foreground">
              Bản chờ xác nhận để làm hoá đơn ở MISA. Số phiếu cấp khi kế toán xác nhận khoản thu.
            </p>
            {dong.hanhDong.taiPhieu ? (
              <a
                href={`/payments/hoa-don/phieu-cho?don=${encodeURIComponent(dong.orderId)}&chon=${encodeURIComponent(dong.key)}`}
                target="_blank"
                rel="noopener"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-2.5")}
              >
                <Download aria-hidden /> Tải phiếu thu
              </a>
            ) : (
              <p className="mt-2 text-sm text-state-warning-ink">{dong.hanhDong.taiLen.lyDo}</p>
            )}
          </Buoc>

          <Buoc so={2} ten="Hoá đơn">
            {dong.ngan === "don-huy" ? (
              // Câu do `hanhDongChoDong` nói (đợt huỷ / đơn huỷ / thiếu quyền) — không tự đặt câu ở đây.
              <p className="text-sm text-muted-foreground">{dong.hanhDong.xacNhan.lyDo}</p>
            ) : (
              <div className="flex flex-col gap-4">
                {/* Bước 1 MISA — lối tự phát hành, song song lối tải lên (nút do `nutPhatHanhMisa` quyết). */}
                {!dong.hoaDonNhap ? <PhatHanhQuaMisa key={`misa:${dong.key}`} dong={dong} /> : null}
                {!dong.hoaDonNhap && dong.phatHanhMisa.hien ? (
                  <p className="text-xs font-medium text-muted-foreground">Hoặc tải hoá đơn đã làm ở MISA lên:</p>
                ) : null}
                {/* Mount lại khi bản nháp ra đời / đổi: ô số + ô tệp đọc giá trị MỚI, không giữ tệp đã gửi. */}
                <FormHoaDon key={dong.hoaDonNhap?.id ?? "moi"} dong={dong} />
              </div>
            )}
          </Buoc>

          {dong.ngan === "nhap" && dong.hoaDonNhap ? (
            <Buoc so={3} ten="Xác nhận">
              <div className="flex flex-col gap-3">
                {/* Khoá RIÊNG cho từng anh em — cùng `key` là React vẽ lặp / bỏ sót khối (smoke 27/09). */}
                {ngoaiLe?.loai === "KHONG_TRUNG" ? (
                  <KhongTrung key={`kt:${dong.hoaDonNhap.id}`} dong={dong} nhap={dong.hoaDonNhap} />
                ) : null}
                <NutXacNhan key={`xn:${dong.hoaDonNhap.id}`} dong={dong} nhap={dong.hoaDonNhap} />
              </div>
            </Buoc>
          ) : null}
        </ol>
      )}

      {dong.hanhDong.khongXuat && (dong.ngan === "cho" || dong.ngan === "lech" || dong.ngan === "don-huy") ? (
        <KhongXuat dong={dong} />
      ) : null}
    </div>
  );
}

function Buoc({ so, ten, children }: { so: number; ten: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3">
      <span
        aria-hidden
        className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary"
      >
        {so}
      </span>
      <div className="min-w-0">
        <h3 className="flex h-7 items-center text-sm font-semibold text-foreground">{ten}</h3>
        <div className="mt-1">{children}</div>
      </div>
    </li>
  );
}

type TienDo = { viec: string; pct: number | null } | null;

function FormHoaDon({ dong }: { dong: DongHangCho }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const id = useId();
  const nhap = dong.hoaDonNhap;
  const taiLen = dong.hanhDong.taiLen;

  const [pdf, setPdf] = useState<File | null>(null);
  const [xml, setXml] = useState<File | null>(null);
  const [boXml, setBoXml] = useState(false);
  const [ngay, setNgay] = useState(nhap?.ngayPhatHanh ?? "");
  const [kyHieu, setKyHieu] = useState(nhap?.kyHieu ?? dong.kyHieuMau ?? "");
  const [kyHieuTay, setKyHieuTay] = useState(Boolean(nhap?.kyHieu));
  const [soHoaDon, setSoHoaDon] = useState(nhap?.soHoaDon ?? "");
  const [guiEmail, setGuiEmail] = useState(nhap?.guiEmailKhach ?? true);
  const [tienDo, setTienDo] = useState<TienDo>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [goLan1, setGoLan1] = useState(false);
  const refPdf = useRef<HTMLInputElement>(null);
  // GĐ 8 — lần thu THIẾU: xuất theo số đã thu là lựa chọn CÓ CHỦ ĐÍCH (tick + lý do), không phải mặc định.
  // Server từ chối cả hai chiều lệch (thiếu mà không chọn / hết thiếu mà vẫn gửi) — ở đây chỉ để nút nói thật.
  const canTheoSo = dong.hanhDong.ngoaiLe?.loai === "THEO_SO_DA_THU";
  const [theoSo, setTheoSo] = useState(nhap?.xuatTheoSoDaThu ?? false);
  const [lyDoTheoSo, setLyDoTheoSo] = useState(nhap?.xuatTheoSoDaThuLyDo ?? "");
  const thieuTheoSo = canTheoSo && (!theoSo || lyDoTheoSo.trim().length < TOI_THIEU_LY_DO_HOA_DON);

  const dangGui = tienDo !== null;
  const khongDuocTai = !taiLen.bat;

  function doiNgay(v: string) {
    setNgay(v);
    // Ký hiệu mang HAI SỐ CỦA NĂM phát hành: kế toán chưa tự gõ thì đổi theo ngày vừa chọn.
    if (!kyHieuTay && dong.kyHieuMau && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      setKyHieu(kyHieuTheoNam(dong.kyHieuMau, new Date(`${v}T00:00:00Z`)));
    }
  }

  function chonPdf(f: File | null) {
    setLoi(null);
    if (f && !/\.pdf$/i.test(f.name)) return setLoi("Chỉ nhận tệp PDF của hoá đơn");
    setPdf(f);
  }

  async function luu() {
    if (!nhap && !pdf) return setLoi("Chọn tệp PDF hoá đơn trước");
    setLoi(null);
    try {
      const tepPdf = pdf
        ? await taiTepHoaDon({ orderId: dong.orderId, loai: "pdf", file: pdf, hoaDonId: nhap?.id ?? null, onPct: (pct) => setTienDo({ viec: "Đang tải PDF", pct }) })
        : undefined;
      const tepXml =
        xml && !boXml
          ? await taiTepHoaDon({ orderId: dong.orderId, loai: "xml", file: xml, hoaDonId: nhap?.id ?? null, onPct: (pct) => setTienDo({ viec: "Đang tải XML", pct }) })
          : undefined;
      setTienDo({ viec: "Đang lưu", pct: null });
      const r = await luuHoaDonNhapAction({
        orderId: dong.orderId,
        lanThuKey: dong.key,
        hoaDonId: nhap?.id,
        pdf: tepPdf,
        xml: boXml ? null : tepXml,
        kyHieu,
        soHoaDon,
        ngayPhatHanh: ngay || undefined,
        guiEmailKhach: guiEmail,
        // Số kế toán đang nhìn khi đối chiếu tờ MISA — tiền về thêm giữa chừng thì server từ chối.
        soTienDaThay: dong.soTien,
        theoSoDaThu: canTheoSo && theoSo ? { lyDo: lyDoTheoSo.trim() } : null,
      });
      if (!r.ok) return setLoi(r.error);
      toast.success(nhap ? "Đã lưu thay đổi hoá đơn" : "Đã lưu hoá đơn — lần thu chuyển sang “Đã tải tệp”");
      startTransition(() => router.refresh());
    } catch (e) {
      setLoi(e instanceof Error ? e.message : "Không lưu được — thử lại");
    } finally {
      setTienDo(null);
    }
  }

  async function go() {
    if (!nhap) return;
    if (!goLan1) {
      setGoLan1(true);
      setTimeout(() => setGoLan1(false), 4000);
      return;
    }
    setTienDo({ viec: "Đang gỡ", pct: null });
    const r = await goHoaDonAction({ orderId: dong.orderId, hoaDonId: nhap.id });
    setTienDo(null);
    if (!r.ok) return setLoi(r.error);
    toast.success("Đã gỡ bản nháp — lần thu về lại hàng chờ");
    startTransition(() => router.refresh());
  }

  if (khongDuocTai && !nhap) {
    return <p className="text-sm text-state-warning-ink">{taiLen.lyDo}</p>;
  }

  return (
    <form
      className="flex flex-col gap-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        void luu();
      }}
    >
      {nhap ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border px-3 py-2.5 text-sm">
          <TepDaCo hoaDonId={nhap.id} ten={nhap.tepPdfTen} loai="pdf" />
          {nhap.tepXmlTen && !boXml ? <TepDaCo hoaDonId={nhap.id} ten={nhap.tepXmlTen} loai="xml" /> : null}
        </div>
      ) : null}

      <div>
        <Label htmlFor={`${id}-pdf`} className="text-sm font-medium">
          {nhap ? "Thay tệp PDF" : "Tệp PDF hoá đơn"}
        </Label>
        <label
          htmlFor={`${id}-pdf`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            chonPdf(e.dataTransfer.files?.[0] ?? null);
          }}
          className={cn(
            "mt-1.5 flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-input px-3.5 py-3 text-sm transition-colors duration-150 hover:border-primary hover:bg-primary-soft/40",
            pdf && "border-solid border-primary/60 bg-primary-soft/30",
          )}
        >
          {pdf ? (
            <FileText className="h-5 w-5 shrink-0 text-primary" aria-hidden />
          ) : (
            <Upload className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className={cn("min-w-0 truncate", pdf ? "font-medium text-foreground" : "text-muted-foreground")}>
            {pdf ? coTep(pdf) : "Chọn hoặc kéo tệp PDF vào đây"}
          </span>
        </label>
        <input
          ref={refPdf}
          id={`${id}-pdf`}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          disabled={dangGui}
          onChange={(e) => chonPdf(e.target.files?.[0] ?? null)}
        />
      </div>

      <div className="text-sm">
        {xml ? (
          <p className="flex items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 truncate">{coTep(xml)}</span>
            <button type="button" className="shrink-0 text-muted-foreground underline-offset-2 hover:underline" onClick={() => setXml(null)}>
              Bỏ
            </button>
          </p>
        ) : nhap?.tepXmlTen && !boXml ? (
          <button type="button" className="text-muted-foreground underline-offset-2 hover:underline" onClick={() => setBoXml(true)}>
            Gỡ tệp XML
          </button>
        ) : (
          <label className="cursor-pointer text-primary underline-offset-2 hover:underline">
            {nhap?.tepXmlTen ? "Tải lại tệp XML" : "Thêm tệp XML (không bắt buộc)"}
            <input
              type="file"
              accept=".xml,application/xml,text/xml"
              className="sr-only"
              disabled={dangGui}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setLoi(null);
                if (f && !/\.xml$/i.test(f.name)) return setLoi("Chỉ nhận tệp XML");
                setXml(f);
                setBoXml(false);
              }}
            />
          </label>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 sm:col-span-1">
          <Label htmlFor={`${id}-ngay`} className="text-sm font-medium">
            Ngày phát hành
          </Label>
          <Input
            id={`${id}-ngay`}
            type="date"
            className="mt-1.5"
            value={ngay}
            max={homNayVn()}
            disabled={dangGui}
            onChange={(e) => doiNgay(e.target.value)}
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <Label htmlFor={`${id}-kh`} className="text-sm font-medium">
            Ký hiệu
          </Label>
          <Input
            id={`${id}-kh`}
            className="mt-1.5 uppercase tabular-nums"
            value={kyHieu}
            maxLength={10}
            disabled={dangGui}
            autoComplete="off"
            onChange={(e) => {
              setKyHieu(e.target.value.toUpperCase());
              setKyHieuTay(true);
            }}
          />
        </div>
        <div className="col-span-2">
          <Label htmlFor={`${id}-so`} className="text-sm font-medium">
            Số hoá đơn
          </Label>
          <Input
            id={`${id}-so`}
            className="mt-1.5 tabular-nums"
            inputMode="numeric"
            placeholder="Ví dụ 127"
            value={soHoaDon}
            maxLength={8}
            disabled={dangGui}
            autoComplete="off"
            onChange={(e) => setSoHoaDon(e.target.value.replace(/\D/g, ""))}
          />
        </div>
      </div>

      {canTheoSo ? (
        <fieldset className="flex flex-col gap-2 rounded-lg bg-state-warning-soft px-3.5 py-3 text-sm text-state-warning-ink" disabled={dangGui}>
          <legend className="sr-only">Xuất theo số đã thu</legend>
          <label className="flex items-start gap-2.5 font-medium">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--primary)]"
              checked={theoSo}
              onChange={(e) => setTheoSo(e.target.checked)}
            />
            <span>Xuất theo số đã thu — {tien(dong.soTien)}</span>
          </label>
          <p>
            Lần thu thiếu {tien(dong.thieu)} so với {dong.nhanDot ?? "đợt"}. Chọn khi phụ huynh không trả nốt; nếu trả nốt
            sau, phần đó xuất hoá đơn riêng.
          </p>
          {theoSo ? (
            <>
              <Textarea
                aria-label="Lý do xuất theo số đã thu"
                placeholder="Ví dụ: phụ huynh xin trả nốt vào kỳ sau, đã báo sale"
                className="bg-background text-foreground"
                value={lyDoTheoSo}
                rows={2}
                maxLength={300}
                onChange={(e) => setLyDoTheoSo(e.target.value)}
              />
              <p className="text-xs tabular-nums">
                Tối thiểu {TOI_THIEU_LY_DO_HOA_DON} ký tự · đang có {lyDoTheoSo.trim().length}
              </p>
            </>
          ) : null}
        </fieldset>
      ) : null}

      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--primary)]"
          checked={guiEmail}
          disabled={dangGui}
          onChange={(e) => setGuiEmail(e.target.checked)}
        />
        <span>
          Gửi hoá đơn tới email khách khi xác nhận
          <span className="block text-xs text-muted-foreground">
            {dong.emailNhan
              ? `Tới ${dong.emailNhan}. Bỏ chọn nếu MISA đã gửi khách rồi.`
              : "Khách chưa có email — sale tải hoá đơn trên trang đơn để gửi qua Zalo."}
          </span>
        </span>
      </label>

      {tienDo ? (
        <div aria-live="polite" className="text-sm text-muted-foreground">
          <p className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {tienDo.viec}
            {tienDo.pct != null ? ` · ${tienDo.pct}%` : "…"}
          </p>
          {tienDo.pct != null ? (
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width] duration-150" style={{ width: `${tienDo.pct}%` }} />
            </div>
          ) : null}
        </div>
      ) : null}
      {loi ? (
        <p role="alert" className="text-sm text-state-danger-ink">
          {loi}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={dangGui || khongDuocTai || (!nhap && !pdf) || thieuTheoSo}>
          {nhap ? "Lưu thay đổi" : "Lưu hoá đơn"}
        </Button>
        {nhap ? (
          <Button type="button" variant="ghost" size="sm" disabled={dangGui} onClick={() => void go()}>
            {goLan1 ? "Bấm lần nữa để gỡ bản nháp" : "Gỡ bản nháp"}
          </Button>
        ) : null}
      </div>
      {khongDuocTai ? <p className="text-sm text-state-warning-ink">{taiLen.lyDo}</p> : null}
    </form>
  );
}

/**
 * ③ Xác nhận — CHỐT hoá đơn (phương án (b), PLAN §0.1): khoản còn chờ mà đủ điều kiện thì cấp RCP
 * trong cùng lượt; không đủ thì giữ chờ và báo lại. Xong ⇒ sang dòng KẾ TIẾP do server tính.
 * Nhãn nút + lý do tắt đọc từ `hanhDongChoDong` — không tự suy ở đây.
 */
function NutXacNhan({ dong, nhap }: { dong: DongHangCho; nhap: NonNullable<DongHangCho["hoaDonNhap"]> }) {
  const router = useRouter();
  const pathname = usePathname();
  const loc = useLocUrl();
  const [, startTransition] = useTransition();
  const [dangGui, setDangGui] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const xn = dong.hanhDong.xacNhan;
  const ngoaiLe = dong.hanhDong.ngoaiLe;
  // Nút tắt vì lối ra chưa chọn: câu dài đã đứng đầu "Cần lưu ý" — ở đây chỉ chỉ chỗ bấm.
  const lyDoTat =
    ngoaiLe && xn.lyDo === ngoaiLe.cau
      ? ngoaiLe.loai === "KHONG_TRUNG"
        ? "Mở sau khi ghi nhận “Không trùng” ngay trên."
        : "Mở sau khi chọn “Xuất theo số đã thu” ở bước 2 rồi lưu."
      : xn.lyDo;

  async function bam() {
    setDangGui(true);
    setLoi(null);
    // Phiên bản + nhãn ĐÃ THẤY: bản nháp bị sửa, hay email của đơn đổi, sau lúc màn vẽ ⇒ server từ chối
    // thay vì chốt một tờ / gửi tới một địa chỉ mà người bấm chưa từng thấy.
    const r = await xacNhanHoaDonAction({
      orderId: dong.orderId,
      hoaDonId: nhap.id,
      phienBan: nhap.phienBan,
      nhanDaThay: xn.nhan ?? "",
      // Dòng KẾ TIẾP tính trên tập màn đang xem (server đọc lại theo phạm vi kế toán — `docBoLoc`).
      ...(loc.coSo ? { coSo: loc.coSo } : {}),
      ...(loc.thang ? { thang: loc.thang } : {}),
    });
    setDangGui(false);
    if (!r.ok) return setLoi(r.error);
    const phieu = r.data.daXacNhan > 0 ? ` · cấp ${r.data.daXacNhan} phiếu thu` : "";
    const email = r.data.guiToi ? ` · đang gửi tới ${r.data.guiToi}` : "";
    toast.success(`Đã xác nhận hoá đơn${phieu}${email}`);
    if (r.data.conCho.length > 0) {
      toast.warning(`${r.data.conCho.length} khoản vẫn chờ kế toán xác nhận: ${r.data.conCho[0]}`);
    }
    const q = queryHoaDon(loc, { ngan: dong.ngan, chon: r.data.keKe });
    startTransition(() => router.replace(`${pathname}?${q}`, { scroll: false }));
  }

  return (
    <div className="flex flex-col gap-2">
      {xn.bat ? (
        <p className="flex items-start gap-2 text-sm text-state-success-ink">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Đủ tệp và số hoá đơn.
        </p>
      ) : null}
      <div>
        <Button type="button" size="sm" disabled={!xn.bat || dangGui} onClick={() => void bam()}>
          {dangGui ? (
            <>
              <Loader2 className="animate-spin" aria-hidden /> Đang xác nhận…
            </>
          ) : (
            (xn.nhan ?? "Xác nhận")
          )}
        </Button>
      </div>
      {!xn.bat && lyDoTat ? <p className="text-sm text-muted-foreground">{lyDoTat}</p> : null}
      {loi ? (
        <p role="alert" className="text-sm text-state-danger-ink">
          {loi}
        </p>
      ) : null}
    </div>
  );
}

function TepDaCo({ hoaDonId, ten, loai }: { hoaDonId: string; ten: string | null; loai: "pdf" | "xml" }) {
  return (
    <p className="flex items-center gap-2">
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{ten ?? `hoa-don.${loai}`}</span>
      <a
        href={`/payments/hoa-don/${hoaDonId}/tai-ve?loai=${loai}`}
        target="_blank"
        rel="noopener"
        className="shrink-0 font-medium text-primary underline-offset-2 hover:underline"
      >
        Xem
      </a>
    </p>
  );
}

function HoaDonDaXuat({ hd }: { hd: NonNullable<DongHangCho["hoaDon"]> }) {
  return (
    <section aria-label="Hoá đơn đã xuất" className="flex flex-col gap-3">
      {hd.nguon === "MISA_GIA_LAP" ? <CanhBaoMoPhong /> : null}
      <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Ký hiệu · số</dt>
        <dd className="font-medium tabular-nums text-foreground">
          {hd.kyHieu ?? "—"} · {hd.soHoaDon ?? "—"}
        </dd>
        <dt className="text-muted-foreground">Ngày phát hành</dt>
        <dd className="tabular-nums text-foreground">{ddmmyyyy(hd.ngayPhatHanh)}</dd>
        <dt className="text-muted-foreground">Nguồn</dt>
        <dd className="text-foreground">
          {hd.nguon === "TAI_LEN" ? "Tải lên từ MISA" : hd.nguon === "MISA_API" ? "Hệ thống phát hành qua MISA" : "Mô phỏng (không gọi MISA)"}
        </dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        {hd.coPdf ? (
          <a
            href={`/payments/hoa-don/${hd.id}/tai-ve?loai=pdf`}
            target="_blank"
            rel="noopener"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Download aria-hidden /> Tải PDF
          </a>
        ) : null}
        {hd.coXml ? (
          <a
            href={`/payments/hoa-don/${hd.id}/tai-ve?loai=xml`}
            target="_blank"
            rel="noopener"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Download aria-hidden /> Tải XML
          </a>
        ) : null}
      </div>
    </section>
  );
}

/**
 * GĐ 8 bước 11 — email của hoá đơn ĐÃ XÁC NHẬN: trạng thái lượt gửi mới nhất + nút "Gửi lại email".
 * Nút / lý do tắt đọc từ `dong.email.guiLai` (luật `hanhDongGuiLai`). Email của đơn đã đổi sau lúc xác
 * nhận ⇒ cho chọn địa chỉ; gửi tới địa chỉ MỚI phải bấm hai lần (4 giây) — nó khác địa chỉ in trên
 * hồ sơ hoá đơn, và nhật ký ghi lý do cố định cho lựa chọn đó.
 */
function EmailChoKhach({
  dong,
  hoaDonId,
  email,
}: {
  dong: DongHangCho;
  hoaDonId: string;
  email: NonNullable<DongHangCho["email"]>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const id = useId();
  const [nguon, setNguon] = useState<"HOA_DON" | "DON_HIEN_TAI">(email.toiMacDinh ? "HOA_DON" : "DON_HIEN_TAI");
  const [lan1, setLan1] = useState(false);
  const [dangGui, setDangGui] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const toi = nguon === "HOA_DON" ? email.toiMacDinh : email.toiDon;
  const tt = email.trangThai;

  function chon(n: "HOA_DON" | "DON_HIEN_TAI") {
    setNguon(n);
    setLan1(false);
    setLoi(null);
  }

  async function gui() {
    if (!toi) return;
    if (nguon === "DON_HIEN_TAI" && !lan1) {
      setLan1(true);
      setTimeout(() => setLan1(false), 4000);
      return;
    }
    setLoi(null);
    setDangGui(true);
    const r = await guiLaiEmailHoaDonAction({ orderId: dong.orderId, hoaDonId, nguon, toiDaThay: toi });
    setDangGui(false);
    setLan1(false);
    if (!r.ok) return setLoi(r.error);
    toast.success(`Đã xếp lượt gửi thứ ${r.data.lanGui} tới ${r.data.toi} — email đi trong vài phút`);
    startTransition(() => router.refresh());
  }

  return (
    <section aria-label="Email cho khách" className="flex flex-col gap-2.5 border-t border-border pt-4">
      <p className="text-sm font-semibold text-foreground">Email cho khách</p>
      {tt ? (
        <p className={cn("flex items-start gap-2 text-sm font-medium", CHU_TONE[tt.tone])}>
          <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", CHAM_TONE[tt.tone])} />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {tt.nhan}
            {email.lanGui ? <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">· lượt {email.lanGui}</span> : null}
          </span>
        </p>
      ) : null}
      {tt?.chiTiet ? <p className="break-words text-xs text-muted-foreground">{tt.chiTiet}</p> : null}
      {email.guiLai.bat && email.toiDon ? (
        <fieldset className="flex flex-col gap-1.5 text-sm" disabled={dangGui}>
          <legend className="sr-only">Gửi tới địa chỉ nào</legend>
          {email.toiMacDinh ? (
            <label className="flex items-start gap-2.5">
              <input
                type="radio"
                name={`${id}-toi`}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--primary)]"
                checked={nguon === "HOA_DON"}
                onChange={() => chon("HOA_DON")}
              />
              <span className="min-w-0">
                <span className="block text-xs text-muted-foreground">Email lúc xác nhận hoá đơn</span>
                <span className="block [overflow-wrap:anywhere]">{email.toiMacDinh}</span>
              </span>
            </label>
          ) : null}
          <label className="flex items-start gap-2.5">
            <input
              type="radio"
              name={`${id}-toi`}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--primary)]"
              checked={nguon === "DON_HIEN_TAI"}
              onChange={() => chon("DON_HIEN_TAI")}
            />
            <span className="min-w-0">
              <span className="block text-xs text-muted-foreground">Email hiện tại của đơn</span>
              <span className="block [overflow-wrap:anywhere]">{email.toiDon}</span>
            </span>
          </label>
        </fieldset>
      ) : null}
      <div>
        <Button type="button" variant="outline" size="sm" disabled={!email.guiLai.bat || dangGui || !toi} onClick={() => void gui()}>
          {dangGui ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {lan1 && toi ? `Bấm lần nữa để gửi tới ${toi}` : email.guiLai.nhan}
        </Button>
      </div>
      {!email.guiLai.bat && email.guiLai.lyDo ? <p className="text-sm text-muted-foreground">{email.guiLai.lyDo}</p> : null}
      {loi ? (
        <p role="alert" className="text-sm text-state-danger-ink">
          {loi}
        </p>
      ) : null}
    </section>
  );
}

function DaDanhDauKhongXuat({ dong, hoaDonId }: { dong: DongHangCho; hoaDonId: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [lan1, setLan1] = useState(false);
  const [dangGui, setDangGui] = useState(false);

  async function go() {
    if (!lan1) {
      setLan1(true);
      setTimeout(() => setLan1(false), 4000);
      return;
    }
    setDangGui(true);
    const r = await goHoaDonAction({ orderId: dong.orderId, hoaDonId });
    setDangGui(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Đã gỡ dấu — lần thu về lại hàng chờ");
    startTransition(() => router.refresh());
  }

  return (
    <section aria-label="Không xuất hoá đơn" className="flex flex-col gap-3">
      <p className="text-sm text-foreground">
        <span className="text-muted-foreground">Lý do: </span>
        {dong.lyDoKhongXuat ?? "—"}
      </p>
      <div>
        <Button type="button" variant="outline" size="sm" disabled={dangGui} onClick={() => void go()}>
          {lan1 ? "Bấm lần nữa để gỡ" : "Gỡ dấu không xuất"}
        </Button>
      </div>
    </section>
  );
}

const LY_DO = [...LY_DO_KHONG_XUAT_CO_DINH, "Khác"] as const;

function KhongXuat({ dong }: { dong: DongHangCho }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const id = useId();
  const [mo, setMo] = useState(false);
  const [lyDo, setLyDo] = useState<(typeof LY_DO)[number]>(LY_DO_DA_XUAT_NGOAI);
  const [ghiChu, setGhiChu] = useState("");
  const [loi, setLoi] = useState<string | null>(null);
  const [dangGui, setDangGui] = useState(false);

  if (!mo) {
    return (
      <div className="border-t border-border pt-4">
        <button
          type="button"
          className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => setMo(true)}
        >
          Không xuất hoá đơn cho lần thu này…
        </button>
      </div>
    );
  }

  async function gui() {
    setLoi(null);
    setDangGui(true);
    const r = await khongXuatHoaDonAction({ orderId: dong.orderId, lanThuKey: dong.key, lyDo, ghiChu });
    setDangGui(false);
    if (!r.ok) return setLoi(r.error);
    toast.success("Đã đánh dấu không xuất hoá đơn");
    startTransition(() => router.refresh());
  }

  return (
    <fieldset className="flex flex-col gap-3 border-t border-border pt-4" disabled={dangGui}>
      <legend className="sr-only">Không xuất hoá đơn</legend>
      <p className="text-sm font-semibold text-foreground">Không xuất hoá đơn</p>
      <div className="flex flex-col gap-2 text-sm">
        {LY_DO.map((l) => (
          <label key={l} className="flex items-center gap-2.5">
            <input
              type="radio"
              name={`${id}-ly-do`}
              className="h-4 w-4 accent-[color:var(--primary)]"
              checked={lyDo === l}
              onChange={() => setLyDo(l)}
            />
            {l === "Khác" ? "Lý do khác…" : l}
          </label>
        ))}
      </div>
      {lyDo === "Khác" ? (
        <Textarea
          aria-label="Ghi rõ lý do không xuất"
          placeholder="Ghi rõ lý do (ít nhất 5 ký tự)"
          value={ghiChu}
          rows={2}
          onChange={(e) => setGhiChu(e.target.value)}
        />
      ) : null}
      {loi ? (
        <p role="alert" className="text-sm text-state-danger-ink">
          {loi}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void gui()}>
          Đánh dấu không xuất
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setMo(false)}>
          Thôi
        </Button>
      </div>
    </fieldset>
  );
}

/**
 * GĐ 8 — "Không trùng — vẫn xuất" (quyết định (2) 27/09) cho bản NHÁP của lần thu nghi trùng. Khối gập
 * tại chỗ như `HuyHoaDon` (không Dialog — dưới xl ngăn đã nằm trong Sheet). Lý do lưu trên CHÍNH hoá đơn
 * + nhật ký; gửi kèm phiên bản bản nháp để một bản vừa bị sửa không nhận "không trùng" hộ.
 */
function KhongTrung({ dong, nhap }: { dong: DongHangCho; nhap: NonNullable<DongHangCho["hoaDonNhap"]> }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [mo, setMo] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const [loi, setLoi] = useState<string | null>(null);
  const [dangGui, setDangGui] = useState(false);
  const du = lyDo.trim().length >= TOI_THIEU_LY_DO_HOA_DON;

  if (dong.hanhDong.ngoaiLe?.daChon) {
    return (
      <p className="flex items-start gap-2 text-sm text-foreground">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-state-success-ink" aria-hidden />
        <span className="min-w-0 break-words">Đã xác nhận không trùng: “{nhap.khongTrungLyDo}”</span>
      </p>
    );
  }

  if (!mo) {
    return (
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => setMo(true)}>
          Không trùng — vẫn xuất…
        </Button>
      </div>
    );
  }

  async function gui() {
    setLoi(null);
    setDangGui(true);
    const r = await khongTrungHoaDonAction({ orderId: dong.orderId, hoaDonId: nhap.id, phienBan: nhap.phienBan, lyDo });
    setDangGui(false);
    if (!r.ok) return setLoi(r.error);
    toast.success("Đã ghi nhận không trùng — có thể xác nhận hoá đơn");
    startTransition(() => router.refresh());
  }

  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-border px-3.5 py-3" disabled={dangGui}>
      <legend className="sr-only">Không trùng — vẫn xuất</legend>
      <p className="text-sm font-semibold text-foreground">Không trùng — vẫn xuất</p>
      <p className="text-sm text-muted-foreground">
        Ghi lại cách đã đối chiếu. Lý do lưu trên hoá đơn và vào nhật ký; sau đó nút Xác nhận mở.
      </p>
      <Textarea
        aria-label="Vì sao không trùng?"
        placeholder={`Ít nhất ${TOI_THIEU_LY_DO_HOA_DON} ký tự — ví dụ: đối chiếu sao kê 10/09, CK FT… là đợt 2, khoản khai tay là tiền mặt đợt 1`}
        value={lyDo}
        rows={3}
        maxLength={500}
        onChange={(e) => setLyDo(e.target.value)}
      />
      <p className="text-xs tabular-nums text-muted-foreground">
        Tối thiểu {TOI_THIEU_LY_DO_HOA_DON} ký tự · đang có {lyDo.trim().length}
      </p>
      {loi ? (
        <p role="alert" className="text-sm text-state-danger-ink">
          {loi}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={!du} onClick={() => void gui()}>
          {dangGui ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Ghi nhận không trùng
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setMo(false)}>
          Thôi
        </Button>
      </div>
    </fieldset>
  );
}

/**
 * GĐ 8 — HUỶ hoá đơn đã xác nhận (quyết định (1) 27/09). Khối gập tại chỗ theo mẫu `KhongXuat`, KHÔNG
 * dùng Dialog: dưới xl ngăn này đã nằm trong Sheet. Nút chỉ sáng khi đủ lý do — cùng hằng với server.
 */
function HuyHoaDon({ dong, hoaDonId }: { dong: DongHangCho; hoaDonId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const loc = useLocUrl();
  const [, startTransition] = useTransition();
  const [mo, setMo] = useState(false);
  const [lyDo, setLyDo] = useState("");
  const [loi, setLoi] = useState<string | null>(null);
  const [dangGui, setDangGui] = useState(false);
  const du = lyDo.trim().length >= TOI_THIEU_LY_DO_HOA_DON;

  if (!dong.huy.bat) {
    return dong.huy.lyDo ? <p className="text-sm text-muted-foreground">{dong.huy.lyDo}</p> : null;
  }

  if (!mo) {
    return dong.canDieuChinh.length > 0 ? (
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-state-danger text-state-danger-ink hover:bg-state-danger-soft"
          onClick={() => setMo(true)}
        >
          Huỷ hoá đơn để xuất lại…
        </Button>
      </div>
    ) : (
      <div className="border-t border-border pt-4">
        <button
          type="button"
          className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => setMo(true)}
        >
          Huỷ hoá đơn này…
        </button>
      </div>
    );
  }

  async function gui() {
    setLoi(null);
    setDangGui(true);
    const r = await huyHoaDonAction({ orderId: dong.orderId, hoaDonId, lyDo });
    setDangGui(false);
    if (!r.ok) return setLoi(r.error);
    if (r.data.chon && r.data.ngan) {
      toast.success("Đã huỷ hoá đơn — các khoản đã trở lại hàng chờ");
      const q = queryHoaDon(loc, { ngan: r.data.ngan, chon: r.data.chon });
      startTransition(() => router.replace(`${pathname}?${q}`, { scroll: false }));
    } else {
      toast.success("Đã huỷ hoá đơn — các khoản đã hoàn hết nên không còn gì để xuất lại");
      startTransition(() => router.refresh());
    }
  }

  return (
    <fieldset className="flex flex-col gap-3 border-t border-border pt-4" disabled={dangGui}>
      <legend className="sr-only">Huỷ hoá đơn</legend>
      <p className="text-sm font-semibold text-foreground">Huỷ hoá đơn</p>
      <p className="text-sm text-muted-foreground">
        Hoá đơn chuyển sang Đã huỷ, các khoản của lần thu trở lại hàng chờ để tải hoá đơn đúng. Khoản thu vẫn đã
        xác nhận, phiếu thu giữ nguyên. Huỷ / lập hoá đơn thay thế trên MISA kế toán làm riêng.
      </p>
      {dong.hoaDon?.nguon === "MISA_API" ? (
        // Bước 1 MISA — nút này KHÔNG gọi MISA: tờ đã ký vẫn sống ở MISA cho tới khi kế toán huỷ ở đó.
        <p className="flex items-start gap-2 rounded-lg bg-state-warning-soft px-3.5 py-2.5 text-sm text-state-warning-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>Hoá đơn này do hệ thống phát hành qua MISA: huỷ / điều chỉnh trên MISA TRƯỚC, rồi mới huỷ ở đây.</span>
        </p>
      ) : null}
      <Textarea
        aria-label="Lý do huỷ hoá đơn"
        placeholder={`Ghi rõ lý do (ít nhất ${TOI_THIEU_LY_DO_HOA_DON} ký tự)`}
        value={lyDo}
        rows={2}
        maxLength={500}
        onChange={(e) => setLyDo(e.target.value)}
      />
      <p className="text-xs tabular-nums text-muted-foreground">
        {lyDo.trim().length}/{TOI_THIEU_LY_DO_HOA_DON} ký tự tối thiểu
      </p>
      {loi ? (
        <p role="alert" className="text-sm text-state-danger-ink">
          {loi}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="destructive" size="sm" disabled={!du} onClick={() => void gui()}>
          {dangGui ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Huỷ hoá đơn
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setMo(false)}>
          Thôi
        </Button>
      </div>
    </fieldset>
  );
}

/** GĐ 8 — lần thu này từng có hoá đơn đã huỷ: nói ra, kèm lý do (khi được xem) và tệp để đối chiếu. */
function HoaDonDaHuy({ dong }: { dong: DongHangCho }) {
  const coBanMoi = dong.hoaDon != null;
  return (
    <section aria-label="Hoá đơn đã huỷ" className="rounded-lg border border-border px-3.5 py-3 text-sm">
      <ul className="flex flex-col gap-2">
        {dong.hoaDonDaHuy.map((h) => (
          <li key={h.id} className="flex flex-col gap-1">
            <p className="text-foreground">
              {coBanMoi ? `Thay cho hoá đơn ${h.so}` : `Lần thu này từng có hoá đơn ${h.so}`}
              <StatusPill tone="muted" className="ml-2">
                Đã huỷ{h.huyLucLabel ? ` ${h.huyLucLabel}` : ""}
              </StatusPill>
            </p>
            {h.lyDo ? <p className="break-words text-muted-foreground">Lý do: {h.lyDo}</p> : null}
            {h.taiDuoc ? (
              <a
                href={`/payments/hoa-don/${h.id}/tai-ve?loai=pdf`}
                target="_blank"
                rel="noopener"
                className="w-fit font-medium text-primary underline-offset-2 hover:underline"
              >
                Xem PDF bản đã huỷ
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * GĐ 8b — "Gắn ghi danh cho khoản thu". Hai bước: KIỂM (xem kế hoạch — khoản nào gắn vào bé nào, chia ra
 * sao, vì sao chưa gắn được) rồi GẮN đúng kế hoạch đã xem (gửi kèm dấu). Nút gắn chỉ có khi CÓ khoản gắn
 * được — không có thì chỉ nói lý do (luật 12). Kế hoạch phủ CẢ ĐƠN; khoản thuộc lần thu khác ghi chú rõ.
 */
/**
 * Q2 (29/09) — GỘP nhiều lần thu của CÙNG đơn thành một hoá đơn (vd đợt 1 = 5tr: chuyển khoản 3tr + tiền
 * mặt 2tr). Chọn / bỏ chọn chỉ ĐỔI DÒNG ĐANG CHỌN sang khoá gộp (`khoaGop`) — server dựng lại dòng gộp
 * từ chính khoá, đo đủ / thiếu bằng `gomLanThu`; không ghi gì. Thân ngăn đặt `key={dong.key}` nên đổi
 * tập gộp là mount lại — tệp PDF đã chọn cho số cũ bị bỏ (tờ MISA phải làm theo số của cả tập).
 */
function GopLanThu({ dong }: { dong: DongHangCho }) {
  const router = useRouter();
  const pathname = usePathname();
  const loc = useLocUrl();
  const [dangDoi, startTransition] = useTransition();
  const soDaGop = dong.gopVoi.filter((g) => g.daGop).length;

  function doi(key: string, chon: boolean) {
    const tap = chon ? [...dong.thanhPhanGop, key] : dong.thanhPhanGop.filter((k) => k !== key);
    const dich = tap.length >= 2 ? khoaGop(tap) : tap[0];
    if (!dich) return;
    // Không mang `ngan`: dòng gộp có thể đổi ngăn (THIẾU + tiền mặt ⇒ đủ) — trang chọn ngăn theo dòng.
    startTransition(() => router.replace(`${pathname}?${queryHoaDon(loc, { chon: dich })}`, { scroll: false }));
  }

  return (
    <section aria-label="Gộp lần thu" className="flex flex-col gap-2.5 rounded-lg border border-border px-3.5 py-3 text-sm">
      <div>
        <p className="font-semibold text-foreground">Gộp với lần thu khác của đơn</p>
        <p className="mt-0.5 text-muted-foreground">
          {soDaGop > 0
            ? `Đang gộp ${soDaGop} lần thu thành một hoá đơn — số tiền và trạng thái ở trên là của cả tập.`
            : "Khách trả một đợt thành nhiều lần (vd chuyển khoản + tiền mặt)? Chọn để làm MỘT hoá đơn cho cả tập. Chỉ đổi cách nhóm, không ghi sổ tiền."}
        </p>
      </div>
      <fieldset disabled={dangDoi} className="flex flex-col gap-1.5">
        <legend className="sr-only">Lần thu gộp vào hoá đơn này</legend>
        {dong.gopVoi.map((g) => (
          <label key={g.key} className="flex items-start gap-2.5">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--primary)]"
              checked={g.daGop}
              onChange={(e) => doi(g.key, e.target.checked)}
            />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="font-medium tabular-nums text-foreground">{tien(g.soTien)}</span>
              <span className="text-muted-foreground"> · {[g.ngayThuLabel, g.nguonLabel, g.nhan].filter(Boolean).join(" · ")}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}

function GanGhiDanh({ dong }: { dong: DongHangCho }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [xt, setXt] = useState<XemTruocGanGhiDanh | null>(null);
  const [dangKiem, setDangKiem] = useState(false);
  const [dangGan, setDangGan] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);

  async function kiem() {
    setLoi(null);
    setDangKiem(true);
    const r = await xemTruocGanGhiDanhAction({ orderId: dong.orderId, lanThuKey: dong.key });
    setDangKiem(false);
    if (!r.ok) return setLoi(r.error);
    setXt(r.data);
  }

  async function gan() {
    if (!xt) return;
    setLoi(null);
    setDangGan(true);
    const r = await ganGhiDanhHoaDonAction({ orderId: dong.orderId, lanThuKey: dong.key, dauKeHoach: xt.dau });
    setDangGan(false);
    if (!r.ok) return setLoi(r.error);
    toast.success(r.data.thongDiep);
    if (r.data.gan + r.data.tach > 0) toast.warning(r.data.buocTiep);
    setXt(null);
    startTransition(() => router.refresh());
  }

  const soGhi = xt ? xt.soGan + xt.soTach : 0;

  return (
    <section aria-label="Gắn ghi danh" className="flex flex-col gap-2.5 rounded-lg border border-border px-3.5 py-3 text-sm">
      <div>
        <p className="font-semibold text-foreground">Gắn ghi danh cho khoản thu</p>
        <p className="mt-0.5 text-muted-foreground">
          Chưa gắn ghi danh thì chưa cấp được phiếu thu. Hệ thống tìm theo học viên trên đơn và SĐT phụ huynh.
        </p>
      </div>

      {xt ? (
        <>
          {xt.chan ? (
            <p className="text-state-danger-ink">{xt.chan}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {xt.dong.map((d) => (
                <li key={d.paymentId} className="[overflow-wrap:anywhere]">
                  <span className="font-medium tabular-nums text-foreground">{d.soTienLabel}</span>
                  {d.ngayLabel ? <span className="text-muted-foreground"> · {d.ngayLabel}</span> : null}
                  {d.ketQua === "GAN" ? (
                    <span className="text-foreground">
                      {" → "}
                      {d.dich[0]?.ten}
                      {d.dich[0]?.khoa ? ` · ${d.dich[0].khoa}` : ""}
                      {d.dich[0]?.lop ? ` · ${d.dich[0].lop}` : ""}
                    </span>
                  ) : d.ketQua === "TACH" ? (
                    <span className="text-foreground">
                      {" → chia "}
                      {d.dich.map((x) => `${x.soTienLabel} cho ${x.ten}${x.khoa ? ` (${x.khoa})` : ""}`).join(" · ")}
                    </span>
                  ) : (
                    <span className="text-state-warning-ink"> — chưa gắn được: {d.lyDo}</span>
                  )}
                  {d.trongLanThu ? null : <span className="text-xs text-muted-foreground"> (lần thu khác của đơn)</span>}
                </li>
              ))}
            </ul>
          )}
          {!xt.chan && soGhi > 0 ? (
            <div>
              {/* Nhãn dài (có phần "chia … theo bé") ⇒ cho xuống dòng, không tràn khỏi ngăn ở 375px. */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-auto min-h-8 whitespace-normal py-1.5 text-left"
                disabled={dangGan}
                onClick={() => void gan()}
              >
                {dangGan ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden /> Đang gắn…
                  </>
                ) : (
                  `Gắn ghi danh cho ${soGhi} khoản${xt.soTach > 0 ? ` (chia ${xt.soTach} khoản theo bé)` : ""}`
                )}
              </Button>
            </div>
          ) : !xt.chan ? (
            // Lý do đã in trên từng dòng khoản ở trên — nhắc lại ở đây là đọc cùng một câu hai lần.
            <p className="text-muted-foreground">Chưa gắn được khoản nào — xem lý do ở từng khoản trên</p>
          ) : null}
        </>
      ) : (
        <div>
          <Button type="button" variant="outline" size="sm" disabled={dangKiem} onClick={() => void kiem()}>
            {dangKiem ? (
              <>
                <Loader2 className="animate-spin" aria-hidden /> Đang kiểm…
              </>
            ) : (
              "Kiểm gắn ghi danh…"
            )}
          </Button>
        </div>
      )}
      {loi ? (
        <p role="alert" className="text-state-danger-ink">
          {loi}
        </p>
      ) : null}
    </section>
  );
}
