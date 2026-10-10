"use client";

// Lưới album ảnh theo lớp — có tìm kiếm và bộ lọc.
//
// Vì sao (QA site GV vòng 1, BUG-037): trang này đổ thẳng 50 thẻ, không ô tìm, không
// bộ lọc, không phân trang; 25/50 thẻ là "0 ảnh" (lớp chưa khai giảng và lớp đã huỷ).
// Ảnh bìa lại là dải gradient sinh theo chỉ số nên 50 thẻ trông giống hệt nhau — không
// có gì để nhận ra lớp mình cần.
//
// Cùng quy ước với lưới Hoàn thành khoá (BUG-022) và danh sách lớp: mặc định giấu thứ
// không còn là việc, có ô tìm, bộ lọc nằm trên URL.
import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Images } from "lucide-react";

import { cn } from "@/lib/utils";
import { ListToolbar, type SelectFilter } from "../../_components/ui/list-toolbar";
import { useLocTrenUrl } from "../../_components/ui/use-loc-tren-url";
import { khopBatKy } from "@/lib/ui/tim-kiem";

export interface ClassAlbumCard {
  id: string;
  name: string;
  total: number;
  pending: number;
  draft: number;
  latestLabel: string | null;
  /** Ảnh mới nhất của lớp, đã ký sẵn ở server; null khi lớp chưa có ảnh nào. */
  coverUrl: string | null;
}

const ALL = "ALL";
const CO_ANH = "CO_ANH";
const CHO_DUYET = "CHO_DUYET";

/** Dải gradient dự phòng cho lớp chưa có ảnh nào — giữ nguyên bảng màu cũ. */
const COVERS = [
  "from-orange-400 to-amber-300",
  "from-violet-400 to-fuchsia-300",
  "from-sky-400 to-cyan-300",
  "from-emerald-400 to-teal-300",
  "from-rose-400 to-pink-300",
];

export function ClassAlbumGrid({
  rows,
  banDauLoc,
}: {
  rows: ClassAlbumCard[];
  /** Bộ lọc đọc từ `searchParams` Ở SERVER — thiếu nó là deep-link không chạy. */
  banDauLoc?: { q?: string; loc?: string };
}) {
  const loc = useLocTrenUrl({ q: "", loc: CO_ANH }, banDauLoc);
  // Ảnh bìa TẢI HỎNG thì lùi về dải gradient, đừng để lại ô trắng.
  //
  // URL đã ký của R2 có hạn dùng, và trên môi trường chưa cấu hình R2 (hoặc dữ liệu
  // seed) thì đường dẫn không tới đâu cả. Không có đường lùi thì thẻ ra một ô trắng —
  // tệ hơn hẳn dải gradient mà vé này định thay. Đo được ngay lần đầu chạy thử 03/09.
  const [hong, setHong] = useState<Record<string, true>>({});
  const query = loc.gia_tri.q;
  const bo = loc.gia_tri.loc;

  const options = useMemo<SelectFilter["options"]>(
    () => [
      { value: CO_ANH, label: "Lớp có ảnh" },
      { value: CHO_DUYET, label: "Còn ảnh chờ duyệt" },
      { value: ALL, label: "Tất cả lớp" },
    ],
    [],
  );

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (bo === CO_ANH && r.total === 0) return false;
      if (bo === CHO_DUYET && r.pending === 0) return false;
      return khopBatKy([r.name], query);
    });
  }, [rows, query, bo]);

  const an = rows.length - filtered.length;

  return (
    <>
      <ListToolbar
        query={query}
        onQuery={(v) => loc.dat("q", v)}
        placeholder="Tìm theo tên lớp..."
        filters={[{ value: bo, onChange: (v) => loc.dat("loc", v), options }]}
        actions={
          loc.dang_loc ? (
            <button
              type="button"
              onClick={loc.xoa_het}
              className="rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              Xoá bộ lọc
            </button>
          ) : undefined
        }
      />

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <p className="text-sm font-medium text-foreground">
            Không có lớp khớp bộ lọc
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {bo === CO_ANH && an > 0
              ? `${an} lớp chưa có ảnh nào đang được ẩn — chọn "Tất cả lớp" để xem.`
              : "Thử đổi từ khoá tìm kiếm hoặc bộ lọc."}
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">
              {filtered.length}
            </span>{" "}
            lớp
            {an > 0 ? ` · ${an} lớp không hiện theo bộ lọc` : ""}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((c, i) => (
              // href CHỈ-query (giữ path hiện tại): chạy đúng cả trên host giaovien
              // (clean URL /anh-lop) LẪN localhost/preview (/teacher/anh-lop).
              <Link key={c.id} href={`?classId=${c.id}`} className="block">
                <div className="t-card t-card-hover h-full overflow-hidden">
                  {/* Ảnh bìa THẬT khi lớp có ảnh — 50 dải gradient giống nhau thì không
                      nhận ra lớp nào là lớp nào. `<img>` chứ không `next/image`: URL đã
                      ký của R2 có hạn dùng, đưa qua bộ tối ưu ảnh là hỏng đường dẫn. */}
                  {c.coverUrl && !hong[c.id] ? (
                    <img
                      src={c.coverUrl}
                      alt=""
                      loading="lazy"
                      onError={() => setHong((m) => ({ ...m, [c.id]: true }))}
                      className="h-28 w-full bg-muted object-cover"
                    />
                  ) : (
                    <div
                      className={cn(
                        "h-28 bg-gradient-to-br",
                        COVERS[i % COVERS.length],
                      )}
                    />
                  )}
                  <div className="p-4">
                    <div className="flex items-center justify-between">
                      <h2 className="font-semibold text-foreground">{c.name}</h2>
                      <ChevronRight
                        className="h-4 w-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <Images className="h-4 w-4" aria-hidden />
                        {c.total} ảnh
                      </span>
                      {c.pending > 0 && (
                        <span className="rounded-full bg-state-warning-soft px-2 py-0.5 text-xs font-semibold text-state-warning-ink">
                          {c.pending} chờ duyệt
                        </span>
                      )}
                    </div>
                    {c.latestLabel && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Mới nhất: {c.latestLabel}
                      </p>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
