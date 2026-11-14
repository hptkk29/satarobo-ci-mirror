// Biểu tượng của giao diện DISC công khai — CHÉP NGUYÊN các `<svg>` trong artifact "Disc-LamBai" (cùng đường vẽ, cùng thuộc tính),
// đặt tên theo nghĩa để các màn dùng lại. Không dùng lucide: đường vẽ khác artifact là lệch pixel.
type Ten = "dongHo" | "nguoi" | "khoa" | "rac" | "thongTin" | "canhBao" | "tick" | "phai" | "trai" | "chiaKhoa" | "sao" | "thu" | "taiXuong" | "bua";

const HINH: Record<Ten, React.ReactNode> = {
  dongHo: (
    <>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M12 6v6l4 2"></path>
    </>
  ),
  nguoi: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
      <circle cx="9" cy="7" r="4"></circle>
      <path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"></path>
    </>
  ),
  khoa: (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2"></rect>
      <path d="M8 11V7a4 4 0 0 1 8 0v4"></path>
    </>
  ),
  rac: <path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>,
  thongTin: (
    <>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M12 16v-4M12 8h.01"></path>
    </>
  ),
  canhBao: (
    <>
      <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path>
      <path d="M12 9v4M12 17h.01"></path>
    </>
  ),
  tick: (
    <>
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M8 12l3 3 5-6"></path>
    </>
  ),
  phai: <path d="M5 12h14M12 5l7 7-7 7"></path>,
  trai: <path d="M19 12H5M12 19l-7-7 7-7"></path>,
  chiaKhoa: (
    <>
      <circle cx="7.5" cy="15.5" r="4.5"></circle>
      <path d="M10.7 12.3L21 2M17 6l3 3M14 9l2 2"></path>
    </>
  ),
  sao: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </>
  ),
  thu: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2"></rect>
      <path d="M22 6l-10 7L2 6"></path>
    </>
  ),
  taiXuong: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"></path>,
  bua: <path d="M15 12l-8.5 8.5a2.1 2.1 0 0 1-3-3L12 9M17.6 15L22 10.6M20 12.6l-6.5-6.5a4 4 0 0 0-5.7 0L6 7.9"></path>,
};

export function Ic({ ten, size = 17 }: { ten: Ten; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {HINH[ten]}
    </svg>
  );
}
