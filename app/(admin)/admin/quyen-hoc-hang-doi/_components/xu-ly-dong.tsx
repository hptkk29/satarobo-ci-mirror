"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DongHangDoiDto } from "@/lib/entitlements/hang-doi/doc-hang-doi";
import { NHAN_HANH_DONG, type HanhDongHangDoi } from "@/lib/entitlements/hang-doi/hanh-dong-duoc-phep";
import { NHAN_LOAI, NHAN_TRANG_THAI } from "@/lib/entitlements/hang-doi/loai";
import { danhDauCanDuyetAction, dongDongAction, duyetHocVuotAction, duyetThuHoiAction, giuQuyenAction, thuCapLaiAction } from "../_actions";

// Chi tiết + nút xử lý MỘT dòng hàng đợi. Mọi quyết định "nút nào hiện" do SERVER tính (`dong.hanhDong` — cùng hàm `xetHanhDong` mà action dùng, luật 12)
// và truyền xuống; component này KHÔNG tự suy quyền. Vai chỉ có `entitlements:view` nhận `hanhDong = []` nên không thấy nút nào.

const CAN_LY_DO: ReadonlySet<HanhDongHangDoi> = new Set<HanhDongHangDoi>(["DONG", "GIU_QUYEN", "DUYET_THU_HOI", "DANH_DAU_CAN_DUYET", "DUYET_HOC_VUOT"]);

const MO_TA_HANH_DONG: Readonly<Record<HanhDongHangDoi, string>> = {
  THU_LAI: "Chạy lại đúng đường cấp quyền học khi tiền về. Đủ tiền và biết học viên thì cấp; chưa đủ thì dòng vẫn mở kèm lý do mới.",
  DONG: "Đóng dòng này với lý do. Dòng không mở lại nếu điều kiện y nguyên; điều kiện đổi thì mở lại.",
  GIU_QUYEN: "Quyết định GIỮ nguyên quyền học dù tiền bị đảo / huỷ / hoàn. Không thu hồi, không đổi số buổi.",
  DUYET_THU_HOI: "Thu hồi quyền học CHƯA tiêu thụ buổi nào (huỷ hoặc dừng quyền). Ghi danh và lịch học KHÔNG bị đổi.",
  DANH_DAU_CAN_DUYET: "Chuyển sang 'treo duyệt tay' để người có quyền quyết sau; dòng này đóng lại.",
  DUYET_HOC_VUOT: "Duyệt cho học viên học vượt THÊM các bài máy đã bỏ (phần vượt trần). Các bài đó thành phiếu học vượt miễn phí; số buổi quyền học còn lại tăng tương ứng. Không đổi ghi danh, điểm danh hay tiền.",
};

const dinhDangNgay = (iso: string): string => new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" });
const dinhDangTien = (n: number): string => `${n.toLocaleString("vi-VN")}đ`;

function Hang({ nhan, children }: { nhan: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{nhan}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function XuLyDong({ dong }: { dong: DongHangDoiDto }) {
  const router = useRouter();
  const [mo, setMo] = useState(false);
  const [dangChon, setDangChon] = useState<HanhDongHangDoi | null>(null);
  const [lyDo, setLyDo] = useState("");
  const [dang, bat] = useTransition();

  function dongHop() {
    if (dang) return;
    setMo(false);
    setDangChon(null);
    setLyDo("");
  }

  function chay(hd: HanhDongHangDoi) {
    bat(async () => {
      const vao = { dongId: dong.id, lyDo };
      const r =
        hd === "THU_LAI"
          ? await thuCapLaiAction({ dongId: dong.id })
          : hd === "DONG"
            ? await dongDongAction(vao)
            : hd === "GIU_QUYEN"
              ? await giuQuyenAction(vao)
              : hd === "DUYET_THU_HOI"
                ? await duyetThuHoiAction(vao)
                : hd === "DUYET_HOC_VUOT"
                  ? await duyetHocVuotAction(vao)
                  : await danhDauCanDuyetAction(vao);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.daLam) toast.success(r.thongBao);
      else toast.info(r.thongBao);
      setDangChon(null);
      setLyDo("");
      if (r.daLam) router.refresh();
    });
  }

  function bamNut(hd: HanhDongHangDoi) {
    if (CAN_LY_DO.has(hd)) {
      setDangChon(hd);
      return;
    }
    chay(hd);
  }

  const lyDoOk = lyDo.trim().length >= 10;
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setMo(true)} className="relative z-10">
        {dong.hanhDong.length > 0 ? "Xử lý" : "Chi tiết"}
      </Button>
      {mo && (
        <Dialog open onOpenChange={(o) => !o && dongHop()}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>
                {NHAN_LOAI[dong.loai]} · <span className="font-normal text-muted-foreground">{NHAN_TRANG_THAI[dong.trangThai]}</span>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-1">
              <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm">{dong.lyDo}</p>

              {dong.chiTiet.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {dong.chiTiet.map((c) => (
                    <li key={c.ma}>
                      <code className="mr-1 rounded bg-muted px-1 text-xs">{c.ma}</code>
                      {c.moTa}
                    </li>
                  ))}
                </ul>
              )}

              <dl className="space-y-1.5">
                <Hang nhan="Cơ sở">{dong.coSo?.ten ?? "—"}</Hang>
                <Hang nhan="Đơn">
                  {dong.don ? (
                    <Link href={`/orders/${dong.don.id}`} className="font-medium text-primary-ink hover:underline">
                      {dong.don.ma}
                    </Link>
                  ) : (
                    "—"
                  )}
                  {dong.dongDon ? <span className="text-muted-foreground"> · {dong.dongDon.ten}</span> : null}
                </Hang>
                <Hang nhan="Khoá">{dong.khoa?.ten ?? "—"}</Hang>
                <Hang nhan="Học viên / bé">
                  {dong.hocVien ? (
                    <Link href={`/students/${dong.hocVien.id}`} className="font-medium text-primary-ink hover:underline">
                      {dong.hocVien.ten}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">chưa có học viên</span>
                  )}
                  {dong.be ? <span className="text-muted-foreground"> · bé trong phiếu lead: {dong.be.ten}</span> : null}
                </Hang>
                <Hang nhan="Lớp">{dong.lop?.ten ?? "—"}</Hang>
                <Hang nhan="Quyền học">
                  {dong.quyenHoc ? (
                    <>
                      {dong.quyenHoc.trangThai} · mua {dong.quyenHoc.soBuoiMua} buổi · đã tiêu thụ {dong.quyenHoc.daTieuThu} buổi
                      {dong.quyenHoc.soTien !== null ? ` · ${dinhDangTien(dong.quyenHoc.soTien)}` : ""}
                    </>
                  ) : (
                    "chưa có"
                  )}
                </Hang>
                <Hang nhan="Tạo / cập nhật">
                  {dinhDangNgay(dong.taoLuc)} · {dinhDangNgay(dong.capNhatLuc)}
                  {dong.quaHan ? <span className="ml-2 font-semibold text-state-warning">quá hạn</span> : null}
                </Hang>
                {dong.dongLuc && <Hang nhan="Đóng lúc">{dinhDangNgay(dong.dongLuc)}</Hang>}
                {dong.ghiChuDong && <Hang nhan="Ghi chú đóng">{dong.ghiChuDong}</Hang>}
              </dl>

              {dong.daQuyet && (
                <p className="rounded-lg border border-border px-3 py-2 text-sm">
                  <strong>Quyết định của người xử lý</strong> ({dong.daQuyet.hanhDong}) — {dong.daQuyet.boi.ten}, {dinhDangNgay(dong.daQuyet.luc)}: {dong.daQuyet.lyDo}
                </p>
              )}

              {dong.loai === "CHO_CHUYEN_DOI" && dong.don && (
                <p className="text-sm text-muted-foreground">
                  Muốn gắn học viên vào dòng đơn: dùng màn{" "}
                  <Link href={`/orders/${dong.don.id}/chuyen-doi`} className="font-medium text-primary-ink hover:underline">
                    Chuyển đổi của đơn
                  </Link>{" "}
                  (hàng đợi này không tự gắn học viên). Xong, bấm “Thử cấp lại”.
                </p>
              )}
              {dong.loai === "CHO_DUYET_HOC_VUOT" && (
                <div className="space-y-1 rounded-lg border border-border px-3 py-2 text-sm">
                  {dong.deXuatHocVuot ? (
                    <>
                      <p>
                        Lớp đã dạy <strong>{dong.deXuatHocVuot.soBaiCan}</strong> bài · trần học vượt <strong>{dong.deXuatHocVuot.tran}</strong> bài. Máy đã giữ bài {dong.deXuatHocVuot.baiDaGiu || "—"} và bỏ bài{" "}
                        {dong.deXuatHocVuot.baiBoQua}.
                      </p>
                      <p>
                        Đề xuất học vượt thêm: bài <strong>{dong.deXuatHocVuot.baiDeXuatThem}</strong>.{" "}
                        {dong.deXuatHocVuot.quyenCan === "APPROVE_EXCEPTION"
                          ? "Cần người có quyền duyệt ngoại lệ (Giám đốc / Admin); Quản lý cơ sở đóng / từ chối được."
                          : "Cấu hình trần không rõ — Quản lý cơ sở duyệt được vì tổng bài vẫn trong trần mặc định."}
                      </p>
                    </>
                  ) : (
                    <p className="text-muted-foreground">Không đọc được đề xuất của dòng này — đóng dòng có lý do rồi báo kỹ thuật.</p>
                  )}
                </div>
              )}
              {dong.loai === "CHO_XEP_LOP" && (
                <p className="text-sm text-muted-foreground">
                  Bài học vượt chưa gắn được buổi đã dạy do Đào tạo xếp tay ở màn{" "}
                  <Link href="/hoc-bu" className="font-medium text-primary-ink hover:underline">
                    Học bù
                  </Link>
                  .
                </p>
              )}

              {dong.hanhDong.length === 0 ? (
                <p role="status" className="text-sm text-muted-foreground">
                  {!dong.coQuyenManage && !(dong.loai === "CHO_DUYET_HOC_VUOT" && dong.coQuyenDuyetNgoaiLe)
                    ? "Bạn chỉ có quyền xem hàng đợi — xử lý cần quyền entitlements:manage."
                    : dong.trangThai !== "OPEN"
                      ? "Dòng đã đóng."
                      : !dong.coBat
                        ? "Thu học phí theo phạm vi học chưa được bật cho cơ sở này — chỉ xem."
                        : "Không có hành động nào áp dụng cho dòng này lúc này."}
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {dong.hanhDong.map((hd) => (
                      <Button
                        key={hd}
                        type="button"
                        variant={dangChon === hd ? "default" : "outline"}
                        disabled={dang}
                        onClick={() => bamNut(hd)}
                        title={MO_TA_HANH_DONG[hd]}
                      >
                        {dang && !CAN_LY_DO.has(hd) ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                        {NHAN_HANH_DONG[hd]}
                      </Button>
                    ))}
                  </div>
                  {dangChon && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (lyDoOk) chay(dangChon);
                      }}
                      className="space-y-2"
                    >
                      <p className="text-sm text-muted-foreground">{MO_TA_HANH_DONG[dangChon]}</p>
                      <Label htmlFor={`ly-do-${dong.id}`}>Lý do * (từ 10 ký tự)</Label>
                      <Textarea id={`ly-do-${dong.id}`} value={lyDo} onChange={(e) => setLyDo(e.target.value)} rows={3} maxLength={500} />
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setDangChon(null)} disabled={dang}>
                          Huỷ
                        </Button>
                        <Button type="submit" disabled={dang || !lyDoOk}>
                          {dang ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                          Xác nhận: {NHAN_HANH_DONG[dangChon]}
                        </Button>
                      </DialogFooter>
                    </form>
                  )}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
