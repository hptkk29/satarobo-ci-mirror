"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NGUON_LEAD } from "@/lib/lead/intake/nguon-lead";
import { createInternalLeadAction } from "@/lib/lead/intake/quick-form-action";

type CenterOption = { code: string; name: string };
type CourseOption = { id: string; name: string };

/** Một dòng con trên biểu mẫu. `key` chỉ để React nhận diện, không gửi lên server. */
type ConRow = { key: string; fullName: string; courseId: string };

let seqCon = 0;
const conMoi = (): ConRow => ({ key: `con-${++seqCon}`, fullName: "", courseId: "" });

type Entered = { id?: string; label: string; note: string };

/**
 * Bộ ô chốt 22/08/2026 — ĐÚNG 7 ô, **không ô nào bắt buộc**.
 *
 * Ô email / trường bé / lớp bé của bản trước đã bỏ (hỏi sau, điền ở màn chi tiết
 * lead). Thêm/bớt ô ở đây phải sửa kèm `lib/validators/internal-lead.ts` +
 * `lib/lead/intake/map-internal-form.ts` — ba chỗ đi thành một bộ.
 */
const EMPTY = {
  parentName: "",
  phone: "",
  source: "",
  facebookUrl: "",
  centerCode: "",
  note: "",
};

/**
 * Biểu mẫu nhập nhanh, **không có ô "Mã số NV"**: người nhập đã đăng nhập nên hệ
 * thống tự biết là ai.
 *
 * Thiết kế theo đúng việc thật: gõ xong một phiếu thì **ở lại trang**, ô trống,
 * con trỏ nhảy về ô đầu để gõ phiếu kế tiếp. Danh sách phiếu vừa nhập hiện ngay
 * bên cạnh để đối chiếu, kèm liên kết mở khách vừa tạo.
 *
 * `initial` — giá trị ĐIỀN SẴN cho lượt gõ ĐẦU TIÊN (chốt 9.13/9.5 đợt ZaloCRM:
 * từ khung chat bấm "Tạo khách" thì nhảy sang `/nhap-khach-hang?phone=…&name=…`).
 * Hai trang gọi đều lấy giá trị này từ `docPrefillTuQuery()`
 * (`lib/lead/intake/prefill.ts`) — đừng dựng tay, kẻo một trang lọc SĐT còn trang
 * kia thì không.
 */
export function QuickLeadForm({
  centers,
  courses,
  initial,
}: {
  centers: CenterOption[];
  courses: CourseOption[];
  initial?: Partial<typeof EMPTY>;
}) {
  // `initial` chỉ là GIÁ TRỊ KHỞI TẠO: `useState` đọc đối số đúng một lần, ở lượt dựng
  // đầu. Đó là điều mong muốn — người nhập sửa ô rồi mà prop đổi (điều hướng nội bộ sang
  // cùng trang với query khác) thì cũng không được giật chữ dưới tay họ.
  const [form, setForm] = useState({ ...EMPTY, ...initial });
  // 03/09 — NHIỀU CON, mỗi em một khoá quan tâm. Luôn có sẵn MỘT dòng: phiếu
  // nào cũng có ít nhất một bé, bắt bấm "Thêm con" cho ca thường gặp nhất là
  // thêm một cú bấm vào mọi phiếu.
  const [children, setChildren] = useState<ConRow[]>(() => [conMoi()]);
  const [entered, setEntered] = useState<Entered[]>([]);
  const [pending, startTransition] = useTransition();
  const firstRef = useRef<HTMLInputElement>(null);

  const set = (k: keyof typeof EMPTY) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Không ô nào bắt buộc — chỉ chặn đúng ca bấm Lưu trên biểu mẫu trắng (server
  // kiểm lại bằng `hasAnyContent`; đây chỉ để nút không im lặng nuốt cú bấm).
  const isBlank =
    Object.values(form).every((v) => v.trim() === "") &&
    children.every((c) => c.fullName.trim() === "");

  function submit() {
    startTransition(async () => {
      const res = await createInternalLeadAction({
        parentName: form.parentName || null,
        phone: form.phone || null,
        // Dòng trống vẫn gửi — mapper là chỗ DUY NHẤT lọc (bỏ dòng không tên +
        // khử trùng tên). Lọc thêm ở client là hai nơi cùng giữ một luật.
        children: children.map((c) => ({
          fullName: c.fullName || null,
          courseId: c.courseId || null,
        })),
        source: form.source || null,
        facebookUrl: form.facebookUrl || null,
        centerCode: form.centerCode || null,
        note: form.note || null,
      });

      if (!res.ok) {
        toast.error(res.error ?? "Không lưu được phiếu");
        return;
      }

      const label =
        form.parentName ||
        children.find((c) => c.fullName.trim())?.fullName ||
        form.phone ||
        form.facebookUrl ||
        "Khách mới";
      if (res.duplicate) {
        toast.warning(
          res.childAdded
            ? "Số này đã có trong hệ thống — đã thêm bé vào khách cũ."
            : "Số này đã có trong hệ thống — không tạo khách mới.",
        );
      } else {
        toast.success("Đã lưu khách hàng.");
      }
      for (const w of res.warnings ?? []) toast.warning(w);

      setEntered((prev) => [
        {
          id: res.leadId,
          label,
          note: res.duplicate
            ? res.childAdded
              ? "trùng số — đã thêm bé vào khách cũ"
              : "trùng số — không tạo mới"
            : "đã tạo",
        },
        ...prev,
      ]);
      // GIỮ NGUYÊN hành vi cũ: reset về `EMPTY`, **không** về `initial`.
      // Luồng của trang là "nhập tiếp" — lưu xong là gõ phiếu KHÁC. Giá trị điền
      // sẵn đến từ đúng một cuộc trò chuyện và đã dùng xong ở phiếu vừa lưu; đổ
      // lại nó vào ô trống là mời người nhập bấm Lưu lần hai cho cùng một số
      // (đường nhận lead sẽ báo trùng, nhưng đó là một cú bấm phí và một dòng
      // `LeadDuplicate` không có lý do tồn tại).
      setForm(EMPTY);
      setChildren([conMoi()]);
      firstRef.current?.focus();
    });
  }

  const inputClass =
    "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";
  const labelClass = "mb-1 block text-sm font-medium text-foreground";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
      <form
        className="rounded-xl border border-border bg-card p-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="parentName">
              Tên phụ huynh
            </label>
            <input
              id="parentName"
              ref={firstRef}
              className={inputClass}
              value={form.parentName}
              onChange={(e) => set("parentName")(e.target.value)}
              placeholder="Chị Nguyễn Thị An"
              autoComplete="off"
              autoFocus
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="phone">
              SĐT phụ huynh
            </label>
            <input
              id="phone"
              className={inputClass}
              value={form.phone}
              onChange={(e) => set("phone")(e.target.value)}
              placeholder="0905 123 456"
              inputMode="tel"
              autoComplete="off"
            />
          </div>

          {/* ── CON CỦA PHỤ HUYNH ────────────────────────────────────────────
              03/09/2026 — thay ô "Tên con" đơn lẻ. Phiếu thật hay có 2 em; trước
              đợt này em thứ hai phải gõ thành phiếu riêng rồi bị chính cơ chế
              chống trùng SĐT gộp lại, tức là mất.

              `sm:col-span-2` để khối này chiếm trọn hàng — hai ô con nằm cạnh
              nhau trong một nửa cột thì tên bé và tên khoá đều cụt. */}
          <div className="sm:col-span-2">
            <div className="mb-1 flex items-center justify-between">
              <span className={labelClass}>Con của phụ huynh</span>
              {children.length > 1 && (
                <span className="text-xs text-muted-foreground">{children.length} bé</span>
              )}
            </div>
            <div className="space-y-2">
              {children.map((c, i) => (
                <div key={c.key} className="flex items-start gap-2">
                  <input
                    className={inputClass}
                    value={c.fullName}
                    onChange={(e) =>
                      setChildren((rows) =>
                        rows.map((r) =>
                          r.key === c.key ? { ...r, fullName: e.target.value } : r,
                        ),
                      )
                    }
                    placeholder={i === 0 ? "Nguyễn Minh Khoa" : "Tên bé thứ " + (i + 1)}
                    autoComplete="off"
                    aria-label={`Tên bé thứ ${i + 1}`}
                  />
                  {/* Khoá quan tâm của RIÊNG em này — màn Chuyển đổi dùng đúng
                      trường này để lọc ô "Lớp đăng ký". Để trống thì ô đó rơi về
                      "hiện đủ mọi lớp". */}
                  <select
                    className={inputClass}
                    value={c.courseId}
                    onChange={(e) =>
                      setChildren((rows) =>
                        rows.map((r) =>
                          r.key === c.key ? { ...r, courseId: e.target.value } : r,
                        ),
                      )
                    }
                    aria-label={`Khoá quan tâm của bé thứ ${i + 1}`}
                  >
                    <option value="">— Khoá quan tâm —</option>
                    {courses.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name}
                      </option>
                    ))}
                  </select>
                  {/* Nút xoá chỉ hiện từ dòng thứ hai: xoá dòng cuối cùng là để
                      lại một khối trống không có ô nào để gõ. */}
                  {children.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setChildren((rows) => rows.filter((r) => r.key !== c.key))
                      }
                      aria-label={`Bỏ bé thứ ${i + 1}`}
                      className="shrink-0 rounded-lg border border-border px-2 py-2 text-sm text-muted-foreground hover:bg-muted"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setChildren((rows) => [...rows, conMoi()])}
              disabled={children.length >= 10}
              className="mt-2 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              + Thêm con
            </button>
          </div>

          <div>
            <label className={labelClass} htmlFor="source">
              Nguồn
            </label>
            <input
              id="source"
              className={inputClass}
              value={form.source}
              onChange={(e) => set("source")(e.target.value)}
              placeholder="Chọn gợi ý hoặc tự gõ…"
              autoComplete="off"
              list="nguon-goi-y"
            />
            {/* Ô này CỐ Ý gõ tự do (chốt 22/08) — người nhập phải viết được "chị
                Hoa lớp 3 giới thiệu". Gợi ý chỉ để gõ nhanh và để nhiều người
                cùng gọi một nguồn bằng một tên. Danh sách lấy từ `NGUON_LEAD`,
                đừng chép tay lần hai. */}
            <datalist id="nguon-goi-y">
              {NGUON_LEAD.map((s) => (
                <option key={s.id} value={s.label} />
              ))}
            </datalist>
          </div>

          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="facebookUrl">
              Link Facebook
            </label>
            <input
              id="facebookUrl"
              className={inputClass}
              value={form.facebookUrl}
              onChange={(e) => set("facebookUrl")(e.target.value)}
              placeholder="facebook.com/… hoặc m.me/…"
              inputMode="url"
              autoComplete="off"
            />
          </div>

          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="centerCode">
              Cơ sở phụ huynh chọn
            </label>
            <select
              id="centerCode"
              className={inputClass}
              value={form.centerCode}
              onChange={(e) => set("centerCode")(e.target.value)}
            >
              <option value="">— Để hệ thống tự chia —</option>
              {centers.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="note">
              Ghi chú
            </label>
            <textarea
              id="note"
              className={`${inputClass} min-h-20`}
              value={form.note}
              onChange={(e) => set("note")(e.target.value)}
              placeholder="Khách hỏi lớp thứ Bảy, quan tâm SATA 3…"
            />
          </div>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Không ô nào bắt buộc — điền được tới đâu lưu tới đó. Mã nhân viên hệ
          thống tự lấy từ tài khoản bạn đang đăng nhập.
        </p>

        <button
          type="submit"
          disabled={pending || isBlank}
          className="mt-3 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Đang lưu…" : "Lưu và nhập phiếu tiếp"}
        </button>
      </form>

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">
          Đã nhập trong phiên này{entered.length > 0 ? ` (${entered.length})` : ""}
        </h2>
        {entered.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Phiếu bạn vừa lưu sẽ hiện ở đây để đối chiếu.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {entered.map((e, i) => (
              <li
                key={`${e.id ?? "dup"}-${i}`}
                className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm"
              >
                <span className="truncate text-foreground">{e.label}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted-foreground">{e.note}</span>
                  {e.id && (
                    <Link
                      href={`/leads/${e.id}`}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Mở
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
