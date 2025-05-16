import mongoose from 'mongoose';

const TranscriptionSchema = new mongoose.Schema({
  clientName: { type: String, required: true },
  s3Key: { type: String, required: true },
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
  content: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Only define the model if it hasn't been defined yet
export const Transcription = mongoose.models.Transcription || mongoose.model('Transcription', TranscriptionSchema); 