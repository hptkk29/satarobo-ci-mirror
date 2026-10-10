"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ExcelImporter, type ImportResult } from "@/components/admin/ExcelImporter";
import { parseLeadImportRow, normalizePhone, LEAD_IMPORT_COLUMNS } from "@/lib/lead/import";
import { leadStatusLabel } from "@/lib/leads/status";
import { formatPhoneVN } from "@/lib/phone";

interface LeadImportRow {
  [key: string]: string | number | null | undefined;
}

/**
 * ⚠️ `duocDe` đến từ SERVER (`page.tsx` hỏi `leads:overwrite`), không tự đoán ở client.
 *
 * Nó chỉ quyết định BÀY RA hay không. Cổng thật nằm ở `POST /api/admin/import/leads`:
 * ẩn một cột ở giao diện không chặn được ai gọi thẳng endpoint kèm `ghiDe: [0,1]`.
 */
export function ManNhapLead({ duocDe }: { duocDe: boolean }) {
  const router = useRouter();

  return (
    // Khung nở theo BẬC, không nở tự do: màn 8K mà để nội dung kéo ngang 7000px thì mắt phải
    // quét cả mét để nối cột đầu với cột cuối.
    //
    // Trần cuối 2000px KHÔNG phải số đẹp bịa ra: đo 15/09, bảng 10 cột + hai cột ghim rộng
    // 1930px, nên từ bậc này trở lên người dùng thấy TRỌN bảng mà không phải kéo ngang lần
    // nào. Nở thêm nữa chỉ là khoảng trắng.
    //
    // ⚠️ Cả ba bậc đều dùng `min-[...]`, KHÔNG trộn với `2xl:`. Đo bản trước: `2xl:max-w-
    // [1440px]` và `min-[2200px]:max-w-[1760px]` cùng độ ưu tiên, và `2xl` đứng SAU trong
    // tệp CSS sinh ra ⇒ trên màn 3840 lẫn 7680 khung vẫn kẹt ở đúng 1440px. Lỗi này im lặng
    // tuyệt đối: không cảnh báo, không lệch layout, chỉ là màn 8K dùng như màn 2K.
    <div className="mx-auto w-full max-w-[1180px] space-y-6 px-4 py-6 sm:px-6 min-[1536px]:max-w-[1440px] min-[2200px]:max-w-[2000px]">
      <div className="space-y-2">
        <Link
          href="/leads"
          className="inline-flex min-h-9 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Danh sách lead
        </Link>
        <h1 className="text-xl font-bold sm:text-2xl">Nhập lead từ Excel</h1>
        <p className="max-w-[70ch] text-sm text-muted-foreground">
          Nhập nhiều lead cùng lúc. Số điện thoại là căn cứ duy nhất để biết một dòng có trùng
          hay không — mọi cách ghi (<code>0987654321</code>, <code>84987654321</code>,{" "}
          <code>+84 987 654 321</code>, hay thiếu số 0 đầu) đều được quy về cùng một số. File
          chia làm ba nhóm trước khi ghi; bạn xem và sửa ngay tại đây, không cần mở lại Excel.
        </p>
        <p className="text-sm">
          Có file <b>danh sách khách ĐÃ ĐĂNG KÝ</b> của Sale (nhiều sheet theo tháng)?{" "}
          <Link href="/leads/import/registered" className="text-state-info-ink hover:underline">
            Nhập danh sách đã đăng ký →
          </Link>
        </p>
      </div>

      <ExcelImporter<LeadImportRow>
        title="Nhập lead"
        /* Mẫu SINH ĐỘNG: dropdown khoá đúng tên khoá đang có, SĐT kiểu text,
           tuổi con kiểu số — xem app/api/admin/templates/leads/route.ts. */
        templateUrl="/api/admin/templates/leads"
        templateFilename="mau-lead.xlsx"
        duplicateLabel="SĐT"
        duplicateKey={(raw) => normalizePhone(raw["SĐT"]) || null}
        mergeDuplicates={{ label: "Sẽ bổ sung vào lead đang có" }}
        /* Tuỳ chọn GHI ĐÈ cho riêng nhóm trùng — chốt 16/09/2026, siết quyền 17/09/2026.
           CHỈ bày cho người có `leads:overwrite` (Quản lý cơ sở / Quản trị hệ thống).
           Chủ dự án: "khi sale nhập = excel cũng vậy luôn nhé, không có chức năng ghi đè
           dành cho sale". Không có quyền ⇒ prop vắng mặt ⇒ cột Đè KHÔNG tồn tại, và dòng
           trùng đi theo luật mặc định: chỉ điền ô trống + nối ghi chú.
           Mặc định TẮT kể cả khi có quyền — vẫn phải tự tick. */
        {...(duocDe
          ? {
              overwriteDuplicates: {
                label: "Đè",
                moTa:
                  "Tick cột Đè để dòng đó GHI ĐÈ thông tin đang lưu bằng dữ liệu trong file " +
                  "(tên phụ huynh, email, tên con, tuổi con, cơ sở, khoá, nguồn). Giá trị cũ được " +
                  "ghi vào ghi chú kèm ngày nên vẫn lấy lại được. Ô nào file bỏ trống thì KHÔNG bị " +
                  "xoá; ghi chú của Sale và trạng thái phễu không bao giờ bị đè.",
                chuKhiBat:
                  "SẼ GHI ĐÈ thông tin đang lưu bằng dữ liệu dòng này — giá trị cũ được ghi vào " +
                  "ghi chú kèm ngày. Ô nào file bỏ trống thì giữ nguyên.",
              },
            }
          : {})}
        checkExisting={async (raws, excelNos) => {
          // Đối chiếu SĐT với lead ĐÃ CÓ trong CRM — nói rõ dòng này sẽ ghi đè lên ai, để
          // Sale nhận ra ngay nếu đó thật sự là người khác cùng số.
          const res = await fetch("/api/admin/import/leads/precheck", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phones: raws.map((r) => String(r["SĐT"] ?? "")) }),
          });
          if (!res.ok) return new Map();
          const { matches } = (await res.json()) as {
            matches: { phone: string; parentName: string; childName: string | null; status: string }[];
          };
          const byPhone = new Map(matches.map((m) => [m.phone, m]));
          const map = new Map<number, string>();
          raws.forEach((r, i) => {
            const m = byPhone.get(normalizePhone(r["SĐT"]));
            if (m) {
              map.set(
                excelNos[i],
                `SĐT ${formatPhoneVN(m.phone)} đã có trong CRM — PH "${m.parentName}"` +
                  `, con: ${m.childName?.trim() || "(chưa ghi tên con)"}` +
                  `, trạng thái: ${leadStatusLabel(m.status)}.` +
                  ` Mặc định dòng này chỉ ĐIỀN những ô lead đó đang để trống; ô đã có giá trị` +
                  ` thì giữ nguyên, thông tin khác trong file được ghi vào ghi chú.` +
                  ` Tick cột Đè nếu muốn dữ liệu trong file thay thế thông tin đang lưu.` +
                  ` Lead chưa chốt sẽ được chia lại cho tư vấn viên mới.` +
                  ` Nếu đúng là người khác → sửa SĐT hoặc xoá dòng.`,
              );
            }
          });
          return map;
        }}
        columnHints={LEAD_IMPORT_COLUMNS.map((c) => ({
          key: c,
          label: c,
          required: c === "Tên phụ huynh" || c === "SĐT",
          // Cột SĐT bày ra dạng `0987654321` dù file ghi `84987654321`, `+84 987 654 321`
          // hay `987654321` (Excel lưu kiểu number nên mất số 0 đầu). Cả ba đều được hệ
          // thống coi là CÙNG một số; bày nguyên văn thì người nhập không đối chiếu được
          // với danh bạ của họ. Giá trị gốc vẫn còn ở tooltip.
          ...(c === "SĐT" ? { hienThi: formatPhoneVN } : {}),
        }))}
        parseRow={(row) => {
          const res = parseLeadImportRow(row as Record<string, unknown>);
          if (!res.ok) return { error: res.error };
          // Giữ nguyên ô gốc để server resolve cơ sở/khoá + đối chiếu trùng.
          return row as LeadImportRow;
        }}
        onImport={async (rows, ctx) => {
          // Đổi số dòng Excel (thứ màn hình tick) thành CHỈ SỐ trong `rows` (thứ server đọc).
          // Server cố ý không nhận SĐT — xem khối "DÒNG ĐƯỢC TICK GHI ĐÈ" trong route.
          const ghiDe = ctx
            ? rows
                .map((_, i) => (ctx.ghiDe.has(ctx.excelRowOf[i] ?? -1) ? i : -1))
                .filter((i) => i >= 0)
            : [];
          const res = await fetch("/api/admin/import/leads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows, ghiDe }),
          });
          if (!res.ok) {
            // ⚠️ Route trả lỗi theo HAI hình dạng khác nhau, và bản trước chỉ đọc một:
            //   · cổng đầu vào (401/403/400) → `{ error: "..." }`
            //   · hỏng lúc GHI (500)        → `{ success: 0, errors: [{ row, error }] }`
            //
            // Đo 16/09/2026 trên prod: người dùng nhận đúng câu "Nhập thất bại: Nhập thất
            // bại". Server ĐÃ nói rõ hỏng ở đâu — lý do nằm nguyên trong `errors[0].error`
            // — nhưng màn hình đọc `err.error`, thấy `undefined`, rồi rơi về chuỗi mặc
            // định. Tức là một lỗi có chẩn đoán sẵn bị biến thành một lỗi không tra được,
            // ngay tại chỗ cuối cùng trước mắt người dùng.
            const than = (await res.json().catch(() => null)) as
              | { error?: string; errors?: { row: number; error: string }[] }
              | null;
            const tuMang = (than?.errors ?? [])
              .map((e) => (e.row > 0 ? `dòng ${e.row}: ${e.error}` : e.error))
              .filter(Boolean)
              .join(" · ");
            throw new Error(
              than?.error || tuMang || `Máy chủ trả lỗi ${res.status} và không nói lý do`,
            );
          }
          const result = (await res.json()) as ImportResult;
          setTimeout(() => router.refresh(), 1000);
          return result;
        }}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <section className="rounded-xl border border-border bg-muted/40 p-4">
          <h2 className="text-sm font-semibold">Cột trong file (cố định)</h2>
          <ol className="mt-2 list-inside list-decimal space-y-0.5 text-sm text-muted-foreground">
            {LEAD_IMPORT_COLUMNS.map((c) => (
              <li key={c} className="break-words">
                {c}
              </li>
            ))}
          </ol>
        </section>

        <section className="rounded-xl border border-border bg-muted/40 p-4">
          <h2 className="text-sm font-semibold">Những điều dễ nhầm</h2>
          <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
            <li>
              <b className="text-foreground">SĐT</b> bắt buộc và phải hợp lệ (09xx / +84). Để ô
              kiểu <b>text</b> trong Excel, nếu không số 0 đầu bị nuốt mất.
            </li>
            <li>
              {/* Đây là phần đổi nghĩa 15/09/2026 — viết dài hơn các mục khác có chủ đích, vì
                  nó là thứ duy nhất trên màn này GHI ĐÈ dữ liệu người dùng đã nhập tay. */}
              <b className="text-foreground">Trùng SĐT</b> không còn bị bỏ qua, và{" "}
              <b className="text-foreground">mặc định cũng không ghi đè</b> dữ liệu đang có:
              hệ thống chỉ{" "}
              <b className="text-foreground">điền vào những ô lead đang để trống</b>, còn con
              mới thì thêm vào cùng lead (không tạo lead trùng số).
              <ul className="mt-1 list-inside list-disc space-y-0.5 pl-1">
                <li>
                  Ô <b className="text-foreground">đã có giá trị</b> mà file ghi khác thì{" "}
                  <b className="text-foreground">giữ nguyên giá trị đang có</b> — giá trị
                  trong file được ghi lại vào ghi chú kèm ngày, để bạn tự đối chiếu.
                </li>
                <li>
                  Muốn ngược lại thì tick <b className="text-foreground">cột Đè</b> ở nhóm
                  Trùng — dòng đó sẽ lấy dữ liệu trong file thay cho thông tin đang lưu, và{" "}
                  <b className="text-foreground">giá trị cũ được ghi vào ghi chú</b> kèm ngày
                  nên vẫn lấy lại được. Ô tick ở hàng tiêu đề bật cho cả nhóm.
                </li>
                <li>
                  Ô nào <b className="text-foreground">file bỏ trống</b> thì không bao giờ bị
                  xoá, kể cả khi đã tick Đè — bỏ trống trong Excel không phải lệnh xoá.
                </li>
                <li>
                  <b className="text-foreground">Ghi chú</b> của Sale không bị mất — ghi chú
                  trong file được nối thêm xuống dưới.
                </li>
                <li>
                  <b className="text-foreground">Trạng thái phễu</b> giữ nguyên, lead đang ở L3
                  không bị kéo về &quot;Mới&quot;.
                </li>
                <li>
                  Lead <b className="text-foreground">chưa chốt</b> sẽ được chia lại cho tư vấn
                  viên mới. Lead <b className="text-foreground">đã chốt / đã ghi danh</b> giữ
                  nguyên người phụ trách.
                </li>
              </ul>
            </li>
            <li>
              <b className="text-foreground">Cơ sở</b>: quản lý cơ sở để trống → lead về cơ sở
              của mình. Điền mã (vd CS1) khi nhập hộ cơ sở khác — cần quyền HO/Super Admin.
            </li>
            <li>
              <b className="text-foreground">Khoá quan tâm</b> chọn trong danh sách của file
              mẫu. <b className="text-foreground">Tuổi con</b> là số nguyên 3–18 hoặc để trống.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
