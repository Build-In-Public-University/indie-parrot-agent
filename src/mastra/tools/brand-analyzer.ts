import { createTool } from "@mastra/core";
import { z } from "zod";
import axios from 'axios';
import mongoose from 'mongoose';
import * as cheerio from 'cheerio';
import { OpenAI } from 'openai';

const CLIENTS = [
  {
    name: 'IndieParrot',
    website: 'https://indieparrot.com',
    bucket: 'indieparrot'
  },
  // Add more clients as needed
];

// MongoDB Schema
const BrandAnalysisSchema = new mongoose.Schema({
  website: { type: String, required: true },
  brandVoice: { type: String },
  audience: { type: String },
  values: { type: [String] },
  mission: { type: String },
  goals: { type: [String] },
  rawContent: { type: String },
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/brand-analysis');

const BrandAnalysis = mongoose.model('BrandAnalysis', BrandAnalysisSchema);

async function scrapeWebsite(url: string): Promise<string> {
  const response = await axios.get(url);
  const $ = cheerio.load(response.data);
  
  // Remove script and style elements
  $('script').remove();
  $('style').remove();
  
  // Get text content from main content areas
  const content = $('body').text()
    .replace(/\s+/g, ' ')
    .trim();
    
  return content;
}

async function analyzeBrandContent(content: string): Promise<any> {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  const prompt = `Analyze the following website content and extract key brand information. Format the response as a JSON object with these fields:
  - brandVoice: Describe the tone and style of communication
  - audience: Who is the target audience
  - values: Array of core brand values
  - mission: The brand's mission statement
  - goals: Array of main business goals

  Content:
  ${content.substring(0, 4000)} // Limit content length for API

  Respond with ONLY the JSON object, no other text.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4-turbo-preview",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" }
  });

  const responseContent = response.choices[0].message.content;
  if (!responseContent) {
    throw new Error('No content received from OpenAI');
  }

  return JSON.parse(responseContent);
}

export const brandAnalyzerTool = createTool({
  id: 'brand-analyzer',
  description: 'Analyze a website to extract brand voice, audience, values, mission, and goals',
  inputSchema: z.object({
    s3Path: z.string().url().describe('S3 path of the triggering input'),
  }),
  outputSchema: z.object({
    brandAnalysisId: z.string().describe('ID of the brand analysis'),
  }),
  execute: async ({ context }: { context: { s3Path: string } }) => {

    console.log('brand-analyzer', context);
    const { s3Path } = context;

    // get client namconst s3Path = transcription.s3Path;
    const clientName = s3Path.split('/')[1];

    // get client from s3 path
    const client = CLIENTS.find(c => c.name === clientName);
    if (!client) {
      throw new Error(`Client not found for s3 path ${s3Path}`);
    }

    const website = client.website; 
    // Check if brand analysis already exists
    const existingAnalysis = await BrandAnalysis.findOne({ website });
    if (existingAnalysis) {
      return {
        brandAnalysisId: existingAnalysis._id.toString()
      };
    }
    
    // Create MongoDB document
    const analysis = new BrandAnalysis({
      website,
      status: 'pending'
    });
    await analysis.save();
    console.log('brand-analyzer', analysis);
    try {
      // Scrape website content
      const content = await scrapeWebsite(website);
      analysis.rawContent = content;
      await analysis.save();
      console.log('brand-analyzer', analysis);
      // Analyze content
      const brandInfo = await analyzeBrandContent(content);

      // Update MongoDB document
      analysis.brandVoice = brandInfo.brandVoice;
      analysis.audience = brandInfo.audience;
      analysis.values = brandInfo.values;
      analysis.mission = brandInfo.mission;
      analysis.goals = brandInfo.goals;
      analysis.status = 'completed';
      analysis.updatedAt = new Date();
      await analysis.save();

      return {
        brandAnalysisId: analysis._id
      };
    } catch (error) {
      analysis.status = 'failed';
      analysis.updatedAt = new Date();
      await analysis.save();
      throw error;
    }
  },
}); 