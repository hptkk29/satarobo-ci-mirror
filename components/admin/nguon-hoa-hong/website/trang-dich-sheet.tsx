"use client";

// components/admin/nguon-hoa-hong/website/trang-dich-sheet.tsx — Sheet «Trang đích» của MỘT website: tổng quan (tên miền · theo dõi · campaign đang dùng) + danh sách trang đích (tên miền + đường dẫn)
// + thêm / sửa / bật-tắt / bật-tắt theo dõi + «Thử một địa chỉ».
//
// Ai cũng mở được Sheet này để XEM và THỬ địa chỉ (quyền xem tab); các nút GHI (thêm · sửa · bật/tắt) chỉ vẽ khi `coTheGhi` — nơi gọi truyền `scope.has("affiliate_campaigns:manage")`, ĐÚNG khoá mà
// Server Action kiểm (luật 12: không vẽ nút mà máy chủ sẽ từ chối).
//
// Luật mẫu đường dẫn là `kiemMauTrangDich` → `chuanHoaDuongDanMau` (lib/affiliate) — CÙNG hàm với máy chủ. Trang đích KHÔNG xoá, chỉ bật/tắt: link đã phát có thể đang trỏ vào nó.
//
// ── AFF-L6 · đa tên miền ──────────────────────────────────────────────────────────────────────────────────────
// Một website có NHIỀU tên miền (`allowedDomains`) mà gốc URL chỉ là MỘT. Trang đích chọn được TÊN MIỀN trong danh sách đó (ô chọn — không nhập tự do); «mặc định» = tên miền của gốc URL. Không có
// wildcard: `covua.quatang.edu.vn` phải được liệt kê riêng. Thao tác làm CHẾT link đang chạy (tắt · đổi tên miền / đường dẫn · tắt theo dõi) báo SỐ LINK bị ảnh hưởng ngay sau khi lưu (máy chủ đếm).
//
// Dữ liệu (kể cả mốc khoá lạc quan `capNhatLuc` của từng dòng) lấy từ `website` — nơi gọi đọc lại từ props mới sau `router.refresh()`, nên hai lần bấm liên tiếp không dùng mốc cũ:
// mọi nút khoá trong lúc lưu và cho tới khi trang tải lại xong (`useTransition`).
//
// Hàm gọi máy chủ được TIÊM (`them`, `sua`, `batTat`) — mặc định là Server Action; test dựng bằng hàm giả.
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { batTatTrangDichAction, suaTrangDichAction, themTrangDichAction } from "@/app/(admin)/admin/nguon-hoa-hong/website/_actions";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { DongTrangDich, DongWebsite } from "@/lib/affiliate/doc-website";
import type { KetQuaBatTatTrangDich, KetQuaTrangDich } from "@/lib/affiliate/ghi-website";
import { DO_DAI_NHAN_TOI_DA, NHAN_TRANG_THAI_WEBSITE, kiemMauTrangDich } from "@/lib/affiliate/ghi-website-dau-vao";
import { hostCuaBaseUrl } from "@/lib/affiliate/website-hop-le";
import { cn } from "@/lib/utils";
import { BTN_OUTLINE, BTN_PRIMARY, LOI_O, NHAN_O, NUT_NHO, O_NHAP } from "../classes";
import { ThuUrl } from "./thu-url";

type VaoThem = { siteId: string; host: string | null; pathPattern: string; label: string | null };
type VaoSua = { host?: string | null; pathPattern?: string; label?: string | null; trackingEnabled?: boolean };
type Them = (vao: VaoThem) => Promise<KetQuaTrangDich>;
type Sua = (i: { id: string; updatedAtDaThay: string; vao: VaoSua; lyDo: string | null }) => Promise<KetQuaTrangDich>;
type BatTat = (i: { id: string; updatedAtDaThay: string; den: boolean; lyDo: string | null }) => Promise<KetQuaBatTatTrangDich>;
const THEM_MAC_DINH: Them = (vao) => themTrangDichAction({ vao });
const SUA_MAC_DINH: Sua = (i) => suaTrangDichAction(i);
const BAT_TAT_MAC_DINH: BatTat = (i) => batTatTrangDichAction(i);

type Banner = { text: string; vuaDoi: boolean };

/** Câu báo sau khi lưu: nói thẳng nếu thao tác làm chết link đang chạy. */
const cauAnhHuong = (n: number): string => (n > 0 ? ` Lưu ý: ${n} link đang hoạt động trên trang đích này không còn hiệu lực.` : "");

/** Tên miền chọn được cho trang đích của một website: gốc URL (mặc định, giá trị rỗng) rồi các tên miền còn lại trong danh sách. */
export function tuyChonTenMien(w: Pick<DongWebsite, "baseUrl" | "allowedDomains">): { gia: string; nhan: string }[] {
  const goc = hostCuaBaseUrl(w.baseUrl);
  const ra: { gia: string; nhan: string }[] = [];
  if (goc !== null) ra.push({ gia: "", nhan: `${goc} (mặc định — gốc URL)` });
  for (const d of w.allowedDomains) if (d !== goc) ra.push({ gia: d, nhan: d });
  return ra;
}

export function TrangDichSheet({
  website,
  coTheGhi,
  dong,
  them = THEM_MAC_DINH,
  sua = SUA_MAC_DINH,
  batTat = BAT_TAT_MAC_DINH,
}: {
  website: DongWebsite;
  /** Người xem được GHI trang đích không (`affiliate_campaigns:manage` ∧ cờ Affiliate bật). Page tính, Sheet không đoán (luật 7: bắt buộc). */
  coTheGhi: boolean;
  dong: () => void;
  them?: Them;
  sua?: Sua;
  batTat?: BatTat;
}) {
  const router = useRouter();
  const id = useId();
  const [dangChoTai, batDauTai] = useTransition();
  const [dangLuu, setDangLuu] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [suaId, setSuaId] = useState<string | null>(null);

  const [mau, setMau] = useState("");
  const [nhan, setNhan] = useState("");
  const [host, setHost] = useState("");
  const [loiMau, setLoiMau] = useState<string | null>(null);

  const ban = dangLuu || dangChoTai;
  const lamMoi = () => batDauTai(() => router.refresh());
  const bao = (r: { ok: false; loi: string; truong?: string }): Banner => ({ text: r.loi, vuaDoi: r.truong === "vuaDoi" });
  const tenMien = tuyChonTenMien(website);
  const nhieuTenMien = tenMien.length > 1;

  async function themMoi() {
    if (ban) return;
    setBanner(null);
    const k = kiemMauTrangDich(mau);
    if (!k.ok) {
      setLoiMau(k.loi);
      document.getElementById(`${id}-mau`)?.focus();
      return;
    }
    setLoiMau(null);
    setDangLuu(true);
    let r: KetQuaTrangDich;
    try {
      r = await them({ siteId: website.id, host: host === "" ? null : host, pathPattern: k.mau, label: nhan.trim() === "" ? null : nhan.trim() });
    } catch {
      r = { ok: false, loi: "Không lưu được lúc này. Thử lại sau ít giây." };
    }
    setDangLuu(false);
    if (!r.ok) {
      if (r.truong === "pathPattern") setLoiMau(r.loi);
      else setBanner(bao(r));
      return;
    }
    toast.success(`Đã thêm trang đích ${k.mau}.`);
    setMau("");
    setNhan("");
    setHost("");
    lamMoi();
  }

  async function batTatMot(t: DongTrangDich, den: boolean) {
    if (ban) return;
    setBanner(null);
    setDangLuu(true);
    let r: KetQuaBatTatTrangDich;
    try {
      r = await batTat({ id: t.id, updatedAtDaThay: t.capNhatLuc, den, lyDo: null });
    } catch {
      r = { ok: false, loi: "Không lưu được lúc này. Thử lại sau ít giây." };
    }
    setDangLuu(false);
    if (!r.ok) {
      setBanner(bao(r));
      return;
    }
    toast.success(`${den ? "Đã bật" : "Đã tắt"} trang đích ${t.pathPattern}.${cauAnhHuong(r.soLinkAnhHuong ?? 0)}`);
    lamMoi();
  }

  async function doiTheoDoi(t: DongTrangDich) {
    if (ban) return;
    setBanner(null);
    setDangLuu(true);
    let r: KetQuaTrangDich;
    try {
      r = await sua({ id: t.id, updatedAtDaThay: t.capNhatLuc, vao: { trackingEnabled: !t.trackingEnabled }, lyDo: null });
    } catch {
      r = { ok: false, loi: "Không lưu được lúc này. Thử lại sau ít giây." };
    }
    setDangLuu(false);
    if (!r.ok) {
      setBanner(bao(r));
      return;
    }
    toast.success(`${t.trackingEnabled ? "Đã tắt" : "Đã bật"} theo dõi trang đích ${t.pathPattern}.${cauAnhHuong(r.soLinkAnhHuong ?? 0)}`);
    lamMoi();
  }

  return (
    <Sheet open onOpenChange={(m) => !m && !dangLuu && dong()}>
      <SheetContent className="admin-scope w-full gap-0 overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border p-5 pr-12">
          <SheetTitle className="text-base font-semibold">Trang đích — {website.name}</SheetTitle>
          <SheetDescription render={<div />} className="space-y-1">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs">{website.code}</span>
              <StatusPill tone={website.status === "ACTIVE" ? "success" : "muted"}>{NHAN_TRANG_THAI_WEBSITE[website.status]}</StatusPill>
              <span className="break-all font-mono text-xs">{website.baseUrl}</span>
            </p>
            <p className="text-sm">Link giới thiệu chỉ trỏ được tới các tên miền + đường dẫn đang bật dưới đây.</p>
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 p-5">
          {website.status !== "ACTIVE" && (
            <p role="note" className="rounded-lg bg-state-warning-soft px-3 py-2.5 text-sm text-state-warning-ink">
              Website đang ngừng — không địa chỉ nào dùng được cho tới khi bật lại. Bạn vẫn chuẩn bị trang đích được.
            </p>
          )}

          {/* Tổng quan website (AFF-WEB): tên miền · theo dõi · campaign đang dùng · trang đích. CHỈ ĐỌC — sửa tên miền / theo dõi ở «Sửa website», gắn campaign ở màn Campaign. */}
          <dl data-tong-quan-website className="grid gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tên miền được phép</dt>
              <dd className="mt-0.5 space-y-0.5">
                {website.allowedDomains.map((m) => (
                  <span key={m} className="block break-all font-mono text-xs text-foreground">
                    {m}
                  </span>
                ))}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Trạng thái theo dõi</dt>
              <dd className="mt-0.5">
                {website.trackingEnabled ? (
                  <StatusPill tone="success" className="text-state-success-ink">
                    Bật theo dõi
                  </StatusPill>
                ) : (
                  <StatusPill tone="muted">Tắt theo dõi</StatusPill>
                )}
                {!website.trackingEnabled && <span className="mt-1 block text-xs text-muted-foreground">Lượt bấm mới bị chặn; lịch sử giữ nguyên.</span>}
              </dd>
            </div>
            <div className="min-w-0 sm:col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Campaign đang dùng</dt>
              <dd className="mt-0.5">
                {website.campaigns.length === 0 ? (
                  <span className="text-muted-foreground">Chưa gắn campaign nào</span>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {website.campaigns.map((c) => (
                      <li key={c.id} className="rounded-full border border-border bg-card px-2 py-0.5 text-xs text-foreground" title={`${c.code} · ${c.status}`}>
                        {c.name}
                        <span className="ml-1 font-mono text-muted-foreground">{c.code}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Trang đích</dt>
              <dd className="mt-0.5 tabular-nums">
                {website.trangDich.filter((t) => t.isActive).length} đang bật / {website.trangDich.length} trang
              </dd>
            </div>
          </dl>

          {banner && (
            <div role="alert" className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg bg-state-danger-soft px-3 py-2.5 text-sm text-state-danger-ink">
              <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="min-w-0 flex-1">{banner.text}</p>
              {banner.vuaDoi && (
                <button
                  type="button"
                  onClick={() => {
                    setBanner(null);
                    setSuaId(null);
                    lamMoi();
                  }}
                  className={cn(BTN_OUTLINE, NUT_NHO)}
                >
                  Tải lại
                </button>
              )}
            </div>
          )}

          <section aria-labelledby={`${id}-ds`}>
            <h3 id={`${id}-ds`} className="mb-2 text-sm font-semibold text-foreground">
              Trang đích ({website.trangDich.filter((t) => t.isActive).length} đang bật / {website.trangDich.length})
            </h3>
            {website.trangDich.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                Chưa có trang đích nào — chưa ai tạo được link giới thiệu cho website này.
                {coTheGhi ? " Thêm đường dẫn đầu tiên ở bên dưới." : " Nhờ người có quyền quản lý website thêm giúp."}
              </p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {website.trangDich.map((t) =>
                  suaId === t.id && coTheGhi ? (
                    <DongSua
                      key={t.id}
                      trang={t}
                      tenMien={tenMien}
                      ban={ban}
                      huy={() => setSuaId(null)}
                      luu={async (vao) => {
                        setBanner(null);
                        setDangLuu(true);
                        let r: KetQuaTrangDich;
                        try {
                          r = await sua({ id: t.id, updatedAtDaThay: t.capNhatLuc, vao, lyDo: null });
                        } catch {
                          r = { ok: false, loi: "Không lưu được lúc này. Thử lại sau ít giây." };
                        }
                        setDangLuu(false);
                        if (!r.ok) {
                          // Lỗi của ô đường dẫn nằm CẠNH ô (DongSua); mọi lỗi khác (vừa bị đổi, không tìm thấy…) là banner.
                          if (r.truong !== "pathPattern") setBanner(bao(r));
                          return r;
                        }
                        toast.success(`Đã lưu trang đích.${cauAnhHuong(r.soLinkAnhHuong ?? 0)}`);
                        setSuaId(null);
                        lamMoi();
                        return r;
                      }}
                    />
                  ) : (
                    <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                      <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                        <p className="break-all font-mono text-sm text-foreground">
                          <span className="text-muted-foreground">{t.hostGiai}</span>
                          {t.pathPattern}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t.label ? `${t.label} · ` : ""}
                          {t.pathPattern.endsWith("/*") ? "Mọi trang dưới đường dẫn này" : "Đúng một trang"}
                          {t.soLinkDangChay > 0 ? ` · ${t.soLinkDangChay} link đang chạy` : ""}
                        </p>
                      </div>
                      <StatusPill tone={t.isActive ? "success" : "muted"}>{t.isActive ? "Đang bật" : "Đã tắt"}</StatusPill>
                      <StatusPill tone={t.trackingEnabled ? "success" : "warning"}>{t.trackingEnabled ? "Theo dõi bật" : "Theo dõi tắt"}</StatusPill>
                      {coTheGhi && (
                        <span className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            disabled={ban}
                            onClick={() => setSuaId(t.id)}
                            aria-label={`Sửa trang đích ${t.pathPattern}`}
                            title="Sửa trang đích"
                            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 md:h-8 md:w-8"
                          >
                            <Pencil aria-hidden className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={ban}
                            onClick={() => void batTatMot(t, !t.isActive)}
                            aria-label={`${t.isActive ? "Tắt" : "Bật"} trang đích ${t.pathPattern}`}
                            className={cn(BTN_OUTLINE, NUT_NHO)}
                          >
                            {t.isActive ? "Tắt" : "Bật"}
                          </button>
                          <button
                            type="button"
                            disabled={ban}
                            onClick={() => void doiTheoDoi(t)}
                            aria-label={`${t.trackingEnabled ? "Tắt" : "Bật"} theo dõi trang đích ${t.pathPattern}`}
                            className={cn(BTN_OUTLINE, NUT_NHO)}
                          >
                            {t.trackingEnabled ? "Tắt theo dõi" : "Bật theo dõi"}
                          </button>
                        </span>
                      )}
                    </li>
                  ),
                )}
              </ul>
            )}
          </section>

          {coTheGhi && (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void themMoi();
              }}
              aria-labelledby={`${id}-them`}
              className="rounded-xl border border-border bg-card p-4"
            >
              <h3 id={`${id}-them`} className="text-sm font-semibold text-foreground">
                Thêm trang đích
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Đường dẫn đúng như <span className="font-mono">/khoa-robotics</span>, hoặc tiền tố kết thúc bằng <span className="font-mono">/*</span> như <span className="font-mono">/khoa-hoc/*</span> (mọi trang dưới{" "}
                <span className="font-mono">/khoa-hoc</span>). Không kèm dấu ? hay #.
                {nhieuTenMien ? " Website có nhiều tên miền: chọn tên miền của trang đích (khớp chính xác, không có ký tự đại diện)." : ""}
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr] sm:items-start">
                {nhieuTenMien && (
                  <div className="sm:col-span-2">
                    <label htmlFor={`${id}-host`} className={NHAN_O}>
                      Tên miền
                    </label>
                    <select id={`${id}-host`} value={host} disabled={ban} onChange={(e) => setHost(e.target.value)} className={cn(O_NHAP, "font-mono")}>
                      {tenMien.map((o) => (
                        <option key={o.gia} value={o.gia}>
                          {o.nhan}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label htmlFor={`${id}-mau`} className={NHAN_O}>
                    Đường dẫn
                  </label>
                  <input
                    id={`${id}-mau`}
                    type="text"
                    inputMode="url"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={mau}
                    maxLength={200}
                    placeholder="Ví dụ: /khoa-hoc/*"
                    disabled={ban}
                    onChange={(e) => {
                      setMau(e.target.value);
                      setLoiMau(null);
                    }}
                    aria-invalid={loiMau ? true : undefined}
                    aria-describedby={loiMau ? `${id}-mau-loi` : undefined}
                    className={cn(O_NHAP, "font-mono")}
                  />
                  {loiMau && (
                    <p id={`${id}-mau-loi`} role="alert" className={LOI_O}>
                      {loiMau}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor={`${id}-nhan`} className={NHAN_O}>
                    Nhãn (tuỳ chọn)
                  </label>
                  <input
                    id={`${id}-nhan`}
                    type="text"
                    autoComplete="off"
                    value={nhan}
                    maxLength={DO_DAI_NHAN_TOI_DA + 20}
                    disabled={ban}
                    onChange={(e) => setNhan(e.target.value)}
                    className={O_NHAP}
                  />
                </div>
                <div className="sm:col-span-2 flex justify-end">
                  <button type="submit" disabled={ban} className={cn(BTN_PRIMARY)}>
                    {ban ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Plus aria-hidden className="h-4 w-4" />}
                    Thêm
                  </button>
                </div>
              </div>
            </form>
          )}

          <ThuUrl
            site={{ allowedDomains: website.allowedDomains, status: website.status, trackingEnabled: website.trackingEnabled }}
            trangDich={website.trangDich.map((t) => ({ pathPattern: t.pathPattern, isActive: t.isActive, host: t.hostGiai, trackingEnabled: t.trackingEnabled }))}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Một dòng đang sửa tại chỗ: tên miền + đường dẫn + nhãn, Lưu/Huỷ. Chỉ gửi trường THẬT SỰ đổi. */
function DongSua({
  trang,
  tenMien,
  ban,
  huy,
  luu,
}: {
  trang: DongTrangDich;
  tenMien: { gia: string; nhan: string }[];
  ban: boolean;
  huy: () => void;
  luu: (vao: VaoSua) => Promise<{ ok: true } | { ok: false; loi: string; truong?: string }>;
}) {
  const id = useId();
  const [mau, setMau] = useState(trang.pathPattern);
  const [nhan, setNhan] = useState(trang.label ?? "");
  const [host, setHost] = useState(trang.host ?? "");
  const [loi, setLoi] = useState<string | null>(null);

  const doiMau = mau.trim() !== trang.pathPattern;
  const doiNhan = (nhan.trim() === "" ? null : nhan.trim()) !== trang.label;
  const doiHost = host !== (trang.host ?? "");

  async function xong() {
    if (!doiMau && !doiNhan && !doiHost) {
      huy();
      return;
    }
    const vao: VaoSua = {};
    if (doiMau) {
      const k = kiemMauTrangDich(mau);
      if (!k.ok) {
        setLoi(k.loi);
        return;
      }
      vao.pathPattern = k.mau;
    }
    if (doiNhan) vao.label = nhan.trim() === "" ? null : nhan.trim();
    if (doiHost) vao.host = host === "" ? null : host;
    const r = await luu(vao);
    if (!r.ok && r.truong === "pathPattern") setLoi(r.loi);
  }

  return (
    <li className="space-y-3 bg-muted/30 px-4 py-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {tenMien.length > 1 && (
          <div className="sm:col-span-2">
            <label htmlFor={`${id}-host`} className={NHAN_O}>
              Tên miền đang sửa
            </label>
            <select id={`${id}-host`} value={host} disabled={ban} onChange={(e) => setHost(e.target.value)} className={cn(O_NHAP, "font-mono")}>
              {tenMien.map((o) => (
                <option key={o.gia} value={o.gia}>
                  {o.nhan}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor={`${id}-mau`} className={NHAN_O}>
            Đường dẫn đang sửa
          </label>
          <input
            id={`${id}-mau`}
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={mau}
            maxLength={200}
            disabled={ban}
            onChange={(e) => {
              setMau(e.target.value);
              setLoi(null);
            }}
            aria-invalid={loi ? true : undefined}
            aria-describedby={loi ? `${id}-loi` : undefined}
            className={cn(O_NHAP, "font-mono")}
          />
        </div>
        <div>
          <label htmlFor={`${id}-nhan`} className={NHAN_O}>
            Nhãn
          </label>
          <input id={`${id}-nhan`} type="text" autoComplete="off" value={nhan} maxLength={DO_DAI_NHAN_TOI_DA + 20} disabled={ban} onChange={(e) => setNhan(e.target.value)} className={O_NHAP} />
        </div>
      </div>
      {loi && (
        <p id={`${id}-loi`} role="alert" className={LOI_O}>
          {loi}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={huy} disabled={ban} className={cn(BTN_OUTLINE, NUT_NHO)}>
          Huỷ
        </button>
        <button type="button" onClick={() => void xong()} disabled={ban} className={cn(BTN_PRIMARY, NUT_NHO)}>
          Lưu
        </button>
      </div>
    </li>
  );
}
