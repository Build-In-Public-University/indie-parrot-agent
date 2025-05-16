# Indie Parrot Agent

An automated workflow system for processing audio content and generating branded newsletters.

## Workflow Overview

The system processes audio files from S3 buckets and generates branded newsletters through the following steps:

1. **List S3 Files** (`listS3Files`)
   - Scans client's S3 bucket for new audio files
   - Looks in `inbound/{clientName}/` directory
   - Returns the first available file for processing

2. **Create Transcription** (`createTranscription`)
   - Processes the audio file using the `audioIngestTool`
   - Generates a transcription with metadata
   - Stores transcription in MongoDB

3. **Create Brand Analysis** (`createBrandAnalysis`)
   - Analyzes client's brand using `brandAnalyzerTool`
   - Generates brand guidelines and tone analysis
   - Stores analysis in MongoDB

4. **Generate Newsletter** (`newsletterWriterTool`)
   - Uses transcription and brand analysis to generate content
   - Follows brand guidelines and tone
   - Produces final newsletter content

5. **Create Beehiiv Post** (`createBeehiivPost`)
   - Publishes the newsletter content to Beehiiv
   - Supports scheduling and thumbnail images
   - Returns the created post ID

## Configuration

### Environment Variables
```env
INDIEPARROT_AWS_REGION=us-east-2
INDIEPARROT_AWS_ACCESS_KEY_ID=your_access_key
INDIEPARROT_AWS_SECRET_ACCESS_KEY=your_secret_key
INDIEPARROT_AWS_BUCKET=your_bucket_name
BEEHIIV_API_KEY=your_beehiiv_api_key
```

### Client Configuration
Clients are configured in the `CLIENTS` array:
```typescript
{
  name: 'IndieParrot',
  website: 'https://indieparrot.com',
  bucket: 'indieparrot',
  beehiivPublicationId: 'pub_00000000-0000-0000-0000-000000000000'
}
```

## Data Models

### Transcription
- Stores audio file transcriptions
- Contains metadata like S3 path and client info
- Used as input for newsletter generation

### Brand Analysis
- Stores client brand guidelines
- Contains tone analysis and style preferences
- Used to ensure consistent branding in newsletters

## Usage

The workflow is triggered by providing a client name:

```typescript
const result = await newsletterWorkflow.execute({
  clientName: 'IndieParrot'
});
```

The workflow will:
1. Process the audio file
2. Generate a transcription
3. Create brand analysis
4. Generate newsletter content
5. Publish to Beehiiv

## Error Handling

The workflow includes error handling for:
- Missing client configurations
- Invalid S3 paths
- Missing transcriptions
- Failed brand analysis generation
- Beehiiv API errors

## Dependencies

- `@aws-sdk/client-s3`: AWS S3 operations
- `@mastra/core/workflows`: Workflow orchestration
- `mongoose`: MongoDB operations
- `zod`: Schema validation 