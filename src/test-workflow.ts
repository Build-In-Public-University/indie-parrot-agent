import { mastra } from './mastra/index.js';

type StepResult = {
  status: 'success' | 'failed' | 'suspended';
  output?: unknown;
};

type WorkflowSteps = {
  [key: string]: StepResult;
};

async function runNewsletterWorkflow() {
  try {
    console.log('Initializing workflow...');
    const workflow = mastra.vnext_getWorkflow('newsletterWorkflow');
    if (!workflow) {
      throw new Error('Workflow not found');
    }

    const run = workflow.createRun();
    console.log('Starting newsletter workflow...');
    
    const result = await run.start({
      inputData: {
        clientName: 'Client A'
      }
    });

    console.log('\nWorkflow Results:');
    console.log('----------------');
    
    // Log all step results
    console.log('\nStep Results:');
    const steps = result.steps as WorkflowSteps;
    Object.entries(steps).forEach(([stepId, stepResult]) => {
      console.log(`\n${stepId}:`);
      console.log('Status:', stepResult.status);
      if (stepResult.status === 'success' && stepResult.output) {
        console.log('Output:', JSON.stringify(stepResult.output, null, 2));
      }
    });

    if (result.status === 'success') {
      console.log('\nWorkflow completed successfully!');
      console.log('Final newsletter:', result.result);
    } else if (result.status === 'suspended') {
      console.log('\nWorkflow suspended. Resuming...');
      const resumeResult = await run.resume({
        step: result.suspended[0],
        resumeData: {
          // Add any required resume data here
        }
      });
      console.log('Resume result:', resumeResult);
    } else if (result.status === 'failed') {
      console.error('\nWorkflow failed:', result.error);
    }
  } catch (error) {
    console.error('Error running workflow:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

runNewsletterWorkflow().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
}); 