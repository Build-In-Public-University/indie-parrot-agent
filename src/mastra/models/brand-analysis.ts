import mongoose from 'mongoose';

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

// Only define the model if it hasn't been defined yet
export const BrandAnalysis = mongoose.models.BrandAnalysis || mongoose.model('BrandAnalysis', BrandAnalysisSchema); 