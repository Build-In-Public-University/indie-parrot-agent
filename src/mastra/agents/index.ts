import { openai } from '@ai-sdk/openai';

import { newsletterWriterTool } from '../tools/newsletter-writer';
import { Agent } from '@mastra/core';

export const researcherAgent = new Agent({
  name: 'researcher',
  instructions: `
    You are a brand research expert who analyzes websites to extract key brand information.
    Use the brand analyzer tool to analyze websites and provide insights about their brand voice,
    audience, values, mission, and goals.
  `,
  model: openai('gpt-4o'),
  tools: {  newsletterWriterTool },
});
