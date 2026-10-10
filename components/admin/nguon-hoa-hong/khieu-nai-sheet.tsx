"use client";

// components/admin/nguon-hoa-hong/khieu-nai-sheet.tsx — SHEET CHI TIẾT + QUYẾT ĐỊNH của một khiếu nại (06 §5.5).
//
// Mở bằng URL (`?mo=<id>`): F5, chia sẻ link, nút Back và LINK TRONG THÔNG BÁO đều đúng. Page đọc chi tiết ở máy chủ rồi truyền `ct` xuống; component này chỉ VẼ và GỌI máy chủ.
//
// ── Nút chỉ vẽ khi máy chủ SẼ nhận (luật 12) ────────────────────────────────────────────────────────────────────
// `ct.viec` do `viecDuocLam` tính — CÙNG hàm với cổng của service (`[NHH-DSP-V1]` so hai bên trên Postgres thật, 48 tổ hợp). Không đủ quyền / là người khiếu nại ⇒ KHÔNG vẽ nút, chỉ
// nói lý do. Duy nhất một việc có "đủ quyền nhưng chưa đạt điều kiện": đóng khiếu nại 'sửa nguồn' khi chưa có dòng đổi nguồn — nút TẮT KÈM LÝ DO ngay cạnh, không để bấm rồi mới biết.
//
// ── Quyết định ─────────────────────────────────────────────────────────────────────────────────────────────────
// Không chọn sẵn cách giải: duyệt nhầm do bấm Enter là ghi tiền thật. Nút xác nhận gọi đúng việc sẽ xảy ra ("Duyệt và ghi +50.000đ vào kỳ đang mở"). Lý do bắt buộc ở CẢ ba cách.
// Bộ kiểm đầu vào dùng CHUNG với máy chủ (`kiemDauVaoQuyet`): lỗi hiện cạnh ô, focus nhảy tới ô lỗi đầu tiên.
//
// Hàm gọi máy chủ được TIÊM (`hanhDong`) — mặc định là Server Action; test dựng bằng hàm giả.
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { StatusPill } from "@/components/admin/ui/status-pill";
import { MoneyInput } from "@/components/ui/money-input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { dongKhieuNaiAction, nhanKhieuNaiAction, quyetDinhKhieuNaiAction } from "@/app/(admin)/admin/nguon-hoa-hong/khieu-nai/_actions";
import { ngayGioVN } from "@/lib/hoa-hong/dinh-dang";
import type { ChiTietKhieuNai } from "@/lib/hoa-hong/khieu-nai-doc";
import { kiemDauVaoQuyet, LY_DO_KHIEU_NAI_TOI_DA, type LoiTruong } from "@/lib/hoa-hong/khieu-nai-dau-vao";
import { LY_DO_TOI_THIEU } from "@/lib/hoa-hong/kieu";
import { dinhDangDong } from "@/lib/hoa-hong/vi-sao";
import { cn } from "@/lib/utils";

import { AuditTimeline } from "./audit-timeline";
import { BTN_OUTLINE, BTN_PRIMARY, LOI_O, NHAN_O, O_NHAP, TEXTAREA } from "./classes";
import { inkKetQuaHienThi, maKhieuNai, moTaDich, nhanKetQuaHienThi, nhanVai, toneKetQuaHienThi } from "./nhan-khieu-nai";
import { ViSaoThuGon } from "./vi-sao-thu-gon";

type KQ = { ok: true } | { ok: false; loi: readonly LoiTruong[]; chung: string | null; /** Lỗi đã hiện CẠNH ô — không lặp lại ở đầu khu xử lý. */ daHienTheoO?: boolean };
export type HanhDongKhieuNai = {
  nhan: (v: { disputeId: string; nguoiNhanId?: string | null }) => Promise<KQ>;
  quyet: (v: { disputeId: string; dauVao: unknown }) => Promise<KQ>;
  dong: (v: { disputeId: string }) => Promise<KQ>;
};

export const HANH_DONG_MAC_DINH: HanhDongKhieuNai = {
  nhan: (v) => nhanKhieuNaiAction(v) as Promise<KQ>,
  quyet: (v) => quyetDinhKhieuNaiAction(v) as Promise<KQ>,
  dong: (v) => dongKhieuNaiAction(v) as Promise<KQ>,
};

export function KhieuNaiSheet({ ct, dongHref, hanhDong = HANH_DONG_MAC_DINH }: { ct: ChiTietKhieuNai; dongHref: string; hanhDong?: HanhDongKhieuNai }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const dich = ct.dich;
  // Focus lúc mở rơi vào CHÍNH panel (không vào phần tử tương tác đầu tiên): mặc định nó nhảy tới "Vì sao con số này" và cuộn panel qua mất tiêu đề (mã + trạng thái).
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <Sheet
      open={open}
      onOpenChange={(moi) => {
        setOpen(moi);
        if (!moi) router.push(dongHref);
      }}
    >
      {/* `admin-scope` TRÊN CHÍNH PANEL: panel render qua portal ra ngoài khung admin, nơi `--primary` rơi về CAM của :root. */}
      <SheetContent ref={panelRef} initialFocus={panelRef} tabIndex={-1} className="admin-scope w-full gap-0 overflow-y-auto p-0 outline-none sm:max-w-xl" aria-label={`Khiếu nại ${maKhieuNai(ct.id)}`}>
        <SheetHeader className="border-b border-border p-5 pr-12">
          <SheetTitle className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base font-semibold">
            <span>Khiếu nại {maKhieuNai(ct.id)}</span>
            <StatusPill tone={toneKetQuaHienThi(ct.ketQua, ct.trangThai)} className={inkKetQuaHienThi(ct.ketQua, ct.trangThai)}>
              {nhanKetQuaHienThi(ct.ketQua, ct.trangThai)}
            </StatusPill>
          </SheetTitle>
          <SheetDescription className="truncate">
            {ct.coSoTen} · gửi {ngayGioVN(ct.taoLuc)}
          </SheetDescription>
        </SheetHeader>

        <div className="divide-y divide-border">
          <Muc tieuDe="Về">
            <Dl>
              <Dong nhan="Người khiếu nại">{ct.nguoiKhieuNai.ten}</Dong>
              {dich.loai === "DONG" ? (
                <>
                  <Dong nhan="Dòng hoa hồng">
                    {nhanVai(dich.vai)}
                    {dich.nguoiHuong && <span className="text-muted-foreground"> · {dich.nguoiHuong}</span>}
                  </Dong>
                  <Dong nhan="Đang ghi sổ">
                    <b className="tabular-nums">{dinhDangDong(dich.soTien)}</b> <span className="text-muted-foreground">· kỳ {dich.ky}</span>
                  </Dong>
                </>
              ) : (
                <>
                  <Dong nhan="Khoản thu">{moTaDich({ loai: "KHOAN", soTien: dich.soTien, maDon: dich.maDon, ngayThu: dich.ngayThu })}</Dong>
                  <Dong nhan="Ngày thu">{ngayGioVN(dich.ngayThu).slice(0, 10)}</Dong>
                </>
              )}
              <Dong nhan="Người xử lý">{ct.nguoiXuLy ? ct.nguoiXuLy.ten : <span className="text-muted-foreground">Chưa có</span>}</Dong>
            </Dl>
          </Muc>

          <Muc tieuDe="Nội dung đã gửi" ghiChu="Không sửa được sau khi gửi.">
            <p className="whitespace-pre-wrap break-words text-sm text-foreground">{ct.lyDo}</p>
            {ct.bangChung.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold text-muted-foreground">Bằng chứng</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-foreground">
                  {ct.bangChung.map((b, i) => (
                    <li key={i} className="whitespace-pre-wrap break-words">
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Muc>

          {dich.loai === "DONG" && dich.viSao && (
            <Muc tieuDe="Dòng bị khiếu nại">
              <ViSaoThuGon viSao={dich.viSao} />
            </Muc>
          )}
          {dich.loai === "KHOAN" && dich.dongCuaKhoan && (
            <Muc tieuDe="Các dòng hoa hồng của khoản thu" ghiChu="Chỉ người duyệt thấy phần này.">
              {dich.dongCuaKhoan.length === 0 ? (
                <p className="text-sm text-muted-foreground">Khoản thu này chưa có dòng hoa hồng nào.</p>
              ) : (
                <ul className="divide-y divide-border/60 text-sm">
                  {dich.dongCuaKhoan.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                      <span className="min-w-0 truncate">
                        {nhanVai(d.vai)} · {d.nguoiHuong}
                      </span>
                      <span className="tabular-nums">
                        {dinhDangDong(d.soTien)} <span className="text-xs text-muted-foreground">kỳ {d.ky}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Muc>
          )}

          {ct.quyetDinh && (
            <Muc tieuDe="Quyết định">
              <Dl>
                <Dong nhan="Kết quả">{nhanKetQuaHienThi(ct.ketQua, ct.trangThai)}</Dong>
                <Dong nhan="Người quyết">{ct.quyetDinh.nguoi ?? "—"}</Dong>
                <Dong nhan="Lúc">{ngayGioVN(ct.quyetDinh.luc)}</Dong>
                <Dong nhan="Lý do">
                  <span className="whitespace-pre-wrap break-words">{ct.quyetDinh.lyDo}</span>
                </Dong>
                {ct.dongDieuChinh && (
                  <Dong nhan="Đã ghi sổ">
                    <b className={cn("tabular-nums", ct.dongDieuChinh.soTien < 0 ? "text-state-danger-ink" : "text-state-success-ink")}>
                      {ct.dongDieuChinh.soTien > 0 ? "+" : ""}
                      {dinhDangDong(ct.dongDieuChinh.soTien)}
                    </b>{" "}
                    vào kỳ {ct.dongDieuChinh.ky}
                  </Dong>
                )}
              </Dl>
            </Muc>
          )}

          {/* "Xử lý" đứng TRƯỚC "Lịch sử": ô quyết định là việc người duyệt đến đây để làm; để sau lịch sử thì ở 375px phải cuộn hơn một màn mới tới. */}
          <KhuHanhDong ct={ct} hanhDong={hanhDong} />

          <Muc tieuDe="Lịch sử">
            {/* Lý do của bước "Quyết định" đã in ở khối "Quyết định" phía trên — in lần hai ở đây là lặp. */}
            <AuditTimeline
              muc={ct.lichSu.map((m, i) => ({
                id: `${i}-${m.luc.toISOString()}`,
                luc: m.luc,
                tieuDe: m.hanhDong,
                nguoi: m.nguoi,
                lyDo: m.hanhDong === "Quyết định" && ct.quyetDinh ? null : m.lyDo,
              }))}
            />
          </Muc>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── khối trình bày ───────────────────────────────────────────────────────────────────────────

function Muc({ tieuDe, ghiChu, children }: { tieuDe: string; ghiChu?: string; children: React.ReactNode }) {
  return (
    <section className="px-5 py-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-sm font-semibold text-foreground">{tieuDe}</h3>
        {ghiChu && <span className="text-xs text-muted-foreground">{ghiChu}</span>}
      </div>
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

// ── khu hành động ────────────────────────────────────────────────────────────────────────────

function KhuHanhDong({ ct, hanhDong }: { ct: ChiTietKhieuNai; hanhDong: HanhDongKhieuNai }) {
  const router = useRouter();
  const [dang, batDau] = useTransition();
  const [chung, setChung] = useState<string | null>(null);
  const [nguoiGiao, setNguoiGiao] = useState("");
  const v = ct.viec;
  const coViec = v.nhan || v.nhanLai || v.giao || v.quyet || v.dongDoiNguon;

  function chay(fn: () => Promise<KQ>, thanhCong: string) {
    setChung(null);
    batDau(async () => {
      let r: KQ;
      try {
        r = await fn();
      } catch {
        setChung("Không thực hiện được lúc này. Thử lại sau ít giây.");
        return;
      }
      if (r.ok) {
        toast.success(thanhCong);
        router.refresh();
      } else if (!r.daHienTheoO) {
        setChung(r.chung ?? r.loi[0]?.thongBao ?? "Không thực hiện được.");
      }
    });
  }

  // Không có việc nào cho người này: NÓI vì sao, không vẽ nút.
  if (!coViec) {
    return (
      <Muc tieuDe="Xử lý">
        <p className="text-sm text-muted-foreground">{lyDoKhongViec(ct)}</p>
      </Muc>
    );
  }

  const ungVien = (ct.choQuyet?.ungVienXuLy ?? []).filter((u) => u.id !== ct.nguoiXuLy?.id);
  return (
    <Muc tieuDe="Xử lý">
      {chung && (
        <p role="alert" className="mb-3 text-sm text-state-danger-ink">
          {chung}
        </p>
      )}
      {v.nhan && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Nhận xử lý để bạn là người quyết định khiếu nại này.</p>
          <button type="button" className={BTN_PRIMARY} disabled={dang} onClick={() => chay(() => hanhDong.nhan({ disputeId: ct.id }), "Đã nhận xử lý khiếu nại.")}>
            {dang && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
            Nhận xử lý
          </button>
        </div>
      )}
      {v.nhanLai && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Đang do {ct.nguoiXuLy?.ten ?? "người khác"} xử lý. Chỉ người đang xử lý quyết định được — nhận lại nếu cần.</p>
          <button type="button" className={BTN_OUTLINE} disabled={dang} onClick={() => chay(() => hanhDong.nhan({ disputeId: ct.id }), "Đã nhận lại khiếu nại.")}>
            Nhận lại cho tôi
          </button>
        </div>
      )}
      {v.quyet && <FormQuyet ct={ct} hanhDong={hanhDong} dang={dang} chay={chay} />}
      {v.giao && ungVien.length > 0 && (
        <div className={cn("flex flex-wrap items-end gap-2", v.quyet && "mt-5 border-t border-border pt-4")}>
          <div className="min-w-0 flex-1">
            <label htmlFor="kn-giao" className={NHAN_O}>
              Giao lại cho
            </label>
            <select id="kn-giao" className={O_NHAP} value={nguoiGiao} onChange={(e) => setNguoiGiao(e.target.value)} disabled={dang}>
              <option value="">Chọn người xử lý…</option>
              {ungVien.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.ten}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className={BTN_OUTLINE}
            disabled={dang || nguoiGiao === ""}
            onClick={() => chay(() => hanhDong.nhan({ disputeId: ct.id, nguoiNhanId: nguoiGiao }), "Đã giao lại khiếu nại.")}
          >
            Giao lại
          </button>
        </div>
      )}
      {v.dongDoiNguon && (
        <div className="space-y-2">
          {ct.daCoDongDoiNguon ? (
            <>
              <p className="text-sm text-muted-foreground">Đã thấy dòng điều chỉnh do đổi nguồn. Đóng khiếu nại để báo xong.</p>
              <button type="button" className={BTN_PRIMARY} disabled={dang} onClick={() => chay(() => hanhDong.dong({ disputeId: ct.id }), "Đã đóng khiếu nại.")}>
                Đóng khiếu nại
              </button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Đã duyệt theo cách sửa nguồn nhưng <b className="text-foreground">chưa thấy dòng điều chỉnh do đổi nguồn</b> của khoản thu này. Đổi nguồn ở màn lead rồi quay lại đóng khiếu nại.
            </p>
          )}
        </div>
      )}
    </Muc>
  );
}

/** Vì sao người này không có việc — nói đúng lý do, kèm hỏi ai khi thiếu quyền (DESIGN.md §5). */
function lyDoKhongViec(ct: ChiTietKhieuNai): string {
  switch (ct.ketQua) {
    case "CHO_XU_LY":
      return "Khiếu nại đang chờ HR nhận xử lý. Bạn sẽ nhận thông báo khi có kết quả.";
    case "DANG_XEM_XET":
      return `${ct.nguoiXuLy?.ten ?? "HR"} đang xem xét khiếu nại này.`;
    default:
      return "Khiếu nại đã có kết quả — không còn việc cần xử lý.";
  }
}

// ── form quyết định ──────────────────────────────────────────────────────────────────────────

type Cach = "TIEN" | "DOI_NGUON" | "TU_CHOI";
type Truong = "loai" | "lyDo" | "soTien" | "mauDongId" | "roleCode";

function FormQuyet({
  ct,
  hanhDong,
  dang,
  chay,
}: {
  ct: ChiTietKhieuNai;
  hanhDong: HanhDongKhieuNai;
  dang: boolean;
  chay: (fn: () => Promise<KQ>, thanhCong: string) => void;
}) {
  const laKhoan = ct.dich.loai === "KHOAN";
  const dongCuaKhoan = ct.dich.loai === "KHOAN" ? (ct.dich.dongCuaKhoan ?? []) : [];
  const vai = ct.choQuyet?.vai ?? [];
  const [cach, setCach] = useState<Cach | null>(null);
  const [huong, setHuong] = useState<"CONG" | "TRU">("CONG");
  const [soTien, setSoTien] = useState<number | null>(null);
  const [mauDongId, setMauDongId] = useState(dongCuaKhoan.length === 1 ? dongCuaKhoan[0]!.id : "");
  const [roleCode, setRoleCode] = useState("");
  const [lyDo, setLyDo] = useState("");
  const [loi, setLoi] = useState<Partial<Record<Truong, string>>>({});
  const formRef = useRef<HTMLFormElement>(null);

  // Lỗi hiện cạnh ô và focus nhảy tới ô lỗi đầu tiên (PRD §72).
  const focusLoi = useRef(false);
  useEffect(() => {
    if (focusLoi.current && Object.keys(loi).length > 0) {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], fieldset[aria-invalid="true"] input')?.focus();
    }
    focusLoi.current = false;
  }, [loi]);

  const soDaKy = soTien === null ? null : (huong === "TRU" ? -1 : 1) * soTien;

  function dauVao(): unknown {
    if (cach === "TIEN") return { loai: "DUYET_TIEN", lyDo, soTien: soDaKy ?? 0, mauDongId: laKhoan ? mauDongId : null, roleCode: laKhoan ? roleCode : null };
    if (cach === "DOI_NGUON") return { loai: "DUYET_DOI_NGUON", lyDo };
    if (cach === "TU_CHOI") return { loai: "TU_CHOI", lyDo };
    return { loai: null, lyDo };
  }

  function gui() {
    const kiem = kiemDauVaoQuyet(dauVao());
    const sai: Partial<Record<Truong, string>> = {};
    if (!kiem.ok) for (const l of kiem.loi) sai[l.truong as Truong] = l.thongBao;
    if (cach === "TIEN" && laKhoan) {
      if (!mauDongId) sai.mauDongId = "Chọn một dòng hoa hồng của khoản thu này để lấy ngữ cảnh (đơn, học viên, kỳ hiệu lực).";
      if (!roleCode) sai.roleCode = "Chọn vai mà người khiếu nại lẽ ra được hưởng.";
    }
    setLoi(sai);
    if (Object.keys(sai).length > 0 || !kiem.ok) {
      focusLoi.current = true;
      return;
    }
    chay(async () => {
      const r = await hanhDong.quyet({ disputeId: ct.id, dauVao: kiem.value });
      if (!r.ok) {
        const o: Partial<Record<Truong, string>> = {};
        for (const l of r.loi) o[l.truong as Truong] = l.thongBao;
        if (Object.keys(o).length > 0) {
          setLoi(o);
          focusLoi.current = true;
          return { ...r, daHienTheoO: true };
        }
      }
      return r;
    }, cach === "TU_CHOI" ? "Đã từ chối khiếu nại." : cach === "DOI_NGUON" ? "Đã duyệt — chờ đổi nguồn." : "Đã duyệt và ghi điều chỉnh vào sổ.");
  }

  const nhanNut =
    cach === "TIEN"
      ? soDaKy === null
        ? "Duyệt và ghi điều chỉnh"
        : `Duyệt và ghi ${soDaKy > 0 ? "+" : "−"}${dinhDangDong(Math.abs(soDaKy))} vào kỳ đang mở`
      : cach === "DOI_NGUON"
        ? "Duyệt — sửa nguồn ở màn lead"
        : cach === "TU_CHOI"
          ? "Từ chối khiếu nại"
          : "Chọn cách giải quyết";

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        gui();
      }}
      className="space-y-4"
    >
      <fieldset aria-invalid={loi.loai ? true : undefined} className="space-y-1.5">
        <legend className={NHAN_O}>Cách giải quyết</legend>
        {(
          [
            ["TIEN", "Điều chỉnh tiền", "Ghi thêm một dòng hoa hồng vào kỳ đang mở; dòng gốc giữ nguyên."],
            ["DOI_NGUON", "Sửa nguồn", "Nguồn của lead sai — đổi ở màn lead, hệ thống tự điều chỉnh tiền."],
            ["TU_CHOI", "Từ chối", "Không có căn cứ để điều chỉnh."],
          ] as const
        ).map(([gt, ten, mo]) => (
          <label key={gt} className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm", cach === gt ? "border-primary bg-primary-soft" : "border-border hover:bg-muted/50")}>
            <input type="radio" name="cach" value={gt} checked={cach === gt} onChange={() => { setCach(gt); setLoi({}); }} disabled={dang} className="mt-0.5 h-4 w-4 accent-[color:var(--primary)]" />
            <span className="min-w-0">
              <span className="block font-medium text-foreground">{ten}</span>
              <span className="block text-xs text-muted-foreground">{mo}</span>
            </span>
          </label>
        ))}
        {loi.loai && (
          <p role="alert" className={LOI_O}>
            {loi.loai}
          </p>
        )}
      </fieldset>

      {cach === "TIEN" && (
        <div className="space-y-4">
          {laKhoan && (
            <>
              <fieldset aria-invalid={loi.mauDongId ? true : undefined}>
                <legend className={NHAN_O}>Lấy ngữ cảnh từ dòng</legend>
                {dongCuaKhoan.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Khoản thu này chưa có dòng hoa hồng nào để lấy ngữ cảnh — chưa thể ghi điều chỉnh tiền. Chọn “Từ chối”, hoặc đợi kỳ Tính ghi sổ khoản thu này.</p>
                ) : (
                  <ul className="space-y-1">
                    {dongCuaKhoan.map((d) => (
                      <li key={d.id}>
                        <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
                          <input type="radio" name="mau" value={d.id} checked={mauDongId === d.id} onChange={() => setMauDongId(d.id)} disabled={dang} className="h-4 w-4 accent-[color:var(--primary)]" />
                          <span className="min-w-0 flex-1 truncate">
                            {nhanVai(d.vai)} · {d.nguoiHuong}
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">{dinhDangDong(d.soTien)}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                {loi.mauDongId && (
                  <p role="alert" className={LOI_O}>
                    {loi.mauDongId}
                  </p>
                )}
              </fieldset>
              <div>
                <label htmlFor="kn-vai" className={NHAN_O}>
                  Vai người khiếu nại được hưởng
                </label>
                <select id="kn-vai" className={O_NHAP} value={roleCode} onChange={(e) => setRoleCode(e.target.value)} aria-invalid={loi.roleCode ? true : undefined} disabled={dang}>
                  <option value="">Chọn vai…</option>
                  {vai.map((r) => (
                    <option key={r.code} value={r.code}>
                      {nhanVai(r.code)}
                    </option>
                  ))}
                </select>
                {loi.roleCode && (
                  <p role="alert" className={LOI_O}>
                    {loi.roleCode}
                  </p>
                )}
              </div>
            </>
          )}
          <div>
            <p className={NHAN_O} id="kn-huong">
              Số tiền điều chỉnh
            </p>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby="kn-huong">
              <div className="inline-flex overflow-hidden rounded-lg border border-border">
                {(["CONG", "TRU"] as const).map((h) => (
                  <button
                    key={h}
                    type="button"
                    aria-pressed={huong === h}
                    onClick={() => setHuong(h)}
                    disabled={dang}
                    className={cn("h-9 whitespace-nowrap px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring", h === "TRU" && "border-l border-border", huong === h ? "bg-primary-soft text-primary-ink" : "text-muted-foreground hover:bg-muted")}
                  >
                    {h === "CONG" ? "Cộng thêm" : "Trừ bớt"}
                  </button>
                ))}
              </div>
              <div className="min-w-0 flex-1 basis-40">
                <MoneyInput
                  name="soTien"
                  value={soTien}
                  onValueChange={(n) => {
                    setSoTien(n);
                    if (loi.soTien) setLoi((o) => ({ ...o, soTien: undefined }));
                  }}
                  min={0}
                  className={cn(O_NHAP, "text-right text-base tabular-nums")}
                  aria-label="Số tiền điều chỉnh (đồng)"
                  aria-invalid={loi.soTien ? true : undefined}
                  disabled={dang}
                  placeholder="0"
                />
              </div>
            </div>
            {loi.soTien && (
              <p role="alert" className={LOI_O}>
                {loi.soTien}
              </p>
            )}
            {huong === "TRU" && <p className="mt-1 text-xs text-muted-foreground">Trừ bớt = đòi lại; không vượt số hoa hồng đã ghi của người này ở ô tính.</p>}
          </div>
        </div>
      )}

      <div>
        <label htmlFor="kn-ly-do" className={NHAN_O}>
          Lý do quyết định
        </label>
        <textarea
          id="kn-ly-do"
          className={TEXTAREA}
          rows={3}
          maxLength={LY_DO_KHIEU_NAI_TOI_DA}
          value={lyDo}
          onChange={(e) => {
            setLyDo(e.target.value);
            if (loi.lyDo) setLoi((o) => ({ ...o, lyDo: undefined }));
          }}
          aria-invalid={loi.lyDo ? true : undefined}
          disabled={dang}
          placeholder="Căn cứ của quyết định — người khiếu nại sẽ đọc được."
        />
        {loi.lyDo ? (
          <p role="alert" className={LOI_O}>
            {loi.lyDo}
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">Bắt buộc, ít nhất {LY_DO_TOI_THIEU} ký tự. Đừng ghi số tiền hay số điện thoại — thông báo gửi người khiếu nại sẽ bỏ phần lý do nếu có.</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={cn(BTN_PRIMARY, "h-10", "disabled:border disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100")} disabled={dang || cach === null}>
          {dang && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
          {nhanNut}
        </button>
      </div>
    </form>
  );
}
