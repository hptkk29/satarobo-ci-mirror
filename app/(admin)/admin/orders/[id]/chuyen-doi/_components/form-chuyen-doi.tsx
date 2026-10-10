"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Check, Lock, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HelpHint } from "@/components/admin/ui/help-hint";
import type { DongChuyenDoi, LopUngVien } from "@/lib/orders/chuyen-doi-don";
import { duocXep } from "@/lib/lms/xep-vao-lop";
import { chuyenDoiDonAction } from "../_actions";

/**
 * Form CHUYỂN ĐỔI — mỗi con một khối, mỗi khối chọn một lớp.
 *
 * ── HÌNH THỨC (DESIGN.md · mode Operate) ─────────────────────────────────────────────
 * Lớp bày bằng DANH SÁCH RADIO, không phải `<select>`. Lý do là nội dung: mỗi lớp mang
 * một PHÁN QUYẾT ("vào bình thường" / "học vượt 3 buổi" / "chỉ Quản trị tối cao"), và
 * phán quyết chính là thứ người xếp lớp cần so sánh. Giấu nó sau một dropdown là bắt họ
 * mở từng cái ra rồi nhớ — đúng việc mà màn hình phải làm hộ.
 *
 * Lớp KHÔNG xếp được vẫn HIỆN, mờ + nói lý do. Ẩn là để người dùng tự hỏi "lớp T3 đâu
 * rồi" (luật 12 — affordance phải nói thật, kể cả khi sự thật là "không được").
 *
 * ⚠️ KHÔNG dùng thẻ lồng thẻ: mỗi con là một `<section>` viền mỏng, bên trong là các
 * HÀNG radio ngăn bằng đường kẻ — không phải card trong card (craft-floor).
 *
 * ── RESPONSIVE: 320px → 8k ───────────────────────────────────────────────────────────
 * · trần 104rem đặt ở trang, khối này chỉ co giãn bên trong;
 * · lưới ô nhập `grid-cols-1 sm:grid-cols-2` — dưới 640px xếp dọc;
 * · mỗi hàng lớp `flex-wrap` + `min-w-0` + `truncate`: tên lớp dài, tên cơ sở dài, lịch
 *   dài đều không đẩy vỡ hàng (DESIGN.md §3 — tiếng Việt dài là mặc định);
 * · thanh hành động `sticky bottom-0` để ở màn cao 8k không phải cuộn xuống đáy tìm nút.
 */
export function FormChuyenDoi({
  orderId,
  maDon,
  phuHuynh,
  dong,
  laAdmin,
}: {
  orderId: string;
  maDon: string;
  phuHuynh: { ten: string; sdt: string; email: string | null };
  dong: DongChuyenDoi[];
  /** Có quyền `enrollments:override-progress` — vượt được luật TIẾN ĐỘ (không vượt sĩ số). */
  laAdmin: boolean;
}) {
  const router = useRouter();
  const [dangLuu, batDau] = useTransition();

  type Khai = { chon: boolean; tenBe: string; ngaySinh: string; classId: string };
  const [khai, setKhai] = useState<Record<string, Khai>>(() =>
    Object.fromEntries(
      dong.map((d) => [
        d.orderItemId,
        // Mặc định KHÔNG tích: xếp lớp là việc có hậu quả (tạo hồ sơ học viên, sinh phiếu
        // học bù), nên người dùng phải nói "có" chứ không phải nhớ bỏ tích.
        { chon: false, tenBe: d.tenBe, ngaySinh: "", classId: "" } satisfies Khai,
      ]),
    ),
  );

  const sua = (id: string, t: Partial<Khai>) =>
    setKhai((cu) => ({ ...cu, [id]: { ...cu[id]!, ...t } }));

  const daChon = useMemo(
    () => dong.filter((d) => d.enrollmentId === null && khai[d.orderItemId]?.chon),
    [dong, khai],
  );

  function luu() {
    for (const d of daChon) {
      const k = khai[d.orderItemId]!;
      if (k.tenBe.trim().length < 2) {
        toast.error(`Chưa nhập tên học viên cho "${d.tenDong}"`);
        return;
      }
      if (!k.classId) {
        toast.error(`Chưa chọn lớp cho "${k.tenBe.trim()}"`);
        return;
      }
    }
    if (daChon.length === 0) {
      toast.error("Chưa chọn bé nào để xếp lớp");
      return;
    }
    batDau(async () => {
      const kq = await chuyenDoiDonAction({
        orderId,
        dong: daChon.map((d) => {
          const k = khai[d.orderItemId]!;
          return {
            orderItemId: d.orderItemId,
            tenBe: k.tenBe.trim(),
            ngaySinh: k.ngaySinh || null,
            classId: k.classId,
          };
        }),
      });
      if (!kq.ok) {
        toast.error(kq.error, { duration: 12_000 });
        return;
      }
      toast.success(
        kq.soPhieuHocBu > 0
          ? `Đã xếp ${kq.soCon} học viên vào lớp · tạo ${kq.soPhieuHocBu} phiếu học bù`
          : `Đã xếp ${kq.soCon} học viên vào lớp`,
        { duration: 10_000 },
      );
      router.push(`/orders/${orderId}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5 pb-24">
      {/* Phụ huynh — đọc-only, lấy từ đơn. Một hàng dữ liệu, không phải một thẻ KPI. */}
      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Phụ huynh
        </h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
          {(
            [
              ["Họ tên", phuHuynh.ten || "—"],
              ["Số điện thoại", phuHuynh.sdt || "—"],
              ["Email", phuHuynh.email || "—"],
            ] as const
          ).map(([nhan, giaTri]) => (
            <div key={nhan} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{nhan}</dt>
              <dd className="truncate text-sm font-medium text-foreground">{giaTri}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          Lấy từ đơn {maDon} — sửa ở màn đơn nếu sai, đừng nhập lại ở đây.
        </p>
      </section>

      {dong.map((d, i) => (
        <KhoiCon
          key={d.orderItemId}
          stt={i + 1}
          dong={d}
          khai={khai[d.orderItemId]!}
          laAdmin={laAdmin}
          onSua={(t) => sua(d.orderItemId, t)}
        />
      ))}

      {/* Thanh hành động DÍNH ĐÁY: ở màn 8k danh sách con có thể dài hơn một màn, và nút
          nằm tít dưới là bắt người dùng cuộn tìm. `bg-background/95` + `backdrop-blur`
          đủ để tách khỏi nội dung mà không cần bóng nặng (DESIGN.md §7). */}
      <div className="sticky bottom-0 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 text-sm text-muted-foreground">
            {daChon.length === 0
              ? "Chưa chọn bé nào"
              : `Sẽ xếp ${daChon.length} học viên vào lớp`}
          </p>
          <Button onClick={luu} disabled={dangLuu || daChon.length === 0}>
            <UserPlus className="h-4 w-4" aria-hidden />
            {dangLuu ? "Đang xếp lớp…" : "Xếp vào lớp"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function KhoiCon({
  stt,
  dong,
  khai,
  laAdmin,
  onSua,
}: {
  stt: number;
  dong: DongChuyenDoi;
  khai: { chon: boolean; tenBe: string; ngaySinh: string; classId: string };
  laAdmin: boolean;
  onSua: (t: Partial<{ chon: boolean; tenBe: string; ngaySinh: string; classId: string }>) => void;
}) {
  const daXep = dong.enrollmentId !== null;
  const lopChonDuoc = dong.lop.filter((l) => l.chonDuoc || (l.xet.chiAdmin && laAdmin && !l.daDay));
  const lopKhongDuoc = dong.lop.filter((l) => !lopChonDuoc.includes(l));

  return (
    <section
      className={`rounded-xl border bg-card transition-colors duration-150 ${
        daXep ? "border-border opacity-60" : khai.chon ? "border-primary/40" : "border-border"
      }`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-6 min-w-6 items-center justify-center whitespace-nowrap rounded-md bg-muted px-1.5 text-xs font-semibold text-muted-foreground">
              {stt}
            </span>
            <h2 className="min-w-0 truncate text-sm font-bold text-foreground">
              {dong.tenKhoa ?? dong.tenDong}
            </h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Mua{" "}
            <b className="tabular-nums text-foreground">
              {dong.soBuoiMua ?? dong.tongSoBuoiKhoa ?? "—"} buổi
            </b>
            {dong.buoiBatDau && dong.buoiBatDau > 1 && (
              <>
                {" · học từ "}
                <b className="tabular-nums text-foreground">buổi {dong.buoiBatDau}</b>
              </>
            )}
          </p>
        </div>

        {daXep ? (
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-state-success-soft px-2.5 py-1 text-xs font-medium text-state-success-ink">
            <Check className="h-3.5 w-3.5" aria-hidden />
            Đã xếp lớp
          </span>
        ) : (
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 whitespace-nowrap text-sm font-medium">
            <input
              type="checkbox"
              checked={khai.chon}
              onChange={(e) => onSua({ chon: e.target.checked })}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            Xếp bé này
          </label>
        )}
      </header>

      {!daXep && khai.chon && (
        <div className="space-y-5 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:max-w-3xl">
            <div className="space-y-1.5">
              <Label className="text-xs">
                Tên học viên *
                <HelpHint>
                  Tên bé, không phải tên phụ huynh. Nếu bé đã có hồ sơ với cùng phụ huynh
                  và cùng ngày sinh, hệ dùng lại hồ sơ cũ thay vì tạo trùng.
                </HelpHint>
              </Label>
              <Input
                value={khai.tenBe}
                onChange={(e) => onSua({ tenBe: e.target.value })}
                maxLength={120}
                placeholder="VD: Nguyễn Bảo Minh"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Ngày sinh</Label>
              <Input
                type="date"
                value={khai.ngaySinh}
                onChange={(e) => onSua({ ngaySinh: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Chọn lớp
            </p>

            {dong.lop.length === 0 ? (
              <p className="rounded-lg border border-state-warning-ink/30 bg-state-warning-soft px-3 py-2.5 text-xs text-state-warning-ink">
                Không có lớp nào của khoá này đang nhận học viên ở cơ sở của đơn. Mở lớp
                mới hoặc đổi cơ sở của đơn trước.
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                {lopChonDuoc.map((l, i) => (
                  <HangLop
                    key={l.id}
                    lop={l}
                    dauTien={i === 0}
                    daChon={khai.classId === l.id}
                    khoa={false}
                    laAdmin={laAdmin}
                    onChon={() => onSua({ classId: l.id })}
                  />
                ))}
                {lopKhongDuoc.map((l, i) => (
                  <HangLop
                    key={l.id}
                    lop={l}
                    dauTien={lopChonDuoc.length === 0 && i === 0}
                    daChon={false}
                    khoa
                    laAdmin={laAdmin}
                    onChon={() => undefined}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Một dòng lớp. Toàn bộ dòng là vùng bấm (`<label>`), không chỉ cái nút radio bé xíu —
 * cùng bài học "mở rộng vùng bấm" mà luật 12 của repo đã ghi.
 */
function HangLop({
  lop,
  dauTien,
  daChon,
  khoa,
  laAdmin,
  onChon,
}: {
  lop: LopUngVien;
  dauTien: boolean;
  daChon: boolean;
  khoa: boolean;
  laAdmin: boolean;
  onChon: () => void;
}) {
  const canAdmin = lop.xet.chiAdmin && !lop.daDay;
  const hocVuot = lop.xet.soBuoiHocVuot > 0 && duocXep(lop.xet, laAdmin);

  return (
    <label
      className={`flex cursor-pointer flex-wrap items-start gap-x-3 gap-y-1.5 px-3 py-3 transition-colors duration-150 sm:px-4 ${
        dauTien ? "" : "border-t border-border"
      } ${khoa ? "cursor-not-allowed bg-muted/40" : daChon ? "bg-primary/5" : "hover:bg-muted/50"}`}
    >
      <input
        type="radio"
        name={`lop-${lop.id.slice(0, 4)}-${lop.ten.length}`}
        checked={daChon}
        disabled={khoa}
        onChange={onChon}
        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`min-w-0 truncate text-sm font-medium ${khoa ? "text-muted-foreground" : "text-foreground"}`}>
            {lop.ten}
          </span>
          {lop.maLop && (
            <span className="whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {lop.maLop}
            </span>
          )}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {lop.lich && <span className="whitespace-nowrap">{lop.lich}</span>}
          <span className="whitespace-nowrap tabular-nums">
            Sĩ số {lop.siSo}/{lop.siSoToiDa}
          </span>
          <span className="whitespace-nowrap tabular-nums">
            {lop.soBuoiDaQua === 0 ? "Chưa học buổi nào" : `Đã học ${lop.soBuoiDaQua} buổi`}
          </span>
        </span>
        {/* Phán quyết — dòng chữ QUYẾT ĐỊNH, không phải chú thích phụ. Đây là thứ người
            xếp lớp đọc để chọn, nên nó được tone màu riêng chứ không phải xám. */}
        <span
          className={`mt-1 flex items-start gap-1.5 text-xs ${
            lop.daDay || (canAdmin && !laAdmin)
              ? "text-state-danger-ink"
              : hocVuot
                ? "text-state-warning-ink"
                : "text-state-success-ink"
          }`}
        >
          {lop.daDay ? (
            <>
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>Lớp đã đủ {lop.siSoToiDa} chỗ — không ai thêm được, kể cả Quản trị tối cao.</span>
            </>
          ) : canAdmin ? (
            <>
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                {lop.xet.cau}
                {laAdmin && " Bạn có quyền vượt — cân nhắc trước khi xếp."}
              </span>
            </>
          ) : hocVuot ? (
            <>
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{lop.xet.cau}</span>
            </>
          ) : (
            <>
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{lop.xet.cau}</span>
            </>
          )}
        </span>
      </span>
    </label>
  );
}
