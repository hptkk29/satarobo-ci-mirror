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

interface ClassImportRow {
  classCode?: string;
  name: string;
  courseSlug: string;
  centerSlug: string;
  roomCode?: string;
  teacherCode?: string;
  assistantCode?: string;
  startDate?: string | number | Date;
  endDate?: string | number | Date;
  scheduleDays?: string | number;
  startTime?: string;
  endTime?: string;
  minStudents?: number | string;
  maxStudents?: number | string;
  status?: string;
  description?: string;
  // 20/08 — KHÔNG còn khoá `notes`: ô "Ghi chú nội bộ" đã bị gỡ khỏi form lớp (nó trùng
  // vai với "Mô tả chi tiết đặc thù lớp học"), nên không màn hình nào ĐỌC `Class.notes`
  // nữa. Vẫn nhận cột đó từ Excel = ghi mù xuống DB rồi chôn ở đó, người nhập tưởng
  // "ghi chú đã lưu". Cột DB giữ nguyên (không migration) — chỉ cắt đường GHI mới.
  // Vì sao KHÔNG trỏ sang `description`: đó là đổi ý nghĩa dữ liệu. `description` nay là
  // sổ bàn giao đặc thù lớp (tính cách từng HV), còn ví dụ trong file mẫu cho cột notes là
  // "Campaign 2026-05-23" — nhãn chiến dịch. Gộp vào là trộn hai loại nội dung, và với
  // upsert theo classCode còn ĐÈ mất sổ bàn giao đang có.
}

const VALID_STATUSES = new Set([
  "PLANNED",
  "RECRUITING",
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
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

export default function ImportClassesPage() {
  const router = useRouter();

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <Link
          href="/classes"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
        </Link>
        <h1 className="text-2xl font-bold">Import Lớp học từ Excel</h1>
      </div>

      <PageHelp>
        <p>
          <code>classCode</code> = khoá upsert. <strong>5 references</strong>{" "}
          phải tồn tại trước: courseSlug, centerSlug, roomCode (theo center),
          teacherCode + assistantCode (Employee role TEACHER/CENTER_MANAGER + có
          User account).
        </p>
      </PageHelp>

      <ExcelImporter<ClassImportRow>
        title="Import Lớp học"
        templateUrl="/templates/mau-lop-hoc-v2.xlsx"
        templateFilename="mau-lop-hoc-v2.xlsx"
        duplicateLabel="Mã lớp"
        duplicateKey={(raw) => String(raw.classCode ?? "").trim() || null}
        checkExisting={(raws, nos) =>
          precheckUpsert(
            "classes",
            raws.map((r) => String(r.classCode ?? "").trim() || null),
            nos,
            "Mã lớp",
          )
        }
        columnHints={[
          { key: "classCode", label: "Mã lớp (upsert key)" },
          { key: "name", label: "Tên lớp", required: true },
          { key: "courseSlug", label: "Slug khoá học", required: true },
          { key: "centerSlug", label: "Slug cơ sở", required: true },
          { key: "roomCode", label: "Mã phòng" },
          { key: "teacherCode", label: "Mã GV chính" },
          { key: "assistantCode", label: "Mã GV phụ" },
          { key: "startDate", label: "Ngày khai giảng" },
          { key: "endDate", label: "Ngày kết thúc" },
          { key: "scheduleDays", label: "Thứ học (T2,T5 hoặc 1,4)" },
          { key: "startTime", label: "Giờ bắt đầu HH:mm" },
          { key: "endTime", label: "Giờ kết thúc HH:mm" },
          { key: "minStudents", label: "Min HS" },
          { key: "maxStudents", label: "Max HS" },
          { key: "status", label: "Trạng thái" },
          { key: "description", label: "Mô tả chi tiết đặc thù lớp học" },
          // Cột "Ghi chú" (notes) đã gỡ khỏi bảng ánh xạ — xem chú thích ở ClassImportRow.
        ]}
        parseRow={(row) => {
          const name = asString(row.name);
          const courseSlug = asString(row.courseSlug);
          const centerSlug = asString(row.centerSlug);

          if (!name) return { error: "Thiếu tên lớp (name)" };
          if (!courseSlug) return { error: "Thiếu courseSlug" };
          if (!centerSlug) return { error: "Thiếu centerSlug" };

          const status = asString(row.status);
          if (status && !VALID_STATUSES.has(status)) {
            return {
              error: `Trạng thái sai. Hợp lệ: ${[...VALID_STATUSES].join(" / ")}`,
            };
          }

          const startTime = asString(row.startTime);
          if (startTime && !/^\d{2}:\d{2}$/.test(startTime)) {
            return { error: "startTime phải HH:mm (pad 0, vd 08:00)" };
          }
          const endTime = asString(row.endTime);
          if (endTime && !/^\d{2}:\d{2}$/.test(endTime)) {
            return { error: "endTime phải HH:mm (pad 0)" };
          }

          if (row.startDate && !looksLikeDate(row.startDate)) {
            return { error: "startDate phải YYYY-MM-DD hoặc DD/MM/YYYY" };
          }
          if (row.endDate && !looksLikeDate(row.endDate)) {
            return { error: "endDate phải YYYY-MM-DD hoặc DD/MM/YYYY" };
          }

          for (const key of ["minStudents", "maxStudents"] as const) {
            const raw = row[key];
            if (raw !== undefined && raw !== null && raw !== "") {
              const n =
                typeof raw === "number" ? raw : parseInt(String(raw), 10);
              if (!Number.isFinite(n) || n < 1) {
                return { error: `${key} phải là số >= 1` };
              }
            }
          }

          return {
            classCode: asString(row.classCode),
            name,
            courseSlug,
            centerSlug,
            roomCode: asString(row.roomCode),
            teacherCode: asString(row.teacherCode),
            assistantCode: asString(row.assistantCode),
            startDate: row.startDate as string | number | Date | undefined,
            endDate: row.endDate as string | number | Date | undefined,
            scheduleDays: row.scheduleDays as string | number | undefined,
            startTime,
            endTime,
            minStudents: row.minStudents as number | string | undefined,
            maxStudents: row.maxStudents as number | string | undefined,
            status,
            description: asString(row.description),
            // Không dựng `notes`: API import để `notes: undefined` ⇒ Prisma BỎ QUA field,
            // nên lớp cũ (upsert theo classCode) vẫn giữ nguyên ghi chú đã lưu từ trước.
          };
        }}
        onImport={async (rows) => {
          const res = await fetch("/api/admin/import/classes", {
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
            <code>scheduleDays</code> chấp nhận Vietnamese (vd{" "}
            <code>T2,T5</code>) hoặc numeric (vd <code>1,4</code>). Quy ước:
            CN=0, T2=1, …, T7=6. Phân tách bằng dấu phẩy.
          </li>
          <li>
            <code>roomCode</code> phải thuộc <code>centerSlug</code> đã chọn (vd{" "}
            <code>DN-A1</code> chỉ tồn tại trong cơ sở <code>danang</code>). Sai
            → row bỏ qua.
          </li>
          <li>
            <code>teacherCode</code> / <code>assistantCode</code>: phải là
            Employee có <strong>role TEACHER hoặc CENTER_MANAGER</strong> +{" "}
            <strong>status ACTIVE</strong>+ có User account active. Sai → row bỏ
            qua.
          </li>
          <li>GV phụ không được trùng GV chính → row bỏ qua.</li>
          <li>
            <code>startTime</code> / <code>endTime</code>: định dạng{" "}
            <code>HH:mm</code> (luôn pad số 0, vd <code>08:00</code> không phải{" "}
            <code>8:00</code>).
          </li>
          <li>
            Default: <code>minStudents=5</code>, <code>maxStudents=20</code>,{" "}
            <code>status=PLANNED</code>.
          </li>
          <li>
            <code>classCode</code> trùng → UPDATE; mới → CREATE; rỗng → luôn
            CREATE.
          </li>
          {/* File mẫu .xlsx đang phát hành vẫn còn cột `notes` (nó là artifact nhị phân,
              sửa ở đợt phát hành mẫu sau). Nói thẳng ở đây để người nhập không điền rồi
              tưởng đã lưu — bảng xem trước bên trên cũng không hiện cột đó nữa. */}
          <li>
            Cột <code>notes</code> trong file mẫu <strong>không còn được nhập</strong>{" "}
            (ô &ldquo;Ghi chú nội bộ&rdquo; đã gỡ khỏi lớp học). Ghi chú về lớp
            viết vào cột <code>description</code>.
          </li>
        </ul>
      </div>
    </div>
  );
}
