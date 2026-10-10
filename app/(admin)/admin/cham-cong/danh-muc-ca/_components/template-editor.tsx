"use client";

// Form một mã ca — 3 nhóm: Định danh · Giờ & nơi làm · Công & ghi chú. Sống bên trong
// `template-sheet.tsx` (Sheet phải), không còn mở inline đè lên bảng.
//
// Điều dễ vỡ:
//  · Bảng đoạn ca ở đây CỐ Ý không phân trang (≤6 dòng, phải nhìn hết mới xếp được ca gãy) — nó
//    được miễn trừ trong `components/ui/bang-coverage.test.ts` THEO ĐÚNG ĐƯỜNG DẪN FILE NÀY.
//    Đổi tên hoặc dời file là test đỏ.
//  · `submit()` chuẩn hoá trước khi gửi (mã nghỉ ⇒ 0 công, không đoạn ca, không chấm). Bỏ đoạn
//    chuẩn hoá này thì server trả "Mã nghỉ phải có số công = 0" và người dùng không hiểu vì sao.
//  · Nơi làm gửi lên là TOKEN (`HOME`, `CENTER:CS1`…) — engine `resolvePlace` đọc chuỗi này.
//    Nhãn tiếng Việt chỉ để nhìn.
import { useState, useTransition } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD } from "@/components/admin/cham-cong/classes";
import { createShiftTemplateAction, updateShiftTemplateAction, type ShiftTemplateInput } from "../_actions";

type Seg = { start: string; end: string; kind: "WORK" | "PAID_BREAK"; place?: string };

export type TemplateEditorValue = {
  id?: string;
  code: string;
  name: string;
  kind: "TIMED" | "LOCATION_ONLY" | "FLEXIBLE" | "OFF" | "LEAVE";
  segments: Seg[];
  defaultPlace: string;
  attendanceMode: "REQUIRED" | "OPTIONAL" | "NONE";
  dayCredit: number;
  isLeave: boolean;
  nominalMinutes: number | null;
  payMode: "SHIFT" | "ADMIN_HOURS" | "NONE";
  soCapQuetKyVong: 0 | 1 | 2;
  note: string | null;
  isActive: boolean;
  centerId: string | null;
};

export type TemplateCenter = { id: string; code: string; name: string };

const EMPTY: TemplateEditorValue = {
  code: "",
  name: "",
  kind: "TIMED",
  segments: [{ start: "08:00", end: "12:00", kind: "WORK" }],
  defaultPlace: "HOME",
  attendanceMode: "REQUIRED",
  dayCredit: 1,
  isLeave: false,
  nominalMinutes: null,
  payMode: "SHIFT",
  // Mặc định 1 = chiều FAIL-CLOSED của schema: quên khai thì hệ KIỂM THỪA, không KIỂM THIẾU.
  soCapQuetKyVong: 1,
  note: null,
  isActive: true,
  centerId: null,
};

/** Token nơi làm dùng chung (ngoài `CENTER:<mã cơ sở>` dựng theo danh sách cơ sở). */
export const PLACES: { value: string; label: string }[] = [
  { value: "HOME", label: "Cơ sở của đơn vị (mặc định)" },
  { value: "ASSIGNED", label: "Theo phân công (HO)" },
  { value: "ANY_CENTER", label: "Bất kỳ cơ sở nào" },
  { value: "OFFSITE", label: "Công tác ngoài" },
  { value: "ANYWHERE", label: "Linh động (không cần đến)" },
];

export function placeOptions(centers: TemplateCenter[]) {
  return [...PLACES, ...centers.map((c) => ({ value: `CENTER:${c.code}`, label: `Tại ${c.name}` }))];
}

/** Nhãn tiếng Việt của một token nơi làm — dùng chung với bảng danh mục. */
export function placeLabel(token: string, centers: TemplateCenter[]): string {
  const found = placeOptions(centers).find((o) => o.value === token);
  if (found) return found.label;
  if (token.startsWith("CENTER:")) return `Tại ${token.slice("CENTER:".length)}`;
  return token;
}

export const KIND_LABEL: Record<TemplateEditorValue["kind"], string> = {
  TIMED: "Có giờ",
  LOCATION_ONLY: "Chỉ nơi làm",
  FLEXIBLE: "Linh động",
  OFF: "Nghỉ",
  LEAVE: "Nghỉ phép",
};

export const ATTENDANCE_LABEL: Record<TemplateEditorValue["attendanceMode"], string> = {
  REQUIRED: "Phải quét",
  OPTIONAL: "Quét tuỳ chọn",
  NONE: "Không chấm",
};

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  wide,
  children,
}: {
  label: string;
  hint?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block text-sm", wide && "sm:col-span-2")}>
      <span className="mb-1 block text-sm font-semibold text-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function TemplateEditor({
  initial,
  centers,
  canGlobal,
  onSaved,
  onCancel,
}: {
  initial?: TemplateEditorValue;
  centers: TemplateCenter[];
  canGlobal: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<TemplateEditorValue>(
    initial ?? { ...EMPTY, centerId: canGlobal ? null : (centers[0]?.id ?? null) },
  );
  const [pending, start] = useTransition();
  const set = <K extends keyof TemplateEditorValue>(k: K, val: TemplateEditorValue[K]) =>
    setV((s) => ({ ...s, [k]: val }));
  const setSeg = (i: number, patch: Partial<Seg>) =>
    setV((s) => ({ ...s, segments: s.segments.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const places = placeOptions(centers);
  const isRest = v.kind === "OFF" || v.kind === "LEAVE";

  function submit() {
    const input: ShiftTemplateInput = {
      ...v,
      segments: v.kind === "TIMED" ? v.segments : [],
      dayCredit: isRest ? 0 : v.dayCredit,
      isLeave: v.kind === "LEAVE",
      attendanceMode: isRest ? "NONE" : v.attendanceMode,
      // Ô bị ẩn khi mã nghỉ / không chấm ⇒ phải gửi 0, kẻo lưu một con số người dùng không
      // thấy và không chọn (mã nghỉ mang 1 thì engine đi đòi lượt quét của ngày nghỉ).
      soCapQuetKyVong: isRest || v.attendanceMode === "NONE" ? 0 : v.soCapQuetKyVong,
      nominalMinutes: v.nominalMinutes === null || Number.isNaN(v.nominalMinutes) ? null : v.nominalMinutes,
    };
    start(async () => {
      const r = v.id ? await updateShiftTemplateAction(v.id, input) : await createShiftTemplateAction(input);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(v.id ? `Đã cập nhật mã ${v.code}` : `Đã tạo mã ${v.code}`);
      onSaved();
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
        <Group title="Định danh">
          <Field label="Mã" hint="Chữ hoa/số, tối đa 8 ký tự — đúng mã đang dùng trên Sheet.">
            <input
              className={cn(FIELD, "w-full font-mono uppercase")}
              value={v.code}
              onChange={(e) => set("code", e.target.value.toUpperCase())}
              placeholder="VD: CG"
              maxLength={8}
            />
          </Field>
          <Field label="Tên">
            <input
              className={cn(FIELD, "w-full")}
              value={v.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="VD: Ca gãy"
            />
          </Field>
          <Field label="Loại">
            <select
              className={cn(FIELD, "w-full")}
              value={v.kind}
              onChange={(e) => set("kind", e.target.value as TemplateEditorValue["kind"])}
            >
              <option value="TIMED">Có giờ</option>
              <option value="LOCATION_ONLY">Chỉ nơi làm, không giờ (D1/D2)</option>
              <option value="FLEXIBLE">Linh động (LD)</option>
              <option value="OFF">Nghỉ (X)</option>
              <option value="LEAVE">Nghỉ phép (P)</option>
            </select>
          </Field>
          <Field
            label="Phạm vi"
            hint={canGlobal ? "Dùng chung = mọi cơ sở thấy và xếp được." : "Bạn chỉ tạo được mã riêng cơ sở mình."}
          >
            <select
              className={cn(FIELD, "w-full")}
              value={v.centerId ?? ""}
              onChange={(e) => set("centerId", e.target.value || null)}
            >
              {canGlobal && <option value="">Dùng chung mọi cơ sở</option>}
              {centers.map((c) => (
                <option key={c.id} value={c.id}>
                  Riêng {c.name}
                </option>
              ))}
            </select>
          </Field>
        </Group>

        <Group title="Giờ & nơi làm">
          <Field label="Nơi làm mặc định" wide>
            <select
              className={cn(FIELD, "w-full")}
              value={v.defaultPlace}
              onChange={(e) => set("defaultPlace", e.target.value)}
            >
              {places.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          {!isRest && (
            <Field label="Chế độ chấm" wide>
              <select
                className={cn(FIELD, "w-full")}
                value={v.attendanceMode}
                onChange={(e) => set("attendanceMode", e.target.value as TemplateEditorValue["attendanceMode"])}
              >
                <option value="REQUIRED">Phải quét QR</option>
                <option value="OPTIONAL">Quét thì ghi giờ, không quét vẫn có công</option>
                <option value="NONE">Không chấm</option>
              </select>
            </Field>
          )}
          {!isRest && v.attendanceMode !== "NONE" && (
            <Field
              label="Số lần chấm trong ngày"
              hint="Chọn 2 lần khi ca phải quét ra nghỉ giữa giờ rồi quét vào lại — VD giờ hành chính: sáng và chiều riêng."
              wide
            >
              <select
                className={cn(FIELD, "w-full")}
                value={String(v.soCapQuetKyVong)}
                onChange={(e) => set("soCapQuetKyVong", Number(e.target.value) as 0 | 1 | 2)}
              >
                <option value="1">1 lần — vào đầu ca, ra cuối ca</option>
                <option value="2">2 lần — sáng và chiều riêng (4 lượt quét)</option>
                <option value="0">Không kiểm số lượt quét</option>
              </select>
            </Field>
          )}
          {v.kind === "TIMED" ? (
            <div className="sm:col-span-2">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">Đoạn ca (giờ VN)</span>
                <button
                  type="button"
                  className={cn(BTN_OUTLINE, "h-8 px-3 text-xs")}
                  onClick={() => set("segments", [...v.segments, { start: "13:30", end: "17:30", kind: "WORK" }])}
                >
                  <Plus className="h-4 w-4" aria-hidden /> Thêm đoạn
                </button>
              </div>
              <p className="mb-2 text-xs text-muted-foreground">
                Không qua đêm, giờ tăng dần, tối đa 6 đoạn. Nghỉ giữa giờ CÓ tính công phải nằm kẹp
                giữa hai đoạn làm việc.
              </p>
              {/* ≤6 dòng, cố ý không phân trang — xem mục miễn trừ ở đầu file.
                  Nhưng VẪN cần vùng cuộn: bảng 5 cột này nằm trong panel bên phải, panel hẹp
                  thì không có đường lùi nào, các ô giờ bị bóp thay vì cho kéo ngang. */}
              <div className="relative overflow-x-auto">
              <table className="w-full min-w-[26rem] text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1 pr-2 font-medium">Bắt đầu</th>
                    <th scope="col" className="py-1 pr-2 font-medium">Kết thúc</th>
                    <th scope="col" className="py-1 pr-2 font-medium">Loại</th>
                    <th scope="col" className="py-1 pr-2 font-medium">Nơi (trống = mặc định)</th>
                    <th scope="col" className="py-1">
                      <span className="sr-only">Xoá đoạn</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {v.segments.map((s, i) => (
                    <tr key={i}>
                      <td className="py-1 pr-2">
                        <input
                          type="time"
                          aria-label={`Giờ bắt đầu đoạn ${i + 1}`}
                          className={cn(FIELD, "w-full")}
                          value={s.start}
                          onChange={(e) => setSeg(i, { start: e.target.value })}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          type="time"
                          aria-label={`Giờ kết thúc đoạn ${i + 1}`}
                          className={cn(FIELD, "w-full")}
                          value={s.end}
                          onChange={(e) => setSeg(i, { end: e.target.value })}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <select
                          aria-label={`Loại đoạn ${i + 1}`}
                          className={cn(FIELD, "w-full")}
                          value={s.kind}
                          onChange={(e) => setSeg(i, { kind: e.target.value as Seg["kind"] })}
                        >
                          <option value="WORK">Làm việc</option>
                          <option value="PAID_BREAK">Nghỉ giữa giờ (tính công)</option>
                        </select>
                      </td>
                      <td className="py-1 pr-2">
                        <select
                          aria-label={`Nơi làm đoạn ${i + 1}`}
                          className={cn(FIELD, "w-full")}
                          value={s.place ?? ""}
                          onChange={(e) => setSeg(i, { place: e.target.value || undefined })}
                        >
                          <option value="">— mặc định —</option>
                          {places.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1">
                        <button
                          type="button"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-state-danger-ink transition-colors hover:bg-state-danger-soft"
                          onClick={() => set("segments", v.segments.filter((_, j) => j !== i))}
                          aria-label={`Xoá đoạn ${i + 1}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          ) : (
            !isRest && (
              <Field label="Giờ kế hoạch (phút)" hint="Để trống = 0. Dùng cho mã không có đoạn giờ cụ thể." wide>
                <input
                  type="number"
                  min={0}
                  className={cn(FIELD, "w-full")}
                  value={v.nominalMinutes ?? ""}
                  onChange={(e) => set("nominalMinutes", e.target.value === "" ? null : Number(e.target.value))}
                />
              </Field>
            )
          )}
        </Group>

        <Group title="Công & ghi chú">
          {isRest ? (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground sm:col-span-2">
              Mã nghỉ luôn 0 công và không cần quét QR — hệ thống tự đặt khi lưu.
            </p>
          ) : (
            <>
              <Field label="Số công / ngày" hint="0–3, bước 0.5. Mọi mã làm việc theo Sheet = 1.">
                <input
                  type="number"
                  step="0.5"
                  min={0}
                  max={3}
                  className={cn(FIELD, "w-full tabular-nums")}
                  value={v.dayCredit}
                  onChange={(e) => set("dayCredit", Number(e.target.value))}
                />
              </Field>
              <Field label="Cách trả công">
                <select
                  className={cn(FIELD, "w-full")}
                  value={v.payMode}
                  onChange={(e) => set("payMode", e.target.value as TemplateEditorValue["payMode"])}
                >
                  <option value="SHIFT">Theo ca</option>
                  <option value="ADMIN_HOURS">Giờ hành chính</option>
                  <option value="NONE">Không</option>
                </select>
              </Field>
            </>
          )}
          <Field label="Ghi chú" wide>
            <input
              className={cn(FIELD, "w-full")}
              value={v.note ?? ""}
              onChange={(e) => set("note", e.target.value || null)}
              placeholder="VD: Nghỉ giữa giờ 16:30–17:00, tính vào giờ làm"
              maxLength={500}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={v.isActive}
              onChange={(e) => set("isActive", e.target.checked)}
            />
            Đang dùng (bỏ chọn = ngưng, không xếp mới được nữa)
          </label>
        </Group>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
        <button type="button" className={BTN_PRIMARY} onClick={submit} disabled={pending || !v.code || !v.name}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {v.id ? "Lưu" : "Tạo mã ca"}
        </button>
        <button type="button" className={BTN_OUTLINE} onClick={onCancel} disabled={pending}>
          Huỷ
        </button>
        {v.id && (
          <span className="ml-auto text-xs text-muted-foreground">
            Lịch đã xếp giữ giờ cũ — chỉ ô xếp sau khi lưu mới dùng giờ mới.
          </span>
        )}
      </div>
    </div>
  );
}
