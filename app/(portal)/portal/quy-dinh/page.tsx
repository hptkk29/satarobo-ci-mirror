import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { docDongYQuyDinh } from "@/lib/legal/quy-dinh-dao-tao";
import {
  QUY_DINH_MA_VAN_BAN,
  QUY_DINH_MUC,
  QUY_DINH_TIEU_DE,
} from "@/lib/legal/quy-dinh-dao-tao-content";
import { SATA_ROBO_PHONE } from "@/lib/locations";
import { vnParts } from "@/lib/time/vn";

/** «12/11/2026 lúc 10:32» theo giờ VN (lib/time/vn.ts — không dùng múi giờ máy chủ). */
function nhanGio(d: Date): string {
  const p = vnParts(d);
  const hai = (n: number) => String(n).padStart(2, "0");
  return `${hai(p.day)}/${hai(p.month + 1)}/${p.year} lúc ${hai(p.hour)}:${hai(p.minute)}`;
}

export const metadata = { title: "Quy định đào tạo | Sata Robo" };
export const dynamic = "force-dynamic";

// Trang ĐỌC LẠI Quy định đào tạo (board M-Quy-dinh): dải xanh «Ba mẹ đã đồng ý» + toàn văn. Chỉ-xem —
// KHÔNG có nút rút lại đồng ý (chủ dự án: «không được bỏ đồng ý»). Phụ huynh có con đã đăng ký mà chưa
// đồng ý thì `portal/layout.tsx` đã thay cả cổng bằng màn đồng ý nên không bao giờ tới đây; tài khoản
// miễn phí (chưa đăng ký khoá) vẫn đọc được, không có dải xác nhận.
export default async function QuyDinhPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { daDongY, luc } = await docDongYQuyDinh(session.user.id);

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4">
      <Link
        href="/portal/ho-so"
        className="inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-[var(--sr-purple-text)] hover:underline"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Hồ sơ
      </Link>
      <header className="flex flex-col gap-1.5">
        <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--sr-orange-text)]">{QUY_DINH_MA_VAN_BAN}</span>
        <h1 className="font-display text-[25px] font-extrabold leading-[31px]">{QUY_DINH_TIEU_DE}</h1>
      </header>

      {daDongY ? (
        <section role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-[18px] bg-[#e3f4ee] p-4 text-[#0f3d38]">
          <span aria-hidden="true" className="flex size-10 flex-none items-center justify-center rounded-full bg-[#0f5c55] text-xl font-extrabold text-white">
            ✓
          </span>
          <div className="flex min-w-[220px] flex-1 flex-col gap-0.5">
            <b className="text-base">Ba mẹ đã đồng ý quy định này</b>
            <span className="text-sm">
              {luc ? nhanGio(luc) : ""} · {session.user.name ?? "tài khoản phụ huynh"}
            </span>
          </div>
          <span className="text-[13px] leading-[19px]">
            Đồng ý được lưu vĩnh viễn và không rút lại trên cổng. Thắc mắc về quy định, ba mẹ gọi {SATA_ROBO_PHONE.hien}.
          </span>
        </section>
      ) : null}

      <article className="flex flex-col gap-[18px] rounded-[20px] border border-border bg-card p-4 min-[560px]:p-6">
        {QUY_DINH_MUC.map((m) => (
          <section key={m.ten} className="flex flex-col gap-2">
            <h2 className="text-[17px] font-bold">{m.ten}</h2>
            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[15px] leading-6">
              {m.dong.map((d) => (
                <li key={d} className="flex gap-2">
                  <span aria-hidden="true" className="mt-[9px] size-1.5 flex-none rounded-full bg-[var(--sr-orange)]" />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </article>
    </div>
  );
}
