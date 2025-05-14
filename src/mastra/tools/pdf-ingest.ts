import { embedMany } from "ai";
import { openai } from "@ai-sdk/openai";
import { MDocument } from "@mastra/rag";
import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import { ChromaVector } from '@mastra/chroma';
import * as pdfjsLib from 'pdfjs-dist';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import stream from 'stream';
import { Readable } from 'stream';
import { ChromaClient } from "chromadb";
import { OpenAI } from "openai";
import fsSync from 'fs';

const require = createRequire(import.meta.url);

interface ExtractedImage {
  id: string;
  width: number;
  height: number;
  buffer: Buffer;
}

async function extractPdf(pdfBuffer: Buffer): Promise<{
  images: ExtractedImage[];
  text: string;
}> {
  const data = new Uint8Array(pdfBuffer);
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;

  const images: ExtractedImage[] = [];
  let text = '';

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);

    /* ---------- IMPROVED TEXT EXTRACTION ---------- */
    const textContent = await page.getTextContent();
    
    // Only keep items with a 'str' property (TextItem)
    const textItems = textContent.items.filter((item: any) => typeof item.str === 'string') as any[];

    // Sort items by position
    const sortedItems = textItems.sort((a: any, b: any) => {
      // Get y position
      const yA = a.transform[5];
      const yB = b.transform[5];
      
      // If on same line (same y position), sort by x position
      if (Math.abs(yA - yB) < 5) {
        return a.transform[4] - b.transform[4];
      }
      
      // Otherwise sort by y position (top to bottom)
      return yB - yA;
    });

    // Group items by line
    const lines: any[][] = [];
    let currentLine: any[] = [];
    let currentY: number | null = null;

    for (const item of sortedItems) {
      const itemY = item.transform[5];
      
      if (currentY === null || Math.abs(itemY - currentY) < 5) {
        currentLine.push(item);
        currentY = itemY;
      } else {
        lines.push(currentLine);
        currentLine = [item];
        currentY = itemY;
      }
    }
    
    if (currentLine.length > 0) {
      lines.push(currentLine);
    }

    // Process each line
    for (const line of lines) {
      let lineText = '';
      let previousX: number | null = null;
      
      for (const item of line) {
        const x = item.transform[4];
        
        if (previousX !== null) {
          // Calculate horizontal distance between items
          const distance = x - previousX;
          
          // Determine if we need to add a space
          // This threshold can be adjusted based on your document
          if (distance > 1) {
            lineText += ' ';
          }
        }
        
        lineText += item.str;
        previousX = x + item.width;
      }
      
      text += lineText + '\n';
    }

    /* ---------- IMAGE EXTRACTION (original code) ---------- */
    const opList = await page.getOperatorList();

    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i];

      if (fn === pdfjsLib.OPS.paintImageXObject || fn === pdfjsLib.OPS.paintXObject) {
        const name = args[0];
        const img: any = await new Promise(res => {
          const maybe = page.objs.get(name);
          maybe ? res(maybe) : page.objs.get(name, res);
        });

        const { width, height, data: rgba } = img;
        
        // Convert RGBA to PNG using sharp
        const pngBuffer = await sharp(rgba, {
          raw: {
            width,
            height,
            channels: 4
          }
        })
        .png()
        .toBuffer();

        images.push({
          id: `${p}_${name}`,
          width,
          height,
          buffer: pngBuffer,
        });
      }
    }
  }

  // Clean up any remaining extra spaces
  text = text.replace(/\s+/g, ' ').replace(/\n\s*\n/g, '\n').trim();

  return { images, text };
}

// Simple cosine similarity for two arrays
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class ClusterSemanticChunker {
  maxChunkSize: number;
  embeddingModel: string;
  client: OpenAI;

  constructor(maxChunkSize = 200, embeddingModel = "text-embedding-3-large") {
    this.maxChunkSize = maxChunkSize;
    this.embeddingModel = embeddingModel;
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  splitIntoSentences(text: string): string[] {
    return text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  }

  async getEmbeddings(texts: string[]): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      model: this.embeddingModel,
      input: texts,
    });
    // @ts-ignore
    return response.data.map((item: any) => item.embedding);
  }

  // Dynamic programming chunking (simplified for clarity)
  dynamicProgrammingChunk(sentences: string[], embeddings: number[][]): number[][] {
    const n = sentences.length;
    const chunks: number[][] = [];
    let i = 0;
    while (i < n) {
      let bestJ = i;
      let maxSim = -Infinity;
      let chunkSize = sentences[i].length;
      for (let j = i + 1; j < Math.min(i + 10, n); j++) {
        chunkSize += sentences[j].length;
        if (chunkSize > this.maxChunkSize) break;
        // Sum pairwise similarities in this window
        let sim = 0;
        for (let k = i; k < j; k++) {
          for (let l = k + 1; l <= j; l++) {
            sim += cosineSimilarity(embeddings[k], embeddings[l]);
          }
        }
        if (sim > maxSim) {
          maxSim = sim;
          bestJ = j;
        }
      }
      chunks.push([i, bestJ]);
      i = bestJ + 1;
    }
    return chunks;
  }

  async chunkText(text: string): Promise<string[]> {
    const sentences = this.splitIntoSentences(text);
    const embeddings = await this.getEmbeddings(sentences);
    const chunkIndices = this.dynamicProgrammingChunk(sentences, embeddings);
    return chunkIndices.map(([start, end]) =>
      sentences.slice(start, end + 1).join(" ")
    );
  }
}

export const pdfIngestTool = createTool({
  id: 'pdf-ingest',
  description: 'Ingest a PDF file from S3 into the database',
  inputSchema: z.object({
    s3Path: z.string().describe('S3 path to the PDF file (e.g., s3://bucket/key.pdf or just key if bucket is fixed)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    textChunks: z.number(),
    // images: z.number(),
  }),
  execute: async ({ context }) => {
    const { s3Path } = context;
    // Parse bucket and key from s3Path
    let bucket, key;
    if (s3Path.startsWith('s3://')) {
      const match = s3Path.match(/^s3:\/\/([^\/]+)\/(.+)$/);
      if (!match) throw new Error('Invalid S3 path');
      bucket = match[1];
      key = match[2];
    } else {
      // If you want to fix the bucket, set it here
      bucket = process.env.PDF_INGEST_BUCKET;
      key = s3Path;
    }
    if (!bucket || !key) throw new Error('Missing S3 bucket or key');
    const s3 = new S3Client({ region: process.env.CONSORVIA_AWS_REGION || 'us-east-2', credentials: {
      accessKeyId: process.env.CONSORVIA_AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.CONSORVIA_AWS_SECRET_ACCESS_KEY || '',
    } });
    const getObj = new GetObjectCommand({ Bucket: bucket, Key: key });
    const s3Res = await s3.send(getObj);
    // Read stream to buffer
    const s3Chunks = [];
    const bodyStream = Readable.from(s3Res.Body as any);
    for await (const chunk of bodyStream) s3Chunks.push(chunk);
    const pdfBuffer = Buffer.concat(s3Chunks);
    // Extract text and images from PDF buffer
    const { images, text } = await extractPdf(pdfBuffer);
    const chunker = new ClusterSemanticChunker(200, "text-embedding-3-large");
    const chunks = await chunker.chunkText(text);
    console.log('Chunks:', chunks);

    const chunkEmbeddings = await chunker.getEmbeddings(chunks);

    // Debug: Write first chunk, embedding, and metadata to file
    const debugOut = {
      chunk: chunks[0],
      embedding: chunkEmbeddings[0],
      metadata: { },
      document: chunks[0]
    };
    fsSync.writeFileSync('debug-chunk.json', JSON.stringify(debugOut, null, 2));
    console.log('First chunk (raw):', chunks[0]);
    console.log('First chunk (JSON):', JSON.stringify(chunks[0]));

    // Initialize Chroma store

    const client = new ChromaClient({
      path: "https://api.trychroma.com:8000",
      auth: { provider: "token", credentials: process.env.CHROMA_TOKEN, tokenHeaderType: "X_CHROMA_TOKEN" },
      tenant: process.env.CHROMA_TENANT,
      database: process.env.CHROMA_DATABASE
    });

    const store = await client.getOrCreateCollection({
      name: "pdfs",
    });
      

    // Upsert text chunks in batches of 10
    const batchSize = 10;
    const generatedIds = chunks.map(() => crypto.randomUUID());
    for (let i = 0; i < generatedIds.length; i += batchSize) {
      const batchIds = generatedIds.slice(i, i + batchSize);
      
      const batchMetadatas = batchIds.map(id => ({
        parentId: `${generatedIds[i]}`
      }));
      const batchDocuments: string[] = [];

      // Write each chunk to S3 (or local for now)
      for (let j = 0; j < batchIds.length; j++) {
        const chunkText = chunks[i + j];
        batchDocuments.push(chunkText);
        // S3 upload here; for local debug:
        await s3.send(new PutObjectCommand({
          Bucket: process.env.CONSORVIA_S3_BUCKET_NAME,
          Key: `chunks/${batchIds[j]}.txt`,
          Body: chunkText,
        }));
      }

      console.log(`Upserting text chunk batch ${i / batchSize + 1}:`, {
        ids: batchIds,
        metadatas: batchMetadatas.length,
        documents: batchDocuments.length
      });
      console.log('Batch sample:', {
        id: batchIds[0],
        metadata: batchMetadatas[0],
        document: batchDocuments[0]
      });
      try {
        const batchEmbeddings = chunkEmbeddings.slice(i, i + batchSize);
        const upsertResult = await store.upsert({
          ids: batchIds,
          embeddings: batchEmbeddings,
          metadatas: batchMetadatas,
          documents: batchDocuments
        });
        console.log(`Text chunk batch ${i / batchSize + 1} upsert result:`, upsertResult);
      } catch (err) {
        console.error(`Text chunk batch ${i / batchSize + 1} upsert error:`, err);
        throw err;
      }
    }

    // Create index for images
    // await store.createIndex({
    //   indexName: "images",
    //   dimension: 1536,
    // });


    // const imageStore = await client.getOrCreateCollection({
    //   name: "images",
    // });

    // // Generate embeddings for images and upsert
    // const imageEmbeddings = await Promise.all(
    //   images.map(async (image) => {
    //     const { embeddings } = await embedMany({
    //       values: [image.buffer.toString('base64')],
    //       model: openai.embedding("text-embedding-3-small"),
    //     });
    //     return embeddings[0];
    //   })
    // );

    // const generatedImageIds = images.map(() => crypto.randomUUID());

    // // Upsert image chunks in batches of 10
    // for (let i = 0; i < generatedImageIds.length; i += batchSize) {
    //   const batchIds = generatedImageIds.slice(i, i + batchSize);
    //   const batchEmbeddings = imageEmbeddings.slice(i, i + batchSize);
    //   const batchMetadatas = images.slice(i, i + batchSize).map(img => ({ id: img.id, width: img.width, height: img.height }));
    //   const batchDocuments = images.slice(i, i + batchSize).map(img => img.buffer.toString('base64'));
    //   console.log(`Upserting image batch ${i / batchSize + 1}:`, {
    //     ids: batchIds,
    //     embeddings: batchEmbeddings.length,
    //     metadatas: batchMetadatas.length,
    //     documents: batchDocuments.length
    //   });
    //   console.log('Batch sample:', {
    //     id: batchIds[0],
    //     embedding: batchEmbeddings[0],
    //     metadata: batchMetadatas[0],
    //     document: batchDocuments[0]
    //   });
    //   try {
    //     const imageUpsertResult = await imageStore.upsert({
    //       ids: batchIds,
    //       embeddings: batchEmbeddings,
    //       metadatas: batchMetadatas,
    //       documents: batchDocuments
    //     });
    //     console.log(`Image batch ${i / batchSize + 1} upsert result:`, imageUpsertResult);
    //   } catch (err) {
    //     console.error(`Image batch ${i / batchSize + 1} upsert error:`, err);
    //     throw err;
    //   }
    // }

    return {
      success: true,
      textChunks: chunks.length,
      // images: images.length,
    };
  },
}); 