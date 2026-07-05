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

// Chỉ tải 2 ảnh minh họa trong bài
const BODY_IMAGE_COUNT = Number(process.env.BODY_IMAGE_COUNT || "2");

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
  return slugify(title || "bai-viet-moi", {
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
- Description ngắn gọn, hấp dẫn, khoảng 140-160 ký tự.
- Nội dung Markdown có H2/H3, đoạn ngắn, dễ đọc.
- Nội dung nên có phần mở bài, các mục chính, lưu ý thực tế và kết luận.
- Có thể nhắc "Nguồn tham khảo" ở cuối bài.
- Sinh 1 imageQuery chính bằng tiếng Anh để tìm ảnh đại diện Pexels.
- Sinh đúng 2 inlineImageQueries bằng tiếng Anh để tìm 2 ảnh minh họa chèn trong bài.
- Ảnh minh họa phải liên quan trực tiếp đến nội dung bài.
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
          inlineImageQueries: {
            type: Type.ARRAY,
            items: {
              type: Type.STRING,
            },
          },
          content: {
            type: Type.STRING,
          },
        },
        required: [
          "title",
          "description",
          "slug",
          "tags",
          "imageQuery",
          "inlineImageQueries",
          "content",
        ],
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

  post.slug = makeSlug(post.slug || post.title);
  post.tags = Array.isArray(post.tags) ? post.tags : [];
  post.inlineImageQueries = Array.isArray(post.inlineImageQueries)
    ? post.inlineImageQueries.slice(0, BODY_IMAGE_COUNT)
    : [];

  return post;
}

async function searchPexelsPhoto(query, usedPhotoIds = new Set()) {
  if (!query) return null;

  const params = new URLSearchParams({
    query,
    per_page: "10",
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
  const photos = data.photos || [];

  const photo = photos.find((item) => !usedPhotoIds.has(item.id));

  if (!photo) {
    return null;
  }

  usedPhotoIds.add(photo.id);
  return photo;
}

async function searchPexelsPhotos(queries = [], count = 2, usedPhotoIds = new Set()) {
  const results = [];

  for (const query of queries.slice(0, count)) {
    try {
      const photo = await searchPexelsPhoto(query, usedPhotoIds);

      if (photo) {
        results.push(photo);
      }
    } catch (error) {
      console.warn(`Không tìm được ảnh Pexels cho query "${query}": ${error.message}`);
    }
  }

  return results;
}

async function downloadImage(photo, imageName) {
  await fs.mkdir(IMAGE_DIR, { recursive: true });

  if (!photo) return null;

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
  const imagePath = path.join(IMAGE_DIR, imageName);

  await fs.writeFile(imagePath, Buffer.from(arrayBuffer));

  return {
    localPath: imagePath,
    publicPath: `${IMAGE_PUBLIC_PREFIX}/${imageName}`,
    alt: photo.alt || "Ảnh minh họa bài viết",
    credit: `Photo by ${photo.photographer} on Pexels`,
    creditUrl: photo.url,
  };
}

async function downloadBodyImages(photos, slug) {
  const images = [];

  for (let i = 0; i < photos.length; i++) {
    const imageName = `${slug}-body-${i + 1}.jpg`;

    try {
      const imageInfo = await downloadImage(photos[i], imageName);

      if (imageInfo) {
        images.push(imageInfo);
      }
    } catch (error) {
      console.warn(`Không tải được ảnh minh họa ${i + 1}: ${error.message}`);
    }
  }

  return images;
}

function injectImagesIntoMarkdown(content, images = []) {
  if (!images.length) return content;

  const lines = content.split("\n");
  const result = [];
  let imageIndex = 0;

  for (const line of lines) {
    result.push(line);

    // Chèn ảnh sau các tiêu đề H2
    if (imageIndex < images.length && /^##\s+/.test(line.trim())) {
      const img = images[imageIndex];

      result.push("");
      result.push(`![${img.alt}](${img.publicPath})`);
      result.push("");
      result.push(`<small>${img.credit}</small>`);
      result.push("");

      imageIndex++;
    }
  }

  // Nếu bài có ít H2 quá, chèn nốt ảnh còn lại ở gần cuối bài
  while (imageIndex < images.length) {
    const img = images[imageIndex];

    result.push("");
    result.push(`![${img.alt}](${img.publicPath})`);
    result.push("");
    result.push(`<small>${img.credit}</small>`);
    result.push("");

    imageIndex++;
  }

  return result.join("\n");
}

async function writeMarkdownPost(post, heroImageInfo, bodyImages = []) {
  await fs.mkdir(BLOG_DIR, { recursive: true });

  const fileName = `${post.slug}.md`;
  const filePath = path.join(BLOG_DIR, fileName);

  const bodyImageCredits = bodyImages
    .map((img) => `${img.credit} - ${img.creditUrl}`)
    .join(" | ");

  const frontmatter = `---
title: ${escapeYamlString(post.title)}
description: ${escapeYamlString(post.description)}
pubDate: ${escapeYamlString(todayISO())}
tags:
${post.tags.map((tag) => `  - ${escapeYamlString(tag)}`).join("\n")}
heroImage: ${escapeYamlString(heroImageInfo?.publicPath || "")}
imageCredit: ${escapeYamlString(heroImageInfo?.credit || "")}
imageCreditUrl: ${escapeYamlString(heroImageInfo?.creditUrl || "")}
bodyImageCredits: ${escapeYamlString(bodyImageCredits)}
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

  const usedPhotoIds = new Set();

  console.log(`Đang tìm ảnh đại diện Pexels với từ khóa: ${post.imageQuery}`);
  const heroPhoto = await searchPexelsPhoto(post.imageQuery, usedPhotoIds);

  let heroImageInfo = null;

  if (heroPhoto) {
    console.log("Đang tải ảnh đại diện...");
    heroImageInfo = await downloadImage(heroPhoto, `${post.slug}.jpg`);
  } else {
    console.warn("Không tìm thấy ảnh đại diện Pexels phù hợp.");
  }

  console.log(`Đang tìm ${BODY_IMAGE_COUNT} ảnh minh họa trong bài...`);
  const bodyPhotos = await searchPexelsPhotos(
    post.inlineImageQueries,
    BODY_IMAGE_COUNT,
    usedPhotoIds
  );

  console.log("Đang tải ảnh minh họa trong bài...");
  const bodyImages = await downloadBodyImages(bodyPhotos, post.slug);

  console.log("Đang chèn ảnh minh họa vào nội dung Markdown...");
  post.content = injectImagesIntoMarkdown(post.content, bodyImages);

  console.log("Đang tạo file Markdown...");
  const filePath = await writeMarkdownPost(post, heroImageInfo, bodyImages);

  console.log("");
  console.log("Đã tạo bài viết mới:");
  console.log(filePath);

  if (heroImageInfo?.localPath) {
    console.log("");
    console.log("Ảnh đại diện đã lưu:");
    console.log(heroImageInfo.localPath);
  }

  if (bodyImages.length) {
    console.log("");
    console.log("Ảnh minh họa trong bài đã lưu:");
    for (const img of bodyImages) {
      console.log(img.localPath);
    }
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