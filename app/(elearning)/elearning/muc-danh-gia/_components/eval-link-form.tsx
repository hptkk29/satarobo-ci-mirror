"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { datMucGanDanhGiaAction } from "../../_actions";

/**
 * EL-21 — biểu mẫu bật/tắt liên kết đánh giá cho MỘT chương trình.
 *
 * ⚠️ Bật liên kết là gắn kết quả học vào lương của người khác. Sáu điều kiện của
 * QĐ-CDA-06b được nhắc NGAY TRÊN biểu mẫu chứ không giấu trong thông báo lỗi: người
 * bấm cần biết mình đang thiếu gì TRƯỚC khi bấm, thay vì bấm rồi bị từ chối và đoán.
 */
export function EvalLinkForm(props: {
  programId: string;
  tenChuongTrinh: string;
  hienTai: {
    mode: string;
    criteria: string[];
    weightOnTime: number | null;
    weightExamScore: number | null;
    decisionDocCode: string | null;
  } | null;
}) {
  const router = useRouter();
  const [dangChay, batDau] = useTransition();
  const [mo, setMo] = useState(false);
  const [f, setF] = useState({
    mode: props.hienTai?.mode ?? "REPORT_ONLY",
    onTime: props.hienTai?.criteria.includes("ON_TIME") ?? false,
    examScore: props.hienTai?.criteria.includes("EXAM_SCORE") ?? false,
    weightOnTime: String(props.hienTai?.weightOnTime ?? ""),
    weightExamScore: String(props.hienTai?.weightExamScore ?? ""),
    docCode: props.hienTai?.decisionDocCode ?? "",
    docEffectiveAt: "",
    effectiveFrom: "",
    hrUserId: "",
    lyDo: "",
  });

  const laLinked = f.mode === "LINKED";
  const tongTrongSo =
    (f.onTime ? Number(f.weightOnTime || 0) : 0) +
    (f.examScore ? Number(f.weightExamScore || 0) : 0);

  // Sáu điều kiện, kiểm ngay tại chỗ để nói ra cái nào còn thiếu.
  const thieu: string[] = [];
  if (laLinked) {
    if (!f.docCode.trim()) thieu.push("số hiệu quyết định");
    if (!f.docEffectiveAt) thieu.push("ngày hiệu lực của quyết định");
    if (!f.effectiveFrom) thieu.push("ngày bắt đầu áp dụng");
    if (!f.onTime && !f.examScore) thieu.push("ít nhất một tiêu chí");
    if (tongTrongSo !== 100) thieu.push(`tổng trọng số phải bằng 100 (đang ${tongTrongSo})`);
    if (!f.hrUserId.trim()) thieu.push("người của Nhân sự đồng phê duyệt");
  }
  const du = f.lyDo.trim().length >= 10 && thieu.length === 0;

  const luu = () =>
    batDau(async () => {
      const r = await datMucGanDanhGiaAction(
        {
          programId: props.programId,
          mode: f.mode as "REPORT_ONLY",
          criteria: [
            ...(f.onTime ? (["ON_TIME"] as const) : []),
            ...(f.examScore ? (["EXAM_SCORE"] as const) : []),
          ],
          weightOnTime: f.onTime && f.weightOnTime ? Number(f.weightOnTime) : null,
          weightExamScore:
            f.examScore && f.weightExamScore ? Number(f.weightExamScore) : null,
          effectiveFrom: f.effectiveFrom ? new Date(f.effectiveFrom) : null,
          decisionDocCode: f.docCode.trim() || null,
          decisionDocEffectiveAt: f.docEffectiveAt ? new Date(f.docEffectiveAt) : null,
          hrApprovedByUserId: f.hrUserId.trim() || null,
          centerId: null,
          orgUnitId: null,
        },
        // `reason` ở tham số THỨ HAI — schema `.strict()`.
        { reason: f.lyDo.trim() },
      );
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success(
        r.data.mode === "LINKED"
          ? "Đã bật liên kết đánh giá"
          : "Đã đặt về chế độ chỉ báo cáo",
      );
      setMo(false);
      router.refresh();
    });

  if (!mo) {
    return (
      <button
        type="button"
        onClick={() => setMo(true)}
        className="rounded-md border px-2 py-1 text-xs"
      >
        Đổi mức gắn
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border p-3 text-xs">
      <label className="block">
        <span className="text-muted-foreground">Chế độ</span>
        <select
          value={f.mode}
          onChange={(e) => setF((s) => ({ ...s, mode: e.target.value }))}
          className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
        >
          <option value="REPORT_ONLY">Chỉ báo cáo (mặc định)</option>
          <option value="LINKED">Có liên kết với đánh giá tháng</option>
        </select>
      </label>

      {laLinked ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={f.onTime}
                onChange={(e) => setF((s) => ({ ...s, onTime: e.target.checked }))}
              />
              Hoàn thành đúng hạn
            </label>
            <input
              type="number"
              min={0}
              max={100}
              disabled={!f.onTime}
              value={f.weightOnTime}
              onChange={(e) => setF((s) => ({ ...s, weightOnTime: e.target.value }))}
              placeholder="trọng số"
              className="rounded-md border px-2 py-1 disabled:opacity-40"
            />
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={f.examScore}
                onChange={(e) => setF((s) => ({ ...s, examScore: e.target.checked }))}
              />
              Điểm kiểm tra
            </label>
            <input
              type="number"
              min={0}
              max={100}
              disabled={!f.examScore}
              value={f.weightExamScore}
              onChange={(e) =>
                setF((s) => ({ ...s, weightExamScore: e.target.value }))
              }
              placeholder="trọng số"
              className="rounded-md border px-2 py-1 disabled:opacity-40"
            />
          </div>

          <label className="block">
            <span className="text-muted-foreground">
              Số hiệu quyết định sửa SR.QD.231
            </span>
            <input
              value={f.docCode}
              onChange={(e) => setF((s) => ({ ...s, docCode: e.target.value }))}
              placeholder="vd: SR.QD.231/PL-01"
              className="mt-1 w-full rounded-md border px-2 py-1"
            />
          </label>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="text-muted-foreground">Ngày hiệu lực quyết định</span>
              <input
                type="date"
                value={f.docEffectiveAt}
                onChange={(e) =>
                  setF((s) => ({ ...s, docEffectiveAt: e.target.value }))
                }
                className="mt-1 w-full rounded-md border px-2 py-1"
              />
            </label>
            <label className="block">
              <span className="text-muted-foreground">Ngày bắt đầu áp dụng</span>
              <input
                type="date"
                value={f.effectiveFrom}
                onChange={(e) => setF((s) => ({ ...s, effectiveFrom: e.target.value }))}
                className="mt-1 w-full rounded-md border px-2 py-1"
              />
              <span className="mt-0.5 block text-muted-foreground">
                {/* Nói vì sao phải ở tương lai — nếu không người ta điền hôm nay rồi
                    bị từ chối mà không hiểu. */}
                Phải ở tương lai: kỳ đã đóng thì người ta đã được xét theo luật cũ.
              </span>
            </label>
          </div>

          <label className="block">
            <span className="text-muted-foreground">
              Mã người của Nhân sự đồng phê duyệt
            </span>
            <input
              value={f.hrUserId}
              onChange={(e) => setF((s) => ({ ...s, hrUserId: e.target.value }))}
              placeholder="userId của người duyệt bên Nhân sự"
              className="mt-1 w-full rounded-md border px-2 py-1"
            />
          </label>

          {thieu.length > 0 ? (
            <p className="rounded-md bg-amber-50 px-2 py-1 text-amber-900">
              Còn thiếu: {thieu.join(" · ")}
            </p>
          ) : null}
        </>
      ) : null}

      <label className="block">
        <span className="text-muted-foreground">
          Lý do (bắt buộc, ít nhất 10 ký tự) — lưu vào nhật ký kèm giá trị cũ/mới
        </span>
        <input
          value={f.lyDo}
          onChange={(e) => setF((s) => ({ ...s, lyDo: e.target.value }))}
          maxLength={500}
          className="mt-1 w-full rounded-md border px-2 py-1"
        />
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={dangChay || !du}
          onClick={luu}
          className="rounded-md bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
        >
          {dangChay ? "Đang lưu…" : "Lưu"}
        </button>
        <button
          type="button"
          onClick={() => setMo(false)}
          className="rounded-md border px-3 py-1"
        >
          Thôi
        </button>
      </div>
    </div>
  );
}
