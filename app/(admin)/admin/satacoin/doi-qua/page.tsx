import { redirect } from "next/navigation";

import { PageHeader } from "@/components/admin/ui/page-header";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { resolveActor } from "@/lib/auth/actor";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { getModelVisibleCenterIds, scopedDb } from "@/lib/db-scope";
import { formatDateVN } from "@/lib/format/date";
import { bangHanMucGiaoVien } from "@/lib/satacoin/han-muc";
import { cn } from "@/lib/utils";

import { coSoNhapKho } from "./_actions";
import { FormHanMuc, FormQua, FormTonKho, NutXuLy } from "./_components/thao-tac";

export const metadata = { title: "Đổi quà SataCoin | Admin" };
export const dynamic = "force-dynamic";

// WP8 (19/11/2026) — màn nhân sự ĐỔI QUÀ: yêu cầu chờ trung tâm xử lý · danh mục quà + tồn kho theo cơ sở · hạn mức giáo viên (chỉ Admin).
// «Trung tâm duyệt» (OD-02): người duyệt là nhân sự có `satacoin:redeem`, KHÔNG phải phụ huynh. Mọi yêu cầu/tồn kho đọc qua `scopedDb` ⇒ tự cắt theo cơ sở.

const TRANG_THAI: Record<string, { nhan: string; mau: string }> = {
  REQUESTED: { nhan: "Chờ duyệt", mau: "bg-amber-100 text-amber-900" },
  APPROVED: { nhan: "Đã duyệt — chờ giao", mau: "bg-sky-100 text-sky-900" },
  DELIVERED: { nhan: "Đã giao", mau: "bg-emerald-100 text-emerald-900" },
  REJECTED: { nhan: "Đã từ chối", mau: "bg-rose-100 text-rose-900" },
  CANCELLED: { nhan: "Phụ huynh đã huỷ", mau: "bg-muted text-muted-foreground" },
};

export default async function DoiQuaPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const [coRedeem, coQuota, coCatalog] = await Promise.all([checkPermission("satacoin:redeem"), checkPermission("satacoin:quota"), checkPermission("satacoin:catalog")]);
  if (!coRedeem && !coQuota) redirect("/dashboard");

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const thayCoSo = getModelVisibleCenterIds("SataCoinGiftStock", actor);
  const bayGio = new Date();

  const [yeuCau, qua, coSo, giaoVien] = await Promise.all([
    coRedeem
      ? sdb.sataCoinRedemption.findMany({ orderBy: { createdAt: "desc" }, take: 60, select: { id: true, status: true, coinCost: true, createdAt: true, decisionNote: true, gift: { select: { name: true } }, student: { select: { name: true, studentCode: true } } } })
      : Promise.resolve([]),
    coRedeem ? sdb.sataCoinGift.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, description: true, coinCost: true, isActive: true, sortOrder: true, stocks: { where: thayCoSo === "ALL" ? {} : { centerId: { in: thayCoSo } }, select: { centerId: true, quantity: true } } } }) : Promise.resolve([]),
    coRedeem ? coSoNhapKho() : Promise.resolve([]),
    coQuota ? sdb.user.findMany({ where: { deletedAt: null, OR: [{ role: "TEACHER" }, { roles: { has: "TEACHER" } }] }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const tenCoSo = new Map(coSo.map((c) => [c.id, c.name]));
  const bang = await bangHanMucGiaoVien(giaoVien.map((g) => g.id), bayGio);
  const hanMuc = giaoVien.map((g) => ({ ...g, cap: bang.get(g.id)?.cap ?? null, daDung: bang.get(g.id)?.daDung ?? 0 }));
  const choXuLy = yeuCau.filter((y) => y.status === "REQUESTED" || y.status === "APPROVED");

  return (
    <div className="space-y-8">
      <PageHeader title="Đổi quà SataCoin" subtitle="Trung tâm duyệt và giao quà. Coin được GIỮ khi phụ huynh gửi yêu cầu và chỉ bị trừ khi bạn bấm «Đã giao quà». Từ chối hoặc huỷ sẽ hoàn coin và tồn kho." />

      {coRedeem ? (
        <>
          <section aria-labelledby="yc" className="space-y-3">
            <h2 id="yc" className="text-base font-semibold">
              Yêu cầu đổi quà <span className="text-sm font-normal text-muted-foreground">({choXuLy.length} đang chờ xử lý)</span>
            </h2>
            <div className="rounded-xl border border-border bg-card">
              <PhanTrangBang cuonNgang tenDonVi="yêu cầu" classThanh="px-4 pb-3">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className={adminTh}>Học viên</th>
                    <th className={adminTh}>Quà</th>
                    <th className={cn(adminTh, "text-right")}>Coin</th>
                    <th className={adminTh}>Gửi lúc</th>
                    <th className={adminTh}>Trạng thái</th>
                    <th className={adminTh}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {yeuCau.length === 0 ? (
                    <tr>
                      <td className={cn(adminTd, "text-muted-foreground")} colSpan={6}>
                        Chưa có yêu cầu đổi quà nào.
                      </td>
                    </tr>
                  ) : (
                    yeuCau.map((y) => (
                      <tr key={y.id} className={adminTr}>
                        <td className={adminTd}>
                          {y.student.name}
                          {y.student.studentCode ? <span className="ml-1 text-xs text-muted-foreground">{y.student.studentCode}</span> : null}
                        </td>
                        <td className={adminTd}>{y.gift.name}</td>
                        <td className={cn(adminTd, "text-right tabular-nums")}>{y.coinCost.toLocaleString("vi-VN")}</td>
                        <td className={adminTd}>{formatDateVN(y.createdAt)}</td>
                        <td className={adminTd}>
                          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", TRANG_THAI[y.status]?.mau)}>{TRANG_THAI[y.status]?.nhan ?? y.status}</span>
                          {y.decisionNote ? <span className="ml-2 text-xs text-muted-foreground">{y.decisionNote}</span> : null}
                        </td>
                        <td className={adminTd}>{y.status === "REQUESTED" || y.status === "APPROVED" ? <NutXuLy redemptionId={y.id} trangThai={y.status} /> : <span className="text-xs text-muted-foreground">—</span>}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              </PhanTrangBang>
            </div>
          </section>

          <section aria-labelledby="qua" className="space-y-3">
            <h2 id="qua" className="text-base font-semibold">
              Danh mục quà &amp; tồn kho
            </h2>
            {coCatalog ? (
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="mb-2 text-sm font-medium">Thêm quà mới</p>
                <FormQua />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Danh mục quà (tên, giá coin, bật/tắt) dùng chung toàn hệ thống và do quản trị hệ thống chỉnh. Bạn quản lý tồn kho của cơ sở mình.</p>
            )}
            <div className="space-y-3">
              {qua.map((g) => (
                <div key={g.id} className="rounded-xl border border-border bg-card p-4">
                  {coCatalog ? (
                    <FormQua qua={g} />
                  ) : (
                    <p className="text-sm">
                      <span className="font-medium">{g.name}</span> · {g.coinCost.toLocaleString("vi-VN")} coin · {g.isActive ? "Đang mở" : "Đang tắt"}
                    </p>
                  )}
                  <p className="mt-3 text-xs text-muted-foreground">
                    Tồn kho (còn lại sau khi trừ phần đang giữ chỗ):{" "}
                    {g.stocks.length === 0 ? "chưa nhập" : g.stocks.map((s) => `${tenCoSo.get(s.centerId) ?? s.centerId}: ${s.quantity}`).join(" · ")}
                  </p>
                  <div className="mt-2">
                    <FormTonKho giftId={g.id} coSo={coSo} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}

      {coQuota ? (
        <section aria-labelledby="hm" className="space-y-3">
          <h2 id="hm" className="text-base font-semibold">
            Hạn mức cộng/trừ của giáo viên (mỗi tháng)
          </h2>
          <p className="text-sm text-muted-foreground">Giáo viên chỉ cộng/trừ cho học viên mình phụ trách và trong hạn mức. Chưa đặt hạn mức = giáo viên chưa cộng/trừ được. Quản lý cơ sở và Admin không bị giới hạn này.</p>
          <div className="rounded-xl border border-border bg-card">
            <PhanTrangBang cuonNgang tenDonVi="giáo viên" classThanh="px-4 pb-3">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className={adminTh}>Giáo viên</th>
                  <th className={cn(adminTh, "text-right")}>Đã dùng tháng này</th>
                  <th className={adminTh}>Hạn mức/tháng</th>
                </tr>
              </thead>
              <tbody>
                {hanMuc.map((g) => (
                  <tr key={g.id} className={adminTr}>
                    <td className={adminTd}>{g.name}</td>
                    <td className={cn(adminTd, "text-right tabular-nums")}>{g.daDung.toLocaleString("vi-VN")}</td>
                    <td className={adminTd}>
                      <FormHanMuc teacherUserId={g.id} capHienTai={g.cap} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </PhanTrangBang>
          </div>
        </section>
      ) : null}
    </div>
  );
}
