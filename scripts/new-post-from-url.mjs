import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import slugify from "slugify";
import { GoogleGenAI, Type } from "@google/genai";

const url = process.argv[2];

if (!url) {
  console.error("Thiếu URL. Ví dụ: npm run new:post -- https://example.com/bai-viet");
  process.exit(1);
}

const BLOG_DIR = process.env.BLOG_DIR || "src/content/blog";
const IMAGE_DIR = process.env.IMAGE_DIR || "public/images/blog";
const IMAGE_PUBLIC_PREFIX = process.env.IMAGE_PUBLIC_PREFIX || "/images/blog";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

if (!process.env.GEMINI_API_KEY) {
  throw new Error("Thiếu GEMINI_API_KEY trong file .env");
}

if (!process.env.PEXELS_API_KEY) {
  throw new Error("Thiếu PEXELS_API_KEY trong file .env");
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

function escapeYamlString(value = "") {
  return JSON.stringify(String(value));
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function makeSlug(title) {
  return slugify(title, {
    lower: true,
    strict: true,
    locale: "vi",
  });
}

async function fetchArticle(articleUrl) {
  const res = await fetch(articleUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 BlogCreatorBot/1.0",
    },
  });

  if (!res.ok) {
    throw new Error(`Không tải được URL: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const dom = new JSDOM(html, { url: articleUrl });
  const article = new Readability(dom.window.document).parse();

  if (!article?.textContent) {
    throw new Error("Không trích xuất được nội dung bài viết từ URL này.");
  }

  return {
    title: article.title || "",
    excerpt: article.excerpt || "",
    text: article.textContent.replace(/\s+/g, " ").trim().slice(0, 14000),
  };
}

async function generateBlogPost(source) {
  const systemInstruction = `
Bạn là biên tập viên SEO tiếng Việt cho website Astro.

Nhiệm vụ:
- Dựa trên bài nguồn, tạo một bài viết mới bằng tiếng Việt.
- Không copy nguyên văn dài từ bài nguồn.
- Viết lại theo hướng tự nhiên, rõ ràng, có giá trị thêm.
- Tiêu đề hấp dẫn, chuẩn SEO, không giật tít quá đà.
- Nội dung Markdown có H2/H3, đoạn ngắn, dễ đọc.
- Có thể nhắc "Nguồn tham khảo" ở cuối bài.
- Sinh imageQuery bằng tiếng Anh để tìm ảnh Pexels phù hợp.
- Trả về đúng JSON schema.
`.trim();

  const prompt = `
URL nguồn: ${url}

Tiêu đề nguồn:
${source.title}

Mô tả nguồn:
${source.excerpt}

Nội dung nguồn:
${source.text}
`.trim();

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: {
            type: Type.STRING,
          },
          description: {
            type: Type.STRING,
          },
          slug: {
            type: Type.STRING,
          },
          tags: {
            type: Type.ARRAY,
            items: {
              type: Type.STRING,
            },
          },
          imageQuery: {
            type: Type.STRING,
          },
          content: {
            type: Type.STRING,
          },
        },
        required: ["title", "description", "slug", "tags", "imageQuery", "content"],
      },
    },
  });

  const output = response.text;

  if (!output) {
    throw new Error("Gemini không trả về nội dung.");
  }

  let post;

  try {
    post = JSON.parse(output);
  } catch (error) {
    console.error("Gemini trả về không phải JSON hợp lệ:");
    console.error(output);
    throw error;
  }

  if (!post.slug) {
    post.slug = makeSlug(post.title);
  }

  post.slug = makeSlug(post.slug);

  return post;
}

async function searchPexelsPhoto(query) {
  const params = new URLSearchParams({
    query,
    per_page: "1",
    orientation: "landscape",
  });

  const res = await fetch(`https://api.pexels.com/v1/search?${params.toString()}`, {
    headers: {
      Authorization: process.env.PEXELS_API_KEY,
    },
  });

  if (!res.ok) {
    throw new Error(`Lỗi Pexels API: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const photo = data.photos?.[0];

  if (!photo) {
    return null;
  }

  return photo;
}

async function downloadImage(photo, slug) {
  await fs.mkdir(IMAGE_DIR, { recursive: true });

  const imageUrl =
    photo?.src?.large2x ||
    photo?.src?.large ||
    photo?.src?.landscape ||
    photo?.src?.original;

  if (!imageUrl) {
    return null;
  }

  const res = await fetch(imageUrl);

  if (!res.ok) {
    throw new Error(`Không tải được ảnh Pexels: ${res.status} ${res.statusText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const imageName = `${slug}.jpg`;
  const imagePath = path.join(IMAGE_DIR, imageName);

  await fs.writeFile(imagePath, Buffer.from(arrayBuffer));

  return {
    localPath: imagePath,
    publicPath: `${IMAGE_PUBLIC_PREFIX}/${imageName}`,
    credit: `Photo by ${photo.photographer} on Pexels`,
    creditUrl: photo.url,
  };
}

async function writeMarkdownPost(post, imageInfo) {
  await fs.mkdir(BLOG_DIR, { recursive: true });

  const fileName = `${post.slug}.md`;
  const filePath = path.join(BLOG_DIR, fileName);

  const frontmatter = `---
title: ${escapeYamlString(post.title)}
description: ${escapeYamlString(post.description)}
pubDate: ${escapeYamlString(todayISO())}
tags:
${post.tags.map((tag) => `  - ${escapeYamlString(tag)}`).join("\n")}
image: ${escapeYamlString(imageInfo?.publicPath || "")}
imageCredit: ${escapeYamlString(imageInfo?.credit || "")}
imageCreditUrl: ${escapeYamlString(imageInfo?.creditUrl || "")}
sourceUrl: ${escapeYamlString(url)}
draft: false
---

`;

  const markdown = frontmatter + post.content.trim() + "\n";

  await fs.writeFile(filePath, markdown, "utf8");

  return filePath;
}

async function main() {
  console.log("Đang đọc bài viết...");
  const source = await fetchArticle(url);

  console.log("Đang tạo bài viết SEO bằng Gemini...");
  const post = await generateBlogPost(source);

  if (!post.slug) {
    post.slug = makeSlug(post.title);
  }

  console.log(`Đang tìm ảnh Pexels với từ khóa: ${post.imageQuery}`);
  const photo = await searchPexelsPhoto(post.imageQuery);

  let imageInfo = null;

  if (photo) {
    console.log("Đang tải ảnh...");
    imageInfo = await downloadImage(photo, post.slug);
  } else {
    console.warn("Không tìm thấy ảnh Pexels phù hợp.");
  }

  console.log("Đang tạo file Markdown...");
  const filePath = await writeMarkdownPost(post, imageInfo);

  console.log("");
  console.log("Đã tạo bài viết mới:");
  console.log(filePath);

  if (imageInfo?.localPath) {
    console.log("Ảnh đã lưu:");
    console.log(imageInfo.localPath);
  }

  console.log("");
  console.log("Việc tiếp theo:");
  console.log("1. Kiểm tra lại nội dung bài viết.");
  console.log("2. Chạy npm run build để kiểm tra lỗi.");
  console.log("3. Commit và push lên GitHub.");
}

main().catch((error) => {
  console.error("");
  console.error("Lỗi:");
  console.error(error.message);
  process.exit(1);
});