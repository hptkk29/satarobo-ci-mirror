import type { Metadata } from "next";
import { isDiscEnabled } from "@/lib/flags";
import { KhungXacThuc } from "@/components/public/xac-thuc/khung-xac-thuc";
import { TranhKichHoat } from "@/components/public/xac-thuc/tranh-kichhoat";
import { TranhNhanKetQua } from "@/components/public/xac-thuc/tranh-nhanketqua";
import { BuocProvider, ThanhBuoc } from "@/components/public/xac-thuc/buoc-xac-thuc";
// Artifact "Disc-NhanKetQua" nạp `xac-thuc.css` + `disc.css` (ô `.dchip`/`.dbar`/`.dtag` gốc) rồi `disc-ket-qua.css` (chồng lên) — đúng thứ tự này.
import "@/app/(public)/pub-design/disc.css";
import "@/app/(public)/pub-design/disc-ket-qua.css";
import { ActivateForm } from "./activate-form";
import { NhanDiscForm } from "./nhan-disc-form";

export const metadata: Metadata = {
  title: "Kích hoạt tài khoản",
  description: "Kích hoạt tài khoản phụ huynh Sata Robo bằng mã xác minh gửi qua Zalo hoặc email.",
  alternates: { canonical: "https://satarobo.vn/kich-hoat" },
  robots: { index: false, follow: true },
};

// Giao diện CHÉP từ artifact "Activate" (nhánh ?disc=1 từ "Disc-NhanKetQua"); khung hai cột + thẻ do `KhungXacThuc`, nền/sáng-tối do
// (auth)/layout.tsx. CSS: pub-design/xac-thuc.css (+ disc-ket-qua.css cho nhánh DISC, nạp SAU xac-thuc theo NEN-PUBLIC-V2).
export default async function ActivatePage({ searchParams }: { searchParams: Promise<{ disc?: string }> }) {
  // Nhánh "nhận bài DISC" (?disc=1): chỉ khi cờ DISC bật; mặc định giữ nguyên luồng kích hoạt cũ.
  // ⚠️ ĐỌC `searchParams` TRƯỚC, vô điều kiện: bản cũ viết `isDiscEnabled() && (await searchParams)…` nên khi cờ TẮT lúc BUILD, Next không thấy
  // trang dùng API động ⇒ dựng nó thành TĨNH; lúc chạy cờ BẬT ⇒ `await searchParams` ném DYNAMIC_SERVER_USAGE ⇒ /kich-hoat trả 500 trên PROD.
  const disc = (await searchParams).disc;
  const nhanDisc = isDiscEnabled() && disc === "1";
  if (nhanDisc) {
    return (
      <KhungXacThuc tranh={<TranhNhanKetQua />}>
        <BuocProvider>
          <ThanhBuoc ten="Các bước nhận kết quả" nhan={["Nhập mã", "Xác minh", "Nhận bài"]} />
          <NhanDiscForm />
        </BuocProvider>
      </KhungXacThuc>
    );
  }
  return (
    <KhungXacThuc tranh={<TranhKichHoat />}>
      <BuocProvider>
        <ThanhBuoc ten="Các bước kích hoạt tài khoản" nhan={["Thông tin", "Kích hoạt", "Hoàn tất"]} />
        <ActivateForm />
      </BuocProvider>
    </KhungXacThuc>
  );
}
