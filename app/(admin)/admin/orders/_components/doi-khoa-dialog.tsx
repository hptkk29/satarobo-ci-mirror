"use client";

// F4 · US-20 — HỘP THOẠI ĐỔI KHOÁ / ĐỔI LỚP CHO MỘT CON.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO HỘP THOẠI CÓ XEM TRƯỚC BẮT BUỘC
//
// Một lượt bấm ở đây làm NĂM việc không hoàn tác được: dừng ghi danh cũ · quyết toán theo
// buổi đã học · chuyển ghi danh sang lớp mới · chuyển tiền sang dòng mới · đặt yêu cầu hoàn
// cho phần vượt. Cùng lối với "Dừng học" (PHIÊN D) và "Thêm con" (F3): thao tác chạm nhiều
// dòng thì phải có một màn xem trước chiếm hết chú ý.
//
// ⚠️ Mọi con số là do MÁY CHỦ tính (`xemTruocDoiKhoaAction`). Client không biết buổi nào đã
// qua, không biết đơn giá buổi của khoá cũ, không biết bé đã đóng bao nhiêu — tính ở đây rồi
// gửi lên là cho client cầm cả hai vế của phép so.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowRightLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { doiKhoaChoConAction, xemTruocDoiKhoaAction } from "../_actions";

const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}đ`;

/** Lớp chọn được, do trang truyền xuống. */
export type LopChon = {
  id: string;
  name: string;
  courseName: string;
  coursePrice: number | null;
};

type XemTruoc = Awaited<ReturnType<typeof xemTruocDoiKhoaAction>>;
type DuLieu = Extract<XemTruoc, { ok: true }>["data"];

/**
 * ⚠️ HAI CÁCH DÙNG, và cách thứ hai là lý do `mo`/`dong` tồn tại [24/09/2026].
 *
 *   · TỰ QUẢN (mặc định): không truyền gì, component tự vẽ nút và tự giữ trạng thái mở.
 *   · ĐIỀU KHIỂN NGOÀI:   truyền `mo` + `dong`, và `anNut` để KHÔNG vẽ nút.
 *
 * Cách hai sinh ra vì khối "Công nợ theo con" đưa việc này vào menu `⋯`. Đặt nút kích
 * hoạt BÊN TRONG một `DropdownMenuItem` thì lần bấm đóng menu, menu unmount, và hộp thoại
 * vừa mở biến mất ngay lập tức — người dùng thấy một cái nháy rồi không có gì. Trạng thái
 * phải sống ở component CHA, ngoài menu.
 *
 * ⚠️ Và nút KHÔNG còn đóng cứng `mt-3`: nó từng là anh em trực tiếp của thẻ con nên tự
 * cõng khoảng cách của mình. Trong một `flex gap-2` thì cái `mt-3` ấy làm nút tụt 12px so
 * với nút bên cạnh — lệch thấy bằng mắt, typecheck không bắt.
 */
export function NutDoiKhoa({
  orderId,
  orderItemId,
  tenCon,
  lop,
  anNut = false,
  mo: moNgoai,
  dong: dongNgoai,
}: {
  orderId: string;
  orderItemId: string;
  tenCon: string;
  lop: LopChon[];
  /** Không vẽ nút kích hoạt — người gọi đã có lối vào riêng (mục menu). */
  anNut?: boolean;
  /** Điều khiển từ ngoài. Bỏ trống ⇒ component tự quản. */
  mo?: boolean;
  dong?: () => void;
}) {
  const [moTrong, datMoTrong] = useState(false);
  const mo = moNgoai ?? moTrong;
  const dong = dongNgoai ?? (() => datMoTrong(false));
  return (
    <>
      {!anNut && (
        <Button type="button" variant="outline" size="sm" onClick={() => datMoTrong(true)}>
          <ArrowRightLeft className="size-4" aria-hidden />
          Đổi khoá / đổi lớp…
        </Button>
      )}
      {mo && (
        <HopThoai
          orderId={orderId}
          orderItemId={orderItemId}
          tenCon={tenCon}
          lop={lop}
          dong={dong}
        />
      )}
    </>
  );
}

function HopThoai({
  orderId,
  orderItemId,
  tenCon,
  lop,
  dong,
}: {
  orderId: string;
  orderItemId: string;
  tenCon: string;
  lop: LopChon[];
  dong: () => void;
}) {
  const [lopId, datLopId] = useState(lop[0]?.id ?? "");
  const [oGia, datOGia] = useState(() => String(lop[0]?.coursePrice ?? ""));
  const [oHan, datOHan] = useState("");
  const [lyDo, datLyDo] = useState("");
  const [xem, datXem] = useState<DuLieu | null>(null);
  const [loiXem, datLoiXem] = useState<string | null>(null);
  const [dangChay, batDau] = useTransition();

  const gia = Number((oGia || "").replace(/\D/g, "")) || 0;
  const lopDangChon = lop.find((l) => l.id === lopId);

  const doXem = () => {
    datXem(null);
    datLoiXem(null);
    batDau(async () => {
      const r = await xemTruocDoiKhoaAction({
        orderId,
        orderItemId,
        targetClassId: lopId,
        unitPriceMoi: gia,
      });
      if (r.ok) datXem(r.data);
      else datLoiXem(r.error);
    });
  };

  const xacNhan = () => {
    batDau(async () => {
      const r = await doiKhoaChoConAction({
        orderId,
        orderItemId,
        targetClassId: lopId,
        unitPriceMoi: gia,
        hanDotConThieu: oHan || null,
        lyDo: lyDo.trim(),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        `Đã chuyển ${tenCon} sang ${lopDangChon?.name ?? "lớp mới"}` +
          (r.daChuyen > 0 ? ` — mang theo ${vnd(r.daChuyen)}` : ""),
      );
      dong();
    });
  };

  // Xem trước phải CÒN HIỆU LỰC: mọi thay đổi đầu vào xoá nó đi. Cho bấm xác nhận trên một
  // bản xem trước đã cũ là hiện một số rồi ghi một số khác (luật 12).
  const choXacNhan = !!xem && !xem.loi && !!lyDo.trim() && gia > 0;

  return (
    <Dialog open onOpenChange={(o) => !dangChay && !o && dong()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Đổi khoá / đổi lớp — {tenCon}</DialogTitle>
          <DialogDescription>
            Một lượt bấm làm cả năm việc: quyết toán phần đã học của khoá cũ, chuyển ghi danh
            sang lớp mới, mang tiền dư theo, và nếu khoá mới đắt hơn thì tạo đợt cho phần còn
            thiếu. Không có phí phạt dừng học — bé chỉ trả đúng phần đã học.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block">
            <span className="text-sm font-medium">Lớp mới *</span>
            <select
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={lopId}
              onChange={(e) => {
                datLopId(e.target.value);
                const l = lop.find((x) => x.id === e.target.value);
                datOGia(String(l?.coursePrice ?? ""));
                datXem(null);
              }}
            >
              {lop.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} — {l.courseName}
                  {l.coursePrice ? ` · ${vnd(l.coursePrice)}` : " · chưa cấu hình giá"}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium">Học phí khoá mới *</span>
            <Input
              className="mt-1 tabular-nums"
              inputMode="numeric"
              value={oGia}
              onChange={(e) => {
                datOGia(e.target.value);
                datXem(null);
              }}
            />
            {lopDangChon?.coursePrice != null && gia < lopDangChon.coursePrice && (
              <span className="mt-1 block text-xs text-state-danger-ink">
                Thấp hơn giá niêm yết {vnd(lopDangChon.coursePrice)} — máy chủ sẽ từ chối. Bớt
                cho khách thì khai bằng khoản giảm giá có lý do.
              </span>
            )}
          </label>

          <Button
            type="button"
            variant="secondary"
            disabled={dangChay || !lopId || gia <= 0}
            onClick={doXem}
          >
            Xem trước thay đổi
          </Button>

          {loiXem && <p className="text-sm text-state-danger-ink">{loiXem}</p>}
          {xem && <BangXemTruoc xem={xem} />}

          {xem && !xem.loi && xem.ke.conThieuMoi > 0 && (
            <label className="block">
              <span className="text-sm font-medium">
                Hạn đóng phần còn thiếu
                <span className="ml-2 text-xs text-muted-foreground">
                  bỏ trống = đợt không hạn, cron nhắc nợ sẽ không nhắc được ai
                </span>
              </span>
              <Input className="mt-1" type="date" value={oHan} onChange={(e) => datOHan(e.target.value)} />
            </label>
          )}

          {xem && !xem.loi && (
            <label className="block">
              <span className="text-sm font-medium">Lý do *</span>
              <Input
                className="mt-1"
                value={lyDo}
                onChange={(e) => datLyDo(e.target.value)}
                placeholder="VD: bé hoàn thành Sata 3, lên Sata 4 từ tháng 10"
              />
            </label>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" disabled={dangChay} onClick={dong}>
            Huỷ
          </Button>
          <Button type="button" disabled={!choXacNhan || dangChay} onClick={xacNhan}>
            Xác nhận đổi khoá
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BangXemTruoc({ xem }: { xem: DuLieu }) {
  const k = xem.ke;
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
      {xem.loi && <p className="mb-2 font-medium text-state-danger-ink">{xem.loi}</p>}

      <p className="text-muted-foreground">
        {xem.tenKhoaCu ?? "Khoá cũ"} → <b className="text-foreground">{xem.tenKhoaMoi}</b> (
        {xem.tenLopMoi})
      </p>

      <dl className="mt-2 space-y-1">
        <Hang nhan={`Đã học ${xem.soBuoiDaDung} buổi — phải trả`} giaTri={vnd(xem.giaTriDaDung)} />
        {k.du > 0 ? (
          <Hang nhan="Dư sau quyết toán" giaTri={vnd(k.du)} tot />
        ) : k.conNoCu > 0 ? (
          // ⚠️ Nợ cũ KHÔNG biến mất khi đổi khoá. Nói ra ngay, cạnh con số — không nói thì
          // người bấm tin rằng đổi khoá xong là xong.
          <Hang nhan="Còn NỢ phần đã học của khoá cũ" giaTri={vnd(k.conNoCu)} xau />
        ) : (
          <Hang nhan="Đã đóng vừa đúng phần đã học" giaTri="—" />
        )}
        <Hang nhan="Học phí khoá mới" giaTri={vnd(xem.hocPhiMoi)} />
        <Hang nhan="Mang sang khoá mới" giaTri={vnd(k.chuyenSangMoi)} tot={k.chuyenSangMoi > 0} />
        {k.conThieuMoi > 0 && (
          <Hang nhan="Còn thiếu ⇒ tạo một đợt thu mới" giaTri={vnd(k.conThieuMoi)} />
        )}
        {k.phanVuot > 0 && (
          <Hang nhan="Vượt học phí mới ⇒ đặt yêu cầu hoàn" giaTri={vnd(k.phanVuot)} tot />
        )}
      </dl>

      {/* AC2 — con số tham khảo, và phải NÓI RÕ là tham khảo. Không nói thì người bấm đọc nó
          như một cam kết số buổi, trong khi phép chuyển là chuyển TIỀN. */}
      {k.tuongDuongBuoi != null && k.chuyenSangMoi > 0 && (
        <p className="mt-2 text-muted-foreground">
          Số tiền mang sang tương đương <b>{k.tuongDuongBuoi} buổi</b> của khoá mới —{" "}
          <i>chỉ để tham khảo</i>, hệ thống chuyển bằng tiền chứ không bằng buổi.
        </p>
      )}

      <p className="mt-2 border-t border-border pt-2 text-muted-foreground">
        Ghi danh cũ sẽ chuyển sang <b className="text-foreground">{xem.tenLopMoi}</b>; mọi đợt
        thu chưa đóng của khoá cũ bị huỷ, và mã QR của chúng hết hiệu lực.
      </p>
    </div>
  );
}

function Hang({
  nhan,
  giaTri,
  tot,
  xau,
}: {
  nhan: string;
  giaTri: string;
  tot?: boolean;
  xau?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{nhan}</dt>
      <dd
        className={
          "shrink-0 tabular-nums font-semibold " +
          (xau ? "text-state-danger-ink" : tot ? "text-state-success-ink" : "text-foreground")
        }
      >
        {giaTri}
      </dd>
    </div>
  );
}
