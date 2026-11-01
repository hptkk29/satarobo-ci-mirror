"use client";

// Các nút hành động của MỘT dòng ngoại lệ: Thử lại tạo lead · Đánh dấu đã xử lý · Giao người.
//
// Nguyên tắc (luật 12): nút nào hiện/sáng/tối và LÝ DO tối đến từ `nut` (hàm thuần `bangNutNgoaiLe`) — component này KHÔNG tự suy điều kiện. Lý do tối hiện ngay dưới nút bằng chữ
// (điện thoại không có hover). Server Action là cổng thật; ở đây chỉ bắt lỗi trả về và nói bằng tiếng người. Sau thành công `router.refresh()` để version mới về — không giữ version cục bộ.
// Mọi nút nổi lên trên lớp liên kết phủ kín dòng (`relative z-10`) để bấm nút không bị hiểu là mở hồ sơ.
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { BangNutNgoaiLe } from "@/lib/ai-lead/dich-vu/ngoai-le-thuan";
import { NutLyDo, type KetQuaHanhDong } from "../../_components/nut-ly-do";
import { danhDauDaXuLyAction, giaoNguoiAction, thuLaiTaoLeadAction } from "../_actions";

type KetQuaAction = { ok: true; data?: unknown } | { ok: false; error: { code: string; message: string } };
const dich = (kq: KetQuaAction): KetQuaHanhDong => (kq.ok ? { ok: true } : { ok: false, error: kq.error.message });

const LOP_NUT = "relative z-10 min-h-11 px-3 text-sm";

export type DauVaoHanhDong = {
  draftId: string;
  version: number;
  nut: BangNutNgoaiLe;
  ungVien: { id: string; ten: string }[];
  /** Chỉ để đặt tên nút cho trình đọc màn hình (nhiều dòng cùng nút «Thử lại»). */
  tenHoSo: string;
};

function LyDoKhoa({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="mt-1 max-w-[22rem] text-xs text-muted-foreground">
      {children}
    </p>
  );
}

export function HanhDongNgoaiLe({ draftId, version, nut, ungVien, tenHoSo }: DauVaoHanhDong) {
  const idKhoa = useId();
  return (
    <div className="flex flex-wrap items-start gap-2">
      {nut.thuLai.hien && (
        <div className="min-w-0">
          <NutLyDo
            nhan="Thử lại"
            tieuDe="Thử tạo lead lại?"
            moTa={
              <>
                Hệ thống đưa hồ sơ <strong>{tenHoSo}</strong> về hàng chờ, nhận hồ sơ cho bạn rồi tạo lead lại. Nếu vẫn lỗi, hồ sơ quay lại danh sách ngoại lệ; nếu thiếu thông tin hoặc cơ sở không
                còn nhận khách, hồ sơ về danh sách «Hồ sơ chờ AI». Nếu số điện thoại này đã có lead đang mở, hồ sơ sẽ được <strong>gộp vào lead đó</strong> (như nút «Duyệt») — hãy mở hồ sơ xem trước nếu
                chưa chắc.
              </>
            }
            nhanXacNhan="Thử lại tạo lead"
            nguyHiem={false}
            bienThe="default"
            disabled={!nut.thuLai.bat}
            thongBaoXong="Đã tạo lead từ hồ sơ."
            className={LOP_NUT}
            chay={async (lyDo) => dich(await thuLaiTaoLeadAction({ draftId, version, lyDo }))}
          />
          {nut.thuLai.lyDoKhoa && <LyDoKhoa id={`${idKhoa}-tl`}>{nut.thuLai.lyDoKhoa}</LyDoKhoa>}
        </div>
      )}
      {nut.danhDauDaXuLy.hien && (
        <div className="min-w-0">
          <NutLyDo
            nhan="Đánh dấu đã xử lý"
            tieuDe="Đóng ngoại lệ này?"
            moTa={<>Lead của hồ sơ này đã có sale phụ trách. Hồ sơ sẽ chuyển sang «Đã tạo lead» và biến khỏi danh sách ngoại lệ. Việc này không đổi người phụ trách lead.</>}
            nhanXacNhan="Đánh dấu đã xử lý"
            nguyHiem={false}
            disabled={!nut.danhDauDaXuLy.bat}
            thongBaoXong="Đã đóng ngoại lệ."
            className={LOP_NUT}
            chay={async (lyDo) => dich(await danhDauDaXuLyAction({ draftId, version, lyDo }))}
          />
          {nut.danhDauDaXuLy.lyDoKhoa && <LyDoKhoa id={`${idKhoa}-dd`}>{nut.danhDauDaXuLy.lyDoKhoa}</LyDoKhoa>}
        </div>
      )}
      {nut.giaoNguoi.hien && (
        <div className="min-w-0">
          <NutGiaoNguoi draftId={draftId} version={version} ungVien={ungVien} bat={nut.giaoNguoi.bat} tenHoSo={tenHoSo} />
          {nut.giaoNguoi.lyDoKhoa && <LyDoKhoa id={`${idKhoa}-gn`}>{nut.giaoNguoi.lyDoKhoa}</LyDoKhoa>}
        </div>
      )}
    </div>
  );
}

function NutGiaoNguoi({ draftId, version, ungVien, bat, tenHoSo }: { draftId: string; version: number; ungVien: { id: string; ten: string }[]; bat: boolean; tenHoSo: string }) {
  const router = useRouter();
  const idChon = useId();
  const [mo, datMo] = useState(false);
  const [nguoi, datNguoi] = useState("");
  const [loi, datLoi] = useState<string | null>(null);
  const [dangChay, batDau] = useTransition();

  function dong() {
    if (dangChay) return;
    datMo(false);
    datNguoi("");
    datLoi(null);
  }
  function xacNhan() {
    if (!nguoi) return;
    batDau(async () => {
      const kq = await giaoNguoiAction({ draftId, version, nguoiNhanId: nguoi });
      if (kq.ok) {
        toast.success("Đã giao hồ sơ.");
        datMo(false);
        datNguoi("");
        datLoi(null);
        router.refresh();
      } else {
        datLoi(kq.error.message);
      }
    });
  }

  return (
    <>
      <Button type="button" variant="outline" disabled={!bat} onClick={() => datMo(true)} className={LOP_NUT}>
        Giao người
      </Button>
      <Dialog open={mo} onOpenChange={(m) => (m ? datMo(true) : dong())}>
        {/* `admin-scope`: Dialog render qua PORTAL ra ngoài khung admin — thiếu class này nút lấy màu `--primary` của :root (cam). */}
        <DialogContent showCloseButton={false} className="admin-scope max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Giao hồ sơ cho người khác</DialogTitle>
            <DialogDescription render={<div />}>Hồ sơ {tenHoSo} sẽ chuyển sang người được chọn; họ nhận thông báo. Chỉ quản lý của cơ sở xử lý hồ sơ mới hiện trong danh sách.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label htmlFor={idChon} className="text-sm font-medium">
              Người nhận
            </label>
            <select
              id={idChon}
              value={nguoi}
              onChange={(e) => datNguoi(e.target.value)}
              disabled={dangChay}
              className="h-11 w-full min-w-0 overflow-hidden rounded-lg border border-input bg-background px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm"
            >
              <option value="">Chọn người nhận…</option>
              {ungVien.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.ten}
                </option>
              ))}
            </select>
          </div>
          {loi ? (
            <p role="alert" className="rounded-md bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
              {loi}
            </p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={dong} disabled={dangChay}>
              Huỷ
            </Button>
            <Button type="button" className="min-h-11" disabled={!nguoi || dangChay} onClick={xacNhan}>
              {dangChay ? <Loader2 className="animate-spin" aria-hidden /> : null} {dangChay ? "Đang giao…" : "Giao hồ sơ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
