"use client";

// «Xem trước» tờ hoá đơn (kế toán 24/11/2026): hộp bày ĐÚNG những gì sẽ ghi vào hoá đơn, kế toán chọn người mua (ba/mẹ hoặc con) rồi bấm «Phát hành».
//
// ⚠️ Mọi con số / chữ trong hộp đến từ `xemTruocHoaDonAction` — tờ dựng bằng chính máy phát hành (`dungPhieuNhap`), KHÔNG tự suy ở đây (luật 12). «Phát hành» gửi kèm lựa chọn + dấu của tờ
// ĐÃ XEM (`phieuDaThay`): máy chủ dựng lại dưới khoá rồi so, lệch ⇒ từ chối. Cảnh báo «hoá đơn THẬT, không xoá được» luôn hiện (không giấu sau dấu «?»): bấm nhầm là phải lập biên bản huỷ.

import { useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HelpHint } from "@/components/admin/ui/help-hint";
import { cn } from "@/lib/utils";
import { laPhuongAnDuoc, type KetQuaXemTruoc, type PhuongAnXemTruoc } from "@/lib/finance/hoa-don/xem-truoc-kieu";
import type { QuyetNguoiMua } from "@/lib/finance/hoa-don/nguoi-mua-theo-con";
import type { KetQuaGuiNhap } from "@/lib/finance/hoa-don/gui-nhap-vin";
import { guiNhapHoaDonVinAction, phatHanhQuaMisaAction, xemTruocHoaDonAction, type KetQuaNhan } from "../_actions";

const tien = (n: number) => `${n.toLocaleString("vi-VN")}đ`;
const ngayVn = (iso: string) => iso.split("-").reverse().join("/");

type MoiTruong = "sandbox" | "production" | "gia-lap";

const TEN_BEN: Record<QuyetNguoiMua, string> = { PHU_HUYNH: "Ba / mẹ", CON: "Con (học viên)" };

function Dong({ nhan, children }: { nhan: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{nhan}</dt>
      <dd className="min-w-0 text-foreground [overflow-wrap:anywhere]">{children}</dd>
    </>
  );
}

const trong = <span className="text-muted-foreground">—</span>;

/** Kết quả «Gửi nháp»: nói rõ ĐÃ lưu nháp hay chưa, nhà cung cấp trả gì, và dữ liệu đã gửi để kế toán đối chiếu. Kể cả khi bị từ chối cũng hiện (đó chính là điều cần biết). Chữ trên màn KHÔNG nêu tên nhà cung cấp (chủ dự án 09/11/2026). */
function KetQuaNhapVin({ kq }: { kq: KetQuaGuiNhap & { nhan?: KetQuaNhan | null } }) {
  const tt = kq.tomTat;
  return (
    <div
      role="status"
      className={
        kq.ok
          ? "flex flex-col gap-2 rounded-lg bg-state-success-soft px-3.5 py-2.5 text-sm text-state-success-ink"
          : "flex flex-col gap-2 rounded-lg bg-state-warning-soft px-3.5 py-2.5 text-sm text-state-warning-ink"
      }
    >
      {kq.ok ? (
        <p className="flex items-start gap-2 font-medium">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>Nhà cung cấp hoá đơn đã nhận bản nháp (chưa ký, chưa có số hoá đơn). Mã giao dịch: <span className="tabular-nums">{kq.maGiaoDich}</span></span>
        </p>
      ) : (
        <p className="flex items-start gap-2 font-medium">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{kq.daGui ? "Nhà cung cấp chưa nhận bản nháp" : "Chưa gửi nháp"} — {kq.thongDiep}</span>
        </p>
      )}
      {tt ? (
        <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-foreground">
          <dt className="text-muted-foreground">Đã gửi: người mua</dt>
          <dd className="min-w-0 [overflow-wrap:anywhere]">{tt.nguoiMuaTen || "—"}{tt.nguoiMuaMst ? ` · MST ${tt.nguoiMuaMst}` : ""}</dd>
          <dt className="text-muted-foreground">Ký hiệu · MST bán</dt>
          <dd className="tabular-nums">{tt.kyHieu} · {tt.mstNguoiBan}</dd>
          <dt className="text-muted-foreground">Tổng tiền</dt>
          <dd className="font-semibold tabular-nums">{tien(tt.tongThanhToan)} ({tt.soDong} dòng)</dd>
          {kq.refId ? (
            <>
              <dt className="text-muted-foreground">Mã nháp</dt>
              <dd className="min-w-0 break-all text-xs tabular-nums">{kq.refId}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {kq.ok ? <p className="text-xs text-muted-foreground">Vào trang quản trị của nhà cung cấp hoá đơn, tìm theo mã nháp ở trên để đối chiếu, rồi <b>xoá bản nháp</b> sau khi xem. Nếu nhà cung cấp ký sau, bấm «Kiểm tra đã ký chưa» ở ngăn lần thu để lấy hoá đơn về.</p> : null}
      {kq.nhan?.loai === "LOI" ? (
        <p role="alert" className="rounded-md bg-state-danger-soft px-2.5 py-1.5 font-medium text-state-danger-ink">
          {kq.nhan.thongDiep}
        </p>
      ) : null}
    </div>
  );
}

export function XemTruocHoaDon({
  dong,
  tenNcc,
  moiTruong,
  cauMoiTruong,
  bat,
  choPhepNhap,
  onPhatHanh,
}: {
  dong: { orderId: string; key: string; soTien: number };
  tenNcc: string;
  moiTruong: MoiTruong;
  /** Câu cảnh báo theo môi trường (hoá đơn THẬT / thử / mô phỏng) — cố ý HIỆN, không để sau dấu «?». */
  cauMoiTruong: string;
  /** Nút mở hộp có bấm được không (`dong.phatHanhMisa.bat` — luật quyết ở `nutPhatHanhMisa`, không suy lại ở đây). */
  bat: boolean;
  /** Hiện nút «Gửi nháp (không ký)» — CHỈ khi nhà cung cấp là VIN ∧ nút Phát hành đang sáng (cùng điều kiện, cùng cổng ở máy chủ; `guiNhapHoaDonVinAction`). */
  choPhepNhap: boolean;
  onPhatHanh: (r: { trangThai: string; thongDiep: string | null }) => void;
}) {
  const [mo, setMo] = useState(false);
  const [dangTai, setDangTai] = useState(false);
  const [loiTai, setLoiTai] = useState<string | null>(null);
  const [kq, setKq] = useState<KetQuaXemTruoc | null>(null);
  const [chon, setChon] = useState<QuyetNguoiMua>("PHU_HUYNH");
  const [dangGui, setDangGui] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const [dangNhap, setDangNhap] = useState(false);
  const [ketQuaNhap, setKetQuaNhap] = useState<(KetQuaGuiNhap & { nhan: KetQuaNhan | null }) | null>(null);

  async function bamXem() {
    setMo(true);
    setDangTai(true);
    setLoiTai(null);
    setLoi(null);
    setKetQuaNhap(null);
    setKq(null);
    const r = await xemTruocHoaDonAction({ orderId: dong.orderId, lanThuKey: dong.key, soTienDaThay: dong.soTien });
    setDangTai(false);
    if (!r.ok) return setLoiTai(r.error);
    setKq(r.data);
    setChon(r.data.macDinh);
  }

  const phuongAn = kq ? (chon === "CON" ? kq.con : kq.phuHuynh) : null;
  const dung: PhuongAnXemTruoc | null = phuongAn && laPhuongAnDuoc(phuongAn) ? phuongAn : null;

  async function phatHanh() {
    if (!dung) return;
    setDangGui(true);
    setLoi(null);
    const r = await phatHanhQuaMisaAction({
      orderId: dong.orderId,
      lanThuKey: dong.key,
      soTienDaThay: dong.soTien,
      moiTruongDaThay: moiTruong,
      nguoiMuaChon: dung.chon,
      phieuDaThay: dung.dau,
    });
    setDangGui(false);
    if (!r.ok) return setLoi(r.error);
    setMo(false);
    onPhatHanh(r.data);
  }

  async function guiNhap() {
    if (!dung) return;
    setDangNhap(true);
    setLoi(null);
    setKetQuaNhap(null);
    const r = await guiNhapHoaDonVinAction({ orderId: dong.orderId, lanThuKey: dong.key, soTienDaThay: dong.soTien, nguoiMuaChon: dung.chon, phieuDaThay: dung.dau });
    setDangNhap(false);
    if (!r.ok) return setLoi(r.error);
    // [25/11/2026] Pháp nhân có HSM: VIN đã KÝ LUÔN bản nháp ⇒ hệ thống đã nhận hoá đơn về (số, PDF/XML, email) — đóng hộp, báo kết quả, làm mới màn.
    if (r.data.nhan?.loai === "DA_NHAN") {
      setMo(false);
      return onPhatHanh({ trangThai: r.data.nhan.trangThai, thongDiep: r.data.nhan.thongDiep });
    }
    setKetQuaNhap(r.data);
  }

  const ban = dangGui || dangNhap;

  return (
    <>
      <Button type="button" size="sm" disabled={!bat} onClick={() => void bamXem()}>
        <Send aria-hidden /> Xem trước &amp; phát hành…
      </Button>
      <Dialog open={mo} onOpenChange={(v) => (ban ? undefined : setMo(v))}>
        <DialogContent className="max-h-[90vh] gap-3 overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Xem trước hoá đơn</DialogTitle>
            <DialogDescription>Kiểm tra thông tin sẽ ghi vào hoá đơn, chọn người mua rồi phát hành.</DialogDescription>
          </DialogHeader>

          {dangTai ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Đang dựng tờ hoá đơn…
            </p>
          ) : loiTai ? (
            <p role="alert" className="rounded-lg bg-state-danger-soft px-3.5 py-2.5 text-sm text-state-danger-ink">
              {loiTai}
            </p>
          ) : kq ? (
            <div className="flex flex-col gap-3">
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  Người mua trên hoá đơn
                  <HelpHint label="Xem hướng dẫn: chọn người mua">
                    Chọn lấy thông tin của ba/mẹ hay của con. Mặc định theo quy tắc kế toán: bên nào có đủ họ tên và CCCD hơn thì lấy bên đó, bằng nhau thì lấy con. Địa chỉ dùng chung cho cả hai. Đơn đứng tên đơn vị (có MST) luôn lấy đơn vị.
                  </HelpHint>
                </legend>
                <div role="radiogroup" aria-label="Người mua trên hoá đơn" className="grid gap-2 sm:grid-cols-2">
                  {(["PHU_HUYNH", "CON"] as const).map((ben) => {
                    const pa = ben === "CON" ? kq.con : kq.phuHuynh;
                    const duoc = laPhuongAnDuoc(pa);
                    const chonRoi = chon === ben;
                    return (
                      <button
                        key={ben}
                        type="button"
                        role="radio"
                        aria-checked={chonRoi}
                        disabled={!duoc || ban}
                        onClick={() => setChon(ben)}
                        className={cn(
                          "flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                          chonRoi ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                          !duoc && "cursor-not-allowed opacity-60 hover:bg-transparent",
                        )}
                      >
                        <span className="flex items-center gap-1.5 font-medium text-foreground">
                          {TEN_BEN[ben]}
                          {kq.macDinh === ben ? <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">theo quy tắc</span> : null}
                        </span>
                        <span className="text-muted-foreground [overflow-wrap:anywhere]">
                          {duoc ? pa.nguoiMua.hoTen || "—" : pa.khongDuoc}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              {dung ? (
                <>
                  <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-lg border border-border p-3 text-sm">
                    <Dong nhan="Người mua">{dung.nguoiMua.hoTen || trong}</Dong>
                    {dung.nguoiMua.donVi ? <Dong nhan="Đơn vị">{dung.nguoiMua.donVi}</Dong> : null}
                    {dung.nguoiMua.mst ? <Dong nhan="Mã số thuế">{dung.nguoiMua.mst}</Dong> : null}
                    <Dong nhan="CCCD">{dung.nguoiMua.cccd ?? trong}</Dong>
                    <Dong nhan="Địa chỉ">{dung.nguoiMua.diaChi ?? trong}</Dong>
                    {dung.nguoiMua.maKhachHang ? <Dong nhan="Mã khách hàng">{dung.nguoiMua.maKhachHang}</Dong> : null}
                    <Dong nhan="Email nhận">{moiTruong === "gia-lap" ? <span className="text-muted-foreground">Không gửi (mô phỏng)</span> : (dung.nguoiMua.email ?? <span className="text-muted-foreground">Khách chưa có email</span>)}</Dong>
                    <Dong nhan="Ký hiệu">
                      <span className="font-medium tabular-nums">{kq.kyHieu}</span> · ngày {ngayVn(kq.ngayHoaDon)} · {dung.hinhThucThanhToan}
                    </Dong>
                  </dl>

                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="px-3 py-1.5 font-normal">Nội dung</th>
                          <th className="px-3 py-1.5 text-right font-normal">Thành tiền</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dung.dong.map((d) => (
                          <tr key={d.stt} className="border-b border-border/60 last:border-0">
                            <td className="px-3 py-1.5 [overflow-wrap:anywhere]">{d.ten}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{tien(d.thanhTien)}</td>
                          </tr>
                        ))}
                        <tr className="bg-muted/40 font-semibold">
                          <td className="px-3 py-1.5">Tổng thanh toán</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{tien(dung.tongThanhToan)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}

              <p
                className={cn(
                  "flex items-start gap-2 rounded-lg px-3.5 py-2.5 text-sm",
                  moiTruong === "production" ? "bg-state-danger-soft text-state-danger-ink" : "bg-state-warning-soft text-state-warning-ink",
                )}
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{cauMoiTruong}</span>
              </p>
              {loi ? (
                <p role="alert" className="text-sm text-state-danger-ink">
                  {loi}
                </p>
              ) : null}
              {ketQuaNhap ? <KetQuaNhapVin kq={ketQuaNhap} /> : null}
            </div>
          ) : null}

          <DialogFooter className="gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" size="sm" disabled={ban} onClick={() => setMo(false)}>
              Đóng
            </Button>
            {choPhepNhap ? (
              <Button type="button" variant="outline" size="sm" disabled={!dung || ban || dangTai} onClick={() => void guiNhap()}>
                {dangNhap ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden /> Đang gửi nháp…
                  </>
                ) : (
                  <>
                    <FileText aria-hidden /> Gửi nháp (không ký)
                  </>
                )}
              </Button>
            ) : null}
            <Button type="button" size="sm" disabled={!dung || ban || dangTai} onClick={() => void phatHanh()}>
              {dangGui ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden /> Đang gửi {tenNcc}…
                </>
              ) : (
                <>
                  <Send aria-hidden /> Phát hành {tien(dong.soTien)}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
