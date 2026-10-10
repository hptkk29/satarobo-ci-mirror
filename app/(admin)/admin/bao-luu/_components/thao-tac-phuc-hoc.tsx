"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { LopPhucHoc } from "@/lib/bao-luu/phuc-hoc";
import {
  baoPhucHocAction,
  chuyenSangTrungTamAction,
  goiYLopPhucHocAction,
  phucHocAction,
  sinhYeuCauHoanAction,
} from "../_actions";

// Thao tác PHỤC HỌC & TRUNG TÂM: báo phục học · xếp phục học (chọn lớp) · chuyển sang Trung tâm · sinh yêu cầu hoàn.
// Trang chi tiết (server) tính SẴN nút nào hiện; server action kiểm lại từng lượt. Hộp chọn lớp lấy gợi ý THẬT từ server (lệch bài, hướng học lại / sinh bù).

type Che = "bao" | "xep" | "trung-tam" | "hoan" | null;

export type CoPhucHoc = { bao: boolean; xep: boolean; trungTam: boolean; hoan: boolean };

const NHAN_HUONG: Record<LopPhucHoc["huong"], string> = { KHOP: "Khớp bài", HOC_LAI: "Lớp đi sau — học lại", BU: "Lớp đi trước — sinh buổi bù" };

export function ThaoTacPhucHoc({
  reserveId,
  co,
  uocHoan,
}: {
  reserveId: string;
  co: CoPhucHoc;
  /** Số tiền ước hoàn (đã tính từ CẶP chưa chia của ảnh chụp) — `null` = không tính được. Chỉ để hiển thị trong hộp xác nhận. */
  uocHoan: number | null;
}) {
  const router = useRouter();
  const [che, setChe] = useState<Che>(null);
  const [text, setText] = useState("");
  const [lop, setLop] = useState<LopPhucHoc[] | null>(null);
  const [chon, setChon] = useState<string>("");
  const [dongBai, setDongBai] = useState<{ dungOBai: number; dungSai: number } | null>(null);
  const [dang, bat] = useTransition();

  function dong() {
    if (dang) return;
    setChe(null);
    setText("");
    setLop(null);
    setChon("");
  }

  function mo(c: Che) {
    setChe(c);
    if (c === "xep" || c === "trung-tam") {
      bat(async () => {
        const r = await goiYLopPhucHocAction({ reserveId });
        if (!r.ok) {
          toast.error(r.error);
          setChe(null);
          return;
        }
        setLop(r.lop);
        setDongBai({ dungOBai: r.dungOBai, dungSai: r.dungSai });
        if (r.lop[0]) setChon(r.lop[0].classId);
      });
    }
  }

  function gui(e: React.FormEvent) {
    e.preventDefault();
    bat(async () => {
      const r =
        che === "bao"
          ? await baoPhucHocAction({ reserveId, ghiChu: text })
          : che === "xep"
            ? await phucHocAction({ reserveId, lopMoiId: chon, ghiChu: text || null })
            : che === "trung-tam"
              ? await chuyenSangTrungTamAction({ reserveId, lyDo: text })
              : await sinhYeuCauHoanAction({ reserveId, lyDo: text });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.canhBao?.length) toast.warning(r.canhBao.join("\n"));
      toast.success("Đã lưu");
      setChe(null);
      setText("");
      setLop(null);
      router.refresh();
    });
  }

  const tieuDe =
    che === "bao" ? "Phụ huynh báo muốn học lại"
    : che === "xep" ? "Xếp phục học"
    : che === "trung-tam" ? "Chuyển sang Trung tâm (không có lớp phù hợp)"
    : "Sinh yêu cầu hoàn";
  const canText = che !== "xep"; // xếp phục học: ghi chú tuỳ chọn
  const khongCoLop = che === "xep" && lop !== null && lop.length === 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {co.bao && <Button type="button" variant="outline" onClick={() => mo("bao")}>Phụ huynh báo phục học</Button>}
      {co.xep && <Button type="button" onClick={() => mo("xep")}>Xếp phục học</Button>}
      {co.trungTam && <Button type="button" variant="outline" onClick={() => mo("trung-tam")}>Chuyển sang Trung tâm</Button>}
      {co.hoan && <Button type="button" variant="outline" onClick={() => mo("hoan")}>Sinh yêu cầu hoàn</Button>}

      {che && (
        <Dialog open onOpenChange={(o) => !o && dong()}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{tieuDe}</DialogTitle>
            </DialogHeader>
            <form onSubmit={gui} className="space-y-4 py-2">
              {che === "xep" && (
                <div className="space-y-2">
                  {lop === null && <p className="text-sm text-muted-foreground">Đang tải lớp phù hợp…</p>}
                  {dongBai && lop !== null && (
                    <p className="text-sm text-muted-foreground">
                      Bé dừng ở bài <strong>{dongBai.dungOBai}</strong>; chấp nhận lớp lệch tối đa <strong>{dongBai.dungSai}</strong> bài. Lớp đủ sĩ số vẫn nhận.
                    </p>
                  )}
                  {khongCoLop && (
                    <p className="rounded-lg border border-state-warning-soft bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink">
                      Không có lớp nào phù hợp. Nếu Trung tâm không xếp được trong thời hạn, hãy dùng &ldquo;Chuyển sang Trung tâm&rdquo;.
                    </p>
                  )}
                  {lop?.map((l) => (
                    <label key={l.classId} className="flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                      <input type="radio" name="lop" className="mt-1" checked={chon === l.classId} onChange={() => setChon(l.classId)} />
                      <span className="min-w-0">
                        <span className="font-medium">{l.ten}</span>
                        <span className="ml-2 text-muted-foreground tabular-nums">{l.siSo}/{l.toiDa}{l.daDay ? " · đủ sĩ số" : ""}</span>
                        <span className="block text-xs text-muted-foreground">
                          Đang ở bài {l.baiHienTai} · {NHAN_HUONG[l.huong]}
                          {l.huong === "HOC_LAI" && l.hocLaiTu !== null ? ` (học lại bài ${l.hocLaiTu}–${l.hocLaiDen})` : ""}
                          {l.huong === "BU" ? ` (${l.soBuoiBu} buổi bù, không trừ hạn mức)` : ""}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {che === "hoan" && (
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p>
                    Đặt một yêu cầu hoàn <strong>chờ kế toán duyệt</strong> theo số buổi chưa học. Hệ thống <strong>không chi tiền</strong>; hồ sơ kết thúc và ghi danh đóng.
                  </p>
                  <p>
                    Số tiền ước tính:{" "}
                    <strong className="text-foreground tabular-nums">{uocHoan === null ? "chưa tính được (thiếu giá / số buổi trong ảnh chụp)" : `${uocHoan.toLocaleString("vi-VN")} đ`}</strong>
                  </p>
                </div>
              )}
              {che === "trung-tam" && <p className="text-sm text-muted-foreground">Hồ sơ chuyển sang loại Trung tâm: không còn quá hạn / chấm dứt tự động; Trung tâm nợ bé một lớp.</p>}
              <div className="space-y-1.5">
                <Label htmlFor="text-ph">{che === "bao" ? "Nội dung phụ huynh báo *" : che === "xep" ? "Ghi chú (tuỳ chọn)" : "Lý do *"}</Label>
                <Textarea id="text-ph" rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} required={canText} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={dong} disabled={dang}>Đóng</Button>
                <Button type="submit" disabled={dang || (canText && text.trim().length < 5) || (che === "xep" && !chon) || (che === "hoan" && uocHoan === null)}>
                  {dang && <Loader2 className="h-4 w-4 animate-spin" />}
                  {dang ? "Đang xử lý..." : "Lưu"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
