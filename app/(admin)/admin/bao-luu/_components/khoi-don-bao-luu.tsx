"use client";

import { useMemo, useState } from "react";
import { Download, FileText, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { LyDoBaoLuu } from "@/lib/bao-luu/hoso";
import {
  CAU_XEM_DANH_SACH,
  CAU_XEM_DANH_SACH_NGAN,
  LOI_CHUA_CO_MAU_DON,
  TOI_DA_KHOA_MOT_TRANG,
  NHAN_O_TREN_DON,
  THU_TU_Y_DO,
  coDanhSachKhoa,
  danhSachQuaMotTrang,
  dienSanDon,
  vuaOGiay,
  type TruongO,
  type DonBaoLuu,
  type MaMauDon,
} from "@/lib/bao-luu/mau-don";
import { dungDonHtml } from "@/lib/bao-luu/mau-don-html";

// Khối "Đơn bảo lưu": Sale điền sẵn → sửa tay nếu cần → IN (cửa sổ riêng) hoặc TẢI .docx → phụ huynh ký → tải bản quét lên ở khối bên dưới.
//
// MỘT bộ giá trị cho cả hai đầu ra: bản in dựng từ `don` ngay tại đây, và file .docx nhận CHÍNH `don` đó qua POST (server không tính lại).
// Ô nào Sale đã sửa tay thì GIỮ khi form lập đổi (ví dụ chọn thêm khoá); ô chưa đụng thì theo form. "Điền lại" bỏ mọi chỉnh tay.

export type DuLieuDonChoForm = {
  /** Mẫu theo cơ sở của học viên; null = cơ sở chưa có mẫu ⇒ khoá nút kèm lý do. */
  maMau: MaMauDon | null;
  hocVien: { hoTen: string; ma: string | null; ngaySinhYmd: string | null };
  phuHuynh: { hoTen: string | null; quanHe: string | null; dienThoai: string | null; email: string | null };
  /** Mọi ghi danh bảo lưu được của học viên (khoá/lớp/giáo viên) — form chọn khoá nào thì đơn ghi khoá đó. */
  ghiDanh: { id: string; tenKhoa: string; tenLop: string; maLop: string; giaoVien: string | null }[];
};

type TrangThaiForm = {
  chon: string[];
  lyDo: LyDoBaoLuu | "";
  ghiChu: string;
  ngayHenBatDau: string;
  ngayQuayLai: string;
  ngayNghiDau: string;
};

/** Khoá của một ô chữ = đúng khoá ô chấm chấm trên mẫu (`O_GIAY`): cùng khoá để hỏi "giá trị có vừa ô giấy không". */
type Khoa = TruongO;

type OSua = { khoa: Khoa; nhan: string; rong?: boolean; lay: (d: DonBaoLuu) => string; dat: (d: DonBaoLuu, v: string) => DonBaoLuu };

const O_SUA: OSua[] = [
  { khoa: "ph.hoTen", nhan: "Phụ huynh — họ và tên", lay: (d) => d.phuHuynh.hoTen, dat: (d, v) => ({ ...d, phuHuynh: { ...d.phuHuynh, hoTen: v } }) },
  { khoa: "ph.quanHe", nhan: "Quan hệ với học viên", lay: (d) => d.phuHuynh.quanHe, dat: (d, v) => ({ ...d, phuHuynh: { ...d.phuHuynh, quanHe: v } }) },
  { khoa: "ph.dienThoai", nhan: "Số điện thoại / Zalo", lay: (d) => d.phuHuynh.dienThoai, dat: (d, v) => ({ ...d, phuHuynh: { ...d.phuHuynh, dienThoai: v } }) },
  { khoa: "ph.email", nhan: "Email", lay: (d) => d.phuHuynh.email, dat: (d, v) => ({ ...d, phuHuynh: { ...d.phuHuynh, email: v } }) },
  { khoa: "hv.hoTen", nhan: "Học viên — họ và tên", lay: (d) => d.hocVien.hoTen, dat: (d, v) => ({ ...d, hocVien: { ...d.hocVien, hoTen: v } }) },
  { khoa: "hv.ngaySinh", nhan: "Ngày sinh", lay: (d) => d.hocVien.ngaySinh, dat: (d, v) => ({ ...d, hocVien: { ...d.hocVien, ngaySinh: v } }) },
  { khoa: "hv.ma", nhan: "Mã học viên", lay: (d) => d.hocVien.ma, dat: (d, v) => ({ ...d, hocVien: { ...d.hocVien, ma: v } }) },
  { khoa: "hv.khoa", nhan: "Khóa học", lay: (d) => d.hocVien.khoa, dat: (d, v) => ({ ...d, hocVien: { ...d.hocVien, khoa: v } }) },
  { khoa: "hv.lop", nhan: "Lớp đang học", lay: (d) => d.hocVien.lop, dat: (d, v) => ({ ...d, hocVien: { ...d.hocVien, lop: v } }) },
  { khoa: "hv.giaoVien", nhan: "Giáo viên phụ trách", lay: (d) => d.hocVien.giaoVien, dat: (d, v) => ({ ...d, hocVien: { ...d.hocVien, giaoVien: v } }) },
  { khoa: "tg.baoLuuTu", nhan: "Bảo lưu từ ngày", lay: (d) => d.thoiGian.baoLuuTu, dat: (d, v) => ({ ...d, thoiGian: { ...d.thoiGian, baoLuuTu: v } }) },
  { khoa: "tg.hocLaiDuKien", nhan: "Dự kiến học lại", lay: (d) => d.thoiGian.hocLaiDuKien, dat: (d, v) => ({ ...d, thoiGian: { ...d.thoiGian, hocLaiDuKien: v } }) },
  { khoa: "tg.nghiTuNgay", nhan: "Học viên đã nghỉ từ ngày", lay: (d) => d.thoiGian.nghiTuNgay, dat: (d, v) => ({ ...d, thoiGian: { ...d.thoiGian, nghiTuNgay: v } }) },
  { khoa: "lyDoKhac", nhan: "Lý do khác (ghi chữ)", rong: true, lay: (d) => d.lyDoKhac, dat: (d, v) => ({ ...d, lyDoKhac: v }) },
];

/** Khoá chỉnh tay: các ô chữ + "ds" (danh sách khoá in dưới mục II, mỗi dòng một khoá). */
type KhoaSua = Khoa | "ds";

export function KhoiDonBaoLuu({ studentId, du, form }: { studentId: string; du: DuLieuDonChoForm; form: TrangThaiForm }) {
  const [suaTay, setSuaTay] = useState<Partial<Record<KhoaSua, string>>>({});
  const [lyDoSua, setLyDoSua] = useState<LyDoBaoLuu[] | null>(null);
  const [dangTai, setDangTai] = useState(false);

  const macDinh = useMemo(
    () =>
      dienSanDon({
        hocVien: { hoTen: du.hocVien.hoTen, ma: du.hocVien.ma, ngaySinh: du.hocVien.ngaySinhYmd },
        phuHuynh: du.phuHuynh,
        khoaDaChon: du.ghiDanh.filter((g) => form.chon.includes(g.id)),
        lyDo: form.lyDo || null,
        ghiChu: form.ghiChu,
        ngayHenBatDau: form.ngayHenBatDau,
        ngayQuayLai: form.ngayQuayLai,
        ngayNghiDau: form.ngayNghiDau,
      }),
    [du, form],
  );

  const don = useMemo(() => {
    let d: DonBaoLuu = { ...macDinh, lyDo: lyDoSua ?? macDinh.lyDo };
    for (const o of O_SUA) {
      const v = suaTay[o.khoa];
      if (v !== undefined) d = o.dat(d, v);
    }
    if (suaTay.ds !== undefined) d = { ...d, danhSachKhoa: suaTay.ds.split("\n") };
    return d;
  }, [macDinh, suaTay, lyDoSua]);

  const daSua = Object.keys(suaTay).length > 0 || lyDoSua !== null;
  const chuaChonKhoa = form.chon.length === 0;
  const khoa = du.maMau === null ? LOI_CHUA_CO_MAU_DON : chuaChonKhoa ? "Chọn khoá bảo lưu ở trên trước khi in đơn." : null;

  const doiLyDo = (ly: LyDoBaoLuu) => {
    const hien = lyDoSua ?? macDinh.lyDo;
    setLyDoSua(hien.includes(ly) ? hien.filter((x) => x !== ly) : [...hien, ly]);
  };

  function inDon() {
    if (!du.maMau) return;
    const w = window.open("", "_blank", "width=900,height=1100");
    if (!w) {
      toast.error("Trình duyệt chặn cửa sổ in. Cho phép cửa sổ bật lên rồi thử lại.");
      return;
    }
    w.document.write(dungDonHtml(don, du.maMau, { logoUrl: `${window.location.origin}/brand/logo-satarobo.png` }));
    w.document.close();
    w.document.getElementById("in-don")?.addEventListener("click", () => w.print());
    w.focus();
  }

  async function taiDocx() {
    setDangTai(true);
    try {
      const res = await fetch("/api/admin/bao-luu/mau-don", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, don }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(b?.error ?? "Không xuất được file đơn. Thử lại sau.");
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `don-bao-luu-${du.hocVien.ma ?? studentId}-${du.maMau}.docx`.replace(/[^A-Za-z0-9._-]/g, "");
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      toast.error("Không xuất được file đơn. Kiểm tra mạng rồi thử lại.");
    } finally {
      setDangTai(false);
    }
  }

  return (
    <section aria-labelledby="bl-don-tieu-de" className="space-y-3 rounded-xl border border-border bg-muted/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="bl-don-tieu-de" className="flex items-center gap-2 text-sm font-semibold">
            <FileText aria-hidden className="size-4" /> Bước 1 — In đơn cho phụ huynh ký
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Đơn điền sẵn từ thông tin ở trên (mẫu SR.QD.236.002{du.maMau ? `, ${du.maMau}` : ""}). Sửa ô nào cần, in hoặc tải file Word, gửi phụ huynh ký, rồi tải bản quét ở Bước 2.
          </p>
        </div>
        {daSua && (
          <Button type="button" variant="outline" size="sm" onClick={() => { setSuaTay({}); setLyDoSua(null); }}>
            Điền lại từ hồ sơ
          </Button>
        )}
      </div>

      <fieldset className="space-y-1">
        <legend className="text-xs font-medium text-muted-foreground">Lý do trên đơn (tích được nhiều ô như trên giấy)</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {THU_TU_Y_DO.map((ly) => (
            <label key={ly} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={don.lyDo.includes(ly)} onChange={() => doiLyDo(ly)} />
              <span>{NHAN_O_TREN_DON[ly]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        {O_SUA.map((o) => {
          const v = o.lay(don);
          const dai = !vuaOGiay(o.khoa, v);
          const id = `bl-don-${o.khoa}`;
          return (
            <div key={o.khoa} className={o.rong ? "space-y-1 sm:col-span-2" : "space-y-1"}>
              <Label htmlFor={id} className="text-xs">
                {o.nhan}
                {suaTay[o.khoa] !== undefined && <span className="ml-1 text-state-warning-ink">(đã sửa tay)</span>}
              </Label>
              <Input
                id={id}
                value={v}
                maxLength={o.rong ? 300 : 160}
                onChange={(e) => setSuaTay((s) => ({ ...s, [o.khoa]: e.target.value }))}
                aria-describedby={dai ? `${id}-dai` : undefined}
              />
              {dai && (
                <p id={`${id}-dai`} className="text-xs text-state-warning-ink">
                  Dài quá ô trên giấy — Word sẽ lệch dòng. Rút gọn, hoặc ghi «{CAU_XEM_DANH_SACH}» ở khoá/lớp/giáo viên rồi nhập danh sách ở ô bên dưới.
                </p>
              )}
            </div>
          );
        })}
        {coDanhSachKhoa(don) && (
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="bl-don-ds" className="text-xs">
              Danh sách khoá in dưới mục II (mỗi khoá một dòng)
              {suaTay.ds !== undefined && <span className="ml-1 text-state-warning-ink">(đã sửa tay)</span>}
            </Label>
            <Textarea
              id="bl-don-ds"
              rows={Math.min(6, Math.max(2, don.danhSachKhoa.length))}
              value={don.danhSachKhoa.join("\n")}
              onChange={(e) => setSuaTay((s) => ({ ...s, ds: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              Một ô ở trên đang ghi «{CAU_XEM_DANH_SACH}» (hoặc «{CAU_XEM_DANH_SACH_NGAN}» ở ô hẹp) vì chuỗi quá dài cho ô giấy. Đơn in danh sách này ngay dưới mục II.
            </p>
            {danhSachQuaMotTrang(don) && (
              <p role="status" className="text-xs text-state-warning-ink">
                Hơn {TOI_DA_KHOA_MOT_TRANG} khoá: đơn sẽ sang trang hai. Chia thành hai lượt lập hồ sơ nếu cần đơn gọn một tờ.
              </p>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Để trống có chủ đích: ngày ký, và toàn bộ «Phần dành cho Trung tâm» (mã ghi danh, ngày duyệt, số buổi còn lại, học phí còn lại, hạn bảo lưu, công nợ) — các số đó chốt lúc Quản lý duyệt.
        {form.chon.length > 1 && " Đang chọn nhiều khoá: đơn ghi từng khoá kèm lớp, một tờ ký cho cả lượt lập."}
      </p>

      {khoa && (
        <p role="status" className="rounded-lg border border-state-warning-soft bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink">
          {khoa}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={inDon} disabled={khoa !== null}>
          <Printer aria-hidden className="size-4" /> Xem và in đơn
        </Button>
        <Button type="button" variant="outline" onClick={taiDocx} disabled={khoa !== null || dangTai}>
          {dangTai ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Download aria-hidden className="size-4" />}
          Tải file Word (.docx)
        </Button>
      </div>
    </section>
  );
}
