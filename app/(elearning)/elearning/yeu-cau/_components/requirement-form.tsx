"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { khaiYeuCauAction } from "../../_actions";

/**
 * EL-17 — biểu mẫu KHAI YÊU CẦU ĐÀO TẠO.
 *
 * ⚠️ `POSITION` cố ý KHÔNG có trong ô chọn.
 *
 * Bảng `Position` rỗng trên prod (0 dòng, đo 20/08/2026), nên một yêu cầu khai theo
 * vị trí áp cho 0 người — và nó KHÔNG báo lỗi: ma trận chỉ hiện một hàng ô lạ, còn
 * người khai thì tưởng đã xong việc. Kế hoạch chốt "lựa chọn `POSITION` bị vô hiệu
 * hoá CÓ LÝ DO" (EL-03 AC14).
 *
 * Vô hiệu hoá kèm câu giải thích, không phải im lặng giấu đi: người đi tìm nó phải
 * biết vì sao không có, nếu không họ sẽ báo là hệ thống thiếu chức năng.
 */

type Chon = { id: string; nhan: string };

const PHAM_VI: { ma: string; nhan: string; can: "phong" | "donVi" | "bac" | null }[] = [
  { ma: "ALL_STAFF", nhan: "Toàn công ty", can: null },
  { ma: "DEPARTMENT", nhan: "Theo phòng ban", can: "phong" },
  { ma: "ORG_UNIT", nhan: "Theo đơn vị (gồm cả nhánh dưới)", can: "donVi" },
  { ma: "LEVEL_TAG", nhan: "Theo bậc công việc", can: "bac" },
];

export function RequirementForm(props: {
  khoa: { id: string; title: string }[];
  phongBan: { id: string; name: string }[];
  donVi: Chon[];
  phamViChuaDung: Record<string, string>;
}) {
  const router = useRouter();
  const [dangChay, batDau] = useTransition();
  const [mo, setMo] = useState(false);
  const [f, setF] = useState({
    courseId: "",
    scopeKind: "ALL_STAFF",
    departmentId: "",
    orgUnitId: "",
    levelTag: "",
    dueDays: "30",
    validityMonths: "",
    lyDo: "",
  });

  const pv = PHAM_VI.find((p) => p.ma === f.scopeKind);
  const canGiaTri =
    pv?.can === "phong"
      ? f.departmentId
      : pv?.can === "donVi"
        ? f.orgUnitId
        : pv?.can === "bac"
          ? f.levelTag
          : "co";
  const du =
    f.courseId !== "" && !!canGiaTri && f.lyDo.trim().length >= 10 && f.dueDays !== "";

  // Cảnh báo tại chỗ cho phạm vi chưa tra được ai — hiện TRƯỚC khi bấm.
  const canhBao = props.phamViChuaDung[f.scopeKind] ?? null;

  const khai = () =>
    batDau(async () => {
      const r = await khaiYeuCauAction(
        {
          courseId: f.courseId,
          scopeKind: f.scopeKind as "ALL_STAFF",
          departmentId: pv?.can === "phong" ? f.departmentId : null,
          // ⚠️ `orgUnitId` kiêm HAI VAI: cột đơn vị của bản ghi, và cột đích khi
          // phạm vi là `ORG_UNIT`. Ở phạm vi khác phải để trống, nếu không zod bác.
          orgUnitId: pv?.can === "donVi" ? f.orgUnitId : null,
          levelTag: pv?.can === "bac" ? (f.levelTag as "L1") : null,
          positionId: null,
          dueDays: Number(f.dueDays),
          validityMonths: f.validityMonths ? Number(f.validityMonths) : null,
          effectiveTo: null,
          status: "ACTIVE",
          createdByUserId: null,
          centerId: null,
        },
        { reason: f.lyDo.trim() },
      );
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      toast.success("Đã khai yêu cầu đào tạo");
      setMo(false);
      setF({ ...f, courseId: "", lyDo: "" });
      router.refresh();
    });

  if (!mo) {
    return (
      <button
        type="button"
        onClick={() => setMo(true)}
        className="rounded-md border px-3 py-1.5 text-sm"
      >
        Khai yêu cầu đào tạo
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border p-3 text-sm">
      <p className="text-xs text-muted-foreground">
        Yêu cầu là nghĩa vụ áp cho người khác: nó quyết định ai bị đếm là chưa tuân
        thủ và tên ai xuất hiện trên báo cáo gửi quản lý trực tiếp.
      </p>

      <label className="block text-xs">
        <span className="text-muted-foreground">Khoá phải đạt</span>
        <select
          value={f.courseId}
          onChange={(e) => setF((s) => ({ ...s, courseId: e.target.value }))}
          className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
        >
          <option value="">— chọn khoá đã xuất bản —</option>
          {props.khoa.map((k) => (
            <option key={k.id} value={k.id}>
              {k.title}
            </option>
          ))}
        </select>
        {props.khoa.length === 0 ? (
          <span className="mt-0.5 block text-amber-800">
            Chưa có khoá nào ở trạng thái đã xuất bản — khai yêu cầu trỏ vào một khoá
            chưa xuất bản là ra nghĩa vụ không ai học được.
          </span>
        ) : null}
      </label>

      <label className="block text-xs">
        <span className="text-muted-foreground">Áp cho ai</span>
        <select
          value={f.scopeKind}
          onChange={(e) => setF((s) => ({ ...s, scopeKind: e.target.value }))}
          className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
        >
          {PHAM_VI.map((p) => (
            <option key={p.ma} value={p.ma}>
              {p.nhan}
            </option>
          ))}
        </select>
        <span className="mt-0.5 block text-muted-foreground">
          Không có lựa chọn &ldquo;theo vị trí&rdquo;: hệ thống vị trí chưa có dữ liệu
          nào, nên một yêu cầu khai theo vị trí sẽ áp cho 0 người mà không báo gì.
        </span>
      </label>

      {canhBao ? (
        <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">
          {canhBao}
        </p>
      ) : null}

      {pv?.can === "phong" ? (
        <label className="block text-xs">
          <span className="text-muted-foreground">Phòng ban</span>
          <select
            value={f.departmentId}
            onChange={(e) => setF((s) => ({ ...s, departmentId: e.target.value }))}
            className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
          >
            <option value="">— chọn phòng ban —</option>
            {props.phongBan.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {pv?.can === "donVi" ? (
        <label className="block text-xs">
          <span className="text-muted-foreground">Đơn vị</span>
          <select
            value={f.orgUnitId}
            onChange={(e) => setF((s) => ({ ...s, orgUnitId: e.target.value }))}
            className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
          >
            <option value="">— chọn đơn vị —</option>
            {props.donVi.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nhan}
              </option>
            ))}
          </select>
          <span className="mt-0.5 block text-muted-foreground">
            Chọn đơn vị cha thì áp cho cả nhánh dưới.
          </span>
        </label>
      ) : null}

      {pv?.can === "bac" ? (
        <label className="block text-xs">
          <span className="text-muted-foreground">Bậc công việc</span>
          <select
            value={f.levelTag}
            onChange={(e) => setF((s) => ({ ...s, levelTag: e.target.value }))}
            className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
          >
            <option value="">— chọn bậc —</option>
            {["L1", "L2", "L3", "L4"].map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs">
          <span className="text-muted-foreground">Hạn (ngày kể từ khi áp)</span>
          <input
            type="number"
            min={0}
            value={f.dueDays}
            onChange={(e) => setF((s) => ({ ...s, dueDays: e.target.value }))}
            className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
          />
        </label>
        <label className="block text-xs">
          <span className="text-muted-foreground">
            Chu kỳ tái chứng nhận (tháng, để trống = vô hạn)
          </span>
          <input
            type="number"
            min={1}
            value={f.validityMonths}
            onChange={(e) => setF((s) => ({ ...s, validityMonths: e.target.value }))}
            className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
          />
          <span className="mt-0.5 block text-muted-foreground">
            {/* Nói ra rằng ô này là NGUỒN SỰ THẬT của hạn chứng nhận — người khai
                cần biết mình đang quyết định gì. */}
            Ô này quyết định hạn hiệu lực của chứng nhận, không phải cột trên chương
            trình.
          </span>
        </label>
      </div>

      <label className="block text-xs">
        <span className="text-muted-foreground">
          Lý do (bắt buộc, ít nhất 10 ký tự) — lưu vào nhật ký
        </span>
        <input
          value={f.lyDo}
          onChange={(e) => setF((s) => ({ ...s, lyDo: e.target.value }))}
          maxLength={500}
          placeholder="vd: theo quy định ATLĐ SR.QD.112 hiệu lực 01/2026"
          className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
        />
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={dangChay || !du}
          onClick={khai}
          className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
        >
          {dangChay ? "Đang lưu…" : "Khai yêu cầu"}
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
