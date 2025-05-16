import { createTool, ToolExecutionContext } from "@mastra/core";
import { z } from "zod";
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import mongoose from 'mongoose';

// MongoDB Schema for workflow runs
const WorkflowRunSchema = new mongoose.Schema({
  clientName: { type: String, required: true },
  status: { type: String, enum: ['pending', 'running', 'completed', 'failed'], default: 'pending' },
  transcriptionId: { type: String },
  brandAnalysisId: { type: String },
  newsletterId: { type: String },
  error: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/workflow-runs');

const WorkflowRun = mongoose.model('WorkflowRun', WorkflowRunSchema);

export const workflowRunnerTool = createTool({
  id: 'workflow-runner',
  description: 'Run the full newsletter generation workflow for a client',
  inputSchema: z.object({
    clientName: z.string().describe('Name of the client to process'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    workflowRunId: z.string(),
    status: z.string(),
    transcriptionId: z.string().optional(),
    brandAnalysisId: z.string().optional(),
    newsletterId: z.string().optional(),
    error: z.string().optional()
  }),
  execute: async ( 
   {
    context,
    mastra,
   }
  ) => {
    

    const newsletterWorkflow = mastra?.vnext_getWorkflow("newsletter-workflow");
    if (!newsletterWorkflow) {
      throw new Error("Newsletter workflow not found");
    }
 
    const run = newsletterWorkflow.createRun();
    const results = await run.start({
      inputData: {
        clientName: context.clientName,
      },
    });
    const generateNewsletterStep = results.steps["generate-newsletter"];
    if (generateNewsletterStep.status === "success") {
      return generateNewsletterStep.output;
    }
 
    return {
      success: false,
      error: "No newsletter found",
    };

      // // 2. Process audio file
      // const tools = await context.mastra.getAgent('newsletter-agent').getTools();
      // const audioResult = await tools? //.audioIngestTool.execute({
      //   context: {
      //     s3Path: files[0].key
      //   }
      // });

      // workflowRun.transcriptionId = audioResult.transcriptionId;
      // await workflowRun.save();

      // // 3. Analyze brand
      // const brandResult = await context.mastra.getT.brandAnalyzerTool.execute({
      //   context: {
      //     website: 'https://indieparrot.com' // This should come from client config
      //   }
      // });

      // workflowRun.brandAnalysisId = brandResult.brandAnalysisId;
      // await workflowRun.save();

      // // 4. Generate newsletter
      // const newsletterResult = await context.mastra.tools.newsletterWriterTool.execute({
      //   context: {
      //     transcriptionId: audioResult.transcriptionId,
      //     brandAnalysisId: brandResult.brandAnalysisId
      //   }
      // });

      // workflowRun.newsletterId = newsletterResult.newsletterId;
      // workflowRun.status = 'completed';
      // workflowRun.updatedAt = new Date();
      // await workflowRun.save();

      // return {
      //   success: true,
      //   workflowRunId: workflowRun._id.toString(),
      //   status: workflowRun.status,
      //   transcriptionId: workflowRun.transcriptionId || undefined,
      //   brandAnalysisId: workflowRun.brandAnalysisId || undefined,
      //   newsletterId: workflowRun.newsletterId || undefined
      // };
    // } catch (error) {
    //   workflowRun.status = 'failed';
    //   workflowRun.error = error instanceof Error ? error.message : 'Unknown error';
    //   workflowRun.updatedAt = new Date();
    //   await workflowRun.save();

    //   return {
    //     success: false,
    //     workflowRunId: workflowRun._id.toString(),
    //     status: workflowRun.status,
    //     error: workflowRun.error
    //   };
    // }
  },
}); 