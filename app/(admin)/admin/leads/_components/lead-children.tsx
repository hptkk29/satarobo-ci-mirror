"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil, X, Check, Baby, UserX, Undo2 } from "lucide-react";
import { toast } from "sonner";
import {
  addLeadChild,
  updateLeadChild,
  deleteLeadChild,
  markLeadChildLostAction,
  unmarkLeadChildLostAction,
} from "../actions";
import { LEAD_CHILD_STATUS_BADGE, LEAD_CHILD_STATUS_LABEL } from "@/lib/lead/lost-status-labels";
import {
  groupTeachableCourses,
  type CourseOptGroup,
  type TeachableCourse,
} from "@/lib/courses/grouped";
import {
  CONTRACT_VALUE_HINT,
  CONTRACT_VALUE_LABEL,
  CONTRACT_VALUE_MAX,
} from "@/lib/lead/contract-value";
import { formatVndPlain } from "@/lib/format/money";
import { MoneyInput } from "@/components/ui/money-input";

export type Option = { id: string; name: string };

type ChildStatusKey = keyof typeof LEAD_CHILD_STATUS_LABEL;

export type ChildDraft = {
  fullName: string;
  dob: string; // yyyy-mm-dd hoặc ""
  ageYears: string;
  gender: string;
  schoolName: string;
  gradeLevel: string;
  interestedCourseId: string;
  interestedCenterId: string;
  /** G-01 — lớp đang học TẠI trung tâm (Class.id). "" = chưa xếp lớp. */
  classId: string;
  note: string;
  /** G-06 — giá trị hợp đồng ĐÃ KÝ (VND, chuỗi trong nháp). "" = chưa nhập. */
  contractValue: string;
};

export type ChildView = {
  id: string;
  fullName: string;
  dob: string | null; // ISO date
  ageYears: number | null;
  gender: string | null;
  schoolName: string | null;
  gradeLevel: string | null;
  interestedCourseId: string | null;
  interestedCenterId: string | null;
  /** G-01 — lớp đang học TẠI trung tâm (Class.id). null = chưa xếp lớp. */
  classId: string | null;
  note: string | null;
  /**
   * G-06 — giá trị hợp đồng ĐÃ KÝ (VND). 🔴 KHÔNG phải tiền đã thu; doanh thu lấy
   * từ khoản thanh toán đã xác nhận (quyết định B3). null = chưa nhập, KHÁC số 0.
   */
  contractValue: number | null;
  /** G-06 — mốc chốt (ISO). Máy ghi ở đường chốt ghi danh, người không sửa tay. */
  closedAt?: string | null;
  trialStatus: string;
  /** C-06 — trạng thái phễu của riêng con này. null = phiếu cũ, chưa ai phân loại. */
  status?: string | null;
  // FL-R2 (item 6/TR-4) — lịch sử đã từng học thử (giữ kể cả khi lead quay lại pipeline).
  trialHistory?: {
    className: string;
    attendedCount: number;
    totalSessions: number;
    lastAttendedAt: string | null; // ISO
    outcome: string | null;
  }[];
};

/** "Đã học thử (ngày…) · n/N buổi" cho 1 dòng lịch sử. */
function formatTrialHistory(h: NonNullable<ChildView["trialHistory"]>[number]): string {
  const date = h.lastAttendedAt
    ? new Date(h.lastAttendedAt).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
    : null;
  const parts = [`Đã học thử${date ? ` (${date})` : ""}`, `${h.attendedCount}/${h.totalSessions} buổi`, h.className];
  return parts.filter(Boolean).join(" · ");
}

export const emptyChild: ChildDraft = {
  fullName: "",
  dob: "",
  ageYears: "",
  gender: "",
  schoolName: "",
  gradeLevel: "",
  interestedCourseId: "",
  interestedCenterId: "",
  classId: "",
  note: "",
  contractValue: "",
};

const GENDERS = ["Nam", "Nữ", "Khác"];

const TRIAL_LABEL: Record<string, string> = {
  NONE: "Chưa học thử",
  SCHEDULED: "Đã hẹn học thử",
  IN_PROGRESS: "Đang học thử",
  ATTENDED: "Đã học thử",
};

const inputCls =
  "w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none";

/** Chuyển draft (string) → payload gửi server (bỏ field rỗng). */
export function childDraftToPayload(d: ChildDraft): Record<string, unknown> {
  return {
    fullName: d.fullName.trim(),
    dob: d.dob || undefined,
    ageYears: d.ageYears ? Number(d.ageYears) : undefined,
    gender: d.gender || undefined,
    schoolName: d.schoolName.trim() || undefined,
    gradeLevel: d.gradeLevel.trim() || undefined,
    interestedCourseId: d.interestedCourseId || undefined,
    interestedCenterId: d.interestedCenterId || undefined,
    classId: d.classId || undefined,
    note: d.note.trim() || undefined,
    // G-06 — gửi chuỗi thô; validator (`parseContractValue`) tự bóc dấu phân cách.
    // `undefined` khi để trống ⇒ giữ nguyên giá trị cũ thay vì xoá trắng.
    contractValue: d.contractValue.trim() || undefined,
  };
}

function viewToDraft(c: ChildView): ChildDraft {
  return {
    fullName: c.fullName,
    dob: c.dob ? c.dob.slice(0, 10) : "",
    ageYears: c.ageYears != null ? String(c.ageYears) : "",
    gender: c.gender ?? "",
    schoolName: c.schoolName ?? "",
    gradeLevel: c.gradeLevel ?? "",
    interestedCourseId: c.interestedCourseId ?? "",
    interestedCenterId: c.interestedCenterId ?? "",
    classId: c.classId ?? "",
    note: c.note ?? "",
    // `!= null` chứ không `||`: hợp đồng 0 đồng (học bổng toàn phần) là giá trị
    // thật, `||` sẽ hiện ô trống và lượt lưu kế tiếp xoá mất con số 0 đó.
    contractValue: c.contractValue != null ? String(c.contractValue) : "",
  };
}

/** Bộ field cho 1 con — dùng chung cho form tạo lead (nháp) và quản lý chi tiết. */
export function ChildFields({
  value,
  onChange,
  centers,
  courseGroups,
  classes = [],
}: {
  value: ChildDraft;
  onChange: (patch: Partial<ChildDraft>) => void;
  centers: Option[];
  courseGroups: CourseOptGroup[];
  /**
   * G-01 — lớp đang mở của trung tâm, để chọn "Lớp tại trung tâm". Danh sách đã
   * qua `scopedDb` ở page nên chỉ có lớp trong tầm nhìn cơ sở của actor.
   * Mặc định rỗng: ô tự ẩn thay vì vẽ một select không có lựa chọn nào.
   */
  classes?: Option[];
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="block sm:col-span-2">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Họ tên con *</span>
        <input
          value={value.fullName}
          onChange={(e) => onChange({ fullName: e.target.value })}
          className={inputCls}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Ngày sinh</span>
        <input
          type="date"
          value={value.dob}
          onChange={(e) => onChange({ dob: e.target.value })}
          className={inputCls}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Tuổi</span>
        <input
          type="number"
          min={3}
          max={18}
          value={value.ageYears}
          onChange={(e) => onChange({ ageYears: e.target.value })}
          className={inputCls}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Giới tính</span>
        <select
          value={value.gender}
          onChange={(e) => onChange({ gender: e.target.value })}
          className={inputCls}
        >
          <option value="">—</option>
          {GENDERS.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Lớp/Khối</span>
        <input
          value={value.gradeLevel}
          onChange={(e) => onChange({ gradeLevel: e.target.value })}
          className={inputCls}
          placeholder="VD: Lớp 4"
        />
      </label>
      <label className="block sm:col-span-2">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Trường</span>
        <input
          value={value.schoolName}
          onChange={(e) => onChange({ schoolName: e.target.value })}
          className={inputCls}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Khoá quan tâm</span>
        <select
          value={value.interestedCourseId}
          onChange={(e) => onChange({ interestedCourseId: e.target.value })}
          className={inputCls}
        >
          <option value="">— Chưa chọn —</option>
          {courseGroups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Cơ sở quan tâm</span>
        <select
          value={value.interestedCenterId}
          onChange={(e) => onChange({ interestedCenterId: e.target.value })}
          className={inputCls}
        >
          <option value="">— Chưa chọn —</option>
          {centers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {/* G-01 — LỚP ĐANG HỌC tại trung tâm. Ẩn khi không truyền danh sách lớp:
          một <select> chỉ có mục "— Chưa xếp lớp —" chỉ tổ làm người dùng tưởng
          trung tâm không còn lớp nào. */}
      {classes.length > 0 && (
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">
            Lớp tại trung tâm
          </span>
          <select
            value={value.classId}
            onChange={(e) => onChange({ classId: e.target.value })}
            className={inputCls}
          >
            <option value="">— Chưa xếp lớp —</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {/* G-06 — GIÁ TRỊ HỢP ĐỒNG ĐÃ KÝ. Nhãn + chú giải lấy từ
          lib/lead/contract-value.ts để không màn nào tự gọi nó là "doanh thu":
          cộng cột này vào báo cáo doanh thu là làm tổng phồng đúng bằng phần
          khách chưa đóng, mà con số vẫn trông hợp lý nên không ai phát hiện. */}
      <label className="block sm:col-span-2">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">
          {CONTRACT_VALUE_LABEL}
        </span>
        <MoneyInput
          name={`contractValue-${value.fullName || "moi"}`}
          value={value.contractValue}
          onValueChange={(n) => onChange({ contractValue: n == null ? "" : String(n) })}
          max={CONTRACT_VALUE_MAX}
          className={inputCls}
        />
        <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
          {CONTRACT_VALUE_HINT}
        </span>
      </label>
      <label className="block sm:col-span-2">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Ghi chú</span>
        <textarea
          value={value.note}
          onChange={(e) => onChange({ note: e.target.value })}
          rows={2}
          className={inputCls}
        />
      </label>
    </div>
  );
}

/**
 * Quản lý danh sách con đã lưu của 1 lead (trang chi tiết / sửa). Mỗi thao tác
 * gọi server action ngay (addLeadChild / updateLeadChild / deleteLeadChild) trong
 * useTransition rồi router.refresh().
 *
 * - `readOnly` (lead LOST/đã chốt…): chỉ hiển thị, không cho sửa.
 * - Field phẳng cũ (childName/childAge) hiển thị read-only + nút "Đưa vào danh sách con".
 *
 * ⚠️ Nhãn nút KHÔNG được mang tên bảng. Chủ dự án 16/09: *"sửa chữ tạo leadchild mới thành
 * ngôn ngữ user luôn đi"*. "LeadChild" là tên MODEL — người bán không biết và không cần
 * biết; thứ họ thấy là "con của khách". Nút này lấy thông tin con kiểu cũ (hai ô phẳng
 * `childName`/`childAge` của lead đời đầu) rồi mở form thêm con đã điền sẵn.
 */
export function LeadChildrenManager({
  leadId,
  childrenList,
  centers,
  courses,
  classes = [],
  readOnly = false,
  legacyChildName,
  legacyChildAge,
  lostNote,
  lostAt,
}: {
  leadId: string;
  childrenList: ChildView[];
  centers: Option[];
  courses: TeachableCourse[];
  /** G-01 — lớp đang mở (đã lọc theo cơ sở của actor ở page). */
  classes?: Option[];
  readOnly?: boolean;
  legacyChildName?: string | null;
  legacyChildAge?: number | null;
  /** C-06 — lý do rớt của CẢ PHIẾU (một ô, dùng chung cho mọi con đang rớt). */
  lostNote?: string | null;
  lostAt?: string | null; // ISO
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const courseGroups = groupTeachableCourses(courses);
  const courseName = (id: string | null) =>
    id ? courses.find((c) => c.id === id)?.name ?? null : null;
  const centerName = (id: string | null) =>
    id ? centers.find((c) => c.id === id)?.name ?? null : null;
  // G-01 — `classId` không ràng FK cứng (như `interestedCenterId`), nên lớp đã xoá
  // để lại một mã mồ côi. Trả null ⇒ dòng tóm tắt bỏ qua, không in mã cuid ra màn.
  const className = (id: string | null) =>
    id ? classes.find((c) => c.id === id)?.name ?? null : null;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<ChildDraft>(emptyChild);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  // C-06 — con đang mở ô "lý do rớt" + nội dung đang gõ.
  const [lostForId, setLostForId] = useState<string | null>(null);
  const [lostDraft, setLostDraft] = useState("");

  const patch = (p: Partial<ChildDraft>) => setForm((f) => ({ ...f, ...p }));

  const lostCount = childrenList.filter((c) => c.status === "LOST").length;

  function startLost(id: string) {
    setAdding(false);
    setEditingId(null);
    setDeleteId(null);
    // Gợi sẵn lý do đang có của phiếu: ô này DÙNG CHUNG cho mọi con, nên người dùng
    // phải nhìn thấy thứ mình sắp ghi đè trước khi bấm lưu.
    setLostDraft(lostNote ?? "");
    setLostForId(id);
  }
  function cancelLost() {
    setLostForId(null);
    setLostDraft("");
  }
  function saveLost(id: string) {
    const note = lostDraft.trim();
    if (!note) {
      toast.error("Bắt buộc nhập lý do rớt");
      return;
    }
    startTransition(async () => {
      const res = await markLeadChildLostAction({ leadChildId: id, lostNote: note });
      if (res.ok) {
        toast.success("Đã đánh dấu rớt");
        cancelLost();
        router.refresh();
      } else {
        toast.error(res.error ?? "Lỗi");
      }
    });
  }
  function undoLost(id: string) {
    startTransition(async () => {
      const res = await unmarkLeadChildLostAction({ leadChildId: id, status: "CONSULTING" });
      if (res.ok) {
        // Nói thẳng chuyện lý do của phiếu còn hay mất: đây là ô dùng chung, người bấm
        // cần biết mình vừa động vào dữ liệu của đứa con khác hay không.
        toast.success(
          lostCount > 1
            ? "Đã gỡ rớt — vẫn còn con khác đang rớt nên giữ nguyên lý do của phiếu"
            : "Đã gỡ rớt — đã xoá lý do rớt của phiếu",
        );
        router.refresh();
      } else {
        toast.error(res.error ?? "Lỗi");
      }
    });
  }

  function startAdd(prefill?: Partial<ChildDraft>) {
    setEditingId(null);
    setDeleteId(null);
    setForm({ ...emptyChild, ...prefill });
    setAdding(true);
  }
  function startEdit(c: ChildView) {
    setAdding(false);
    setDeleteId(null);
    setForm(viewToDraft(c));
    setEditingId(c.id);
  }
  function cancel() {
    setAdding(false);
    setEditingId(null);
    setForm(emptyChild);
  }

  function save() {
    if (!form.fullName.trim()) {
      toast.error("Nhập họ tên con");
      return;
    }
    const payload = childDraftToPayload(form);
    startTransition(async () => {
      const res = editingId
        ? await updateLeadChild(editingId, payload)
        : await addLeadChild({ leadId, ...payload });
      if (res.ok) {
        toast.success(editingId ? "Đã lưu thông tin con" : "Đã thêm con");
        cancel();
        router.refresh();
      } else {
        toast.error(res.error ?? "Lỗi");
      }
    });
  }

  function remove(id: string) {
    if (deleteId !== id) {
      setDeleteId(id);
      return;
    }
    startTransition(async () => {
      const res = await deleteLeadChild(id);
      if (res.ok) {
        toast.success("Đã xoá con");
        setDeleteId(null);
        router.refresh();
      } else {
        toast.error(res.error ?? "Lỗi");
      }
    });
  }

  const showLegacy = !!legacyChildName || legacyChildAge != null;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
          <Baby size={16} /> Con của phụ huynh ({childrenList.length})
        </h2>
        {!readOnly && !adding && editingId === null && (
          <button
            type="button"
            onClick={() => startAdd()}
            className="inline-flex items-center gap-1 rounded-lg border-2 border-primary px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary-soft"
          >
            <Plus size={14} /> Thêm con
          </button>
        )}
      </div>

      {/* Thông tin con kiểu CŨ (hai ô phẳng trên chính bản ghi lead) — chỉ đọc, kèm nút
          đưa nó thành một hồ sơ con thật trong danh sách bên dưới. */}
      {showLegacy && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border bg-muted px-3 py-2">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Thông tin con (cũ):</span>{" "}
            {legacyChildName || "—"}
            {legacyChildAge != null && <span> · {legacyChildAge} tuổi</span>}
          </p>
          {!readOnly && (
            <button
              type="button"
              onClick={() =>
                startAdd({
                  fullName: legacyChildName ?? "",
                  ageYears: legacyChildAge != null ? String(legacyChildAge) : "",
                })
              }
              className="inline-flex items-center gap-1 rounded-md border border-primary px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary-soft"
            >
              <Plus size={12} /> Đưa vào danh sách con
            </button>
          )}
        </div>
      )}

      {/* Danh sách con đã lưu */}
      {childrenList.length === 0 && !adding && (
        <p className="py-4 text-center text-sm text-muted-foreground">Chưa có con nào.</p>
      )}

      <ul className="space-y-2">
        {childrenList.map((c) =>
          editingId === c.id ? (
            <li key={c.id} className="rounded-lg border border-primary-soft bg-primary-soft/40 p-3">
              <ChildFields
                value={form}
                onChange={patch}
                centers={centers}
                courseGroups={courseGroups}
                classes={classes}
              />
              <EditorButtons isPending={isPending} onSave={save} onCancel={cancel} />
            </li>
          ) : (
            <li
              key={c.id}
              className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border bg-muted px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{c.fullName}</span>
                  {c.ageYears != null && (
                    <span className="text-xs text-muted-foreground">{c.ageYears} tuổi</span>
                  )}
                  {c.gender && <span className="text-xs text-muted-foreground">· {c.gender}</span>}
                  <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary">
                    {TRIAL_LABEL[c.trialStatus] ?? c.trialStatus}
                  </span>
                  {c.status && LEAD_CHILD_STATUS_LABEL[c.status as ChildStatusKey] && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${LEAD_CHILD_STATUS_BADGE[c.status as ChildStatusKey]}`}
                    >
                      {LEAD_CHILD_STATUS_LABEL[c.status as ChildStatusKey]}
                    </span>
                  )}
                </div>
                {/* C-06 — lý do rớt là của CẢ PHIẾU: hiện ngay dưới đứa đang rớt để
                    người dùng thấy nó dùng chung, và thấy nó bị đè khi đánh dấu đứa kế. */}
                {c.status === "LOST" && lostNote && (
                  <p className="mt-1 text-xs text-state-danger-ink">
                    <span className="font-semibold">Lý do rớt (cả phiếu):</span> {lostNote}
                    {lostAt && (
                      <span className="text-muted-foreground">
                        {" "}
                        ·{" "}
                        {new Date(lostAt).toLocaleDateString("vi-VN", {
                          timeZone: "Asia/Ho_Chi_Minh",
                        })}
                      </span>
                    )}
                  </p>
                )}
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {[
                    c.gradeLevel,
                    c.schoolName,
                    courseName(c.interestedCourseId),
                    centerName(c.interestedCenterId),
                    // G-01 — nói rõ đây là lớp ĐANG HỌC, kẻo lẫn với "cơ sở quan tâm"
                    // đứng ngay trước nó trong cùng một dòng.
                    className(c.classId) ? `Lớp: ${className(c.classId)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </div>
                {/* G-06 — giá trị hợp đồng + mốc chốt. Nhãn phải NÓI RÕ "đã ký":
                    con số này là cam kết của Sale, KHÔNG phải tiền đã vào — doanh
                    thu thật nằm ở tab Tài chính, tính từ khoản đã xác nhận. */}
                {(c.contractValue != null || c.closedAt) && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs">
                    {c.contractValue != null && (
                      <span className="text-muted-foreground">
                        {CONTRACT_VALUE_LABEL}:{" "}
                        <span className="font-semibold text-foreground">
                          {formatVndPlain(c.contractValue)}
                        </span>
                      </span>
                    )}
                    {c.closedAt && (
                      <span className="text-muted-foreground">
                        Chốt:{" "}
                        {new Date(c.closedAt).toLocaleDateString("vi-VN", {
                          timeZone: "Asia/Ho_Chi_Minh",
                        })}
                      </span>
                    )}
                  </div>
                )}
                {c.note && <p className="mt-1 text-xs text-muted-foreground">{c.note}</p>}
                {c.trialHistory && c.trialHistory.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {c.trialHistory.map((h, i) => (
                      <p key={i} className="text-[11px] font-medium text-primary">
                        {formatTrialHistory(h)}
                      </p>
                    ))}
                  </div>
                )}
              </div>
              {!readOnly && (
                <div className="flex flex-shrink-0 items-center gap-1">
                  {c.status === "LOST" ? (
                    <button
                      type="button"
                      onClick={() => undoLost(c.id)}
                      disabled={isPending}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-card disabled:opacity-50"
                    >
                      <Undo2 size={12} /> Gỡ rớt
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startLost(c.id)}
                      disabled={isPending}
                      className="inline-flex items-center gap-1 rounded-md border border-state-danger px-2 py-1 text-xs text-state-danger-ink hover:bg-state-danger-soft disabled:opacity-50"
                    >
                      <UserX size={12} /> Đánh dấu rớt
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => startEdit(c)}
                    disabled={isPending}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-card disabled:opacity-50"
                  >
                    <Pencil size={12} /> Sửa
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(c.id)}
                    disabled={isPending}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs disabled:opacity-50 ${ deleteId === c.id ? "border-state-danger bg-state-danger text-white" : "border-state-danger text-state-danger-ink hover:bg-state-danger-soft" }`}
                  >
                    <Trash2 size={12} /> {deleteId === c.id ? "Xác nhận" : "Xoá"}
                  </button>
                </div>
              )}

              {/* C-06 — ô lý do rớt: BẮT BUỘC, tự do (không danh mục — quyết định 12(b)) */}
              {!readOnly && lostForId === c.id && (
                <div className="w-full rounded-lg border border-state-danger bg-state-danger-soft/40 p-3">
                  <label
                    htmlFor={`lost-note-${c.id}`}
                    className="mb-1 block text-xs font-semibold text-state-danger-ink"
                  >
                    Lý do rớt của {c.fullName} <span aria-hidden>*</span>
                  </label>
                  <textarea
                    id={`lost-note-${c.id}`}
                    value={lostDraft}
                    onChange={(e) => setLostDraft(e.target.value)}
                    rows={2}
                    maxLength={2000}
                    placeholder="Vì sao phụ huynh không đăng ký? (bắt buộc)"
                    className={inputCls}
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Lý do lưu ở cấp phụ huynh — dùng chung cho mọi con đang rớt của phiếu này.
                    {lostCount > 0 && " Lưu lượt này sẽ ghi đè lý do đang có."}
                  </p>
                  <EditorButtons
                    isPending={isPending}
                    onSave={() => saveLost(c.id)}
                    onCancel={cancelLost}
                  />
                </div>
              )}
            </li>
          ),
        )}
      </ul>

      {/* Form thêm con */}
      {adding && (
        <div className="mt-2 rounded-lg border border-primary-soft bg-primary-soft/40 p-3">
          <ChildFields
            value={form}
            onChange={patch}
            centers={centers}
            courseGroups={courseGroups}
            classes={classes}
          />
          <EditorButtons isPending={isPending} onSave={save} onCancel={cancel} />
        </div>
      )}
    </div>
  );
}

function EditorButtons({
  isPending,
  onSave,
  onCancel,
}: {
  isPending: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <button
        type="button"
        onClick={onSave}
        disabled={isPending}
        className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        <Check size={14} /> {isPending ? "Đang lưu…" : "Lưu"}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={isPending}
        className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
      >
        <X size={14} /> Huỷ
      </button>
    </div>
  );
}
