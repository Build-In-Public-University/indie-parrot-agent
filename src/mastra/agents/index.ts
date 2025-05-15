import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { brandAnalyzerTool } from '../tools/brand-analyzer';

export const researcherAgent = new Agent({
  name: 'researcher',
  instructions: `
    You are a brand research expert who analyzes websites to extract key brand information.
    Use the brand analyzer tool to analyze websites and provide insights about their brand voice,
    audience, values, mission, and goals.
  `,
  model: openai('gpt-4-turbo-preview'),
  tools: { brandAnalyzerTool },
});
