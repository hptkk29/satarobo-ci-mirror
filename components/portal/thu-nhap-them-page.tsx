import Link from "next/link";
import { ChevronLeft, Search } from "lucide-react";
import { NHAN_TRANG_THAI_LEAD_PH, type ThuNhapThem } from "@/lib/nguon/thu-nhap-them";
import type { LeadStatus } from "@prisma/client";

// «Thu nhập thêm» — khách PH mang về cho trung tâm (board M-Thu-nhap). Ẩn sau cờ. Chỉ SĐT dạng che; tìm/lọc là form GET (không JS, chạy tốt trên điện thoại).
export function ThuNhapThemPage({ d, q, tt }: { d: ThuNhapThem; q: string; tt: LeadStatus | null }) {
  const the = [
    { nhan: "Khách mang về", so: String(d.tongLead) },
    { nhan: "Đã chốt", so: String(d.daChot) },
    { nhan: "Tỉ lệ chốt", so: d.tyLeChot === null ? "—" : `${d.tyLeChot}%` },
  ];
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4">
      <Link href="/portal/qua-tang" className="inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-[var(--sr-purple-text)] hover:underline">
        <ChevronLeft className="size-4" aria-hidden="true" />
        Quà tặng
      </Link>
      <header className="flex flex-col gap-1.5">
        <h1 className="font-display text-[28px] font-extrabold leading-[34px]">Thu nhập thêm</h1>
        <p className="text-sm leading-[22px] text-[var(--sr-ink-muted)]">
          Khách ba mẹ giới thiệu qua đường link của mình. Chốt được thì ba mẹ nhận hoa hồng theo chính sách của trung tâm.
        </p>
      </header>

      <section aria-label="Tổng hợp" className="grid grid-cols-3 gap-2.5">
        {the.map((t) => (
          <div key={t.nhan} className="flex flex-col gap-1 rounded-2xl border border-border bg-card px-3 py-3.5 text-center">
            <b className="font-display text-[26px] font-extrabold leading-8">{t.so}</b>
            <span className="text-xs text-[var(--sr-ink-muted)]">{t.nhan}</span>
          </div>
        ))}
      </section>

      <form method="get" className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-3.5">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Tìm khách
          <span className="flex items-center gap-2 rounded-xl border border-[#d9c9e4] bg-white px-3">
            <Search className="size-4 flex-none text-[var(--sr-ink-muted)]" aria-hidden="true" />
            <input
              name="q"
              defaultValue={q}
              inputMode="search"
              placeholder="Tên ba mẹ, tên con hoặc số điện thoại đầy đủ"
              className="h-12 w-full bg-transparent text-base outline-none"
            />
          </span>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Trạng thái
          <select name="tt" defaultValue={tt ?? ""} className="h-12 rounded-xl border border-[#d9c9e4] bg-white px-3 text-base">
            <option value="">Tất cả</option>
            {(Object.keys(NHAN_TRANG_THAI_LEAD_PH) as LeadStatus[]).map((k) => (
              <option key={k} value={k}>
                {NHAN_TRANG_THAI_LEAD_PH[k]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-12 rounded-[14px] bg-[var(--sr-purple)] text-[15px] font-bold text-white">
          Tìm
        </button>
      </form>

      {d.khach.length === 0 ? (
        <div className="rounded-[18px] border-2 border-dashed border-border px-5 py-8 text-center text-sm text-[var(--sr-ink-muted)]">
          {d.tongLead === 0 ? "Ba mẹ chưa có khách nào được ghi nhận qua link giới thiệu." : "Không có khách nào khớp tìm kiếm."}
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {d.khach.map((k) => (
            <li key={k.khoa} className="flex flex-col gap-1.5 rounded-2xl border border-border bg-card px-4 py-3.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <b className="text-[15px]">{k.tenPhuHuynh}</b>
                <span className="rounded-full bg-[var(--sr-tint-purple)] px-2.5 py-1 text-xs font-bold text-[var(--sr-purple-text)]">{k.nhanTrangThai}</span>
              </div>
              <span className="text-[13px] text-[var(--sr-ink-muted)]">
                {k.tenCon ? `Con: ${k.tenCon} · ` : ""}
                {k.soDienThoaiChe}
              </span>
              <span className="text-xs text-[var(--sr-ink-muted)]">Hệ thống nhận ngày {k.ngayNhan}</span>
            </li>
          ))}
        </ul>
      )}
      {d.biCat ? <p className="text-xs text-[var(--sr-ink-muted)]">Chỉ hiện {d.khach.length > 0 ? "các khách mới nhất" : "một phần"} (tối đa 300).</p> : null}
    </div>
  );
}
