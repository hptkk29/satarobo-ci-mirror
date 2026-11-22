import { CircleCheck, CircleDashed, Lock, TriangleAlert, Info } from "lucide-react";
import type { Actor } from "@/lib/auth/actor";
import { HelpHint } from "@/components/admin/ui/help-hint";
import { huongDan } from "@/lib/finance/hoa-don/huong-dan";
import { giaiKetNoiChoPhapNhan } from "@/lib/finance/hoa-don/ket-noi/cong-theo-phap-nhan";
import { docNhaCungCapDaChon, laKeToanHoiSo } from "@/lib/finance/hoa-don/ket-noi/ket-noi-db";
import { tomTatTrangThai } from "@/lib/finance/hoa-don/ket-noi/hien-thi";
import { docCacChinhSachKy } from "@/lib/finance/hoa-don/ky-chinh-sach/ky-chinh-sach-db";
import { trangThaiKyTuDong } from "@/lib/finance/hoa-don/ky-chinh-sach/luat";
import { docDanhSachChinhSach } from "@/lib/finance/hoa-don/chinh-sach-db";
import { nhaCungCapHieuLuc, TEN_NHA_CUNG_CAP_API, type PhapNhan } from "@/lib/finance/hoa-don/phap-nhan";
import { phamViKeToan } from "@/lib/finance/hoa-don/quyen";
import { dungTongQuan, type MucTongQuan, type TrangThaiMuc } from "@/lib/finance/hoa-don/tong-quan-thiet-lap";
import { LienKetNeo } from "./dieu-huong-trong-trang";

// «Tổng quan thiết lập» — đầu trang Cấu hình (05/11/2026, chủ dự án: «giao diện khó dùng quá»). SERVER component: đọc đúng những thứ các khu bên dưới đọc (cùng hàm, nên không thể nói một đằng làm một nẻo),
// rồi để `dungTongQuan` (thuần, có test) quyết trạng thái từng bước. Người xem không có quyền xem một phần thì phần đó ghi «không xem được», không đoán.

const CHU_BUOC = {
  "buoc-phap-nhan": huongDan("buoc-phap-nhan"),
  "buoc-ket-noi": huongDan("buoc-ket-noi"),
  "buoc-chinh-sach-ky": huongDan("buoc-chinh-sach-ky"),
  "buoc-chinh-sach-hoa-don": huongDan("buoc-chinh-sach-hoa-don"),
} as const;

const NHAN_NUT: Record<TrangThaiMuc, string> = {
  xong: "Xem",
  "can-lam": "Làm bước này",
  "luu-y": "Xem lại",
  "tuy-chon": "Xem",
  "khong-xem-duoc": "Xem",
};

const BIEU_TUONG: Record<TrangThaiMuc, { Icon: typeof CircleCheck; mau: string; chu: string }> = {
  xong: { Icon: CircleCheck, mau: "text-[color:var(--state-success-ink)]", chu: "Đã xong" },
  "can-lam": { Icon: TriangleAlert, mau: "text-[color:var(--state-danger-ink)]", chu: "Cần làm" },
  "luu-y": { Icon: Info, mau: "text-[color:var(--state-warning-ink)]", chu: "Cần lưu ý" },
  "tuy-chon": { Icon: CircleDashed, mau: "text-muted-foreground", chu: "Tuỳ chọn" },
  "khong-xem-duoc": { Icon: Lock, mau: "text-muted-foreground", chu: "Không xem được" },
};

export async function TongQuanThietLap({
  actor,
  tenCoSo,
  coSoId,
  phapNhan,
  loiPhapNhan,
  kyHieu,
  canhBaoLech,
  hubBat,
}: {
  actor: Actor;
  tenCoSo: string;
  coSoId: string;
  /** Pháp nhân PHÁT HÀNH hôm nay của cơ sở (theo cấu hình cơ sở), hoặc `null` + `loiPhapNhan`. */
  phapNhan: Pick<PhapNhan, "ma" | "ten" | "phanMem"> | null;
  loiPhapNhan: string | null;
  kyHieu: string | null;
  canhBaoLech: string | null;
  /** Khu «Chính sách hoá đơn» có trên màn (cờ Hub bật) không — tắt ⇒ không có dòng bước 4. */
  hubBat: boolean;
}) {
  const hoiSo = laKeToanHoiSo(actor);
  const pham = phamViKeToan(actor);
  const xemChinhSachKy = pham === "ALL" || pham.length > 0;

  const [ketNoi, chinhSachKy, soBan] = await Promise.all([
    phapNhan && hoiSo
      ? (async () => {
          const ncc = nhaCungCapHieuLuc(phapNhan, await docNhaCungCapDaChon(phapNhan.ma));
          const tt = tomTatTrangThai(await giaiKetNoiChoPhapNhan(phapNhan.ma));
          return { muc: tt.muc, nhan: tt.nhan, chiTiet: tt.chiTiet, nhaCungCap: ncc ? TEN_NHA_CUNG_CAP_API[ncc] : null };
        })()
      : Promise.resolve(null),
    phapNhan && xemChinhSachKy
      ? (async () => {
          const c = (await docCacChinhSachKy()).find((x) => x.phapNhanMa === phapNhan.ma) ?? null;
          return {
            tamDung: c?.tamDung === true,
            suCo: c?.tamDungSuCo === true,
            khaiDuHanMuc: pham === "ALL" ? trangThaiKyTuDong(c ? { ...c } : null).ma !== "CHUA_KHAI" : null,
          };
        })()
      : Promise.resolve(null),
    hubBat && phapNhan
      ? docDanhSachChinhSach(actor, { phapNhanMa: phapNhan.ma, centerId: coSoId }).then((ds) => ds.filter((b) => b.trangThai === "HIEU_LUC").length)
      : Promise.resolve(null),
  ]);

  const tq = dungTongQuan({
    phapNhan: phapNhan ? { ten: phapNhan.ten, kyHieu } : { loi: loiPhapNhan ?? "Cơ sở chưa khai pháp nhân phát hành." },
    canhBaoLech,
    ketNoi,
    chinhSachKy,
    chinhSachHoaDon: hubBat ? { soBanHieuLuc: soBan ?? 0 } : null,
  });

  const dau = tq.sanSang === false ? (tq.soCanLam > 0 ? "can-lam" : "luu-y") : tq.sanSang === true ? "xong" : "tuy-chon";
  const { Icon: IconDau, mau: mauDau } = BIEU_TUONG[dau];

  return (
    <section aria-label="Tổng quan thiết lập" className="mb-6 rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3">
        <IconDau aria-hidden className={`h-5 w-5 shrink-0 ${mauDau}`} />
        <h2 className="text-base font-semibold text-foreground">{tq.tieuDe}</h2>
        <HelpHint label="Xem hướng dẫn: tổng quan thiết lập">{huongDan("cau-hinh-tong-quan")}</HelpHint>
        <p className="w-full text-sm text-muted-foreground sm:ml-auto sm:w-auto">{tenCoSo}</p>
      </div>
      <ol className="divide-y divide-border">
        {tq.muc.map((m) => (
          <HangBuoc key={m.khoa} m={m} />
        ))}
      </ol>
    </section>
  );
}

function HangBuoc({ m }: { m: MucTongQuan }) {
  const { Icon, mau, chu } = BIEU_TUONG[m.trangThai];
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Icon aria-hidden className={`mt-0.5 h-5 w-5 shrink-0 ${mau}`} />
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <span>
              Bước {m.buoc} · {m.tieuDe}
            </span>
            <span className={`text-xs font-normal ${mau}`}>({chu})</span>
            <HelpHint label={`Xem hướng dẫn: Bước ${m.buoc}`}>{CHU_BUOC[m.huongDan]}</HelpHint>
          </p>
          <p className="text-sm text-muted-foreground">{m.dong}</p>
        </div>
      </div>
      <LienKetNeo id={m.neo} className="inline-flex min-h-8 shrink-0 items-center self-start rounded-lg border border-border px-3 text-sm font-medium text-primary hover:bg-muted pointer-coarse:min-h-11 sm:self-center">
        {NHAN_NUT[m.trangThai]}
      </LienKetNeo>
    </li>
  );
}
