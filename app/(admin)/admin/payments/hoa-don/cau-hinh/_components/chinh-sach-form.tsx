"use client";

// Form SOẠN phiên bản chính sách hoá đơn (S7) — panel NGAY TRONG trang (không modal: soạn một bảng thuế cần nhìn song song với danh sách phiên bản).
// Luật kiểm là của `chinh-sach-phien-ban.ts` (qua `kiemNhap`); server kiểm lại. KHÔNG có mặc định pháp lý: ô thuế, thời điểm lập, chế độ tối đa, mức
// người mua để TRỐNG bắt chọn. Gửi đi là TẠO BẢN NHÁP — chưa hiệu lực; còn bước gửi duyệt và duyệt (người khác, sau khi xem mô phỏng).

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InfoTip } from "@/components/admin/ui/help-hint";
import { huongDan } from "@/lib/finance/hoa-don/huong-dan";
import { QR_TTL_GIO_MAC_DINH, QR_TTL_GIO_TOI_DA, QR_TTL_GIO_TOI_THIEU, NHAN_CHE_DO, lyDoDuDai, toiThieuLyDo } from "@/lib/finance/hoa-don/chinh-sach-phien-ban";
import { taoNhapChinhSachAction } from "../_chinh-sach-actions";
import {
  CAC_CHE_DO,
  CAC_DO_TIN_CAY,
  CAC_MUC_NGUOI_MUA,
  CAC_THOI_DIEM_LAP,
  LOAI_KHOAN_CHON,
  NHAN_CACH_SO_BUOI,
  NHAN_DO_TIN_CAY,
  NHAN_KIEU_GIA,
  NHAN_MUC_NGUOI_MUA,
  NHAN_THOI_DIEM_LAP,
  canCuMoi,
  dongMoi,
  kiemNhap,
  nhanLoaiKhoan,
  noiDungTuNhap,
  type CanCuNhap,
  type DongNhap,
  type NhapChinhSach,
} from "./chinh-sach-nhap";

/**
 * Khung HƯỚNG DẪN 5 bước ở đầu form — viết cho người KHÔNG có nghiệp vụ kế toán (chủ dự án yêu cầu 02/11/2026: «nhìn vào mà không biết phải soạn bản
 * chính sách hoá đơn như thế nào»). Chữ đi qua `huongDan(...)` (MỘT cửa, có lưới canh viện dẫn pháp lý). Mở sẵn; người đã quen thì thu gọn.
 */
function KhungHuongDanSoan() {
  const buoc = [
    { so: "1", ten: "Ngày áp dụng", chu: huongDan("soan-cs-hieu-luc") },
    { so: "2", ten: "Thời điểm lập hoá đơn", chu: huongDan("soan-cs-thoi-diem") },
    { so: "3", ten: "Chế độ tối đa", chu: huongDan("soan-cs-che-do") },
    { so: "4", ten: "Thuế từng loại khoản", chu: huongDan("soan-cs-thue") },
    { so: "5", ten: "Lưu, xem mô phỏng, áp dụng", chu: huongDan("soan-cs-ap-dung") },
  ];
  return (
    <details open className="rounded-lg border border-primary/30 bg-primary-soft/40 p-3 text-sm">
      <summary className="cursor-pointer font-semibold">Hướng dẫn: soạn chính sách trong 5 bước (bấm để thu gọn)</summary>
      <p className="mt-2 text-muted-foreground">{huongDan("soan-cs-tong-quan")}</p>
      <ol className="mt-3 flex flex-col gap-2">
        {buoc.map((b) => (
          <li key={b.so} className="flex gap-3">
            <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {b.so}
            </span>
            <span className="min-w-0">
              <b className="sr-only">Bước {b.so}: </b>
              {b.chu}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** Dòng chữ nhỏ dưới ô — nói ô này là gì bằng tiếng thường ngày (chỉ cách vận hành, không có số liệu thuế). */
const Goi = ({ children }: { children: React.ReactNode }) => <p className="mt-1 text-xs text-muted-foreground">{children}</p>;

/** Nhãn ô + icon hướng dẫn bên cạnh (nhãn là `<label for>` thật, icon không nằm trong nhãn để không bị đọc thành một phần tên ô). */
function NhanO({ htmlFor, children, hint, hintLabel }: { htmlFor: string; children: React.ReactNode; hint?: string; hintLabel?: string }) {
  return (
    <div className="flex items-center gap-1">
      <Label htmlFor={htmlFor}>{children}</Label>
      {hint ? <InfoTip label={hintLabel}>{hint}</InfoTip> : null}
    </div>
  );
}

const O_CHON = "mt-1.5 h-9 w-full rounded-lg border border-border bg-card px-2.5 text-sm pointer-coarse:h-11";

export function ChinhSachForm({
  centerId,
  phapNhanMa,
  tenPhapNhan,
  tenCoSo,
  ban,
  onXong,
  onHuy,
}: {
  centerId: string;
  phapNhanMa: string;
  tenPhapNhan: string;
  tenCoSo: string;
  /** Trạng thái khởi tạo (trống, hoặc chép từ một phiên bản có sẵn). `chung` quyết phạm vi. */
  ban: NhapChinhSach;
  onXong: (idMoi: string) => void;
  onHuy: () => void;
}) {
  const id = useId();
  const [n, setN] = useState<NhapChinhSach>(ban);
  const [loi, setLoi] = useState<string[]>([]);
  const [dangLuu, batDau] = useTransition();
  const set = (p: Partial<NhapChinhSach>) => setN((c) => ({ ...c, ...p }));
  const suaDong = (i: number, p: Partial<DongNhap>) => setN((c) => ({ ...c, dong: c.dong.map((d, k) => (k === i ? { ...d, ...p } : d)) }));
  const suaCanCu = (i: number, p: Partial<CanCuNhap>) => setN((c) => ({ ...c, canCu: c.canCu.map((d, k) => (k === i ? { ...d, ...p } : d)) }));

  function luu() {
    const l = kiemNhap(n);
    if (!lyDoDuDai(n.lyDo)) l.push(`Ghi lý do (ít nhất ${toiThieuLyDo} ký tự).`);
    if (l.length > 0) return setLoi(l);
    setLoi([]);
    batDau(async () => {
      const r = await taoNhapChinhSachAction({
        phapNhanMa,
        centerId: n.chung ? null : centerId,
        hieuLucTu: n.hieuLucTu,
        hieuLucDen: n.hieuLucDen.trim() === "" ? null : n.hieuLucDen,
        noiDung: noiDungTuNhap(n),
        lyDo: n.lyDo,
      });
      if (!r.ok) return setLoi([r.error]);
      toast.success(`Đã lưu bản nháp phiên bản ${r.data.phienBan}`);
      onXong(r.data.id);
    });
  }

  // Số giờ QR dùng để DỰNG CHỮ hướng dẫn: giá trị đang gõ nếu hợp lệ, không thì mặc định của hệ thống (không bao giờ in "NaN giờ").
  const gioQrDangNhap = Number.isInteger(Number(n.qrTtlGio)) && Number(n.qrTtlGio) > 0 && n.qrTtlGio.trim() !== "" ? Number(n.qrTtlGio) : QR_TTL_GIO_MAC_DINH;
  const chuaKy = n.canCu.some((c) => c.canKeToanXacNhan && c.daKyDuyetBoi.trim() === "");
  const chonRong = (v: string) => (v === "" ? <option value="">Chọn…</option> : null);

  return (
    <form
      aria-label="Soạn phiên bản chính sách"
      className="flex flex-col gap-5 rounded-xl border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        luu();
      }}
    >
      <div>
        <h3 className="text-base font-semibold">Soạn phiên bản mới</h3>
        <p className="text-sm text-muted-foreground">
          {n.chung ? (
            <>
              Phạm vi: <b>dùng chung toàn {tenPhapNhan}</b> (mọi cơ sở của pháp nhân này).
            </>
          ) : (
            <>
              Phạm vi: <b>riêng {tenCoSo}</b> — pháp nhân {tenPhapNhan}.
            </>
          )}{" "}
          Lưu là tạo <b>bản nháp</b>; chưa có hiệu lực cho tới khi được duyệt — sau khi lưu, bấm «Gửi duyệt và áp dụng ngay» ở màn chi tiết (kế toán Hội sở tự duyệt được bản mình soạn).
        </p>
      </div>

      <KhungHuongDanSoan />
      <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2" disabled={dangLuu}>
        <legend className="mb-1 text-sm font-semibold">Hiệu lực và chế độ</legend>
        <div>
          <Label htmlFor={`${id}-tu`}>Hiệu lực từ ngày</Label>
          <Input id={`${id}-tu`} type="date" className="mt-1.5" value={n.hieuLucTu} onChange={(e) => set({ hieuLucTu: e.target.value })} />
          <Goi>Bước 1. Ngày bản chính sách này bắt đầu dùng (thường là hôm nay hoặc đầu tháng).</Goi>
        </div>
        <div>
          <Label htmlFor={`${id}-den`}>Đến hết ngày (bỏ trống = không giới hạn)</Label>
          <Input id={`${id}-den`} type="date" className="mt-1.5" value={n.hieuLucDen} onChange={(e) => set({ hieuLucDen: e.target.value })} />
          <Goi>Chưa biết ngày kết thúc thì cứ để trống.</Goi>
        </div>
        <div>
          <Label htmlFor={`${id}-tdl`}>Thời điểm lập hoá đơn</Label>
          <select id={`${id}-tdl`} className={O_CHON} value={n.thoiDiemLap} onChange={(e) => set({ thoiDiemLap: e.target.value as NhapChinhSach["thoiDiemLap"] })}>
            {chonRong(n.thoiDiemLap)}
            {CAC_THOI_DIEM_LAP.map((v) => (
              <option key={v} value={v}>
                {NHAN_THOI_DIEM_LAP[v]}
              </option>
            ))}
          </select>
          <Goi>Bước 2. Chưa chắc thì chọn «Ngày do kế toán chốt (như hiện nay)» — giữ nguyên cách làm bây giờ.</Goi>
        </div>
        <div>
          <NhanO htmlFor={`${id}-cd`} hint={huongDan("che-do-toi-da")} hintLabel="Xem hướng dẫn về chế độ tối đa">
            Chế độ tối đa
          </NhanO>
          <select id={`${id}-cd`} className={O_CHON} value={n.cheDoToiDa} onChange={(e) => set({ cheDoToiDa: e.target.value as NhapChinhSach["cheDoToiDa"] })}>
            {chonRong(n.cheDoToiDa)}
            {CAC_CHE_DO.map((v) => (
              <option key={v} value={v}>
                {NHAN_CHE_DO[v]}
              </option>
            ))}
          </select>
          <Goi>Bước 3. Chưa chắc thì chọn «Chạy thử (không phát hành)» — chỉ tính thử, không lập hoá đơn thật.</Goi>
          {chuaKy ? <p className="mt-1 text-xs text-state-warning-ink">Có căn cứ cần kế toán xác nhận mà chưa ai ký: chỉ chọn được “Tắt” hoặc “Chạy thử”.</p> : null}
        </div>
        <div>
          <Label htmlFor={`${id}-nm`}>Mức thông tin người mua</Label>
          <select id={`${id}-nm`} className={O_CHON} value={n.mucNguoiMua} onChange={(e) => set({ mucNguoiMua: e.target.value as NhapChinhSach["mucNguoiMua"] })}>
            {chonRong(n.mucNguoiMua)}
            {CAC_MUC_NGUOI_MUA.map((v) => (
              <option key={v} value={v}>
                {NHAN_MUC_NGUOI_MUA[v]}
              </option>
            ))}
          </select>
          <Goi>Hiện mục này chỉ được ghi lại cùng bản chính sách, chưa điều khiển biểu mẫu QR người mua. Chọn mức bạn muốn ghi nhận.</Goi>
        </div>
        <div>
          <NhanO htmlFor={`${id}-qr`} hint={huongDan("qr-thong-tin-hoa-don", gioQrDangNhap)} hintLabel="Xem hướng dẫn về mã QR">
            Số giờ hiệu lực của mã QR người mua
          </NhanO>
          <Input
            id={`${id}-qr`}
            inputMode="numeric"
            className="mt-1.5 tabular-nums"
            value={n.qrTtlGio}
            placeholder={`Để trống = ${QR_TTL_GIO_MAC_DINH}`}
            onChange={(e) => set({ qrTtlGio: e.target.value.replace(/[^\d]/g, "") })}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Từ {QR_TTL_GIO_TOI_THIEU} đến {QR_TTL_GIO_TOI_DA} giờ. Để trống thì hệ thống dùng {QR_TTL_GIO_MAC_DINH} giờ.
          </p>
        </div>
        <div>
          <Label htmlFor={`${id}-lt`}>Làm tròn</Label>
          <select id={`${id}-lt`} className={O_CHON} value="HALF_UP" disabled aria-describedby={`${id}-lt-h`}>
            <option value="HALF_UP">Nửa lên</option>
          </select>
          <p id={`${id}-lt-h`} className="mt-1 text-xs text-muted-foreground">
            Hiện hệ thống chỉ hỗ trợ cách làm tròn này.
          </p>
        </div>
      </fieldset>

      <fieldset className="flex flex-col" disabled={dangLuu}>
        <legend className="mb-1 flex items-center gap-1 text-sm font-semibold">
          Ánh xạ thuế theo loại khoản
          <InfoTip label="Xem hướng dẫn về thuế">{huongDan("thue")}</InfoTip>
        </legend>
        <p className="mb-2 text-xs text-muted-foreground">
          Bước 4. Mỗi loại khoản một dòng. Hệ thống không tự đặt mức thuế: ô nào để trống thì chưa lưu được. Muốn một dòng áp cho mọi loại chưa có dòng riêng, chọn «Tất cả loại còn lại».
        </p>
        <ul className="flex flex-col divide-y divide-border">
          {n.dong.map((d, i) => (
            <li key={i} className="grid grid-cols-1 gap-3 py-3 first:pt-0 sm:grid-cols-2 xl:grid-cols-3">
              <div>
                <Label htmlFor={`${id}-d${i}-lk`}>Loại khoản</Label>
                <select id={`${id}-d${i}-lk`} className={O_CHON} value={d.loaiKhoan} onChange={(e) => suaDong(i, { loaiKhoan: e.target.value })}>
                  {chonRong(d.loaiKhoan)}
                  {LOAI_KHOAN_CHON.map((l) => (
                    // Một loại chỉ khai MỘT dòng (server từ chối khai hai lần) — ẩn khỏi ô chọn của dòng khác thay vì để người dùng đụng lỗi.
                    <option key={l.ma} value={l.ma} disabled={l.ma !== d.loaiKhoan && n.dong.some((x) => x.loaiKhoan === l.ma)}>
                      {l.nhan}
                    </option>
                  ))}
                  {d.loaiKhoan !== "" && !LOAI_KHOAN_CHON.some((l) => l.ma === d.loaiKhoan) ? <option value={d.loaiKhoan}>{nhanLoaiKhoan(d.loaiKhoan)} (mã từ bản cũ)</option> : null}
                </select>
                <Goi>{LOAI_KHOAN_CHON.find((l) => l.ma === d.loaiKhoan)?.giaiThich ?? "Chọn loại đơn mà dòng này áp dụng."}</Goi>
              </div>
              <div>
                <Label htmlFor={`${id}-d${i}-km`}>Mức thuế</Label>
                <div className="mt-1.5 flex gap-2">
                  <select id={`${id}-d${i}-km`} className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-card px-2.5 text-sm pointer-coarse:h-11" value={d.kieuMuc} onChange={(e) => suaDong(i, { kieuMuc: e.target.value as DongNhap["kieuMuc"] })}>
                    {chonRong(d.kieuMuc)}
                    <option value="SUAT">Có thuế suất</option>
                    <option value="KCT">Không chịu thuế (KCT)</option>
                    <option value="KKKNT">Không kê khai, nộp thuế (KKKNT)</option>
                  </select>
                  {d.kieuMuc === "SUAT" ? (
                    <Input aria-label={`Thuế suất dòng ${i + 1} (%)`} inputMode="numeric" className="w-20 tabular-nums" value={d.phanTram} placeholder="%" onChange={(e) => suaDong(i, { phanTram: e.target.value.replace(/[^\d]/g, "") })} />
                  ) : null}
                </div>
                <Goi>Chép đúng dòng thuế GTGT trên hoá đơn công ty ĐÃ xuất cho loại này. Hoá đơn ghi «KCT» thì chọn KCT; có % thì chọn «Có thuế suất» và gõ số.</Goi>
              </div>
              <div>
                <Label htmlFor={`${id}-d${i}-kg`}>Cách ghi giá trên đơn</Label>
                <select id={`${id}-d${i}-kg`} className={O_CHON} value={d.kieuGia} onChange={(e) => suaDong(i, { kieuGia: e.target.value as DongNhap["kieuGia"] })}>
                  {chonRong(d.kieuGia)}
                  {(Object.keys(NHAN_KIEU_GIA) as (keyof typeof NHAN_KIEU_GIA)[]).map((k) => (
                    <option key={k} value={k}>
                      {NHAN_KIEU_GIA[k]}
                    </option>
                  ))}
                </select>
                <Goi>Giá khách đóng trên đơn đã cộng thuế rồi, hay chưa? Xem hoá đơn cũ: nếu số tiền khách trả bằng «Thành tiền» thì là «đã gồm thuế».</Goi>
              </div>
              <div>
                <Label htmlFor={`${id}-d${i}-dv`}>Đơn vị tính (khoá học)</Label>
                <Input id={`${id}-d${i}-dv`} className="mt-1.5" value={d.donViTinh} maxLength={30} onChange={(e) => suaDong(i, { donViTinh: e.target.value })} />
                <Goi>Chữ in ở cột «Đơn vị tính» của hoá đơn. Giữ nguyên nếu hoá đơn cũ đang in đúng như vậy.</Goi>
              </div>
              <div>
                <Label htmlFor={`${id}-d${i}-db`}>Đơn vị tính (theo buổi)</Label>
                <Input id={`${id}-d${i}-db`} className="mt-1.5" value={d.donViTinhBuoi} maxLength={30} onChange={(e) => suaDong(i, { donViTinhBuoi: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`${id}-d${i}-cs`}>Cách thể hiện số buổi</Label>
                <select id={`${id}-d${i}-cs`} className={O_CHON} value={d.cachThuSoBuoi} onChange={(e) => suaDong(i, { cachThuSoBuoi: e.target.value as DongNhap["cachThuSoBuoi"] })}>
                  {chonRong(d.cachThuSoBuoi)}
                  {(Object.keys(NHAN_CACH_SO_BUOI) as (keyof typeof NHAN_CACH_SO_BUOI)[]).map((k) => (
                    <option key={k} value={k}>
                      {NHAN_CACH_SO_BUOI[k]}
                    </option>
                  ))}
                </select>
                <Goi>Hoá đơn cũ ghi số buổi ở đâu? Trong tên dòng (ví dụ «Khoá … (12 buổi)») hay ở cột «Số lượng»? Chọn đúng cách đó.</Goi>
              </div>
              <div className="sm:col-span-2 xl:col-span-2">
                <Label htmlFor={`${id}-d${i}-mt`}>Mẫu mô tả số buổi (có {"{n}"} là chỗ điền số buổi)</Label>
                <Input id={`${id}-d${i}-mt`} className="mt-1.5" value={d.mauMoTaSoBuoi} maxLength={60} onChange={(e) => suaDong(i, { mauMoTaSoBuoi: e.target.value })} />
              </div>
              <div className="flex items-end">
                <Button type="button" variant="ghost" size="sm" disabled={n.dong.length <= 1} onClick={() => setN((c) => ({ ...c, dong: c.dong.filter((_, k) => k !== i) }))}>
                  Gỡ dòng {i + 1}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Thêm nhanh dòng cho:</span>
          {LOAI_KHOAN_CHON.filter((l) => !n.dong.some((x) => x.loaiKhoan === l.ma)).map((l) => (
            <Button key={l.ma} type="button" variant="outline" size="sm" disabled={n.dong.length >= 50} onClick={() => setN((c) => ({ ...c, dong: [...c.dong.filter((x) => !(x.loaiKhoan === "" && x.kieuMuc === "")), { ...dongMoi(), loaiKhoan: l.ma }] }))}>
              {l.nhan}
            </Button>
          ))}
          <Button type="button" variant="ghost" size="sm" disabled={n.dong.length >= 50} onClick={() => setN((c) => ({ ...c, dong: [...c.dong, dongMoi()] }))}>
            Thêm dòng trống
          </Button>
        </div>
      </fieldset>

      <fieldset className="flex flex-col" disabled={dangLuu}>
        <legend className="mb-1 text-sm font-semibold">Căn cứ (tuỳ chọn)</legend>
        <p className="mb-2 text-xs text-muted-foreground">Ghi văn bản làm cơ sở cho các dòng trên, do kế toán điền. Hệ thống không kiểm văn bản đúng hay sai — chỉ lưu để người duyệt đọc.</p>
        {n.canCu.length === 0 ? <p className="mb-2 text-sm text-muted-foreground">Chưa ghi căn cứ nào.</p> : null}
        <ul className="flex flex-col divide-y divide-border">
          {n.canCu.map((c, i) => (
            <li key={i} className="grid grid-cols-1 gap-3 py-3 first:pt-0 sm:grid-cols-2 xl:grid-cols-3">
              <div className="sm:col-span-2 xl:col-span-3">
                <Label htmlFor={`${id}-c${i}-vb`}>Tên văn bản</Label>
                <Input id={`${id}-c${i}-vb`} className="mt-1.5" value={c.vanBan} maxLength={200} onChange={(e) => suaCanCu(i, { vanBan: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`${id}-c${i}-dieu`}>Điều</Label>
                <Input id={`${id}-c${i}-dieu`} className="mt-1.5" value={c.dieu} maxLength={60} onChange={(e) => suaCanCu(i, { dieu: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`${id}-c${i}-khoan`}>Khoản</Label>
                <Input id={`${id}-c${i}-khoan`} className="mt-1.5" value={c.khoan} maxLength={60} onChange={(e) => suaCanCu(i, { khoan: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`${id}-c${i}-tc`}>Độ tin cậy của nguồn</Label>
                <select id={`${id}-c${i}-tc`} className={O_CHON} value={c.doTinCay} onChange={(e) => suaCanCu(i, { doTinCay: e.target.value as CanCuNhap["doTinCay"] })}>
                  {chonRong(c.doTinCay)}
                  {CAC_DO_TIN_CAY.map((v) => (
                    <option key={v} value={v}>
                      {NHAN_DO_TIN_CAY[v]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 sm:col-span-2 xl:col-span-3">
                <input id={`${id}-c${i}-ck`} type="checkbox" className="size-4 accent-primary pointer-coarse:size-5" checked={c.canKeToanXacNhan} onChange={(e) => suaCanCu(i, { canKeToanXacNhan: e.target.checked })} />
                <Label htmlFor={`${id}-c${i}-ck`}>Cần kế toán xác nhận trước khi dùng</Label>
              </div>
              <div>
                <Label htmlFor={`${id}-c${i}-kb`}>Người ký duyệt (tự khai, hệ thống chưa xác minh)</Label>
                <Input id={`${id}-c${i}-kb`} className="mt-1.5" value={c.daKyDuyetBoi} maxLength={120} onChange={(e) => suaCanCu(i, { daKyDuyetBoi: e.target.value })} />
              </div>
              <div>
                <Label htmlFor={`${id}-c${i}-kl`}>Ngày ký</Label>
                <Input id={`${id}-c${i}-kl`} type="date" className="mt-1.5" value={c.daKyDuyetLuc} onChange={(e) => suaCanCu(i, { daKyDuyetLuc: e.target.value })} />
              </div>
              <div className="flex items-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => setN((cur) => ({ ...cur, canCu: cur.canCu.filter((_, k) => k !== i) }))}>
                  Gỡ căn cứ {i + 1}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <div>
          <Button type="button" variant="outline" size="sm" disabled={n.canCu.length >= 30} onClick={() => setN((cur) => ({ ...cur, canCu: [...cur.canCu, canCuMoi()] }))}>
            Thêm căn cứ
          </Button>
        </div>
      </fieldset>

      <div>
        <Label htmlFor={`${id}-ld`}>Lý do soạn (ít nhất {toiThieuLyDo} ký tự, ghi vào lịch sử)</Label>
        <Input id={`${id}-ld`} className="mt-1.5" value={n.lyDo} maxLength={500} disabled={dangLuu} placeholder="Ví dụ: Lập chính sách ban đầu theo hoá đơn công ty đã xuất năm 2026" onChange={(e) => set({ lyDo: e.target.value })} />
        <Goi>Viết một câu bạn soạn bản này vì sao — để người xem lịch sử hiểu. Không cần số hiệu văn bản nào.</Goi>
      </div>

      {loi.length > 0 ? (
        <ul role="alert" className="flex list-disc flex-col gap-0.5 pl-5 text-sm text-state-danger-ink">
          {loi.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={dangLuu}>
          {dangLuu ? "Đang lưu…" : "Lưu bản nháp"}
        </Button>
        <Button type="button" variant="outline" disabled={dangLuu} onClick={onHuy}>
          Huỷ
        </Button>
      </div>
    </form>
  );
}
