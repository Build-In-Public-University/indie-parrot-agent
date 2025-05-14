
import { Mastra } from '@mastra/core/mastra';
import { createLogger } from '@mastra/core/logger';
import { weatherWorkflow } from './workflows';
import { researcherAgent } from './agents';

export const mastra = new Mastra({
  workflows: { weatherWorkflow },
  agents: { researcherAgent },
  logger: createLogger({
    name: 'Mastra',
    level: 'info',
  }),
});
