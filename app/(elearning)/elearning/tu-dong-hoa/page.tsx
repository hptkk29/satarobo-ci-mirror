import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { HANH_DONG_BI_CAM } from "@/lib/elearning/automation";
import { RuleToggle } from "./_components/rule-toggle";
import { RuleForm } from "./_components/rule-form";
import { PathForm } from "./_components/path-form";

/**
 * EL-18 — CỖ MÁY TỰ ĐỘNG HOÁ: luật, lộ trình, và nhật ký thi hành.
 *
 * ⚠️ Nhật ký ghi CẢ những lần BỎ QUA, không chỉ những lần làm. Một cỗ máy chỉ ghi lúc
 * nó làm gì đó là một cỗ máy không giải thích được vì sao nó KHÔNG làm — và "vì sao
 * tôi không được giao khoá đó" là câu hỏi sẽ được hỏi.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tự động hoá | Sata Robo",
  robots: { index: false, follow: false },
};

const NHAN_KICH_HOAT: Record<string, string> = {
  NHAN_SU_MOI: "Nhân sự mới",
  KHOA_HOAN_THANH: "Hoàn thành một khoá",
  CHUNG_NHAN_HET_HAN: "Chứng nhận hết hiệu lực",
  YEU_CAU_MOI_AP_DUNG: "Yêu cầu mới áp dụng",
};

const NHAN_HANH_DONG: Record<string, string> = {
  GIAO_KHOA: "Giao một khoá",
  GIAO_LO_TRINH: "Giao trọn lộ trình",
  GUI_NHAC: "Gửi nhắc",
};

const NHAN_KET_QUA: Record<string, { chu: string; lop: string }> = {
  APPLIED: { chu: "Đã thi hành", lop: "bg-emerald-100 text-emerald-900" },
  SKIPPED: { chu: "Bỏ qua", lop: "bg-muted text-muted-foreground" },
  FAILED: { chu: "Lỗi", lop: "bg-rose-100 text-rose-900" },
};

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center text-sm">
        Đăng nhập rồi mở lại trang này.
      </div>
    );
  }
  const actor = await resolveActor(session.user.id);
  const duocSua = can(actor, "elearning:program:manage");
  if (!duocSua && !can(actor, "elearning:progress:view-all")) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-bold">Không có quyền xem</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Cỗ máy tự động hoá thuộc phòng Đào tạo.
        </p>
        <Link href="/elearning" className="mt-6 inline-block underline">
          Về trang chủ khu đào tạo
        </Link>
      </div>
    );
  }

  const db = scopedDb(actor);

  const luat = await db.trnAutomationRule.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      code: true,
      title: true,
      trigger: true,
      action: true,
      enabled: true,
      dueDays: true,
    },
    orderBy: [{ enabled: "desc" }, { createdAt: "desc" }],
    take: 100,
  });

  const loTrinh = await db.trnLearningPath.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      code: true,
      title: true,
      sequential: true,
      _count: { select: { steps: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const nhatKy = await db.trnAutomationLog.findMany({
    select: {
      id: true,
      ruleId: true,
      subjectUserId: true,
      outcome: true,
      detail: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // Dữ liệu cho hai form soạn — chỉ nạp khi người xem SỬA được (đọc qua scopedDb nên chỉ thấy khoá
  // trong tầm nhìn cơ sở của họ; khoá dùng chung centerId = null vẫn hiện, đúng NULL_IS_GLOBAL).
  const khoaChoForm = duocSua
    ? await db.trnCourse.findMany({
        where: { deletedAt: null, status: "PUBLISHED" },
        select: { id: true, title: true },
        orderBy: { title: "asc" },
        take: 300,
      })
    : [];
  const phongBanChoForm = duocSua
    ? await db.departmentDef.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { displayOrder: "asc" },
        take: 100,
      })
    : [];

  const tenLuat = new Map(luat.map((l) => [l.id, l.title] as const));
  const tenNguoi = new Map(
    nhatKy.length === 0
      ? []
      : (
          await db.user.findMany({
            where: { id: { in: [...new Set(nhatKy.map((n) => n.subjectUserId))] } },
            select: { id: true, name: true },
          })
        ).map((u) => [u.id, u.name ?? "(không rõ tên)"] as const),
  );

  const soLoi = nhatKy.filter((n) => n.outcome === "FAILED").length;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <nav className="text-xs text-muted-foreground">
        <Link href="/elearning" className="underline">
          Khoá của tôi
        </Link>
        {" · "}
        <Link href="/elearning/yeu-cau" className="underline">
          Yêu cầu đào tạo
        </Link>
      </nav>

      <div>
        <h1 className="text-2xl font-bold">Tự động hoá</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Kích hoạt → điều kiện → hành động. Mọi luật đều trả lời được &ldquo;vì sao
          người này được giao khoá đó&rdquo; bằng một câu, không bằng một điểm số.
        </p>
      </div>

      <p className="rounded-md bg-muted px-3 py-2 text-xs">
        {/* Nói ra rằng module KHÔNG có hành động chế tài, và vì sao — người vận hành
            đi tìm nó cần biết đây là quyết định, không phải thiếu sót. */}
        <strong>Không có hành động chế tài.</strong> Danh sách hành động cố ý không có{" "}
        {HANH_DONG_BI_CAM.length} thứ như gắn cờ hồ sơ nhân sự hay trừ điểm đánh giá:
        QĐ-CDA-06 chốt module chạy chế độ chỉ báo cáo, &ldquo;không leo thang kỷ luật ở
        bất kỳ giá trị cấu hình nào&rdquo;. Chúng vắng mặt trong mã, không phải bị tắt
        bằng một cờ — cờ tắt được thì bật được.
      </p>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Luật ({luat.length})</h2>
        {duocSua ? (
          <RuleForm
            khoa={khoaChoForm}
            loTrinh={loTrinh.map((t) => ({ id: t.id, title: t.title, soBuoc: t._count.steps }))}
            phongBan={phongBanChoForm}
          />
        ) : null}
        {luat.length === 0 ? (
          <p className="rounded-md bg-muted px-3 py-2 text-sm">
            Chưa có luật nào. Cỗ máy đang không làm gì cả — đó là trạng thái mặc định.
          </p>
        ) : (
          <ul className="space-y-2">
            {luat.map((l) => (
              <li key={l.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {l.title}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {l.code}
                    </span>
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      l.enabled
                        ? "bg-emerald-100 text-emerald-900"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {l.enabled ? "Đang bật" : "Đang tắt"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Khi <strong>{NHAN_KICH_HOAT[String(l.trigger)]}</strong> →{" "}
                  <strong>{NHAN_HANH_DONG[String(l.action)]}</strong>, hạn {l.dueDays}{" "}
                  ngày.
                </p>
                {duocSua ? (
                  <div className="mt-2">
                    <RuleToggle ruleId={l.id} dangBat={l.enabled} ten={l.title} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Lộ trình ({loTrinh.length})</h2>
        {duocSua ? <PathForm khoa={khoaChoForm} /> : null}
        {loTrinh.length === 0 ? (
          <p className="rounded-md bg-muted px-3 py-2 text-sm">
            Chưa có lộ trình nào.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {loTrinh.map((t) => (
              <li key={t.id} className="rounded-md border p-2">
                {t.title}
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {t.code}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {t._count.steps} bước · {t.sequential ? "tuần tự" : "giao một lượt"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Nhật ký thi hành</h2>
        <p className="text-xs text-muted-foreground">
          Ghi cả những lần BỎ QUA kèm lý do — đây là chỗ trả lời câu &ldquo;vì sao tôi
          không được giao khoá đó&rdquo;.
          {soLoi > 0 ? (
            <span className="ml-1 font-medium text-rose-700">
              {soLoi} dòng lỗi trong 100 dòng gần nhất.
            </span>
          ) : null}
        </p>
        {nhatKy.length === 0 ? (
          <p className="rounded-md bg-muted px-3 py-2 text-sm">
            Chưa có lần thi hành nào.
          </p>
        ) : (
          <PhanTrangBang cuonNgang tenDonVi="dòng" soDongMacDinh={25}>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3">Lúc</th>
                  <th className="py-2 pr-3">Luật</th>
                  <th className="py-2 pr-3">Người</th>
                  <th className="py-2 pr-3">Kết quả</th>
                  <th className="py-2 pr-3">Chi tiết</th>
                </tr>
              </thead>
              <tbody>
                {nhatKy.map((n) => {
                  const k = NHAN_KET_QUA[String(n.outcome)] ?? NHAN_KET_QUA.SKIPPED!;
                  return (
                    <tr key={n.id} className="border-b align-top">
                      <td className="py-2 pr-3 text-xs">
                        {n.createdAt.toLocaleString("vi-VN")}
                      </td>
                      <td className="py-2 pr-3">{tenLuat.get(n.ruleId) ?? "(đã xoá)"}</td>
                      <td className="py-2 pr-3">
                        {tenNguoi.get(n.subjectUserId) ?? "(không rõ)"}
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`rounded px-2 py-0.5 text-xs ${k.lop}`}>
                          {k.chu}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-xs">{n.detail}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </PhanTrangBang>
        )}
      </section>
    </div>
  );
}
