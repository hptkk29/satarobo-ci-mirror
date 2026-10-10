import Link from "next/link";
import { redirect } from "next/navigation";
import { UserCog } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { danhSachPhanCong, nguoiCoTheGan } from "@/lib/crm/commission-assignee-store";
import { PhanCongBang } from "./_components/phan-cong-bang";

export const dynamic = "force-dynamic";
export const metadata = { title: "Người hưởng hoa hồng theo cơ sở | Admin" };

export default async function NguoiHuongPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Gate RIÊNG, không mượn `payments:manage` (kế toán) hay `centers:edit` (sửa hồ sơ
  // cơ sở) — xem lý do ở đầu `actions.ts`.
  if (!(await checkPermission("commission-assignee:manage"))) redirect("/admin/dashboard");

  const at = new Date();
  const [coSo, nguoi] = await Promise.all([danhSachPhanCong(at), nguoiCoTheGan()]);

  const duLieu = coSo.map((c) => ({
    centerId: c.centerId,
    centerName: c.centerName,
    centerCode: c.centerCode,
    managerName: c.managerName,
    managerUserLabel: c.managerUserName,
    lechQuanLy: c.lechQuanLy,
    soQc: c.dangHieuLuc.QC.length,
    soQlTt: c.dangHieuLuc.QL_TT.length,
    dong: c.lichSu.map((d) => ({
      id: d.id,
      role: d.role,
      userId: d.userId,
      userLabel: d.userName ?? d.userEmail ?? d.userId,
      tuNgay: d.effectiveFrom.toISOString(),
      denNgay: d.effectiveTo ? d.effectiveTo.toISOString() : null,
      dangHieuLuc: d.effectiveFrom <= at && (d.effectiveTo == null || at < d.effectiveTo),
    })),
  }));

  return (
    <div>
      <h1 className="mb-2 flex items-center gap-2 text-3xl font-black text-foreground">
        <UserCog className="h-7 w-7 text-primary" />
        Người hưởng hoa hồng theo cơ sở
      </h1>
      <div className="mb-6 space-y-2 rounded-lg border bg-muted/40 p-4 text-sm">
        <p>
          Hai tầng hoa hồng gắn theo <strong>cơ sở</strong> chứ không theo phễu khách:{" "}
          <strong>Quảng cáo (QC) 1%</strong> và <strong>Quản lý trung tâm 2%</strong>. Cơ sở nào
          chưa khai thì phần đó <strong>treo</strong> — hệ thống cố ý không đoán người hưởng.
        </p>
        <ul className="ml-4 list-disc text-muted-foreground">
          <li>
            Người hưởng được chốt theo <strong>thời điểm kế toán xác nhận thu tiền</strong>. Đổi
            người phụ trách hôm nay <strong>không</strong> viết lại hoa hồng các kỳ đã tính.
          </li>
          <li>
            Một cơ sở có nhiều QC thì <strong>1% chia đều</strong> — tổng chi cho tầng QC không
            đổi. Vai Quản lý trung tâm chỉ một người: khai người mới sẽ tự đóng người cũ.
          </li>
          <li>
            Kết thúc một dòng <strong>không xoá lịch sử</strong>: bảng kê các kỳ cũ vẫn chốt lại
            ra đúng con số cũ.
          </li>
          <li>
            ⚠️ Đặt ngày hiệu lực <strong>lùi về quá khứ</strong> là cố ý sửa lại lịch sử — dùng
            khi khai sai cần vá. Con số của một kỳ chỉ thật sự đổi khi kỳ đó được{" "}
            <strong>chốt lại</strong>; kỳ đã duyệt vẫn khoá cho tới khi mở lại.
          </li>
          <li>
            Khai xong phải quay lại{" "}
            <Link href="/crm/commission" className="font-medium underline">
              Bảng hoa hồng theo kỳ
            </Link>{" "}
            và <strong>chốt lại kỳ</strong> thì tiền mới chảy vào bảng kê (kỳ đã duyệt phải mở
            lại trước).
          </li>
        </ul>
      </div>

      <PhanCongBang coSo={duLieu} nguoiChon={nguoi} />
    </div>
  );
}
