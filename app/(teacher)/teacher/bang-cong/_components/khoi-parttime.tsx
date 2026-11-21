// Hai thẻ cột phải của Bảng công site GV (khoản trừ · buổi quản lý điều chỉnh); phần còn lại của khung ở `man-bang-cong.tsx`. Gốc: khối "Bảng công · giáo viên parttime" của site GV (chủ dự án 09/11/2026 — làm theo thiết kế ở artifact "Site giáo viên Sata Robo").
// Gộp chỗ của hai màn đã gỡ khỏi menu: "Công tháng của tôi" (khoản trừ, muộn / sớm, thiếu nhận xét, buổi quản lý điều chỉnh) và
// "Ô công cần xem" (ô thiếu / trễ lượt + phản ánh). CHỈ VẼ — mọi số đến từ loader admin đang dùng (luật 12b):
//   · ô công: `docCongOCuaNguoi` (cùng loader màn Công parttime tháng của QLCS);
//   · tiết / trực / Trial / tiền dự kiến: `hienTongPhanCong(tongViec(docViecParttime))` (engine Lương dự kiến của màn Phân công);
//   · muộn / sớm / thiếu nhận xét / khoản trừ: `docBaoCaoCuaToi` (cùng lớp đọc màn QLCS).
// Câu chữ phải nói thật (luật 12): từ luật công mới, công ghi theo PHÂN CÔNG lúc chốt kỳ — ô thiếu lượt quét KHÔNG bị bỏ công; phản ánh chỉ
// bổ sung bằng chứng giờ có mặt, muộn / sớm chỉ trừ khi quản lý cơ sở xác nhận khoản điều chỉnh.
import { cn } from "@/lib/utils";
import type { BaoCaoThang } from "@/lib/parttime/bao-cao-thang-db";
import { NHAN_CHI_SO, soCua, type ChiSo, type DongTongHop } from "@/lib/parttime/bao-cao-thang";
import { nhanBangChung } from "@/lib/parttime/nhan-bang-chung";
import { NHAN_TRUONG } from "@/lib/parttime/sua-buoi-da-qua";
import type { docNhatKySuaCuaToi } from "@/lib/parttime/sua-buoi-da-qua-db";

const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const tien = (n: number) => `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("vi-VN")}đ`;
const gio = (d: Date | null) =>
  d ? d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" }) : "—";

// ─── 7. Muộn / sớm / nhận xét / khoản trừ (thay "Công tháng của tôi") ──────────────────────────────────────────────────────────
const NHAN_NX: Record<string, string> = {
  ON_TIME: "đúng hạn",
  LATE: "nộp trễ",
  MISSING: "thiếu",
  PENDING: "chưa tới hạn",
  KHONG_YEU_CAU: "không cần",
  CHUA_DIEM_DANH: "chưa điểm danh",
};
const NHAN_TT: Record<string, string> = { PROPOSED: "đề xuất — chờ quản lý", CONFIRMED: "đã xác nhận", REJECTED: "không áp", CANCELLED: "đã huỷ" };
const CHI_SO_TRU: ChiSo[] = ["diMuon", "veSom", "thieuNhanXet", "deXuat", "daXacNhanTru"];

export function KhoanTru({ bc, r }: { bc: BaoCaoThang; r: DongTongHop }) {
  return (
    <section aria-labelledby="khoan-tru" className="space-y-3 rounded-xl border border-border bg-card p-[18px]">
      <div>
        <h2 id="khoan-tru" className="text-sm font-bold text-foreground">
          Muộn · sớm · khoản trừ
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Cùng số với màn của quản lý cơ sở. Muộn / sớm chỉ trừ tiền khi quản lý cơ sở XÁC NHẬN khoản điều chỉnh; khoản đề xuất chưa trừ.
        </p>
      </div>
      <div>
        {CHI_SO_TRU.map((k) => {
          const n = soCua(r, k);
          const tienO = k === "deXuat" ? r.tienDeXuat : k === "daXacNhanTru" ? r.tienDaXacNhan : null;
          const dong = bc.day.filter((x) => r.ds[k].includes(x.dong.bc.assignmentId));
          const khoan = bc.day.flatMap((x) => x.dieuChinh.filter((a) => r.ds[k].includes(a.id)).map((a) => ({ a, ngay: x.dong.bc.workDate })));
          return (
            <details key={k} className="group border-b border-border last:border-0" open={n > 0 && (k === "deXuat" || k === "daXacNhanTru")}>
              <summary
                className={cn(
                  "flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 text-[13px] pointer-coarse:min-h-11",
                  n === 0 && "cursor-default text-muted-foreground",
                )}
              >
                <span>{NHAN_CHI_SO[k]}</span>
                <span className="flex items-center gap-2 tabular-nums">
                  {tienO != null && n > 0 && <span className="text-xs text-muted-foreground">{tien(tienO)}</span>}
                  <b className={n > 0 ? "text-foreground" : ""}>{n}</b>
                </span>
              </summary>
              {n > 0 && (
                <ul className="divide-y divide-border border-t border-border text-sm">
                  {dong.map((x) => {
                    const d = x.dong;
                    return (
                      <li key={d.bc.assignmentId} className="space-y-0.5 px-3 py-2.5">
                        <p>
                          <b className="tabular-nums">{dm(d.bc.workDate)}</b> · {bc.nhanBuoi[`${d.bc.sourceType}:${d.bc.sourceId}`] ?? ""} ·{" "}
                          {d.bc.role === "MAIN_TEACHER" ? "Đứng chính" : "Trợ giảng"}
                          {x.assignmentType === "SUBSTITUTE" ? " · dạy thay" : ""}
                          {d.bc.activity === "MAKEUP" ? " · học bù" : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Chấm công: {nhanBangChung(d.bc)?.nhan ?? "—"}
                          {x.nhanXet
                            ? ` · Nhận xét: ${NHAN_NX[x.nhanXet.trangThai]} (${x.nhanXet.daCo}/${x.nhanXet.canCo}, hạn ${gio(x.nhanXet.han)} ${dm(x.nhanXet.han.toISOString().slice(0, 10))})`
                            : ""}
                        </p>
                        {x.dieuChinh.map((a) => (
                          <p key={a.id} className="text-xs text-muted-foreground">
                            Khoản trừ <b className="tabular-nums text-foreground">{tien(a.amount)}</b> ({a.ruleCode}) — {NHAN_TT[a.status]}
                            {a.decisionReason ? `: ${a.decisionReason}` : ""}
                          </p>
                        ))}
                      </li>
                    );
                  })}
                  {khoan.map(({ a, ngay }) => (
                    <li key={a.id} className="px-3 py-2.5">
                      <b className="tabular-nums">{dm(ngay)}</b> · <b className="tabular-nums">{tien(a.amount)}</b> ({a.ruleCode}) — {NHAN_TT[a.status]}
                      {a.decisionReason ? `: ${a.decisionReason}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </details>
          );
        })}
      </div>
      {bc.chuaGiaiQuyet.length > 0 && (
        <p className="rounded-lg bg-state-info-soft px-3 py-2 text-xs text-state-info-ink">
          {bc.chuaGiaiQuyet.length} mục đang chờ Ban lãnh đạo chốt luật (vd. đi muộn 15–30 phút, về sớm) — chưa có khoản trừ nào cho các mục này.
        </p>
      )}
    </section>
  );
}

// ─── 8. Quản lý đã điều chỉnh buổi của bạn ──────────────────────────────────────────────────────────────────────────────────────
export function DieuChinhBuoi({ ds }: { ds: Awaited<ReturnType<typeof docNhatKySuaCuaToi>> }) {
  if (!ds.length) return null;
  return (
    <section aria-labelledby="dieu-chinh-qua" className="space-y-3 rounded-xl border border-border bg-card p-[18px]">
      <h2 id="dieu-chinh-qua" className="text-sm font-bold text-foreground">
        Quản lý đã điều chỉnh buổi của bạn · {ds.length}
      </h2>
      <p className="text-xs text-muted-foreground">Buổi đã qua được sửa người dạy / trợ giảng. Thấy chưa đúng thì báo quản lý cơ sở.</p>
      <ul className="space-y-2">
        {ds.map((x) => (
          <li key={x.id} className="rounded-lg border border-border p-3 text-sm">
            <p>
              <b className="tabular-nums">{dm(x.ngay)}</b> · {x.buoi}
            </p>
            <p className="mt-0.5">
              {NHAN_TRUONG[x.truong]}: {x.tu ?? "(trống)"} → <b>{x.den ?? "(trống)"}</b>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {x.nguoiSua} ·{" "}
              {new Date(x.luc).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              {x.lyDo ? ` · Lý do: ${x.lyDo}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
