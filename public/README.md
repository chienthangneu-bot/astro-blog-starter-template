# Favicon package - Sức Khỏe & Đời Sống

Các file đã tạo từ logo gốc. Favicon dùng phần biểu tượng chính, bỏ chữ để hiển thị rõ hơn ở kích thước nhỏ.

## Cách dùng với Astro

Copy toàn bộ các file này vào thư mục `public/` của project. Sau đó thêm vào phần `<head>`, thường là file `src/components/BaseHead.astro` hoặc layout chính:

```html
<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />
<meta name="theme-color" content="#2f6b1f" />
```

Nếu site đã có favicon cũ, hãy ghi đè file cũ trong thư mục `public/`.
