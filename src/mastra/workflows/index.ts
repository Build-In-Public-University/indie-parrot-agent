import { openai } from '@ai-sdk/openai';
import { S3Client, ListObjectsV2Command, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { z } from "zod";
import { createWorkflow, createStep } from "@mastra/core/workflows/vNext";
import { audioIngestTool, brandAnalyzerTool, newsletterWriterTool } from '../tools';
import { Transcription } from '../models/transcription';
import { BrandAnalysis } from '../models/brand-analysis';
// Define client configurations
const CLIENTS = [
  {
    name: 'IndieParrot',
    website: 'https://indieparrot.com',
    bucket: 'indieparrot'
  },
  // Add more clients as needed
];

const llm = openai('gpt-4o');

interface StepContext {
  inputData: any;
  mastra: any;
}

const listS3Files = createStep({
  id: 'list-s3-files',
  description: 'Lists audio files in the source S3 bucket that need processing',
  inputSchema: z.object({
    clientName: z.string().describe('Name of the client to process files for'),
  }),
  outputSchema: z.object({
    key: z.string()    
  }),
  execute: async ({ inputData, mastra }: StepContext) => {
    const { clientName } = inputData;
    const client = CLIENTS.find(c => c.name === clientName);
    
    if (!client) {
      throw new Error(`Client ${clientName} not found`);
    }

    const s3 = new S3Client({
      region: process.env.INDIEPARROT_AWS_REGION || 'us-east-2',
      credentials: {
        accessKeyId: process.env.INDIEPARROT_AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.INDIEPARROT_AWS_SECRET_ACCESS_KEY || '',
      }
    });

    const command = new ListObjectsV2Command({
      Bucket: client.bucket,
      Prefix: `inbound/${clientName}/`
    });

    const response = await s3.send(command);
    console.log('response', response);
    // get first file from response
    const file = response?.Contents?.[0];
    if (!file) {
      throw new Error(`No files found for client ${clientName}`);
    }
    return {
      s3Path: file.Key!
    }
  }
});



const archiveAudioFile = createStep({
  id: 'archive-audio-file',
  description: 'Archives audio file',
  inputSchema: z.object({
    s3Path: z.string()
  }),
  execute: async ({ inputData, mastra }: StepContext) => {
    const { s3Path } = inputData;
    
    // Move file to archive
    const s3 = new S3Client({
      region: process.env.INDIEPARROT_AWS_REGION || 'us-east-2',
      credentials: {
        accessKeyId: process.env.INDIEPARROT_AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.INDIEPARROT_AWS_SECRET_ACCESS_KEY || '',
      }
    });

    // Copy to archive
    await s3.send(new CopyObjectCommand({
      Bucket: process.env.INDIEPARROT_AWS_BUCKET || '',
      CopySource: `${process.env.INDIEPARROT_AWS_BUCKET || ''}/${s3Path}`,
      Key: s3Path.replace('inbound', 'archived')
    }));

    // Delete from source
    await s3.send(new DeleteObjectCommand({
      Bucket: process.env.INDIEPARROT_AWS_BUCKET || '',
      Key: s3Path
    }));

    return {
      status: 'success'
    };
  }
})

c

const ensureBrandAnalysis = createStep({
  id: 'ensure-brand-analysis',
  description: 'Ensures brand analysis exists for client',
  inputSchema: z.object({
    transcriptionId: z.string()
  }),
  outputSchema: z.object({
    brandAnalysisId: z.string()
  }),
  execute: async ({ inputData, mastra }: StepContext) => {
    const { transcriptionId } = inputData;

    // get Transcription from MongoDB
    const transcription = await Transcription.findOne({ transcriptionId });
    if (!transcription) {
      throw new Error(`Transcription ${transcriptionId} not found`);
    }

    // get s3 path from transcription
    const s3Path = transcription.s3Path;
    const clientName = s3Path.split('/')[1];

    // get client from s3 path
    const client = CLIENTS.find(c => c.name === clientName);
    if (!client) {
      throw new Error(`Client not found for s3 path ${s3Path}`);
    }

    // get brand analysis from MongoDB
    const brandAnalysis = await BrandAnalysis.findOne({ website: client.website });
    if (!brandAnalysis) {
      return {
        status: "missing",
        transcriptionId,
        website: client.website
      }
    }
    console.log('brand-analysis', brandAnalysis);

    return {
      status: "found",
      brandAnalysisId: brandAnalysis._id,
      transcriptionId,
      website: client.website
    }
  }
});


const createBrandAnalysis = createStep(brandAnalyzerTool)
const createTranscription = createStep(audioIngestTool)
export const newsletterWorkflow = createWorkflow({
  id: 'newsletter-workflow',
  inputSchema: z.object({
    clientName: z.string().describe('Name of the client to process'),
  }),
  outputSchema: z.object({
    newsletterId: z.string(),
    content: z.string()
  })
})
  .then(listS3Files)
  .then(createTranscription)
  // .then(archiveAudioFile)
  .then(createBrandAnalysis)
  .map({
    brandAnalysisId: {
      step: createBrandAnalysis,
      path: "brandAnalysisId"
    },
    transcriptionId: {
      step: createTranscription,
      path: "transcriptionId"
    }
  })  
  .then(createStep(newsletterWriterTool))
  .commit();
