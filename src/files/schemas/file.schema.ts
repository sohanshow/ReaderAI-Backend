import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class FileData extends Document {
  @Prop({ required: true })
  userEmail: string;

  @Prop({ required: true })
  fileName: string;

  @Prop({ required: true })
  fileSize: number;

  @Prop({ required: true })
  uploadDate: Date;

  @Prop({ required: true })
  selectedVoice: string;

  @Prop({ required: true })
  filePath: string;

  @Prop({ type: Number, default: null })
  temperature: number;

  @Prop({ type: Number, required: true, default: 1 })
  speed: number;

  @Prop([
    {
      pageNumber: Number,
      text: String,
      audioUrl: String,
      textExtractionStatus: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed'],
        default: 'pending',
      },
      audioGenerationStatus: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed'],
        default: 'pending',
      },
      error: String,
    },
  ])
  pages: {
    pageNumber: number;
    text: string;
    audioUrl?: string;
    textExtractionStatus: string;
    audioGenerationStatus: string;
    error?: string;
  }[];

  @Prop({ default: false })
  processingComplete: boolean;

  @Prop({ default: 0 })
  totalPages: number;

  @Prop({ default: 0 })
  processedPages: number;
}

export const FileDataSchema = SchemaFactory.createForClass(FileData);
