import { NewsForm } from "../_components/news-form";

export default function NewNewsPage() {
  return (
    <div>
      <h1 className="mb-6 text-3xl font-black text-foreground">Thêm bài viết mới</h1>
      <NewsForm />
    </div>
  );
}
