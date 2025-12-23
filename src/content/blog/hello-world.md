---
title: "Hello World: Building a Minimalist Cloud Engineering Blog"
description: "How I built this site using Astro, Tailwind, and a touch of Cyan."
pubDate: 2025-12-22
---

# Hello World

Welcome to my new blog. As a cloud and software engineer, I wanted a place to share my thoughts that was fast, minimalist, and easy to maintain.

## Why Astro?

Astro is incredible for content-focused websites. It ships **zero JavaScript** by default, which makes this site incredibly fast.

### Code Snippets

Since I do a lot of cloud engineering, I'll be sharing a lot of code. Here is a small example of an AWS Lambda function in TypeScript:

```typescript
import { Handler } from 'aws-lambda';

export const handler: Handler = async (event) => {
  console.log('Event:', JSON.log(event, null, 2));
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Hello from the Cloud!' }),
  };
};
```

Stay tuned for more posts!
