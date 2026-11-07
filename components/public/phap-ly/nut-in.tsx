"use client";

// Nút "In / lưu PDF" — điều khiển THẬT: gọi hộp thoại in của trình duyệt (chọn "Lưu dưới dạng PDF").
// Artifact ghi `onClick={printPage}` = `window.print()`. CSS in ở phap-ly-bosung.css ẩn thanh bên, nút và khối
// liên hệ để bản in chỉ còn văn bản.
export function NutIn() {
  return (
    <button type="button" className="btn btn-line" onClick={() => window.print()}>
      In / lưu PDF
    </button>
  );
}
