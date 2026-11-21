import Link from "next/link";
import { ArrowRight, Info, Sparkles } from "lucide-react";
import type { LichSuNguoi, LuotDisc, MocLichSu, TrangLuot } from "@/lib/disc/portal-doc";
import { LUU_Y_XU_HUONG, NHAN_NHOM, NHOM_DISC, RadarDisc, ThanhDiem } from "./bieu-do-disc";

/** dd/mm/yyyy theo giờ VN (server chạy UTC — tránh lệch một ngày). */
export function ngayVN(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

export const NHAN_VAI = { PHU_HUYNH: "Phụ huynh", HOC_SINH: "Học sinh" } as const;
const LY_DO_KHONG_SO_SANH: Record<NonNullable<MocLichSu["lyDoKhongSoSanh"]>, string> = {
  MOC_DAU: "Lần làm đầu tiên",
  KHAC_BO_DE: "Dùng bộ câu hỏi khác lần trước nên không so sánh trực tiếp",
  KHAC_PHIEN_BAN: "Bộ câu hỏi đã cập nhật phiên bản nên không so sánh trực tiếp với lần trước",
};

export function GhiChuXuHuong() {
  return (
    <p className="flex items-start gap-2 rounded-2xl border border-info/25 bg-info/5 p-4 text-sm text-muted-foreground" data-ghi-chu="xu-huong">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{LUU_Y_XU_HUONG}</span>
    </p>
  );
}

export function TrangRongDisc({ huongDanHref }: { huongDanHref: string }) {
  return (
    <section aria-labelledby="disc-rong-td" className="portal-v2 rounded-2xl border border-dashed border-border bg-card p-8 text-center" data-trang-thai="rong">
      <Sparkles aria-hidden className="mx-auto size-8 text-muted-foreground" />
      <h2 id="disc-rong-td" className="mt-3 text-base font-bold text-foreground">
        Gia đình chưa có kết quả DISC nào
      </h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Làm bài ngắn cùng con để hiểu hơn cách mỗi người trong gia đình tiếp nhận và phản ứng. Thông tin đã có sẵn trong tài khoản nên bạn bấm là làm luôn; kết quả sẽ hiện ở đây.
      </p>
      <Link
        href={huongDanHref}
        className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-[color:var(--accent-foreground)] hover:opacity-90"
      >
        Làm bài DISC
        <ArrowRight aria-hidden className="size-4" />
      </Link>
    </section>
  );
}

function MocMoiNhat({ n }: { n: LichSuNguoi }) {
  const m = n.moc[n.moc.length - 1]!;
  return (
    <article className="min-w-0 rounded-2xl border border-border bg-card p-4" data-nguoi={n.khoa} aria-label={`${NHAN_VAI[n.vaiTro]} ${n.hoTen}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{NHAN_VAI[n.vaiTro]}</p>
      <h3 className="break-words text-base font-bold text-foreground">{n.hoTen}</h3>
      <p className="text-xs text-muted-foreground">Lần gần nhất: {ngayVN(m.taoLuc)}</p>
      <div className="mt-3 grid items-center gap-4 sm:grid-cols-[minmax(0,180px)_1fr]">
        <RadarDisc diem={m.diem} ten={n.hoTen} />
        <ThanhDiem diem={m.diem} ten={n.hoTen} />
      </div>
      <p className="mt-3">
        <Link href={`/portal/disc/${m.luotId}`} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent underline-offset-2 hover:underline">
          Xem kết quả đầy đủ <ArrowRight aria-hidden className="size-4" />
        </Link>
      </p>
    </article>
  );
}

/** Tổng quan gia đình: kết quả gần nhất của từng thành viên. */
export function TongQuanGiaDinh({ lichSu }: { lichSu: LichSuNguoi[] }) {
  return (
    <section aria-labelledby="disc-tq-td" className="portal-v2 mt-6">
      <h2 id="disc-tq-td" className="text-base font-bold text-foreground">Gia đình bạn</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">Kết quả gần nhất của từng thành viên.</p>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {lichSu.map((n) => (
          <MocMoiNhat key={n.khoa} n={n} />
        ))}
      </div>
    </section>
  );
}

function Delta({ v }: { v: number }) {
  const r = Math.round(v);
  const chu = r > 0 ? `+${r}` : r < 0 ? `−${Math.abs(r)}` : "0";
  return (
    <span className="tabular-nums" aria-label={r > 0 ? `tăng ${r}` : r < 0 ? `giảm ${Math.abs(r)}` : "không đổi"}>
      {chu}
    </span>
  );
}

/** So sánh theo thời gian từng thành viên. Chỉ so hai mốc liền kề CÙNG bộ câu hỏi + phiên bản. */
export function LichSuDisc({ lichSu }: { lichSu: LichSuNguoi[] }) {
  return (
    <section aria-labelledby="disc-ls-td" className="portal-v2 mt-8">
      <h2 id="disc-ls-td" className="text-base font-bold text-foreground">Thay đổi theo thời gian</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Chỉ so sánh trực tiếp những lần làm cùng một bộ câu hỏi và cùng phiên bản. Điểm của các lần làm cũ được giữ nguyên, không tính lại.
      </p>
      <div className="mt-3 space-y-3">
        {lichSu.map((n) => (
          <div key={n.khoa} className="min-w-0 rounded-2xl border border-border bg-card p-4" data-lich-su={n.khoa}>
            <h3 className="break-words text-sm font-bold text-foreground">
              {n.hoTen} <span className="font-normal text-muted-foreground">· {NHAN_VAI[n.vaiTro]}</span>
            </h3>
            {n.moc.length < 2 ? (
              <p className="mt-1 text-sm text-muted-foreground">Mới có một lần làm. Làm lại sau vài tháng để thấy xu hướng thay đổi.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <caption className="sr-only">Điểm D-I-S-C của {n.hoTen} qua các lần làm</caption>
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th scope="col" className="py-1.5 pr-2 font-medium">Ngày</th>
                      {NHOM_DISC.map((k) => (
                        <th key={k} scope="col" className="px-2 py-1.5 text-right font-medium" title={NHAN_NHOM[k]}>{k}</th>
                      ))}
                      <th scope="col" className="py-1.5 pl-2 font-medium">So với lần trước</th>
                    </tr>
                  </thead>
                  <tbody>
                    {n.moc.map((m) => (
                      <tr key={m.luotId} className="border-b border-border/60 last:border-0 align-top">
                        <td className="py-1.5 pr-2 whitespace-nowrap">
                          <Link href={`/portal/disc/${m.luotId}`} className="font-medium text-accent hover:underline">{ngayVN(m.taoLuc)}</Link>
                        </td>
                        {NHOM_DISC.map((k) => (
                          <td key={k} className="px-2 py-1.5 text-right tabular-nums">{Math.round(m.diem[k])}</td>
                        ))}
                        <td className="py-1.5 pl-2 text-xs text-muted-foreground">
                          {m.chenhLech ? (
                            <span data-so-sanh="co">
                              {NHOM_DISC.map((k) => (
                                <span key={k} className="mr-2 whitespace-nowrap">
                                  {k} <Delta v={m.chenhLech![k]} />
                                </span>
                              ))}
                            </span>
                          ) : (
                            <span data-so-sanh="khong">{LY_DO_KHONG_SO_SANH[m.lyDoKhongSoSanh ?? "MOC_DAU"]}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function TenNguoi({ l }: { l: LuotDisc }) {
  return <>{l.nguoi.map((n) => n.hoTen).join(" · ") || "Không có tên"}</>;
}

/** Danh sách lượt (mới nhất trước) + phân trang. */
export function DanhSachLuotDisc({ trang }: { trang: TrangLuot }) {
  return (
    <section aria-labelledby="disc-ds-td" className="portal-v2 mt-8">
      <h2 id="disc-ds-td" className="text-base font-bold text-foreground">Các lần làm bài</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{trang.tong} lần làm, mới nhất trước.</p>
      <ul className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {trang.luot.map((l) => (
          <li key={l.id}>
            <Link href={`/portal/disc/${l.id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">{ngayVN(l.taoLuc)}</span>
                <span className="block truncate text-xs text-muted-foreground"><TenNguoi l={l} /></span>
              </span>
              <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
      {trang.tongTrang > 1 && (
        <nav aria-label="Phân trang các lần làm bài" className="mt-3 flex items-center justify-between gap-3 text-sm">
          {trang.trang > 1 ? (
            <Link href={`/portal/disc?trang=${trang.trang - 1}`} className="inline-flex min-h-11 items-center rounded-xl border border-border px-3 font-medium hover:bg-muted/50" rel="prev">Trang trước</Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground" aria-current="page">Trang {trang.trang} / {trang.tongTrang}</span>
          {trang.trang < trang.tongTrang ? (
            <Link href={`/portal/disc?trang=${trang.trang + 1}`} className="inline-flex min-h-11 items-center rounded-xl border border-border px-3 font-medium hover:bg-muted/50" rel="next">Trang sau</Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </section>
  );
}
