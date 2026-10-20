import { nguoiCoTheGan } from "@/lib/crm/commission-assignee-store";
import { CenterForm } from "../_components/center-form";

export default async function NewCenterPage() {
  // 27/08 — tạo cơ sở mới BẮT BUỘC chọn tài khoản quản lý (nguồn hoa hồng QL TT 2%),
  // nên form cần danh sách tài khoản.
  const nguoiChon = await nguoiCoTheGan();
  return (
    <div>
      <h1 className="mb-6 text-3xl font-black text-foreground">Thêm cơ sở mới</h1>
      <CenterForm nguoiChon={nguoiChon} />
    </div>
  );
}
