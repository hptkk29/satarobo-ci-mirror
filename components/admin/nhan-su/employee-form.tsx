"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type {
  Employee,
  Department,
  Gender,
  ContractType,
  EmploymentStatus,
} from "@prisma/client";
import { ImageUploader } from "@/components/admin/ImageUploader";
import { Switch } from "@/components/ui/switch";
import { MoneyInput } from "@/components/ui/money-input";
import { FieldLabel, HelpHint } from "@/components/admin/ui/help-hint";
import { StringArrayEditor } from "@/app/(admin)/admin/kits/_components/string-array-editor";
import { getEmployeeFieldVisibility } from "@/lib/auth/permissions";
import {
  createEmployeeAction,
  updateEmployeeAction,
} from "@/app/(admin)/admin/nhan-su/actions";

interface Props {
  mode: "create" | "edit";
  initial?: Employee;
  defaultCode?: string;
  // PR-C: đơn vị làm việc đọc từ OrgUnit tree (gồm HO), lưu orgUnitId. centerId suy ra ở server.
  orgUnits: { id: string; name: string }[];
  managers: { id: string; fullName: string; jobTitle: string }[];
  // Track Department: phòng ban đọc động từ DB (DepartmentDef), không hardcode enum.
  departments: { code: string; name: string; isTeaching: boolean }[];
  userRole: string;
  /** NV có EmployeeOrgAssignment PRIMARY active tới OrgUnit HO (Hội sở). */
  initialIsHO?: boolean;
}

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: "MALE", label: "Nam" },
  { value: "FEMALE", label: "Nữ" },
  { value: "OTHER", label: "Khác" },
];

const CONTRACT_OPTIONS: { value: ContractType; label: string }[] = [
  { value: "FULLTIME", label: "Toàn thời gian" },
  { value: "PARTTIME", label: "Bán thời gian" },
  { value: "INTERN", label: "Thực tập sinh" },
  { value: "FREELANCE", label: "Cộng tác viên" },
];

const EMPLOYMENT_STATUS_OPTIONS: { value: EmploymentStatus; label: string }[] = [
  { value: "ACTIVE", label: "Đang làm" },
  { value: "ON_LEAVE", label: "Tạm nghỉ" },
  { value: "RESIGNED", label: "Đã nghỉ" },
  { value: "TERMINATED", label: "Cho nghỉ" },
];


function dateInputValue(d: Date | null | undefined): string {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

export function EmployeeForm({
  mode,
  initial,
  defaultCode,
  orgUnits,
  managers,
  departments,
  userRole,
  initialIsHO = false,
}: Props) {
  // Track Department: tập code phòng ban "giảng dạy" suy từ DB (thay hardcode).
  const teachingCodes = new Set(
    departments.filter((d) => d.isTeaching).map((d) => d.code),
  );
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const visibility = getEmployeeFieldVisibility(userRole);
  const [isHO, setIsHO] = useState(initialIsHO);

  const [data, setData] = useState({
    employeeCode: initial?.employeeCode ?? defaultCode ?? "",
    fullName: initial?.fullName ?? "",
    jobTitle: initial?.jobTitle ?? "",
    department: (initial?.department ?? "DAO_TAO") as Department,
    avatarUrl: initial?.avatarUrl ?? "",
    email: initial?.email ?? "",
    joinedAt: dateInputValue(initial?.joinedAt),
    bio: initial?.bio ?? "",
    isActive: initial?.isActive ?? true,
    isPublic: initial?.isPublic ?? false,
    displayOrder: initial?.displayOrder ?? 0,

    phone: initial?.phone ?? "",
    dateOfBirth: dateInputValue(initial?.dateOfBirth),
    gender: (initial?.gender ?? "") as Gender | "",
    contractType: (initial?.contractType ?? "") as ContractType | "",
    salaryRank: initial?.salaryRank ?? "",
    salaryLevel: initial?.salaryLevel ?? "",
    orgUnitId: initial?.orgUnitId ?? "",
    managerId: initial?.managerId ?? "",
    // Phase 4.7 extension
    endDate: dateInputValue(initial?.endDate),
    bhxhBase: initial?.bhxhBase ?? "",
    address: initial?.address ?? "",
    emergencyContact: initial?.emergencyContact ?? "",
    notes: initial?.notes ?? "",
    isCEO: initial?.isCEO ?? false,
    // Module chấm công v3 (T-02): miễn tính công. Server chỉ nhận từ SUPER_ADMIN.
    timesheetExempt: initial?.timesheetExempt ?? false,

    // Phase C1
    nationalId: initial?.nationalId ?? "",
    status: (initial?.status ?? "ACTIVE") as EmploymentStatus,
    subjects: initial?.subjects ?? [],
    certifications: initial?.certifications ?? [],
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // NV không phải HO bắt buộc chọn đơn vị làm việc; NV HO gán vào OrgUnit HO (server xử lý).
    if (!isHO && !data.orgUnitId) {
      toast.error("Chọn đơn vị làm việc (hoặc bật 'Nhân viên HO').");
      return;
    }

    const input = {
      ...data,
      // Convert empty strings to null for optional fields
      avatarUrl: data.avatarUrl || null,
      email: data.email || null,
      joinedAt: data.joinedAt || null,
      bio: data.bio || null,
      phone: data.phone || null,
      dateOfBirth: data.dateOfBirth || null,
      gender: data.gender || null,
      contractType: data.contractType || null,
      salaryRank: data.salaryRank ? Number(data.salaryRank) : null,
      salaryLevel: data.salaryLevel ? Number(data.salaryLevel) : null,
      orgUnitId: isHO ? null : data.orgUnitId || null,
      managerId: data.managerId || null,
      // Phase 4.7 extension
      endDate: data.endDate || null,
      bhxhBase: data.bhxhBase ? Number(data.bhxhBase) : null,
      address: data.address || null,
      emergencyContact: data.emergencyContact || null,
      notes: data.notes || null,
      displayOrder: Number(data.displayOrder),

      // Phase C1
      nationalId: data.nationalId || null,
      status: data.status,
      subjects: data.subjects,
      certifications: data.certifications,
    };

    startTransition(async () => {
      const res =
        mode === "create"
          ? await createEmployeeAction(input, isHO)
          : await updateEmployeeAction(initial!.id, input, isHO);

      if (res.ok) {
        toast.success(mode === "create" ? "Đã tạo nhân sự" : "Đã cập nhật");
        router.push("/nhan-su");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* ─── Tier 1: cơ bản ─── */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-bold">Thông tin cơ bản</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-semibold">Mã nhân viên *</label>
            <input
              required
              value={data.employeeCode}
              onChange={(e) => setData({ ...data, employeeCode: e.target.value })}
              className="w-full rounded-lg border border-border px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none"
              placeholder="SR.NV.001"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold">Họ tên *</label>
            <input
              required
              value={data.fullName}
              onChange={(e) => setData({ ...data, fullName: e.target.value })}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold">Chức danh *</label>
            <input
              required
              value={data.jobTitle}
              onChange={(e) => setData({ ...data, jobTitle: e.target.value })}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold">Phòng ban *</label>
            <select
              required
              value={data.department}
              onChange={(e) =>
                setData({ ...data, department: e.target.value as Department })
              }
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
            >
              {departments.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          {visibility.contact && (
            <div>
              <label className="mb-1 block text-sm font-semibold">Email công ty</label>
              <input
                type="email"
                value={data.email}
                onChange={(e) => setData({ ...data, email: e.target.value })}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-semibold">Ngày vào làm</label>
            <input
              type="date"
              value={data.joinedAt}
              onChange={(e) => setData({ ...data, joinedAt: e.target.value })}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-4">
          <ImageUploader
            label="Avatar"
            value={data.avatarUrl}
            onChange={(url) => setData({ ...data, avatarUrl: url ?? "" })}
            prefix="uploads/employees"
            aspect="square"
          />
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-sm font-semibold">Bio (Markdown)</label>
          <textarea
            rows={4}
            value={data.bio}
            onChange={(e) => setData({ ...data, bio: e.target.value })}
            placeholder="Giới thiệu ngắn về nhân sự — hỗ trợ Markdown."
            className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
        </div>

        <div className="mt-4">
          <FieldLabel
            label="Trạng thái công việc"
            hint={
              <>
                Mặc định <strong>Đang làm</strong>. <code>isActive</code> bên dưới chỉ là
                legacy flag — list filter chính dùng trạng thái này.
              </>
            }
          />
          <select
            value={data.status}
            onChange={(e) =>
              setData({ ...data, status: e.target.value as EmploymentStatus })
            }
            className="w-full max-w-xs rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
          >
            {EMPLOYMENT_STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2">
            <Switch
              checked={data.isActive}
              onCheckedChange={(v) => setData({ ...data, isActive: v })}
            />
            <span className="text-sm font-medium">Đang làm việc (legacy)</span>
          </label>
          <label className="flex items-center gap-2">
            <Switch
              checked={data.isPublic}
              onCheckedChange={(v) => setData({ ...data, isPublic: v })}
            />
            <span className="text-sm font-medium">Hiển thị public</span>
          </label>
          {visibility.personal && (
            <label className="flex items-center gap-2">
              <Switch
                checked={data.isCEO}
                onCheckedChange={(v) => setData({ ...data, isCEO: v })}
              />
              <span className="text-sm font-medium">CEO Quote auto-link</span>
            </label>
          )}
          {visibility.personal && (
            <label className="flex items-center gap-2" title="Không sinh bảng công, không vào kỳ công (T-02). Chỉ Quản trị tối cao đặt được.">
              <Switch
                checked={data.timesheetExempt}
                onCheckedChange={(v) => setData({ ...data, timesheetExempt: v })}
              />
              <span className="text-sm font-medium">Miễn tính công (chấm công)</span>
            </label>
          )}
        </div>
      </section>

      {/* ─── Tier 2: liên hệ + HR ─── */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-bold">Liên hệ & HR</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          {visibility.contact && (
            <div>
              <label className="mb-1 block text-sm font-semibold">Số điện thoại</label>
              <input
                value={data.phone}
                onChange={(e) => setData({ ...data, phone: e.target.value })}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
          )}

          <div className="sm:col-span-2">
            <label className="flex items-center gap-2 rounded-lg border border-state-info-soft bg-state-info-soft px-3 py-2">
              <Switch
                checked={isHO}
                onCheckedChange={(v) => {
                  setIsHO(v);
                  if (v) setData((d) => ({ ...d, orgUnitId: "" }));
                }}
              />
              <span className="text-sm font-medium text-state-info-ink">
                Nhân viên HO (Hội sở)
              </span>
              {/* Nút "?" nằm trong <label> vẫn an toàn: <button> là interactive content
                  nên trình duyệt KHÔNG chuyển tiếp cú bấm xuống công tắc. */}
              <HelpHint className="text-state-info-ink">
                Bật khi NV thuộc <strong>Hội sở</strong> (cross-center, không gắn 1 cơ sở
                cụ thể). Hệ thống gán <code>EmployeeOrgAssignment</code> PRIMARY tới đơn vị
                HO thay vì chọn cơ sở.
              </HelpHint>
            </label>
          </div>

          <div>
            <FieldLabel
              label="Đơn vị làm việc"
              hint="Gồm Hội sở (HO) + các cơ sở. Lưu phân công PRIMARY vào đơn vị này."
            />
            {/* KHOÁ khi đang bật "Nhân viên HO".
                BẪy đã xảy ra thật (22/08): ô này trước đây VẪN BẬT khi công tắc HO ON, nhưng
                lúc lưu thì `orgUnitId: isHO ? null : ...` VỨT BỎ lựa chọn đó. Người dùng chọn
                CS1, bấm Lưu, thấy "Đã cập nhật" — và không gì được ghi. Bốn giáo viên parttime
                đã mắt một vòng như vậy, vẫn ở HO-level và vẫn thấy mọi cơ sở.
                Khoá ô làm việc vứt bỏ trở thành BẤT KHẢ THI, thay vì im lặng. */}
            <select
              value={data.orgUnitId}
              disabled={isHO}
              aria-describedby={isHO ? "don-vi-bi-khoa" : undefined}
              onChange={(e) => setData({ ...data, orgUnitId: e.target.value })}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
            >
              <option value="">— Không chỉ định —</option>
              {orgUnits.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            {isHO && (
              <p
                id="don-vi-bi-khoa"
                className="mt-1 text-xs text-state-info-ink"
              >
                Đang bật <strong>Nhân viên HO</strong> nên không chọn cơ sở được. Muốn
                chuyển người này về một cơ sở thì <strong>tắt công tắc trên</strong> trước,
                rồi mới chọn.
              </p>
            )}
          </div>

          {visibility.personal && (
            <>
              <div>
                <label className="mb-1 block text-sm font-semibold">Ngày sinh</label>
                <input
                  type="date"
                  value={data.dateOfBirth}
                  onChange={(e) => setData({ ...data, dateOfBirth: e.target.value })}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold">Giới tính</label>
                <select
                  value={data.gender}
                  onChange={(e) =>
                    setData({ ...data, gender: e.target.value as Gender | "" })
                  }
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
                >
                  <option value="">— Không chỉ định —</option>
                  {GENDER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold">
                  Loại hợp đồng
                </label>
                <select
                  value={data.contractType}
                  onChange={(e) =>
                    setData({
                      ...data,
                      contractType: e.target.value as ContractType | "",
                    })
                  }
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
                >
                  <option value="">— Không chỉ định —</option>
                  {CONTRACT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold">
                  Quản lý trực tiếp
                </label>
                <select
                  value={data.managerId}
                  onChange={(e) => setData({ ...data, managerId: e.target.value })}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
                >
                  <option value="">— Không có —</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fullName} — {m.jobTitle}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <FieldLabel
                  label="Ngày kết thúc HĐ"
                  hint="Cho hợp đồng có thời hạn. Để trống nếu vô thời hạn."
                />
                <input
                  type="date"
                  value={data.endDate}
                  onChange={(e) => setData({ ...data, endDate: e.target.value })}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold">CCCD / CMND</label>
                <input
                  value={data.nationalId}
                  onChange={(e) => setData({ ...data, nationalId: e.target.value })}
                  placeholder="12 số CCCD hoặc 9 số CMND"
                  className="w-full rounded-lg border border-border px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-semibold">Địa chỉ</label>
                <input
                  value={data.address}
                  onChange={(e) => setData({ ...data, address: e.target.value })}
                  placeholder="Số nhà, đường, phường, quận, thành phố"
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-semibold">
                  Liên hệ khẩn cấp
                </label>
                <input
                  value={data.emergencyContact}
                  onChange={(e) =>
                    setData({ ...data, emergencyContact: e.target.value })
                  }
                  placeholder="Tên - Quan hệ - SĐT"
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-semibold">
                  Ghi chú nội bộ
                </label>
                <textarea
                  rows={3}
                  value={data.notes}
                  onChange={(e) => setData({ ...data, notes: e.target.value })}
                  placeholder="Ghi chú HR nội bộ — không hiển thị public."
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>
            </>
          )}
        </div>

        {visibility.salary && (
          <div className="mt-4 rounded-lg border border-state-warning-soft bg-state-warning-soft p-4">
            <p className="mb-3 text-sm font-semibold text-state-warning-ink">
              💰 Lương (chỉ HR / Accountant / SUPER_ADMIN thấy)
              <HelpHint className="ml-1 text-state-warning-ink">
                Tính lương cơ bản L1/L2 sẽ làm ở Phase 4.8 (Payroll). Hiện chỉ lưu Bậc/Mức
                + lương BHXH.
              </HelpHint>
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-semibold">
                  Bậc (SR.QD.200)
                </label>
                <input
                  type="number"
                  min={1}
                  max={9}
                  value={data.salaryRank}
                  onChange={(e) =>
                    setData({ ...data, salaryRank: e.target.value })
                  }
                  placeholder="1-9"
                  className="w-full rounded border border-state-warning px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold">Mức</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={data.salaryLevel}
                  onChange={(e) =>
                    setData({ ...data, salaryLevel: e.target.value })
                  }
                  placeholder="1-5"
                  className="w-full rounded border border-state-warning px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold">
                  Lương đóng BHXH (VNĐ)
                </label>
                {/* Ô TIỀN — gõ "5000000" hiện "5.000.000". Form này submit bằng state
                    (không đọc FormData) nên `name` chỉ để MoneyInput dựng ô ẩn; giá trị
                    thật đi qua `onValueChange`. */}
                <MoneyInput
                  name="bhxhBase"
                  min={0}
                  value={data.bhxhBase}
                  onValueChange={(v) => setData({ ...data, bhxhBase: v ?? "" })}
                  placeholder="5.000.000"
                  suffix={null}
                  className="rounded border-state-warning px-2 py-1.5"
                />
              </div>
            </div>
          </div>
        )}

        <div className="mt-4">
          <FieldLabel
            label="Display order"
            hint="Thứ tự hiển thị ở /vinh-danh, /ve-chung-toi. Số nhỏ hiện trước."
          />
          <input
            type="number"
            value={data.displayOrder}
            onChange={(e) =>
              setData({ ...data, displayOrder: Number(e.target.value || 0) })
            }
            className="w-32 rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
        </div>
      </section>

      {/* ─── Chuyên môn giảng dạy (chỉ Đào tạo / Giảng dạy) ─── */}
      {teachingCodes.has(data.department) && (
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 text-lg font-bold">
            Chuyên môn giảng dạy
            <HelpHint className="ml-1">
              Hiển thị khi phòng ban là <strong>Phòng Đào tạo</strong> hoặc{" "}
              <strong>Giảng dạy</strong>. Đổi phòng ban khác sẽ ẩn UI nhưng dữ liệu vẫn
              giữ.
            </HelpHint>
          </h2>

          <div className="space-y-5">
            <div>
              <label className="mb-1 block text-sm font-semibold">Môn dạy</label>
              <StringArrayEditor
                value={data.subjects}
                onChange={(arr) => setData({ ...data, subjects: arr })}
                placeholder="VD: Robotics, RoboSim, Lập trình Scratch"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-semibold">Chứng chỉ chuyên môn</label>
              <StringArrayEditor
                value={data.certifications}
                onChange={(arr) => setData({ ...data, certifications: arr })}
                placeholder="VD: TESOL, Robot Hardware Cert"
              />
            </div>
          </div>
        </section>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-primary px-6 py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
        >
          {isPending
            ? "Đang lưu..."
            : mode === "create"
              ? "Tạo nhân sự"
              : "Cập nhật"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/nhan-su")}
          disabled={isPending}
          className="rounded-lg border border-border px-6 py-2.5 text-sm font-semibold text-foreground hover:bg-muted"
        >
          Huỷ
        </button>
      </div>
    </form>
  );
}
