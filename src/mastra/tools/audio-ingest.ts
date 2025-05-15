import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import axios from 'axios';
import mongoose from 'mongoose';

// MongoDB Schema
const TranscriptionSchema = new mongoose.Schema({
  s3Path: { type: String, required: true },
  audioUrl: { type: String, required: true },
  transcriptionId: { type: String, required: true },
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
  transcript: { type: String },
  metadata: { type: mongoose.Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/transcriptions');

const Transcription = mongoose.model('Transcription', TranscriptionSchema);

async function uploadToGladia(audioBuffer: Buffer): Promise<string> {
  const formData = new FormData();
  formData.append('audio', new Blob([audioBuffer]));

  const response = await axios.post('https://api.gladia.io/v2/upload', formData, {
    headers: {
      'x-gladia-key': process.env.GLADIA_API_KEY,
      'Content-Type': 'multipart/form-data'
    }
  });

  return response.data.audio_url;
}

async function transcribeAudio(audioUrl: string): Promise<string> {
  const response = await axios.post('https://api.gladia.io/v2/pre-recorded', {
    audio_url: audioUrl,
    diarization: true,
    diarization_config: {
      number_of_speakers: 3,
      min_speakers: 1,
      max_speakers: 5
    },
    detect_language: true,
    enable_code_switching: false
  }, {
    headers: {
      'x-gladia-key': process.env.GLADIA_API_KEY,
      'Content-Type': 'application/json'
    }
  });

  return response.data.id;
}

async function getTranscriptionResult(transcriptionId: string): Promise<any> {
  const response = await axios.get(`https://api.gladia.io/v2/pre-recorded/${transcriptionId}`, {
    headers: {
      'x-gladia-key': process.env.GLADIA_API_KEY
    }
  });

  return response.data;
}

export const audioIngestTool = createTool({
  id: 'audio-ingest',
  description: 'Ingest an audio file from S3, transcribe it with Gladia, and save to MongoDB',
  inputSchema: z.object({
    s3Path: z.string().describe('S3 path to the audio file (e.g., s3://bucket/key.mp3 or just key if bucket is fixed)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    transcriptionId: z.string(),
    status: z.string(),
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
      bucket = process.env.INDIEPARROT_BUCKET;
      key = s3Path;
    }
    
    if (!bucket || !key) throw new Error('Missing S3 bucket or key');

    // Initialize S3 client
    const s3 = new S3Client({ 
      region: process.env.INDIEPARROT_AWS_REGION || 'us-east-2',
      credentials: {
        accessKeyId: process.env.INDIEPARROT_AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.INDIEPARROT_AWS_SECRET_ACCESS_KEY || '',
      }
    });

    // Download file from S3
    const getObj = new GetObjectCommand({ Bucket: bucket, Key: key });
    const s3Res = await s3.send(getObj);
    
    // Read stream to buffer
    const s3Chunks = [];
    const bodyStream = Readable.from(s3Res.Body as any);
    for await (const chunk of bodyStream) s3Chunks.push(chunk);
    const audioBuffer = Buffer.concat(s3Chunks);

    // Upload to Gladia
    const audioUrl = await uploadToGladia(audioBuffer);

    // Start transcription
    const transcriptionId = await transcribeAudio(audioUrl);

    // Create MongoDB document
    const transcription = new Transcription({
      s3Path,
      audioUrl,
      transcriptionId,
      status: 'pending'
    });
    await transcription.save();

    // Poll for results
    let result;
    let attempts = 0;
    const maxAttempts = 30; // 5 minutes with 10-second intervals

    while (attempts < maxAttempts) {
      result = await getTranscriptionResult(transcriptionId);
      
      if (result.status === 'done') {
        transcription.status = 'completed';
        transcription.transcript = result.transcript;
        transcription.metadata = result;
        transcription.updatedAt = new Date();
        await transcription.save();
        break;
      } else if (result.status === 'error') {
        transcription.status = 'failed';
        transcription.metadata = result;
        transcription.updatedAt = new Date();
        await transcription.save();
        throw new Error(`Transcription failed: ${result.error}`);
      }

      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
      attempts++;
    }

    if (attempts >= maxAttempts) {
      throw new Error('Transcription timed out');
    }

    return {
      success: true,
      transcriptionId,
      status: transcription.status
    };
  },
}); 