"use client";

// TRÌNH SOẠN chính sách hoa hồng — builder 7 bước (06 §5.2, PRD §55): Bối cảnh → Người hưởng → Cách tính → Văn bản → Hiệu lực →
// Thử tính → Kích hoạt. Một trang đầy đủ (không Sheet): có cấu hình dài, có thanh điều kiện cố định bên cạnh.
//
// Nguyên tắc:
//   · MỌI luật kiểm nằm ở `lib/hoa-hong/chinh-sach-form.ts` (client và Server Action dùng chung) — component chỉ vẽ + điều hướng.
//   · "Tiếp" chỉ đi khi bước hiện tại hợp lệ; lỗi hiện CẠNH Ô, cuộn + focus ô lỗi đầu tiên; lỗi máy chủ về đúng ô; DỮ LIỆU GIỮ NGUYÊN
//     khi máy chủ từ chối (state không bao giờ bị reset bởi một lần lưu hỏng).
//   · Thanh điều kiện kích hoạt hiển thị kết quả của MÁY CHỦ trên bản nháp ĐÃ LƯU — chưa lưu thì "chưa kiểm", không bao giờ ✓.
//   · Phiên bản đã kích hoạt/đã dùng: mọi ô chỉ đọc (`<fieldset disabled>`), nút chính đổi thành "Tạo phiên bản mới".
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, Loader2, Lock, Save } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { BTN_OUTLINE, BTN_PRIMARY } from "@/components/admin/nguon-hoa-hong/classes";
import { HangRaoBar } from "@/components/admin/nguon-hoa-hong/hang-rao-bar";
import { StickyActionBar } from "@/components/admin/nguon-hoa-hong/sticky-action-bar";
import { Stepper } from "@/components/admin/nguon-hoa-hong/stepper";
import {
  BUOC,
  buocCuaTruong,
  kiemForm,
  loiLuuNhap,
  loiTheoBuoc,
  NHAN_BUOC,
  type BuocKey,
  type FormChinhSach,
  type LoiO,
} from "@/lib/hoa-hong/chinh-sach-form";
import { dungHangRao, quyetDinhNutKichHoat, type KetQuaKiemHangRao } from "@/lib/hoa-hong/hang-rao-ui";
import { quyetDinhNutThuTinh, tomTatTacDong, tuoiKetQua, type ThamSoThuTinh, type TrangThaiThuTinh } from "@/lib/hoa-hong/mo-phong-ui";

import { huyNhapAction, kichHoatAction, kiemHangRaoAction, luuNhapAction, thuTinhAction } from "../_actions";
import { BuocCachTinh, BuocBoiCanh, BuocHieuLuc, BuocNguoiHuong, BuocThuTinh, BuocVanBan } from "./cac-buoc";
import { BuocKichHoat, KichHoatDialog, tomTatForm } from "./buoc-kich-hoat";
import type { DuLieuSoanClient, PropsBuoc, VanBanLuaChon } from "./kieu-soan";
import { ThuTinhThat, type ThamNhapThuTinh } from "./thu-tinh-that";

export type CheDoSoan = "tao-moi" | "sua-nhap" | "version-moi";

export type PropsTrinhSoan = {
  cheDo: CheDoSoan;
  policyId: string | null;
  /** Bản nháp đã lưu (sửa nháp) — `null` khi chưa có gì trong DB. */
  luuDau: { versionId: string; versionNo: number; updatedAt: string } | null;
  formDau: FormChinhSach;
  dl: DuLieuSoanClient;
  coQuyenKichHoat: boolean;
  /** Có quyền quản lý nguồn (`sources:manage`) không — quyết liên kết «bật ở cấu hình nguồn» ở bước Bối cảnh. BẮT BUỘC (luật 7). */
  coQuyenQuanLyNguon: boolean;
  /**
   * Người xem có quyền SỬA ô «Trần tổng hoa hồng» (`settings:edit` — ĐÚNG khoá mà action lưu cấu hình hỏi) không. Quyết liên kết «Mở Cấu hình vận hành để nâng trần» ở thanh điều kiện,
   * bước Kích hoạt và Thử tính. BẮT BUỘC, không mặc định (luật 7). Trình soạn KHÔNG có nút tự nâng trần: sửa trần là thao tác có lý do + nhật ký ở màn Cấu hình vận hành.
   */
  coQuyenSuaTran: boolean;
  /** Có ⇒ chỉ đọc. */
  khoa: { lyDo: string } | null;
  hangRaoDau: KetQuaKiemHangRao | null;
  buocDau: BuocKey;
  /** Có quyền soạn (lưu/huỷ) không. Không quyền ⇒ chỉ đọc dù phiên bản là nháp. */
  coQuyenSoan: boolean;
  /**
   * Bước "Thử tính" trên dữ liệu thật. `coQuyen` = ĐÚNG key mà `thuTinhAction` hỏi (`commission_policies:manage`) — TÁCH khỏi `coQuyenSoan` (manage ∧ ghi được cho chủ
   * sở hữu): người chỉ đọc được chính sách của Hội sở vẫn chạy thử được, vì thử tính không ghi gì. `khoangMacDinh` do máy chủ tính (client không đọc đồng hồ).
   */
  thuTinh: { coQuyen: boolean; khoangMacDinh: { tuNgay: string; denNgay: string } };
};

type LoiMayChu = { loi: LoiO; snap: string };

/** Giá trị hiện tại của một trường theo khoá `truong` — để biết lỗi máy chủ còn đúng với giá trị đang gõ không. */
function giaTriTruong(f: FormChinhSach, truong: string): string {
  if (truong === "chuSoHuu") return JSON.stringify(f.chuSoHuuOrgUnitId);
  const phan = truong.split(".");
  let cur: unknown = f;
  for (const p of phan) {
    if (cur === null || typeof cur !== "object") return JSON.stringify(null);
    cur = (cur as Record<string, unknown>)[p];
  }
  return JSON.stringify(cur ?? null);
}

const dinhDangGio = (iso: string) => new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });

export function TrinhSoan(p: PropsTrinhSoan) {
  const router = useRouter();
  const vungRef = useRef<HTMLDivElement | null>(null);
  const [dangLuu, batDauLuu] = useTransition();
  const [dangKiem, batDauKiem] = useTransition();
  const [dangKichHoat, batDauKichHoat] = useTransition();

  const [form, setForm] = useState<FormChinhSach>(p.formDau);
  const [buoc, setBuoc] = useState<BuocKey>(p.buocDau);
  const [daDi, setDaDi] = useState<ReadonlySet<BuocKey>>(new Set());
  const [buocHienLoi, setBuocHienLoi] = useState<ReadonlySet<BuocKey>>(new Set());
  const [loiMayChu, setLoiMayChu] = useState<LoiMayChu[]>([]);
  const [chung, setChung] = useState<string | null>(null);
  const [luu, setLuu] = useState(p.luuDau);
  const [policyId, setPolicyId] = useState(p.policyId);
  const [anhChup, setAnhChup] = useState<string | null>(p.luuDau ? JSON.stringify(p.formDau) : null);
  const [hangRaoKq, setHangRaoKq] = useState<KetQuaKiemHangRao | null>(p.hangRaoDau);
  const [vanBanThem, setVanBanThem] = useState<VanBanLuaChon[]>([]);
  const [moHop, setMoHop] = useState(false);
  const [moHopHuy, setMoHopHuy] = useState(false);
  const [lyDoXacNhan, setLyDoXacNhan] = useState("");
  const [loiHop, setLoiHop] = useState<string | null>(null);
  const [yeuCauFocus, setYeuCauFocus] = useState<{ truong: string; n: number } | null>(null);
  const [thu, setThu] = useState<TrangThaiThuTinh>({ kieu: "chua" });
  const [thamThu, setThamThu] = useState<ThamNhapThuTinh>({ ...p.thuTinh.khoangMacDinh, orgUnitId: "" });

  // `khoa` = các ô nhập bị khoá (phiên bản không còn là nháp, HOẶC người xem không có quyền soạn). `laBanNhap` chỉ nói về PHIÊN BẢN:
  // BLĐ có `activate` mà không có `manage` vẫn kích hoạt được một bản nháp đã đủ điều kiện, dù không sửa được nó.
  const khoa = p.khoa !== null || !p.coQuyenSoan;
  const laBanNhap = p.khoa === null;
  const khoaDinhDanh = policyId !== null;
  const [, batDauThu] = useTransition();
  const chiSo = BUOC.indexOf(buoc);
  const dirty = luu !== null && anhChup !== null && JSON.stringify(form) !== anhChup;

  // ── Cảnh báo rời trang khi có thay đổi chưa lưu ──
  useEffect(() => {
    if (khoa || (luu === null ? JSON.stringify(form) === JSON.stringify(p.formDau) : !dirty)) return;
    const f = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, [khoa, luu, dirty, form, p.formDau]);

  // ── Lỗi hiển thị ──
  const loiBuoc = useMemo(() => (khoa ? [] : kiemForm(form)), [form, khoa]);
  const loiHienThi = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of loiBuoc) if (buocHienLoi.has(l.buoc) && !m.has(l.truong)) m.set(l.truong, l.thongBao);
    // Lỗi máy chủ chỉ còn hiệu lực chừng nào GIÁ TRỊ của ô chưa bị sửa (sửa ô là người gõ đã phản hồi lỗi).
    for (const s of loiMayChu) if (giaTriTruong(form, s.loi.truong) === s.snap && !m.has(s.loi.truong)) m.set(s.loi.truong, s.loi.thongBao);
    return m;
  }, [loiBuoc, buocHienLoi, loiMayChu, form]);
  const loi = useCallback((truong: string) => loiHienThi.get(truong) ?? null, [loiHienThi]);
  const buocCoLoi = useMemo(() => new Set([...loiHienThi.keys()].map(buocCuaTruong)), [loiHienThi]);
  const buocDaXong = useMemo(() => new Set(BUOC.filter((b) => daDi.has(b) && !loiBuoc.some((l) => l.buoc === b))), [daDi, loiBuoc]);

  const dat = useCallback((patch: Partial<FormChinhSach>) => setForm((f) => ({ ...f, ...patch })), []);

  // ── Chuyển bước: focus sang tiêu đề bước mới ──
  // Trình đọc màn hình đọc "Bước N/7: …" và người dùng bàn phím không giữ nguyên vị trí giữa nội dung bước cũ. KHÔNG chạy lúc mới mở trang
  // (so với bước đã thấy lần trước, không phải cờ "lần đầu" — StrictMode chạy effect hai lần). Khai báo TRƯỚC effect focus ô lỗi: cùng một lượt
  // render mà có cả hai thì ô lỗi chạy sau và thắng.
  const buocDaThay = useRef(buoc);
  useEffect(() => {
    if (buocDaThay.current === buoc) return;
    buocDaThay.current = buoc;
    document.getElementById("buoc-tieu-de")?.focus();
  }, [buoc]);

  // ── Focus ô lỗi ──
  useEffect(() => {
    if (!yeuCauFocus) return;
    const el = Array.from(vungRef.current?.querySelectorAll<HTMLElement>("[data-truong]") ?? []).find((e) => e.getAttribute("data-truong") === yeuCauFocus.truong);
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.focus({ preventScroll: true });
    }
  }, [yeuCauFocus]);
  const focusTruong = (truong: string) => setYeuCauFocus((c) => ({ truong, n: (c?.n ?? 0) + 1 }));

  const hienLoiCuaBuoc = (b: BuocKey) => setBuocHienLoi((s) => new Set([...s, b]));
  const diDen = (b: BuocKey) => {
    setDaDi((s) => new Set([...s, buoc]));
    setBuoc(b);
  };

  /** Đi tiến từ bước hiện tại tới `dich`: dừng ở BƯỚC ĐẦU TIÊN còn lỗi, hiện lỗi + focus. */
  function diTien(dich: BuocKey) {
    if (khoa) return diDen(dich);
    for (let i = chiSo; i < BUOC.indexOf(dich); i++) {
      const b = BUOC[i]!;
      const l = loiTheoBuoc(form, b);
      if (l.length > 0) {
        hienLoiCuaBuoc(b);
        if (b !== buoc) diDen(b);
        focusTruong(l[0]!.truong);
        return;
      }
    }
    diDen(dich);
  }

  const chonBuoc = (b: BuocKey) => (BUOC.indexOf(b) <= chiSo ? diDen(b) : diTien(b));
  const tiep = () => diTien(BUOC[Math.min(chiSo + 1, BUOC.length - 1)]!);
  const lui = () => diDen(BUOC[Math.max(chiSo - 1, 0)]!);

  // ── Lưu nháp ──
  function luuNhap() {
    setChung(null);
    const l = loiLuuNhap(form);
    if (l.length > 0) {
      for (const x of l) hienLoiCuaBuoc(x.buoc);
      if (l[0]!.buoc !== buoc) diDen(l[0]!.buoc);
      focusTruong(l[0]!.truong);
      return;
    }
    batDauLuu(async () => {
      const r = await luuNhapAction({ form, policyId, versionId: luu?.versionId ?? null, updatedAtDaThay: luu?.updatedAt ?? null });
      if (r.ok) {
        // Văn bản vừa tạo thành văn bản "đã có": lần Lưu kế KHÔNG được tạo lại.
        let sau = form;
        if (form.vanBan.kieu === "moi" && r.vanBanId) {
          const v = form.vanBan;
          setVanBanThem((x) => [...x, { id: r.vanBanId!, documentCode: v.documentCode, title: v.title, publishedOn: v.publishedOn, coTep: v.tep !== null, daThuHoi: false }]);
          sau = { ...form, vanBan: { kieu: "co-san", id: r.vanBanId } };
          setForm(sau);
        }
        const dauTien = luu === null;
        setLuu({ versionId: r.versionId, versionNo: r.versionNo, updatedAt: r.updatedAt });
        setPolicyId(r.policyId);
        setAnhChup(JSON.stringify(sau));
        setHangRaoKq(r.hangRao);
        setLoiMayChu([]);
        setBuocHienLoi(new Set());
        toast.success(`Đã lưu nháp v${r.versionNo}`);
        if (dauTien) router.replace(`/nguon-hoa-hong/chinh-sach/${r.policyId}/soan?v=${r.versionId}&buoc=${buoc}`);
        return;
      }
      if (r.vanBanIdDaTao && form.vanBan.kieu === "moi") {
        const v = form.vanBan;
        setVanBanThem((x) => [...x, { id: r.vanBanIdDaTao!, documentCode: v.documentCode, title: v.title, publishedOn: v.publishedOn, coTep: v.tep !== null, daThuHoi: false }]);
        setForm((f) => ({ ...f, vanBan: { kieu: "co-san", id: r.vanBanIdDaTao! } }));
        toast.message("Văn bản đã được tạo; chính sách chưa lưu được — sửa lỗi rồi lưu lại.");
      }
      setChung(r.chung);
      setLoiMayChu(r.loi.map((x) => ({ loi: x, snap: giaTriTruong(form, x.truong) })));
      if (r.loi.length > 0) {
        const dau = r.loi[0]!;
        if (dau.buoc !== buoc) diDen(dau.buoc);
        focusTruong(dau.truong);
      }
      if (r.chung && r.loi.length === 0) toast.error(r.chung);
    });
  }

  // ── Kiểm lại hàng rào ──
  function kiemLai() {
    if (!luu) return;
    batDauKiem(async () => {
      const r = await kiemHangRaoAction(luu.versionId);
      if (r.ok) setHangRaoKq(r.hangRao);
      else toast.error(r.chung ?? "Không kiểm được lúc này — thử lại.");
    });
  }

  // ── Kích hoạt ──
  const hangRao = useMemo(() => dungHangRao(hangRaoKq, { tran: p.dl.tran, tenVai: new Map(p.dl.vai.map((v) => [v.code, v.name])) }), [hangRaoKq, p.dl]);
  const nut = quyetDinhNutKichHoat({ coQuyenKichHoat: p.coQuyenKichHoat, laBanNhap, daLuu: luu !== null, coThayDoiChuaLuu: dirty, hangRao });
  const nhanVanBan = (() => {
    const vb = form.vanBan;
    if (vb.kieu === "moi") return `${vb.documentCode} — ${vb.title}`;
    if (vb.kieu === "co-san") {
      const x = [...vanBanThem, ...p.dl.vanBan].find((y) => y.id === vb.id);
      return x ? `${x.documentCode} — ${x.title}` : "(chưa chọn)";
    }
    return "Chưa gắn văn bản";
  })();
  const tomTat = useMemo(() => tomTatForm(form, p.dl, nhanVanBan), [form, p.dl, nhanVanBan]);

  // ── Thử tính (chỉ đọc) ──
  const nutThu = quyetDinhNutThuTinh({ coQuyen: p.thuTinh.coQuyen, laBanNhap, daLuu: luu !== null, coThayDoiChuaLuu: dirty });
  const tuoiThu = thu.kieu === "xong" ? tuoiKetQua(thu, luu, dirty) : null;
  const tacDong = tomTatTacDong(thu, tuoiThu);

  function chayThu(t: ThamSoThuTinh) {
    if (!luu) return;
    setThu({ kieu: "dang-chay" });
    batDauThu(async () => {
      try {
        const r = await thuTinhAction({ versionId: luu.versionId, tuNgay: t.tuNgay, denNgay: t.denNgay, orgUnitId: t.orgUnitId });
        setThu(r.ok ? { kieu: "xong", ketQua: r.ketQua, phienBanCapNhatLuc: r.phienBanCapNhatLuc, chayLuc: r.chayLuc } : { kieu: "loi", chung: r.chung });
      } catch {
        // Mất mạng / máy chủ sập: Server Action ném. Không để màn kẹt ở "đang tính".
        setThu({ kieu: "loi", chung: "Mất kết nối tới máy chủ — thử lại sau ít phút." });
      }
    });
  }

  function xacNhanKichHoat() {
    if (!luu) return;
    setLoiHop(null);
    batDauKichHoat(async () => {
      // `updatedAtDaThay` = mốc của bản nháp ĐÃ LƯU mà thanh hàng rào và hộp thoại này đang nói về: nháp bị ai đó sửa sau mốc ấy thì máy chủ từ chối.
      const r = await kichHoatAction({ versionId: luu.versionId, xacNhanLyDo: hangRao.canXacNhan ? lyDoXacNhan.trim() : null, updatedAtDaThay: luu.updatedAt });
      if (r.ok) {
        toast.success(`Đã kích hoạt — có hiệu lực từ ${tomTat.ngayNut}`);
        router.push(`/nguon-hoa-hong/chinh-sach/${policyId}`);
        return;
      }
      setLoiHop(r.chung);
      if (r.hangRao) {
        const kq = r.hangRao;
        setHangRaoKq((cu) => ({ loi: kq.loi.length > 0 ? kq.loi : (cu?.loi ?? []), canhBao: kq.canhBao.length > 0 ? kq.canhBao : (cu?.canhBao ?? []), somNhat: cu?.somNhat ?? null }));
        if (kq.loi.length > 0) setMoHop(false);
      }
      // Hộp thoại có thể vừa đóng và thanh hàng rào (cột bên) nằm dưới form khi màn < 1280px ⇒ lý do phải tới tận người bấm. Riêng "cần xác nhận
      // cảnh báo" thì hộp thoại tự mở ô lý do và in câu này, không báo thêm.
      const canXacNhanCanhBao = r.hangRao !== undefined && r.hangRao.loi.length === 0 && r.hangRao.canhBao.length > 0;
      if (!canXacNhanCanhBao) toast.error(r.chung ?? "Không kích hoạt được.");
    });
  }

  // Huỷ nháp là việc KHÔNG đảo ngược ⇒ luôn qua hộp xác nhận (nút ở thanh dưới nằm sát "Quay lại" và "Lưu nháp").
  function huyBanNhap() {
    if (!luu) return;
    batDauLuu(async () => {
      const r = await huyNhapAction({ versionId: luu.versionId, lyDo: "Huỷ khi đang soạn" });
      if (r.ok) {
        toast.success("Đã huỷ bản nháp");
        router.push(policyId ? `/nguon-hoa-hong/chinh-sach/${policyId}` : "/nguon-hoa-hong/chinh-sach");
      } else {
        setMoHopHuy(false);
        toast.error(r.chung ?? "Không huỷ được.");
      }
    });
  }

  const pb: PropsBuoc = { form, dat, loi, dl: p.dl, khoaDinhDanh, coQuyenQuanLyNguon: p.coQuyenQuanLyNguon };
  const buocNhan = BUOC.map((b) => ({ khoa: b, nhan: NHAN_BUOC[b] }));

  return (
    <div ref={vungRef}>
      <Stepper buoc={buocNhan} dangO={buoc} daXong={buocDaXong} coLoi={buocCoLoi} onChon={chonBuoc} />

      {p.khoa && (
        <div role="note" className="mb-4 flex items-start gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">
          <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="font-medium text-foreground">Chỉ đọc</p>
            <p className="mt-0.5 text-muted-foreground">{p.khoa.lyDo}</p>
          </div>
        </div>
      )}
      {!p.khoa && !p.coQuyenSoan && (
        <div role="note" className="mb-4 flex items-start gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">
          <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">
            Bạn không sửa được chính sách này (cần quyền commission_policies:manage cho đúng đơn vị sở hữu).
            {p.coQuyenKichHoat ? " Bạn vẫn kiểm và kích hoạt được ở bước cuối nếu mọi điều kiện đạt." : ""}
          </p>
        </div>
      )}
      {chung && (
        <div role="alert" className="mb-4 rounded-xl border border-state-danger-ink/40 bg-state-danger-soft px-4 py-3 text-sm text-state-danger-ink">
          {chung}
        </div>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="buoc-tieu-de" className="min-w-0 rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-4">
            <h2 id="buoc-tieu-de" tabIndex={-1} className="text-base font-semibold text-foreground outline-none">
              {NHAN_BUOC[buoc]}
              <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                Bước {chiSo + 1}/{BUOC.length}
              </span>
            </h2>
          </div>
          {buoc !== "kich-hoat" && (
          <fieldset disabled={khoa} className="min-w-0 border-0 p-0">
            <div className="px-5 py-5">
              {buoc === "boi-canh" && <BuocBoiCanh {...pb} />}
              {buoc === "nguoi-huong" && <BuocNguoiHuong {...pb} />}
              {buoc === "cach-tinh" && <BuocCachTinh {...pb} />}
              {buoc === "van-ban" && <BuocVanBan {...pb} vanBanThem={vanBanThem} />}
              {buoc === "hieu-luc" && <BuocHieuLuc {...pb} hangRao={hangRaoKq} />}
              {buoc === "thu-tinh" && <BuocThuTinh {...pb} />}
            </div>
          </fieldset>
          )}
          {/* Thử tính đứng NGOÀI fieldset khoá: nút tự quyết bấm được hay không (`quyetDinhNutThuTinh`), vì thử tính chỉ đọc nên người chỉ-đọc vẫn chạy được. */}
          {buoc === "thu-tinh" && (
            <div className="border-t border-border px-5 py-5">
              <ThuTinhThat
                quyetDinh={nutThu}
                coSo={p.dl.coSo}
                tham={thamThu}
                onTham={(x) => setThamThu((c) => ({ ...c, ...x }))}
                trangThai={thu}
                ketQuaCu={tuoiThu === "cu"}
                onChay={chayThu}
                coQuyenSuaTran={p.coQuyenSuaTran}
              />
            </div>
          )}
          {/* Bước Kích hoạt đứng NGOÀI fieldset khoá: nút của nó tự quyết bấm được hay không (`quyetDinhNutKichHoat`) theo quyền `activate`. */}
          {buoc === "kich-hoat" && (
            <div className="px-5 py-5">
              <BuocKichHoat
                tomTat={tomTat}
                quyetDinh={nut}
                vuotTran={hangRao.dong.find((d) => d.ma === "tran" && d.trangThai === "khong-dat")?.huongXuLy ?? null}
                coQuyenSuaTran={p.coQuyenSuaTran}
                onMoHop={() => {
                  setLoiHop(null);
                  setMoHop(true);
                }}
              />
            </div>
          )}
          <StickyActionBar
            trai={
              khoa ? (
                <span>Xem từng bước bằng thanh bước ở trên.</span>
              ) : luu ? (
                <span>
                  Đã lưu v{luu.versionNo} lúc <span className="tabular-nums">{dinhDangGio(luu.updatedAt)}</span>
                  {dirty && <span className="font-medium text-state-warning-ink"> · có thay đổi chưa lưu</span>}
                </span>
              ) : (
                <span>Chưa lưu nháp</span>
              )
            }
          >
            {chiSo > 0 && (
              <button type="button" onClick={lui} className={BTN_OUTLINE}>
                <ArrowLeft aria-hidden className="h-4 w-4" />
                Quay lại
              </button>
            )}
            {!khoa && luu && p.cheDo !== "tao-moi" && (
              <button type="button" onClick={() => setMoHopHuy(true)} disabled={dangLuu} className={BTN_OUTLINE}>
                Huỷ bản nháp
              </button>
            )}
            {!khoa && (
              <button type="button" onClick={luuNhap} disabled={dangLuu} className={chiSo === BUOC.length - 1 ? BTN_PRIMARY : BTN_OUTLINE}>
                {dangLuu ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Save aria-hidden className="h-4 w-4" />}
                Lưu nháp
              </button>
            )}
            {p.khoa && p.coQuyenSoan && policyId && (
              <Link href={`/nguon-hoa-hong/chinh-sach/${policyId}/soan`} className={BTN_PRIMARY}>
                Tạo phiên bản mới
              </Link>
            )}
            {chiSo < BUOC.length - 1 && (
              <button type="button" onClick={tiep} className={khoa ? BTN_OUTLINE : BTN_PRIMARY}>
                Tiếp
                <ArrowRight aria-hidden className="h-4 w-4" />
              </button>
            )}
          </StickyActionBar>
        </section>

        {!p.khoa && (
          <div className="min-w-0 xl:sticky xl:top-4">
            {dirty && hangRaoKq && (
              <p role="note" className="mb-2 text-xs text-state-warning-ink">
                Kết quả bên dưới là của bản đã lưu — lưu nháp để kiểm lại với thay đổi mới.
              </p>
            )}
            <HangRaoBar
              hangRao={hangRao}
              coQuyenSuaTran={p.coQuyenSuaTran}
              onKiemLai={luu ? kiemLai : undefined}
              dangKiem={dangKiem}
              moTaChuaKiem={luu ? "Chưa kiểm được — bấm Kiểm lại." : "Lưu nháp để máy chủ kiểm: văn bản, hiệu lực, người phụ trách, trần, chồng lấn."}
            />
          </div>
        )}
      </div>

      {luu && (
        <ConfirmDialog
          open={moHopHuy}
          onOpenChange={setMoHopHuy}
          title={`Huỷ bản nháp v${luu.versionNo}?`}
          description={
            <>
              Bản nháp sẽ bị huỷ và không khôi phục được.
              {dirty && " Các thay đổi chưa lưu trên màn này cũng sẽ mất."}
            </>
          }
          confirmLabel="Huỷ bản nháp"
          pending={dangLuu}
          onConfirm={huyBanNhap}
        />
      )}

      <KichHoatDialog
        open={moHop}
        onOpenChange={setMoHop}
        tomTat={tomTat}
        tacDong={tacDong}
        canXacNhan={hangRao.canXacNhan}
        lyDo={lyDoXacNhan}
        onLyDo={setLyDoXacNhan}
        pending={dangKichHoat}
        loi={loiHop}
        onXacNhan={xacNhanKichHoat}
      />
    </div>
  );
}

