"use client";

// app/(admin)/admin/tra-cuu/_components/tra-cuu-workspace.tsx
//
// ═══ THIẾT KẾ LẠI 22/09/2026 — "MỘT Ô TÌM, MỘT BẢNG" ════════════════════════════
//
// LUẬN ĐỀ. Màn này được dùng trong đúng MỘT cảnh: đang ngồi (hoặc đang nghe điện)
// với phụ huynh, họ hỏi một câu, phải trả lời trong vài giây. Nên trang có một ô
// tìm ở trên cùng và một bảng ở dưới. Cái nó từ chối là bản cũ: ba thẻ xếp chồng,
// mỗi thẻ một bảng — muốn xem lớp thì phải cuộn qua hết bảng giá khoá và bảng học
// cụ, và muốn tra một cái tên thì phải đưa mắt dò từng dòng vì không có ô tìm nào.
//
// VÌ SAO TÌM Ở CLIENT. Ba danh mục này nhỏ (khoá ~chục, học cụ ~chục, lớp đang mở
// ~vài chục) và đã nằm sẵn trong trang. Gõ ra kết quả NGAY, không vòng máy chủ —
// đúng cái mà một câu hỏi qua điện thoại cần. Danh mục lớn lên tới mức này chậm
// thì mới chuyển sang lọc ở truy vấn; lúc đó đổi đúng chỗ này.
//
// VÌ SAO CHIP MANG SỐ KẾT QUẢ. Gõ "sata 3" mà đang đứng ở tab Học cụ sẽ ra rỗng —
// bản không đếm chéo sẽ để người dùng kết luận "hệ thống không có". Chip hiện
// "Khoá học 2 · Lớp 1" nên chỗ cần bấm nằm ngay trước mắt.
//
// Component cố ý "ngu": chỉ nhận CHUỖI ĐÃ ĐỊNH DẠNG từ server (tiền, ngày, nhãn
// trạng thái). Định dạng ở đây là mở đường cho ba khối hiển thị lệch nhau.
import { useMemo, useState, useId } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { boDau } from "@/lib/ui/bo-dau";
import { cn } from "@/lib/utils";

export type CotTraCuu = {
  ten: string;
  /** Căn phải (tiền, số lượng). */
  phai?: boolean;
  /** Cột nuốt phần rộng còn lại — đặt cho cột mô tả dài nhất. */
  rong?: boolean;
  /**
   * Ẩn dưới 640px.
   *
   * Màn 375px chứa được khoảng hai cột. Bản đầu để nguyên mọi cột và dựa vào cuộn
   * ngang, nên trên điện thoại **cột Giá nằm ngoài màn hình** — đúng con số mà
   * người ta mở trang để đọc khi đang nghe điện thoại với phụ huynh. Đánh dấu cột
   * phụ ở đây để cột quan trọng nhất luôn ở trong tầm mắt; phần còn lại vẫn cuộn
   * tới được.
   */
  anMobile?: boolean;
  /**
   * Cắt chữ ở 13rem (khối Khuyến mãi 26/09): cột mô tả phụ dài (phạm vi "Toàn hệ thống · Sata 3 —
   * Cảm biến…") `nowrap` đẩy cột Hiệu lực + Trạng thái ra ngoài màn 1280px.
   */
  cat?: boolean;
};

/**
 * Ô: chuỗi thường · nhãn trạng thái có màu ngữ nghĩa · hoặc ô HAI DÒNG: dòng chính (tự xuống tối
 * đa 2 dòng) + dòng phụ — `phuMo` = dòng phụ chữ mờ (vd "còn 36 ngày"), không thì chữ đậm (mã).
 * `nhanMobile`: nhãn trạng thái hiện TRONG ô này dưới 640px — dùng khi cột Trạng thái ẩn trên điện
 * thoại (rà thiết kế 26/09: để cột trạng thái riêng ở 375px là nó bị đẩy ra ngoài card).
 */
export type OTraCuu =
  | string
  | { t: string; pill: PillTone }
  | { t: string; phu?: string | null; phuMo?: boolean; nhanMobile?: { t: string; pill: PillTone } };

export type DongTraCuu = {
  key: string;
  o: OTraCuu[];
  /** Chuỗi để tìm — server ghép sẵn, ĐÃ bỏ dấu và hạ chữ thường. */
  tim: string;
  /** Làm nhạt cả dòng (vd lớp đã hết chỗ) — vẫn hiện, chỉ lùi về sau mắt. */
  mo?: boolean;
  /**
   * Cả HÀNG bấm được, mở trang chi tiết (luật 12: `<tr relative cursor-pointer>` + link ở ô đầu
   * phủ `after:inset-0`). Không khai thì hàng chỉ để đọc như trước.
   */
  href?: string;
};

export type KhoiTraCuu = {
  ma: string;
  nhan: string;
  /** Danh từ đếm được cho thanh phân trang: "khoá", "mặt hàng", "lớp". */
  donVi: string;
  cot: CotTraCuu[];
  dong: DongTraCuu[];
  /** Câu nói rõ giới hạn của khối (vd học cụ không có tồn kho). */
  luuY?: string;
  /** Câu hiện khi khối RỖNG từ đầu — khác hẳn "tìm không ra". */
  khiRong: string;
};

const CHIP =
  "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-xl border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const CHIP_ACTIVE = "border-primary bg-primary-soft text-primary-ink";
const CHIP_IDLE = "border-border bg-card text-muted-foreground hover:bg-muted";

export function TraCuuWorkspace({ khoi }: { khoi: KhoiTraCuu[] }) {
  // Mở ở danh mục ĐẦU TIÊN CÓ DỮ LIỆU, không phải danh mục đầu danh sách: đổ người
  // dùng vào một bảng rỗng trong khi hai bảng bên cạnh có hàng là bắt họ bấm thử
  // từng chip mới biết trang không hỏng.
  const [ma, setMa] = useState((khoi.find((k) => k.dong.length > 0) ?? khoi[0])?.ma ?? "");
  const [q, setQ] = useState("");
  const idTim = useId();

  const tuKhoa = boDau(q);
  // Lọc CẢ BA khối mỗi lần gõ, không chỉ khối đang mở — số trên chip phải thật,
  // nếu không nó chỉ là trang trí và người dùng vẫn phải bấm thử từng tab.
  const ketQua = useMemo(() => {
    const m = new Map<string, DongTraCuu[]>();
    for (const k of khoi) {
      m.set(k.ma, tuKhoa ? k.dong.filter((d) => d.tim.includes(tuKhoa)) : k.dong);
    }
    return m;
  }, [khoi, tuKhoa]);

  const dangMo = khoi.find((k) => k.ma === ma) ?? khoi[0];
  if (!dangMo) return null;
  const dong = ketQua.get(dangMo.ma) ?? [];
  const khoiKhacCoKetQua = khoi.filter(
    (k) => k.ma !== dangMo.ma && (ketQua.get(k.ma)?.length ?? 0) > 0,
  );

  return (
    <div className="space-y-4">
      {/* ── Thanh công cụ: ô tìm trước, chip sau ─────────────────────────────
          Ô tìm đứng trên chip vì nó là thứ dùng mọi lần; chip chỉ dùng khi kết
          quả nằm ở danh mục khác. Trên mobile ô tìm chiếm cả hàng. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            id={idTim}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm tên, mã, cơ sở…"
            aria-label="Tìm trong danh mục"
            className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-soft"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Xoá từ khoá tìm"
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>

        {khoi.length > 1 && (
          <div role="tablist" aria-label="Danh mục" className="flex flex-wrap gap-2">
            {khoi.map((k) => {
              const n = ketQua.get(k.ma)?.length ?? 0;
              const chon = k.ma === dangMo.ma;
              return (
                <button
                  key={k.ma}
                  type="button"
                  role="tab"
                  aria-selected={chon}
                  onClick={() => setMa(k.ma)}
                  className={cn(CHIP, chon ? CHIP_ACTIVE : CHIP_IDLE)}
                >
                  {k.nhan}
                  <span
                    className={cn(
                      "tabular-nums",
                      // Khi đang tìm, số 0 ở tab khác là thông tin thật ("không có
                      // ở đây") nên vẫn in ra, chỉ mờ đi.
                      n === 0 && "opacity-60",
                    )}
                  >
                    {n}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Bảng ────────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {dangMo.luuY && (
          <p className="border-b border-border bg-muted/40 px-5 py-2.5 text-xs text-muted-foreground">
            {dangMo.luuY}
          </p>
        )}

        {dong.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-semibold text-foreground">
              {tuKhoa ? `Không có ${dangMo.donVi} nào khớp “${q}”` : dangMo.khiRong}
            </p>
            {tuKhoa && (
              <div className="mt-2 space-y-2 text-sm text-muted-foreground">
                {khoiKhacCoKetQua.length > 0 ? (
                  <p>
                    Có kết quả ở{" "}
                    {khoiKhacCoKetQua.map((k, i) => (
                      <span key={k.ma}>
                        {i > 0 && " · "}
                        <button
                          type="button"
                          onClick={() => setMa(k.ma)}
                          className="font-medium text-primary-ink hover:underline"
                        >
                          {k.nhan} ({ketQua.get(k.ma)?.length})
                        </button>
                      </span>
                    ))}
                    .
                  </p>
                ) : (
                  <p>Không danh mục nào khớp từ khoá này.</p>
                )}
                <button
                  type="button"
                  onClick={() => setQ("")}
                  className="font-medium text-primary-ink hover:underline"
                >
                  Xoá từ khoá
                </button>
              </div>
            )}
          </div>
        ) : (
          <PhanTrangBang
            tenDonVi={dangMo.donVi}
            khoaGhiNho={`tra-cuu-${dangMo.ma}`}
            cuonNgang
            className="[&>div:last-child]:px-5 [&>div:last-child]:pb-4"
          >
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {dangMo.cot.map((c) => (
                    <th
                      key={c.ten}
                      scope="col"
                      className={cn(
                        adminTh,
                        c.phai && "text-right",
                        c.rong && "w-full",
                        c.anMobile && "hidden sm:table-cell",
                      )}
                    >
                      {c.ten}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dong.map((d) => (
                  <tr key={d.key} className={cn(adminTr, d.mo && "opacity-60", d.href && "relative cursor-pointer")}>
                    {d.o.map((o, i) => {
                      const haiDong = typeof o !== "string" && !("pill" in o);
                      const noiDung =
                        typeof o === "string" ? (
                          o
                        ) : "pill" in o ? (
                          <StatusPill tone={o.pill}>{o.t}</StatusPill>
                        ) : (
                          <>
                            {o.nhanMobile && (
                              <span className="mb-1 block sm:hidden">
                                <StatusPill tone={o.nhanMobile.pill}>{o.nhanMobile.t}</StatusPill>
                              </span>
                            )}
                            {/* Chỉ ô ĐẦU được xuống dòng (câu ưu đãi); ô sau (vd khoảng ngày) giữ một dòng —
                                "01/09 →" / "31/12/2026" bẻ đôi một khoảng ngày là đọc sai. */}
                            <span className={i === 0 ? "line-clamp-2 whitespace-normal" : "block whitespace-nowrap"}>{o.t}</span>
                            {o.phu && (
                              <span
                                className={cn(
                                  "mt-0.5 block truncate text-xs",
                                  o.phuMo ? "font-normal text-muted-foreground" : "font-semibold tracking-wide",
                                )}
                              >
                                {o.phu}
                              </span>
                            )}
                          </>
                        );
                      return (
                        <td
                          key={dangMo.cot[i]?.ten ?? i}
                          className={cn(
                            adminTd,
                            dangMo.cot[i]?.phai && "text-right tabular-nums",
                            dangMo.cot[i]?.anMobile && "hidden sm:table-cell",
                            dangMo.cot[i]?.cat && "max-w-[13rem] truncate",
                            i === 0 &&
                              (haiDong
                                ? "min-w-[9rem] font-medium sm:min-w-[16rem]"
                                : "max-w-[148px] truncate font-medium sm:max-w-[320px]"),
                          )}
                        >
                          {i === 0 && d.href ? (
                            <Link
                              href={d.href}
                              className="block after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none focus-visible:underline"
                            >
                              {noiDung}
                            </Link>
                          ) : (
                            noiDung
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        )}
      </div>
    </div>
  );
}
