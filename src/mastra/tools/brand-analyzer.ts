import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import axios from 'axios';
import mongoose from 'mongoose';
import * as cheerio from 'cheerio';
import { OpenAI } from 'openai';

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
    website: z.string().url().describe('URL of the website to analyze'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    brandVoice: z.string(),
    audience: z.string(),
    values: z.array(z.string()),
    mission: z.string(),
    goals: z.array(z.string()),
  }),
  execute: async ({ context }) => {
    const { website } = context;
    
    // Create MongoDB document
    const analysis = new BrandAnalysis({
      website,
      status: 'pending'
    });
    await analysis.save();

    try {
      // Scrape website content
      const content = await scrapeWebsite(website);
      analysis.rawContent = content;
      await analysis.save();

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
        success: true,
        ...brandInfo
      };
    } catch (error) {
      analysis.status = 'failed';
      analysis.updatedAt = new Date();
      await analysis.save();
      throw error;
    }
  },
}); 