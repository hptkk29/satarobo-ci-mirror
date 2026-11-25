"use client";

// THANH PHẠM VI duy nhất của khu Hoá đơn điện tử: cơ sở + tháng + pháp nhân đang thao tác (S5b, audit 05 §4.2).
// Thay ba bản chọn cơ sở chép tay (bàn chứng từ, Cấu hình, Chứng từ ngân hàng).
//
// ⚠️ Thanh này là MẶT TRƯỚC của quyết định ở server, không phải nơi quyết:
//   · cơ sở đang làm việc suy bằng CHÍNH `chonCoSoLamViec` mà trang dùng: một cơ sở ⇒ tự chọn; nhiều cơ sở mà chưa chọn
//     (hoặc cơ sở trên URL ngoài phạm vi) ⇒ CHƯA CHỌN và trang không nạp gì. `cacCoSo` do layout lấy qua `napCoSoLocHoaDon`
//     (đã lọc theo phạm vi kế toán) — thanh không bao giờ bày cơ sở ngoài phạm vi.
//   · đổi cơ sở / tháng = `router.push` (có mục lịch sử, Back quay lại phạm vi trước); đổi dòng chọn / sắp xếp là
//     `router.replace` ở bàn chứng từ. Đổi phạm vi BỎ dòng chọn.
//   · gợi ý "cơ sở lần trước" (localStorage, khoá theo userId) CHỈ hiện thành nút bấm — không bao giờ tự áp, vì hành vi
//     hiện hữu (và an toàn) là luôn bắt chọn cơ sở khi có nhiều (O-5 chưa chốt).
//   · pháp nhân đọc từ dữ liệu layout truyền vào (cấu hình ký hiệu hiệu lực hôm nay); thiếu ⇒ nói thiếu, không bịa.

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { cacThangChon, chonCoSoLamViec } from "@/lib/finance/hoa-don/loc-hang-cho";
import { coOThang, hrefDoiPhamVi, hrefKhuVuc, phamViTuQuery } from "./dieu-huong-hoa-don";
import { docGoiYCoSo, ghiGoiYCoSo, khoTrinhDuyet } from "./pham-vi-hoa-don";
import type { PhapNhanHienThi } from "./phap-nhan-hien-thi";

export type CoSoChon = { id: string; ma: string; ten: string };

const NHAN = "text-xs font-medium text-muted-foreground";
// Vòng focus 2px (không chỉ đổi màu viền — audit 05 R2); cao 44px trên màn cảm ứng.
const O_CHON =
  "h-9 rounded-lg border border-border bg-card py-0 pl-2.5 pr-8 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11";

const nhanCoSo = (c: CoSoChon) => `${c.ma} · ${c.ten}`;

/** Gợi ý đọc bằng `useSyncExternalStore`: SSR luôn `null` (không lệch hydrate), client đọc kho thật. */
function useGoiYCoSo(userId: string, cacCoSo: readonly CoSoChon[]): string | null {
  return useSyncExternalStore(
    (bao) => {
      window.addEventListener("storage", bao);
      return () => window.removeEventListener("storage", bao);
    },
    () => docGoiYCoSo(khoTrinhDuyet(), userId, cacCoSo),
    () => null,
  );
}

export function HoaDonScopeBar({
  userId,
  cacCoSo,
  phapNhan,
  thangHienTai,
}: {
  userId: string;
  cacCoSo: readonly CoSoChon[];
  /** Pháp nhân phát hành hôm nay của từng cơ sở (layout tính bằng `tomTatPhapNhanTheoCoSo`). */
  phapNhan: Readonly<Record<string, PhapNhanHienThi>>;
  /** "YYYY-MM" giờ VN — tháng mặc định (không ghi lên URL). */
  thangHienTai: string;
}) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const router = useRouter();
  const [dangDoi, batDau] = useTransition();

  const pv = phamViTuQuery(sp);
  const ngan = sp.get("ngan");
  const coSoId = chonCoSoLamViec(pv.coSo, cacCoSo);
  const coSo = cacCoSo.find((c) => c.id === coSoId) ?? null;
  const goiYId = useGoiYCoSo(userId, cacCoSo);
  const goiY = coSo ? null : (cacCoSo.find((c) => c.id === goiYId) ?? null);

  // Đã vào một cơ sở (bằng link, gợi ý, hay tự chọn) ⇒ nhớ nó cho lần sau. Chỉ là tiện lợi.
  useEffect(() => {
    if (coSoId) ghiGoiYCoSo(khoTrinhDuyet(), userId, coSoId);
  }, [coSoId, userId]);

  const di = (href: string) => batDau(() => router.push(href));
  const doiCoSo = (id: string) => {
    if (!id) return; // dòng "Chọn cơ sở…" — không có gì để đi
    ghiGoiYCoSo(khoTrinhDuyet(), userId, id);
    di(hrefDoiPhamVi(pathname, pv, ngan, { coSo: id }));
  };
  const doiThang = (t: string) => di(hrefDoiPhamVi(pathname, pv, ngan, { thang: t === thangHienTai ? null : t }));

  const thangDangXem = pv.thang ?? thangHienTai;
  const coOChonThang = coSo !== null && coOThang(pathname, ngan);
  const pn = coSo ? phapNhan[coSo.id] : undefined;

  return (
    <section
      aria-label="Phạm vi làm việc"
      aria-busy={dangDoi}
      className="mb-4 rounded-xl border border-border bg-card px-4 py-3 data-[dang-doi=true]:opacity-70"
      data-dang-doi={dangDoi}
    >
      <div className="flex flex-col gap-3 @3xl/hd:flex-row @3xl/hd:items-center @3xl/hd:justify-between">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          {cacCoSo.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bạn chưa được giao cơ sở nào để làm hoá đơn.</p>
          ) : cacCoSo.length === 1 ? (
            <div className="flex flex-col gap-1">
              <span className={NHAN}>Cơ sở</span>
              <span className="text-sm font-medium text-foreground">{nhanCoSo(cacCoSo[0]!)}</span>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <label htmlFor="hd-co-so" className={NHAN}>
                Cơ sở
              </label>
              <select
                id="hd-co-so"
                value={coSo?.id ?? ""}
                onChange={(e) => doiCoSo(e.target.value)}
                className={O_CHON}
              >
                {coSo ? null : (
                  <option value="" disabled>
                    Chọn cơ sở…
                  </option>
                )}
                {cacCoSo.map((c) => (
                  <option key={c.id} value={c.id}>
                    {nhanCoSo(c)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {coOChonThang ? (
            <div className="flex flex-col gap-1">
              <label htmlFor="hd-thang" className={NHAN}>
                Tháng
              </label>
              <select id="hd-thang" value={thangDangXem} onChange={(e) => doiThang(e.target.value)} className={O_CHON}>
                {cacThangChon(thangHienTai, thangDangXem).map((t) => (
                  <option key={t.gia} value={t.gia}>
                    {t.nhan}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        <div className="min-w-0 text-sm">
          {coSo === null ? (
            cacCoSo.length > 1 ? (
              <p className="flex items-start gap-2 text-state-warning-ink">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>Chưa chọn cơ sở — danh sách chưa được nạp. Chọn một cơ sở để xem hoá đơn và pháp nhân phát hành.</span>
              </p>
            ) : null
          ) : pn?.loai === "CO" ? (
            <p className="min-w-0 break-words">
              <span className="text-muted-foreground">Pháp nhân phát hành: </span>
              <span className="font-medium text-foreground">{pn.ten}</span>
              <span className="tabular-nums text-muted-foreground">
                {" "}
                · MST {pn.maSoThue} · Ký hiệu {pn.kyHieu}
              </span>
            </p>
          ) : pn?.loai === "THIEU" ? (
            <p className="flex items-start gap-2 text-state-warning-ink">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                <span>{pn.lyDo}</span>{" "}
                <Link href={hrefKhuVuc("cau-hinh", pv)} className="font-medium underline underline-offset-2">
                  Khai ở Cấu hình
                </Link>
              </span>
            </p>
          ) : null}
        </div>
      </div>

      {goiY ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          Lần trước bạn làm ở {nhanCoSo(goiY)}.
          <button
            type="button"
            onClick={() => doiCoSo(goiY.id)}
            className="inline-flex h-8 items-center rounded-lg border border-border bg-card px-3 font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11"
          >
            Dùng lại {nhanCoSo(goiY)}
          </button>
        </p>
      ) : null}
    </section>
  );
}
