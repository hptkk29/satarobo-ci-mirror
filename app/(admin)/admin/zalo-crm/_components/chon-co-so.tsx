"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Chọn cơ sở cho màn Zalo CRM — DROPDOWN, không phải dãy tab.
 *
 * Vì sao dropdown: dãy tab ngang chỉ đẹp khi có 2 cơ sở. Sata mở cơ sở mới bằng cách
 * thêm DỮ LIỆU chứ không sửa mã (luật cứng của repo), nên tới CS5–CS6 là dãy tab tràn
 * ngang và đè cả tiêu đề. Dropdown thì thêm bao nhiêu cơ sở cũng chỉ cao thêm một dòng
 * trong danh sách thả xuống.
 *
 * Đổi cơ sở là ĐIỀU HƯỚNG THẬT (`?org=`), không phải đổi state phía client: mỗi cơ sở
 * là MỘT tổ chức riêng bên Zalo CRM và cần một vé SSO riêng do máy chủ ký. Trang đã
 * `force-dynamic` nên lần điều hướng này luôn ký vé mới; `key={src}` bên khung nhúng
 * ép dựng lại iframe, không để phiên của cơ sở cũ sống tiếp trong khung.
 */
export function ChonCoSo({
  danhSach,
  dangChon,
}: {
  danhSach: { orgCode: string; ten: string }[];
  dangChon: string;
}) {
  const router = useRouter();
  const [dangChuyen, batDau] = useTransition();
  // `SelectValue` của bộ ui này hiện GIÁ TRỊ thô (mã org, vd "cs1") chứ không tra ngược
  // ra nhãn của item — nên nhãn phải đưa vào tường minh, không thì người dùng đọc được
  // mỗi cái mã kỹ thuật.
  const tenDangChon = danhSach.find((c) => c.orgCode === dangChon)?.ten ?? dangChon;

  return (
    <Select
      value={dangChon}
      disabled={dangChuyen}
      // `v` khai kiểu `string | null` (bỏ chọn) — bỏ chọn thì KHÔNG điều hướng, vì
      // "không cơ sở nào" không phải một trạng thái hợp lệ của màn này.
      onValueChange={(v) => {
        if (typeof v !== "string" || v === dangChon) return;
        batDau(() => router.push(`/zalo-crm?org=${encodeURIComponent(v)}`));
      }}
    >
      <SelectTrigger
        aria-label="Chọn cơ sở"
        // `max-w-full` chứ không `w-full`: ở màn 375px thanh này nằm cùng hàng với dòng
        // cảnh báo, để `w-full` là nó chiếm trọn hàng và đẩy cảnh báo xuống một dòng trống.
        className="h-9 w-[240px] max-w-full"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <SelectValue placeholder="Chọn cơ sở">{tenDangChon}</SelectValue>
        </span>
      </SelectTrigger>
      <SelectContent>
        {danhSach.map((c) => (
          <SelectItem key={c.orgCode} value={c.orgCode}>
            {c.ten}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
