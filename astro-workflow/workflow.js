import axios from "axios";
import fs from "fs";
import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function fetchArticle(url) {
  console.log("📥 Đang tải nội dung bài báo...");
  const res = await axios.get(url);
  console.log("✅ Đã tải xong bài báo!");
  return res.data;
}

async function rewriteArticle(content) {
  console.log("🧠 Đang gửi nội dung cho Gemini...");
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  const result = await model.generateContent(
    `Hãy viết lại bài báo sau, đặt tiêu đề hấp dẫn, thêm hashtag:\n\n${content}`
  );
  console.log("✅ Gemini đã trả về nội dung viết lại!");
  return result.response.text();
}

async function searchImage(query) {
  console.log("🔎 Đang tìm ảnh trên Pexels...");
  const res = await axios.get("https://api.pexels.com/v1/search", {
    headers: { Authorization: process.env.PEXELS_API_KEY },
    params: { query, per_page: 1 }
  });
  console.log("✅ Đã tìm thấy ảnh!");
  return res.data.photos[0].src.original;
}

function exportMarkdown(title, hashtags, image, body) {
  console.log("💾 Đang ghi file Markdown...");
  const md = `---
title: "${title}"
date: ${new Date().toISOString()}
tags: [${hashtags.join(", ")}]
image: ${image}
---

${body}
`;
  fs.writeFileSync(
    `../src/content/blog/${title.replace(/\s+/g, "_")}.md`,
    md
  );
  console.log("✅ File Markdown đã được tạo trong src/content/blog!");
}

(async () => {
  const url = "https://suckhoedoisong.vn/canh-bao-suy-than-cap-do-mat-nuoc-khi-troi-nang-nong-16926062723025181.htm"; // Thay bằng link thật
  const article = await fetchArticle(url);
  const rewritten = await rewriteArticle(article);

  const [titleLine, hashtagsLine, ...bodyLines] = rewritten.split("\n");
  const title = titleLine.trim();
  const hashtags = hashtagsLine.replace("Hashtags:", "").trim().split(" ");
  const body = bodyLines.join("\n");

  const image = await searchImage(title);
  exportMarkdown(title, hashtags, image, body);
})();
