"use client";

// app/(admin)/admin/cham-cong/phan-ca/import/_components/import-wizard.tsx — ba bước đưa lịch
// phân ca từ file Sheet vào hệ thống: đọc file → soát ánh xạ & phạm vi → áp và đối chiếu.
//
// Vì sao màn này tồn tại: lịch phân ca vẫn được xếp trên Google Sheet; đây là cây cầu để người
// vận hành tự đưa nó vào hệ thống, không qua dev.
//
// BA ĐIỀU DỄ VỠ — sửa file này thì đọc trước:
//
//  1. `applyImportAction` KHÔNG chạy trong transaction: một kỳ đủ người là ~600 lượt ghi. Rớt
//     mạng hay DB timeout giữa chừng thì Server Action NÉM, `await` ở đây REJECT — và bản cũ
//     không bắt, nên màn đứng im với nút xoay mãi trong khi một nửa số ô ĐÃ vào DB. Mọi lời gọi
//     action phải nằm trong `try/catch`, và câu báo lỗi phải nói "kiểm tra lưới rồi chạy lại" —
//     chạy lại là an toàn (idempotent), im lặng mới nguy hiểm.
//  2. Server PARSE LẠI file ở bước áp ⇒ FormData của `applyImportAction` phải mang lại `file`
//     gốc, không chỉ mapping. Vì thế `file` được giữ trong state suốt cả ba bước.
//  3. Đổi file là mọi kết quả cũ hết giá trị ⇒ `setResult(null)` (và preview/ánh xạ) — nếu không,
//     bảng đối chiếu của file trước sẽ đứng cạnh file sau và trông như vừa áp xong.
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, ClipboardCheck, LayoutGrid, Loader2, RotateCcw, TriangleAlert, Upload } from "lucide-react";
import { toast } from "sonner";
import { ErrorState } from "@/components/admin/ui/states";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { SectionCard } from "@/components/admin/cham-cong/section-card";
import { BTN_OUTLINE, BTN_PRIMARY } from "@/components/admin/cham-cong/classes";
import { SheetFilePicker } from "@/components/cham-cong/ui/sheet-file-picker";
import { hrefWith } from "@/lib/cham-cong/scope-href";
import { cn } from "@/lib/utils";
import type { ApplyResult, ImportPreview } from "@/lib/cham-cong/import-core";
import { applyImportAction, previewImportAction } from "../_actions";
import { ImportLog, type ImportLogRow } from "./import-log";
import { MappingTable, type MappingCandidate } from "./mapping-table";
import { maLech, ResultDiffTable } from "./result-diff-table";
import { Stepper, type StepItem } from "./stepper";

type Preview = ImportPreview & { centers: string[] };

/** Lỗi ĐANG hiện tại chỗ. `where` để nút "Thử lại" gọi đúng bước, không phải reload cả trang. */
type Fault = { where: "preview" | "apply"; title: string; detail: string };

function loi(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function ImportWizard({
  candidates,
  recent,
  blockLabels,
  coSo,
  defaultKy,
  canDoiSoat,
}: {
  candidates: MappingCandidate[];
  recent: ImportLogRow[];
  /** Mã khối → nhãn đầy đủ, dựng ở RSC từ `loadModuleScope`. */
  blockLabels: Record<string, string>;
  /** `?coSo=` còn hợp lệ (hoặc null) — chỉ dùng để dựng href đi tiếp ở bước 3. */
  coSo: string | null;
  /** Kỳ hiện tại theo giờ VN, dùng khi lượt import chỉ áp khung ca (không chọn kỳ nào). */
  defaultKy: string;
  canDoiSoat: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [periods, setPeriods] = useState<string[]>([]);
  const [importKhungCa, setImportKhungCa] = useState(true);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [fault, setFault] = useState<Fault | null>(null);
  /** Bước NÀO đang chạy — chỉ để đặt vòng xoay đúng nút; `pending` mới là thứ khoá form. */
  const [running, setRunning] = useState<"preview" | "apply" | null>(null);
  const [pending, start] = useTransition();

  const unmapped = useMemo(
    () => (preview ? preview.people.filter((p) => !mapping[p.displayName]) : []),
    [preview, mapping],
  );

  function chonFile(f: File | null) {
    setFile(f);
    // Đổi file ⇒ mọi thứ dựng từ file cũ hết hiệu lực.
    setPreview(null);
    setMapping({});
    setPeriods([]);
    setResult(null);
    setFault(null);
  }

  function doPreview() {
    if (!file) {
      toast.error("Chọn file .xlsx trước");
      return;
    }
    const fd = new FormData();
    fd.set("file", file);
    setFault(null);
    setRunning("preview");
    start(async () => {
      try {
        const r = await previewImportAction(fd);
        if (!r.ok) {
          toast.error(r.error);
          setFault({ where: "preview", title: "Không đọc được file", detail: r.error });
          return;
        }
        setPreview(r.data);
        setResult(null);
        const m: Record<string, string> = {};
        for (const p of r.data.people) {
          const pick = p.rememberedUserId ?? (p.suggestions[0]?.score >= 90 ? p.suggestions[0].userId : "");
          if (pick) m[p.displayName] = pick;
        }
        setMapping(m);
        setPeriods(r.data.months.length ? [r.data.months[r.data.months.length >= 2 ? 1 : 0].periodKey] : []);
        if (r.data.warnings.length) toast.warning(`${r.data.warnings.length} cảnh báo khi đọc file`);
      } catch (e) {
        setFault({
          where: "preview",
          title: "Không đọc được file — máy chủ không trả lời",
          detail: loi(e),
        });
        toast.error("Máy chủ không trả lời khi đọc file. Thử lại.");
      } finally {
        setRunning(null);
      }
    });
  }

  function doApply() {
    if (!file || !preview) return;
    if (unmapped.length) {
      toast.error(
        `Còn ${unmapped.length} người chưa ánh xạ: ${unmapped.slice(0, 3).map((p) => p.displayName).join(", ")}${unmapped.length > 3 ? "…" : ""}`,
      );
      return;
    }
    if (!importKhungCa && periods.length === 0) {
      toast.error("Chọn ít nhất một kỳ hoặc khung ca");
      return;
    }
    const fd = new FormData();
    fd.set("file", file);
    fd.set("mapping", JSON.stringify(mapping));
    fd.set("periodKeys", JSON.stringify(periods));
    fd.set("importKhungCa", importKhungCa ? "1" : "0");
    setFault(null);
    setRunning("apply");
    start(async () => {
      try {
        const r = await applyImportAction(fd);
        if (!r.ok) {
          toast.error(r.error);
          setFault({ where: "apply", title: "Áp không hoàn tất", detail: r.error });
          return;
        }
        setResult(r.data);
        toast.success(
          `Đã áp: ${r.data.assignments.created} ô mới, ${r.data.assignments.unchanged} giữ nguyên, ${r.data.patterns.upserted} ô khung ca`,
        );
      } catch (e) {
        setFault({
          where: "apply",
          title: "Áp không hoàn tất — kiểm tra lưới rồi chạy lại file (idempotent)",
          detail: loi(e),
        });
        toast.error("Áp không hoàn tất — mất kết nối giữa chừng. Kiểm tra lưới rồi chạy lại file.");
      } finally {
        setRunning(null);
      }
    });
  }

  const step = result ? 3 : preview ? 2 : 1;
  const soLech = result ? result.counts.reduce((a, c) => a + maLech(c).length, 0) : 0;
  const kyDiTiep = periods[0] ?? defaultKy;
  const luoiHref = hrefWith("/cham-cong/phan-ca", { ky: kyDiTiep, coSo });
  const doiSoatHref = hrefWith("/cham-cong/doi-soat", { ky: kyDiTiep, coSo });

  const steps: StepItem[] = [
    {
      label: "1. Đọc file",
      hint: file?.name,
      state: step > 1 ? "done" : "current",
    },
    {
      label: "2. Ánh xạ & phạm vi",
      hint: preview ? `${preview.people.length} người · ${preview.months.length} tháng trong file` : undefined,
      state: step > 2 ? "done" : step === 2 ? "current" : "todo",
    },
    {
      label: "3. Kết quả",
      hint: result
        ? `${result.assignments.created} ô mới · ${result.assignments.cancelled} huỷ · ${soLech === 0 ? "khớp toàn bộ" : `${soLech} mã lệch`}`
        : undefined,
      state: step === 3 ? "done" : "todo",
    },
  ];

  return (
    <div className="space-y-4">
      <Stepper items={steps} />

      {fault && (
        <ErrorState
          title={fault.title}
          description={
            <>
              <p>
                {fault.where === "apply"
                  ? "Một phần ô có thể đã vào hệ thống. Mở lưới phân ca kiểm tra, rồi chạy lại đúng file này — import lặp là an toàn (0 ô mới, 0 ô huỷ)."
                  : "Chưa có gì được ghi vào hệ thống."}
              </p>
              <p className="mt-2 break-words text-xs">{fault.detail}</p>
            </>
          }
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => (fault.where === "apply" ? doApply() : doPreview())}
                className={BTN_PRIMARY}
              >
                Thử lại
              </button>
              {fault.where === "apply" && (
                <Link href={luoiHref} className={BTN_OUTLINE}>
                  Mở lưới phân ca
                </Link>
              )}
            </div>
          }
        />
      )}

      {/* ── Bước 1 ─────────────────────────────────────────────────────────── */}
      <SectionCard title="Bước 1 — Chọn file lịch phân ca">
        <fieldset disabled={pending} aria-busy={pending} className="min-w-0 space-y-3">
          <p className="text-sm text-muted-foreground">
            Trên Google Sheet: <b>Tệp → Tải xuống → Microsoft Excel (.xlsx)</b>. Hệ thống đọc tab KHUNG CA CỐ ĐỊNH và
            các tab LỊCH Tmm-yyyy.
          </p>
          <SheetFilePicker
            id="file-lich-phan-ca"
            file={file}
            onChange={chonFile}
            disabled={pending}
            label="Chọn file lịch phân ca (.xlsx)"
            hint="Tối đa 2MB — đúng file lịch phân ca, không phải file bảng công"
          />
          <button type="button" onClick={doPreview} disabled={!file || pending} className={BTN_PRIMARY}>
            {running === "preview" ? (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            ) : (
              <Upload aria-hidden className="h-4 w-4" />
            )}
            Đọc file
          </button>
        </fieldset>
      </SectionCard>

      <ImportLog rows={recent} />

      {/* ── Bước 2 ─────────────────────────────────────────────────────────── */}
      {preview && (
        <>
          {preview.warnings.length > 0 && (
            <SectionCard title={`Cảnh báo khi đọc file (${preview.warnings.length})`} tone="warning">
              <ul className="list-disc space-y-1 pl-5 text-sm text-state-warning-ink">
                {preview.warnings.slice(0, 30).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
              {preview.warnings.length > 30 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  …và {preview.warnings.length - 30} cảnh báo nữa — sửa trên Sheet rồi đọc lại file.
                </p>
              )}
            </SectionCard>
          )}

          <SectionCard title="Bước 2 — Ánh xạ tên trên Sheet ↔ nhân sự">
            <fieldset disabled={pending} aria-busy={pending} className="min-w-0 space-y-3">
              <p className="text-sm text-muted-foreground">
                Hệ thống chỉ gợi ý — bạn xác nhận một lần, lần sau tự nhớ. Bạn được phân ca ở:{" "}
                <b>{preview.centers.join(", ") || "—"}</b>.
              </p>
              {preview.unknownCodes.length > 0 && (
                <p className="text-sm font-medium text-state-danger-ink">
                  Mã ca lạ trong file: {preview.unknownCodes.join(", ")} — thêm ở{" "}
                  <Link href="/cham-cong/danh-muc-ca" className="underline">
                    Danh mục mã ca
                  </Link>{" "}
                  trước, không thì các ô đó bị bỏ qua.
                </p>
              )}
              <MappingTable
                people={preview.people}
                candidates={candidates}
                mapping={mapping}
                onPick={(name, userId) => setMapping((m) => ({ ...m, [name]: userId }))}
                allowedUnits={preview.centers}
                blockLabels={blockLabels}
                disabled={pending}
              />
              {unmapped.length > 0 && (
                <p role="status" className="text-sm font-medium text-state-warning-ink">
                  Còn {unmapped.length} người chưa ánh xạ:{" "}
                  {unmapped.slice(0, 5).map((p) => p.displayName).join(", ")}
                  {unmapped.length > 5 ? "…" : ""} — chọn xong mới áp được.
                </p>
              )}
            </fieldset>
          </SectionCard>

          <SectionCard title="Phần cần áp">
            <fieldset disabled={pending} aria-busy={pending} className="min-w-0 space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={importKhungCa}
                  onChange={(e) => setImportKhungCa(e.target.checked)}
                />
                Khung ca cố định hằng tuần ({preview.people.length} người)
              </label>

              {preview.months.length === 0 ? (
                // Đang ở TRONG SectionCard ⇒ không dùng `EmptyState` (nó tự mang vỏ thẻ, lồng vào
                // đây thành hai lớp viền trên cùng một nền).
                <p className="py-8 text-center text-sm text-muted-foreground">
                  File chỉ có tab KHUNG CA — không có tab LỊCH Tmm-yyyy nào, nên lượt này chỉ áp được
                  mẫu tuần. Muốn áp lưới tháng thì tải lại file Sheet có tab lịch tháng.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {preview.months.map((m) => {
                    const chon = periods.includes(m.periodKey);
                    return (
                      <label
                        key={m.periodKey}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors",
                          chon ? "border-primary bg-primary-soft text-primary-ink" : "border-border bg-card hover:bg-muted",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={chon}
                          onChange={(e) =>
                            setPeriods((ps) => (e.target.checked ? [...ps, m.periodKey] : ps.filter((x) => x !== m.periodKey)))
                          }
                        />
                        <span>
                          <b>{m.sheetName}</b>{" "}
                          <span className="tabular-nums">
                            · {m.rows} dòng · {Object.values(m.counts).reduce((a, b) => a + b, 0)} ô
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Ca do đơn đã duyệt hoặc sửa tay trên lưới được GIỮ, không bị file đè. Ô đổi mã = huỷ ca cũ + tạo ca mới
                (có vết). Hàng thuộc khối bạn không phân ca được sẽ bỏ qua và đếm riêng.
              </p>

              <button type="button" onClick={doApply} disabled={pending} className={BTN_PRIMARY}>
                {running === "apply" ? (
                  <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight aria-hidden className="h-4 w-4" />
                )}
                Áp vào hệ thống
              </button>
            </fieldset>
          </SectionCard>
        </>
      )}

      {/* ── Bước 3 ─────────────────────────────────────────────────────────── */}
      {result && (
        <SectionCard
          title="Bước 3 — Kết quả"
          tone={soLech === 0 ? "success" : "warning"}
          actions={
            soLech === 0 ? (
              <StatusPill tone="success" className="text-state-success-ink">
                Khớp toàn bộ với Sheet
              </StatusPill>
            ) : (
              <StatusPill tone="danger" className="text-state-danger-ink">
                {soLech} mã lệch
              </StatusPill>
            )
          }
        >
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
            <dt className="text-muted-foreground">Ô mới</dt>
            <dd className="font-semibold tabular-nums">{result.assignments.created}</dd>
            <dt className="text-muted-foreground">Giữ nguyên</dt>
            <dd className="font-semibold tabular-nums">{result.assignments.unchanged}</dd>
            <dt className="text-muted-foreground">Huỷ (đổi mã)</dt>
            <dd className="font-semibold tabular-nums">{result.assignments.cancelled}</dd>
            <dt className="text-muted-foreground">Giữ ca đơn/sửa tay</dt>
            <dd className="font-semibold tabular-nums">{result.assignments.keptManual}</dd>
            <dt className="text-muted-foreground">Bỏ qua — không quyền cơ sở</dt>
            <dd className="font-semibold tabular-nums">{result.assignments.skippedNoPermission}</dd>
            <dt className="text-muted-foreground">Bỏ qua — mã lạ</dt>
            <dd className="font-semibold tabular-nums">{result.assignments.unknownCode}</dd>
            <dt className="text-muted-foreground">Khung ca: ô ghi / ô xoá</dt>
            <dd className="font-semibold tabular-nums">
              {result.patterns.upserted} / {result.patterns.deleted}
            </dd>
          </dl>

          {result.counts.map((c) => {
            const lech = maLech(c);
            return (
              <div key={c.periodKey} className="mt-4">
                <h3 className="mb-2 text-sm font-semibold">
                  Đối chiếu kỳ {c.periodKey} —{" "}
                  {lech.length === 0 ? (
                    <span className="text-state-success-ink">khớp toàn bộ</span>
                  ) : (
                    <span className="text-state-danger-ink">{lech.length} mã lệch ({lech.join(", ")})</span>
                  )}
                </h3>
                <ResultDiffTable counts={c} />
              </div>
            );
          })}

          {result.warnings.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-state-warning-ink">
                <TriangleAlert aria-hidden className="h-4 w-4" />
                Cảnh báo khi áp ({result.warnings.length})
              </h3>
              <ul className="list-disc space-y-1 pl-5 text-xs text-state-warning-ink">
                {result.warnings.slice(0, 30).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <Link href={luoiHref} className={BTN_PRIMARY}>
              <LayoutGrid aria-hidden className="h-4 w-4" />
              Mở lưới phân ca
            </Link>
            {canDoiSoat && (
              <Link href={doiSoatHref} className={BTN_OUTLINE}>
                <ClipboardCheck aria-hidden className="h-4 w-4" />
                Đối soát với Sheet
              </Link>
            )}
            <button type="button" onClick={() => chonFile(null)} className={BTN_OUTLINE}>
              <RotateCcw aria-hidden className="h-4 w-4" />
              Import file khác
            </button>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
