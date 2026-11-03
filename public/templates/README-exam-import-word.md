# Mẫu import câu hỏi từ Word (.docx) — R7-13

File mẫu: **`mau-de-thi-word-v2.docx`** (cùng thư mục). KHÔNG đổi tên field — cấu
trúc field bị khoá để đồng bộ với skill AI sinh đề (`tao-bai-tap-trac-nghiem-satarobo`).

## Cấu trúc 1 câu hỏi (1 block)

Mỗi câu bắt đầu bằng dòng `QUESTION_CODE:`. Các field (mỗi field 1 dòng / paragraph):

| Field | Bắt buộc | Ghi chú |
|---|---|---|
| `QUESTION_CODE:` | ✅ | Mã duy nhất. Là khoá upsert (import lại = cập nhật, không nhân đôi). |
| `QUESTION_TYPE:` | ✅ | `SINGLE` \| `MULTI` \| `TRUE_FALSE`. SINGLE→trắc nghiệm 1 đáp án. |
| `QUESTION_TEXT:` | ✅ | Đề bài. Có thể nhiều dòng (xuống dòng được giữ nguyên). |
| `QUESTION_IMAGE:` | ❌ | Chèn **ảnh nhúng** ngay dưới/cùng dòng. KHÔNG dùng link internet. |
| `OPTION_A:` … `OPTION_D:` | ⚠️ | Lựa chọn. SINGLE/MULTI ≥2; TRUE_FALSE đúng 2 (Đúng/Sai). |
| `OPTION_A_IMAGE:` … | ❌ | Ảnh nhúng cho từng đáp án. |
| `CORRECT_ANSWER:` | ⚠️ | `A` (SINGLE/TRUE_FALSE) hoặc `A,C` (MULTI). |
| `SCORE:` | ✅ | Số dương (điểm câu). |
| `EXPLANATION:` | ❌ | Giải thích đáp án. |
| `TAGS:` | ❌ | Cách nhau bằng dấu phẩy. |

## Quy tắc

- Chỉ nhận `.docx` (Word 2007+). File `.doc` cũ → bị từ chối (kiểm tra magic bytes).
- Ảnh phải **nhúng** trong file; ảnh chèn bằng link internet sẽ báo lỗi dòng đó.
- Câu lỗi không chặn câu đúng — màn xem trước đánh dấu đỏ từng câu lỗi, sửa inline rồi xác nhận.
- Câu import vào ở trạng thái **nháp (isPublic=false)**; chỉ Đào tạo/Admin publish.

## Sinh lại file mẫu / fixture

```bash
node tests/fixtures/docx/build-docx.mjs
```

> Lưu ý: file mẫu hiện tại CHƯA chèn ảnh minh hoạ (generator Node thuần chỉ tạo
> block text). Bản .docx có ảnh nhúng minh hoạ là **follow-up** (soạn tay trong Word
> hoặc bổ sung media vào generator). Logic map ảnh đã được test bằng XML fixture
> trong `lib/exams/docx-import.test.ts`.
