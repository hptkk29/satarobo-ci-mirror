// app/(admin)/admin/cham-cong/phan-cong/page.tsx — PHÂN CÔNG BUỔI · Control Tower của QLCS (SR.QD.238 · P2 → P3b).
//
// Một câu hỏi: tuần này, buổi nào đã đủ người ĐÃ NHẬN LỚP, buổi nào còn phải xếp, buổi nào đang lệch. QLCS phân / đổi /
// huỷ / nhắc ở đây; giáo viên và trợ giảng tự nhận hoặc từ chối ở site giáo viên — KHÔNG có nút "xác nhận thay".
//
// Đây KHÔNG phải màn công hay tiền: chưa có WorkUnit nào sinh ra từ phân công (P5). Cột "Chấm công" là BẰNG CHỨNG để
// xem, chưa ràng buộc lượt quẹt với buổi (P4). Ai thật sự đứng lớp vẫn đọc ở `giaoVienDuocQuyCong` (luật 11/10).
//
// Mọi phán đoán đi qua hàm thuần: trạng thái nhân lực / yêu cầu TA (`phan-cong.ts`), mặc định + tình trạng buổi (CÙNG hàm
// với bộ đồng bộ), thẻ số + bộ lọc + cảnh báo + xem trước (`control-tower.ts`).
import { redirect } from "next/navigation";
import Link from "next/link";
import { CircleCheck, Clock3, RefreshCw, ThumbsDown, UserRoundX, Users, UsersRound } from "lucide-react";
import { auth } from "@/lib/auth";
import { ASK_WHO, loadModuleScope, type ModuleAction } from "@/lib/cham-cong/module-scope";
import { hrefWith } from "@/lib/cham-cong/scope-href";
import { currentPeriodKey } from "@/lib/cham-cong/period";
import { docTuanPhanCong, tenNguoi } from "@/lib/parttime/bang-phan-cong";
import { docBangChungCong } from "@/lib/parttime/bang-chung-cong-db";
import { nhanBangChung, type NhanBangChung } from "@/lib/parttime/nhan-bang-chung";
import { canhBaoBuoi, canhBaoTuBangChung, demThe, laMaThe, THE, xemTruocKhoiDong, type MaThe } from "@/lib/parttime/control-tower";
import { phanCongBat } from "@/lib/parttime/phan-cong-db";
import { getAssignableTeachers } from "@/lib/teachers/assignable";
import { checkPermission } from "@/lib/auth/check-permission";
import { vnYmd } from "@/lib/time/vn";
import { PageHeader } from "@/components/admin/ui/page-header";
import { PageHelp } from "@/components/admin/ui/page-help";
import { NoPermission } from "@/components/admin/ui/states";
import { ModuleNav } from "@/components/admin/cham-cong/module-nav";
import { ScopeBar } from "@/components/admin/cham-cong/scope-bar";
import { KpiStrip, type KpiItem } from "@/components/admin/cham-cong/kpi-strip";
import { BangTuan, type NgayTrongTuan } from "./_components/bang-tuan";
import { ChonTuan } from "./_components/chon-tuan";

export const metadata = { title: "Phân công buổi | Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

const VIEW: ModuleAction = "hr_attendance:view";
const ASSIGN: ModuleAction = "hr_attendance:assign";
const BASE = "/cham-cong/phan-cong";
/** Lối vào DUY NHẤT của màn tháng — `href:` là chuỗi literal để lưới `nav-coverage` thấy. */
const THANG = { href: "/cham-cong/phan-cong/thang" } as const;

/** Thứ Hai của tuần chứa `ymd` (giờ VN — `ymd` đã là ngày VN). */
function thuHai(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  const thu = (d.getUTCDay() + 6) % 7; // 0 = Thứ Hai
  d.setUTCDate(d.getUTCDate() - thu);
  return d.toISOString().slice(0, 10);
}
function congNgay(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const THU = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ nhật"];

const ICON: Record<MaThe, KpiItem["icon"]> = {
  tong: Users,
  du: CircleCheck,
  "cho-xac-nhan": Clock3,
  "thieu-gv": UserRoundX,
  "thieu-ta": UsersRound,
  "tu-choi": ThumbsDown,
  "phan-lai": RefreshCw,
};

export default async function PhanCongPage({
  searchParams,
}: {
  searchParams: Promise<{ coSo?: string; tuan?: string; loc?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fcham-cong%2Fphan-cong");
  const sp = await searchParams;
  const scope = await loadModuleScope(session.user.id);
  const now = new Date();
  const homNay = vnYmd(now);
  const tuan = thuHai(sp.tuan && /^\d{4}-\d{2}-\d{2}$/.test(sp.tuan) ? sp.tuan : homNay);
  const denNgay = congNgay(tuan, 6);
  const ky = currentPeriodKey();

  const visible = scope.blocksWith(VIEW);
  const coTheXem = visible.length > 0 || scope.any(ASSIGN);
  if (!coTheXem) {
    return (
      <div className="max-w-6xl">
        <PageHeader title="Phân công buổi" />
        <ModuleNav active="phancong" scope={scope} ctx={{ ky, coSo: sp.coSo ?? null }} />
        <NoPermission permission={VIEW} what="phân công buổi" askWho={ASK_WHO[VIEW]} />
      </div>
    );
  }
  const khoi = visible.length > 0 ? visible : scope.blocksWith(ASSIGN);
  const block = scope.pick(sp.coSo, VIEW) ?? scope.pick(sp.coSo, ASSIGN) ?? khoi[0];
  const coSo = block.id;
  const loc: MaThe | null = laMaThe(sp.loc) && sp.loc !== "tong" ? sp.loc : null;

  const [buoi, bc, bat, coQuyen, giaoVien] = await Promise.all([
    docTuanPhanCong({ centerId: coSo, tu: tuan, den: denNgay }),
    // Bằng chứng chấm công P4 — MỘT định nghĩa (khung phải có mặt + dung sai parttime riêng). Chưa tính công.
    docBangChungCong({ centerId: coSo, tu: tuan, den: denNgay, now }),
    phanCongBat(),
    checkPermission(ASSIGN, { centerId: coSo }),
    getAssignableTeachers({ centerIds: [coSo] }),
  ]);
  const nhanTheoPc: Record<string, NhanBangChung> = {};
  for (const r of bc.phanCong) {
    const n = nhanBangChung(r);
    if (n) nhanTheoPc[r.assignmentId] = n;
  }
  const ngoaiLeTheoBuoi = new Map<string, typeof bc.buoi>();
  for (const x of bc.buoi) {
    const k = `${x.sourceType}:${x.sourceId}`;
    ngoaiLeTheoBuoi.set(k, [...(ngoaiLeTheoBuoi.get(k) ?? []), x]);
  }
  const tenKhongGan = await tenNguoi(bc.luotKhongGan.map((x) => x.userId));

  // Thẻ số và bộ lọc: CÙNG vị từ `THE[ma].khop` — đếm một đằng lọc một nẻo là thẻ nói dối.
  const dem = demThe(buoi);
  const hienThi = (loc ? buoi.filter((b) => THE[loc].khop(b)) : buoi).map((b) => ({
    ...b,
    canhBao: [...canhBaoBuoi(b, now), ...canhBaoTuBangChung(ngoaiLeTheoBuoi.get(b.key) ?? [])],
    bangChung: Object.fromEntries([b.main, b.ta].flatMap((pc) => (pc && nhanTheoPc[pc.id] ? [[pc.id, nhanTheoPc[pc.id]]] : []))),
  }));
  const xemTruoc = xemTruocKhoiDong(buoi);

  const ngays: NgayTrongTuan[] = Array.from({ length: 7 }, (_, i) => {
    const ngay = congNgay(tuan, i);
    return { ngay, nhan: `${THU[i]} ${dm(ngay)}`, homNay: ngay === homNay, buoi: hienThi.filter((b) => b.ngay === ngay) };
  }).filter((n) => n.buoi.length > 0);

  const giu = { coSo, tuan, loc: loc ?? undefined };
  const coLegacy = buoi.some((b) => !b.apDung);
  // "Dựng từ giáo viên của lớp" = đúng các buổi mà bộ đồng bộ sẽ TẠO phân công (cùng planner với nút) — đếm và nhãn
  // không thể nói khác thứ nút làm.
  const canDung = buoi.filter((b) => b.apDung && b.tinhTrang === "MO" && b.keHoach.some((x) => x.loai === "TAO"));

  const theSo: KpiItem[] = (["tong", "du", "cho-xac-nhan", "thieu-gv", "thieu-ta", "tu-choi", "phan-lai"] as const).map((m) => ({
    icon: ICON[m],
    value: dem[m],
    label: THE[m].nhan,
    tone: m === "tong" ? "brand" : m === "du" ? "success" : dem[m] === 0 ? "success" : m === "cho-xac-nhan" ? "warning" : "danger",
    href: hrefWith(BASE, { ...giu, loc: m === "tong" ? undefined : m }),
    dangChon: m === "tong" ? loc === null : loc === m,
  }));

  return (
    <div className="max-w-6xl 2xl:max-w-none">
      <PageHeader
        title={`Phân công buổi — ${block.label}`}
        subtitle="Ai đứng lớp, ai trợ giảng từng buổi, họ đã tự nhận chưa, và buổi nào đang lệch. Màn này chưa tính công hay tiền."
        actions={
          <Link href={hrefWith(THANG.href, { coSo })} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
            Công tháng & đối soát →
          </Link>
        }
      />

      <ModuleNav active="phancong" scope={scope} ctx={{ ky, coSo }} />

      <ScopeBar
        basePath={BASE}
        blocks={khoi.map((b) => ({ id: b.id, label: b.label }))}
        coSo={coSo}
        keep={{ tuan }}
        right={
          <ChonTuan
            nhan={`${dm(tuan)} – ${dm(denNgay)}/${denNgay.slice(0, 4)}`}
            truoc={hrefWith(BASE, { ...giu, tuan: congNgay(tuan, -7) })}
            sau={hrefWith(BASE, { ...giu, tuan: congNgay(tuan, 7) })}
            tuanNay={thuHai(homNay) === tuan ? null : hrefWith(BASE, { ...giu, tuan: undefined })}
          />
        }
      />

      {!bat && (
        <div className="mb-4 rounded-lg border border-state-warning-ink/30 bg-state-warning-soft px-3 py-2.5 text-sm text-state-warning-ink">
          <p>
            <b>Phân công theo buổi chưa bật.</b> Màn này đang chỉ để xem — chưa phân được ai. Quản trị bật ở Cấu hình vận
            hành → Chấm công, sau khi Ban giám đốc chốt cách chuyển đổi.
          </p>
          {xemTruoc.soBuoi > 0 && (
            <p className="mt-1.5">
              <b>Xem trước nếu bật (tuần này, chỉ đọc):</b> {xemTruoc.soBuoi} buổi cần đội hình · dựng{" "}
              <b className="tabular-nums">{xemTruoc.dungMain}</b> giáo viên đứng chính · <b className="tabular-nums">{xemTruoc.dungTa}</b>{" "}
              trợ giảng · <b className="tabular-nums">{xemTruoc.loiMoi}</b> lời mời xác nhận
              {xemTruoc.ngoaiLe > 0 ? <> · <b className="tabular-nums">{xemTruoc.ngoaiLe}</b> ngoại lệ cần xem tay</> : null}.
            </p>
          )}
        </div>
      )}

      <PageHelp>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Mỗi buổi cần <b>giáo viên đứng chính</b>; lớp <b>Sata 3 từ 7 học viên</b>, <b>Sata 4–7 từ 9 học viên</b> cần
            thêm <b>trợ giảng</b> (quy định SR.QD.238). Lớp khác do quản lý cơ sở quyết — chỉnh ở “Yêu cầu trợ giảng”.
          </li>
          <li>Người được phân phải <b>tự nhận</b> trên site giáo viên (“Công việc của tôi”). Từ chối thì buổi về “Cần phân lại”.</li>
          <li>Đổi ngày giờ buổi học ⇒ người được phân phải nhận lại; đổi ghi chú thì không.</li>
          <li>
            Nhãn chấm công cạnh mỗi người là <b>bằng chứng để đối soát</b>: so lượt quẹt với giờ phải có mặt (giờ bắt đầu
            trừ thời gian chuẩn bị) tới giờ kết thúc buổi — đi muộn, ra sớm, thiếu lượt ra, sai người đứng lớp. Chưa tính công.
          </li>
          <li>Buổi trước 15/10/2026 thuộc chính sách cũ — hiện để đối chiếu, không phân công.</li>
        </ul>
      </PageHelp>

      <KpiStrip cols={7} items={theSo} />

      <BangTuan
        ngays={ngays}
        giaoVien={giaoVien.map((g) => ({ id: g.id, ten: g.name ?? g.id }))}
        quyen={{ bat, coQuyen }}
        dangLoc={loc ? { nhan: THE[loc].nhan, boLoc: hrefWith(BASE, { ...giu, loc: undefined }) } : null}
        coLegacy={coLegacy}
        dungMacDinh={bat && coQuyen ? canDung.map((b) => ({ sourceType: b.sourceType, sourceId: b.sourceId })) : []}
      />

      {bc.luotKhongGan.length > 0 && (
        <details className="mt-4 rounded-lg border border-border bg-card px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium text-foreground">
            Có mặt ngoài phân công · {bc.luotKhongGan.length} lượt
            <span className="ml-2 font-normal text-muted-foreground">— không phải lỗi (trực, họp, việc khác); chỉ để rà</span>
          </summary>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {bc.luotKhongGan.map((x) => (
              <li key={`${x.userId}-${x.inId}`} className="tabular-nums">
                <span className="text-foreground">{tenKhongGan.get(x.userId) ?? x.userId}</span> · {dm(x.workDate)} ·{" "}
                {x.tu.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" })}–
                {x.den ? x.den.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" }) : "chưa ra"}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
