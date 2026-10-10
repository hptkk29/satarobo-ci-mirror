"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, CircleStop, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { XemTruocDungHoc } from "@/lib/finance/dung-hoc-con";

import { dungHocConAction, xemTruocDungHocAction } from "../_actions";
import { thongDiepPhieuDaSoat } from "@/lib/finance/soat-phieu-gop";

/**
 * HỘP THOẠI "DỪNG HỌC" — một con, trên trang chi tiết đơn [PHIÊN D, 21/09/2026].
 *
 * ── Vì sao ĐÂY là chỗ duy nhất trong khối công nợ dùng hộp thoại ──
 * Mọi thao tác khác của khối (tạo đợt, gắn tiền, tách khoản) mở ra TẠI CHỖ, cố ý — chúng
 * là việc thường ngày và người dùng cần thấy con số họ vừa đọc. Dừng học thì ngược lại:
 * nó **không hoàn tác được**, nó đụng bốn thứ cùng lúc (đợt · phiếu gộp · tiền · ghi danh),
 * và nó bắt người ta đọc một phép tính trước khi gật. Đó đúng là lúc phải ngắt mạch và bảo
 * vệ tiêu điểm.
 *
 * ── Ràng buộc đã tuân ──
 * · admin = shadcn/ui, KHÔNG Magic UI / Framer Motion (ESLint chặn cứng);
 * · tiền `tabular-nums`, tên người `min-w-0 truncate` (tên tiếng Việt dài là mặc định);
 * · một cột ở 320px, hai cột từ `sm` — không tràn ngang;
 * · nút xác nhận KHOÁ cho tới khi phép phân dư khớp từng đồng.
 */

const vnd = (n: number) => `${n.toLocaleString("vi-VN")}đ`;

const ngayGio = (d: Date | string) =>
  new Date(d).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

const LY_DO = [
  { ma: "PH_CHU_DONG", nhan: "Phụ huynh chủ động cho nghỉ" },
  { ma: "TRUNG_TAM_HUY", nhan: "Trung tâm huỷ lớp — không thu phí" },
  { ma: "KHAC", nhan: "Khác (bắt buộc ghi rõ)" },
] as const;

type MaLyDo = (typeof LY_DO)[number]["ma"];

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
export function NutDungHoc({
  orderId,
  orderItemId,
  tenCon,
  anNut = false,
  mo: moNgoai,
  dong: dongNgoai,
}: {
  orderId: string;
  orderItemId: string;
  tenCon: string;
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-state-danger-ink"
          onClick={() => datMoTrong(true)}
        >
          <CircleStop className="size-4" aria-hidden />
          Dừng học
        </Button>
      )}
      {mo && (
        <HopThoai
          orderId={orderId}
          orderItemId={orderItemId}
          tenCon={tenCon}
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
  dong,
}: {
  orderId: string;
  orderItemId: string;
  tenCon: string;
  dong: () => void;
}) {
  const [lyDo, datLyDo] = useState<MaLyDo>("PH_CHU_DONG");
  /** `undefined` = chưa chọn gì ⇒ để máy chủ dùng gợi ý của nó. */
  const [buoiCuoiId, datBuoiCuoiId] = useState<string | null | undefined>(undefined);
  const [ghiChu, datGhiChu] = useState("");
  const [oTien, datOTien] = useState<Record<string, string>>({});
  const [oHoan, datOHoan] = useState("");

  const [xem, datXem] = useState<XemTruocDungHoc | null>(null);
  const [loiXem, datLoiXem] = useState<string | null>(null);
  const [dangXem, xemNgay] = useTransition();
  const [dangGui, guiNgay] = useTransition();

  // Xem trước chạy lại mỗi khi LÝ DO hoặc BUỔI CUỐI đổi — hai thứ đó là toàn bộ đầu vào của
  // phép quyết toán. Không tự tính ở client: con số quyết định bé phải trả bao nhiêu chỉ
  // được sinh ra ở một chỗ, và chỗ đó là máy chủ.
  useEffect(() => {
    let huy = false;
    xemNgay(async () => {
      const r = await xemTruocDungHocAction({
        orderId,
        orderItemId,
        lyDo,
        ...(buoiCuoiId !== undefined ? { buoiCuoiId } : {}),
      });
      if (huy) return;
      if (!r.ok) {
        datLoiXem(r.error);
        datXem(null);
        return;
      }
      datLoiXem(null);
      datXem(r.data);
    });
    return () => {
      huy = true;
    };
  }, [orderId, orderItemId, lyDo, buoiCuoiId]);

  const so = (s: string) => Number((s ?? "").replace(/\D/g, "")) || 0;
  const du = xem?.chenh != null && xem.chenh > 0 ? xem.chenh : 0;
  const daChuyen = (xem?.conConLai ?? []).reduce((s, c) => s + so(oTien[c.orderItemId] ?? ""), 0);
  const daPhan = daChuyen + so(oHoan);
  const conPhaiPhan = du - daPhan;

  // Buổi cuối đang chọn khác buổi máy chủ gợi ý ⇒ BẮT BUỘC ghi chú. Kiểm ở client chỉ để
  // khoá nút sớm; cổng thật nằm ở `dungHocMotCon` (một cổng ở client không phải một cổng).
  const suaKhacGoiY = xem != null && xem.buoiCuoiId !== xem.goiYBuoiCuoiId;
  const thieuGhiChu = (suaKhacGoiY || lyDo === "KHAC") && !ghiChu.trim();
  const sanSang =
    xem != null &&
    xem.loiQuyetToan == null &&
    !thieuGhiChu &&
    (du === 0 ? true : conPhaiPhan === 0);

  const xacNhan = () => {
    if (!xem) return;
    guiNgay(async () => {
      const phanDu = [
        ...xem.conConLai
          .map((c) => ({
            kieu: "CHUYEN" as const,
            orderItemId: c.orderItemId,
            soTien: so(oTien[c.orderItemId] ?? ""),
          }))
          .filter((p) => p.soTien > 0),
        ...(so(oHoan) > 0 ? [{ kieu: "HOAN" as const, soTien: so(oHoan) }] : []),
      ];
      const r = await dungHocConAction({
        orderId,
        orderItemId,
        lyDo,
        buoiCuoiId: xem.buoiCuoiId,
        ghiChu: ghiChu.trim() || null,
        // Hai nhánh của union `PhanDu` không hợp nhất được ở biên server action, nên ép
        // kiểu tại đúng một chỗ. Cổng thật là `kiemPhanDu` ở máy chủ.
        phanDu: phanDu as never,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        `Đã dừng học ${tenCon}: dùng ${r.soBuoiDaDung} buổi · quyết toán ${vnd(r.giaTriDaDung)}` +
          (r.daChuyen > 0 ? ` · chuyển ${vnd(r.daChuyen)}` : "") +
          (r.daDatHoan > 0 ? ` · chờ hoàn ${vnd(r.daDatHoan)}` : ""),
      );
      // Rà vòng 5 — nói SAU (máy chủ vừa làm gì với mã của cả nhà), bên cạnh lời nói trước.
      const baoPhieu = thongDiepPhieuDaSoat(r.phieuGop ? [r.phieuGop] : []);
      if (baoPhieu) toast.warning(baoPhieu, { duration: 15_000 });
      dong();
    });
  };

  return (
    <Dialog open onOpenChange={(v) => !v && dong()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="min-w-0 truncate">Dừng học — {tenCon}</DialogTitle>
          <DialogDescription>
            Không hoàn tác được. Hệ thống sẽ huỷ mọi đợt đang mở của bé, quyết toán theo số
            buổi đã dùng, và bắt phân hết phần dư trước khi ghi.
          </DialogDescription>
        </DialogHeader>

        {loiXem && (
          <p className="rounded-lg bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
            {loiXem}
          </p>
        )}

        <div className="space-y-4">
          {/* ── Lý do ──────────────────────────────────────────────────── */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">Lý do</legend>
            {LY_DO.map((l) => (
              <label key={l.ma} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="ly-do-dung-hoc"
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={lyDo === l.ma}
                  onChange={() => datLyDo(l.ma)}
                />
                <span className="min-w-0">{l.nhan}</span>
              </label>
            ))}
          </fieldset>

          {/* ── Buổi cuối ──────────────────────────────────────────────── */}
          {xem && xem.buoi.length > 0 && (
            <div>
              <p className="text-sm font-medium text-foreground">
                Buổi cuối bé có học
                <span className="ml-2 font-normal text-muted-foreground">
                  · đã dùng <b className="tabular-nums text-foreground">{xem.soBuoiDaDung}</b>
                  {xem.soBuoiCamKet != null && `/${xem.soBuoiCamKet}`} buổi
                </span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Buổi đã qua ngày đều tính, kể cả buổi chưa ai chốt sổ. Buổi huỷ thì không.
              </p>
              <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border">
                <ul className="divide-y divide-border">
                  {xem.buoi.map((b) => (
                    <li key={b.id}>
                      <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50">
                        <input
                          type="radio"
                          name="buoi-cuoi"
                          className="size-4 shrink-0 accent-primary"
                          checked={xem.buoiCuoiId === b.id}
                          onChange={() => datBuoiCuoiId(b.id)}
                          disabled={b.status === "CANCELLED"}
                        />
                        <span className="min-w-0 flex-1 truncate tabular-nums">
                          {ngayGio(b.date)}
                        </span>
                        {b.status === "CANCELLED" ? (
                          <span className="shrink-0 text-xs text-muted-foreground">đã huỷ</span>
                        ) : b.daDung ? (
                          <span className="shrink-0 text-xs text-state-success-ink">đã dùng</span>
                        ) : null}
                        {xem.goiYBuoiCuoiId === b.id && (
                          <span className="shrink-0 text-xs text-muted-foreground">gợi ý</span>
                        )}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
              {suaKhacGoiY && (
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-state-warning-ink">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  Bạn chọn khác buổi hệ thống gợi ý — phải ghi rõ lý do bên dưới.
                </p>
              )}
            </div>
          )}

          {/* ── Phép quyết toán ────────────────────────────────────────── */}
          {xem?.loiQuyetToan ? (
            <p className="rounded-lg bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">
              {xem.loiQuyetToan}
            </p>
          ) : (
            xem && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-muted/40 p-3 text-sm sm:grid-cols-4">
                <Cap nhan="Học phí" giaTri={vnd(xem.hocPhiThuc)} />
                <Cap
                  nhan={`Đã dùng (${xem.soBuoiDaDung} buổi)`}
                  giaTri={vnd(xem.giaTriDaDung ?? 0)}
                />
                <Cap nhan="Đã thu" giaTri={vnd(xem.daThu)} />
                <Cap
                  nhan={(xem.chenh ?? 0) >= 0 ? "Dư phải phân" : "Bé còn nợ"}
                  giaTri={vnd(Math.abs(xem.chenh ?? 0))}
                  manh
                />
              </dl>
            )
          )}

          {xem && xem.choXacNhan > 0 && (
            <p className="text-xs text-state-warning-ink">
              Bé còn <b className="tabular-nums">{vnd(xem.choXacNhan)}</b> kế toán chưa xác
              nhận — khoản đó KHÔNG chuyển được, và không nằm trong phép tính trên.
            </p>
          )}

          {/* PHIÊN E — LỜI NHẮC CHÍNH SÁCH, tách khỏi cảnh báo tiền ở trên.
              Chủ dự án chốt 21/09: bé còn lại GIỮ nguyên ưu đãi; không đổi số nào.
              Dùng tông `info`, KHÔNG dùng `warning` như khối trên — màu cũng là một lời
              hứa (luật 12), và hứa "có chuyện với tiền" ở đây là hứa sai. */}
          {xem?.canhBaoUuDaiAnhEm && (
            <div className="rounded-lg bg-muted/40 p-3 text-xs">
              <p className="flex items-start gap-1.5 text-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{xem.canhBaoUuDaiAnhEm}</span>
              </p>
              {xem.dauVetUuDaiAnhEm.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 pl-5 text-muted-foreground">
                  {xem.dauVetUuDaiAnhEm.map((d) => (
                    <li key={d.orderItemId} className="min-w-0 truncate">
                      {d.ten}
                      {/* Nói rõ nguồn: nhãn thì tin được, đoán từ chữ thì không. Giấu sự
                          khác biệt đó là mời người ta tin một phép đoán. */}
                      {d.theoNhan ? " — có nhãn ưu đãi anh/chị/em" : " — đoán từ giải trình"}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {xem?.canhBao.map((c) => (
            <p key={c} className="flex items-start gap-1.5 text-xs text-state-warning-ink">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {c}
            </p>
          ))}

          {/* ── Thứ sẽ bị huỷ ──────────────────────────────────────────── */}
          {xem && (xem.dotSeHuy.length > 0 || xem.phieuGop) && (
            <div className="rounded-lg border border-border p-3 text-xs">
              <p className="font-medium text-foreground">Sẽ huỷ khi xác nhận</p>
              <ul className="mt-1.5 space-y-1 text-muted-foreground">
                {xem.dotSeHuy.map((d) => (
                  <li key={d.id} className="tabular-nums">
                    Đợt {d.installmentNo} · {vnd(d.amountDue)}
                    {d.daRot > 0 && (
                      <span className="text-state-warning-ink">
                        {" "}
                        · đã nhận {vnd(d.daRot)} (tiền giữ nguyên, chỉ ngừng đòi thêm)
                      </span>
                    )}
                  </li>
                ))}
                {xem.phieuGop && (
                  <li>
                    Phiếu QR gộp của gia đình —{" "}
                    {xem.phieuGop.hanhDong === "HUY"
                      ? "huỷ, phát lại mã mới cho phần còn lại"
                      : `đóng (đã nhận ${vnd(xem.phieuGop.daNhan)})`}
                  </li>
                )}
              </ul>
            </div>
          )}

          {/* ── Phân hết khoản dư ──────────────────────────────────────── */}
          {du > 0 && xem && (
            <div className="rounded-lg border border-border p-3">
              <p className="text-sm font-medium text-foreground">
                Phân hết <span className="tabular-nums">{vnd(du)}</span> dư
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Chuyển sang bé còn lại và/hoặc để kế toán hoàn. Tổng phải <b>đúng bằng</b> số
                trên — không có lựa chọn &ldquo;để đó&rdquo;.
              </p>

              <div className="mt-3 space-y-2">
                {xem.conConLai.map((c) => (
                  <label
                    key={c.orderItemId}
                    className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {c.ten}
                      <span className="ml-2 text-xs text-muted-foreground">
                        còn nợ {vnd(Math.max(0, c.conNo))}
                      </span>
                    </span>
                    <Input
                      inputMode="numeric"
                      className="tabular-nums sm:w-40"
                      placeholder="0"
                      value={oTien[c.orderItemId] ?? ""}
                      onChange={(e) =>
                        datOTien((cu) => ({ ...cu, [c.orderItemId]: e.target.value }))
                      }
                      aria-label={`Chuyển cho ${c.ten}`}
                    />
                  </label>
                ))}
                <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                  <span className="min-w-0 flex-1 text-sm">
                    Kế toán hoàn cho phụ huynh
                    <span className="ml-2 text-xs text-muted-foreground">
                      tạo yêu cầu chờ duyệt, chưa chi tiền
                    </span>
                  </span>
                  <Input
                    inputMode="numeric"
                    className="tabular-nums sm:w-40"
                    placeholder="0"
                    value={oHoan}
                    onChange={(e) => datOHoan(e.target.value)}
                    aria-label="Số tiền kế toán hoàn"
                  />
                </label>
              </div>

              <p
                className={`mt-2 text-sm tabular-nums ${
                  conPhaiPhan === 0 ? "text-state-success-ink" : "text-state-warning-ink"
                }`}
              >
                {conPhaiPhan === 0
                  ? "Đã phân đủ."
                  : conPhaiPhan > 0
                    ? `Còn ${vnd(conPhaiPhan)} chưa phân.`
                    : `Phân vượt ${vnd(-conPhaiPhan)}.`}
              </p>
            </div>
          )}

          {xem && (xem.chenh ?? 0) < 0 && (
            <p className="rounded-lg bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink">
              Bé còn nợ <b className="tabular-nums">{vnd(-(xem.chenh ?? 0))}</b> phần đã học.
              Dừng học xong, tạo một đợt đúng số này để thu nốt.
            </p>
          )}

          {/* ── Ghi chú ────────────────────────────────────────────────── */}
          <div>
            <label htmlFor="ghi-chu-dung-hoc" className="text-sm font-medium text-foreground">
              Ghi chú{(suaKhacGoiY || lyDo === "KHAC") && <span aria-hidden> *</span>}
            </label>
            <Textarea
              id="ghi-chu-dung-hoc"
              className="mt-1"
              rows={2}
              value={ghiChu}
              onChange={(e) => datGhiChu(e.target.value)}
              placeholder={
                suaKhacGoiY
                  ? "Vì sao buổi cuối khác gợi ý của hệ thống?"
                  : "Không bắt buộc"
              }
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={dong} disabled={dangGui}>
            Huỷ
          </Button>
          <Button type="button" onClick={xacNhan} disabled={!sanSang || dangGui || dangXem}>
            {(dangGui || dangXem) && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Xác nhận dừng học
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Cap({ nhan, giaTri, manh }: { nhan: string; giaTri: string; manh?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted-foreground">{nhan}</dt>
      <dd
        className={`mt-0.5 truncate tabular-nums ${
          manh ? "text-base font-semibold text-foreground" : "text-sm text-foreground"
        }`}
      >
        {giaTri}
      </dd>
    </div>
  );
}
