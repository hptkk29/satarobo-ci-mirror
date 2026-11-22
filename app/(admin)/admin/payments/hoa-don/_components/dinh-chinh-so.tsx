"use client";

// Nút + form "Sửa số / ký hiệu" của hoá đơn ĐÃ XÁC NHẬN (24/10/2026) — đính chính LỜI KHAI kế toán đã gõ sai (vd ký hiệu
// 1C26MVS thay vì 1C26MNV). Server là chốt (`dinhChinhSoHoaDonAction`); màn chỉ báo sớm bằng CÙNG luật thuần.
//
// ⚠️ Người gọi PHẢI đặt `key` gồm cả ba giá trị đang lưu: sửa xong, server trả số mới ⇒ mount lại, ô nhập đọc giá trị MỚI
// (bẫy "router.refresh không reset form" — memory feedback_router_refresh_khong_reset_form).
// ⚠️ Nút sáng / tắt đọc từ `dong.dinhChinh` (luật thuần `nutDinhChinhSoHoaDon`), không tự suy ở đây (luật 12).

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { kiemKyHieuVoiCauHinh } from "@/lib/finance/hoa-don/cau-hinh-co-so";
import type { DongHangCho } from "@/lib/finance/hoa-don/dong-hang-cho";
import { soDeSoSanh } from "@/lib/finance/hoa-don/goi-y-so";
import { TOI_THIEU_LY_DO_HOA_DON } from "@/lib/finance/hoa-don/trang-thai-hoa-don";
import { dinhChinhSoHoaDonAction } from "../_actions";

export function DinhChinhSo({
  dong,
  hoaDon,
  coQuyenNgoaiLeKyHieu,
}: {
  dong: DongHangCho;
  hoaDon: NonNullable<DongHangCho["hoaDon"]>;
  coQuyenNgoaiLeKyHieu: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [, startTransition] = useTransition();
  const [mo, setMo] = useState(false);
  const [kyHieu, setKyHieu] = useState(hoaDon.kyHieu ?? "");
  const [soHoaDon, setSoHoaDon] = useState(hoaDon.soHoaDon ?? "");
  const [ngay, setNgay] = useState(hoaDon.ngayPhatHanh ?? "");
  const [lyDo, setLyDo] = useState("");
  const [daDoiChieu, setDaDoiChieu] = useState(false);
  const [ngoaiLe, setNgoaiLe] = useState(false);
  const [lyDoNgoaiLe, setLyDoNgoaiLe] = useState("");
  const [loi, setLoi] = useState<string | null>(null);
  const [dangGui, setDangGui] = useState(false);

  if (!dong.dinhChinh.bat) {
    return dong.dinhChinh.lyDo ? <p className="text-sm text-muted-foreground">{dong.dinhChinh.lyDo}</p> : null;
  }

  if (!mo) {
    return (
      <div>
        <button
          type="button"
          className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => setMo(true)}
        >
          Sửa số / ký hiệu hoá đơn…
        </button>
      </div>
    );
  }

  const kyMoi = kyHieu.trim().toUpperCase();
  const kyCu = (hoaDon.kyHieu ?? "").trim().toUpperCase();
  const doi = kyMoi !== kyCu || soDeSoSanh(soHoaDon) !== soDeSoSanh(hoaDon.soHoaDon) || ngay !== (hoaDon.ngayPhatHanh ?? "");
  // Cùng luật với server: chỉ đối chiếu cấu hình khi ký hiệu hoặc ngày ĐỔI (sửa riêng số không bị hỏi lại ký hiệu cũ).
  const canKiemKyHieu = kyMoi !== kyCu || ngay !== (hoaDon.ngayPhatHanh ?? "");
  const kh = canKiemKyHieu && kyMoi !== "" ? kiemKyHieuVoiCauHinh({ cauHinh: dong.cauHinhCoSo, centerId: dong.coSoId ?? "", ngay, kyHieuNhap: kyMoi }) : null;
  const kyHieuLech = kh?.loai === "LECH";
  const thieuNgoaiLe = kyHieuLech && (!coQuyenNgoaiLeKyHieu || !ngoaiLe || lyDoNgoaiLe.trim().length < TOI_THIEU_LY_DO_HOA_DON);
  const du = kyMoi !== "" && soHoaDon.trim() !== "" && ngay !== "" && lyDo.trim().length >= TOI_THIEU_LY_DO_HOA_DON;
  // Có XML đính kèm thì server tự đối chiếu và có thể miễn lời khai; không có XML thì BẮT BUỘC tick ở đây (server đòi cùng điều kiện).
  const choGui = du && doi && !thieuNgoaiLe && (hoaDon.coXml || daDoiChieu);

  async function gui() {
    setLoi(null);
    setDangGui(true);
    const r = await dinhChinhSoHoaDonAction({
      orderId: dong.orderId,
      hoaDonId: hoaDon.id,
      kyHieu,
      soHoaDon,
      ngayPhatHanh: ngay,
      // Ba ô người dùng đã THẤY — server từ chối nếu có người sửa trước.
      daThay: { kyHieu: hoaDon.kyHieu, soHoaDon: hoaDon.soHoaDon, ngayPhatHanh: hoaDon.ngayPhatHanh },
      lyDo,
      daDoiChieuChungTu: daDoiChieu,
      ngoaiLeKyHieu: kyHieuLech && coQuyenNgoaiLeKyHieu && ngoaiLe ? { lyDo: lyDoNgoaiLe.trim() } : undefined,
    });
    setDangGui(false);
    if (!r.ok) return setLoi(r.error);
    toast.success(`Đã sửa hoá đơn ${r.data.truoc} → ${r.data.sau}`);
    if (r.data.daGuiEmail > 0) {
      toast.warning("Email đã gửi cho khách vẫn mang số cũ — dùng nút Gửi lại email nếu cần gửi bản đúng", { duration: 10000 });
    }
    setMo(false);
    startTransition(() => router.refresh());
  }

  return (
    <fieldset className="flex flex-col gap-3 border-t border-border pt-4" disabled={dangGui}>
      <legend className="sr-only">Sửa số / ký hiệu hoá đơn</legend>
      <p className="text-sm font-semibold text-foreground">Sửa số / ký hiệu hoá đơn</p>
      <p
        role="note"
        className="flex items-start gap-2 rounded-lg bg-state-warning-soft px-3.5 py-2.5 text-sm text-state-warning-ink"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          Đây là sửa DỮ LIỆU QUẢN LÝ trên SataRobo, <strong>không phải sửa hoá đơn đã phát hành</strong> trên phần mềm hoá đơn
          điện tử (VIN HOADON / MISA). Tờ gốc, tệp PDF/XML, khoản thu, phiếu thu, email đã gửi và pháp nhân phát hành giữ
          nguyên. Mọi lần sửa đều ghi vào nhật ký kèm lý do.
        </span>
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 sm:col-span-1">
          <Label htmlFor={`${id}-ky`} className="text-sm font-medium">
            Ký hiệu
          </Label>
          <Input
            id={`${id}-ky`}
            className="mt-1.5 uppercase tabular-nums"
            value={kyHieu}
            maxLength={20}
            onChange={(e) => {
              setKyHieu(e.target.value);
              setNgoaiLe(false);
            }}
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <Label htmlFor={`${id}-so`} className="text-sm font-medium">
            Số hoá đơn
          </Label>
          <Input
            id={`${id}-so`}
            className="mt-1.5 tabular-nums"
            inputMode="numeric"
            value={soHoaDon}
            maxLength={8}
            onChange={(e) => setSoHoaDon(e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <Label htmlFor={`${id}-ngay`} className="text-sm font-medium">
            Ngày phát hành
          </Label>
          <Input id={`${id}-ngay`} type="date" className="mt-1.5 tabular-nums" value={ngay} max={new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10)} onChange={(e) => setNgay(e.target.value)} />
        </div>
      </div>

      {kyHieuLech ? (
        <div className="flex flex-col gap-2 rounded-lg bg-state-warning-soft px-3.5 py-3 text-xs text-state-warning-ink" role="alert">
          <p className="flex items-start gap-2 font-medium">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              Ký hiệu {kyMoi} KHÔNG thuộc cấu hình hoá đơn của cơ sở (ngày {ngay || "—"} dùng {kh?.loai === "LECH" ? kh.kyHieuCauHinh : ""}).
            </span>
          </p>
          {coQuyenNgoaiLeKyHieu ? (
            <>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--primary)]"
                  checked={ngoaiLe}
                  onChange={(e) => setNgoaiLe(e.target.checked)}
                />
                <span>Tờ hoá đơn thật mang ký hiệu này — dùng ký hiệu ngoại lệ (có lý do, ghi vào nhật ký).</span>
              </label>
              {ngoaiLe ? (
                <Textarea
                  aria-label="Lý do dùng ký hiệu ngoại lệ"
                  rows={2}
                  maxLength={300}
                  placeholder={`Ghi rõ lý do (ít nhất ${TOI_THIEU_LY_DO_HOA_DON} ký tự)`}
                  value={lyDoNgoaiLe}
                  onChange={(e) => setLyDoNgoaiLe(e.target.value)}
                />
              ) : null}
            </>
          ) : (
            <p>Sửa lại ký hiệu cho đúng cấu hình. Chỉ người có quyền ngoại lệ mới lưu được ký hiệu khác.</p>
          )}
        </div>
      ) : null}

      <div>
        <Label htmlFor={`${id}-ly-do`} className="text-sm font-medium">
          Lý do sửa
        </Label>
        <Textarea
          id={`${id}-ly-do`}
          className="mt-1.5"
          placeholder={`Ví dụ: gõ nhầm ký hiệu, tờ hoá đơn in 1C26MNV (ít nhất ${TOI_THIEU_LY_DO_HOA_DON} ký tự)`}
          value={lyDo}
          rows={2}
          maxLength={500}
          onChange={(e) => setLyDo(e.target.value)}
        />
        <p className="mt-1 text-xs tabular-nums text-muted-foreground">
          {lyDo.trim().length}/{TOI_THIEU_LY_DO_HOA_DON} ký tự tối thiểu
        </p>
      </div>
      <label className="flex items-start gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--primary)]"
          checked={daDoiChieu}
          onChange={(e) => setDaDoiChieu(e.target.checked)}
        />
        <span>
          Tôi đã đối chiếu ký hiệu, số và ngày phát hành MỚI với tờ hoá đơn gốc đã phát hành.
          {hoaDon.coXml
            ? " (Hoá đơn có XML đính kèm: hệ thống tự đối chiếu; nếu XML không phủ thông tin vừa đổi thì vẫn cần xác nhận này.)"
            : " (Hoá đơn không có XML nên cần lời xác nhận này — hệ thống ghi nó là lời khai của bạn.)"}
        </span>
      </label>
      {loi ? (
        <p role="alert" className="text-sm text-state-danger-ink">
          {loi}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={!choGui} onClick={() => void gui()}>
          {dangGui ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Lưu số đã sửa
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setMo(false)}>
          Thôi
        </Button>
      </div>
      {!doi && du ? <p className="text-xs text-muted-foreground">Chưa có gì thay đổi so với số đang lưu.</p> : null}
    </fieldset>
  );
}
