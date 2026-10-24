"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { cn } from "@/lib/utils";
import { TaiTepBaoLuu, type TepDaTai } from "../../_components/tai-tep-bao-luu";
import { nhapLegacyAction, xemTruocLegacyAction, type CaXemTruoc, type DauVaoNhapLegacy } from "../_actions";

// Bảng chọn ca LEGACY → XEM TRƯỚC (server, chỉ đọc) → GHI (server, một giao dịch). Mọi luật do SERVER phán; ở đây chỉ chọn, nhập ngày, tải đơn và hiện nguyên văn
// lỗi / cảnh báo. Nút "Ghi" chỉ mở khi bản xem trước đã chạy trên ĐÚNG lựa chọn hiện tại và không còn lỗi — đổi bất cứ ô nào là phải xem trước lại.

export type DongUngVien = {
  khoa: string;
  nhom: "A" | "B" | "C";
  studentId: string;
  tenHocVien: string;
  maHocVien: string | null;
  enrollmentId: string | null;
  reserveId: string | null;
  ten: string;
  ngayGoiY: string;
  nguonNgay: string;
  ghiDanhChon: { id: string; ten: string }[];
};

type Nhap = { chon: boolean; ngay: string; tep: TepDaTai | null; ghiDanh: string };

const NHOM: { ma: "A" | "B" | "C"; ten: string; mo_ta: string }[] = [
  { ma: "A", ten: "A · Dòng cũ còn mở", mo_ta: "Đã có dòng bảo lưu trong hệ thống nhưng chưa theo quy chế — bổ sung đơn và ngày bắt đầu thực tế." },
  { ma: "B", ten: "B · Tạm dừng chưa hồ sơ", mo_ta: "Ghi danh đã chuyển Tạm dừng bằng đường tắt, không có hồ sơ — lập hồ sơ LEGACY." },
  { ma: "C", ten: "C · Vắng 4 buổi liên tiếp", mo_ta: "Đang học nhưng vắng cả 4 buổi gần nhất, chưa hồ sơ (thoả thuận miệng) — lập hồ sơ LEGACY và chuyển ghi danh sang Tạm dừng." },
];

const NHAN_TRANG_THAI: Record<string, string> = { PAUSED: "Tạm dừng", ACTIVE: "Đang học", STUDYING: "Đang học", CONFIRMED: "Đã xác nhận" };

export function BangNhapLegacy({ dong, hieuLuc, homNay, catNgang }: { dong: DongUngVien[]; hieuLuc: string; homNay: string; catNgang: boolean }) {
  const router = useRouter();
  const [dang, bat] = useTransition();
  const [nhom, setNhom] = useState<"A" | "B" | "C">("B");
  const [nhap, setNhap] = useState<Record<string, Nhap>>({});
  const [xem, setXem] = useState<{ khoaLuaChon: string; cac: CaXemTruoc[]; loLoi: string[]; sanSang: boolean } | null>(null);
  const [xacNhan, setXacNhan] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);

  const hang = dong.filter((d) => d.nhom === nhom);
  const dem = (m: string) => dong.filter((d) => d.nhom === m).length;
  const lay = (d: DongUngVien): Nhap => nhap[d.khoa] ?? { chon: false, ngay: d.ngayGoiY, tep: null, ghiDanh: d.enrollmentId ?? "" };
  const sua = (d: DongUngVien, p: Partial<Nhap>) => {
    setNhap((x) => ({ ...x, [d.khoa]: { ...lay(d), ...p } }));
    setXem(null);
    setXacNhan(false);
  };

  const chon = useMemo(() => dong.filter((d) => nhap[d.khoa]?.chon), [dong, nhap]);
  const dauVao = useMemo<DauVaoNhapLegacy>(
    () => ({
      cas: chon.map((d) => {
        const n = nhap[d.khoa]!;
        return {
          nhom: d.nhom,
          studentId: d.studentId,
          enrollmentId: d.nhom === "A" ? (d.enrollmentId ?? (n.ghiDanh || null)) : d.enrollmentId,
          reserveId: d.reserveId,
          ngayBatDau: n.ngay,
          applicationFileKey: n.tep?.key ?? null,
        };
      }),
    }),
    [chon, nhap],
  );
  const khoaLuaChon = JSON.stringify(dauVao);
  const xemKhop = xem?.khoaLuaChon === khoaLuaChon;

  function xemTruoc() {
    setLoi(null);
    bat(async () => {
      const r = await xemTruocLegacyAction(dauVao);
      if (!r.ok) {
        setLoi(r.error);
        return;
      }
      setXem({ khoaLuaChon, cac: r.cac, loLoi: r.loLoi, sanSang: r.sanSang });
    });
  }

  function ghi() {
    setLoi(null);
    bat(async () => {
      const r = await nhapLegacyAction(dauVao);
      if (!r.ok) {
        setLoi(r.error);
        setXem(null);
        return;
      }
      toast.success(`Đã nhập ${r.soCa} ca vào quy chế`);
      setNhap({});
      setXem(null);
      setXacNhan(false);
      router.refresh();
    });
  }

  const ngayVN = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "—");

  return (
    <div className="space-y-5">
      <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        Ngày hiệu lực quy chế: <strong className="text-foreground tabular-nums">{hieuLuc}</strong>. Hạn của mọi ca nhập = ngày này + thời hạn bảo lưu tối đa của cơ sở, <strong>không</strong> tính từ ngày bắt đầu thực tế.
        Nhập xong, bé là hồ sơ theo quy chế: rời danh sách lớp / nhóm chat lớp, các buổi từ ngày bắt đầu không tính vắng, cron theo dõi hạn.
      </p>

      <div role="tablist" aria-label="Nhóm ca" className="flex flex-wrap gap-2">
        {NHOM.map((n) => (
          <button
            key={n.ma}
            type="button"
            role="tab"
            aria-selected={nhom === n.ma}
            onClick={() => setNhom(n.ma)}
            className={cn(
              "min-h-9 rounded-lg border px-3 text-sm font-semibold transition-colors",
              nhom === n.ma ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted",
            )}
          >
            {n.ten} <span className="tabular-nums opacity-80">({dem(n.ma)})</span>
          </button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{NHOM.find((n) => n.ma === nhom)!.mo_ta}</p>

      {hang.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">Không có ca nào ở nhóm này.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <PhanTrangBang tenDonVi="ca" khoaGhiNho={`bao-luu-legacy-${nhom}`} cuonNgang className="[&>div:last-child]:px-5 [&>div:last-child]:pb-4">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th scope="col" className="w-10 px-3 py-2.5"><span className="sr-only">Chọn</span></th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Học viên · khoá</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Ngày bắt đầu nghỉ thực tế</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Đơn đã ký *</th>
                </tr>
              </thead>
              <tbody>
                {hang.map((d) => {
                  const n = lay(d);
                  return (
                    <tr key={d.khoa} className="border-b border-border/60 align-top last:border-0">
                      <td className="px-3 py-3">
                        <input type="checkbox" aria-label={`Chọn ${d.tenHocVien}`} checked={n.chon} onChange={(e) => sua(d, { chon: e.target.checked })} className="size-4" />
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-medium">{d.tenHocVien}{d.maHocVien ? <span className="ml-2 text-xs text-muted-foreground">{d.maHocVien}</span> : null}</div>
                        <div className="text-xs text-muted-foreground">{d.ten}</div>
                        {d.nhom === "A" && !d.enrollmentId && (
                          <select
                            aria-label={`Ghi danh áp dụng cho ${d.tenHocVien}`}
                            value={n.ghiDanh}
                            onChange={(e) => sua(d, { ghiDanh: e.target.value })}
                            className="mt-2 h-9 w-full max-w-xs rounded-lg border border-border bg-card px-2 text-sm"
                          >
                            <option value="">Chọn khoá áp dụng…</option>
                            {d.ghiDanhChon.map((g) => <option key={g.id} value={g.id}>{g.ten}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <Input type="date" max={homNay} value={n.ngay} onChange={(e) => sua(d, { ngay: e.target.value })} className="h-9 w-40" aria-label={`Ngày bắt đầu nghỉ của ${d.tenHocVien}`} />
                        <div className="mt-1 text-xs text-muted-foreground">Gợi ý: {d.nguonNgay}</div>
                      </td>
                      <td className="min-w-[14rem] px-3 py-3">
                        <TaiTepBaoLuu nhan="Đơn bảo lưu đã ký" batBuoc giaTri={n.tep} onChange={(t) => sua(d, { tep: t })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </PhanTrangBang>
          {catNgang && <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">Danh sách bị cắt ở mức tối đa — nhập bớt rồi tải lại để thấy phần còn lại.</p>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={xemTruoc} disabled={dang || chon.length === 0}>
          {dang && !xem && <Loader2 className="h-4 w-4 animate-spin" />}
          Xem trước ({chon.length} ca)
        </Button>
        <span className="text-xs text-muted-foreground">Xem trước chỉ đọc — chưa ghi gì.</span>
      </div>

      {loi && <p role="alert" className="whitespace-pre-line rounded-lg border border-state-danger-soft bg-state-danger-soft px-3 py-2 text-sm text-state-danger-ink">{loi}</p>}

      {xem && xemKhop && (
        <section aria-label="Bản xem trước" className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Bản xem trước — {xem.cac.length} ca</h2>
          {xem.loLoi.map((l) => <p key={l} className="text-sm text-state-danger-ink">{l}</p>)}
          <ul className="space-y-3">
            {xem.cac.map((c, i) => (
              <li key={`${c.studentId}-${c.enrollmentId ?? i}`} className="rounded-lg border border-border px-3 py-2 text-sm">
                <div className="font-medium">{c.tenHocVien ?? "Học viên"} · {c.khoa ?? "—"} <span className="ml-1 text-xs text-muted-foreground">(nhóm {c.nhom})</span></div>
                {c.loi.length === 0 && (
                  <div className="mt-1 text-muted-foreground">
                    Ghi danh: {NHAN_TRANG_THAI[c.trangThaiGhiDanhTruoc ?? ""] ?? c.trangThaiGhiDanhTruoc ?? "—"} → <strong className="text-foreground">Tạm dừng</strong>
                    {c.chuyenSangTamDung ? " (đổi trạng thái)" : " (giữ nguyên)"} · bắt đầu <span className="tabular-nums">{ngayVN(c.batDau)}</span> · hạn <span className="tabular-nums">{ngayVN(c.han)}</span>
                  </div>
                )}
                {c.loi.map((l) => <p key={l} className="mt-1 text-state-danger-ink">✕ {l}</p>)}
                {c.canhBao.map((l) => <p key={l} className="mt-1 text-state-warning-ink">⚠ {l}</p>)}
              </li>
            ))}
          </ul>
          {xem.sanSang ? (
            <div className="space-y-3 border-t border-border pt-3">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={xacNhan} onChange={(e) => setXacNhan(e.target.checked)} />
                <span>Tôi đã đối chiếu từng đơn giấy với ngày bắt đầu và hiểu rằng các bé này sẽ rời danh sách lớp / nhóm chat lớp ngay sau khi ghi.</span>
              </label>
              <Button type="button" onClick={ghi} disabled={dang || !xacNhan}>
                {dang && <Loader2 className="h-4 w-4 animate-spin" />}
                {dang ? "Đang ghi..." : `Ghi ${xem.cac.length} ca vào hệ thống`}
              </Button>
            </div>
          ) : (
            <p className="border-t border-border pt-3 text-sm text-muted-foreground">Còn lỗi — sửa các ca bị đánh dấu ✕ (hoặc bỏ chọn chúng) rồi xem trước lại. Chưa ghi gì.</p>
          )}
        </section>
      )}
    </div>
  );
}
