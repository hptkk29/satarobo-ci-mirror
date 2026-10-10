"use client";

// Import lớp trải nghiệm từ Excel — MỖI DÒNG LÀ MỘT LỚP CHO MỘT NGÀY.
//
// Chủ dự án 22/09/2026: "có thể import bằng file excel được, check mẫu import các excel
// khác rồi làm tương tự". Khuôn chép từ màn import Phòng học.
//
// ⚠️ Trang này KHÔNG tự gác quyền được (nó là client component). Cổng thật nằm ở
// `/api/admin/import/trial-classes` (`trials:create-class`) — CÙNG khoá với nút "Tạo
// lớp" và với trang `/lop-trial/moi`. Lối vào trang được giấu theo cùng khoá đó ở
// `/lop-trial`, nhưng cái giữ dữ liệu là cổng ở route.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ExcelImporter, type ImportResult } from "@/components/admin/ExcelImporter";
import { docLoiPhanHoi } from "@/lib/ui/loi-phan-hoi";

interface DongLopTrial {
  centerSlug: string;
  date: string;
  startTime: string;
  endTime: string;
  courseSlug?: string;
  name?: string;
}

function chuoi(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number") return String(v);
  return undefined;
}

/**
 * Excel hay trả ô ngày thành SỐ SERIAL (45922) hoặc `Date`, không phải chuỗi.
 *
 * Bỏ qua chuyện này là người dùng dán đúng file mẫu rồi nhận "Ngày phải dạng
 * YYYY-MM-DD" cho mọi dòng — và họ sẽ kết luận màn import hỏng, chứ không đoán ra là do
 * Excel tự đổi kiểu ô.
 */
function doiNgay(v: unknown): string | undefined {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && Number.isFinite(v)) {
    // Serial của Excel: ngày 1 = 1899-12-31, và Excel coi 1900 là năm nhuận (lệch 1 ngày)
    // nên mốc quy đổi chuẩn là 1899-12-30.
    const ms = Math.round(v) * 86_400_000;
    return new Date(Date.UTC(1899, 11, 30) + ms).toISOString().slice(0, 10);
  }
  const s = chuoi(v);
  if (!s) return undefined;
  // "22/09/2026" → "2026-09-22"
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return s;
}

/** Excel cũng hay trả ô giờ thành phân số của một ngày (0.72917 = 17:30). */
function doiGio(v: unknown): string | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1) {
    const phut = Math.round(v * 24 * 60);
    return `${String(Math.floor(phut / 60)).padStart(2, "0")}:${String(phut % 60).padStart(2, "0")}`;
  }
  const s = chuoi(v);
  if (!s) return undefined;
  const m = /^(\d{1,2})[:h](\d{2})$/.exec(s);
  return m ? `${m[1]!.padStart(2, "0")}:${m[2]}` : s;
}

export default function ImportLopTrialPage() {
  const router = useRouter();

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div>
        <Link
          href="/lop-trial"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
        </Link>
        <h1 className="text-2xl font-bold">Mở lớp trải nghiệm hàng loạt từ Excel</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Mỗi dòng là <strong>một lớp cho một ngày</strong>. Giờ gõ tuỳ ý nhưng phải nằm
          trong giờ mở của thứ đó (sửa ở Cấu hình vận hành → tab &quot;Lớp &amp; giáo viên&quot;) —
          dòng nào lệch khung sẽ bị từ chối kèm lý do, các dòng còn lại vẫn vào.
        </p>
      </div>

      <ExcelImporter<DongLopTrial>
        title="Mở lớp trải nghiệm"
        // 23/09 — mẫu v2 theo khuôn 3 sheet của bộ mẫu import (dữ liệu · hướng dẫn · ví dụ).
        // Bản v1 để 3 dòng VÍ DỤ ngay trong sheet dữ liệu (dán vào là nhập luôn ví dụ), còn
        // cột khoá đã bỏ từ 22/09 (QĐ-A7) và slug mẫu `cs1` không khớp cơ sở thật nào.
        templateUrl="/templates/mau-lop-trial-v2.xlsx"
        templateFilename="mau-lop-trial-v2.xlsx"
        columnHints={[
          { key: "centerSlug", label: "Cơ sở (mã CS1 hoặc slug)", required: true },
          { key: "date", label: "Ngày (dd/mm/yyyy)", required: true },
          { key: "startTime", label: "Giờ bắt đầu (HH:MM)", required: true },
          { key: "endTime", label: "Giờ kết thúc (HH:MM)", required: true },
          { key: "name", label: "Tên lớp (bỏ trống để hệ thống tự đặt)" },
        ]}
        // Trùng = cùng cơ sở + cùng ngày + cùng khung giờ. Hai lớp y hệt trong một file
        // gần như luôn là lỗi copy dòng, và nếu để lọt thì hai lớp trùng tên nằm cạnh
        // nhau, Sale không biết chọn cái nào.
        duplicateLabel="cơ sở + ngày + khung giờ"
        duplicateKey={(raw) => {
          const cs = chuoi(raw.centerSlug);
          const ngay = doiNgay(raw.date);
          const bd = doiGio(raw.startTime);
          if (!cs || !ngay || !bd) return null;
          return `${cs}::${ngay}::${bd}`;
        }}
        parseRow={(row) => {
          const centerSlug = chuoi(row.centerSlug);
          const date = doiNgay(row.date);
          const startTime = doiGio(row.startTime);
          const endTime = doiGio(row.endTime);
          if (!centerSlug) return { error: "Thiếu cơ sở (mã CS1 hoặc slug)" };
          if (!date) return { error: "Thiếu ngày" };
          if (!startTime || !endTime) return { error: "Thiếu giờ bắt đầu hoặc giờ kết thúc" };
          if (endTime <= startTime) return { error: "Giờ kết thúc phải sau giờ bắt đầu" };
          return {
            centerSlug,
            date,
            startTime,
            endTime,
            // Cột khoá đã bỏ khỏi mẫu (QĐ-A7) — vẫn đọc nếu file CŨ còn cột này.
            courseSlug: chuoi(row.courseSlug),
            name: chuoi(row.name),
          };
        }}
        onImport={async (rows) => {
          const res = await fetch("/api/admin/import/trial-classes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rows }),
          });
          if (!res.ok) {
            const than = (await res.json().catch(() => null)) as {
              error?: string;
              errors?: { row: number; error: string }[];
            } | null;
            throw new Error(docLoiPhanHoi(res.status, than));
          }
          const kq = (await res.json()) as ImportResult;
          setTimeout(() => router.refresh(), 1000);
          return kq;
        }}
      />
    </div>
  );
}
