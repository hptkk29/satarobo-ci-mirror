"use client";

// F3 · US-19 — HỘP THOẠI THÊM CON VÀO ĐƠN ĐANG HỌC.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO HỘP THOẠI, KHÔNG PHẢI FORM TẠI CHỖ
//
// Ngược với "Tạo đợt" / "Tách khoản" / "Chuyển tiền" (đều mở tại chỗ): thao tác này có thể
// đổi TIỀN CỦA NHỮNG BÉ KHÁC trên cùng đơn — thêm một con học khoá đắt hơn thì ưu đãi anh em
// chuyển sang con đang học, và đợt chưa thu của bé ấy bị huỷ & tạo lại số thấp hơn. Một thao
// tác chạm nhiều dòng thì phải có một màn XEM TRƯỚC chiếm hết chú ý, cùng lý lẽ với "Dừng
// học". US-19 AC5 gọi đúng tên nó: *"xem trước hiện rõ số thay đổi của từng con"*.
//
// ⚠️ Mọi con số trên màn này là do MÁY CHỦ tính (`xemTruocThemConAction`). Client KHÔNG tự
// nhân %: nó không biết chính sách của cơ sở, không biết trần %, và không biết đợt nào đã có
// tiền. Tính ở client rồi gửi lên là cho client cầm cả hai vế của phép so.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";

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
import { themConVaoDonAction, xemTruocThemConAction } from "../_actions";

const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}đ`;

/** Khoá học chọn được, do trang truyền xuống — giá niêm yết chỉ để HIỂN THỊ. */
export type KhoaChon = { id: string; name: string; price: number | null };

type XemTruoc = Awaited<ReturnType<typeof xemTruocThemConAction>>;
type DuLieuXemTruoc = Extract<XemTruoc, { ok: true }>["data"];

const NHAN_LY_DO_KHONG_GIAM: Record<string, string> = {
  HANG_MOT: "con thứ nhất — không giảm",
  DA_CO_DONG_FULL: "đã có ưu đãi đóng trọn khoá",
  CHINH_SACH_TAT: "chưa bật tự tính ưu đãi",
};

export function NutThemCon({ orderId, khoa }: { orderId: string; khoa: KhoaChon[] }) {
  const [mo, datMo] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => datMo(true)}>
        <UserPlus className="size-4" aria-hidden />
        Thêm con vào đơn…
      </Button>
      {mo && <HopThoai orderId={orderId} khoa={khoa} dong={() => datMo(false)} />}
    </>
  );
}

function HopThoai({
  orderId,
  khoa,
  dong,
}: {
  orderId: string;
  khoa: KhoaChon[];
  dong: () => void;
}) {
  const [ten, datTen] = useState("");
  const [courseId, datCourseId] = useState(khoa[0]?.id ?? "");
  const [oGia, datOGia] = useState(() => String(khoa[0]?.price ?? ""));
  const [lyDo, datLyDo] = useState("");
  const [xem, datXem] = useState<DuLieuXemTruoc | null>(null);
  const [loiXem, datLoiXem] = useState<string | null>(null);
  const [dangChay, batDau] = useTransition();

  const gia = Number((oGia || "").replace(/\D/g, "")) || 0;
  const khoaDangChon = khoa.find((k) => k.id === courseId);

  const doXem = () => {
    datXem(null);
    datLoiXem(null);
    batDau(async () => {
      const r = await xemTruocThemConAction({
        orderId,
        conMoi: { itemName: ten.trim(), courseId, quantity: 1, unitPrice: gia },
      });
      if (r.ok) datXem(r.data);
      else datLoiXem(r.error);
    });
  };

  const xacNhan = () => {
    batDau(async () => {
      const r = await themConVaoDonAction({
        orderId,
        conMoi: { itemName: ten.trim(), courseId, quantity: 1, unitPrice: gia },
        lyDo: lyDo.trim(),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        `Đã thêm ${ten.trim()} — đơn nay ${vnd(r.tongDonMoi)}` +
          (r.soDotDaDoi > 0 ? `, ${r.soDotDaDoi} đợt được tạo lại` : ""),
      );
      dong();
    });
  };

  // Đã xem trước xong VÀ đầu vào KHÔNG đổi từ lúc xem ⇒ mới cho xác nhận. Cho bấm xác nhận
  // trên một bản xem trước đã cũ là hiện một số rồi ghi một số khác (luật 12).
  const choXacNhan = !!xem && !!lyDo.trim() && !!ten.trim() && gia > 0;

  return (
    <Dialog open onOpenChange={(o) => !dangChay && !o && dong()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Thêm con vào đơn đang học</DialogTitle>
          <DialogDescription>
            Con mới có đợt thu riêng, và cả nhà vẫn gộp được một mã QR. Nếu chính sách ưu đãi
            anh chị em đang bật, hệ thống sẽ tính lại xem con nào được giảm — xem trước bên
            dưới trước khi xác nhận.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block">
            <span className="text-sm font-medium">Tên con *</span>
            <Input
              className="mt-1"
              value={ten}
              onChange={(e) => {
                datTen(e.target.value);
                datXem(null);
              }}
              placeholder="VD: Nguyễn Minh An"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Khoá học *</span>
            <select
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={courseId}
              onChange={(e) => {
                datCourseId(e.target.value);
                // Điền sẵn giá niêm yết của khoá vừa chọn. Người bán vẫn sửa được, nhưng cổng
                // soát giá ở máy chủ TỪ CHỐI số thấp hơn niêm yết — bớt cho khách thì khai
                // bằng khoản giảm giá có lý do.
                const k = khoa.find((x) => x.id === e.target.value);
                datOGia(String(k?.price ?? ""));
                datXem(null);
              }}
            >
              {khoa.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                  {k.price ? ` — ${vnd(k.price)}` : " — chưa cấu hình giá"}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium">Học phí ghi trên đơn *</span>
            <Input
              className="mt-1 tabular-nums"
              inputMode="numeric"
              value={oGia}
              onChange={(e) => {
                datOGia(e.target.value);
                datXem(null);
              }}
            />
            {khoaDangChon?.price != null && gia > khoaDangChon.price && (
              <span className="mt-1 block text-xs text-muted-foreground">
                Cao hơn giá niêm yết {vnd(khoaDangChon.price)} — được, nhưng hãy chắc là đúng ý.
              </span>
            )}
          </label>

          <Button type="button" variant="secondary" disabled={dangChay || !ten.trim() || gia <= 0} onClick={doXem}>
            Xem trước thay đổi
          </Button>

          {loiXem && <p className="text-sm text-state-danger-ink">{loiXem}</p>}

          {xem && <BangXemTruoc xem={xem} />}

          {xem && (
            <label className="block">
              <span className="text-sm font-medium">Lý do *</span>
              <Input
                className="mt-1"
                value={lyDo}
                onChange={(e) => datLyDo(e.target.value)}
                placeholder="VD: gia đình cho em thứ hai vào học từ tháng 10"
              />
            </label>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" disabled={dangChay} onClick={dong}>
            Huỷ
          </Button>
          <Button type="button" disabled={!choXacNhan || dangChay} onClick={xacNhan}>
            Xác nhận thêm con
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BangXemTruoc({ xem }: { xem: DuLieuXemTruoc }) {
  const cs = xem.chinhSach;
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
      {/* Chính sách đang hiệu lực, in ra NGAY TRÊN bảng số. Người bấm phải biết mình đang
          theo chính sách nào — nếu không, một bảng "không ai được giảm" đọc như hệ thống
          hỏng chứ không như "quản lý chưa bật tính năng". */}
      <p className="text-muted-foreground">
        {cs.tuDong ? (
          <>
            Đang tự tính ưu đãi anh chị em: con thứ hai <b>{cs.phanTramConThu2}%</b>, con thứ ba
            trở lên <b>{cs.phanTramConThu3}%</b>, áp cho{" "}
            <b>
              {cs.doiTuong === "HOC_PHI_THAP_HON" ? "con có học phí thấp hơn" : "con đăng ký sau"}
            </b>
            .
          </>
        ) : (
          <>
            Chưa bật tự tính ưu đãi anh chị em — thêm con sẽ KHÔNG đổi học phí của các con đang
            học. Quản lý bật ở màn Cấu hình vận hành, thẻ Thanh toán.
          </>
        )}
      </p>

      <table className="mt-2 w-full border-separate border-spacing-y-1">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="font-medium">Con</th>
            <th className="text-right font-medium">Học phí thực</th>
            <th className="text-right font-medium">Ưu đãi</th>
          </tr>
        </thead>
        <tbody>
          {xem.con.map((c) => (
            <tr key={c.orderItemId} className="align-top">
              <td className="pr-2">
                <span className="font-medium text-foreground">{c.ten}</span>
                {c.laConMoi && (
                  <span className="ml-1 rounded bg-primary/10 px-1 text-[10px] text-primary">
                    mới
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap pl-2 text-right tabular-nums">
                {c.thanhTienCu !== c.thanhTienMoi && !c.laConMoi && (
                  <span className="text-muted-foreground line-through">{vnd(c.thanhTienCu)}</span>
                )}{" "}
                <span
                  className={
                    c.thanhTienMoi < c.thanhTienCu && !c.laConMoi
                      ? "font-semibold text-state-success-ink"
                      : "text-foreground"
                  }
                >
                  {vnd(c.thanhTienMoi)}
                </span>
              </td>
              <td className="whitespace-nowrap pl-2 text-right">
                {c.uuDai.phanTram > 0 ? (
                  <span className="text-foreground">
                    {c.uuDai.phanTram}% · con thứ {c.uuDai.hang}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {NHAN_LY_DO_KHONG_GIAM[c.uuDai.viSaoKhongGiam ?? ""] ?? "—"}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Đợt bị huỷ & tạo lại — nói TỪNG đợt, vì mỗi đợt là một mã QR và một tin đã gửi. */}
      {xem.con.some((c) => c.doiDot.length > 0) && (
        <div className="mt-2 rounded border border-state-warning-soft bg-state-warning-soft/30 p-2">
          <p className="font-medium text-foreground">Đợt thu sẽ được huỷ và tạo lại</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {xem.con.flatMap((c) =>
              c.doiDot.map((d) => (
                <li key={d.id}>
                  {c.ten} · đợt {d.installmentNo}: {vnd(d.soCu)} → <b>{vnd(d.soMoi)}</b>
                </li>
              )),
            )}
          </ul>
          <p className="mt-1 text-muted-foreground">
            Mã QR của các đợt này hết hiệu lực — nhớ gửi lại số mới cho phụ huynh.
          </p>
        </div>
      )}

      {/* Đợt ĐÃ có tiền: nói ra là KHÔNG chạm. Im lặng thì người bấm không biết vì sao một
          đợt không có trong danh sách trên. */}
      {xem.con.some((c) => c.dotDaCoTien.length > 0) && (
        <p className="mt-2 text-muted-foreground">
          Đợt đã nhận tiền thì giữ nguyên, không bị sửa:{" "}
          {xem.con
            .flatMap((c) => c.dotDaCoTien.map((d) => `${c.ten} · đợt ${d.installmentNo}`))
            .join(" · ")}
          .
        </p>
      )}

      {/* Phần giảm không hấp thụ hết ⇒ bé ĐÓNG THỪA thật. Không được che. */}
      {xem.con.some((c) => c.seDongThua > 0) && (
        <div className="mt-2 rounded border border-state-danger-soft bg-state-danger-soft/30 p-2 text-state-danger-ink">
          {xem.con
            .filter((c) => c.seDongThua > 0)
            .map((c) => (
              <p key={c.orderItemId}>
                {c.ten} sẽ <b>đóng thừa {vnd(c.seDongThua)}</b> — phần giảm lớn hơn số còn phải
                thu. Sau khi thêm con, chuyển khoản thừa sang bé khác hoặc tạo yêu cầu hoàn.
              </p>
            ))}
        </div>
      )}

      <p className="mt-2 border-t border-border pt-2 text-foreground">
        Tổng đơn: <span className="tabular-nums text-muted-foreground line-through">{vnd(xem.tongDonCu)}</span>{" "}
        → <b className="tabular-nums">{vnd(xem.tongDonMoi)}</b>
      </p>
    </div>
  );
}
