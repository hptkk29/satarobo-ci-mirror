"use client";

/**
 * Làm bài DISC trong cổng học viên: KHÔNG hỏi lại hồ sơ. Tên + SĐT đã có từ tài khoản; chỉ hỏi phần hệ thống còn thiếu
 * (năm sinh của ba/mẹ, năm sinh của con) — một lần, ngay đầu. Rồi làm bài ba/mẹ → bài của con → xác nhận lưu.
 * Điểm do SERVER chấm; màn này chỉ gửi câu trả lời thô. Bài lưu xong thuộc về tài khoản đang đăng nhập (không cần OTP/mã nhận).
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, Lock } from "lucide-react";
import type { BoDeDisc } from "@/lib/disc/engine";
import { bacHocTuNamSinh, type BacHoc } from "@/lib/disc/ho-so";
import type { KetQuaLuuPortal } from "@/lib/disc/portal-lam-bai";
import { goiBoDeDisc, type GoiBoDe } from "@/components/disc/api-client";
import { loiLuuHienThi } from "@/components/disc/loi-luu";
import { ManLamBai } from "@/components/disc/man-lam-bai";
import { ThanhTienDo } from "@/components/disc/thanh-tien-do";
import { tinhTienDo } from "@/components/disc/tien-do";
import { NHAN_TRUONG, NUT_CHINH, NUT_PHU, O_NHAP, LOI_TRUONG, GOI_Y, THE } from "@/components/disc/kieu";
import { luuBaiDiscPortalAction } from "./_actions";

type TraLoi = Record<string, number>;
type Buoc = "bosung" | "tai" | "phuHuynh" | "hocSinh" | "xacNhan" | "xong";

export type LamBaiPortalProps = {
  studentId: string;
  tenPhuHuynh: string;
  tenHocSinh: string;
  /** null = hệ thống chưa có ⇒ màn hỏi một lần. */
  namSinhPhuHuynh: number | null;
  namSinhHocSinh: number | null;
  /** Lớp đã lưu của con (1–12) — chỉ dùng khi chưa có năm sinh. */
  lopDaLuu: number | null;
  /** Tiêm để test. */
  luu?: (input: unknown) => Promise<KetQuaLuuPortal>;
  layBoDe?: GoiBoDe;
  dieuHuong?: (href: string) => void;
  homNay?: Date;
};

const namTuChuoi = (s: string) => (/^\d{4}$/.test(s.trim()) ? Number(s.trim()) : Number.NaN);

function sinhKhoa(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  throw new Error("Trình duyệt không hỗ trợ sinh khoá ngẫu nhiên");
}

export function LamBaiPortal(p: LamBaiPortalProps) {
  const router = useRouter();
  const id = useId();
  const luu = p.luu ?? luuBaiDiscPortalAction;
  const layBoDe = p.layBoDe ?? goiBoDeDisc;
  const dieuHuong = p.dieuHuong ?? ((href: string) => router.push(href));
  const homNay = useMemo(() => p.homNay ?? new Date(), [p.homNay]);

  const thieuPH = p.namSinhPhuHuynh === null;
  const thieuHS = p.namSinhHocSinh === null;
  const [buoc, setBuoc] = useState<Buoc>(thieuPH || thieuHS ? "bosung" : "tai");
  const [nsPH, setNsPH] = useState(p.namSinhPhuHuynh === null ? "" : String(p.namSinhPhuHuynh));
  const [nsHS, setNsHS] = useState(p.namSinhHocSinh === null ? "" : String(p.namSinhHocSinh));
  const [loiBoSung, setLoiBoSung] = useState<string | null>(null);
  const [boDe, setBoDe] = useState<{ PH: BoDeDisc; HS: BoDeDisc } | null>(null);
  const [loiTai, setLoiTai] = useState<string | null>(null);
  const [traLoi, setTraLoi] = useState<{ PH: TraLoi; HS: TraLoi }>({ PH: {}, HS: {} });
  const [cau, setCau] = useState<{ PH: number; HS: number }>({ PH: 0, HS: 0 });
  const [dongY, setDongY] = useState(false);
  const [dangLuu, setDangLuu] = useState(false);
  const [loiLuu, setLoiLuu] = useState<{ thongBao: string; baiCanSua?: "phuHuynh" | "hocSinh" } | null>(null);
  const khoaRef = useRef<string | null>(null);
  const dangGui = useRef(false);
  const luotTai = useRef(0);

  const nsPHSo = namTuChuoi(nsPH);
  const nsHSSo = namTuChuoi(nsHS);

  const tai = useCallback(
    async (nsPh: number, nsHs: number) => {
      const luot = ++luotTai.current;
      setLoiTai(null);
      setBuoc("tai");
      const bac: BacHoc | null = bacHocTuNamSinh(nsHs, homNay) ?? (p.lopDaLuu !== null ? (String(p.lopDaLuu) as BacHoc) : null);
      if (!bac) {
        setLoiTai("Năm sinh của con chưa khớp với bậc học nào. Vui lòng kiểm tra lại.");
        setBuoc("bosung");
        return;
      }
      try {
        const [a, b] = await Promise.all([layBoDe({ vai: "PH", namSinh: nsPh }), layBoDe({ vai: "HS", bacHoc: bac, namSinh: nsHs })]);
        if (luot !== luotTai.current) return;
        if (!a.ok || !b.ok) {
          setLoiTai("Chưa lấy được bộ câu hỏi. Vui lòng thử lại sau ít phút.");
          return;
        }
        setBoDe({ PH: a.boDe, HS: b.boDe });
        setBuoc("phuHuynh");
      } catch {
        if (luot === luotTai.current) setLoiTai("Chưa kết nối được tới máy chủ. Vui lòng thử lại.");
      }
    },
    [layBoDe, homNay, p.lopDaLuu],
  );

  // Đủ hồ sơ sẵn ⇒ bấm vào là làm luôn: tải bộ đề ngay khi mở màn.
  useEffect(() => {
    if (!thieuPH && !thieuHS) void tai(p.namSinhPhuHuynh!, p.namSinhHocSinh!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tiepBoSung = (e: React.FormEvent) => {
    e.preventDefault();
    const a = thieuPH ? nsPHSo : p.namSinhPhuHuynh!;
    const b = thieuHS ? nsHSSo : p.namSinhHocSinh!;
    if (Number.isNaN(a) || Number.isNaN(b)) {
      setLoiBoSung("Vui lòng nhập năm sinh gồm 4 chữ số (ví dụ 1988).");
      return;
    }
    setLoiBoSung(null);
    void tai(a, b);
  };

  const tien = useMemo(
    () =>
      tinhTienDo({
        buoc: buoc === "xong" ? "hoanThanh" : buoc === "bosung" || buoc === "tai" ? "hoSo" : buoc === "xacNhan" ? "hoanThanh" : buoc,
        tongCauPH: boDe?.PH.cauHoi.length ?? 0,
        tongCauHS: boDe?.HS.cauHoi.length ?? 0,
        daTraLoiPH: Object.keys(traLoi.PH).length,
        daTraLoiHS: Object.keys(traLoi.HS).length,
      }),
    [buoc, boDe, traLoi],
  );

  const luuBai = async () => {
    if (dangGui.current || !boDe) return;
    if (!dongY) {
      setLoiLuu({ thongBao: "Cần đồng ý để chúng tôi xử lý hồ sơ thì mới lưu được kết quả." });
      return;
    }
    const du = (b: BoDeDisc, t: TraLoi) => b.cauHoi.every((q) => typeof t[q.id] === "number");
    if (!du(boDe.PH, traLoi.PH) || !du(boDe.HS, traLoi.HS)) {
      setLoiLuu({ thongBao: "Còn câu chưa trả lời. Vui lòng quay lại hoàn thành đủ cả hai bài." });
      return;
    }
    const chiCauCua = (b: BoDeDisc, t: TraLoi): TraLoi => Object.fromEntries(b.cauHoi.map((q) => [q.id, t[q.id]!]));
    try {
      khoaRef.current ??= sinhKhoa();
    } catch {
      setLoiLuu({ thongBao: "Trình duyệt này chưa hỗ trợ lưu an toàn. Vui lòng dùng trình duyệt mới hơn." });
      return;
    }
    dangGui.current = true;
    setDangLuu(true);
    setLoiLuu(null);
    try {
      const r = await luu({
        studentId: p.studentId,
        idempotencyKey: khoaRef.current,
        dongYXuLy: true,
        boSung: {
          ...(thieuPH && !Number.isNaN(nsPHSo) ? { namSinhPhuHuynh: nsPHSo } : {}),
          ...(thieuHS && !Number.isNaN(nsHSSo) ? { namSinhHocSinh: nsHSSo } : {}),
        },
        bai: {
          phuHuynh: { maBoDe: boDe.PH.ma, traLoi: chiCauCua(boDe.PH, traLoi.PH) },
          hocSinh: { maBoDe: boDe.HS.ma, traLoi: chiCauCua(boDe.HS, traLoi.HS) },
        },
      });
      if (r.ok) {
        setBuoc("xong");
        dieuHuong("/portal/disc?moi=1");
        return;
      }
      // Phiên mới cho lần thử sau chỉ khi lỗi là do bài (khoá cũ đã gắn với nội dung cũ).
      if (r.loi === "DU_LIEU_KHONG_HOP_LE") khoaRef.current = null;
      if (r.loi === "QUA_NHIEU_YEU_CAU") setLoiLuu({ thongBao: "Bạn thử quá nhiều lần. Vui lòng đợi một lúc rồi bấm lại." });
      else if (r.loi === "THIEU_SDT") setLoiLuu({ thongBao: "Tài khoản chưa có số điện thoại nên chưa lưu được kết quả. Vui lòng cập nhật số điện thoại ở mục Hồ sơ." });
      else if (r.loi === "KHONG_CO_QUYEN") setLoiLuu({ thongBao: "Không tìm thấy học viên này trong tài khoản của bạn." });
      else if (r.loi === "THIEU_HO_SO") setLoiLuu({ thongBao: "Còn thiếu năm sinh. Vui lòng tải lại trang và nhập đủ." });
      else {
        const h = loiLuuHienThi({ ok: false, loi: r.loi, chiTiet: r.chiTiet } as never);
        setLoiLuu({ thongBao: h.thongBao, baiCanSua: h.baiCanSua });
      }
    } catch {
      setLoiLuu({ thongBao: "Chưa kết nối được tới máy chủ nên kết quả CHƯA được lưu. Bài làm vẫn còn, bạn bấm lại khi có mạng." });
    } finally {
      dangGui.current = false;
      setDangLuu(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,40rem)] lg:gap-10" data-testid="disc-portal-lam-bai">
      <aside className="space-y-3">
        <ThanhTienDo
          buoc={buoc === "xong" || buoc === "xacNhan" ? "hoanThanh" : buoc === "bosung" || buoc === "tai" ? "hoSo" : buoc}
          phanTram={buoc === "xong" ? 100 : tien.phanTram}
          daXong={buoc === "xong" ? tien.tong : tien.daXong}
          tong={tien.tong}
        />
        <p className="text-sm leading-relaxed text-muted-foreground">
          Làm cho <strong className="text-foreground">{p.tenPhuHuynh}</strong> và <strong className="text-foreground">{p.tenHocSinh}</strong>. Thông tin lấy từ tài khoản của bạn.
        </p>
      </aside>

      <div className="min-w-0">
        {buoc === "bosung" ? (
          <form onSubmit={tiepBoSung} className={THE + " space-y-4"} noValidate data-testid="disc-portal-bo-sung">
            <div>
              <h2 className="text-lg font-bold text-foreground">Chỉ cần thêm một vài thông tin</h2>
              <p className={GOI_Y}>Hệ thống chưa có năm sinh dưới đây. Bạn nhập một lần để chọn đúng bộ câu hỏi.</p>
            </div>
            {thieuPH && (
              <div>
                <label htmlFor={`${id}-ph`} className={NHAN_TRUONG}>Năm sinh của bạn</label>
                <input id={`${id}-ph`} className={O_NHAP} inputMode="numeric" autoComplete="off" maxLength={4} placeholder="Ví dụ 1988" value={nsPH} onChange={(e) => setNsPH(e.target.value.replace(/\D/g, ""))} />
              </div>
            )}
            {thieuHS && (
              <div>
                <label htmlFor={`${id}-hs`} className={NHAN_TRUONG}>Năm sinh của {p.tenHocSinh}</label>
                <input id={`${id}-hs`} className={O_NHAP} inputMode="numeric" autoComplete="off" maxLength={4} placeholder="Ví dụ 2017" value={nsHS} onChange={(e) => setNsHS(e.target.value.replace(/\D/g, ""))} />
                {!Number.isNaN(nsHSSo) && (
                  <p className={GOI_Y}>Lớp hiện tại: {bacHocTuNamSinh(nsHSSo, homNay) ? (bacHocTuNamSinh(nsHSSo, homNay) === "MN" ? "Mầm non" : `Lớp ${bacHocTuNamSinh(nsHSSo, homNay)}`) : "chưa xác định"} (tính theo năm học).</p>
                )}
              </div>
            )}
            {(loiBoSung || loiTai) && (
              <p role="alert" className={LOI_TRUONG}>
                {loiBoSung ?? loiTai}
              </p>
            )}
            <button type="submit" className={NUT_CHINH}>
              Bắt đầu làm bài
              <ArrowRight aria-hidden className="size-5" />
            </button>
          </form>
        ) : buoc === "tai" ? (
          <div className={THE + " flex items-center gap-3"} role="status" data-testid="disc-portal-dang-tai">
            {loiTai ? (
              <div className="space-y-3">
                <p role="alert" className="flex items-start gap-2 text-red-800">
                  <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0" />
                  {loiTai}
                </p>
                <button type="button" className={NUT_PHU} onClick={() => void tai(p.namSinhPhuHuynh ?? nsPHSo, p.namSinhHocSinh ?? nsHSSo)}>
                  Thử lại
                </button>
              </div>
            ) : (
              <>
                <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
                <span>Đang chuẩn bị bộ câu hỏi…</span>
              </>
            )}
          </div>
        ) : buoc === "phuHuynh" && boDe ? (
          <ManLamBai
            key="ph"
            boDe={boDe.PH}
            tenNguoi={p.tenPhuHuynh}
            traLoi={traLoi.PH}
            cau={cau.PH}
            onTraLoi={(qid, v) => setTraLoi((t) => ({ ...t, PH: { ...t.PH, [qid]: v } }))}
            onCau={(i) => setCau((c) => ({ ...c, PH: i }))}
            onXong={() => setBuoc("hocSinh")}
            onQuayLai={() => dieuHuong("/portal/disc")}
          />
        ) : buoc === "hocSinh" && boDe ? (
          <ManLamBai
            key="hs"
            boDe={boDe.HS}
            tenNguoi={p.tenHocSinh}
            traLoi={traLoi.HS}
            cau={cau.HS}
            onTraLoi={(qid, v) => setTraLoi((t) => ({ ...t, HS: { ...t.HS, [qid]: v } }))}
            onCau={(i) => setCau((c) => ({ ...c, HS: i }))}
            onXong={() => {
              setLoiLuu(null);
              setBuoc("xacNhan");
            }}
            onQuayLai={() => setBuoc("phuHuynh")}
          />
        ) : buoc === "xacNhan" ? (
          <section className={THE + " space-y-5"} aria-labelledby={`${id}-xn`} data-testid="disc-portal-xac-nhan">
            <div>
              <h2 id={`${id}-xn`} className="flex items-start gap-2 text-xl font-extrabold text-foreground">
                <CheckCircle2 aria-hidden className="mt-0.5 size-6 shrink-0 text-emerald-600" />
                Bạn đã làm xong cả hai bài
              </h2>
              <p className={GOI_Y}>Kết quả của {p.tenPhuHuynh} và {p.tenHocSinh} sẽ được lưu vào tài khoản này. Không cần nhập thêm gì.</p>
            </div>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-relaxed text-foreground">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-violet-700" checked={dongY} onChange={(e) => setDongY(e.target.checked)} disabled={dangLuu} />
              <span>
                <strong>Bắt buộc:</strong> Tôi đồng ý để Sata Robo lưu và xử lý hồ sơ gồm tên, năm sinh, lớp và kết quả DISC của tôi và con, nhằm hiển thị kết quả trong tài khoản này. Xem{" "}
                <Link href="/chinh-sach-bao-mat" className="font-semibold underline" target="_blank">chính sách bảo mật</Link>.
              </span>
            </label>
            {loiLuu && (
              <div role="alert" className="flex gap-3 rounded-xl border border-red-300 bg-red-50 p-4 text-sm leading-relaxed text-red-900" data-testid="disc-portal-loi">
                <AlertTriangle aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p>{loiLuu.thongBao}</p>
                  {loiLuu.baiCanSua && (
                    <button type="button" className={NUT_PHU + " mt-3"} onClick={() => setBuoc(loiLuu.baiCanSua === "phuHuynh" ? "phuHuynh" : "hocSinh")}>
                      {loiLuu.baiCanSua === "phuHuynh" ? "Quay lại bài của ba/mẹ" : "Quay lại bài của con"}
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Lock aria-hidden className="size-4 shrink-0 text-violet-700" />
                Chỉ tài khoản của bạn xem được kết quả.
              </p>
              <button type="button" className={NUT_CHINH + " shrink-0 whitespace-nowrap"} onClick={() => void luuBai()} disabled={dangLuu} aria-busy={dangLuu} data-testid="disc-portal-luu">
                {dangLuu ? (
                  <>
                    <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
                    Đang lưu…
                  </>
                ) : (
                  "Lưu và xem kết quả"
                )}
              </button>
            </div>
          </section>
        ) : (
          <div className={THE} role="status">
            <p className="font-semibold text-foreground">Đã lưu. Đang mở kết quả…</p>
          </div>
        )}
      </div>
    </div>
  );
}
