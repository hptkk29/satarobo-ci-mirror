// Màn Phân công GỘP (GĐ3, docs/phan-cong-gop/KHAO-SAT.md) — phần SERVER: chọn chế độ (tuần sửa / tháng chỉ xem), đọc lưới qua
// `docLuoiGop`, quyết được ghi hay chỉ xem bằng CÙNG cổng với action (`hr_attendance:assign` tại cơ sở + công tắc STAFFING — luật 12).
// Không ô số liệu đầu trang, không tiền (chốt GĐ0). Bảng "theo buổi" cũ vẫn mở được ở `?xem=buoi` (sửa buổi đã qua, tuân thủ buổi dạy,
// bằng chứng chấm công — chưa dời sang lưới; QUYET-DINH-DEM G3-1).
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { hrefWith } from "@/lib/cham-cong/scope-href";
import { checkPermission } from "@/lib/auth/check-permission";
import { trangThaiCongTacTai } from "@/lib/parttime/cong-tac";
import { CAU_RBAC_V2 } from "@/lib/parttime/cong-tac-thuan";
import { docGiaoVienCuaCoSo, nhomTheoCoSo } from "@/lib/teachers/giao-vien-co-so";
import { docLuoiGop } from "@/lib/phan-cong/luoi-gop-db";
import { PageHeader } from "@/components/admin/ui/page-header";
import { PageHelp } from "@/components/admin/ui/page-help";
import { ModuleNav } from "@/components/admin/cham-cong/module-nav";
import { ScopeBar } from "@/components/admin/cham-cong/scope-bar";
import { BTN_OUTLINE } from "@/components/admin/cham-cong/classes";
import type { ModuleScope } from "@/lib/cham-cong/module-scope";
import { duocXuatCuaPhienHienTai } from "@/lib/export/quyen-xuat";
import { ExcelPhanCong } from "../../phan-cong-gv/_components/excel-phan-cong";
import { NutDongBo } from "../../phan-cong-gv/_components/nut-dong-bo";
import { hetThangSau } from "@/lib/phan-cong/giao-go";
import { ApKhungNut } from "./ap-khung-nut";
import { ChonTuan } from "./chon-tuan";
import { LuoiGopThang, LuoiGopTuan } from "./luoi-gop";

const BASE = "/cham-cong/phan-cong";
/** Lối vào màn tháng + bảng theo buổi — `href:` literal để lưới `nav-coverage` thấy. */
const THANG = { href: "/cham-cong/phan-cong/thang" } as const;
const ASSIGN = "hr_attendance:assign";

const ngayCong = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const thuHai = (ymd: string) => ngayCong(ymd, -((new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7));
const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const cuoiThang = (ymd: string) => {
  const [y, m] = ymd.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export async function ManGop(p: {
  scope: ModuleScope;
  khoi: { id: string; label: string }[];
  block: { id: string; label: string };
  ky: string;
  homNay: string;
  /** Ngày đang xem ("YYYY-MM-DD", đã kiểm dạng) — tuần chứa nó, hoặc tháng chứa nó ở chế độ tháng. */
  ngay: string;
  /** "thang" = chế độ tháng (chỉ xem). */
  che: string | undefined;
  /** "userId.ngay.ca" — ô mở sẵn khi đến từ chế độ tháng. */
  o: string | undefined;
}) {
  const coSo = p.block.id;
  const thang = p.che === "thang";
  const tuan = thuHai(p.ngay);
  const tu = thang ? `${p.ngay.slice(0, 7)}-01` : tuan;
  const den = thang ? cuoiThang(tu) : ngayCong(tuan, 6);
  const coSoPhan = [coSo, ...p.scope.blocksWith(ASSIGN).map((b) => b.id).filter((id) => id !== coSo)];
  const tenCoSo = new Map(p.scope.blocks.map((b) => [b.id, b.label]));

  const [luoi, congTac, coQuyen, giaoVienRaw, xuatMau, xuatLuoi] = await Promise.all([
    docLuoiGop({ centerId: coSo, tu, den }),
    trangThaiCongTacTai("STAFFING", { centerId: coSo }),
    checkPermission(ASSIGN, { centerId: coSo }),
    docGiaoVienCuaCoSo(coSoPhan),
    duocXuatCuaPhienHienTai("phan-cong-gv-mau"),
    duocXuatCuaPhienHienTai("phan-cong-gv"),
  ]);
  // Excel (dời từ màn "Phân công giáo viên" cũ): mỗi khối chỉ hiện khi route / action CHẮC nhận (luật 12).
  const coSoXuat = xuatLuoi ? p.scope.blocksWith("hr_attendance:view").map((b) => ({ id: b.id, label: b.label })) : [];
  const lopTrial = luoi.lopTrial;
  const duocGhi = congTac.dung && coQuyen;
  // Hai lý do KHÁC nhau, nói đúng lý do (luật 12): chưa bật công tắc ≠ đã bật mà môi trường còn chạy RBAC v1 (Parttime ghi fail-closed).
  const lyDoChiXem = !congTac.bat
    ? "Cơ sở chưa bật phân công — màn chỉ xem. Quản trị bật ở Cấu hình vận hành → Chấm công."
    : congTac.chan
      ? CAU_RBAC_V2
      : !coQuyen
      ? "Bạn chỉ có quyền xem phân công ở cơ sở này."
      : null;
  const giaoVien = nhomTheoCoSo(giaoVienRaw, coSoPhan).flatMap((n) =>
    n.ds.map((g) => ({ id: g.id, ten: n.centerId === coSo ? (g.name ?? g.id) : `${g.name ?? g.id} (${tenCoSo.get(n.centerId) ?? "cơ sở khác"})` })),
  );
  const giu = { coSo, tuan: thang ? tu : tuan, che: thang ? "thang" : undefined };
  const [ouId, ouNgay, ouCa] = (p.o ?? "").split(".");
  const moSan = !thang && ouId && ouNgay && ouCa ? { userId: ouId, ngay: ouNgay, ca: ouCa } : null;
  const hrefO: Record<string, string> = {};
  if (thang) for (const d of luoi.dong) for (const n of luoi.ngays) for (const ca of luoi.caTheoNgay[n] ?? []) hrefO[`${d.userId}.${n}.${ca}`] = hrefWith(BASE, { coSo, tuan: thuHai(n), o: `${d.userId}.${n}.${ca}` });

  const truocSau = thang
    ? { truoc: `${ngayCong(tu, -1).slice(0, 7)}-01`, sau: ngayCong(den, 1), nhan: `Tháng ${tu.slice(5, 7)}/${tu.slice(0, 4)}` }
    : { truoc: ngayCong(tuan, -7), sau: ngayCong(tuan, 7), nhan: `${dm(tu)} – ${dm(den)}/${den.slice(0, 4)}` };

  return (
    <div className="max-w-6xl 2xl:max-w-none">
      <PageHeader
        className="sm:flex-col xl:flex-row"
        title={`Phân công — ${p.block.label}`}
        subtitle="Ai dạy, ai trợ giảng, ai trực từng buổi S/C/T. Mã ô suy từ phân công + trực; màn này không tính tiền."
        actions={
          <div className="flex flex-wrap gap-2">
            {duocGhi && !thang && <NutDongBo centerId={coSo} tuan={tuan} />}
            {duocGhi && !thang && (
              <ApKhungNut
                centerId={coSo}
                tuanMau={tuan}
                tuDeXuat={ngayCong(tuan, 7)}
                denDeXuat={hetThangSau(ngayCong(tuan, 7))}
                giaoVien={luoi.dong.map((d) => ({ id: d.userId, ten: d.ten }))}
              />
            )}
            <ExcelPhanCong
              coSo={coSo}
              tu={tu}
              den={den}
              mauDuoc={coQuyen && xuatMau}
              nhapDuoc={duocGhi}
              coSoXuat={coSoXuat}
              giaoVien={luoi.dong.map((d) => ({ userId: d.userId, ten: d.ten }))}
            />
            <Link href={hrefWith(BASE, { coSo, tuan, xem: "buoi" })} className={BTN_OUTLINE}>
              Bảng theo buổi
            </Link>
            <Link href={hrefWith(THANG.href, { coSo })} className={BTN_OUTLINE}>
              Công parttime tháng
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        }
      />
      <ModuleNav active="phancong" scope={p.scope} ctx={{ ky: p.ky, coSo }} />
      <ScopeBar
        basePath={BASE}
        blocks={p.khoi.map((b) => ({ id: b.id, label: b.label }))}
        coSo={coSo}
        keep={thang ? { tuan: tu, che: "thang" } : { tuan }}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Chế độ xem" className="inline-flex rounded-lg border border-border bg-card p-0.5 text-sm">
              <Link href={hrefWith(BASE, { coSo, tuan })} aria-current={!thang ? "page" : undefined} className={!thang ? "rounded-md bg-primary px-3 py-1.5 text-primary-foreground" : "rounded-md px-3 py-1.5 text-muted-foreground"}>
                Tuần
              </Link>
              <Link href={hrefWith(BASE, { coSo, tuan: p.ngay, che: "thang" })} aria-current={thang ? "page" : undefined} className={thang ? "rounded-md bg-primary px-3 py-1.5 text-primary-foreground" : "rounded-md px-3 py-1.5 text-muted-foreground"}>
                Tháng
              </Link>
            </div>
            <ChonTuan
              nhan={truocSau.nhan}
              truoc={hrefWith(BASE, { ...giu, tuan: truocSau.truoc })}
              sau={hrefWith(BASE, { ...giu, tuan: truocSau.sau })}
              tuanNay={(thang ? p.homNay.slice(0, 7) === tu.slice(0, 7) : thuHai(p.homNay) === tuan) ? null : hrefWith(BASE, { ...giu, tuan: undefined })}
            />
          </div>
        }
      />
      <PageHelp>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Mỗi ô là một giáo viên × một ngày × một buổi. Mã: <b>T</b> trực · <b>D</b> đứng chính · <b>TG</b> trợ giảng · <b>TD/TTG</b> dạy trong ca
            trực · <b>D2, D+TG, D3…</b> nhiều tiết · <b>+TR</b> có Trial · <b>!</b> trùng giờ.
          </li>
          <li>Bấm ô để xem cặp quét phải có trong ngày, đổi người, giao / gỡ trực. Bấm tên ngày để xem mọi buổi trong ngày.</li>
          <li>Giao là có hiệu lực ngay — giáo viên không phải bấm nhận. “Các tuần sau” áp cho cùng thứ tới hết tháng sau.</li>
          <li>Học bù / Trial đổi người ở module gốc. Buổi học bù / Trial mà ca đó không ai trực được đánh dấu đỏ.</li>
          {thang && <li>Chế độ tháng chỉ để xem — bấm một ô để về đúng tuần đó và sửa.</li>}
        </ul>
      </PageHelp>
      {luoi.dong.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Cơ sở chưa có giáo viên nào để xếp.</p>
      ) : thang ? (
        <LuoiGopThang luoi={luoi} hrefO={hrefO} />
      ) : (
        <LuoiGopTuan luoi={luoi} lopTrial={lopTrial} giaoVien={giaoVien} coSo={coSo} duocGhi={duocGhi} lyDoChiXem={lyDoChiXem} moSan={moSan} />
      )}
    </div>
  );
}
