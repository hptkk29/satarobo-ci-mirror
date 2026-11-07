"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClass, updateClass } from "../_actions";
import { groupTeachableCourses, type TeachableCourse } from "@/lib/courses/grouped";
import { filterTeachersByCenter } from "@/lib/teachers/center-filter";
import { buildClassDisplayName } from "@/lib/classes/naming";
import {
  emptyPhase,
  firstPhaseFlatSchedule,
  toPhaseInputs,
  type PhaseFormValue,
} from "@/lib/classes/phase-form";
import { SchedulePhasesEditor } from "./schedule-phases-editor";
import { ClassSchedulePhases } from "../[id]/_components/class-schedule-phases";
import { FieldLabel } from "@/components/admin/ui/help-hint";

export type ClassFormValue = {
  id: string;
  classCode: string | null;
  name: string;
  description: string | null;
  courseId: string;
  orgUnitId: string | null;
  classGroupId: string | null;
  roomId: string | null;
  teacherId: string | null;
  assistantId: string | null;
  startDate: Date | null;
  endDate: Date | null;
  /**
   * 08/08 — BẢN SAO lịch phẳng của giai đoạn đang hiệu lực. Form KHÔNG còn sửa mấy field
   * này (mọi thao tác lịch đi qua Kế hoạch lịch học); giữ lại vì màn ngoài vẫn dựng
   * `ClassFormValue` từ cùng một query.
   */
  scheduleDays: number[];
  startTime: string | null;
  endTime: string | null;
  scheduleSlots?: { weekday: number; startTime: string; endTime: string | null }[];
  maxStudents: number;
  minStudents: number;
  status: "PLANNED" | "RECRUITING" | "PENDING_APPROVAL" | "ACTIVE" | "COMPLETED" | "CANCELLED";
  /**
   * 20/08 — ô "Ghi chú nội bộ" ĐÃ GỠ khỏi form (yêu cầu chủ dự án). Field giữ lại trong
   * type vì các trang gọi vẫn dựng `ClassFormValue` từ cùng một query, và cột DB `notes`
   * vẫn còn dữ liệu cũ; form chỉ không render/không gửi nó nữa.
   */
  notes: string | null;
};

// T3.4 — cần code/slug khoá để dựng tên lớp theo quy ước (`sata4.17h30-T2.P302`).
type CourseOption = TeachableCourse & { code?: string | null; slug?: string | null };

interface OrgUnitOption {
  id: string;
  name: string;
  centerId: string | null; // để lọc phòng học theo cơ sở (HO không có cơ sở → null)
}
interface ClassGroupOption {
  id: string;
  displayCode: string;
  name: string | null;
  centerId: string;
}
interface RoomOption {
  id: string;
  code: string;
  name: string;
  centerId: string;
}
interface TeacherOption {
  id: string;
  name: string;
  role: string;
  centerId: string | null; // R2-RBAC-3 — lọc GV theo cơ sở của đơn vị đang chọn
}
export interface CurriculumOption {
  id: string;
  courseId: string;
  version: number;
  name: string;
}

// "Chờ duyệt" KHÔNG cho chọn tay — chỉ set tự động khi sale "Gửi duyệt".
// QA 21/07 (B4): "Huỷ" cũng KHÔNG cho chọn tay — hủy lớp phải qua nút "Hủy lớp"
// (cancelClassAction: rút ghi danh + hủy buổi + hoàn tiền); đổi cờ trần tạo
// trạng thái mâu thuẫn (lớp Huỷ nhưng HS vẫn Đang học).
// 22/09/2026: "Hoàn thành" GỠ NỐT, cùng lý do — nó là nửa còn lại của chính bài học
// trên mà hồi 21/07 chỉ vá một nửa. Bấm hoàn thành ở dropdown chỉ set cờ, nên lớp
// đã xong mà học viên vẫn "Đang học" (lỗi prod 22/09). Nay đi qua nút "Hoàn thành
// lớp" (completeClassAction: chuyển ghi danh + cấp chứng chỉ + báo phụ huynh).
const STATUS_OPTIONS = [
  { value: "PLANNED", label: "Đang lên KH" },
  { value: "RECRUITING", label: "Tuyển sinh" },
  { value: "ACTIVE", label: "Đang dạy" },
] as const;

const PENDING_OPTION = { value: "PENDING_APPROVAL", label: "Chờ duyệt" } as const;
const CANCELLED_OPTION = { value: "CANCELLED", label: "Huỷ" } as const;
const COMPLETED_OPTION = { value: "COMPLETED", label: "Hoàn thành" } as const;

function toDateInput(d: Date | null): string {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

export function ClassForm({
  cls,
  courses,
  orgUnits,
  classGroups,
  classGroupEnabled = false,
  rooms,
  teachers,
  hoCenterIds = [],
  curricula = [],
  canEdit = true,
  schedulePhases = [],
  phasesDerived = true,
  phaseSignature,
  defaultApplyFrom = "",
}: {
  cls?: ClassFormValue;
  courses: CourseOption[];
  orgUnits: OrgUnitOption[];
  classGroups: ClassGroupOption[];
  /**
   * Cờ GỠ tính năng "Nhóm lớp" (`isClassGroupEnabled()` — mặc định OFF từ 20/08/2026).
   * false ⇒ KHÔNG render ô "Nhóm lớp cố định". Prop `classGroups` vẫn hoạt động y như cũ
   * để bật lại cờ là ô hiện lại, không phải revert code.
   */
  classGroupEnabled?: boolean;
  rooms: RoomOption[];
  teachers: TeacherOption[];
  /** Cơ sở KHÔNG dạy học (Hội sở) — GV thuộc đây điều đi dạy được mọi cơ sở. */
  hoCenterIds?: string[];
  /** R7-06 — giáo trình ACTIVE (sắp xếp version giảm dần) để chốt version lúc tạo lớp. */
  curricula?: CurriculumOption[];
  canEdit?: boolean;
  /** Kế hoạch lịch học hiện có (lớp đã tồn tại) — rỗng khi tạo mới. */
  schedulePhases?: PhaseFormValue[];
  /** true = lớp chưa lưu kế hoạch, giai đoạn dưới là bản SUY từ lịch cũ. */
  phasesDerived?: boolean;
  /** Chữ ký kế hoạch — dùng làm `key` để form lịch nhận bản mới sau `router.refresh()`. */
  phaseSignature?: string;
  /** "YYYY-MM-DD" — mốc mặc định của ô "Áp dụng từ ngày" (thường là ngày mai). */
  defaultApplyFrom?: string;
}) {
  const router = useRouter();
  const isEdit = Boolean(cls);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [courseId, setCourseId] = useState<string>(cls?.courseId ?? "");
  const [curriculumId, setCurriculumId] = useState<string>(() => {
    if (!cls?.courseId) return "";
    const list = curricula
      .filter((c) => c.courseId === cls.courseId)
      .sort((a, b) => b.version - a.version);
    return list[0]?.id ?? "";
  });
  const [orgUnitId, setOrgUnitId] = useState<string>(cls?.orgUnitId ?? "");
  const [roomId, setRoomId] = useState<string>(cls?.roomId ?? "");
  const [teacherId, setTeacherId] = useState<string>(cls?.teacherId ?? "");
  const [assistantId, setAssistantId] = useState<string>(cls?.assistantId ?? "");
  const [startDate, setStartDate] = useState<string>(toDateInput(cls?.startDate ?? null));
  // 08/08 — LỊCH LỚP = KẾ HOẠCH NHIỀU GIAI ĐOẠN. Ba ô cũ ("Lịch học trong tuần" / "Giờ bắt
  // đầu" / "Giờ kết thúc" / "Giờ riêng theo thứ") đã bỏ: chúng chỉ mô tả được ĐÚNG MỘT lịch
  // cho cả vòng đời lớp, còn kế hoạch mới là nguồn sự thật và tự sinh lại bản sao phẳng.
  // Lớp đang TẠO thì gõ ngay tại đây và gửi kèm form; lớp ĐÃ CÓ dùng khối quản lý riêng
  // (tự lưu + áp lịch xuống buổi đã sinh) vì hai việc đó cần `classId`.
  const [phases, setPhases] = useState<PhaseFormValue[]>(
    schedulePhases.length > 0 ? schedulePhases : [emptyPhase()],
  );
  // T3.4 — tên lớp: khi TẠO MỚI và chưa gõ tay thì bám theo gợi ý quy ước (tự đổi
  // khi chọn khoá/giờ/thứ/phòng). Gõ tay 1 chữ là dừng bám (tên là free-text).
  const [name, setName] = useState<string>(cls?.name ?? "");
  const [nameTouched, setNameTouched] = useState<boolean>(Boolean(cls?.name));

  // Cơ sở của đơn vị đang chọn — dùng để lọc phòng học (HO → null → không có phòng cơ sở).
  const selectedCenterId = useMemo(
    () => orgUnits.find((o) => o.id === orgUnitId)?.centerId ?? null,
    [orgUnits, orgUnitId],
  );
  const filteredRooms = useMemo(
    () =>
      orgUnitId && selectedCenterId
        ? rooms.filter((r) => r.centerId === selectedCenterId)
        : orgUnitId
          ? []
          : rooms,
    [rooms, orgUnitId, selectedCenterId],
  );
  // R2-RBAC-3 — GV chính chỉ liệt kê người CÙNG cơ sở với đơn vị đang chọn (cách ly
  // CS1↔CS2). LUÔN giữ GV/TA đang chọn + GV đang gán sẵn của lớp để <Select> không
  // tự rớt value (gốc bug "Lớp học hiện trống"). Dùng helper thuần đã unit-test.
  const filteredTeachers = useMemo(() => {
    if (!orgUnitId) return teachers; // chưa chọn đơn vị → hiện tất (sẽ lọc sau khi chọn)
    return filterTeachersByCenter(
      teachers,
      selectedCenterId,
      [teacherId, assistantId, cls?.teacherId, cls?.assistantId],
      hoCenterIds,
    );
  }, [teachers, orgUnitId, selectedCenterId, teacherId, assistantId, cls, hoCenterIds]);
  const filteredAssistants = useMemo(
    () => filteredTeachers.filter((t) => t.id !== teacherId),
    [filteredTeachers, teacherId],
  );
  const courseCurricula = useMemo(
    () =>
      curricula
        .filter((c) => c.courseId === courseId)
        .sort((a, b) => b.version - a.version),
    [curricula, courseId],
  );

  // T3.4 — gợi ý tên lớp theo quy ước `tênkhoá.giờ-thứ.phòng`. Lịch lấy từ giai đoạn ĐẦU
  // TIÊN của kế hoạch: tên lớp là nhãn lúc khai giảng, đổi nhịp giữa khoá không đổi tên.
  const suggestedName = useMemo(() => {
    const course = courses.find((c) => c.id === courseId);
    const room = rooms.find((r) => r.id === roomId);
    const flat = firstPhaseFlatSchedule(phases);
    return buildClassDisplayName({
      courseCode: course?.code ?? null,
      courseSlug: course?.slug ?? null,
      scheduleDays: flat.scheduleDays,
      startTime: flat.startTime,
      slots: flat.slots,
      roomCode: room?.code ?? null,
    });
  }, [courses, courseId, rooms, roomId, phases]);
  // Chưa gõ tay → ô tên bám gợi ý (rỗng thì để trống cho người dùng tự nhập).
  const nameValue = nameTouched ? name : suggestedName;

  function onCourseChange(value: string) {
    setCourseId(value);
    const latest = curricula
      .filter((c) => c.courseId === value)
      .sort((a, b) => b.version - a.version)[0];
    setCurriculumId(latest?.id ?? "");
  }

  // Dùng onSubmit + preventDefault thay cho <form action> để React 19 KHÔNG tự
  // reset các field khi submit lỗi validation (#7 Đợt 4). Thành công → toast +
  // client điều hướng (QA 20/07 Vấn đề 4 — trước đây redirect âm thầm).
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const formData = new FormData(e.currentTarget);
    // Lớp ĐANG TẠO: kế hoạch lịch đi kèm form (server suy ra bản sao phẳng từ nó).
    // Lớp ĐÃ CÓ: KHÔNG gửi field lịch nào — khối "Kế hoạch lịch học" bên dưới tự lưu, và
    // server giữ nguyên lịch hiện tại khi form không mang lịch theo.
    if (!isEdit) {
      formData.set("schedulePhases", JSON.stringify(toPhaseInputs(phases)));
    }

    const res = isEdit
      ? await updateClass(cls!.id, formData)
      : await createClass(formData);
    if (res?.error) {
      setError(res.error);
      setPending(false);
      return;
    }
    toast.success(isEdit ? "Đã cập nhật lớp học" : "Đã tạo lớp học mới");
    // 08/08 — đổi ngày khai giảng/lịch thì server xếp lại buổi ngay; báo kết quả để
    // người dùng biết dãy buổi vừa đổi (trước đây im lặng, lịch và buổi lệch nhau).
    if (res?.warning) toast.warning(res.warning, { duration: 8000 });
    // QA 21/07 (B6) — refresh kèm push để danh sách chắc chắn hiện dữ liệu mới.
    router.push("/classes");
    router.refresh();
  }

  /**
   * Ngày khai giảng kéo theo mốc "Từ ngày" của GIAI ĐOẠN 1 — hai thứ này phải khớp, nếu
   * không kế hoạch bắt đầu ở một ngày còn buổi đầu ở ngày khác. Chỉ tự đổi khi ô đó đang
   * trống hoặc vẫn đang bám ngày khai giảng cũ (admin sửa tay thì tôn trọng).
   */
  function onStartDateChange(value: string) {
    // Chỉ lúc TẠO: `phases` ở đây là state của form. Lớp đã có thì kế hoạch do khối riêng
    // quản (có nút Lưu + xem trước dời buổi) — sửa lén state này chẳng đi tới đâu.
    if (!isEdit) {
      setPhases((prev) =>
        prev.map((p, i) =>
          i === 0 && (!p.from || p.from === startDate) ? { ...p, from: value } : p,
        ),
      );
    }
    setStartDate(value);
  }

  function onOrgUnitChange(value: string) {
    setOrgUnitId(value);
    // Reset phòng học nếu không thuộc cơ sở của đơn vị mới.
    const newCenterId = orgUnits.find((o) => o.id === value)?.centerId ?? null;
    if (roomId && !rooms.some((r) => r.id === roomId && r.centerId === newCenterId)) {
      setRoomId("");
    }
    // R2-RBAC-3 — đổi cơ sở thì GV/TA cũ (khác cơ sở) không còn hợp lệ → reset.
    const inNewCenter = (id: string) =>
      newCenterId != null && teachers.some((t) => t.id === id && t.centerId === newCenterId);
    if (teacherId && !inNewCenter(teacherId)) setTeacherId("");
    if (assistantId && !inNewCenter(assistantId)) setAssistantId("");
  }

  function onTeacherChange(value: string) {
    setTeacherId(value);
    if (assistantId && assistantId === value) setAssistantId("");
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl space-y-6">
      {error && (
        <div className="rounded-lg border border-state-danger-soft bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink">
          {error}
        </div>
      )}

      <fieldset disabled={!canEdit} className="space-y-6 border-0 p-0 m-0">
        {/* 1. Identity */}
        <Section title="Thông tin lớp học">
          <Grid cols={2}>
            <div>
              <Field
                label="Tên lớp"
                name="name"
                value={nameValue}
                onChange={(v) => {
                  setName(v);
                  setNameTouched(true);
                }}
                placeholder="sata4.17h30-T2&17h30-T6.P302"
                required
                helper="Quy ước: tênkhoá.giờ-thứ.phòng — tự gợi ý theo khoá/giờ/lịch/phòng, sửa được"
              />
              {suggestedName && suggestedName !== nameValue && (
                <button
                  type="button"
                  onClick={() => {
                    setName(suggestedName);
                    setNameTouched(true);
                  }}
                  className="mt-1 text-xs font-semibold text-primary hover:underline"
                >
                  Dùng tên gợi ý: {suggestedName}
                </button>
              )}
            </div>
            <Field
              label="Mã lớp"
              name="classCode"
              defaultValue={cls?.classCode ?? undefined}
              placeholder="SR-LR-2026-01"
              helper="Tuỳ chọn — duy nhất toàn hệ thống nếu có"
            />
          </Grid>

          <Grid cols={3}>
            <SelectField
              label="Khoá học"
              name="courseId"
              value={courseId}
              onChange={onCourseChange}
              required
              options={[{ value: "", label: "— Chọn khoá cụ thể —" }]}
              groups={groupTeachableCourses(courses)}
            />
            <SelectField
              label="Cơ sở"
              name="orgUnitId"
              value={orgUnitId}
              onChange={onOrgUnitChange}
              required
              options={[
                { value: "", label: "— Chọn cơ sở —" },
                ...orgUnits.map((o) => ({ value: o.id, label: o.name })),
              ]}
            />
            <SelectField
              label="Trạng thái"
              name="status"
              defaultValue={cls?.status ?? "PLANNED"}
              required
              // Ba trạng thái "không chọn tay" vẫn phải CÓ MẶT khi lớp đang ở đó —
              // nếu không, <select> mất defaultValue, hiện sai nhãn và lần Cập nhật
              // kế tiếp gửi lên một trạng thái khác hẳn.
              options={
                cls?.status === "PENDING_APPROVAL"
                  ? [PENDING_OPTION, ...STATUS_OPTIONS]
                  : cls?.status === "CANCELLED"
                    ? [CANCELLED_OPTION, ...STATUS_OPTIONS]
                    : cls?.status === "COMPLETED"
                      ? [COMPLETED_OPTION, ...STATUS_OPTIONS]
                      : [...STATUS_OPTIONS]
              }
            />
          </Grid>

          {/* Cờ GỠ (20/08) — ô này chỉ hiện khi bật lại `CLASS_GROUP_ENABLED`. Ẩn ⇒ FormData
              không còn khoá `classGroupId`; server hiểu "vắng mặt = giữ nguyên nhóm cũ"
              nên lớp đang gắn nhóm KHÔNG bị gỡ nhóm khi bấm Cập nhật (xem updateClass). */}
          {classGroupEnabled && (
            <SelectField
              label="Nhóm lớp cố định (tuỳ chọn)"
              name="classGroupId"
              defaultValue={cls?.classGroupId ?? ""}
              options={[
                { value: "", label: "— Không gán nhóm —" },
                ...classGroups.map((g) => ({
                  value: g.id,
                  label: `${g.displayCode}${g.name ? ` · ${g.name}` : ""}`,
                })),
              ]}
              helper="Nếu chọn, lớp sẽ kế thừa cơ sở của nhóm. Dùng cho lộ trình tăng khoá Sata3 → 4 → 5…"
            />
          )}

          {/* 20/08 — đổi vai ô này: không còn là "mô tả ngắn để giới thiệu lớp" mà là SỔ BÀN
              GIAO nội bộ. Mục đích chủ dự án nêu rõ: đổi giáo viên thì người mới đọc được
              tính cách/lưu ý từng học viên. Nội dung nhạy cảm ⇒ nhắc ngay tại nhãn rằng
              phụ huynh KHÔNG thấy (đã rà: `Class.description` chỉ đọc ở 2 trang admin này
              và khối mô tả trên site GV — không có đường nào ra portal/public). */}
          <Field
            label="Mô tả chi tiết đặc thù lớp học"
            name="description"
            type="textarea"
            rows={6}
            defaultValue={cls?.description ?? undefined}
            placeholder={
              "Đặc thù của lớp để bàn giao khi đổi giáo viên. Ví dụ:\n" +
              "- Minh Anh: nhút nhát, cần gọi tên riêng mới phát biểu.\n" +
              "- Bảo Nam: rất nhanh, xong sớm thì giao thêm bài mở rộng kẻo nghịch.\n" +
              "- Cả lớp trầm sau 19h — nên đổi sang hoạt động nhóm."
            }
            hint="Chỉ nhân sự và giáo viên của lớp đọc được — KHÔNG hiển thị cho phụ huynh. Dùng để bàn giao khi đổi giáo viên: tính cách từng học viên, lưu ý riêng, cách xử lý."
          />

          {/* R7-06 — chốt version giáo trình lúc tạo lớp (chỉ khi tạo mới). */}
          {!isEdit && (
            <div>
              <label className="block">
                <FieldLabel
                  label="Giáo trình áp dụng"
                  required
                  hint="Mặc định = version ACTIVE mới nhất. Version được chốt (snapshot) vào lớp và sinh kế hoạch buổi."
                />
                <select
                  name="curriculumId"
                  value={curriculumId}
                  onChange={(e) => setCurriculumId(e.target.value)}
                  disabled={!courseId || courseCurricula.length === 0}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-muted"
                >
                  {courseCurricula.length === 0 ? (
                    <option value="">— Khoá chưa có giáo trình ACTIVE —</option>
                  ) : (
                    courseCurricula.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))
                  )}
                </select>
              </label>
              {/* GIỮ dạng chữ, KHÔNG chuyển sang icon "?": đây là lý do người dùng bấm
                  "Tạo lớp" mà không được — hover mới thấy thì coi như không thấy. */}
              {courseId && courseCurricula.length === 0 && (
                <span className="mt-1 block text-xs text-state-danger-ink">
                  Khoá học chưa có giáo trình đang áp dụng (ACTIVE) — không thể tạo
                  lớp. Hãy kích hoạt giáo trình trước.
                </span>
              )}
            </div>
          )}
        </Section>

        {/* 2. Assignment */}
        <Section title="Phân công">
          <Grid cols={3}>
            {/* T3.1 — Phòng học + GV chính BẮT BUỘC (bỏ option "— Chưa phân —"). */}
            <SelectField
              label="Phòng học"
              name="roomId"
              value={roomId}
              onChange={setRoomId}
              required
              options={[
                { value: "", label: "— Chọn phòng học —" },
                ...filteredRooms.map((r) => ({
                  value: r.id,
                  label: `${r.code} — ${r.name}`,
                })),
              ]}
              helper={
                orgUnitId
                  ? "Chỉ hiển thị phòng của cơ sở thuộc đơn vị đã chọn"
                  : "Chọn đơn vị để lọc phòng"
              }
            />
            <SelectField
              label="GV chính"
              name="teacherId"
              value={teacherId}
              onChange={onTeacherChange}
              required
              options={[
                { value: "", label: "— Chọn GV chính —" },
                ...filteredTeachers.map((t) => ({ value: t.id, label: t.name })),
              ]}
              helper={
                orgUnitId
                  ? "Chỉ hiển thị GV của cơ sở thuộc đơn vị đã chọn"
                  : "Chọn đơn vị để lọc GV theo cơ sở"
              }
            />
            <SelectField
              label="Trợ giảng"
              name="assistantId"
              value={assistantId}
              onChange={setAssistantId}
              options={[
                { value: "", label: "— Chưa phân TA —" },
                ...filteredAssistants.map((t) => ({ value: t.id, label: t.name })),
              ]}
              helper="Lọc: Trợ giảng (không trùng GV chính)"
            />
          </Grid>

          <Grid cols={2}>
            <Field
              label="Ngày khai giảng"
              name="startDate"
              type="date"
              value={startDate}
              onChange={onStartDateChange}
              required
            />
            {/* T3.3 — bỏ trống thì server tự tính buổi cuối theo KẾ HOẠCH LỊCH bên dưới
                (đã trừ ngày nghỉ); nhập tay vẫn được ưu tiên. */}
            <Field
              label="Ngày bế giảng"
              name="endDate"
              type="date"
              defaultValue={toDateInput(cls?.endDate ?? null)}
              helper="Bỏ trống = tự tính từ kế hoạch lịch học + số buổi (trừ ngày nghỉ)"
            />
          </Grid>

          {/* 08/08 — CHỖ CŨ CỦA "Lịch học trong tuần / Giờ bắt đầu / Giờ kết thúc / Giờ
              riêng theo thứ". Nay là Kế hoạch lịch học: một lớp khai được nhiều giai đoạn
              (đổi nhịp, đổi giờ giữa khoá) thay vì đúng một lịch cho cả vòng đời. */}
          {/* Khối lịch nằm TRONG <form> nên Enter ở ô "Ghi chú"/ngày của nó sẽ submit cả
              form lớp — chặn lại; các ô này không có `name` nên không lọt vào FormData. */}
          <div
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
                e.preventDefault();
              }
            }}
          >
            {isEdit ? (
              <ClassSchedulePhases
                key={phaseSignature}
                classId={cls!.id}
                canEdit={canEdit}
                initialPhases={schedulePhases}
                isDerived={phasesDerived}
                defaultApplyFrom={defaultApplyFrom}
              />
            ) : (
              <SchedulePhasesEditor
                phases={phases}
                onChange={setPhases}
                disabled={!canEdit || pending}
              />
            )}
          </div>

          {/* QA 21/07 (B5) — trước đây thiếu ô "Số HS tối thiểu": server mặc định
              min=5 rồi báo "min phải <= max" khi max nhỏ mà admin không có chỗ sửa. */}
          <Grid cols={2}>
            <Field
              label="Số HS tối thiểu"
              name="minStudents"
              type="number"
              min={1}
              defaultValue={cls?.minStudents ?? 5}
              required
              helper="Dưới mức này lớp chưa đủ điều kiện khai giảng"
            />
            <Field
              label="Số HS tối đa"
              name="maxStudents"
              type="number"
              min={1}
              defaultValue={cls?.maxStudents ?? 20}
              required
            />
          </Grid>

          {/* 20/08 — CHỖ CŨ CỦA "Ghi chú nội bộ". Bỏ theo yêu cầu chủ dự án: nó trùng vai
              với "Mô tả chi tiết đặc thù lớp học" ở trên, người nhập phải đoán viết vào ô
              nào. Cột `notes` trong DB GIỮ NGUYÊN (không migration) và server không ghi đè
              ghi chú cũ khi form không gửi khoá này — xem updateClass. */}
        </Section>
      </fieldset>

      <div className="flex gap-3 border-t border-border pt-6">
        {canEdit && <SubmitButton isEdit={isEdit} pending={pending} />}
        <button
          type="button"
          onClick={() => router.push("/classes")}
          className="rounded-xl border-2 border-border bg-card px-6 py-3 font-bold text-foreground hover:bg-muted"
        >
          Huỷ
        </button>
      </div>
    </form>
  );
}

function SubmitButton({ isEdit, pending }: { isEdit: boolean; pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-xl bg-primary px-6 py-3 font-bold text-white shadow-md hover:opacity-90 disabled:opacity-60"
    >
      {pending ? "Đang lưu..." : isEdit ? "Cập nhật" : "Tạo lớp"}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-foreground">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Grid({ children, cols = 2 }: { children: React.ReactNode; cols?: 2 | 3 }) {
  const grid = cols === 3 ? "md:grid-cols-3" : "md:grid-cols-2";
  return <div className={`grid grid-cols-1 ${grid} gap-4`}>{children}</div>;
}

type FieldProps = {
  label: string;
  name: string;
  type?: "text" | "number" | "email" | "textarea" | "date" | "time";
  rows?: number;
  min?: number;
  max?: number;
  defaultValue?: string | number | null;
  /** Có `value` → field CONTROLLED (dùng cho tên lớp gợi ý / giờ bắt đầu). */
  value?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  /**
   * 20/08 — `helper` KHÔNG còn in thành dòng chữ mờ dưới ô nữa; nó đi vào cùng icon "?"
   * với `hint`. Giữ lại hai tên vì các chỗ gọi đang dùng cả hai và ý nghĩa như nhau.
   */
  helper?: string;
  /** Hướng dẫn đặt sau icon "?" cạnh nhãn — hover/bấm mới hiện. */
  hint?: React.ReactNode;
};

function Field({
  label,
  name,
  type = "text",
  rows = 3,
  min,
  max,
  defaultValue,
  value,
  onChange,
  placeholder,
  required,
  helper,
  hint,
}: FieldProps) {
  const isControlled = value !== undefined;
  const bind = isControlled
    ? { value, onChange: (e: { target: { value: string } }) => onChange?.(e.target.value) }
    : { defaultValue: defaultValue ?? "" };
  const baseClass =
    "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";
  return (
    // Nút "?" của FieldLabel nằm trong <label> vẫn an toàn: <button> là interactive
    // content nên trình duyệt KHÔNG chuyển tiếp cú bấm xuống ô nhập.
    <label className="block">
      <FieldLabel label={label} required={required} hint={hint ?? helper} />
      {type === "textarea" ? (
        <textarea
          name={name}
          rows={rows}
          {...bind}
          placeholder={placeholder}
          required={required}
          className={`${baseClass} resize-y`}
        />
      ) : (
        <input
          type={type}
          name={name}
          min={min}
          max={max}
          {...bind}
          placeholder={placeholder}
          required={required}
          className={baseClass}
        />
      )}
    </label>
  );
}

type SelectOption = { value: string; label: string };
type SelectFieldProps = {
  label: string;
  name: string;
  options: readonly SelectOption[];
  /** Nếu có → render <optgroup> thay cho options phẳng (giữ option đầu của options làm placeholder). */
  groups?: readonly { label: string; options: readonly SelectOption[] }[];
  defaultValue?: string;
  value?: string;
  onChange?: (v: string) => void;
  required?: boolean;
  helper?: string;
};

function SelectField({
  label,
  name,
  options,
  groups,
  defaultValue,
  value,
  onChange,
  required,
  helper,
}: SelectFieldProps) {
  const isControlled = value !== undefined;
  return (
    <label className="block">
      <FieldLabel label={label} required={required} hint={helper} />
      <select
        name={name}
        {...(isControlled
          ? { value, onChange: (e) => onChange?.(e.target.value) }
          : { defaultValue: defaultValue ?? "" })}
        required={required}
        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
        {groups?.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
