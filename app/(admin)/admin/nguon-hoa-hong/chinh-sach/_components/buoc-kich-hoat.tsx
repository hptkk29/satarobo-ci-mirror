"use client";

// Bước 7 "Kích hoạt" + hộp thoại xác nhận (06 §5.2, PRD §74).
//
// Nút Kích hoạt do `quyetDinhNutKichHoat` quyết (lib/hoa-hong/hang-rao-ui.ts): không quyền ⇒ KHÔNG vẽ nút; có quyền nhưng chưa đủ
// điều kiện ⇒ nút TẮT kèm lý do ngay cạnh. Động từ của nút xác nhận nói đúng hệ quả: "Kích hoạt từ 01/11/2026".
import { Loader2, ShieldCheck } from "lucide-react";

import { BTN_OUTLINE, BTN_PRIMARY } from "@/components/admin/nguon-hoa-hong/classes";
import { KhoiVuotTran } from "@/components/admin/nguon-hoa-hong/khoi-vuot-tran";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { docPhanTram } from "@/lib/hoa-hong/phan-tram";
import { khoaO, LOAI_GD_SOAN, NHAN_LOAI_GD, type FormChinhSach } from "@/lib/hoa-hong/chinh-sach-form";
import { ngayDMY, SO_KY_TU_LY_DO_XAC_NHAN, type QuyetDinhNut } from "@/lib/hoa-hong/hang-rao-ui";
import type { HuongXuLyTran } from "@/lib/hoa-hong/huong-xu-ly-tran";

import type { TomTatTacDong } from "@/lib/hoa-hong/mo-phong-ui";

import type { DuLieuSoanClient } from "./kieu-soan";

export type TomTatKichHoat = {
  chinhSach: string;
  donViSoHuu: string;
  apDungCho: string;
  vanBan: string;
  hieuLuc: string;
  /** Mỗi dòng: loại giao dịch → "Sale 4% · Quản lý cơ sở 2%". */
  tiLe: { loai: string; noiDung: string }[];
  /** "01/11/2026" — ngày in trên nút xác nhận. */
  ngayNut: string;
};

export function tomTatForm(f: FormChinhSach, dl: DuLieuSoanClient, vanBanNhan: string): TomTatKichHoat {
  const ten = (code: string) => dl.vai.find((v) => v.code === code)?.name ?? code;
  const tiLe = LOAI_GD_SOAN.filter((l) => f.loaiGd.includes(l)).map((l) => ({
    loai: NHAN_LOAI_GD[l],
    noiDung:
      f.vai
        .map((code) => {
          const o = f.o[khoaO(l, code)];
          if (!o) return null;
          if (o.kieu === "EXCLUDE") return `${ten(code)} không trả`;
          const r = docPhanTram(o.phanTram);
          return r.kieu === "ok" ? `${ten(code)} ${r.phanTram}%` : null;
        })
        .filter((x): x is string => x !== null)
        .join(" · ") || "chưa có rule",
  }));
  const pv = f.phamVi;
  const apDungCho =
    pv.loai === "GLOBAL"
      ? "Mọi giao dịch thuộc đơn vị sở hữu"
      : pv.loai === "SOURCE_GROUP"
        ? `Nhóm nguồn: ${dl.nhomNguon.find((n) => n.id === pv.sourceGroupId)?.name ?? "?"}`
        : `Cơ sở: ${dl.coSo.find((c) => c.orgUnitId === pv.orgUnitId)?.label ?? "?"}`;
  const donViSoHuu = f.chuSoHuuOrgUnitId === null ? "Hội sở (toàn hệ thống)" : (dl.coSo.find((c) => c.orgUnitId === f.chuSoHuuOrgUnitId)?.label ?? "Cơ sở");
  return {
    chinhSach: `${f.policyCode} — ${f.name}`,
    donViSoHuu,
    apDungCho,
    vanBan: vanBanNhan,
    hieuLuc: f.hieuLucDen ? `từ ${ngayDMY(f.hieuLucTu)} đến hết ${ngayDMY(f.hieuLucDen)}` : `từ ${ngayDMY(f.hieuLucTu)}, chưa có ngày kết thúc`,
    tiLe,
    ngayNut: ngayDMY(f.hieuLucTu),
  };
}

function TomTat({ t }: { t: TomTatKichHoat }) {
  return (
    <dl className="grid grid-cols-[8.5rem_1fr] gap-x-4 gap-y-2 text-sm">
      <dt className="text-muted-foreground">Chính sách</dt>
      <dd className="min-w-0 break-words font-medium text-foreground">{t.chinhSach}</dd>
      <dt className="text-muted-foreground">Đơn vị sở hữu</dt>
      <dd className="text-foreground">{t.donViSoHuu}</dd>
      <dt className="text-muted-foreground">Áp dụng cho</dt>
      <dd className="text-foreground">{t.apDungCho}</dd>
      {t.tiLe.map((x) => (
        <div key={x.loai} className="contents">
          <dt className="text-muted-foreground">{x.loai}</dt>
          <dd className="tabular-nums text-foreground">{x.noiDung}</dd>
        </div>
      ))}
      <dt className="text-muted-foreground">Văn bản</dt>
      <dd className="min-w-0 break-words text-foreground">{t.vanBan}</dd>
      <dt className="text-muted-foreground">Hiệu lực</dt>
      <dd className="tabular-nums text-foreground">{t.hieuLuc}</dd>
    </dl>
  );
}

export function BuocKichHoat({
  tomTat,
  quyetDinh,
  vuotTran,
  coQuyenSuaTran,
  onMoHop,
}: {
  tomTat: TomTatKichHoat;
  quyetDinh: QuyetDinhNut;
  /** Hướng xử lý của dòng «trần» nếu máy chủ báo tổng vượt trần; `null` ⇒ không có khối. BẮT BUỘC khai (luật 7). */
  vuotTran: HuongXuLyTran | null;
  coQuyenSuaTran: boolean;
  onMoHop: () => void;
}) {
  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">Rà lại lần cuối. Kích hoạt xong, phiên bản này không sửa được nữa — muốn đổi phải tạo phiên bản mới. Khoản thu trước ngày hiệu lực vẫn tính theo phiên bản cũ.</p>
      <div className="border-y border-border py-4">
        <TomTat t={tomTat} />
      </div>
      {/* Từ 1280px thanh điều kiện bên cạnh đã mang đúng khối này; dưới đó thanh ấy nằm DƯỚI form nên khối phải đứng ngay cạnh nút tắt — nơi người ta tìm lý do. */}
      {vuotTran && (
        <div role="alert" data-testid="vuot-tran-o-buoc-kich-hoat" className="grid gap-2 xl:hidden">
          <p className="text-sm font-semibold text-state-danger-ink">Tổng tỉ lệ vượt trần hoa hồng nên chưa kích hoạt được</p>
          <KhoiVuotTran huongXuLy={vuotTran} coQuyenSuaTran={coQuyenSuaTran} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {quyetDinh.ve && (
          <button type="button" onClick={onMoHop} disabled={!quyetDinh.bamDuoc} aria-describedby={quyetDinh.lyDo ? "ly-do-kich-hoat" : undefined} className={BTN_PRIMARY}>
            <ShieldCheck aria-hidden className="h-4 w-4" />
            Kích hoạt…
          </button>
        )}
        {quyetDinh.lyDo && (
          <p id="ly-do-kich-hoat" className="min-w-0 flex-1 text-sm text-muted-foreground">
            {quyetDinh.lyDo}
          </p>
        )}
      </div>
    </div>
  );
}

export function KichHoatDialog({
  open,
  onOpenChange,
  tomTat,
  tacDong,
  canXacNhan,
  lyDo,
  onLyDo,
  pending,
  loi,
  onXacNhan,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tomTat: TomTatKichHoat;
  /** Dòng "Tác động ước tính" từ bước Thử tính — chưa chạy / cũ thì NÓI THẲNG, không dùng số cũ. */
  tacDong: TomTatTacDong;
  /** Guardrail có cảnh báo ⇒ đòi lý do xác nhận. */
  canXacNhan: boolean;
  lyDo: string;
  onLyDo: (v: string) => void;
  pending: boolean;
  loi: string | null;
  onXacNhan: () => void;
}) {
  const thieuLyDo = canXacNhan && lyDo.trim().length < SO_KY_TU_LY_DO_XAC_NHAN;
  return (
    <Dialog open={open} onOpenChange={(o) => (!pending ? onOpenChange(o) : undefined)}>
      <DialogContent showCloseButton={false} className="admin-scope sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Kích hoạt chính sách này?</DialogTitle>
          <DialogDescription>Xem lại tóm tắt. Sau khi kích hoạt, phiên bản này không sửa được nữa.</DialogDescription>
        </DialogHeader>
        <TomTat t={tomTat} />
        <div data-testid="tac-dong-uoc-tinh" className="grid gap-1 border-t border-border pt-3 text-sm">
          <p className="font-semibold text-foreground">Tác động ước tính</p>
          {tacDong.dong.map((d) => (
            <p key={d} className={tacDong.kieu === "co" ? "tabular-nums text-foreground" : "text-muted-foreground"}>
              {d}
            </p>
          ))}
        </div>
        {canXacNhan && (
          <div>
            <label htmlFor="ly-do-xac-nhan" className="mb-1 block text-sm font-semibold text-foreground">
              Lý do xác nhận cảnh báo <span className="text-state-danger-ink">*</span>
            </label>
            <Textarea
              id="ly-do-xac-nhan"
              value={lyDo}
              onChange={(e) => onLyDo(e.target.value)}
              rows={2}
              aria-invalid={thieuLyDo && lyDo.length > 0 ? true : undefined}
              placeholder={`Từ ${SO_KY_TU_LY_DO_XAC_NHAN} ký tự — vì sao chấp nhận cảnh báo ở thanh bên cạnh`}
            />
          </div>
        )}
        {loi && (
          <p role="alert" className="text-sm text-state-danger-ink">
            {loi}
          </p>
        )}
        <DialogFooter>
          <button type="button" onClick={() => onOpenChange(false)} disabled={pending} className={BTN_OUTLINE}>
            Quay lại
          </button>
          <button type="button" onClick={onXacNhan} disabled={pending || thieuLyDo} className={BTN_PRIMARY}>
            {pending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
            Kích hoạt từ {tomTat.ngayNut}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

