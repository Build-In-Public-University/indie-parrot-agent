import { createTool } from "@mastra/core";
import { z } from "zod";
import mongoose from 'mongoose';
import { OpenAI } from 'openai';

// MongoDB Schema
const NewsletterSchema = new mongoose.Schema({
  transcriptionId: { type: String, required: true },
  brandAnalysisId: { type: String, required: true },
  content: { type: String },
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/newsletters');

const Newsletter = mongoose.model('Newsletter', NewsletterSchema);
const Transcription = mongoose.model('Transcription', require('./audio-transcription').TranscriptionSchema);
const BrandAnalysis = mongoose.model('BrandAnalysis', require('./brand-analyzer').BrandAnalysisSchema);

async function generateNewsletter(transcript: string, brandInfo: any): Promise<string> {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  const prompt = `Create a newsletter based on the following transcript and brand guidelines:

TRANSCRIPT:
${transcript}

BRAND GUIDELINES:
- Voice: ${brandInfo.brandVoice}
- Audience: ${brandInfo.audience}
- Values: ${brandInfo.values.join(', ')}
- Mission: ${brandInfo.mission}
- Goals: ${brandInfo.goals.join(', ')}

Requirements:
1. Maintain the brand's voice and tone throughout
2. Focus on the core message from the transcript
3. Structure the content in a clear, engaging way
4. Include a compelling subject line
5. Add a brief introduction that hooks the reader
6. Break down the main points into digestible sections
7. End with a clear call to action
8. Keep the total length between 500-800 words

Format the response as a JSON object with these fields:
- subject: The newsletter subject line
- introduction: A brief hook
- mainContent: Array of sections, each with a title and content
- conclusion: A wrap-up with call to action`;

  const response = await openai.chat.completions.create({
    model: "gpt-4-turbo-preview",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" }
  });

  const responseContent = response.choices[0].message.content;
  if (!responseContent) {
    throw new Error('No content received from OpenAI');
  }

  const newsletterData = JSON.parse(responseContent);
  
  // Format the newsletter content
  let formattedContent = `Subject: ${newsletterData.subject}\n\n`;
  formattedContent += `${newsletterData.introduction}\n\n`;
  
  for (const section of newsletterData.mainContent) {
    formattedContent += `${section.title}\n${section.content}\n\n`;
  }
  
  formattedContent += newsletterData.conclusion;
  
  return formattedContent;
}

export const newsletterWriterTool = createTool({
  id: 'newsletter-writer',
  description: 'Generate a newsletter from a transcription using brand guidelines',
  inputSchema: z.object({
    transcriptionId: z.string().describe('ID of the transcription to use'),
    brandAnalysisId: z.string().describe('ID of the brand analysis to use'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    newsletterId: z.string(),
    content: z.string(),
    status: z.string(),
  }),
  execute: async ({context}) => {
    console.log('context', context);
    const { transcriptionId, brandAnalysisId } = context;
    
    // Create MongoDB document
    const newsletter = new Newsletter({
      transcriptionId,
      brandAnalysisId,
      status: 'pending'
    });
    await newsletter.save();

    try {
      // Get transcription and brand analysis data
      const transcription = await Transcription.findOne({ transcriptionId });
      const brandAnalysis = await BrandAnalysis.findById(brandAnalysisId);

      if (!transcription || !brandAnalysis) {
        throw new Error('Transcription or brand analysis not found');
      }

      if (transcription.status !== 'completed') {
        throw new Error('Transcription is not completed');
      }

      // Generate newsletter content
      const content = await generateNewsletter(transcription.transcript, {
        brandVoice: brandAnalysis.brandVoice,
        audience: brandAnalysis.audience,
        values: brandAnalysis.values,
        mission: brandAnalysis.mission,
        goals: brandAnalysis.goals
      });

      // Update MongoDB document
      newsletter.content = content;
      newsletter.status = 'completed';
      newsletter.updatedAt = new Date();
      await newsletter.save();

      return {
        success: true,
        newsletterId: newsletter._id.toString(),
        content,
        status: newsletter.status
      };
    } catch (error) {
      newsletter.status = 'failed';
      newsletter.updatedAt = new Date();
      await newsletter.save();
      throw error;
    }
  },
}); 