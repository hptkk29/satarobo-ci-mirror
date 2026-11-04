// app/(elearning)/elearning/page.tsx — EL-01 PR2: trang chủ tạm của khu đào tạo.
//
// PR2 chỉ dựng KHUNG + gate. Nội dung thật (khoá của tôi, hạn chót, tiến độ) thuộc
// EL-04 trở đi. Trang này tồn tại để host thứ 6 có đích rewrite hợp lệ và để hai
// spec e2e của PR2 có chỗ khẳng định gate chạy đúng.
export default function ElearningHomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Đào tạo nội bộ</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Khu đào tạo nội bộ đang được xây dựng. Khoá học được giao cho bạn sẽ xuất hiện
        ở đây.
      </p>
    </main>
  );
}
