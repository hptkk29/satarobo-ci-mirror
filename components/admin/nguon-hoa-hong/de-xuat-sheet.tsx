"use client";

// components/admin/nguon-hoa-hong/de-xuat-sheet.tsx — SHEET CHI TIẾT + DUYỆT của một ĐỀ XUẤT ĐIỀU CHỈNH (hướng B+C, 08 §16).
//
// Mở bằng URL (`?dx=<id>`): F5, chia sẻ link, nút Back và LINK TỪ HÀNG CHỜ TRƯỚC SỔ đều đúng. Page đọc ở máy chủ rồi truyền `dx` xuống; component này chỉ VẼ và GỌI máy chủ.
//
// ── Nút chỉ vẽ khi máy chủ SẼ nhận (luật 12) ──────────────────────────────────────────────────────────────────────
// `dx.viec` do `viecCuaNguoiXem` tính — CÙNG khoá quyền (`KHOA_DUYET_DE_XUAT`) và CÙNG hàm tách nhiệm (`lyDoKhongDuocDuyet`) với service duyệt. Không đủ quyền / là người đề xuất / đã duyệt cấp 1 /
// là người hưởng trong gói ⇒ KHÔNG vẽ nút, chỉ nói lý do. Cấp duyệt (1 hay 2) suy từ TRẠNG THÁI đề xuất; nút gọi đúng việc sẽ xảy ra ("Duyệt cấp 1 — chưa ghi sổ" / "Duyệt và ghi sổ").
// Bảy dữ kiện chủ dự án yêu cầu: số tiền đề xuất · giao dịch gốc · lý do · trạng thái duyệt · người duyệt 1 · người duyệt 2 · kỳ ghi sổ — mỗi cái một dòng có nhãn, không dòng nào bị cắt.
//
// Hàm gọi máy chủ được TIÊM (`hanhDong`) — mặc định là Server Action; test dựng bằng hàm giả.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { StatusPill } from "@/components/admin/ui/status-pill";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { duyetDeXuatAction, tuChoiDeXuatAction } from "@/app/(admin)/admin/nguon-hoa-hong/khieu-nai/_actions";
import type { DeXuatHienThi } from "@/lib/hoa-hong/de-xuat-doc";
import { maDeXuat, NHAN_NGUON_GOC, nhanTrangThaiDeXuat, toneTrangThaiDeXuat } from "@/lib/hoa-hong/de-xuat-nhan";
import type { KetQuaDuyetDeXuat } from "@/lib/hoa-hong/duyet-de-xuat";
import { ngayDMYTuMoc, ngayGioVN } from "@/lib/hoa-hong/dinh-dang";
import { LY_DO_TOI_THIEU } from "@/lib/hoa-hong/kieu";
import type { NguonGocDeXuat } from "@/lib/hoa-hong/quan-tri-dieu-chinh";
import { dinhDangDong } from "@/lib/hoa-hong/vi-sao";
import { cn } from "@/lib/utils";

import { BTN_OUTLINE, BTN_PRIMARY, LOI_O, NHAN_O, NUT_CHAN, TEXTAREA } from "./classes";
import { inkSo, nhanSoTienDeXuat, soTienCoDau } from "./nhan-de-xuat";
import { nhanVai } from "./nhan-khieu-nai";

type KQ = { ok: true; ketQua?: KetQuaDuyetDeXuat } | { ok: false; loi: readonly unknown[]; chung: string | null };
type VaoDuyet = { requestId: string; nguonGoc: NguonGocDeXuat; lyDo: string };
export type HanhDongDeXuat = {
  duyet: (v: VaoDuyet) => Promise<KQ>;
  tuChoi: (v: VaoDuyet) => Promise<KQ>;
};

export const HANH_DONG_DE_XUAT_MAC_DINH: HanhDongDeXuat = {
  duyet: (v) => duyetDeXuatAction(v) as Promise<KQ>,
  tuChoi: (v) => tuChoiDeXuatAction(v) as Promise<KQ>,
};

export function DeXuatSheet({ dx, dongHref, hanhDong = HANH_DONG_DE_XUAT_MAC_DINH }: { dx: DeXuatHienThi; dongHref: string; hanhDong?: HanhDongDeXuat }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const dong = dx.trangThai === "POSTED" || dx.trangThai === "REJECTED" || dx.trangThai === "STALE";
  const soTien = nhanSoTienDeXuat(dx.soTien);
  return (
    <Sheet
      open={open}
      onOpenChange={(moi) => {
        setOpen(moi);
        if (!moi) router.push(dongHref);
      }}
    >
      {/* `admin-scope` TRÊN CHÍNH PANEL: panel render qua portal ra ngoài khung admin, nơi `--primary` rơi về CAM của :root. */}
      <SheetContent tabIndex={-1} className="admin-scope w-full gap-0 overflow-y-auto p-0 outline-none sm:max-w-xl" aria-label={`Đề xuất điều chỉnh ${maDeXuat(dx.id)}`}>
        <SheetHeader className="border-b border-border p-5 pr-12">
          <SheetTitle className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base font-semibold">
            <span>Đề xuất {maDeXuat(dx.id)}</span>
            <StatusPill tone={toneTrangThaiDeXuat(dx.trangThai)}>{nhanTrangThaiDeXuat(dx.trangThai, dx.quanTri)}</StatusPill>
          </SheetTitle>
          <SheetDescription className="truncate">
            {NHAN_NGUON_GOC[dx.nguonGoc]} · {dx.coSoTen} · lập {ngayGioVN(dx.taoLuc)}
          </SheetDescription>
        </SheetHeader>

        <div className="divide-y divide-border">
          <Muc tieuDe="Số tiền đề xuất">
            <p className={cn("text-xl font-semibold tabular-nums", soTien.ink)} data-so-tien="">
              {soTien.chinh}
            </p>
            {soTien.phu && <p className="mt-0.5 text-xs text-muted-foreground">{soTien.phu}</p>}
            <ul className="mt-2 divide-y divide-border/60 text-sm">
              {dx.goi.map((g, i) => (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                  <span className="min-w-0 truncate">
                    {nhanVai(g.vai)} · {g.nguoiHuong}
                  </span>
                  <span className="tabular-nums">
                    <b className={inkSo(g.chenh)}>{soTienCoDau(g.chenh)}</b> <span className="text-xs text-muted-foreground">đang ghi {dinhDangDong(g.rong)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Muc>

          <Muc tieuDe="Giao dịch gốc">
            <Dl>
              <Dong nhan="Khoản thu">
                {dx.giaoDichGoc.maDon ? `Đơn ${dx.giaoDichGoc.maDon} · ` : ""}
                <b className="tabular-nums">{dinhDangDong(dx.giaoDichGoc.soTienThu)}</b>
              </Dong>
              <Dong nhan="Ngày thu">{ngayDMYTuMoc(dx.giaoDichGoc.ngayThu)}</Dong>
              {dx.disputeId && (
                <Dong nhan="Khiếu nại">
                  <Link href={`/nguon-hoa-hong/khieu-nai?mo=${encodeURIComponent(dx.disputeId)}`} className="font-medium text-primary-ink underline focus-visible:ring-2 focus-visible:ring-ring">
                    Mở khiếu nại
                  </Link>
                </Dong>
              )}
            </Dl>
          </Muc>

          <Muc tieuDe="Lý do">
            <p className="whitespace-pre-wrap break-words text-sm text-foreground">{dx.lyDo}</p>
            {dx.lyDoQuanTri.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold text-muted-foreground">Vì sao cần hai người duyệt</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-foreground">
                  {dx.lyDoQuanTri.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </div>
            )}
            {dx.canhBao.length > 0 && (
              <p role="status" className="mt-3 rounded-lg border border-border bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink">
                Cảnh báo cần soát: {dx.canhBao.join(", ")}. Người hưởng thêm có liên quan tới người phụ trách lead — kiểm tra kỹ trước khi duyệt.
              </p>
            )}
          </Muc>

          <Muc tieuDe="Trạng thái duyệt">
            <Dl>
              <Dong nhan="Trạng thái">{nhanTrangThaiDeXuat(dx.trangThai, dx.quanTri)}</Dong>
              <Dong nhan="Người đề xuất">{dx.nguoiDeXuat.ten}</Dong>
              <Dong nhan="Người duyệt 1">{dx.capMot ? <DauDuyetDong d={dx.capMot} /> : <span className="text-muted-foreground">Chưa duyệt</span>}</Dong>
              <Dong nhan="Người duyệt 2">
                {dx.capHai ? (
                  <DauDuyetDong d={dx.capHai} />
                ) : dx.quanTri === "SECOND_APPROVAL_REQUIRED" ? (
                  <span className="text-muted-foreground">{dong ? "Không có" : "Chưa duyệt"}</span>
                ) : (
                  <span className="text-muted-foreground">Không cần — một người duyệt là đủ</span>
                )}
              </Dong>
              <Dong nhan="Kỳ ghi sổ">{dx.kyGhiSo ? `Kỳ ${dx.kyGhiSo.slice(5)}/${dx.kyGhiSo.slice(0, 4)}` : <span className="text-muted-foreground">Chưa ghi sổ</span>}</Dong>
              {dx.tuChoi && (
                <Dong nhan="Từ chối">
                  {dx.tuChoi.nguoi.ten} · {ngayGioVN(dx.tuChoi.luc)}
                  <span className="block whitespace-pre-wrap text-muted-foreground">{dx.tuChoi.lyDo}</span>
                </Dong>
              )}
              {dx.lyDoLoiThoi && <Dong nhan="Lỗi thời">{dx.lyDoLoiThoi}</Dong>}
            </Dl>
          </Muc>

          <KhuDuyet dx={dx} hanhDong={hanhDong} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DauDuyetDong({ d }: { d: { nguoi: { ten: string }; luc: Date; lyDo: string } }) {
  return (
    <>
      {d.nguoi.ten} · {ngayGioVN(d.luc)}
      <span className="block whitespace-pre-wrap text-muted-foreground">{d.lyDo}</span>
    </>
  );
}

function Muc({ tieuDe, children }: { tieuDe: string; children: React.ReactNode }) {
  return (
    <section className="px-5 py-4">
      <h3 className="mb-2 text-sm font-semibold text-foreground">{tieuDe}</h3>
      {children}
    </section>
  );
}

function Dl({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">{children}</dl>;
}
function Dong({ nhan, children }: { nhan: string; children: React.ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{nhan}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}

// ── khu duyệt ────────────────────────────────────────────────────────────────────────────────

/** Nhãn nút duyệt: nói đúng việc sẽ xảy ra. Cấp 1 của đề xuất cần hai người CHƯA ghi sổ; còn lại duyệt là ghi sổ. */
export function nhanNutDuyet(dx: Pick<DeXuatHienThi, "quanTri" | "viec" | "soTien">): string {
  const cap = dx.viec.cap;
  if (cap === 1 && dx.quanTri === "SECOND_APPROVAL_REQUIRED") return "Duyệt cấp 1 — chưa ghi sổ";
  const so = nhanSoTienDeXuat(dx.soTien);
  // Gói chuyển/lệch: «ghi chuyển 16.000.000đ» thay vì «ghi 0đ» (nút nói đúng việc sẽ ghi).
  const viGhi = dx.soTien.rong !== 0 && dx.soTien.tuyetDoi === Math.abs(dx.soTien.rong) ? so.chinh : `${so.chinh.charAt(0).toLowerCase()}${so.chinh.slice(1)}`;
  return `Duyệt${dx.quanTri === "SECOND_APPROVAL_REQUIRED" ? ` cấp ${cap}` : ""} và ghi ${viGhi} vào kỳ đang mở`;
}

function KhuDuyet({ dx, hanhDong }: { dx: DeXuatHienThi; hanhDong: HanhDongDeXuat }) {
  const router = useRouter();
  const [dang, batDau] = useTransition();
  const [lyDo, setLyDo] = useState("");
  const [loi, setLoi] = useState<string | null>(null);
  const v = dx.viec;

  if (!v.duyet) {
    return (
      <Muc tieuDe="Xử lý">
        <p className="text-sm text-muted-foreground">{v.lyDoKhong ?? "Đề xuất đã kết thúc — không còn việc cần xử lý."}</p>
      </Muc>
    );
  }

  function chay(tuChoi: boolean) {
    const sach = lyDo.trim();
    if (sach.length < LY_DO_TOI_THIEU) {
      setLoi(`Nhập lý do ít nhất ${LY_DO_TOI_THIEU} ký tự.`);
      return;
    }
    setLoi(null);
    batDau(async () => {
      let r: KQ;
      try {
        r = await (tuChoi ? hanhDong.tuChoi : hanhDong.duyet)({ requestId: dx.id, nguonGoc: dx.nguonGoc, lyDo: sach });
      } catch {
        setLoi("Không thực hiện được lúc này. Thử lại sau ít giây.");
        return;
      }
      if (!r.ok) {
        setLoi(r.chung ?? "Không thực hiện được.");
        return;
      }
      const kq = r.ketQua;
      if (kq?.loai === "LOI_THOI") {
        setLoi(`Đề xuất đã lỗi thời nên KHÔNG ghi sổ: ${kq.lyDo}`);
      } else if (kq?.loai === "DA_DUYET_CAP_1") {
        toast.success("Đã duyệt cấp 1 — chờ người duyệt cấp 2. Sổ chưa đổi.");
      } else if (kq?.loai === "DA_TU_CHOI") {
        toast.success("Đã từ chối đề xuất. Sổ không đổi.");
      } else {
        toast.success("Đã duyệt và ghi điều chỉnh vào sổ.");
      }
      router.refresh();
    });
  }

  return (
    <Muc tieuDe={`Xử lý — duyệt cấp ${v.cap}`}>
      <div className="space-y-3">
        {dx.quanTri === "SECOND_APPROVAL_REQUIRED" && v.cap === 1 && <p className="text-sm text-muted-foreground">Đề xuất này cần hai người duyệt khác nhau. Duyệt cấp 1 chưa ghi sổ; người duyệt cấp 2 sẽ ghi.</p>}
        <div>
          <label htmlFor="dx-ly-do" className={NHAN_O}>
            Lý do {`(ít nhất ${LY_DO_TOI_THIEU} ký tự)`}
          </label>
          <textarea
            id="dx-ly-do"
            className={TEXTAREA}
            rows={3}
            value={lyDo}
            onChange={(e) => {
              setLyDo(e.target.value);
              if (loi) setLoi(null);
            }}
            aria-invalid={loi ? true : undefined}
            disabled={dang}
            placeholder="Căn cứ của quyết định — được ghi vào nhật ký và hiện cho người duyệt sau."
          />
          {loi && (
            <p role="alert" className={LOI_O}>
              {loi}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Nhãn nút duyệt dài («Duyệt cấp 2 và ghi chuyển 14.000.000đ vào kỳ đang mở») — dưới `sm` cho XUỐNG DÒNG và cao theo nội dung; chụp thật 375px thấy nó tràn khỏi khung khi giữ nowrap. */}
          <button type="button" className={cn(BTN_PRIMARY, NUT_CHAN, "h-auto min-h-11 max-w-full whitespace-normal py-2 text-center sm:h-9 sm:min-h-0 sm:whitespace-nowrap sm:py-0")} disabled={dang} onClick={() => chay(false)}>
            {dang && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
            {nhanNutDuyet(dx)}
          </button>
          <button type="button" className={cn(BTN_OUTLINE, NUT_CHAN)} disabled={dang} onClick={() => chay(true)}>
            Từ chối đề xuất
          </button>
        </div>
      </div>
    </Muc>
  );
}
