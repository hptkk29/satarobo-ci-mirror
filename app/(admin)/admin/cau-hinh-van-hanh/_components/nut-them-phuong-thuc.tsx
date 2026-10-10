"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PaymentMethodForm } from "../../payment-methods/_components/payment-method-form";
import type { CenterPaymentOption } from "@/lib/payments/center-options";

/**
 * Nút "Thêm phương thức" + HỘP THOẠI chứa biểu mẫu.
 *
 * Chủ dự án 14/09/2026: "xoá trang /payment-methods/new mà bấm thêm phương thức thanh
 * toán thì hiển thị popup như của bên hoa hồng". Trang `new` đã xoá; đây là đường duy nhất
 * để tạo phương thức mới.
 *
 * ⚠️ Vì sao hộp thoại hợp ở đây, trong khi craft-floor coi modal là mặc định cần tránh:
 * người dùng đang đứng giữa một màn CẤU HÌNH nhiều tab. Đi sang một trang riêng rồi quay
 * lại là mất tab đang mở và mất cả bộ lọc — đúng cái phiền mà chủ dự án vừa nêu ở yêu cầu
 * thứ hai cùng tin nhắn. Tạo phương thức thanh toán cũng là việc cần tập trung: nó khai
 * số tài khoản nhận tiền.
 *
 * `centers` nạp sẵn ở Server Component cha rồi truyền xuống — hộp thoại không tự đi hỏi
 * gì, và danh sách đã lọc theo tầm nhìn cơ sở của người đang thao tác.
 */
export function NutThemPhuongThuc({
  centers,
  defaultCenterId,
}: {
  centers: CenterPaymentOption[];
  defaultCenterId?: string | null;
}) {
  const [mo, setMo] = useState(false);

  return (
    <>
      <Button type="button" className="min-h-11" onClick={() => setMo(true)}>
        <Plus className="h-4 w-4" aria-hidden />
        Thêm phương thức
      </Button>

      <Dialog open={mo} onOpenChange={setMo}>
        {/* Biểu mẫu này dài (thông tin cơ bản + tài khoản ngân hàng + cổng online) nên
            hộp thoại phải tự cuộn; `max-h-[85vh]` giữ nút đóng luôn trong tầm với. */}
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Thêm phương thức thanh toán</DialogTitle>
            <DialogDescription>
              Để trống ô Cơ sở nghĩa là phương thức DÙNG CHUNG mọi cơ sở, kể cả cơ sở mở sau
              này. Chọn một cơ sở thì nó chỉ hiện ở đơn của cơ sở đó.
            </DialogDescription>
          </DialogHeader>

          <PaymentMethodForm
            centers={centers}
            defaultCenterId={defaultCenterId}
            onXong={() => setMo(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
