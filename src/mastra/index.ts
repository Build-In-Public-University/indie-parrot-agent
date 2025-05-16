import { Mastra } from '@mastra/core';
import { createLogger } from '@mastra/core';
import { newsletterWorkflow } from './workflows';
import { newsletterWriterTool } from './tools/newsletter-writer';
import { Agent } from '@mastra/core';
import { openai } from '@ai-sdk/openai';

const llm = openai('gpt-4o');

const newsletterAgent = new Agent({
  name: 'Newsletter Agent',
  model: llm,
  instructions: `
    You are a newsletter writing expert who creates engaging content based on audio transcriptions
    while maintaining brand voice and values. You excel at:
    - Extracting key insights from transcriptions
    - Maintaining consistent brand voice
    - Creating compelling narratives
    - Structuring content for maximum engagement
  `,
  tools: { newsletterWriterTool }
});

export const mastra = new Mastra({
  vnext_workflows: { "newsletter-workflow": newsletterWorkflow },
  agents: { newsletterAgent },
  server: {
    host: "0.0.0.0",
    port: 4111
  },
  logger: createLogger({
    name: 'Mastra',
    level: 'info',
  }),
});
