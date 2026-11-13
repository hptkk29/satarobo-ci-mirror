// app/(teacher)/teacher/phan-cong/thang/page.tsx — "CÔNG THÁNG CỦA TÔI" (SR.QD.238 · P5d).
//
// Đọc `docBaoCaoCuaToi({ userId: session.user.id, … })` — CÙNG lớp đọc với màn QLCS (luật 12b): giáo viên và quản lý thấy cùng
// một con số. Không giấu khoản trừ nào: khoản đề xuất và khoản đã xác nhận đều hiện, kèm mã luật và lý do.
// Không phải phiếu lương — chưa có "thực lĩnh".
import Link from "next/link";
import { auth } from "@/lib/auth";
import { vnYmd } from "@/lib/time/vn";
import { NHAN_CHI_SO, laChiSo, soCua, type ChiSo, type DongTongHop } from "@/lib/parttime/bao-cao-thang";
import { docBaoCaoCuaToi } from "@/lib/parttime/bao-cao-thang-db";
import { nhanBangChung } from "@/lib/parttime/nhan-bang-chung";
import { ClipboardList } from "lucide-react";
import { hienMucCongViecCuaToi } from "@/lib/parttime/menu-parttime-db";
import { PageHeader } from "../../_components/ui/page-header";
import { TheDieuHuong } from "../../_components/ui/the-dieu-huong";
import { NhanTruc } from "./_components/nhan-truc";
import { docNhatKySuaCuaToi } from "@/lib/parttime/sua-buoi-da-qua-db";
import { NHAN_TRUONG } from "@/lib/parttime/sua-buoi-da-qua";

export const dynamic = "force-dynamic";

const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const gio = (d: Date | null) => (d ? d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" }) : "—");
const tien = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("vi-VN")}đ`;
const soGio = (phut: number) => (phut / 60).toLocaleString("vi-VN", { maximumFractionDigits: 1 });
function thangLech(thang: string, n: number) {
  const [y, m] = thang.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
const NHAN_NX: Record<string, string> = { ON_TIME: "đúng hạn", LATE: "nộp trễ", MISSING: "thiếu", PENDING: "chưa tới hạn", KHONG_YEU_CAU: "không cần", CHUA_DIEM_DANH: "chưa điểm danh" };
const NHAN_TT: Record<string, string> = { PROPOSED: "đề xuất — chờ quản lý", CONFIRMED: "đã xác nhận", REJECTED: "không áp", CANCELLED: "đã huỷ" };

/** Các ô hiển thị: (chỉ số, nhãn ngắn). Mỗi ô là liên kết tới đúng danh sách dòng của chỉ số đó. */
const O: ChiSo[] = ["mainThuong", "mainDayThay", "mainHocBu", "mainHocVuot", "troGiang", "trucDu", "trucNua", "diMuon", "veSom", "thieuNhanXet", "choXacNhan", "deXuat", "daXacNhanTru"];

export default async function CongThangCuaToi({ searchParams }: { searchParams: Promise<{ thang?: string; chiSo?: string }> }) {
  const session = await auth();
  if (!session?.user) return null; // layout đã gate
  const sp = await searchParams;
  const now = new Date();
  const thang = sp.thang && /^\d{4}-\d{2}$/.test(sp.thang) ? sp.thang : vnYmd(now).slice(0, 7);
  // userId từ PHIÊN — không bao giờ từ tham số.
  const [bc, mo, nhatKy] = await Promise.all([
    docBaoCaoCuaToi({ userId: session.user.id, thang, now }),
    // Cùng hàm quyết mục menu: cơ sở liên quan của người này chưa mở Parttime ⇒ nói ra, đừng để một trang trống tự giải thích.
    hienMucCongViecCuaToi(session.user.id, vnYmd(now)),
    // Quản lý sửa buổi đã qua có liên quan tới mình (là người cũ hoặc người mới) — đối soát ngay tại đây (chủ dự án 20/10/2026).
    docNhatKySuaCuaToi({ userId: session.user.id, tu: `${thang}-01`, den: `${thang}-31` }),
  ]);
  const r: DongTongHop | null = bc.tongHop[0] ?? null;
  const chiSo = laChiSo(sp.chiSo) ? sp.chiSo : null;
  const trucCho = bc.truc.filter((t) => t.status === "WAITING_ACCEPTANCE" && t.danhGia.khung && now.getTime() < new Date(`${t.ngay}T${t.danhGia.khung.den}:00+07:00`).getTime());
  const href = (q: { thang?: string; chiSo?: string | null }) => {
    const p = new URLSearchParams();
    const t = q.thang ?? thang;
    if (t) p.set("thang", t);
    if (q.chiSo) p.set("chiSo", q.chiSo);
    return `?${p.toString()}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Công tháng của tôi"
        subtitle="Tiết dạy và ca trực quản lý cơ sở đã xác nhận, bằng chứng chấm công, nhận xét và mọi khoản trừ. Đây chưa phải phiếu lương — và khác “Bảng công” (công ngày theo ca)."
      />

      {!mo && (
        <p className="rounded-lg border border-state-info-ink/20 bg-state-info-soft px-4 py-3 text-sm text-state-info-ink">
          <b>Công Parttime chưa mở ở cơ sở của bạn.</b> Công hằng ngày của bạn vẫn xem ở{" "}
          <Link href="/teacher/bang-cong" className="font-semibold underline underline-offset-2">
            Bảng công
          </Link>
          . Khi trung tâm mở, số tháng theo SR.QD.238 sẽ hiện ở đây.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Chọn tháng" className="inline-flex items-center gap-2">
          <Link href={href({ thang: thangLech(thang, -1) })} className="inline-flex min-h-11 items-center rounded-lg border border-border bg-card px-3 text-sm">← Tháng trước</Link>
          <span className="px-2 text-sm font-semibold tabular-nums">{thang.slice(5, 7)}/{thang.slice(0, 4)}</span>
          <Link href={href({ thang: thangLech(thang, 1) })} className="inline-flex min-h-11 items-center rounded-lg border border-border bg-card px-3 text-sm">Tháng sau →</Link>
        </nav>
        {/* Lối quay về — thẻ bấm được, cùng kiểu với lối sang trang này (trước 20/10/2026 là chữ nhỏ "← Công việc của tôi"). */}
        <TheDieuHuong href="/teacher/phan-cong" icon={ClipboardList} title="Công việc của tôi" description="Buổi được phân · chờ bạn xác nhận" quayLai className="w-full sm:w-auto" />
      </div>

      {nhatKy.length > 0 && (
        <section aria-labelledby="dieu-chinh-qua" className="t-card space-y-3 p-4">
          <h2 id="dieu-chinh-qua" className="text-base font-semibold">Quản lý đã điều chỉnh buổi của bạn · {nhatKy.length}</h2>
          <p className="text-sm text-muted-foreground">Buổi đã qua được sửa người dạy / trợ giảng. Thấy chưa đúng thì gửi khiếu nại công ở Bảng công.</p>
          <ul className="space-y-2">
            {nhatKy.map((x) => (
              <li key={x.id} className="rounded-lg border border-border p-3 text-sm">
                <p>
                  <b className="tabular-nums">{dm(x.ngay)}</b> · {x.buoi}
                </p>
                <p className="mt-0.5">
                  {NHAN_TRUONG[x.truong]}: {x.tu ?? "(trống)"} → <b>{x.den ?? "(trống)"}</b>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {x.nguoiSua} · {new Date(x.luc).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  {x.lyDo ? ` · Lý do: ${x.lyDo}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {trucCho.length > 0 && (
        <section aria-labelledby="truc-cho" className="t-card space-y-3 p-4">
          <h2 id="truc-cho" className="text-base font-semibold">Ca trực chờ bạn xác nhận · {trucCho.length}</h2>
          <ul className="space-y-3">
            {trucCho.map((t) => (
              <li key={t.dutyId} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm">
                  <b className="tabular-nums">{dm(t.ngay)}</b> · ca {t.shiftCode} {t.danhGia.khung ? `(${t.danhGia.khung.tu}–${t.danhGia.khung.den})` : ""} — Hỗ trợ vận hành
                </p>
                <NhanTruc dutyId={t.dutyId} phienBan={t.phienBan} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {!r ? (
        <p className="t-card p-6 text-center text-sm text-muted-foreground">Tháng này bạn chưa có tiết dạy hay ca trực nào thuộc chính sách mới (từ 15/10/2026).</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7">
            <div className="t-card p-3">
              <dt className="text-xs text-muted-foreground">Tổng tiết đã xác nhận</dt>
              <dd className="text-2xl font-bold tabular-nums">{r.soTiet.toLocaleString("vi-VN")}</dd>
              <dd className="text-xs text-muted-foreground">{soGio(r.phutChuanDay)} giờ chuẩn (100′/tiết)</dd>
            </div>
            <div className="t-card p-3">
              <dt className="text-xs text-muted-foreground">Đơn vị trực</dt>
              <dd className="text-2xl font-bold tabular-nums">{r.donViTruc.toLocaleString("vi-VN")}</dd>
              <dd className="text-xs text-muted-foreground">{soGio(r.phutCoMatTruc)} giờ có mặt khi trực</dd>
            </div>
            {O.map((k) => {
              const n = soCua(r, k);
              const tienO = k === "deXuat" ? r.tienDeXuat : k === "daXacNhanTru" ? r.tienDaXacNhan : null;
              return (
                <div key={k} className={`t-card p-3 ${chiSo === k ? "ring-2 ring-primary" : ""}`}>
                  <dt className="text-xs text-muted-foreground">{NHAN_CHI_SO[k]}</dt>
                  <dd className="text-2xl font-bold tabular-nums">
                    {n === 0 ? (
                      <span className="text-muted-foreground">0</span>
                    ) : (
                      <Link href={href({ chiSo: k })} scroll={false} aria-current={chiSo === k ? "true" : undefined} className="text-primary-ink underline-offset-2 hover:underline" aria-label={`${NHAN_CHI_SO[k]}: ${n} — xem chi tiết`}>
                        {n}
                      </Link>
                    )}
                  </dd>
                  {tienO != null && <dd className="text-xs tabular-nums text-muted-foreground">{tien(tienO)}</dd>}
                </div>
              );
            })}
          </dl>

          {chiSo && (
            <section aria-labelledby="chi-tiet" className="t-card overflow-hidden">
              <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                <h2 id="chi-tiet" className="text-sm font-semibold">{NHAN_CHI_SO[chiSo]} · {soCua(r, chiSo)} dòng</h2>
                <Link href={href({ chiSo: null })} scroll={false} className="text-sm text-primary-ink underline-offset-2 hover:underline">Đóng</Link>
              </header>
              <ul className="divide-y divide-border">
                {bc.day.filter((x) => r.ds[chiSo].includes(x.dong.bc.assignmentId)).map((x) => {
                  const d = x.dong;
                  return (
                    <li key={d.bc.assignmentId} className="space-y-1 px-4 py-3 text-sm">
                      <p>
                        <b className="tabular-nums">{dm(d.bc.workDate)}</b> · {bc.nhanBuoi[`${d.bc.sourceType}:${d.bc.sourceId}`] ?? ""} · {d.bc.role === "MAIN_TEACHER" ? "Đứng chính" : "Trợ giảng"}
                        {x.assignmentType === "SUBSTITUTE" ? " · dạy thay" : ""}
                        {d.bc.activity === "MAKEUP" ? " · học bù" : ""} · {gio(d.bc.requiredTo && d.ungVien.thoiLuongDayPhut != null ? new Date(d.bc.requiredTo.getTime() - d.ungVien.thoiLuongDayPhut * 60_000) : null)}–{gio(d.bc.requiredTo)}
                      </p>
                      <p className="text-muted-foreground">
                        Chấm công: {nhanBangChung(d.bc)?.nhan ?? "—"}
                        {x.nhanXet ? ` · Nhận xét: ${NHAN_NX[x.nhanXet.trangThai]} (${x.nhanXet.daCo}/${x.nhanXet.canCo}, hạn ${gio(x.nhanXet.han)} ${dm(x.nhanXet.han.toISOString().slice(0, 10))})` : ""}
                        {d.donVi ? ` · ${d.donVi.hieuLuc === "CONFIRMED" ? "đã xác nhận" : d.donVi.hieuLuc === "STALE" ? "cần xác nhận lại" : "đã huỷ"}` : " · chưa xác nhận"}
                      </p>
                      {x.dieuChinh.map((a) => (
                        <p key={a.id} className="text-muted-foreground">
                          Khoản trừ <b className="tabular-nums text-foreground">{tien(a.amount)}</b> ({a.ruleCode}) — {NHAN_TT[a.status]}
                          {a.decisionReason ? `: ${a.decisionReason}` : ""}
                        </p>
                      ))}
                    </li>
                  );
                })}
                {bc.truc.filter((t) => r.ds[chiSo].includes(t.dutyId)).map((t) => (
                  <li key={t.dutyId} className="px-4 py-3 text-sm">
                    <b className="tabular-nums">{dm(t.ngay)}</b> · ca trực {t.shiftCode} · {t.danhGia.soTietTrongCa} tiết trong ca ⇒ đơn vị {t.donVi?.quantity ?? t.danhGia.donViTra ?? "chưa tính"} · có mặt {soGio(t.danhGia.phutCoMatTrongCa)} giờ
                  </li>
                ))}
                {bc.day.flatMap((x) => x.dieuChinh.filter((a) => r.ds[chiSo].includes(a.id)).map((a) => (
                  <li key={a.id} className="px-4 py-3 text-sm">
                    <b className="tabular-nums">{dm(x.dong.bc.workDate)}</b> · <b className="tabular-nums">{tien(a.amount)}</b> ({a.ruleCode}) — {NHAN_TT[a.status]}
                    {a.decisionReason ? `: ${a.decisionReason}` : ""}
                  </li>
                )))}
              </ul>
            </section>
          )}

          {bc.chuaGiaiQuyet.length > 0 && (
            <p className="rounded-lg border border-state-info-ink/20 bg-state-info-soft px-4 py-3 text-sm text-state-info-ink">
              {bc.chuaGiaiQuyet.length} mục đang chờ Ban lãnh đạo chốt luật (vd. đi muộn 15–30 phút, về sớm) — chưa có khoản trừ nào cho các mục này.
            </p>
          )}
        </>
      )}
    </div>
  );
}
