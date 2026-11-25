// components/admin/cham-cong/parttime-chua-bat.tsx — khối "CHƯA BẬT · CHỈ XEM" của hai màn Parttime ("Phân công buổi",
// "Công parttime tháng").
//
// Vì sao có (nghiệm thu 20/10/2026): bản cũ là một dải chữ vàng, và lời duy nhất về bước kế tiếp là "Quản trị bật ở Cấu hình vận
// hành" — người đọc không biết đó có phải việc của mình không, bấm đi đâu. Khối này trả lời ba câu, theo QUYỀN người đang xem:
//   1. Chưa bật ở cơ sở nào, nên màn đang làm được gì (chỉ xem).
//   2. Bước tiếp theo là của AI.
//   3. Người có quyền bật thì có NÚT tới đúng tab cấu hình; người không có quyền thì KHÔNG thấy nút (luật 12 — không dẫn người ta
//      tới một cửa đóng). Bốn công tắc Parttime không khai `qlcsSuaDuoc` ⇒ chỉ Quản trị tối cao (`settings:edit`) bật được.
import Link from "next/link";
import { Eye, Settings2, ShieldAlert } from "lucide-react";
import { BTN_PRIMARY } from "./classes";

/** Đích của nút — tab Chấm công của Cấu hình vận hành (id tab: `lib/settings/nhan-van-hanh.ts`). Literal cho `nav-coverage`. */
export const CAU_HINH_CHAM_CONG = { href: "/cau-hinh-van-hanh?tab=cham-cong" } as const;

export function ParttimeChuaBat({
  tinhNang,
  coSo,
  chan,
  tenCongTac,
  suaDuoc,
  conXem,
  children,
}: {
  /** "Phân công theo buổi" / "Đối soát Parttime (chạy bóng)". */
  tinhNang: string;
  /** Nhãn khối đang xem, ví dụ "CS2 · Hoàng Diệu". */
  coSo: string;
  /** Công tắc ĐÃ bật nhưng bị chặn (RBAC v2) — câu giải thích; null = đơn giản là chưa bật. */
  chan: string | null;
  /** Tên công tắc đúng như màn Cấu hình vận hành in (`nhanCuaKey(...).ten`). */
  tenCongTac: string;
  /** Người đang xem bật được công tắc này không (`settings:edit`). BẮT BUỘC — không có mặc định "được". */
  suaDuoc: boolean;
  /** Màn này lúc chưa bật vẫn cho làm gì. */
  conXem: React.ReactNode;
  /** Phần thêm (ví dụ "xem trước nếu bật"). */
  children?: React.ReactNode;
}) {
  return (
    <section
      aria-label={`${tinhNang} chưa bật`}
      className="mb-4 rounded-xl border border-state-warning-ink/30 bg-state-warning-soft p-4 text-sm text-state-warning-ink"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-card" aria-hidden>
          {chan ? <ShieldAlert className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            {chan ? `${tinhNang} đang bị chặn ở ${coSo}` : `${tinhNang} chưa bật ở ${coSo}`}
            <span className="rounded-full border border-state-warning-ink/30 bg-card px-2 py-0.5 text-xs font-semibold">Chỉ xem</span>
          </h2>
          <p>{conXem}</p>
          {children}
          <div className="rounded-lg bg-card/70 px-3 py-2.5 text-foreground">
            <p className="font-semibold">Bước tiếp theo</p>
            {chan ? (
              <p className="mt-0.5">{chan}</p>
            ) : suaDuoc ? (
              <>
                <p className="mt-0.5">
                  Bật “{tenCongTac}” cho {coSo} ở <b>Cấu hình vận hành → Chấm công</b>, khối cài riêng theo cơ sở — chỉ khi Ban giám
                  đốc đã chốt cơ sở thí điểm.
                </p>
                <Link href={CAU_HINH_CHAM_CONG.href} className={`${BTN_PRIMARY} mt-2 h-10 pointer-coarse:h-11`}>
                  <Settings2 className="h-4 w-4" aria-hidden />
                  Mở cấu hình Chấm công
                </Link>
              </>
            ) : (
              <p className="mt-0.5">
                Bạn không cần làm gì thêm ở màn này. Công tắc do <b>Quản trị tối cao</b> bật theo từng cơ sở sau khi Ban giám đốc chốt
                thí điểm — liên hệ quản trị hệ thống nếu cơ sở của bạn cần dùng.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
