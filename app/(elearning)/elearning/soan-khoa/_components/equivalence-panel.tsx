"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { congNhanTuongDuongAction } from "../../chuong-trinh/_actions";

/**
 * EL-09 — CÔNG NHẬN TƯƠNG ĐƯƠNG cho một người trên một khoá.
 *
 * ⚠️ `congNhanTuongDuongAction` được khai từ EL-09 nhưng grep toàn kho ra **0 màn
 * nào gọi**. Hệ quả đo được: con số "công nhận tương đương" trên báo cáo tuân thủ
 * vĩnh viễn bằng 0 — không phải vì không ai đủ điều kiện, mà vì không ai ghi được.
 *
 * ⚠️ Đây là QUYẾT ĐỊNH về hồ sơ đào tạo của người khác, không phải thao tác soạn
 * nội dung: nó đòi `elearning:program:manage`, và bằng chứng là bắt buộc.
 */
export function EquivalencePanel(props: {
  courseId: string;
  nhanSu: { userId: string; ten: string }[];
}) {
  const router = useRouter();
  const [dangChay, batDau] = useTransition();
  const [mo, setMo] = useState(false);
  const [f, setF] = useState({ userId: "", evidenceSource: "", ngay: "", note: "" });

  const duDieuKien =
    f.userId !== "" && f.evidenceSource.trim().length >= 5;

  const ghi = () =>
    batDau(async () => {
      const r = await congNhanTuongDuongAction({
        userId: f.userId,
        courseId: props.courseId,
        evidenceSource: f.evidenceSource.trim(),
        // Ô trống ⇒ `null`, KHÔNG phải chuỗi rỗng: `z.coerce.date()` nuốt chuỗi rỗng
        // thành Invalid Date, còn `null` là "không rõ mốc gốc" — hai nghĩa khác nhau.
        originalEffectiveAt: f.ngay ? new Date(f.ngay) : null,
        note: f.note.trim() || null,
      });
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success("Đã công nhận tương đương");
      setMo(false);
      setF({ userId: "", evidenceSource: "", ngay: "", note: "" });
      router.refresh();
    });

  if (!mo) {
    return (
      <button
        type="button"
        onClick={() => setMo(true)}
        className="rounded-md border px-3 py-1.5 text-sm"
      >
        Công nhận tương đương cho một người
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      <p className="text-xs text-muted-foreground">
        Ghi nhận rằng một người ĐÃ đạt nội dung khoá này bằng con đường khác (chứng
        chỉ ngoài, khoá cũ, biên bản). Lượt học của họ sẽ được đánh dấu hoàn thành.
      </p>

      <label className="block text-xs">
        <span className="text-muted-foreground">Người được công nhận</span>
        <select
          value={f.userId}
          onChange={(e) => setF((s) => ({ ...s, userId: e.target.value }))}
          className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
        >
          <option value="">— chọn người —</option>
          {props.nhanSu.map((n) => (
            <option key={n.userId} value={n.userId}>
              {n.ten}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-xs">
        <span className="text-muted-foreground">
          Bằng chứng (chứng chỉ, biên bản, quyết định…) — bắt buộc
        </span>
        <input
          value={f.evidenceSource}
          onChange={(e) => setF((s) => ({ ...s, evidenceSource: e.target.value }))}
          maxLength={500}
          placeholder="vd: Chứng chỉ ATLĐ số 123/2025 do Sở LĐTBXH cấp"
          className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
        />
      </label>

      <label className="block text-xs">
        <span className="text-muted-foreground">
          Ngày hiệu lực gốc (để trống nếu không rõ)
        </span>
        <input
          type="date"
          value={f.ngay}
          onChange={(e) => setF((s) => ({ ...s, ngay: e.target.value }))}
          className="mt-1 block rounded-md border px-2 py-1 text-sm"
        />
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {/* Nói vì sao ô này quan trọng: nó không chỉ để lưu trữ. */}
          Mốc này quyết định hạn tái chứng nhận sau đó.
        </span>
      </label>

      <label className="block text-xs">
        <span className="text-muted-foreground">Ghi chú (không bắt buộc)</span>
        <input
          value={f.note}
          onChange={(e) => setF((s) => ({ ...s, note: e.target.value }))}
          maxLength={500}
          className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
        />
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={dangChay || !duDieuKien}
          onClick={ghi}
          className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
        >
          {dangChay ? "Đang ghi…" : "Công nhận"}
        </button>
        <button
          type="button"
          onClick={() => setMo(false)}
          className="rounded-md border px-3 py-1.5 text-xs"
        >
          Thôi
        </button>
      </div>
    </div>
  );
}
