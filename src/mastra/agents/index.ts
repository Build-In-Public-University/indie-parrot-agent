import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';
import { audioIngestTool } from '../tools/audio-ingest';

export const researcherAgent = new Agent({
  name: 'researcher',
  instructions: `
      You are a data researcher whose job is collect and process data.


`,
  model: openai('gpt-4o'),
  tools: { audioIngestTool },
});
