"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { precheckUpsert } from "@/components/admin/import-precheck";
import {
  ExcelImporter,
  type ImportResult,
} from "@/components/admin/ExcelImporter";
import { PageHelp } from "@/components/admin/ui/page-help";
import { docLoiPhanHoi } from "@/lib/ui/loi-phan-hoi";

interface StudentImportRow {
  studentCode?: string;
  fullName: string;
  dateOfBirth?: string | number | Date;
  gender?: string;
  currentGrade?: number | string;
  school?: string;
  parentName: string;
  parentPhone: string;
  parentEmail?: string;
  parentRelation?: string;
  parent2Name?: string;
  parent2Phone?: string;
  parent2Relation?: string;
  address?: string;
  ward?: string;
  district?: string;
  city?: string;
  centerSlug?: string;
  enrollmentDate?: string | number | Date;
  status?: string;
  bloodType?: string;
  allergies?: string;
  healthNotes?: string;
  notes?: string;
}

const VALID_STATUSES = new Set(["ACTIVE", "PAUSED", "GRADUATED", "INACTIVE"]);
const VALID_GENDERS = new Set(["MALE", "FEMALE", "OTHER"]);
const VALID_BLOOD_TYPES = new Set([
  "A_POS",
  "A_NEG",
  "B_POS",
  "B_NEG",
  "O_POS",
  "O_NEG",
  "AB_POS",
  "AB_NEG",
  "UNKNOWN",
]);

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

function looksLikeDate(v: unknown): boolean {
  if (v instanceof Date) return true;
  if (typeof v === "number" && Number.isFinite(v)) return true;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return false;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return true;
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return true;
    if (!Number.isNaN(Date.parse(s))) return true;
  }
  return false;
}

export default function ImportStudentsPage() {
  const router = useRouter();

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <Link
          href="/students"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
        </Link>
        <h1 className="text-2xl font-bold">Import Học viên từ Excel</h1>
      </div>

      <PageHelp>
        <p>
          <code>studentCode</code> là khoá upsert — trùng mã sẽ UPDATE, mới sẽ
          CREATE. Để trống → luôn CREATE (có thể tạo bản ghi trùng).
        </p>
      </PageHelp>

      <ExcelImporter<StudentImportRow>
        title="Import Học viên"
        templateUrl="/templates/mau-hoc-vien-v2.xlsx"
        templateFilename="mau-hoc-vien-v2.xlsx"
        duplicateLabel="Mã HS"
        duplicateKey={(raw) => String(raw.studentCode ?? "").trim() || null}
        checkExisting={(raws, nos) =>
          precheckUpsert(
            "students",
            raws.map((r) => String(r.studentCode ?? "").trim() || null),
            nos,
            "Mã HS",
          )
        }
        columnHints={[
          { key: "studentCode", label: "Mã HS (upsert key)" },
          { key: "fullName", label: "Họ tên HS", required: true },
          { key: "dateOfBirth", label: "Ngày sinh" },
          { key: "gender", label: "Giới tính" },
          { key: "currentGrade", label: "Lớp (1-12)" },
          { key: "school", label: "Trường" },
          { key: "parentName", label: "Tên PH chính", required: true },
          { key: "parentPhone", label: "SĐT PH chính", required: true },
          { key: "parentEmail", label: "Email PH" },
          { key: "parentRelation", label: "Quan hệ PH" },
          { key: "parent2Name", label: "Tên PH 2" },
          { key: "parent2Phone", label: "SĐT PH 2" },
          { key: "parent2Relation", label: "Quan hệ PH 2" },
          { key: "address", label: "Địa chỉ" },
          { key: "ward", label: "Phường" },
          { key: "district", label: "Quận" },
          { key: "city", label: "Tỉnh/TP" },
          { key: "centerSlug", label: "Slug cơ sở mong muốn" },
          { key: "enrollmentDate", label: "Ngày đăng ký" },
          { key: "status", label: "Trạng thái" },
          { key: "bloodType", label: "Nhóm máu" },
          { key: "allergies", label: "Dị ứng (cách ,)" },
          { key: "healthNotes", label: "Ghi chú sức khoẻ" },
          { key: "notes", label: "Ghi chú nội bộ" },
        ]}
        parseRow={(row) => {
          const fullName = asString(row.fullName);
          const parentName = asString(row.parentName);
          const parentPhone = asString(row.parentPhone);

          if (!fullName) return { error: "Thiếu họ tên HS (fullName)" };
          if (!parentName) return { error: "Thiếu tên PH chính (parentName)" };
          if (!parentPhone)
            return { error: "Thiếu SĐT PH chính (parentPhone)" };

          const grade = row.currentGrade;
          if (grade !== undefined && grade !== null && grade !== "") {
            const g =
              typeof grade === "number" ? grade : parseInt(String(grade), 10);
            if (!Number.isFinite(g) || g < 1 || g > 12) {
              return { error: "Lớp phải từ 1 đến 12" };
            }
          }

          const gender = asString(row.gender);
          if (gender && !VALID_GENDERS.has(gender)) {
            return { error: "Giới tính phải là MALE/FEMALE/OTHER" };
          }

          const status = asString(row.status);
          if (status && !VALID_STATUSES.has(status)) {
            return {
              error: `Trạng thái không hợp lệ. Hợp lệ: ${[...VALID_STATUSES].join(" / ")}`,
            };
          }

          const bloodType = asString(row.bloodType);
          if (bloodType && !VALID_BLOOD_TYPES.has(bloodType)) {
            return {
              error: "Nhóm máu sai (A_POS, A_NEG, ..., UNKNOWN)",
            };
          }

          const parentEmail = asString(row.parentEmail);
          if (parentEmail && parentEmail.trim() !== "") {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail.trim())) {
              return { error: "Email PH không hợp lệ" };
            }
          }

          if (row.dateOfBirth && !looksLikeDate(row.dateOfBirth)) {
            return { error: "Ngày sinh phải dạng YYYY-MM-DD hoặc DD/MM/YYYY" };
          }
          if (row.enrollmentDate && !looksLikeDate(row.enrollmentDate)) {
            return {
              error: "Ngày đăng ký phải dạng YYYY-MM-DD hoặc DD/MM/YYYY",
            };
          }

          return {
            studentCode: asString(row.studentCode),
            fullName,
            dateOfBirth: row.dateOfBirth as string | number | Date | undefined,
            gender,
            currentGrade: row.currentGrade as number | string | undefined,
            school: asString(row.school),
            parentName,
            parentPhone,
            parentEmail,
            parentRelation: asString(row.parentRelation),
            parent2Name: asString(row.parent2Name),
            parent2Phone: asString(row.parent2Phone),
            parent2Relation: asString(row.parent2Relation),
            address: asString(row.address),
            ward: asString(row.ward),
            district: asString(row.district),
            city: asString(row.city),
            centerSlug: asString(row.centerSlug),
            enrollmentDate: row.enrollmentDate as
              | string
              | number
              | Date
              | undefined,
            status,
            bloodType,
            allergies: asString(row.allergies),
            healthNotes: asString(row.healthNotes),
            notes: asString(row.notes),
          };
        }}
        onImport={async (rows) => {
          const res = await fetch("/api/admin/import/students", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows }),
          });
          if (!res.ok) {
            // Route tra loi theo HAI hinh dang; `docLoiPhanHoi` doc du ca hai.
            const than = (await res.json().catch(() => null)) as {
              error?: string;
              errors?: { row: number; error: string }[];
            } | null;
            throw new Error(docLoiPhanHoi(res.status, than));
          }
          const result = (await res.json()) as ImportResult;
          setTimeout(() => router.refresh(), 1000);
          return result;
        }}
      />

      <div className="text-sm text-muted-foreground mt-4 space-y-1 rounded-xl border border-border bg-muted p-4">
        <p className="font-semibold text-foreground">Lưu ý:</p>
        <ul className="list-disc list-inside space-y-0.5">
          <li>
            <code>studentCode</code> là khoá upsert. Trùng = UPDATE; mới =
            CREATE. Để trống → luôn CREATE (có thể tạo trùng).
          </li>
          <li>
            Định dạng ngày: <code>YYYY-MM-DD</code> hoặc <code>DD/MM/YYYY</code>
            .
          </li>
          <li>
            <code>currentGrade</code>: số nguyên 1-12 (tương ứng lớp 1 đến lớp
            12).
          </li>
          <li>
            <code>gender</code>: <code>MALE</code> / <code>FEMALE</code> /{" "}
            <code>OTHER</code>.
          </li>
          <li>
            <code>status</code>: <code>ACTIVE</code> / <code>PAUSED</code> /{" "}
            <code>GRADUATED</code> / <code>INACTIVE</code>. Mặc định{" "}
            <code>ACTIVE</code>.
          </li>
          <li>
            <code>bloodType</code>: <code>A_POS</code> = A+, <code>A_NEG</code>{" "}
            = A−, ... <code>UNKNOWN</code> = chưa biết.
          </li>
          <li>
            <code>allergies</code>: cách nhau bằng dấu phẩy (vd: &quot;Tôm, sữa,
            phấn hoa&quot;).
          </li>
          <li>
            <code>centerSlug</code>: slug của cơ sở mong muốn — rỗng = chưa
            chọn. Sai slug → row bỏ qua.
          </li>
          <li>Avatar HS KHÔNG import từ Excel — upload sau qua admin form.</li>
        </ul>
      </div>
    </div>
  );
}
