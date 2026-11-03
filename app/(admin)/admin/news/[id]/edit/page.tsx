import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { NewsForm } from "../../_components/news-form";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditNewsPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // News là nội dung global (∉ SCOPED_MODELS) → sdb pass-through.
  const actor = await resolveActor(session.user.id);

  const { id } = await params;
  const news = await scopedDb(actor).news.findUnique({ where: { id } });
  if (!news) notFound();

  return (
    <div>
      <h1 className="mb-6 text-3xl font-black text-foreground">
        Sửa bài viết:{" "}
        <span className="font-bold text-primary">{news.title}</span>
      </h1>
      <NewsForm
        news={{
          id: news.id,
          slug: news.slug,
          title: news.title,
          excerpt: news.excerpt,
          content: news.content,
          coverImage: news.coverImage,
          category: news.category,
          tags: news.tags,
          isPublished: news.isPublished,
          isFeatured: news.isFeatured,
          displayOrder: news.displayOrder,
          seoTitle: news.seoTitle,
          seoDescription: news.seoDescription,
        }}
      />
    </div>
  );
}
