"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Link2, Loader2, UserX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MUC_GAN } from "@/lib/finance/gan-ghi-danh-khoan";

import { ganGhiDanhChoKhoanAction, khoanBiBoAction, type KhoanBiBoView } from "../_actions";

const vnd = (n: number) => `${n.toLocaleString("vi-VN")}đ`;
const ngayVN = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

const O =
  "min-h-9 w-full rounded-lg border border-border bg-background px-2 text-xs transition-colors duration-150 focus:border-primary focus:outline-none";

/**
 * DANH SÁCH KHOẢN BỊ BỎ — và sửa được ngay tại chỗ.
 *
 * Chủ dự án 14/09/2026: "bấm xem thử xong chỉ xem và không có thao tác gì nữa à?"
 *
 * Khối xem thử ở trên chỉ ĐẾM theo lý do. Nhưng lý do phổ biến nhất — "Chưa gắn ghi danh
 * — không sinh được phiếu thu" — là thứ SỬA ĐƯỢC: trỏ khoản vào đúng ghi danh của em.
 * Không có đường sửa thì tiền nằm mãi ở trạng thái chờ và cổng phụ huynh vẫn hiện nợ.
 *
 * ⚠️ BA LÝ DO, BA VIỆC PHẢI LÀM KHÁC HẲN NHAU — cố ý không gộp thành một nút:
 *   · chưa gắn ghi danh, em có 1 lớp  → gắn được ngay tại đây;
 *   · chưa gắn ghi danh, em nhiều lớp → PHẢI chọn lớp, máy không đoán hộ;
 *   · chưa gắn ghi danh, em chưa có lớp nào → việc nằm ở màn Ghi danh, không phải ở đây;
 *   · "Bạn là người ghi nhận khoản này" → KHÔNG có nút nào, và đó là đúng: quy tắc tách
 *     nhiệm vụ giữa người nhập tiền và người xác nhận tiền, cố ý không bỏ.
 */
export function KhoanBiBo() {
  const [ds, setDs] = useState<KhoanBiBoView[] | null>(null);
  const [chon, setChon] = useState<Record<string, string>>({});
  const [dangChay, start] = useTransition();

  function nap() {
    start(async () => {
      const r = await khoanBiBoAction();
      if (!r.ok) {
        toast.error("Không đọc được danh sách khoản bị bỏ");
        return;
      }
      setDs(r.ds);
      // Gợi ý sẵn cho ca chỉ có MỘT lớp — người dùng chỉ việc bấm Gắn.
      setChon(
        Object.fromEntries(
          r.ds.filter((k) => k.goiYGhiDanhId).map((k) => [k.id, k.goiYGhiDanhId as string]),
        ),
      );
    });
  }

  function gan(k: KhoanBiBoView) {
    const enrollmentId = chon[k.id];
    if (!enrollmentId) return;
    start(async () => {
      const r = await ganGhiDanhChoKhoanAction({ paymentId: k.id, enrollmentId });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        `Đã gắn ${vnd(k.soTien)} của ${k.hocVien ?? "học viên"} vào lớp — bấm "Xem thử" lại để xác nhận`,
      );
      // Bỏ khỏi danh sách: khoản này không còn thuộc nhóm bị bỏ vì lý do đó nữa.
      setDs((c) => (c ? c.filter((x) => x.id !== k.id) : c));
    });
  }

  if (ds === null) {
    return (
      <div className="mt-4 border-t border-border pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={nap}
          disabled={dangChay}
          className="min-h-11 transition-colors duration-150"
        >
          {dangChay ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Link2 className="h-4 w-4" aria-hidden />
          )}
          Xem từng khoản bị bỏ và sửa
        </Button>
        <p className="mt-2 max-w-prose text-xs leading-relaxed text-muted-foreground">
          Khoản bị bỏ vì <b className="font-semibold text-foreground">chưa gắn ghi danh</b> thì
          sửa được ngay ở đây — gắn xong quay lại bấm &quot;Xem thử&quot; là nó vào lượt xác
          nhận.
        </p>
      </div>
    );
  }

  if (ds.length === 0) {
    return (
      <div className="mt-4 border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">
          Không còn khoản nào bị bỏ. Bấm <b className="font-semibold text-foreground">Xem thử</b>{" "}
          ở trên để xác nhận cả lượt.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3 border-t border-border pt-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {ds.length} khoản bị bỏ
      </p>

      <ul className="space-y-2">
        {ds.map((k) => (
          <li
            key={k.id}
            className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-background p-3 lg:flex-row lg:items-center lg:justify-between"
          >
            <div className="min-w-0">
              <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
                <b className="truncate font-semibold text-foreground">
                  {k.hocVien ?? k.phuHuynh ?? "(không rõ học viên)"}
                </b>
                <span className="whitespace-nowrap font-semibold tabular-nums text-foreground">
                  {vnd(k.soTien)}
                </span>
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  {ngayVN(k.ngay)}
                  {k.maDon ? ` · ${k.maDon}` : ""}
                </span>
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-state-warning-ink">{k.lyDo}</p>
            </div>

            {/* Ba kết cục khác nhau — xem chú thích đầu file. */}
            {k.mucGan === MUC_GAN.KHONG_CO ? (
              <p className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <UserX className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Em chưa có ghi danh nào —{" "}
                <Link
                  href="/enrollments"
                  className="font-semibold text-primary underline-offset-2 hover:underline"
                >
                  xếp lớp trước
                </Link>
              </p>
            ) : k.ungVien.length > 0 ? (
              <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2">
                <select
                  value={chon[k.id] ?? ""}
                  onChange={(e) => setChon((c) => ({ ...c, [k.id]: e.target.value }))}
                  aria-label={`Chọn lớp cho khoản của ${k.hocVien ?? "học viên"}`}
                  className={`${O} sm:w-64`}
                >
                  <option value="">
                    {k.mucGan === MUC_GAN.PHAI_CHON ? "— Chọn lớp đã đóng tiền —" : "— Chọn lớp —"}
                  </option>
                  {k.ungVien.map((u) => (
                    <option key={u.id} value={u.id}>
                      {[u.tenKhoa, u.tenLop].filter(Boolean).join(" · ") || u.id}
                      {u.finalPrice != null ? ` — ${vnd(u.finalPrice)}` : " — chưa chốt giá"}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  onClick={() => gan(k)}
                  disabled={dangChay || !chon[k.id]}
                  className="min-h-9 shrink-0"
                >
                  {dangChay && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                  Gắn
                </Button>
              </div>
            ) : (
              // "Bạn là người ghi nhận khoản này" và các lý do khác: không có thao tác nào
              // ở đây, và đó là đúng — nói ra thay vì bày một nút không làm gì.
              <p className="shrink-0 text-xs text-muted-foreground">
                Không sửa được ở màn này
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
