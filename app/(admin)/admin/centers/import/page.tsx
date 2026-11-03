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

interface CenterImportRow {
  name: string;
  slug: string;
  address: string;
  ward?: string;
  district?: string;
  city: string;
  phone?: string;
  email?: string;
  googleMapUrl?: string;
  workingHours?: string;
  managerName?: string;
  description?: string;
  isActive?: boolean | number | string;
  displayOrder?: number | string;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

export default function ImportCentersPage() {
  const router = useRouter();

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <Link
          href="/centers"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
        </Link>
        <h1 className="text-2xl font-bold">Import Cơ sở từ Excel</h1>
      </div>

      <PageHelp>
        <p>
          Tải template, điền thông tin, upload lại. Slug trùng sẽ UPDATE
          (upsert), slug mới sẽ CREATE.
        </p>
      </PageHelp>

      <ExcelImporter<CenterImportRow>
        title="Import Cơ sở"
        templateUrl="/templates/mau-co-so-v2.xlsx"
        templateFilename="mau-co-so-v2.xlsx"
        duplicateLabel="slug"
        duplicateKey={(raw) =>
          String(raw.slug ?? "")
            .trim()
            .toLowerCase() || null
        }
        checkExisting={(raws, nos) =>
          precheckUpsert(
            "centers",
            raws.map(
              (r) =>
                String(r.slug ?? "")
                  .trim()
                  .toLowerCase() || null,
            ),
            nos,
            "Slug cơ sở",
          )
        }
        columnHints={[
          { key: "name", label: "Tên chi nhánh", required: true },
          { key: "slug", label: "Slug", required: true },
          { key: "address", label: "Địa chỉ", required: true },
          { key: "ward", label: "Phường" },
          { key: "district", label: "Quận" },
          { key: "city", label: "Tỉnh/TP", required: true },
          { key: "phone", label: "SĐT" },
          { key: "email", label: "Email" },
          { key: "googleMapUrl", label: "Google Maps" },
          { key: "workingHours", label: "Giờ làm việc" },
          { key: "managerName", label: "Quản lý" },
          { key: "description", label: "Mô tả" },
          { key: "isActive", label: "Active (1/0)" },
          { key: "displayOrder", label: "Order" },
        ]}
        parseRow={(row) => {
          const name = asString(row.name);
          const slug = asString(row.slug);
          const address = asString(row.address);
          const city = asString(row.city);
          if (!name) return { error: "Thiếu tên chi nhánh" };
          if (!slug) return { error: "Thiếu slug" };
          if (!/^[a-z0-9-]+$/.test(slug))
            return { error: "Slug chỉ chứa a-z, 0-9, dấu -" };
          if (!address) return { error: "Thiếu địa chỉ" };
          if (!city) return { error: "Thiếu tỉnh/TP" };

          const emailStr = asString(row.email);
          if (emailStr && emailStr.trim() !== "") {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr.trim())) {
              return { error: "Email không hợp lệ" };
            }
          }

          return {
            name,
            slug,
            address,
            ward: asString(row.ward),
            district: asString(row.district),
            city,
            phone: asString(row.phone),
            email: emailStr,
            googleMapUrl: asString(row.googleMapUrl),
            workingHours: asString(row.workingHours),
            managerName: asString(row.managerName),
            description: asString(row.description),
            isActive: row.isActive as boolean | number | string | undefined,
            displayOrder: row.displayOrder as number | string | undefined,
          };
        }}
        onImport={async (rows) => {
          const res = await fetch("/api/admin/import/centers", {
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
            Slug là unique key — trùng slug sẽ <strong>UPDATE</strong> record có
            sẵn (upsert).
          </li>
          <li>
            Slug chỉ chứa chữ thường, số, và dấu gạch ngang (vd:{" "}
            <code>danang</code>, <code>ho-chi-minh</code>).
          </li>
          <li>
            <code>isActive</code>: 1 = true, 0 = false. Mặc định 1.
          </li>
          <li>
            Logo và banner KHÔNG import từ Excel — phải edit sau qua admin form.
          </li>
        </ul>
      </div>
    </div>
  );
}
