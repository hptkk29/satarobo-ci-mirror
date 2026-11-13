"use client";

// Khu «Chính sách ký» (BGĐ 04/11/2026): tạm dừng ký khẩn cấp + hạn mức ký TỰ ĐỘNG theo pháp nhân.
// Chỉ Quản trị tối cao có nút thay đổi (`duocSua`); người khác chỉ thấy trạng thái — nên màn không vẽ nút mà máy chủ chắc chắn từ chối.
// Luật kiểm ở `lib/finance/hoa-don/ky-chinh-sach/luat.ts` (máy chủ kiểm lại). Bật lại sau dừng vì SỰ CỐ BẢO MẬT cần ô xác nhận riêng.

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { HelpHint } from "@/components/admin/ui/help-hint";
import { huongDan } from "@/lib/finance/hoa-don/huong-dan";
import type { ChinhSachKyDaDoc, DongLichSuChinhSach } from "@/lib/finance/hoa-don/ky-chinh-sach/ky-chinh-sach-db";
import { kiemBatLai, kiemChinhSach, kiemTamDung, phanTichThayDoiHanMuc, TOI_THIEU_LY_DO_KY, trangThaiKyTuDong, type HanMucKy, type SuDungHanMuc } from "@/lib/finance/hoa-don/ky-chinh-sach/luat";
import { batLaiKyAction, luuHanMucKyAction, tamDungKyAction } from "../_ky-chinh-sach-actions";

/** `suDung`: hạn mức đã dùng (cùng hàm `docSuDungHanMuc` với cổng giữ chỗ); `null` khi chưa khai cửa sổ hoặc người xem không có quyền xem hạn mức. */
export type TheChinhSach = { phapNhanMa: string; ten: string; chinhSach: ChinhSachKyDaDoc | null; suDung?: SuDungHanMuc | null };

const HANH_DONG: Record<string, string> = { TAM_DUNG_KY: "Tạm dừng ký", BAT_LAI_KY: "Bật lại ký", TAO_HAN_MUC_KY: "Khai hạn mức", SUA_HAN_MUC_KY: "Sửa hạn mức" };
const TEN_TRUONG: Record<string, string> = {
  hanMucMoiHoaDon: "tối đa mỗi hoá đơn",
  hanMucMoiNgay: "tối đa mỗi ngày",
  soToiDa: "số hoá đơn tối đa",
  cuaSoPhut: "cửa sổ (phút)",
  nguongTanSuat: "ngưỡng cảnh báo tần suất",
  tamDung: "tạm dừng",
  suCo: "sự cố bảo mật",
  xacNhanSuCo: "đã xác nhận sự cố được xử lý",
};
const gio = (iso: string) => new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
const vnd = (n: number | null) => (n === null ? "chưa khai" : `${n.toLocaleString("vi-VN")}đ`);
const so = (n: number | null) => (n === null ? "chưa khai" : n.toLocaleString("vi-VN"));
const hienGiaTri = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "boolean" ? (v ? "có" : "không") : String(v));
const soTu = (s: string): number | null => (s.trim() === "" ? null : Number(s.replace(/[.,\s]/g, "")));
const conLai = (tran: number, dung: number) => Math.max(0, tran - dung);
const hienTruong = (truong: string, v: number | null) => (v === null ? "chưa khai" : truong === "hanMucMoiHoaDon" || truong === "hanMucMoiNgay" ? `${v.toLocaleString("vi-VN")}đ` : v.toLocaleString("vi-VN"));

type Che = "dung" | "bat" | "han" | null;

export function KyChinhSach({ the, lichSu, duocSua, xemHanMuc }: { the: TheChinhSach[]; lichSu: DongLichSuChinhSach[]; duocSua: boolean; xemHanMuc: boolean }) {
  const router = useRouter();
  const id = useId();
  const [dangLam, startTransition] = useTransition();
  const [mo, setMo] = useState<{ pn: string; che: Che } | null>(null);
  const [lyDo, setLyDo] = useState("");
  const [suCo, setSuCo] = useState(false);
  const [xacNhan, setXacNhan] = useState(false);
  const [han, setHan] = useState({ moiHoaDon: "", moiNgay: "", soToiDa: "", cuaSo: "", tanSuat: "" });
  // Hạn mức đi HAI bước: nhập → xem lại cũ/mới (+ ô xác nhận khi NỚI) → lưu. Máy chủ ép lại điều kiện xác nhận, màn chỉ giúp người dùng thấy trước.
  const [buocXem, setBuocXem] = useState(false);
  const [xacNhanNoiLong, setXacNhanNoiLong] = useState(false);
  const [maChiDao, setMaChiDao] = useState("");
  const [loi, setLoi] = useState<string | null>(null);

  function dong() {
    setMo(null);
    setLyDo("");
    setSuCo(false);
    setXacNhan(false);
    setBuocXem(false);
    setXacNhanNoiLong(false);
    setMaChiDao("");
    setLoi(null);
  }
  function moForm(t: TheChinhSach, che: Che) {
    dong();
    const c = t.chinhSach;
    if (che === "han") setHan({ moiHoaDon: c?.hanMucMoiHoaDon?.toString() ?? "", moiNgay: c?.hanMucMoiNgay?.toString() ?? "", soToiDa: c?.soToiDa?.toString() ?? "", cuaSo: c?.cuaSoPhut?.toString() ?? "", tanSuat: c?.nguongTanSuat?.toString() ?? "" });
    setMo({ pn: t.phapNhanMa, che });
  }
  function chay(viec: () => Promise<{ ok: true } | { ok: false; error: string }>, thanhCong: string) {
    startTransition(async () => {
      const r = await viec();
      if (!r.ok) return setLoi(r.error);
      toast.success(thanhCong);
      dong();
      router.refresh();
    });
  }

  function tamDung(t: TheChinhSach) {
    const l = kiemTamDung(lyDo);
    if (l.length > 0) return setLoi(l[0]!);
    setLoi(null);
    chay(() => tamDungKyAction({ phapNhanMa: t.phapNhanMa, lyDo, suCo }), "Đã tạm dừng ký — việc gửi mới của pháp nhân này bị chặn");
  }
  function batLai(t: TheChinhSach) {
    const l = kiemBatLai({ hienTai: t.chinhSach ? { tamDung: t.chinhSach.tamDung, tamDungSuCo: t.chinhSach.tamDungSuCo } : null, xacNhanSuCo: xacNhan, lyDo });
    if (l.length > 0) return setLoi(l[0]!);
    setLoi(null);
    chay(() => batLaiKyAction({ phapNhanMa: t.phapNhanMa, lyDo, xacNhanSuCo: xacNhan }), "Đã bật lại ký");
  }
  const duHan = (): HanMucKy => ({ hanMucMoiHoaDon: soTu(han.moiHoaDon), hanMucMoiNgay: soTu(han.moiNgay), soToiDa: soTu(han.soToiDa), cuaSoPhut: soTu(han.cuaSo), nguongTanSuat: soTu(han.tanSuat) });
  const hanHienTai = (t: TheChinhSach): HanMucKy | null => {
    const c = t.chinhSach;
    return c ? { hanMucMoiHoaDon: c.hanMucMoiHoaDon, hanMucMoiNgay: c.hanMucMoiNgay, soToiDa: c.soToiDa, cuaSoPhut: c.cuaSoPhut, nguongTanSuat: c.nguongTanSuat } : null;
  };
  function luuHan(t: TheChinhSach) {
    const du = duHan();
    const l = kiemChinhSach({ ...du, lyDo });
    if (l.length > 0) return setLoi(l[0]!);
    const pt = phanTichThayDoiHanMuc(hanHienTai(t), du);
    if (!buocXem) {
      if (pt.dong.length === 0) return setLoi("Không có giá trị nào thay đổi so với hạn mức hiện tại.");
      setLoi(null);
      return setBuocXem(true);
    }
    if (pt.noiLong && !xacNhanNoiLong) return setLoi("Thay đổi này NỚI hạn mức ký tự động — tick xác nhận bên dưới trước khi lưu.");
    setLoi(null);
    chay(() => luuHanMucKyAction({ phapNhanMa: t.phapNhanMa, ...du, lyDo, xacNhanNoiLong: pt.noiLong ? xacNhanNoiLong : undefined, maChiDao: maChiDao.trim() === "" ? null : maChiDao }), "Đã lưu hạn mức — có hiệu lực ngay cho lượt ký tự động kế tiếp");
  }

  return (
    <div className="flex flex-col gap-4">
      {the.map((t) => {
        const c = t.chinhSach;
        const dangDung = c?.tamDung === true;
        const dangMo = mo?.pn === t.phapNhanMa ? mo.che : null;
        const lichSuCua = lichSu.filter((l) => l.phapNhanMa === t.phapNhanMa).slice(0, 8);
        return (
          <section key={t.phapNhanMa} aria-label={`Chính sách ký — ${t.ten}`} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="min-w-0 text-sm font-semibold">{t.ten}</h3>
              <span className="flex items-center gap-1.5"><StatusPill tone={dangDung ? "danger" : "success"}>{dangDung ? (c?.tamDungSuCo ? "TẠM DỪNG — sự cố bảo mật" : "TẠM DỪNG KÝ") : "Đang ký bình thường"}</StatusPill><HelpHint label="Xem hướng dẫn: tạm dừng ký">{huongDan("tam-dung-ky")}</HelpHint></span>
            </div>
            {dangDung && c ? (
              <p className="text-sm text-[color:var(--state-danger)]">
                Dừng lúc {c.tamDungLuc ? gio(c.tamDungLuc) : "—"}. Lý do: {c.tamDungLyDo ?? "—"}
              </p>
            ) : null}
            {xemHanMuc ? (
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div className="flex flex-wrap gap-2"><dt className="text-muted-foreground">Tối đa mỗi hoá đơn:</dt><dd className="tabular-nums">{vnd(c?.hanMucMoiHoaDon ?? null)}</dd></div>
                <div className="flex flex-wrap gap-2"><dt className="text-muted-foreground">Tối đa mỗi ngày:</dt><dd className="tabular-nums">{vnd(c?.hanMucMoiNgay ?? null)}</dd></div>
                <div className="flex flex-wrap gap-2"><dt className="text-muted-foreground">Số hoá đơn:</dt><dd className="tabular-nums">{c?.soToiDa != null && c.cuaSoPhut != null ? `${so(c.soToiDa)} / ${so(c.cuaSoPhut)} phút` : "chưa khai"}</dd></div>
                <div className="flex flex-wrap gap-2"><dt className="flex items-center gap-1 text-muted-foreground">Cảnh báo tần suất từ:<HelpHint label="Xem hướng dẫn: mốc báo sớm">{huongDan("moc-bao-som")}</HelpHint></dt><dd className="tabular-nums">{c?.nguongTanSuat != null ? `${so(c.nguongTanSuat)} hoá đơn` : "không đặt"}</dd></div>
              </dl>
            ) : null}
            {xemHanMuc ? (
              <div className="flex flex-col gap-1 text-sm">
                <p className="flex flex-wrap items-center gap-x-1.5">
                  <span className="text-muted-foreground">Ký HSM tự động</span>
                  <HelpHint label="Xem hướng dẫn: ký HSM">{huongDan("hsm")}</HelpHint>
                  <span className="text-muted-foreground">:</span>
                  <b>{trangThaiKyTuDong(c ? { ...c } : null).nhan}</b>
                  <HelpHint label="Xem hướng dẫn: hạn mức ký tự động">{huongDan("han-muc-ky")}</HelpHint>
                </p>
                {c && c.cuaSoPhut !== null && c.hanMucMoiNgay !== null && c.soToiDa !== null && t.suDung ? (
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2" aria-label={`Hạn mức đã dùng — ${t.ten}`}>
                    <div className="flex flex-wrap gap-x-2"><dt className="text-muted-foreground">Hôm nay (giờ Việt Nam, từ 00:00):</dt><dd className="tabular-nums">{vnd(t.suDung.tongNgay)} / {vnd(c.hanMucMoiNgay)} — còn {vnd(conLai(c.hanMucMoiNgay, t.suDung.tongNgay))}</dd></div>
                    <div className="flex flex-wrap gap-x-2"><dt className="text-muted-foreground">{so(c.cuaSoPhut)} phút gần nhất:</dt><dd className="tabular-nums">{so(t.suDung.soTrongCuaSo)} / {so(c.soToiDa)} hoá đơn — còn {so(conLai(c.soToiDa, t.suDung.soTrongCuaSo))}</dd></div>
                  </dl>
                ) : null}
                {lichSuCua[0] ? (
                  <p className="text-xs text-muted-foreground">Thay đổi gần nhất: {HANH_DONG[lichSuCua[0].action] ?? lichSuCua[0].action} — {lichSuCua[0].nguoi}, {gio(lichSuCua[0].luc)}</p>
                ) : null}
              </div>
            ) : null}
            {!duocSua ? null : dangMo === null ? (
              <div className="flex flex-wrap gap-2">
                {dangDung ? (
                  <Button type="button" size="sm" onClick={() => moForm(t, "bat")} disabled={dangLam || mo !== null}>Bật lại ký…</Button>
                ) : (
                  <Button type="button" size="sm" variant="outline" className="border-[color:var(--state-danger)] text-[color:var(--state-danger-ink)] hover:bg-[color:var(--state-danger-soft)]" onClick={() => moForm(t, "dung")} disabled={dangLam || mo !== null}>Tạm dừng ký…</Button>
                )}
                <Button type="button" size="sm" variant="outline" onClick={() => moForm(t, "han")} disabled={dangLam || mo !== null}>Khai / sửa hạn mức</Button>
              </div>
            ) : (
              <form
                className="flex flex-col gap-3 rounded-lg border border-border p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (dangMo === "dung") tamDung(t);
                  else if (dangMo === "bat") batLai(t);
                  else luuHan(t);
                }}
              >
                {dangMo === "dung" ? (
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1" checked={suCo} disabled={dangLam} onChange={(e) => setSuCo(e.target.checked)} />
                    Đây là sự cố bảo mật (nghi lộ khoá / tài khoản, hoá đơn lạ…) — bật lại sau này sẽ đòi xác nhận riêng.
                  </label>
                ) : null}
                {dangMo === "bat" && c?.tamDungSuCo ? (
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1" checked={xacNhan} disabled={dangLam} onChange={(e) => setXacNhan(e.target.checked)} />
                    Tôi xác nhận sự cố bảo mật đã được kiểm tra và xử lý (khoá / tài khoản / chứng thư đã đổi hoặc đã rà soát) trước khi bật lại.
                  </label>
                ) : null}
                {dangMo === "han" && buocXem ? (
                  <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm" aria-label="Xem lại thay đổi hạn mức">
                    <p className="font-medium">Xem lại — giá trị cũ → mới</p>
                    <ul className="flex flex-col gap-1">
                      {phanTichThayDoiHanMuc(hanHienTai(t), duHan()).dong.map((d) => (
                        <li key={d.truong} className="tabular-nums">{d.nhan}: {hienTruong(d.truong, d.truoc)} → <b>{hienTruong(d.truong, d.sau)}</b></li>
                      ))}
                    </ul>
                    {phanTichThayDoiHanMuc(hanHienTai(t), duHan()).noiLong ? (
                      <>
                        <ul className="list-disc pl-5 text-state-danger-ink">
                          {phanTichThayDoiHanMuc(hanHienTai(t), duHan()).lyDoNoiLong.map((x) => <li key={x}>{x}</li>)}
                        </ul>
                        <label className="flex items-start gap-2">
                          <input type="checkbox" className="mt-1" checked={xacNhanNoiLong} disabled={dangLam} onChange={(e) => setXacNhanNoiLong(e.target.checked)} />
                          Tôi xác nhận NỚI hạn mức ký tự động theo quyết định của Ban Giám đốc.
                        </label>
                      </>
                    ) : null}
                    <div>
                      <Label htmlFor={`${id}-${t.phapNhanMa}-cd`}>Mã / ghi chú chỉ đạo của Ban Giám đốc (tuỳ chọn, ghi vào lịch sử)</Label>
                      <Input id={`${id}-${t.phapNhanMa}-cd`} className="mt-1.5" value={maChiDao} maxLength={120} disabled={dangLam} autoComplete="off" onChange={(e) => setMaChiDao(e.target.value)} />
                    </div>
                  </div>
                ) : null}
                {dangMo === "han" && !buocXem ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {([
                      ["moiHoaDon", "Tối đa mỗi hoá đơn (VND)"],
                      ["moiNgay", "Tối đa mỗi ngày (VND)"],
                      ["soToiDa", "Số hoá đơn tối đa"],
                      ["cuaSo", "…trong bao nhiêu phút (1–1440)"],
                      ["tanSuat", "Cảnh báo khi đạt số hoá đơn (tuỳ chọn)"],
                    ] as const).map(([k, nhan]) => (
                      <div key={k}>
                        <Label htmlFor={`${id}-${t.phapNhanMa}-${k}`}>{nhan}</Label>
                        <Input id={`${id}-${t.phapNhanMa}-${k}`} inputMode="numeric" className="mt-1.5 tabular-nums" value={han[k]} disabled={dangLam} autoComplete="off" onChange={(e) => setHan({ ...han, [k]: e.target.value })} />
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground sm:col-span-2">Hệ thống không có hạn mức mặc định: giá trị do Ban Giám đốc quyết theo nhu cầu kinh doanh, Quản trị tối cao cấu hình khi vận hành. Để trống = chưa khai (không tự ký). Có hiệu lực ngay sau khi lưu, không cần triển khai lại.</p>
                  </div>
                ) : null}
                <div>
                  <Label htmlFor={`${id}-${t.phapNhanMa}-ld`}>Lý do (bắt buộc, tối thiểu {TOI_THIEU_LY_DO_KY} ký tự, ghi vào lịch sử)</Label>
                  <Input id={`${id}-${t.phapNhanMa}-ld`} className="mt-1.5" value={lyDo} maxLength={500} disabled={dangLam || (dangMo === "han" && buocXem)} onChange={(e) => setLyDo(e.target.value)} />
                </div>
                {loi ? <p role="alert" className="text-sm text-state-danger-ink">{loi}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" size="sm" variant={dangMo === "dung" ? "destructive" : "default"} className={dangMo === "dung" ? "text-white" : undefined} disabled={dangLam}>
                    {dangLam ? "Đang lưu…" : dangMo === "dung" ? "Tạm dừng ký" : dangMo === "bat" ? "Bật lại ký" : buocXem ? "Xác nhận và lưu hạn mức" : "Xem lại thay đổi"}
                  </Button>
                  {dangMo === "han" && buocXem ? <Button type="button" size="sm" variant="outline" disabled={dangLam} onClick={() => { setBuocXem(false); setXacNhanNoiLong(false); setLoi(null); }}>Quay lại sửa</Button> : null}
                  <Button type="button" size="sm" variant="outline" disabled={dangLam} onClick={dong}>Huỷ</Button>
                </div>
              </form>
            )}

            {lichSuCua.length > 0 ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">Lịch sử chính sách ({lichSuCua.length} gần nhất)</summary>
                <ul className="mt-2 flex flex-col divide-y divide-border rounded-lg border border-border">
                  {lichSuCua.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
                      <span className="font-medium">{HANH_DONG[l.action] ?? l.action}</span>
                      <span className="tabular-nums text-muted-foreground">{gio(l.luc)}</span>
                      <span className="text-muted-foreground">{l.nguoi}</span>
                      <span className="w-full text-xs text-muted-foreground">
                        {l.truocSau.map((x) => `${TEN_TRUONG[x.truong] ?? x.truong}: ${hienGiaTri(x.truoc)} → ${hienGiaTri(x.sau)}`).join(" · ") || "—"}
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
