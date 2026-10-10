// components/cham-cong/ui/tong-hop-cong-thang.tsx — KHỐI TỔNG HỢP CÔNG THÁNG của MỘT người.
//
// ── Vì sao file này tồn tại ────────────────────────────────────────────────────────────
//
// Cùng một người, cùng một tháng, hai màn: `/teacher/bang-cong` (site GV) và
// `/admin/cham-cong/lich-ca` ("Lịch ca của tôi" — nơi Sale/Kế toán/Quản lý xem công của
// CHÍNH họ, vì họ không có site GV). Trước file này, màn admin chỉ có MỘT dòng chữ nhỏ
// "Tổng công tạm tính X · Y ca" — không công chuẩn, không đi muộn/về sớm, không ngày nghỉ,
// không đơn của mình.
//
// Luật 12b nói site GV phải ĐỌC số của admin chứ không dựng lại. Ở đây vế ngược cũng đúng:
// dựng bản thứ hai của khối này cho admin là tạo ra lần thứ NĂM hai màn in hai con số cho
// cùng một ô. Nên khối được tách ra ĐÚNG MỘT bản, hai màn cùng gọi.
//
// ── Ranh giới của file ────────────────────────────────────────────────────────────────
//
// Đây là phần HIỂN THỊ THUẦN. Nó KHÔNG chạm DB và KHÔNG tự tính gì: mọi con số vào qua
// `tomTat`, do `tomTatCongThang()` (`lib/cham-cong/bang-cong-gv.ts`) dựng từ
// `getMyAttendanceDays` → `gopNgayCong` — đúng phép gộp `buildPeriodSummary` của admin dùng.
// Muốn thêm một con số thì thêm ở HÀM ẤY, không thêm ở đây.
//
// ── ⚠️ TOKEN: file này nằm trong `components/cham-cong/ui/**` ─────────────────────────
//
// Thư mục này dùng chung admin × site GV, nên theo `docs/cham-cong/DESIGN-CHAM-CONG-ADMIN.md`
// nó CHỈ được dùng token `:root` — **cấm `primary-soft` / `primary-ink` / `primary-dark`**.
// Hai chỗ cần màu nhấn (con số chính, đường dẫn lọc) vì thế nhận CLASS TỪ TRANG GỌI qua
// `lopNhanManh` / `lopLink`, mặc định rơi về token trung tính. Nhờ vậy màu do site quyết —
// tím ở admin, cam ở site GV — mà trong file này không có một chuỗi `primary-*` nào.
// (Đo 15/09: `--primary-ink` = `#b45309` ở `:root`, `#610b8a` trong `.admin-scope`,
// `#b33c0b` trong `.teacher-root` — tức nó VẪN đổi đúng theo scope; luật cấm là để một
// component dùng chung không phụ thuộc vào việc nó được đặt trong scope nào.)
import { nhanPhut } from "@/lib/cham-cong/dong-phut-don";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { So, TomTatCong } from "@/lib/cham-cong/bang-cong-gv";

/** 411 phút → "6h51". Cùng cách in với cột "Giờ làm" của màn admin. */
export const fmtMin = (m: number) =>
  m ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : "—";

/**
 * `null` ⇒ "—". Ràng buộc 3 của chủ dự án, viết thành MỘT hàm để không chỗ nào lỡ in `0`
 * cho một thứ chưa đo được: số 0 và "chưa có dữ liệu" là hai chuyện khác nhau.
 */
function soHoacGach(n: So, donVi: string): string {
  return n == null ? "—" : `${n} ${donVi}`;
}

/**
 * Câu khai phạm vi cho ô "Ngày nghỉ phép": nó KHÔNG gồm những loại nghỉ nào.
 *
 * Chỉ kể loại thật sự CÓ. Bản đầu in cứng cả hai vế và ra "KHÔNG gồm 0 ngày lễ và 0 ngày
 * nghỉ theo ca" — một câu đính chính cho thứ không tồn tại, vừa dài vừa làm người đọc dừng
 * lại tìm xem mình có bỏ sót gì không. Ảnh chụp bắt được; không cổng nào khác bắt.
 */
function khaiNghiKhac(nghiLe: number, nghiTuan: number): string {
  const ve: string[] = [];
  if (nghiLe > 0) ve.push(`${nghiLe} ngày lễ`);
  if (nghiTuan > 0) ve.push(`${nghiTuan} ngày nghỉ theo ca`);
  return ve.length
    ? `KHÔNG gồm ${ve.join(" và ")} — xem chi tiết dưới`
    : "ngày bạn xin nghỉ · không gồm nghỉ lễ và nghỉ theo ca";
}

/**
 * Một ô trong hàng bốn số.
 *
 * `nhan` và `phu` CỐ Ý không `truncate`: nhãn ở khối này phải khai đúng thứ nó đếm và khai
 * cả phạm vi, mà nhãn đúng thì dài (13/09: "Công tháng này / công chuẩn" bị cắt thành
 * "Công tháng nà…" ở 375px). Ô cao thêm một dòng rẻ hơn một nhãn nói dối.
 */
function OTong({
  nhan,
  chinh,
  phu,
  lopNhanManh,
  canhBao = false,
}: {
  nhan: string;
  chinh: string;
  phu: string;
  /** Class màu cho con số chính. Trang gọi truyền; rỗng ⇒ token trung tính. */
  lopNhanManh?: string;
  canhBao?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-card p-4 sm:p-5">
      <p className="text-xs leading-snug font-semibold text-muted-foreground">{nhan}</p>
      <p
        className={cn(
          "leading-tight font-bold tabular-nums",
          // `text-2xl` chứ không `text-4xl`: DESIGN.md §3 — số dài đã từng TRÀN ra ngoài thẻ
          // ở cỡ lớn, và đây là giao diện dữ liệu dày chứ không phải hero.
          lopNhanManh ? "text-2xl" : "text-xl",
          canhBao ? "text-state-warning-ink" : (lopNhanManh ?? "text-foreground"),
        )}
      >
        {chinh}
      </p>
      <p className="mt-auto pt-1 text-[11px] leading-snug text-muted-foreground">{phu}</p>
    </div>
  );
}

/**
 * Ô có HAI con số ngang hàng nhau (Đi muộn / Về sớm).
 *
 * Vì sao không nhét thành một con số: "3 lần muộn + 1 lần sớm = 4" là một phép cộng SAI —
 * một ngày vừa đi muộn vừa về sớm bị đếm hai lần, và hai việc ấy cũng không cùng một loại
 * lỗi để cộng. Chủ dự án chốt ô này in "số LẦN + số PHÚT", nên nó in đúng bốn con số.
 */
function ODoi({
  nhan,
  dong,
  phu,
}: {
  nhan: string;
  dong: { nhan: string; lan: number; phut: number }[];
  phu: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-card p-4 sm:p-5">
      <p className="text-xs leading-snug font-semibold text-muted-foreground">{nhan}</p>
      <dl className="mt-0.5 space-y-1">
        {dong.map((d) => (
          <div key={d.nhan} className="flex items-baseline justify-between gap-2">
            <dt className="text-sm leading-snug text-muted-foreground">{d.nhan}</dt>
            <dd
              className={cn(
                "shrink-0 text-base leading-tight font-bold whitespace-nowrap tabular-nums",
                d.lan > 0 ? "text-state-warning-ink" : "text-foreground",
              )}
            >
              {/* 0 lần thì in "—" chứ không "0 lần · 0′": ràng buộc 3, và bốn số 0 xếp chồng
                  nhau chỉ làm mắt phải đọc thêm mà không biết thêm gì. */}
              {d.lan > 0 ? `${d.lan} lần · ${d.phut}′` : "—"}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-auto pt-1 text-[11px] leading-snug text-muted-foreground">{phu}</p>
    </div>
  );
}

/** Một nhóm nhãn→giá trị trong khối chi tiết. */
function NhomSo({ tieuDe, dong }: { tieuDe: string; dong: [string, string][] }) {
  return (
    <div className="min-w-0 bg-card p-4 sm:p-5">
      <h3 className="mb-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
        {tieuDe}
      </h3>
      <dl className="space-y-1.5">
        {dong.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3">
            <dt className="min-w-0 text-sm leading-snug text-muted-foreground">{k}</dt>
            <dd className="shrink-0 text-sm font-semibold whitespace-nowrap text-foreground tabular-nums">
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Một dòng công dạy đã tách theo loại — hình dạng `congDayCuaNguoi()` trả ra. */
export type DongCongDay = {
  code: string;
  name: string;
  buoi: number;
  cong: number;
  tinhVaoKy: boolean;
  boQuaThieuGio: number;
};

export function TongHopCongThang({
  tomTat,
  nhanThang,
  hrefLoc,
  dangLoc = false,
  congDay = [],
  buoiQuaHan = 0,
  hrefBuoiQuaHan,
  nhanChotLuc,
  lopNhanManh,
  lopLink,
}: {
  tomTat: TomTatCong;
  /** "Tháng 8/2026" — trang gọi tự dựng, vì hai màn đánh số tháng theo hai cách. */
  nhanThang: string;
  /** Đích của đường "lọc bảng xuống ngày cần xử lý". Không truyền ⇒ không hiện đường nào. */
  hrefLoc?: string;
  dangLoc?: boolean;
  congDay?: DongCongDay[];
  buoiQuaHan?: number;
  hrefBuoiQuaHan?: string;
  /** "15/08/2026" — trang gọi tự in vì mỗi site một `Intl` sẵn có. */
  nhanChotLuc?: string;
  /** Class màu nhấn cho con số chính (site quyết). */
  lopNhanManh?: string;
  /** Class màu cho đường dẫn (site quyết). */
  lopLink?: string;
}) {
  // Khối chi tiết có tự MỞ SẴN không. Ba điều kiện, và cả ba là "có việc phải làm", không
  // phải "có số khác 0": gấp một VIỆC vào trong rồi coi như đã hiển thị là đúng lớp lỗi
  // luật 12 — người dùng không bấm thì không thấy.
  const coViecPhaiLam =
    tomTat.ngayCanXuLy > 0 || tomTat.chuaCham > 0 || buoiQuaHan > 0;
  const lopA = cn("font-semibold hover:underline", lopLink ?? "text-state-info-ink");

  return (
    <section
      aria-labelledby="tong-hop-thang"
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      {/* Câu KHAI PHẠM VI — ràng buộc 2. Người đọc không phải đoán "tháng này tính tới đâu"
          và "có gồm ngày chưa tới không".

          TẠM TÍNH đứng NGAY CẠNH tiêu đề, không nằm dưới chân: chủ dự án chốt "kỳ chưa chốt
          ⇒ ghi rõ TẠM TÍNH", và một lời cảnh báo đặt sau khi người ta đã đọc xong số thì đã
          muộn. Nó nói về CẢ khối, nên không thể là một ô trong lưới. */}
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-4 py-3 sm:px-5">
        <h2 id="tong-hop-thang" className="text-sm font-bold text-foreground">
          Tổng hợp {nhanThang.toLowerCase()}
        </h2>
        {tomTat.kyTrangThai === "LOCKED" ? (
          <span className="inline-flex items-center rounded-full bg-state-success-soft px-2.5 py-0.5 text-xs font-bold whitespace-nowrap text-state-success-ink">
            ĐÃ CHỐT{nhanChotLuc ? ` ${nhanChotLuc}` : ""}
          </span>
        ) : (
          // `title` KHÔNG đủ để mang một thông tin: trên điện thoại không có hover, nên
          // tooltip là chữ không ai đọc được. "Chưa lập kỳ" khác hẳn "đang mở" — nó nghĩa là
          // Kế toán chưa lập kỳ cho tháng này, và đó là lý do công chuẩn in "—" — nên nó
          // phải nằm TRONG nhãn.
          <span className="inline-flex items-center rounded-full bg-state-warning-soft px-2.5 py-0.5 text-xs font-bold whitespace-nowrap text-state-warning-ink">
            TẠM TÍNH{tomTat.kyTrangThai === null ? " · CHƯA LẬP KỲ" : ""}
          </span>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          {tomTat.tinhToiNgay
            ? `tính tới hết ngày ${tomTat.tinhToiNgay.slice(8)}/${tomTat.tinhToiNgay.slice(5, 7)}`
            : "trọn tháng"}
          {" · "}
          {tomTat.gomNgayTuongLai ? "chưa gồm ngày chưa tới" : "đã gồm mọi ngày trong tháng"}
          {tomTat.kyTrangThai !== "LOCKED" && " · số còn đổi tới khi Kế toán chốt kỳ"}
        </p>
      </header>

      {/* ── A · BỐN SỐ luôn hiện (chốt 10/09) ─────────────────────────────
          Bốn, không phải năm: "Giờ làm" và "Kỳ công" xuống khối gấp. Giờ làm một mình không
          nói được gì khi thiếu vế kế hoạch (nó nằm dưới, có cả cặp), còn trạng thái kỳ nay
          là nhãn TẠM TÍNH ở header — nó nói về cả khối chứ không ngang hàng với bốn số kia.

          Lưới `gap-px` trên nền `bg-border`: đường kẻ tự khớp với MỌI số cột từ 320px tới
          8K, không cần luật `border-r last:border-r-0` cho từng breakpoint, và không đẻ ô
          mồ côi ở hàng cuối như lưới thẻ rời. */}
      <div className="grid gap-px bg-border min-[420px]:grid-cols-2 xl:grid-cols-4">
        {/* ⚠️ Ô NÀY ĐÃ TỪNG GỘP CẢ NGÀY CHƯA DIỄN RA (sự cố 16/09/2026).
            Một người có "12,5 công" thì 6 trong đó là của những ngày chưa xảy ra. Chủ dự án
            chốt phương án (a): ô chính chỉ tính TỚI HÔM NAY, kế hoạch cả tháng xuống dòng
            phụ — và nói rõ đó là kế hoạch, để không ai cộng nhầm vào lương.

            Dòng kế hoạch chỉ hiện khi thật sự LỚN HƠN: tháng đã qua trọn thì hai số bằng
            nhau, in thêm một câu bằng nhau chỉ làm mắt phải đọc mà không biết thêm gì. */}
        <OTong
          nhan="Công tháng — tính tới hôm nay / công chuẩn"
          chinh={
            tomTat.congChuan == null
              ? String(tomTat.cong)
              : `${tomTat.cong} / ${tomTat.congChuan}`
          }
          phu={
            tomTat.congKeHoachCaThang > tomTat.cong
              ? `kế hoạch cả tháng ${tomTat.congKeHoachCaThang} · chưa nhân hệ số lương`
              : tomTat.congChuan == null
                ? "kỳ chưa có công chuẩn — Kế toán chưa lập"
                : "chưa nhân hệ số lương — Kế toán tính riêng"
          }
          lopNhanManh={lopNhanManh}
        />
        <OTong
          nhan="Ngày đã đi làm"
          chinh={`${tomTat.ngayDaCham} / ${tomTat.ngayCoCa}`}
          phu={
            tomTat.chuaCham > 0
              ? `trên ${tomTat.ngayCoCa} ngày có ca · còn ${tomTat.chuaCham} ngày chưa có dấu nào`
              : `trên ${tomTat.ngayCoCa} ngày có ca · mọi ngày đều đã có dấu`
          }
          canhBao={tomTat.chuaCham > 0}
        />
        <ODoi
          nhan="Đi muộn & Về sớm"
          dong={[
            { nhan: "Đi muộn", lan: tomTat.lateCount, phut: tomTat.latePhut },
            { nhan: "Về sớm", lan: tomTat.earlyCount, phut: tomTat.earlyPhut },
          ]}
          phu={[
            "số lần và tổng số phút trong tháng",
            tomTat.otPhut > 0 ? `tăng ca đã duyệt được tính ${nhanPhut(tomTat.otPhut)}` : null,
            tomTat.lamNgayLePhut > 0 ? `làm ngày lễ ${nhanPhut(tomTat.lamNgayLePhut)}` : null,
            tomTat.lamNgayNghiPhut > 0 ? `làm ngày nghỉ ${nhanPhut(tomTat.lamNgayNghiPhut)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
        {/* ⚠️ NHÃN ĐÃ TỪNG SAI — chủ dự án 15/09: *"'Ngày nghỉ = 2' đang đếm ngày lễ."*
            Ngày lễ là ngày công ty cho nghỉ, KHÔNG trừ vào phép của ai; gộp nó vào đây là
            báo cho người ta rằng họ đã tiêu phép mà họ chưa tiêu. Nay ô này đếm ĐÚNG ngày
            xin nghỉ, và câu phụ KHAI RA hai loại còn lại cùng con số của chúng. Ca ghim:
            `lib/cham-cong/tong-hop-cong.test.ts` — "ngày lễ KHÔNG rơi vào nghỉ phép". */}
        <OTong
          nhan="Ngày nghỉ phép"
          chinh={`${tomTat.nghiPhep}`}
          phu={khaiNghiKhac(tomTat.nghiLe, tomTat.nghiTuan)}
        />
      </div>

      {/* ── B · KHỐI GẤP LẠI ──────────────────────────────────────────────
          `<details>` thuần HTML: không `'use client'`, không state, mở/gấp chạy cả khi JS
          chưa tải xong, và trình duyệt tự lo phím Enter/Space + vai trò ARIA. */}
      <details
        open={coViecPhaiLam}
        className="group border-t border-border [&_summary::-webkit-details-marker]:hidden"
      >
        <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm font-semibold text-foreground hover:bg-muted/50 sm:px-5">
          <ChevronRight
            aria-hidden
            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
          />
          Chi tiết tháng
          {tomTat.ngayCanXuLy > 0 && (
            <span className="inline-flex items-center rounded-full bg-state-warning-soft px-2.5 py-0.5 text-xs font-bold whitespace-nowrap text-state-warning-ink">
              {tomTat.ngayCanXuLy} ngày cần xử lý
            </span>
          )}
          <span className="text-xs font-normal text-muted-foreground">
            nghỉ tách loại · giờ làm · ngày có vấn đề · đơn của tôi
            {congDay.length > 0 ? " · công dạy" : ""}
          </span>
        </summary>

        <div className="grid gap-px border-t border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
          <NhomSo
            tieuDe="Ngày nghỉ tách loại"
            dong={[
              ["Nghỉ phép (P)", `${tomTat.nghiPhep} ngày`],
              ["— trong đó có lương", `${tomTat.nghiPhepCoLuong} ngày`],
              ["— không lương", `${tomTat.nghiPhepKhongLuong} ngày`],
              ["Nghỉ theo ca (X)", `${tomTat.nghiTuan} ngày`],
              ["Nghỉ lễ", `${tomTat.nghiLe} ngày`],
            ]}
          />
          {/* Giờ làm PHẢI đi cặp với kế hoạch. Một mình "120h" không nói được nhiều hay ít —
              nó phụ thuộc tháng ấy xếp bao nhiêu ca, con số người đọc không có sẵn trong
              đầu. Đó là lý do ô này rời hàng đầu xuống đây dưới dạng cặp. */}
          <NhomSo
            tieuDe="Giờ làm"
            dong={[
              ["Thực tế", fmtMin(tomTat.phutLam)],
              ["Theo kế hoạch", fmtMin(tomTat.phutKeHoach)],
              [
                "Chênh lệch",
                tomTat.phutLam === tomTat.phutKeHoach
                  ? "đúng kế hoạch"
                  : `${tomTat.phutLam > tomTat.phutKeHoach ? "+" : "−"}${fmtMin(Math.abs(tomTat.phutLam - tomTat.phutKeHoach))}`,
              ],
              ["Ngày đi công tác", `${tomTat.congTacNgay} ngày`],
              ["— đủ cặp vào/ra", `${tomTat.congTacDuCap} ngày`],
            ]}
          />
          <NhomSo
            tieuDe="Ngày có vấn đề"
            dong={[
              ["Thiếu lượt vào/ra", `${tomTat.thieuLuotNgay} ngày`],
              ["Chưa chấm ngày nào", `${tomTat.chuaCham} ngày`],
              ["Quản lý chỉnh tay công", `${tomTat.ghiDeCong} ngày`],
              ["Tự chỉnh", soHoacGach(tomTat.tuChinh, "đơn")],
            ]}
          />
          <NhomSo
            tieuDe="Đơn của tôi"
            dong={[
              ["Giờ thêm qua đơn duyệt", soHoacGach(tomTat.donChinhDaDuyet, "đơn")],
              ["Đơn chờ duyệt", soHoacGach(tomTat.donChoDuyet, "đơn")],
              ["Đơn bị từ chối", soHoacGach(tomTat.donTuChoi, "đơn")],
            ]}
          />
        </div>

        {/* Đường đi xuống bảng — ĐẶT NGOÀI lưới `NhomSo` vì nó là một HÀNH ĐỘNG, không phải
            một con số. Chỉ hiện khi thật sự có gì để lọc (luật 12: affordance chỉ được hứa
            thứ nó làm được). */}
        {tomTat.ngayCanXuLy > 0 && hrefLoc && (
          <div className="border-t border-border px-4 py-3 sm:px-5">
            <Link href={hrefLoc} scroll={false} className={cn("text-sm", lopA)}>
              {dangLoc
                ? "Bỏ lọc, xem lại tất cả các ca →"
                : `Lọc bảng xuống ${tomTat.ngayCanXuLy} ngày cần xử lý →`}
            </Link>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              Gồm: đi muộn · về sớm · thiếu lượt · sai nơi làm. Nộp đơn chỉnh công được tới
              khi kỳ chốt.
            </p>
          </div>
        )}

        {/* ── CÔNG DẠY — chỉ hiện khi CÓ ─────────────────────────────────── */}
        {(congDay.length > 0 || buoiQuaHan > 0) && (
          <div className="border-t border-border px-4 py-4 sm:px-5">
            <div className="mb-3">
              <h3 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
                Công dạy
              </h3>
              {/* Định nghĩa IN RA, không để người đọc tự suy vì sao hai số khác nhau. */}
              <p className="mt-1 max-w-prose text-[11px] leading-relaxed text-muted-foreground">
                Tách theo loại công dạy, đếm theo NGƯỜI — gồm cả buổi dạy thay ở cơ sở khác.
                Số này khác &ldquo;ngày có ca&rdquo; ở trên: ca là NGÀY được xếp lịch, buổi
                dạy là LẦN đứng lớp, và một ngày có thể có nhiều buổi.
              </p>
            </div>
            {buoiQuaHan > 0 && hrefBuoiQuaHan && (
              <Link
                href={hrefBuoiQuaHan}
                className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-state-warning-soft px-3 py-2 text-sm font-semibold text-state-warning-ink hover:underline"
              >
                {buoiQuaHan} buổi trong tháng này đã qua ngày mà chưa chốt
                <span className="text-xs font-normal">— mở màn Điểm danh để chốt →</span>
              </Link>
            )}
            {/* Số cột theo SỐ DÒNG THẬT, không cố định 4. Lưới `gap-px` trên nền `bg-border`
                vẽ đường kẻ bằng chính nền — nên ô TRỐNG cũng được tô. Với 1 loại công dạy
                (ca thường gặp nhất: chỉ "Lớp chính"), bản cố định `xl:grid-cols-4` in ra một
                ô số rồi BA mảng xám trống bằng 3/4 bề ngang. Ảnh chụp bắt được; tsc và lint
                thì không, vì nó là CSS đúng cú pháp làm đúng thứ nó được bảo. */}
            <div
              className={cn(
                "grid gap-px bg-border",
                congDay.length >= 2 && "sm:grid-cols-2",
                congDay.length >= 3 && "xl:grid-cols-3",
                congDay.length >= 4 && "xl:grid-cols-4",
              )}
            >
              {congDay.map((d) => (
                <div key={d.code} className="bg-card p-3">
                  <p className="text-lg leading-tight font-bold text-foreground tabular-nums">
                    {d.buoi} buổi
                    <span className="ml-2 text-xs font-semibold text-muted-foreground">
                      {d.cong} công
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                    {d.name}
                    {!d.tinhVaoKy && " · không tính vào kỳ"}
                  </p>
                  {d.boQuaThieuGio > 0 && (
                    <p className="mt-1 text-[11px] leading-snug text-state-warning-ink">
                      {d.boQuaThieuGio} buổi chưa có giờ nên chưa tính công
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </details>
    </section>
  );
}
