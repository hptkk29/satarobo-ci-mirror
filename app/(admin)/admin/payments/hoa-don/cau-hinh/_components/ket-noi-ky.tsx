"use client";

// Khu «Kết nối & ký» (hub/13): tài khoản nhà cung cấp và cách ký (HSM / USB token) của từng pháp nhân. [BGĐ 04/11/2026] CHỈ Quản trị tối cao được THAY ĐỔI (`duocSua`);
// kế toán Hội sở chỉ XEM — nên màn không vẽ nút Khai/Sửa/Kiểm tra cho họ (nút chắc chắn bị từ chối là lời hứa suông).
// Luật kiểm nằm ở `lib/finance/hoa-don/ket-noi/luat.ts`; máy chủ kiểm lại. Mật khẩu CHỈ đi vào: ô để trống = giữ mật khẩu đang lưu,
// màn không bao giờ nhận lại mật khẩu (chỉ biết «đã đặt lúc …»). Trạng thái «đang dùng gì» do máy chủ tính bằng chính hàm phát hành dùng.

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import { HelpHint } from "@/components/admin/ui/help-hint";
import { huongDan } from "@/lib/finance/hoa-don/huong-dan";
import { NHAN_CHE_DO_KY, NHAN_PHUONG_THUC_KY, type CanhBaoChungThu, type MucCanhBao } from "@/lib/finance/hoa-don/ket-noi/hien-thi";
import { kiemKetNoi, type DauVaoKetNoi } from "@/lib/finance/hoa-don/ket-noi/luat";
import type { DongKetNoi } from "@/lib/finance/hoa-don/ket-noi/ket-noi-db";
import { TEN_NHA_CUNG_CAP_API, type NhaCungCapApi } from "@/lib/finance/hoa-don/phap-nhan";
import { kiemTraKetNoiAction, luuKetNoiAction } from "../_ket-noi-actions";

export type TheKetNoi = {
  phapNhanMa: string;
  ten: string;
  maSoThue: string;
  /** Nhà cung cấp HIỆU LỰC (dòng đã lưu thắng mặc định trong mã). */
  nhaCungCapMa: NhaCungCapApi | null;
  tenNhaCungCap: string | null;
  trangThai: { nhan: string; muc: MucCanhBao; chiTiet: string };
  ketNoi: DongKetNoi | null;
  canhBaoChungThu: CanhBaoChungThu;
  ketQuaKiemTra: { cau: string; muc: MucCanhBao };
};

type LichSu = { id: string; ketNoiId: string; action: string; luc: string; nguoi: string; lyDo: string | null; truongDoi: string[]; matKhauDoi: boolean };

const TONE: Record<MucCanhBao, PillTone> = { danger: "danger", warning: "warning", success: "success", muted: "muted", info: "info" };
const HANH_DONG: Record<string, string> = { TAO_KET_NOI_NHA_CUNG_CAP: "Thêm", SUA_KET_NOI_NHA_CUNG_CAP: "Sửa", TAT_KET_NOI_NHA_CUNG_CAP: "Tắt", DOI_NHA_CUNG_CAP: "Đổi nhà cung cấp" };
const TEN_TRUONG: Record<string, string> = {
  nhaCungCapMa: "nhà cung cấp",
  dangBat: "bật/tắt",
  baseUrl: "địa chỉ máy chủ",
  mst: "MST",
  tenDangNhap: "tên đăng nhập",
  phuongThucKy: "cách ký",
  cheDoKy: "chế độ ký",
  chungThuSerial: "serial chứng thư",
  chungThuThumbprint: "dấu vân tay chứng thư",
  chungThuChuTheMst: "MST chủ thể chứng thư",
  chungThuNhaPhatHanh: "nhà phát hành chứng thư",
  chungThuHetHan: "hạn chứng thư",
  misaAppId: "AppID MISA",
  misaLoaiHoaDon: "loại hoá đơn MISA",
};
const gio = (iso: string) => new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

type Nhap = {
  /** Nhà cung cấp đang CHỌN trong form (có thể khác nhà cung cấp hiệu lực = ĐỔI nhà cung cấp). */
  nhaCungCapMa: NhaCungCapApi;
  dangBat: boolean;
  phuongThucKy: string;
  cheDoKy: string;
  baseUrl: string;
  mst: string;
  tenDangNhap: string;
  matKhauMoi: string;
  chungThuSerial: string;
  chungThuHetHan: string;
  misaAppId: string;
  misaLoaiHoaDon: string;
  lyDo: string;
};

function nhapTu(t: TheKetNoi): Nhap {
  const k = t.ketNoi;
  return {
    nhaCungCapMa: t.nhaCungCapMa ?? "VIN_HOADON",
    dangBat: k?.dangBat ?? true,
    phuongThucKy: k?.phuongThucKy ?? "USB_TOKEN",
    cheDoKy: k?.cheDoKy === "TUNG_LENH" ? "TUNG_LENH" : "LO",
    baseUrl: k?.baseUrl ?? "",
    mst: k?.mst ?? t.maSoThue,
    tenDangNhap: k?.tenDangNhap ?? "",
    matKhauMoi: "",
    chungThuSerial: k?.chungThuSerial ?? "",
    chungThuHetHan: k?.chungThuHetHan ?? "",
    misaAppId: k?.misaAppId ?? "",
    misaLoaiHoaDon: k?.misaLoaiHoaDon ?? "",
    lyDo: "",
  };
}

export function KetNoiKy({ the, moiTruong, khoaOk, lyDoThieuKhoa, lichSu, duocSua }: { the: TheKetNoi[]; moiTruong: string; khoaOk: boolean; lyDoThieuKhoa: string | null; lichSu: LichSu[]; duocSua: boolean }) {
  const router = useRouter();
  const id = useId();
  const [dangLam, startTransition] = useTransition();
  const [mo, setMo] = useState<string | null>(null);
  const [nhap, setNhap] = useState<Nhap | null>(null);
  const [loi, setLoi] = useState<string | null>(null);

  function moForm(t: TheKetNoi) {
    setLoi(null);
    setMo(t.phapNhanMa);
    setNhap(nhapTu(t));
  }
  function dong() {
    setMo(null);
    setNhap(null);
    setLoi(null);
  }

  function luu(t: TheKetNoi) {
    if (!nhap) return;
    const ncc = nhap.nhaCungCapMa;
    const doiNcc = t.nhaCungCapMa !== null && ncc !== t.nhaCungCapMa;
    const dauVao: DauVaoKetNoi = {
      phapNhanMa: t.phapNhanMa,
      moiTruong,
      nhaCungCapMa: ncc,
      dangBat: nhap.dangBat,
      baseUrl: nhap.baseUrl.trim() || null,
      mst: nhap.mst.trim() || null,
      tenDangNhap: nhap.tenDangNhap.trim() || null,
      misaAppId: ncc === "MISA_MEINVOICE" ? nhap.misaAppId.trim() || null : null,
      misaLoaiHoaDon: ncc === "MISA_MEINVOICE" ? nhap.misaLoaiHoaDon || null : null,
      phuongThucKy: nhap.phuongThucKy,
      cheDoKy: nhap.phuongThucKy === "USB_TOKEN" ? nhap.cheDoKy : "LO",
      chungThuSerial: nhap.chungThuSerial.trim() || null,
      chungThuHetHan: nhap.chungThuHetHan || null,
      matKhauMoi: nhap.matKhauMoi === "" ? null : nhap.matKhauMoi,
      lyDo: nhap.lyDo,
    };
    // Đổi nhà cung cấp ⇒ tài khoản cũ KHÔNG đi theo (máy chủ xoá) — kiểm luật khai đủ như chưa có mật khẩu.
    const l = kiemKetNoi(dauVao, { nhaCungCapCuaPhapNhan: ncc, daCoMatKhau: !doiNcc && Boolean(t.ketNoi?.coMatKhau) });
    if (l.length > 0) return setLoi(l[0]!);
    setLoi(null);
    startTransition(async () => {
      const r = await luuKetNoiAction({ ...dauVao, matKhauMoi: dauVao.matKhauMoi });
      if (!r.ok) return setLoi(r.error);
      toast.success(doiNcc ? `Đã đổi nhà cung cấp sang ${TEN_NHA_CUNG_CAP_API[ncc]} — nhớ bật lại ký cho pháp nhân` : r.data.doiMatKhau ? "Đã lưu kết nối và mật khẩu mới" : "Đã lưu kết nối");
      dong();
      router.refresh();
    });
  }

  function kiemTra(t: TheKetNoi) {
    startTransition(async () => {
      const r = await kiemTraKetNoiAction({ phapNhanMa: t.phapNhanMa });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.data.ma === "OK") toast.success("Đăng nhập được VIN-HOADON");
      else toast.error("Đăng nhập chưa được — xem kết quả trên thẻ");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Máy chủ này đang chạy môi trường <span className="font-medium text-foreground">{moiTruong}</span> — chỉ khai được kết nối của môi trường này. Mật khẩu được mã hoá khi lưu và <b>không bao giờ hiện lại</b>.
      </p>
      {!duocSua ? (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Bạn đang <b>xem</b> cấu hình. Chỉ Quản trị tối cao được đổi nhà cung cấp, cách ký, tài khoản tích hợp, chính sách và hạn mức — cần đổi gì, nhờ Quản trị tối cao.
        </p>
      ) : null}
      {!khoaOk ? (
        <p role="alert" className="rounded-lg border border-[color:var(--state-danger)] bg-[color:var(--state-danger-soft)] px-3 py-2 text-sm text-[color:var(--state-danger)]">
          {lyDoThieuKhoa} Chưa đặt được khoá thì không lưu được mật khẩu mới — nhờ người vận hành đặt biến này rồi tải lại trang.
        </p>
      ) : null}

      {the.map((t) => {
        const dangMo = mo === t.phapNhanMa && nhap !== null;
        const lichSuCua = lichSu.filter((l) => l.ketNoiId === t.ketNoi?.id).slice(0, 5);
        return (
          <section key={t.phapNhanMa} aria-label={t.ten} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{t.ten}</h3>
                <p className="text-xs text-muted-foreground">
                  MST {t.maSoThue} · {t.tenNhaCungCap ? `phát hành qua ${t.tenNhaCungCap}` : "chưa khai phần mềm phát hành"}
                </p>
              </div>
              <span className="flex items-center gap-1.5"><StatusPill tone={TONE[t.trangThai.muc]}>{t.trangThai.nhan}</StatusPill><HelpHint label="Xem hướng dẫn: trạng thái kết nối">{huongDan("trang-thai-ket-noi")}</HelpHint></span>
            </div>
            <p className="text-sm text-muted-foreground">{t.trangThai.chiTiet}</p>

            {t.ketNoi ? (
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div className="flex gap-2"><dt className="text-muted-foreground">Cách ký:</dt><dd>{NHAN_PHUONG_THUC_KY[t.ketNoi.phuongThucKy] ?? t.ketNoi.phuongThucKy}</dd></div>
                {t.ketNoi.phuongThucKy === "USB_TOKEN" ? (
                  <div className="flex gap-2"><dt className="text-muted-foreground">Chế độ:</dt><dd>{NHAN_CHE_DO_KY[t.ketNoi.cheDoKy] ?? t.ketNoi.cheDoKy}</dd></div>
                ) : null}
                {t.nhaCungCapMa === "VIN_HOADON" || t.ketNoi.misaAppId ? (
                  <>
                    <div className="flex gap-2"><dt className="text-muted-foreground">Tài khoản:</dt><dd className="break-all">{t.ketNoi.tenDangNhap ?? "—"}</dd></div>
                    <div className="flex gap-2">
                      <dt className="text-muted-foreground">Mật khẩu:</dt>
                      <dd>{t.ketNoi.coMatKhau ? `đã đặt${t.ketNoi.matKhauCapNhatLuc ? ` lúc ${gio(t.ketNoi.matKhauCapNhatLuc)}` : ""}` : "chưa đặt"}</dd>
                    </div>
                  </>
                ) : null}
                {t.ketNoi.phuongThucKy === "USB_TOKEN" ? (
                  <div className="flex gap-2"><dt className="text-muted-foreground">Chứng thư:</dt><dd className="break-all">{t.ketNoi.chungThuSerial ? `serial ${t.ketNoi.chungThuSerial}` : "chưa chọn (ứng dụng ký sẽ báo về)"}</dd></div>
                ) : null}
              </dl>
            ) : null}
            {t.canhBaoChungThu ? <p className={t.canhBaoChungThu.muc === "success" ? "text-xs text-muted-foreground" : "text-sm font-medium text-[color:var(--state-danger)]"}>{t.canhBaoChungThu.cau}</p> : null}
            {t.nhaCungCapMa === "MISA_MEINVOICE" && t.ketNoi && !t.ketNoi.misaAppId ? (
              <p className="text-xs text-muted-foreground">Tài khoản MISA đang lấy từ biến môi trường của máy chủ (cấu hình cũ). Quản trị tối cao có thể chuyển sang lưu mã hoá theo pháp nhân.</p>
            ) : null}
            {t.nhaCungCapMa === "VIN_HOADON" && t.ketNoi ? (
              <p className="text-xs text-muted-foreground">
                Kiểm tra kết nối gần nhất: <StatusPill tone={TONE[t.ketQuaKiemTra.muc]}>{t.ketQuaKiemTra.cau}</StatusPill>
                {t.ketNoi.kiemTraLuc ? <span className="ml-1">({gio(t.ketNoi.kiemTraLuc)})</span> : null}
              </p>
            ) : null}

            {!duocSua ? null : !dangMo ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => moForm(t)} disabled={dangLam || mo !== null}>
                  {t.ketNoi ? "Sửa kết nối" : "Khai kết nối"}
                </Button>
                {t.nhaCungCapMa === "VIN_HOADON" && t.ketNoi ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => kiemTra(t)} disabled={dangLam || mo !== null}>
                    {dangLam ? "Đang kiểm tra…" : "Kiểm tra kết nối"}
                  </Button>
                ) : null}
              </div>
            ) : (
              <form
                className="flex flex-col gap-3 rounded-lg border border-border p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  luu(t);
                }}
              >
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={nhap.dangBat} disabled={dangLam} onChange={(e) => setNhap({ ...nhap, dangBat: e.target.checked })} />
                  Bật kết nối này <span className="text-muted-foreground">(tắt thì pháp nhân không phát hành được, KHÔNG quay về cấu hình máy chủ)</span>
                </label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <p className="sm:col-span-2 text-sm font-semibold">Nhà cung cấp & cách ký</p>
                  <div className="sm:col-span-2">
                    <div className="flex items-center gap-1.5"><Label htmlFor={`${id}-${t.phapNhanMa}-ncc`}>Nhà cung cấp hoá đơn</Label><HelpHint label="Xem hướng dẫn: nhà cung cấp">{huongDan("nha-cung-cap")}</HelpHint></div>
                    <select
                      id={`${id}-${t.phapNhanMa}-ncc`}
                      className="mt-1.5 h-9 w-full rounded-lg border border-border bg-card px-2.5 text-sm"
                      value={nhap.nhaCungCapMa}
                      disabled={dangLam}
                      onChange={(e) => {
                        const moi = e.target.value as NhaCungCapApi;
                        if (moi === nhap.nhaCungCapMa) return;
                        // Đổi nhà cung cấp: bỏ sạch ô của nhà cung cấp cũ (địa chỉ · tài khoản · mật khẩu · AppID) — KHÔNG mang sang nơi khác. MISA chưa ký USB được.
                        setNhap({
                          ...nhap,
                          nhaCungCapMa: moi,
                          baseUrl: "",
                          tenDangNhap: "",
                          matKhauMoi: "",
                          misaAppId: "",
                          misaLoaiHoaDon: "",
                          phuongThucKy: moi === "MISA_MEINVOICE" && nhap.phuongThucKy === "USB_TOKEN" ? "HSM_NHA_CUNG_CAP" : nhap.phuongThucKy,
                        });
                      }}
                    >
                      {(Object.keys(TEN_NHA_CUNG_CAP_API) as NhaCungCapApi[]).map((ma) => (
                        <option key={ma} value={ma}>
                          {TEN_NHA_CUNG_CAP_API[ma]}
                          {ma === t.nhaCungCapMa ? " (đang dùng)" : ""}
                        </option>
                      ))}
                    </select>
                    {t.nhaCungCapMa !== null && nhap.nhaCungCapMa !== t.nhaCungCapMa ? (
                      <div role="alert" className="mt-2 rounded-lg border border-[color:var(--state-warning)] bg-[color:var(--state-warning-soft)] px-3 py-2 text-sm">
                        <p className="flex items-center gap-1.5 font-medium">Đổi từ {TEN_NHA_CUNG_CAP_API[t.nhaCungCapMa]} sang {TEN_NHA_CUNG_CAP_API[nhap.nhaCungCapMa]}<HelpHint label="Xem hướng dẫn: đổi nhà cung cấp">{huongDan("doi-nha-cung-cap")}</HelpHint></p>
                        <ul className="mt-1 list-disc pl-5 text-xs">
                          <li>Phải <b>tạm dừng ký</b> pháp nhân này trước (khu «Chính sách ký») — máy chủ từ chối nếu chưa dừng.</li>
                          <li>Máy chủ từ chối nếu pháp nhân còn hoá đơn đang phát hành dở / phát hành lỗi hoặc lệnh ký đang chờ — xử lý hết rồi đổi.</li>
                          <li>Tài khoản và mật khẩu của nhà cung cấp cũ bị <b>xoá</b>; phải khai đủ tài khoản của nhà cung cấp mới (hoặc tắt kết nối).</li>
                          <li>Ký hiệu / mẫu hoá đơn thường phải đăng ký lại với nhà cung cấp mới — việc ngoài hệ thống này.</li>
                        </ul>
                      </div>
                    ) : null}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5"><Label htmlFor={`${id}-${t.phapNhanMa}-pt`}>Cách ký</Label><HelpHint label="Xem hướng dẫn: cách ký">{huongDan("phuong-thuc-ky")}</HelpHint></div>
                    <select
                      id={`${id}-${t.phapNhanMa}-pt`}
                      className="mt-1.5 h-9 w-full rounded-lg border border-border bg-card px-2.5 text-sm"
                      value={nhap.phuongThucKy}
                      disabled={dangLam}
                      onChange={(e) => setNhap({ ...nhap, phuongThucKy: e.target.value })}
                    >
                      {Object.entries(NHAN_PHUONG_THUC_KY).map(([ma, nhan]) => (
                        <option key={ma} value={ma} disabled={ma === "USB_TOKEN" && nhap.nhaCungCapMa === "MISA_MEINVOICE"}>
                          {nhan}
                          {ma === "USB_TOKEN" && nhap.nhaCungCapMa === "MISA_MEINVOICE" ? " — chưa hỗ trợ với MISA" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  {nhap.phuongThucKy === "USB_TOKEN" ? (
                    <div>
                      <div className="flex items-center gap-1.5"><Label htmlFor={`${id}-${t.phapNhanMa}-cd`}>Chế độ ký</Label><HelpHint label="Xem hướng dẫn: chế độ ký">{huongDan("che-do-ky")}</HelpHint></div>
                      <select
                        id={`${id}-${t.phapNhanMa}-cd`}
                        className="mt-1.5 h-9 w-full rounded-lg border border-border bg-card px-2.5 text-sm"
                        value={nhap.cheDoKy}
                        disabled={dangLam}
                        onChange={(e) => setNhap({ ...nhap, cheDoKy: e.target.value })}
                      >
                        {Object.entries(NHAN_CHE_DO_KY).map(([ma, nhan]) => (
                          <option key={ma} value={ma}>
                            {nhan}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-muted-foreground">USB cần người cắm token và nhập PIN, nên hệ thống không tự ký ngầm.</p>
                    </div>
                  ) : null}
                  {nhap.nhaCungCapMa === "MISA_MEINVOICE" ? (
                    <p className="text-sm text-muted-foreground sm:col-span-2">
                      Tài khoản MISA lưu <b>mã hoá theo pháp nhân</b>. Để trống cả khối này = tiếp tục dùng tài khoản trong biến môi trường của máy chủ (cấu hình cũ, không đổi gì). Đã khai một phần thì phải khai đủ.
                    </p>
                  ) : null}
                  {nhap.nhaCungCapMa === "VIN_HOADON" || nhap.nhaCungCapMa === "MISA_MEINVOICE" ? (
                    <>
                      <p className="sm:col-span-2 text-sm font-semibold border-t border-border pt-3">Tài khoản đăng nhập</p>
                  <div className="sm:col-span-2">
                        <Label htmlFor={`${id}-${t.phapNhanMa}-url`}>{nhap.nhaCungCapMa === "MISA_MEINVOICE" ? "Địa chỉ API MISA (https, kết thúc /api/v3)" : "Địa chỉ máy chủ VIN (https)"}</Label>
                        <Input id={`${id}-${t.phapNhanMa}-url`} className="mt-1.5" value={nhap.baseUrl} maxLength={300} placeholder={nhap.nhaCungCapMa === "MISA_MEINVOICE" ? "https://api.meinvoice.vn/api/v3" : "https://… do VIN cấp"} autoComplete="off" disabled={dangLam} onChange={(e) => setNhap({ ...nhap, baseUrl: e.target.value })} />
                      </div>
                      <div>
                        <Label htmlFor={`${id}-${t.phapNhanMa}-mst`}>{nhap.nhaCungCapMa === "MISA_MEINVOICE" ? "MST người bán (khoá cổng: chỉ phát hành cho MST này)" : "MST đăng nhập VIN"}</Label>
                        <Input id={`${id}-${t.phapNhanMa}-mst`} className="mt-1.5 tabular-nums" value={nhap.mst} maxLength={14} placeholder="10 số, hoặc 10 số-3 số" autoComplete="off" disabled={dangLam} onChange={(e) => setNhap({ ...nhap, mst: e.target.value })} />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5"><Label htmlFor={`${id}-${t.phapNhanMa}-tk`}>Tên đăng nhập</Label><HelpHint label="Xem hướng dẫn: tài khoản nhà cung cấp">{huongDan("tai-khoan-nha-cung-cap")}</HelpHint></div>
                        <Input id={`${id}-${t.phapNhanMa}-tk`} className="mt-1.5" value={nhap.tenDangNhap} maxLength={100} autoComplete="off" disabled={dangLam} onChange={(e) => setNhap({ ...nhap, tenDangNhap: e.target.value })} />
                      </div>
                      {nhap.nhaCungCapMa === "MISA_MEINVOICE" ? (
                        <>
                          <div>
                            <div className="flex items-center gap-1.5"><Label htmlFor={`${id}-${t.phapNhanMa}-app`}>AppID MISA</Label><HelpHint label="Xem hướng dẫn: AppID MISA">{huongDan("misa-app-id")}</HelpHint></div>
                            <Input id={`${id}-${t.phapNhanMa}-app`} className="mt-1.5" value={nhap.misaAppId} maxLength={100} autoComplete="off" disabled={dangLam} onChange={(e) => setNhap({ ...nhap, misaAppId: e.target.value })} />
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5"><Label htmlFor={`${id}-${t.phapNhanMa}-loai`}>Loại hoá đơn MISA</Label><HelpHint label="Xem hướng dẫn: loại hoá đơn MISA">{huongDan("misa-app-id")}</HelpHint></div>
                            <select id={`${id}-${t.phapNhanMa}-loai`} className="mt-1.5 h-9 w-full rounded-lg border border-border bg-card px-2.5 text-sm" value={nhap.misaLoaiHoaDon} disabled={dangLam} onChange={(e) => setNhap({ ...nhap, misaLoaiHoaDon: e.target.value })}>
                              <option value="">— chọn —</option>
                              <option value="co-ma">Có mã của cơ quan thuế</option>
                              <option value="khong-ma">Không có mã</option>
                            </select>
                          </div>
                        </>
                      ) : null}
                      <div className="sm:col-span-2">
                        <Label htmlFor={`${id}-${t.phapNhanMa}-mk`}>{nhap.nhaCungCapMa === "MISA_MEINVOICE" ? "Mật khẩu MISA" : "Mật khẩu VIN"}</Label>
                        <Input
                          id={`${id}-${t.phapNhanMa}-mk`}
                          type="password"
                          className="mt-1.5"
                          value={nhap.matKhauMoi}
                          maxLength={200}
                          autoComplete="new-password"
                          disabled={dangLam || !khoaOk}
                          placeholder={t.ketNoi?.coMatKhau ? "Để trống = giữ mật khẩu đang lưu" : "Nhập mật khẩu"}
                          onChange={(e) => setNhap({ ...nhap, matKhauMoi: e.target.value })}
                        />
                        <p className="mt-1 text-xs text-muted-foreground">Đổi địa chỉ, MST hoặc tên đăng nhập thì phải nhập lại mật khẩu.</p>
                      </div>
                    </>
                  ) : null}
                  {nhap.phuongThucKy === "USB_TOKEN" ? (
                    <>
                      <p className="sm:col-span-2 flex items-center gap-1.5 border-t border-border pt-3 text-sm font-semibold">Chứng thư số (USB token)<HelpHint label="Xem hướng dẫn: USB token">{huongDan("usb-token")}</HelpHint></p>
                  <div>
                        <div className="flex items-center gap-1.5"><Label htmlFor={`${id}-${t.phapNhanMa}-sr`}>Serial chứng thư (bắt buộc để ký)</Label><HelpHint label="Xem hướng dẫn: serial chứng thư">{huongDan("serial-chung-thu")}</HelpHint></div>
                        <Input id={`${id}-${t.phapNhanMa}-sr`} className="mt-1.5 font-mono" value={nhap.chungThuSerial} maxLength={64} autoComplete="off" disabled={dangLam} onChange={(e) => setNhap({ ...nhap, chungThuSerial: e.target.value })} />
                      </div>
                      <div>
                        <Label htmlFor={`${id}-${t.phapNhanMa}-hh`}>Chứng thư hết hạn ngày</Label>
                        <Input id={`${id}-${t.phapNhanMa}-hh`} type="date" className="mt-1.5" value={nhap.chungThuHetHan} disabled={dangLam} onChange={(e) => setNhap({ ...nhap, chungThuHetHan: e.target.value })} />
                      </div>
                      <p className="text-xs text-muted-foreground sm:col-span-2">Chỉ thông tin công khai của chứng thư. PIN và khoá riêng nằm trong USB token, không bao giờ vào hệ thống này.</p>
                    </>
                  ) : null}
                  <p className="sm:col-span-2 text-sm font-semibold border-t border-border pt-3">Xác nhận thay đổi</p>
                  <div className="sm:col-span-2">
                    <Label htmlFor={`${id}-${t.phapNhanMa}-ld`}>Lý do thay đổi (bắt buộc, tối thiểu 10 ký tự, ghi vào lịch sử)</Label>
                    <Input id={`${id}-${t.phapNhanMa}-ld`} className="mt-1.5" value={nhap.lyDo} maxLength={300} disabled={dangLam} onChange={(e) => setNhap({ ...nhap, lyDo: e.target.value })} />
                  </div>
                </div>
                {loi ? (
                  <p role="alert" className="text-sm text-state-danger-ink">
                    {loi}
                  </p>
                ) : null}
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={dangLam}>
                    {dangLam ? "Đang lưu…" : "Lưu"}
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={dangLam} onClick={dong}>
                    Huỷ
                  </Button>
                </div>
              </form>
            )}

            {lichSuCua.length > 0 ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">Lịch sử thay đổi ({lichSuCua.length} gần nhất)</summary>
                <ul className="mt-2 flex flex-col divide-y divide-border rounded-lg border border-border">
                  {lichSuCua.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
                      <span className="font-medium">{HANH_DONG[l.action] ?? l.action}</span>
                      <span className="tabular-nums text-muted-foreground">{gio(l.luc)}</span>
                      <span className="text-muted-foreground">{l.nguoi}</span>
                      <span className="w-full text-xs text-muted-foreground">
                        Đổi: {[...l.truongDoi.map((x) => TEN_TRUONG[x] ?? x), ...(l.matKhauDoi ? ["mật khẩu"] : [])].join(", ") || "—"}
                        {l.lyDo ? ` · Lý do: ${l.lyDo}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
