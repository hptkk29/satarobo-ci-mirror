"use client";

// Hộp "Sinh lưới tháng từ khung ca tuần".
//
// Vì sao tách thành hộp riêng: đây là thao tác GHI HÀNG TRĂM Ô một lượt, nhưng bản cũ để nó thành
// một nút nằm lẫn trong thanh lọc, và trả kết quả bằng MỘT dòng chữ nối chuỗi ("+12 ô mới · 3 đổi
// · … · ⚠ 2 người…"). Bảy con số dính nhau như vậy không đọc được, còn `warnings` (mã ca lạ trong
// khung ca) thì bị nuốt hẳn — người xếp lịch không bao giờ biết có mã sai.
//
// Nay: chọn kỳ + chọn khối trong một hộp, kết quả là `<dl>` bảy dòng có nhãn, và hai danh sách
// cảnh báo hiện đầy đủ. Hộp KHÔNG tự đóng sau khi chạy — kết quả là thứ phải đọc, không phải toast.
//
// `generateMonthAction` sống ở `khung-ca/_actions.ts` (cùng chủ với khung ca tuần) và tự gác quyền
// theo từng khối; ở đây chỉ bày các khối người dùng có `hr_attendance:assign`.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD } from "@/components/admin/cham-cong/classes";
import { generateMonthAction, xemTruocSinhLuoiAction } from "../../khung-ca/_actions";

/** Gương của `GenerateResult` (lib/cham-cong/generate-db.ts) — khai lại để component client không
 *  kéo module server vào cây import chỉ vì một kiểu dữ liệu. */
type GenKetQua = {
  created: number;
  replaced: number;
  kept: number;
  cleared: number;
  skippedProtected: number;
  skippedNoPermission: number;
  unknownCode: number;
  people: number;
  skippedPast: number;
  chiTiet: { userId: string; ngay: string; action: string; maCu: string; maMoi: string }[];
  /** `name` do `generateMonthAction` làm giàu sau khi lib trả về — lib không tra được tên. */
  restWarnings: { userId: string; from: string; to: string; name?: string | null }[];
  warnings: string[];
};

/** Bảy con số của một lượt sinh, kèm giải thích ngắn — không có nhãn thì "kept 12" vô nghĩa. */
const SO_DO: { key: keyof GenKetQua; label: string; hint: string }[] = [
  { key: "created", label: "Ô mới", hint: "ngày chưa có ca, nay được xếp" },
  { key: "replaced", label: "Ô đổi mã", hint: "đã có ca theo khung, mã cũ khác mã mới" },
  { key: "kept", label: "Ô giữ nguyên", hint: "mã trùng khung ca, không ghi lại" },
  { key: "cleared", label: "Ô bị xoá", hint: "khung ca bỏ trống thứ đó" },
  { key: "skippedProtected", label: "Ô được bảo vệ", hint: "sửa tay / đơn đã duyệt / file import" },
  { key: "skippedPast", label: "Ô chừa lại", hint: "ngày đã qua và hôm nay — lưới chỉ áp từ NGÀY MAI" },
  { key: "skippedNoPermission", label: "Ô ngoài quyền", hint: "thuộc khối bạn không xếp được" },
  { key: "unknownCode", label: "Mã lạ", hint: "mã trong khung ca không có trong danh mục" },
];

/** Nhãn tiếng Việt cho `action` của kế hoạch — mã trần trong bảng là vô nghĩa với người đọc. */
const NHAN_VIEC: Record<string, string> = {
  CREATE: "Tạo mới",
  REPLACE: "Đổi mã",
  KEEP: "Giữ nguyên",
  CLEAR: "Xoá ô",
  SKIP_PROTECTED: "Chừa — ô được bảo vệ",
  SKIP_QUA_KHU: "Chừa — ngày đã qua / hôm nay",
};

function ngayVi(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}` : iso;
}

export function GenerateDialog({
  defaultKy,
  blocks,
  defaultBlockId,
}: {
  /** Mặc định là tháng SAU theo giờ VN — xếp lịch là việc làm trước. */
  defaultKy: string;
  /** Chỉ khối có `hr_attendance:assign`. */
  blocks: { id: string; label: string }[];
  defaultBlockId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [ky, setKy] = useState(defaultKy);
  const [chon, setChon] = useState<string[]>(() =>
    defaultBlockId && blocks.some((b) => b.id === defaultBlockId) ? [defaultBlockId] : blocks.map((b) => b.id),
  );
  const [ketQua, setKetQua] = useState<GenKetQua | null>(null);
  /**
   * `null` chưa chạy gì · `"XEM"` đang hiện bản chạy thử · `"GHI"` đã ghi thật.
   *
   * Mặc định của nút là XEM TRƯỚC. Hàm này huỷ rồi tạo lại ô ca cho cả tháng, và trước
   * 13/09/2026 bảy con số chỉ hiện SAU KHI ĐÃ GHI — đúng hình dạng đã làm mất dữ liệu ở
   * đường nhập file. "Ghi thật" nay là bước xác nhận THỨ HAI.
   */
  const [che, setChe] = useState<null | "XEM" | "GHI">(null);

  if (blocks.length === 0) return null;

  function toggle(id: string) {
    doiThamSo(() => setChon((cu) => (cu.includes(id) ? cu.filter((x) => x !== id) : [...cu, id])));
  }

  function chay(ghiThat: boolean) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ky) || chon.length === 0) return;
    setKetQua(null);
    setChe(null);
    start(async () => {
      const r = ghiThat
        ? await generateMonthAction({ periodKey: ky, centerIds: chon })
        : await xemTruocSinhLuoiAction({ periodKey: ky, centerIds: chon });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setKetQua(r.data);
      setChe(ghiThat ? "GHI" : "XEM");
      if (ghiThat) {
        toast.success("Đã sinh lưới tháng");
        router.refresh();
      }
    });
  }

  /** Đổi kỳ / đổi khối thì bản chạy thử cũ không còn đúng — bỏ đi, đừng để người ta bấm
      "Ghi thật" dựa trên một bảng đã lạc hậu. Affordance phải nói thật (luật 12). */
  function doiThamSo(f: () => void) {
    f();
    setKetQua(null);
    setChe(null);
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BTN_PRIMARY}>
        <Wand2 aria-hidden className="h-4 w-4" />
        Sinh lưới từ khung
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Sinh lưới tháng từ khung ca</DialogTitle>
            <DialogDescription>
              Lấy khung ca tuần của từng người rải ra cả tháng. Không đè ô đã sửa tay, ô sinh từ đơn đã
              duyệt, ô từ file import. Chạy lại nhiều lần cho cùng một kỳ vẫn ra một kết quả.
            </DialogDescription>
          </DialogHeader>

          <fieldset disabled={pending} aria-busy={pending || undefined} className="space-y-4">
            <div>
              <label htmlFor="gen-ky" className="mb-1 block text-sm font-semibold text-foreground">
                Kỳ công
              </label>
              <input
                id="gen-ky"
                type="month"
                value={ky}
                onChange={(e) => doiThamSo(() => setKy(e.target.value))}
                aria-invalid={!/^\d{4}-(0[1-9]|1[0-2])$/.test(ky)}
                className={cn(FIELD, "w-48")}
              />
            </div>

            <div>
              <span className="mb-1 block text-sm font-semibold text-foreground">Khối áp dụng</span>
              <div className="flex flex-col gap-1.5">
                {blocks.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={chon.includes(b.id)}
                      onChange={() => toggle(b.id)}
                      className="h-4 w-4 rounded border-border accent-primary"
                    />
                    {b.label}
                  </label>
                ))}
              </div>
              {chon.length === 0 && (
                <p role="alert" className="mt-1 text-xs text-state-danger-ink">
                  Chọn ít nhất một khối.
                </p>
              )}
            </div>
          </fieldset>

          {ketQua && (
            <div className="mt-4 rounded-xl border border-border bg-muted/40 p-4">
              <p className="mb-2 text-sm font-semibold text-foreground">
                {che === "XEM" ? "CHẠY THỬ — chưa ghi gì" : "Đã ghi"} · Kỳ {ky} · {ketQua.people} người
              </p>
              {che === "XEM" && (
                <p className="mb-2 text-xs text-muted-foreground">
                  Bảng dưới là thứ SẼ xảy ra nếu bấm &ldquo;Ghi thật&rdquo;. Chưa câu lệnh ghi nào chạy.
                </p>
              )}
              <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                {SO_DO.map((s) => (
                  <div key={s.key} className="flex items-baseline justify-between gap-2">
                    <dt className="min-w-0 truncate text-sm text-muted-foreground" title={s.hint}>
                      {s.label}
                    </dt>
                    <dd className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                      {ketQua[s.key] as number}
                    </dd>
                  </div>
                ))}
              </dl>

              {che === "XEM" && ketQua.chiTiet.length > 0 && (
                <details className="mt-3 rounded-lg border border-border bg-card p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-foreground">
                    Chi tiết từng ngày ({ketQua.chiTiet.length} ô)
                  </summary>
                  {/* Bọc `PhanTrangBang` — cổng `components/ui/bang-coverage.test.ts` bắt được
                      bản đầu dùng `<table>` trần, VÀ nó đúng: bảng xem trước có thể vài trăm ô,
                      bản đầu của tôi cắt còn 300 dòng kèm câu "cắt bớt cho đỡ nặng" — tức bày ra
                      một NỬA sự thật ngay trong màn sinh ra để nói sự thật. */}
                  <div className="mt-2">
                    <PhanTrangBang tenDonVi="ô" khoaGhiNho="gen-chi-tiet" soDongMacDinh={20}>
                    <table className="w-full text-left text-xs">
                      <thead className="bg-card">
                        <tr className="text-muted-foreground">
                          <th scope="col" className="py-1 pr-2 font-semibold">Ngày</th>
                          <th scope="col" className="py-1 pr-2 font-semibold">Việc</th>
                          <th scope="col" className="py-1 pr-2 font-semibold">Mã cũ</th>
                          <th scope="col" className="py-1 font-semibold">Mã mới</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ketQua.chiTiet.map((c, i) => (
                          <tr key={`${c.userId}-${c.ngay}-${i}`} className="border-t border-border/60">
                            <td className="py-1 pr-2 tabular-nums">{ngayVi(c.ngay)}</td>
                            <td className="py-1 pr-2">{NHAN_VIEC[c.action] ?? c.action}</td>
                            <td className="py-1 pr-2 font-mono">{c.maCu || "—"}</td>
                            <td className="py-1 font-mono">{c.maMoi || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </PhanTrangBang>
                  </div>
                </details>
              )}

              {ketQua.restWarnings.length > 0 && (
                <div className="mt-3 rounded-lg border border-state-warning-soft bg-state-warning-soft p-3">
                  <p className="text-sm font-semibold text-state-warning-ink">
                    {ketQua.restWarnings.length} đợt làm 7 ngày liên tiếp không nghỉ (Điều 111 BLLĐ)
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-state-warning-ink">
                    {ketQua.restWarnings.slice(0, 8).map((w, i) => (
                      <li key={`${w.userId}-${w.from}-${i}`}>
                        {w.name && <span className="font-semibold">{w.name}</span>}
                        <span className="tabular-nums">
                          {w.name ? " · " : ""}
                          {ngayVi(w.from)} → {ngayVi(w.to)}
                        </span>
                      </li>
                    ))}
                    {ketQua.restWarnings.length > 8 && (
                      <li>… và {ketQua.restWarnings.length - 8} đợt nữa</li>
                    )}
                  </ul>
                  <p className="mt-1 text-xs text-state-warning-ink">
                    Chèn một ngày X hoặc P vào giữa đợt cho những người trên.
                  </p>
                </div>
              )}

              {ketQua.warnings.length > 0 && (
                <div className="mt-3 rounded-lg border border-state-danger-soft bg-state-danger-soft p-3">
                  <p className="text-sm font-semibold text-state-danger-ink">
                    {ketQua.warnings.length} cảnh báo khi đọc khung ca
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-state-danger-ink">
                    {ketQua.warnings.slice(0, 8).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                    {ketQua.warnings.length > 8 && <li>… và {ketQua.warnings.length - 8} cảnh báo nữa</li>}
                  </ul>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="mt-4">
            <button type="button" onClick={() => setOpen(false)} className={BTN_OUTLINE}>
              {che === "GHI" ? "Đóng" : "Huỷ"}
            </button>
            {/* MẶC ĐỊNH là chạy thử. "Ghi thật" chỉ hiện SAU khi đã có bảng để đọc — không ai
                xác nhận được một thứ chưa nhìn thấy. */}
            <button
              type="button"
              onClick={() => chay(false)}
              disabled={pending || chon.length === 0}
              className={che === "XEM" ? BTN_OUTLINE : BTN_PRIMARY}
            >
              {pending ? (
                <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 aria-hidden className="h-4 w-4" />
              )}
              {che ? "Chạy thử lại" : "Chạy thử"}
            </button>
            {che === "XEM" && (
              <button
                type="button"
                onClick={() => chay(true)}
                disabled={pending || chon.length === 0}
                className={BTN_PRIMARY}
              >
                {pending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null}
                Ghi thật
              </button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
