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

const VALID_CATEGORIES = new Set([
  "MAINBOARD",
  "SENSOR",
  "MOTOR",
  "BATTERY",
  "MECHANICAL",
  "WIRE",
  "TOOL",
  "CONSUMABLE",
  "ROBOSIM",
  "OTHER",
]);

interface ItemRow {
  itemCode: string;
  name: string;
  description?: string;
  category?: string;
  unit?: string;
  pricePerUnit?: number | string;
  supplier?: string;
  defaultMinThreshold?: number | string;
  tags?: string;
  isActive?: string;
  notes?: string;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

export default function ImportInventoryItemsPage() {
  const router = useRouter();

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <Link
          href="/inventory/items"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại kho
        </Link>
        <h1 className="text-2xl font-bold">Import Học cụ từ Excel</h1>
      </div>

      <PageHelp>
        <p>
          <code>itemCode</code> = khoá upsert. Khi tạo mặt hàng mới, hệ thống tự
          khởi tạo tồn = 0 cho mọi cơ sở active. Re-import item cũ sẽ UPDATE
          metadata nhưng KHÔNG reset tồn (skipDuplicates).
        </p>
      </PageHelp>

      <ExcelImporter<ItemRow>
        title="Import Học cụ"
        templateUrl="/templates/mau-hoc-cu-v2.xlsx"
        templateFilename="mau-hoc-cu-v2.xlsx"
        duplicateLabel="Mã học cụ"
        duplicateKey={(raw) => String(raw.itemCode ?? "").trim() || null}
        checkExisting={(raws, nos) =>
          precheckUpsert(
            "inventory-items",
            raws.map((r) => String(r.itemCode ?? "").trim() || null),
            nos,
            "Mã học cụ",
          )
        }
        columnHints={[
          { key: "itemCode", label: "Mã hàng (upsert key)", required: true },
          { key: "name", label: "Tên hàng", required: true },
          { key: "description", label: "Mô tả" },
          { key: "category", label: "Danh mục" },
          { key: "unit", label: "Đơn vị (Cái/Bộ/Mét...)" },
          { key: "pricePerUnit", label: "Giá / đơn vị (VND)" },
          { key: "supplier", label: "Nhà cung cấp" },
          { key: "defaultMinThreshold", label: "Ngưỡng tối thiểu" },
          { key: "tags", label: "Tags (cách ,)" },
          { key: "isActive", label: "Active (TRUE/FALSE)" },
          { key: "notes", label: "Ghi chú" },
        ]}
        parseRow={(row) => {
          const itemCode = asString(row.itemCode);
          const name = asString(row.name);

          if (!itemCode || itemCode.trim() === "") {
            return { error: "Thiếu itemCode" };
          }
          if (!name || name.trim() === "") {
            return { error: "Thiếu tên hàng (name)" };
          }
          const category = asString(row.category);
          if (category && !VALID_CATEGORIES.has(category)) {
            return {
              error: `Danh mục sai. Hợp lệ: ${[...VALID_CATEGORIES].join(" / ")}`,
            };
          }

          const priceRaw = row.pricePerUnit;
          if (priceRaw !== undefined && priceRaw !== null && priceRaw !== "") {
            const n =
              typeof priceRaw === "number"
                ? priceRaw
                : parseFloat(String(priceRaw));
            if (!Number.isFinite(n) || n < 0) {
              return {
                error:
                  "Giá phải là số >= 0 (raw number, không dùng dấu phẩy ngàn)",
              };
            }
          }
          const thRaw = row.defaultMinThreshold;
          if (thRaw !== undefined && thRaw !== null && thRaw !== "") {
            const n =
              typeof thRaw === "number" ? thRaw : parseInt(String(thRaw), 10);
            if (!Number.isFinite(n) || n < 0) {
              return { error: "Ngưỡng phải là số >= 0" };
            }
          }

          return {
            itemCode,
            name,
            description: asString(row.description),
            category,
            unit: asString(row.unit),
            pricePerUnit: row.pricePerUnit as number | string | undefined,
            supplier: asString(row.supplier),
            defaultMinThreshold: row.defaultMinThreshold as
              | number
              | string
              | undefined,
            tags: asString(row.tags),
            isActive: asString(row.isActive),
            notes: asString(row.notes),
          };
        }}
        onImport={async (rows) => {
          const res = await fetch("/api/admin/import/inventory-items", {
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
            <code>category</code>: <code>MAINBOARD</code> / <code>SENSOR</code>{" "}
            / <code>MOTOR</code> / <code>BATTERY</code> /{" "}
            <code>MECHANICAL</code> / <code>WIRE</code> / <code>TOOL</code> /{" "}
            <code>CONSUMABLE</code> / <code>ROBOSIM</code> / <code>OTHER</code>.
          </li>
          <li>
            <code>isActive</code>: <code>TRUE</code> / <code>FALSE</code> /{" "}
            <code>1</code> / <code>0</code> / <code>YES</code> / <code>NO</code>{" "}
            / <code>ĐÚNG</code> · mặc định <code>TRUE</code>.
          </li>
          <li>
            <code>tags</code>: cách nhau bằng dấu phẩy (vd:{" "}
            <code>zmrobo, k1, mainboard</code>).
          </li>
          <li>
            <code>pricePerUnit</code>: raw number — KHÔNG dùng dấu phẩy ngàn.
            VD: <code>850000</code>, không <code>850,000</code>.
          </li>
          <li>
            Re-import item đã có tồn &gt; 0 → metadata UPDATE, balance giữ
            nguyên.
          </li>
          <li>
            Ảnh sản phẩm KHÔNG import qua Excel — upload sau qua admin form.
          </li>
        </ul>
      </div>
    </div>
  );
}
