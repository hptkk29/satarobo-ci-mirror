"use client";

// 21/10/2026 — "Bù theo yêu cầu" trên TỪNG học viên của roster lớp. Chủ dự án chốt: gói 12/24/36 buổi vào lớp từ buổi kế tiếp (hoặc học vượt quá trần n) không bù gì
// nếu phụ huynh không yêu cầu; có yêu cầu thì Quản lý cơ sở tạo dòng cần bù và TỰ CHỌN tính phí / không tính phí. Dòng sinh ra rồi đi tiếp ở màn Học bù
// (xếp case → điểm danh) — nút này CHỈ tạo dòng cần bù, không xếp lịch, không tạo đơn phí.
// Server gác độc lập bằng `makeup:waive` (xem `app/(admin)/admin/hoc-bu/_actions.ts`); ẩn nút ở đây chỉ là lớp thứ hai.
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { History } from "lucide-react";
import { layBuoiDeBuAction, taoBuTheoYeuCauAction, type BuoiDeBuView } from "../../../../hoc-bu/_actions";

const MIN_REASON = 10;

export function YeuCauBu({ studentId, studentName }: { studentId: string; studentName: string }) {
  const [mo, setMo] = useState(false);
  const [pending, startTransition] = useTransition();
  const [buoi, setBuoi] = useState<BuoiDeBuView[] | null>(null);
  const [toiDa, setToiDa] = useState(12);
  const [chon, setChon] = useState<Set<string>>(new Set());
  const [chonPhi, setChonPhi] = useState<"TINH_PHI" | "KHONG_TINH_PHI" | "">("");
  const [lyDo, setLyDo] = useState("");
  const [loi, setLoi] = useState<string | null>(null);

  function dong() {
    if (pending) return;
    setMo(false);
    setBuoi(null);
    setChon(new Set());
    setChonPhi("");
    setLyDo("");
    setLoi(null);
  }

  function moHop() {
    setMo(true);
    setLoi(null);
    startTransition(async () => {
      const r = await layBuoiDeBuAction(studentId);
      if (!r.ok) return setLoi(r.error);
      setBuoi(r.buoi);
      setToiDa(r.toiDa);
    });
  }

  function bat(id: string) {
    setChon((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else if (n.size < toiDa) n.add(id);
      return n;
    });
  }

  function gui() {
    setLoi(null);
    if (chon.size === 0) return setLoi("Chọn ít nhất một buổi cần bù");
    if (!chonPhi) return setLoi("Chọn tính phí hay không tính phí");
    if (lyDo.trim().length < MIN_REASON) return setLoi(`Ghi yêu cầu của phụ huynh ít nhất ${MIN_REASON} ký tự`);
    startTransition(async () => {
      const r = await taoBuTheoYeuCauAction({ studentId, sessionIds: [...chon], chonPhi, lyDo });
      if (!r.ok) return setLoi(r.error);
      toast.success(`Đã tạo ${r.tao} buổi cần bù cho ${studentName}${r.boQua.length ? ` · bỏ qua ${r.boQua.length} buổi đã có dòng` : ""}`);
      if (r.boQua.length > 0) toast.message(r.boQua.map((b) => b.lyDo).join(" · "));
      dong();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={moHop}
        disabled={pending}
        title="Tạo buổi cần bù theo yêu cầu của phụ huynh (QLCS chọn tính phí / không tính phí)"
        aria-label={`Bù theo yêu cầu cho ${studentName}`}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
      >
        <History className="h-3.5 w-3.5" />
        <span className="hidden md:inline">Bù theo yêu cầu</span>
      </button>

      {mo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-lg">
            <h3 className="mb-1 text-lg font-bold text-foreground">Bù theo yêu cầu — {studentName}</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              Chọn các buổi <b>đã diễn ra</b> mà phụ huynh xin bù. Màn này chỉ tạo <b>dòng cần bù</b>; xếp lịch bù ở màn <b>Học bù</b>.
            </p>

            {buoi === null && !loi && <p className="mb-3 text-sm text-muted-foreground">Đang tải danh sách buổi…</p>}
            {buoi !== null && buoi.length === 0 && (
              <p className="mb-3 text-sm text-state-warning-ink">Không còn buổi nào đã diễn ra mà bé chưa có mặt.</p>
            )}
            {buoi !== null && buoi.length > 0 && (
              <ul className="mb-3 max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {buoi.map((b) => (
                  <li key={b.sessionId} className="px-3 py-2">
                    <label className="flex cursor-pointer items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={chon.has(b.sessionId)}
                        onChange={() => bat(b.sessionId)}
                        disabled={b.daCoDong}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                      />
                      <span className="font-medium text-foreground">{b.ngay}</span>
                      <span className="text-muted-foreground">{b.lop}</span>
                      {b.daCoDong && <span className="ml-auto text-xs text-muted-foreground">đã có dòng cần bù</span>}
                    </label>
                  </li>
                ))}
              </ul>
            )}

            <fieldset className="mb-3">
              <legend className="mb-1 text-sm font-semibold text-foreground">
                Phí bù <span className="text-state-danger-ink">*</span>
              </legend>
              <label className="mb-1 flex cursor-pointer items-start gap-2 text-sm">
                <input type="radio" name={`phi-${studentId}`} checked={chonPhi === "TINH_PHI"} onChange={() => setChonPhi("TINH_PHI")} className="mt-1" />
                <span>
                  <b>Tính phí</b> — mỗi buổi đòi phí bù, <b>không</b> dùng lượt miễn phí của học phần.
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="radio"
                  name={`phi-${studentId}`}
                  checked={chonPhi === "KHONG_TINH_PHI"}
                  onChange={() => setChonPhi("KHONG_TINH_PHI")}
                  className="mt-1"
                />
                <span>
                  <b>Không tính phí</b> — QLCS miễn phí, không trừ lượt.
                </span>
              </label>
            </fieldset>

            <label className="mb-3 block">
              <span className="mb-1 block text-sm font-semibold text-foreground">
                Yêu cầu của phụ huynh / lý do <span className="text-state-danger-ink">*</span>
              </span>
              <textarea
                value={lyDo}
                onChange={(e) => setLyDo(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder={`Ghi vào nhật ký — tối thiểu ${MIN_REASON} ký tự`}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </label>

            {loi && <p className="mb-3 rounded-lg bg-state-danger-soft px-3 py-2 text-sm font-medium text-state-danger-ink">{loi}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={dong}
                disabled={pending}
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
              >
                Huỷ
              </button>
              <button
                type="button"
                onClick={gui}
                disabled={pending || buoi === null || buoi.length === 0}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Đang tạo…" : `Tạo ${chon.size || ""} buổi cần bù`.replace("  ", " ")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
