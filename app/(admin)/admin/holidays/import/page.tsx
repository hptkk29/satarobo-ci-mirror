"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ExcelImporter, type ImportResult } from "@/components/admin/ExcelImporter";
import { docLoiPhanHoi } from "@/lib/ui/loi-phan-hoi";

interface HolidayImportRow {
  name: string;
  date: string | number | Date;
  endDate?: string | number | Date | null;
  centerSlug?: string;
  type?: string;
  note?: string;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

const VALID_TYPES = new Set(["HOLIDAY", "MAINTENANCE", "EVENT", "OTHER"]);

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

export default function ImportHolidaysPage() {
  const router = useRouter();

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <Link
          href="/holidays"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
        </Link>
        <h1 className="text-2xl font-bold">Import Lịch nghỉ từ Excel</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Format date: <code>YYYY-MM-DD</code> (vd: <code>2026-01-01</code>). Để trống{" "}
          <code>centerSlug</code> = toàn hệ thống. Trùng (date + name + centerSlug) sẽ{" "}
          <strong>SKIP</strong>.
        </p>
      </div>

      <ExcelImporter<HolidayImportRow>
        title="Import Lịch nghỉ"
        templateUrl="/templates/mau-lich-nghi-v2.xlsx"
        templateFilename="mau-lich-nghi-v2.xlsx"
        columnHints={[
          { key: "name", label: "Tên", required: true },
          { key: "date", label: "Ngày bắt đầu", required: true },
          { key: "endDate", label: "Ngày kết thúc" },
          { key: "centerSlug", label: "Slug cơ sở (rỗng = toàn HT)" },
          { key: "type", label: "Loại" },
          { key: "note", label: "Ghi chú" },
        ]}
        parseRow={(row) => {
          const name = asString(row.name);
          if (!name) return { error: "Thiếu tên" };
          if (row.date === undefined || row.date === null || row.date === "") {
            return { error: "Thiếu ngày bắt đầu" };
          }
          if (!looksLikeDate(row.date)) {
            return { error: "date phải dạng YYYY-MM-DD" };
          }
          if (
            row.endDate !== undefined &&
            row.endDate !== null &&
            row.endDate !== "" &&
            !looksLikeDate(row.endDate)
          ) {
            return { error: "endDate phải dạng YYYY-MM-DD" };
          }
          const typeStr = asString(row.type);
          if (typeStr && !VALID_TYPES.has(typeStr)) {
            return { error: "type phải là HOLIDAY/MAINTENANCE/EVENT/OTHER" };
          }
          return {
            name,
            date: row.date as string | number | Date,
            endDate: (row.endDate as string | number | Date | undefined) ?? null,
            centerSlug: asString(row.centerSlug),
            type: typeStr ?? "HOLIDAY",
            note: asString(row.note),
          };
        }}
        onImport={async (rows) => {
          const res = await fetch("/api/admin/import/holidays", {
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
            Trùng <code>(date, name, centerSlug)</code> → row đó <strong>bị SKIP</strong> (báo
            trong list lỗi). Không có update — sửa qua admin form.
          </li>
          <li>
            <code>centerSlug</code> rỗng = toàn hệ thống. Có giá trị → phải khớp slug trong{" "}
            <code>/admin/centers</code>.
          </li>
          <li>
            <code>type</code>: <code>HOLIDAY</code> / <code>MAINTENANCE</code> /{" "}
            <code>EVENT</code> / <code>OTHER</code>. Mặc định <code>HOLIDAY</code>.
          </li>
          <li>
            <code>endDate</code> để trống nếu nghỉ 1 ngày.
          </li>
        </ul>
      </div>
    </div>
  );
}
