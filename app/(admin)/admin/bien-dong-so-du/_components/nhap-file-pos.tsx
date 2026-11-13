"use client";

// IMPORT FILE GIAO DỊCH THẺ SmartPOS (docs/pos-the-smartpos.md).
//
// ⚠️ FILE ĐƯỢC ĐỌC TRONG TRÌNH DUYỆT (`docFilePos`, import động để `xlsx` + `jszip` không vào
// bundle của trang khi người dùng không bấm). Chỉ các cột của `COT_BAT_BUOC` rời máy — "Tên chủ
// thẻ" và ~45 cột còn lại của file ngân hàng không bao giờ được gửi lên.
//
// Gửi lên theo lô (`catLoPos`: ≤ 300 dòng VÀ dưới trần byte), TUẦN TỰ, cùng một `batchId`.
// Mỗi lô mang kèm các dòng Hủy/Hoàn của CẢ FILE trỏ vào dòng trong lô: dòng Hủy ở lô 3 phải chặn
// được dòng Thanh toán gốc nằm ở lô 1. Màn này KHÔNG tự tính "mã gốc bị hủy" — server phân loại
// từng dòng hủy (dòng hủy Thất bại / hoàn một phần không được làm gốc bị bỏ qua).
//
// Nút mở panel chỉ được vẽ khi trang đã hỏi `payments:import-pos` (cùng quyền mà cả ba action
// hỏi lại ở server) — luật 12: nút không được hứa một việc action sẽ từ chối.
//
// State nằm ở component NGOÀI Sheet: đóng panel giữa chừng không làm mất tiến độ / kết quả,
// và panel không đóng được khi đang gửi (đóng rồi thì người dùng tưởng đã dừng, mà lô vẫn chạy).

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, FileUp, Loader2, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { DongPos } from "@/lib/payments/pos/kieu";
import { catLoPos, loVuotTran } from "@/lib/payments/pos/cat-lo-pos";
import { khoaFilePos } from "@/lib/payments/pos/khoa-file-pos";
// Cộng kết quả các lô bằng CHÍNH hàm thuần ở lib (GĐ3) — có chỗ cấy lỗi, và `lech` khử trùng một nơi.
import { KET_QUA_RONG, tongLuotSauLo, type KetQuaLoPos, type KetQuaNhapLo } from "@/lib/payments/pos/ket-qua-lo";
import { demGiaoDichLech } from "@/lib/payments/pos/lech-da-ghi-nhan";
import { batDauNhapPosAction, ketThucNhapPosAction, nhapLoPosAction } from "../_pos-actions";
import { KhoiLechDaGhiNhan } from "./khoi-lech-da-ghi-nhan";
import { viTriToastPanel } from "./vi-tri-toast";

/** Trùng `TRAN_FILE` của `doc-file-pos.ts`; kiểm sớm ở đây để khỏi tải thư viện vô ích. */
const TRAN_FILE = 10 * 1024 * 1024;
/** Số dòng lỗi liệt kê ra; phần còn lại gói trong một dòng "… và N dòng khác". */
const HIEN_TOI_DA_LOI = 20;

const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);

type DocDuoc = { tenFile: string; dong: DongPos[]; soFileXlsx: number };
type LoiDoc = { loi: string; cotThieu: string[] };
type TienDo = { daGui: number; tong: number; lo: number; soLo: number };
/** Lượt đã dừng giữa chừng trong phiên này — "Tiếp tục" gửi tiếp đúng lượt đó từ `loTiep`. */
type LuotDo = { khoa: string; batchId: string; loTiep: number; daGui: number; tong: KetQuaLoPos };

/** `2026-09-29T17:31:35+07:00` → `29/09/2026 17:31` — chuỗi đã mang giờ VN, không đổi múi. */
function gioFile(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : iso;
}

export function NhapFilePos() {
  const router = useRouter();
  const [mo, setMo] = useState(false);
  const [doc, setDoc] = useState<DocDuoc | null>(null);
  const [loiDoc, setLoiDoc] = useState<LoiDoc | null>(null);
  const [dangDoc, setDangDoc] = useState(false);
  const [tienDo, setTienDo] = useState<TienDo | null>(null);
  const [ketQua, setKetQua] = useState<KetQuaLoPos | null>(null);
  const [loiNhap, setLoiNhap] = useState<string | null>(null);
  // Cố ý KHÔNG xoá ở `datLai`: chọn lại ĐÚNG file vừa dừng (cùng khoá) vẫn tiếp tục được lượt cũ.
  const [luotDo, setLuotDo] = useState<LuotDo | null>(null);
  const [dangNhap, batDau] = useTransition();

  // Cắt lô: Thanh toán trước Hủy trên CẢ FILE, theo số dòng + số byte, mỗi lô kèm dòng hủy
  // (bản tóm) trỏ vào nó — server TỰ phân loại (xem đầu file + `cat-lo-pos.ts`).
  const cacLo = useMemo(() => (doc ? catLoPos(doc.dong) : null), [doc]);
  // Khoá nhận ra "cùng một file": tên + số dòng + số lô + băm TOÀN BỘ nội dung (`khoaFilePos`).
  // Bản xuất lại có một ô đổi ở giữa là lượt MỚI, không "tiếp tục" bỏ qua lô đầu (rà vòng 3).
  const khoaFile = useMemo(() => (doc && cacLo ? khoaFilePos(doc.tenFile, doc.dong, cacLo.length) : ""), [doc, cacLo]);

  const tomTat = useMemo(() => {
    if (!doc) return null;
    let thanhCong = 0;
    let huyHoan = 0;
    let thuHopLe = 0;
    let tienThu = 0;
    const may = new Set<string>();
    let tu: string | null = null;
    let den: string | null = null;
    for (const d of doc.dong) {
      const ok = d.trangThai.trim() === "Thành công";
      const laThanhToan = d.loaiGiaoDich.trim() === "Thanh toán";
      if (ok) thanhCong++;
      if (!laThanhToan) huyHoan++;
      if (ok && laThanhToan && !d.trangThaiHoanHuy) {
        thuHopLe++;
        tienThu += d.soTien;
      }
      if (d.maThietBi) may.add(d.maThietBi);
      // Cùng offset +07:00 ⇒ so chuỗi là so thời gian.
      if (tu === null || d.thoiGian < tu) tu = d.thoiGian;
      if (den === null || d.thoiGian > den) den = d.thoiGian;
    }
    return {
      tong: doc.dong.length,
      thanhCong,
      khongThanhCong: doc.dong.length - thanhCong,
      huyHoan,
      thuHopLe,
      tienThu,
      soMay: may.size,
      tu,
      den,
    };
  }, [doc]);

  function datLai() {
    setDoc(null);
    setLoiDoc(null);
    setTienDo(null);
    setKetQua(null);
    setLoiNhap(null);
  }

  async function chonFile(f: File) {
    datLai();
    const ten = f.name.toLowerCase();
    if (!ten.endsWith(".zip") && !ten.endsWith(".xlsx")) {
      setLoiDoc({ loi: "Chỉ nhận file .zip hoặc .xlsx tải từ merchant.techcombank.com.", cotThieu: [] });
      return;
    }
    if (f.size > TRAN_FILE) {
      setLoiDoc({ loi: `File ${fmt(Math.ceil(f.size / 1024 / 1024))}MB — vượt trần 10MB. Tách theo ngày rồi import từng phần.`, cotThieu: [] });
      return;
    }
    setDangDoc(true);
    try {
      const { docFilePos } = await import("@/lib/payments/pos/doc-file-pos");
      const kq = await docFilePos(await f.arrayBuffer(), f.name);
      if (!kq.ok) {
        setLoiDoc({ loi: kq.loi, cotThieu: kq.cotThieu });
        return;
      }
      if (kq.dong.length === 0) {
        setLoiDoc({ loi: "File không có dòng giao dịch nào.", cotThieu: [] });
        return;
      }
      setDoc({ tenFile: f.name, dong: kq.dong, soFileXlsx: kq.soFileXlsx });
    } catch (e) {
      setLoiDoc({
        loi: `Không đọc được file: ${e instanceof Error ? e.message : "lỗi không rõ"}. Tải lại file từ ngân hàng rồi thử lại.`,
        cotThieu: [],
      });
    } finally {
      setDangDoc(false);
    }
  }

  /**
   * Báo server kết thúc lượt (XONG / DUNG_GIUA_CHUNG). Action làm mới trang MỘT lần; không tới
   * được nó (mất mạng, hết phiên) thì tự làm mới — lượt DANG_NHAP bỏ dở sẽ tự hiện "Dừng giữa
   * chừng" sau 30 phút (suy khi đọc); lượt đã ghi ĐỦ lô mà báo XONG hỏng thì màn tự suy "Xong"
   * (`trangThaiHienThiLo`, ca `[POS-LO-06]`). Nên lỗi ở đây không để lại nhãn sai vĩnh viễn.
   */
  async function baoKetThuc(batchId: string, kq: "XONG" | "DUNG_GIUA_CHUNG") {
    const r = await ketThucNhapPosAction({ batchId, ketQua: kq }).catch(() => null);
    if (!r?.ok) router.refresh();
  }

  function nhap() {
    if (!doc || !cacLo) return;
    const { dong, tenFile } = doc;
    const soLo = cacLo.length;
    // Lô vượt trần body của Server Action: dừng NGAY Ở ĐÂY, trước khi mở lượt import — không
    // suy nguyên nhân từ message lỗi server (bản production che message). Ca `[POS-CL-04]`.
    const loQua = cacLo.findIndex(loVuotTran);
    if (loQua >= 0) {
      setLoiNhap(
        `Lô ${loQua + 1}/${soLo} quá lớn để gửi (vượt trần 1MB — có dòng ghi chú quá dài). Chưa ghi gì. ` +
          "Tách file theo ngày rồi import từng phần.",
      );
      return;
    }
    // THỬ LẠI cùng file trong phiên này ⇒ TÁI DÙNG lượt dở, gửi tiếp từ lô đã dừng (nợ 4). Bản
    // cũ mở lượt mới mỗi lần bấm ⇒ lịch sử đầy lượt 0 dòng / lượt "xong" nửa file.
    const tiep = luotDo !== null && luotDo.khoa === khoaFile ? luotDo : null;
    let batchId: string | null = tiep?.batchId ?? null;
    let i = tiep?.loTiep ?? 0;
    let daGui = tiep?.daGui ?? 0;
    let tong = tiep?.tong ?? KET_QUA_RONG;
    setLoiNhap(null);
    setKetQua(tiep ? tong : null);
    setTienDo({ daGui, tong: dong.length, lo: i, soLo });

    batDau(async () => {
      const dung = async (thongDiep: string) => {
        setKetQua(tong);
        setLoiNhap(thongDiep);
        // Có lượt thì nhớ chỗ dừng để nút "Tiếp tục" gửi tiếp đúng lượt đó.
        setLuotDo(batchId ? { khoa: khoaFile, batchId, loTiep: i, daGui, tong } : null);
        if (batchId) await baoKetThuc(batchId, "DUNG_GIUA_CHUNG");
      };
      const daGhi = () => (daGui > 0 ? `${fmt(daGui)} dòng trước đó đã ghi. ` : "");
      const anToan = "Giao dịch đã có chỉ được cập nhật, không ghi tiền lần hai.";
      try {
        for (; i < soLo; i++) {
          const lo = cacLo[i]!;
          let r: { ok: true; ketQua: KetQuaNhapLo } | { ok: false; error: string };
          if (batchId === null) {
            // Mở lượt = gửi lô ĐẦU TIÊN: server tạo lượt và ghi lô trong cùng action, nên lịch
            // sử không bao giờ có lượt 0 dòng.
            const bd = await batDauNhapPosAction({
              tenFile,
              soDong: dong.length,
              soLo,
              dong: lo.dong,
              dongHuyCuaFile: lo.dongHuyCuaFile,
            });
            if (bd.ok) batchId = bd.batchId;
            r = bd;
          } else {
            r = await nhapLoPosAction({ batchId, lo: i + 1, dong: lo.dong, dongHuyCuaFile: lo.dongHuyCuaFile });
          }
          if (!r.ok) {
            if (batchId === null) {
              // Chưa mở được lượt ⇒ chưa ghi gì, không có gì để tiếp tục.
              setLoiNhap(r.error);
              setTienDo(null);
              return;
            }
            await dung(`Dừng ở lô ${i + 1}/${soLo}: ${r.error}. ${daGhi()}Bấm “Tiếp tục” để gửi tiếp từ lô này. ${anToan}`);
            return;
          }
          daGui += lo.dong.length;
          // Năm con số = SỐ ĐẾM CỦA LƯỢT trong DB (khớp lịch sử import, kể cả lô GỬI LẠI); lỗi + lệch cộng dồn.
          tong = tongLuotSauLo(tong, r.ketQua);
          setKetQua(tong);
          setTienDo({ daGui, tong: dong.length, lo: i + 1, soLo });
        }
        setLuotDo(null);
        if (batchId) await baoKetThuc(batchId, "XONG");
        // Bong bóng chỉ khi có chỗ trống thật bên trái panel (`viTriToastPanel`); không có ⇒ khối
        // "Kết quả import" trong panel là câu trả lời — không đè tiêu đề / hướng dẫn / nút.
        const viTri = viTriToastPanel(window.innerWidth);
        if (viTri) {
          if (tong.loi.length > 0) {
            toast.warning(`Nhập xong, ${fmt(tong.loi.length)} dòng lỗi — xem danh sách trong panel.`, { position: viTri });
          } else if (tong.lech.length > 0) {
            // GĐ3: sổ không đổi, nhưng không được báo "xong" xanh khi file nói khác thứ đã vào sổ.
            toast.warning(
              `Nhập xong, ${fmt(demGiaoDichLech(tong.lech))} giao dịch đã ghi nhận lệch file — xem trong panel.`,
              { position: viTri },
            );
          } else {
            toast.success(`Nhập xong ${fmt(dong.length)} dòng · tự khớp ${fmt(tong.tuKhop)}.`, { position: viTri });
          }
        }
      } catch (e) {
        // Câu TRUNG TÍNH: không đoán nguyên nhân (mất kết nối, hết phiên, lỗi server… trông như
        // nhau ở đây — bản production che message).
        const chiTiet = e instanceof Error ? e.message : "lỗi không rõ";
        if (batchId === null) {
          // Lô đầu có thể đã ghi ở server dù trả lời không về ⇒ làm mới để thấy sự thật.
          setLoiNhap(`Không mở được lượt import (${chiTiet}). Import lại là an toàn — ${anToan.toLowerCase()}`);
          router.refresh();
          return;
        }
        await dung(`Lô ${i + 1}/${soLo} không gửi được (${chiTiet}). ${daGhi()}Bấm “Tiếp tục” để gửi lại từ lô này. ${anToan}`);
      }
    });
  }

  const tiepTuc = luotDo !== null && luotDo.khoa === khoaFile ? luotDo : null;
  const xong = !dangNhap && ketQua !== null && tienDo !== null && tienDo.daGui === tienDo.tong;
  const phanTram = tienDo && tienDo.tong > 0 ? Math.round((tienDo.daGui / tienDo.tong) * 100) : 0;

  return (
    <>
      <Button type="button" onClick={() => setMo(true)} className="min-h-10 gap-2">
        <FileUp aria-hidden />
        Import file POS
      </Button>

      <Sheet
        open={mo}
        onOpenChange={(v) => {
          // Đang gửi thì không cho đóng: đóng panel không dừng được lô đang chạy.
          if (!v && dangNhap) return;
          setMo(v);
        }}
      >
        {/* `admin-scope`: Sheet render qua PORTAL ra ngoài khung admin ⇒ thiếu class này là nút
            và thanh tiến độ lấy `--primary` CAM của :root thay vì tím admin (tiền lệ ban-chung-tu.tsx). */}
        <SheetContent side="right" className="admin-scope w-full gap-0 sm:max-w-lg">
          <SheetHeader className="shrink-0 border-b border-border px-5 py-4 pr-12">
            <SheetTitle className="text-base font-semibold">Import giao dịch thẻ POS</SheetTitle>
            <SheetDescription className="text-xs leading-relaxed">
              File “Danh sách giao dịch V2” tải từ merchant.techcombank.com — .zip hoặc .xlsx, tối đa
              10MB. File được đọc ngay trong trình duyệt; tên chủ thẻ không rời máy bạn.
            </SheetDescription>
          </SheetHeader>

          {/* `min-h-0`: phần tử flex mặc định `min-height:auto` nên thân KHÔNG co và đẩy footer (nút
              "Nhập N dòng") xuống dưới mép màn khi bảng xem trước dài — `[POS1-UI-03]`. */}
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
            {/* ── Chọn file ─────────────────────────────────────────────── */}
            <div className="space-y-2">
              <label
                className={`flex min-h-11 items-center gap-3 rounded-xl border border-dashed border-border px-4 py-3 text-sm transition-colors duration-150 ${
                  dangNhap ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-primary hover:bg-muted/50"
                }`}
              >
                {dangDoc ? (
                  <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
                ) : (
                  <FileUp className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">
                    {dangDoc ? "Đang đọc file…" : (doc?.tenFile ?? "Chọn file .zip hoặc .xlsx")}
                  </span>
                  {doc && (
                    <span className="block text-xs text-muted-foreground">
                      {fmt(doc.dong.length)} dòng · {doc.soFileXlsx} file Excel — bấm để chọn file khác
                    </span>
                  )}
                </span>
                <input
                  type="file"
                  accept=".zip,.xlsx"
                  className="sr-only"
                  disabled={dangNhap || dangDoc}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void chonFile(f);
                  }}
                />
              </label>
            </div>

            {loiDoc && (
              <div role="alert" className="space-y-2 rounded-xl border border-state-danger bg-state-danger-soft px-4 py-3">
                <p className="flex items-start gap-2 text-xs leading-relaxed text-state-danger-ink">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 wrap-anywhere">{loiDoc.loi}</span>
                </p>
                {loiDoc.cotThieu.length > 0 && (
                  <div className="pl-6">
                    <ul aria-label="Cột còn thiếu" className="flex flex-wrap gap-1.5">
                      {loiDoc.cotThieu.map((c) => (
                        <li
                          key={c}
                          className="inline-flex whitespace-nowrap rounded-md bg-background px-2 py-0.5 text-xs text-state-danger-ink"
                        >
                          {c}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-state-danger-ink">
                      Xuất lại đúng mẫu “Danh sách giao dịch V2”, đừng sửa tên cột trong Excel.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ── Xem trước ─────────────────────────────────────────────── */}
            {tomTat && (
              <section aria-labelledby="pos-xem-truoc" className="space-y-3">
                <h3 id="pos-xem-truoc" className="text-sm font-semibold text-foreground">
                  Trong file có
                </h3>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border px-4 py-3 text-sm">
                  <SoLieu nhan="Tổng số dòng" gia={fmt(tomTat.tong)} />
                  <SoLieu nhan="Máy POS" gia={fmt(tomTat.soMay)} />
                  <SoLieu nhan="Thành công" gia={fmt(tomTat.thanhCong)} tone="success" />
                  <SoLieu
                    nhan="Không thành công"
                    gia={fmt(tomTat.khongThanhCong)}
                    tone={tomTat.khongThanhCong > 0 ? "muted" : undefined}
                  />
                  <SoLieu nhan="Dòng hủy / hoàn" gia={fmt(tomTat.huyHoan)} tone={tomTat.huyHoan > 0 ? "warning" : undefined} />
                  <SoLieu nhan="Thanh toán hợp lệ" gia={`${fmt(tomTat.thuHopLe)} · ${fmt(tomTat.tienThu)}đ`} />
                  {tomTat.tu && tomTat.den && (
                    <div className="col-span-2 min-w-0">
                      <dt className="text-xs text-muted-foreground">Thời gian giao dịch</dt>
                      <dd className="mt-0.5 font-medium tabular-nums text-foreground">
                        {gioFile(tomTat.tu)} → {gioFile(tomTat.den)}
                      </dd>
                    </div>
                  )}
                </dl>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Chỉ dòng <b className="font-semibold text-foreground">Thanh toán · Thành công</b> có đúng
                  một mã phiếu 5 ký tự trong ghi chú mới tự vào sổ. Dòng khác vào hàng “Cần xử lý” để gắn
                  tay. Giao dịch đã import trước đó chỉ được cập nhật, không ghi tiền lần hai.
                </p>
              </section>
            )}

            {/* ── Tiến độ ───────────────────────────────────────────────── */}
            {tienDo && (dangNhap || !xong) && !loiNhap && (
              <div className="space-y-2" aria-live="polite">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-medium text-foreground">
                    Đang gửi lô {Math.min(tienDo.lo + 1, tienDo.soLo)}/{tienDo.soLo}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {fmt(tienDo.daGui)}/{fmt(tienDo.tong)} dòng
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label="Tiến độ import"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={phanTram}
                  className="h-2 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
                    style={{ width: `${phanTram}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">Giữ panel mở cho tới khi xong.</p>
              </div>
            )}

            {loiNhap && (
              <div role="alert" className="flex items-start gap-2 rounded-xl border border-state-danger bg-state-danger-soft px-4 py-3">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-state-danger-ink" aria-hidden />
                <p className="text-xs leading-relaxed text-state-danger-ink">{loiNhap}</p>
              </div>
            )}

            {/* ── Kết quả ───────────────────────────────────────────────── */}
            {ketQua && (xong || loiNhap) && (
              <section aria-labelledby="pos-ket-qua" className="space-y-3" aria-live="polite">
                <h3 id="pos-ket-qua" className="text-sm font-semibold text-foreground">
                  {xong ? "Kết quả import" : "Đã ghi trước khi dừng"}
                </h3>
                <dl className="grid grid-cols-3 gap-x-4 gap-y-3 rounded-xl border border-border px-4 py-3 text-sm">
                  <SoLieu nhan="Mới" gia={fmt(ketQua.moi)} />
                  <SoLieu nhan="Cập nhật" gia={fmt(ketQua.capNhat)} />
                  <SoLieu nhan="Tự khớp" gia={fmt(ketQua.tuKhop)} tone={ketQua.tuKhop > 0 ? "success" : undefined} />
                  <SoLieu nhan="Cần xử lý" gia={fmt(ketQua.canXuLy)} tone={ketQua.canXuLy > 0 ? "warning" : undefined} />
                  <SoLieu nhan="Bỏ qua" gia={fmt(ketQua.boQua)} tone="muted" />
                  <SoLieu nhan="Lỗi" gia={fmt(ketQua.loi.length)} tone={ketQua.loi.length > 0 ? "danger" : undefined} />
                </dl>
                {ketQua.capNhat > 0 && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Nhập lại file cũ: dòng đã ghi nhận chỉ tính vào “Cập nhật”, không tính lại vào “Tự khớp”.
                  </p>
                )}
                {ketQua.canXuLy > 0 && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Dòng cần xử lý có tiền nằm trong bảng dưới (lọc <b className="font-semibold text-foreground">Thẻ POS · Cần xử lý</b>) —
                    gắn tay như chuyển khoản. Dòng hủy chưa thấy gốc nằm ở mục “Giao dịch thẻ POS cần xử lý”.
                  </p>
                )}
                {ketQua.loi.length > 0 && (
                  <div className="rounded-xl border border-state-danger bg-state-danger-soft px-4 py-3">
                    <p className="flex items-center gap-2 text-xs font-semibold text-state-danger-ink">
                      <AlertTriangle className="size-4 shrink-0" aria-hidden />
                      Dòng lỗi — có thể đã ghi một phần. Kiểm giao dịch trong bảng (lọc Thẻ POS) trước khi
                      xử lý tay; import lại là an toàn.
                    </p>
                    <ul className="mt-2 space-y-1">
                      {ketQua.loi.slice(0, HIEN_TOI_DA_LOI).map((l) => (
                        <li key={l.maGiaoDich} className="text-xs leading-relaxed text-state-danger-ink">
                          <span className="font-mono">{l.maGiaoDich}</span> — {l.loi}
                        </li>
                      ))}
                      {ketQua.loi.length > HIEN_TOI_DA_LOI && (
                        <li className="text-xs text-state-danger-ink">
                          … và {fmt(ketQua.loi.length - HIEN_TOI_DA_LOI)} dòng khác
                        </li>
                      )}
                    </ul>
                  </div>
                )}
                <KhoiLechDaGhiNhan lech={ketQua.lech} />
              </section>
            )}
          </div>

          <SheetFooter className="shrink-0 flex-row justify-end gap-2 border-t border-border px-5 py-3">
            {xong ? (
              <>
                <Button type="button" variant="outline" onClick={datLai}>
                  Import file khác
                </Button>
                <Button type="button" onClick={() => setMo(false)}>
                  Xong
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" disabled={dangNhap} onClick={() => setMo(false)}>
                  Đóng
                </Button>
                <Button type="button" disabled={!doc || dangNhap || dangDoc} onClick={nhap} className="gap-2">
                  {dangNhap && <Loader2 className="animate-spin" aria-hidden />}
                  {dangNhap
                    ? "Đang nhập…"
                    : tiepTuc && cacLo
                      ? `Tiếp tục từ lô ${tiepTuc.loTiep + 1}/${cacLo.length}`
                      : doc
                        ? `Nhập ${fmt(doc.dong.length)} dòng`
                        : "Nhập"}
                </Button>
              </>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

const TONE: Record<"success" | "warning" | "danger" | "muted", string> = {
  success: "text-state-success-ink",
  warning: "text-state-warning-ink",
  danger: "text-state-danger-ink",
  muted: "text-muted-foreground",
};

function SoLieu({
  nhan,
  gia,
  tone,
}: {
  nhan: string;
  gia: string;
  tone?: keyof typeof TONE;
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted-foreground">{nhan}</dt>
      <dd className={`mt-0.5 truncate font-semibold tabular-nums ${tone ? TONE[tone] : "text-foreground"}`}>{gia}</dd>
    </div>
  );
}
