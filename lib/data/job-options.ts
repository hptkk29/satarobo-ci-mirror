export const DEPARTMENTS = [
  { value: 'marketing-sale', label: 'Marketing & Tuyển sinh' },
  { value: 'dao-tao', label: 'Đào tạo & Giáo viên' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'it', label: 'Công nghệ thông tin' },
  { value: 'van-hanh', label: 'Vận hành & Hành chính' },
  { value: 'ke-toan', label: 'Kế toán & Tài chính' },
  { value: 'rd', label: 'R&D & Sản phẩm' },
] as const

export const LOCATIONS = [
  { value: 'danang', label: 'Đà Nẵng' },
  { value: 'online-hybrid', label: 'Online / Hybrid' },
  { value: 'remote', label: 'Remote toàn thời gian' },
] as const

export const JOB_TYPES = [
  { value: 'fulltime', label: 'Toàn thời gian' },
  { value: 'parttime', label: 'Bán thời gian' },
  { value: 'intern', label: 'Thực tập' },
  { value: 'contract', label: 'Hợp đồng dự án' },
] as const

export const JOB_STATUS = [
  { value: 'DRAFT', label: 'Bản nháp', color: 'gray' },
  { value: 'OPEN', label: 'Đang tuyển', color: 'green' },
  { value: 'CLOSED', label: 'Đã đóng', color: 'red' },
  { value: 'ON_HOLD', label: 'Tạm dừng', color: 'yellow' },
] as const

export function formatSalaryRange(
  min?: number | null,
  max?: number | null,
  note?: string | null,
): string {
  if (note) return note
  if (!min && !max) return 'Thoả thuận'
  if (min && max) return `${(min / 1_000_000).toFixed(0)}–${(max / 1_000_000).toFixed(0)} triệu`
  if (min) return `Từ ${(min / 1_000_000).toFixed(0)} triệu`
  return `Đến ${(max! / 1_000_000).toFixed(0)} triệu`
}

// Số ở đây là SỐ CHUNG của công ty (`SATA_ROBO_PHONE`), chép ra chuỗi thay vì import để
// `lib/data/` không phụ thuộc `lib/locations` — nếu đổi số thì đổi CẢ HAI chỗ.
// Phường đã sửa "Hải Châu" → "Hòa Cường": 211 Nguyễn Hữu Thọ thuộc Hòa Cường, đúng như
// hồ sơ BCT và `lib/locations.ts`; chữ cũ là lỗi sao chép.
export const HR_CONTACT = {
  email: 'tuyendung@satarobo.vn',
  phone: '0837.312.860',
  phoneRaw: '0837312860',
  zaloUrl: 'https://zalo.me/0837312860',
  name: 'Ms. Trang',
  address: '211 Nguyễn Hữu Thọ, Hòa Cường, Đà Nẵng',
} as const
