import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { FileData } from './schemas/file.schema';
import { PlayHTService } from '../services/playht.service';
import { PdfGateway } from '../gateway/pdf.gateway';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol,
} from '@azure/storage-blob';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly jobPollingInterval = 2000;
  private readonly containerName = 'pdf-files';
  private readonly blobServiceClient: BlobServiceClient;
  private activeJobs: Map<string, Set<string>> = new Map(); // fileId -> Set of jobIds

  constructor(
    @InjectModel(FileData.name) private fileDataModel: Model<FileData>,
    private playHTService: PlayHTService,
    private pdfGateway: PdfGateway,
  ) {
    this.blobServiceClient = BlobServiceClient.fromConnectionString(
      process.env.AZURE_CONTAINER_CONNECTION_STRING,
    );
    this.setupBlobStorageCors().catch((err) =>
      console.error('Failed to setup blob storage CORS:', err),
    );
  }

  private async setupBlobStorageCors() {
    try {
      const properties = await this.blobServiceClient.getProperties();
      properties.cors = [
        {
          allowedOrigins: '*',
          allowedMethods: 'GET,HEAD,OPTIONS',
          allowedHeaders: '*',
          exposedHeaders: '*',
          maxAgeInSeconds: 3600,
        },
      ];
      await this.blobServiceClient.setProperties(properties);
    } catch (error) {
      console.error('Error setting up blob storage CORS:', error);
    }
  }

  async uploadToAzureStorage(
    file: Express.Multer.File,
    fileId: string,
  ): Promise<string> {
    const containerClient = this.blobServiceClient.getContainerClient(
      this.containerName,
    );

    await containerClient.createIfNotExists();

    const blobName = `${fileId}.pdf`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    await blockBlobClient.upload(file.buffer, file.buffer.length);

    return blockBlobClient.url;
  }

  async processFile(
    file: Express.Multer.File,
    fileId: string,
    userEmail: string,
    voiceId: string,
    temperature: number,
    speed: number,
  ) {
    try {
      const filePath = await this.uploadToAzureStorage(file, fileId);
      const pdfData = await pdfParse(file.buffer);
      const pages = pdfData.text.split('\n\n').filter((page) => page.trim());
      const totalPages = pages.length;

      // Initialize jobs tracking
      this.activeJobs.set(fileId, new Set());

      // Initialize file with pages
      await this.fileDataModel.findByIdAndUpdate(fileId, {
        totalPages,
        processedPages: 0,
        filePath,
        pages: Array.from({ length: totalPages }, (_, i) => ({
          pageNumber: i + 1,
          textExtractionStatus: 'pending',
          audioGenerationStatus: 'pending',
        })),
      });

      // Process all pages in parallel
      const jobPromises = pages.map(async (text, index) => {
        const pageNumber = index + 1;
        try {
          // Update text extraction status
          await this.fileDataModel.updateOne(
            { _id: fileId, 'pages.pageNumber': pageNumber },
            {
              $set: {
                'pages.$.text': text.trim(),
                'pages.$.textExtractionStatus': 'completed',
                'pages.$.audioGenerationStatus': 'processing',
              },
            },
          );

          // Initiate audio generation
          const jobId = await this.playHTService.initiateAudioGeneration(
            text.trim(),
            voiceId,
            temperature,
            speed,
          );

          // Add job to tracking
          this.activeJobs.get(fileId).add(jobId);

          // Update job ID
          await this.fileDataModel.updateOne(
            { _id: fileId, 'pages.pageNumber': pageNumber },
            {
              $set: {
                'pages.$.jobId': jobId,
              },
            },
          );

          return { pageNumber, jobId };
        } catch (error) {
          this.logger.error(
            `Error processing page ${pageNumber} of file ${fileId}:`,
            error.stack,
          );
          throw error;
        }
      });

      // Wait for all jobs to be initiated
      const jobs = await Promise.all(jobPromises);

      // Start polling all jobs
      this.pollAllJobs(fileId, userEmail, jobs);
    } catch (error) {
      this.logger.error(`Failed to process file ${fileId}:`, error.stack);
      throw error;
    }
  }

  private async pollAllJobs(
    fileId: string,
    userEmail: string,
    jobs: { pageNumber: number; jobId: string }[],
  ) {
    const completedJobs = new Set<string>();
    const totalJobs = jobs.length;

    const poll = async () => {
      if (completedJobs.size === totalJobs) {
        this.activeJobs.delete(fileId);
        await this.fileDataModel.findByIdAndUpdate(fileId, {
          processingComplete: true,
        });
        return;
      }

      const pendingJobs = jobs.filter((job) => !completedJobs.has(job.jobId));

      await Promise.all(
        pendingJobs.map(async (job) => {
          try {
            const { status, url } = await this.playHTService.checkJobStatus(
              job.jobId,
            );

            if (status === 'COMPLETED' && url) {
              completedJobs.add(job.jobId);

              await this.fileDataModel.updateOne(
                { _id: fileId, 'pages.pageNumber': job.pageNumber },
                {
                  $set: {
                    'pages.$.audioUrl': url,
                    'pages.$.audioGenerationStatus': 'completed',
                  },
                  $inc: { processedPages: 1 },
                },
              );

              // Emit progress update
              this.pdfGateway.emitProgress(userEmail, fileId, {
                phase: 'audio',
                completedPages: completedJobs.size,
                totalPages: totalJobs,
                completedJobs: Array.from(completedJobs),
              });
            }
          } catch (error) {
            this.logger.error(
              `Error polling job ${job.jobId} for page ${job.pageNumber}:`,
              error.stack,
            );
          }
        }),
      );

      // Continue polling if there are still pending jobs
      if (completedJobs.size < totalJobs) {
        setTimeout(poll, this.jobPollingInterval);
      }
    };

    // Start polling
    poll();
  }

  async uploadFile(
    file: Express.Multer.File,
    userEmail: string,
    voiceId: string,
    temperature: number,
    speed: number,
  ) {
    if (!file.mimetype.includes('pdf')) {
      throw new BadRequestException('Only PDF files are allowed');
    }

    if (file.size > 10 * 1024 * 1024) {
      throw new BadRequestException('File size must be less than 10MB');
    }

    try {
      const fileId = new mongoose.Types.ObjectId().toString();

      // Upload to Azure first
      const filePath = await this.uploadToAzureStorage(file, fileId);

      const fileData = new this.fileDataModel({
        _id: fileId,
        userEmail,
        fileName: file.originalname,
        fileSize: file.size,
        uploadDate: new Date(),
        selectedVoice: voiceId,
        temperature,
        speed,
        filePath, // Now we have the actual filePath
        pages: [],
        processingComplete: false,
      });

      const savedFile = await fileData.save();

      // Start processing in background
      this.processFile(
        file,
        fileId,
        userEmail,
        voiceId,
        temperature,
        speed,
      ).catch((error) => {
        this.logger.error(
          `Background processing failed for file ${fileId}:`,
          error.stack,
        );
      });

      return {
        fileId: savedFile._id,
        fileName: savedFile.fileName,
        uploadDate: savedFile.uploadDate,
      };
    } catch (error) {
      this.logger.error('File upload failed:', error.stack);
      throw new BadRequestException('Failed to upload file');
    }
  }

  async getUserFiles(userEmail: string) {
    return this.fileDataModel
      .find({ userEmail })
      .select(
        'fileName uploadDate processedPages totalPages processingComplete selectedVoice',
      )
      .sort({ uploadDate: -1 })
      .exec();
  }

  async getFileData(id: string, userEmail: string) {
    const file = await this.fileDataModel
      .findOne({ _id: id, userEmail })
      .exec();

    if (!file) {
      throw new NotFoundException('File not found');
    }

    return file;
  }

  async deleteFile(id: string, userEmail: string) {
    const file = await this.fileDataModel
      .findOneAndDelete({ _id: id, userEmail })
      .exec();

    if (!file) {
      throw new NotFoundException('File not found');
    }

    // Clean up from Azure storage
    try {
      const containerClient = this.blobServiceClient.getContainerClient(
        this.containerName,
      );
      const blobName = `${id}.pdf`;
      await containerClient.deleteBlob(blobName);
    } catch (error) {
      this.logger.error(`Failed to delete blob for file ${id}:`, error);
    }

    return { message: 'File deleted successfully' };
  }

  async generateViewUrl(
    id: string,
    userEmail: string,
  ): Promise<{ url: string }> {
    const file = await this.fileDataModel
      .findOne({ _id: id, userEmail })
      .exec();
    if (!file) {
      throw new NotFoundException('File not found');
    }

    const containerClient = this.blobServiceClient.getContainerClient(
      this.containerName,
    );
    const blobName = `${id}.pdf`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    const sasUrl = await blockBlobClient.generateSasUrl({
      permissions: BlobSASPermissions.from({ read: true }),
      startsOn: new Date(),
      expiresOn: new Date(new Date().valueOf() + 3600 * 1000),
      protocol: SASProtocol.Https,
      contentType: 'application/pdf',
      cacheControl: 'no-cache',
      contentDisposition: 'inline',
    });

    return { url: sasUrl };
  }

  async checkProcessingStatus(fileId: string, userEmail: string) {
    const file = await this.fileDataModel
      .findOne({ _id: fileId, userEmail })
      .select('processingComplete processedPages totalPages')
      .exec();

    if (!file) {
      throw new NotFoundException('File not found');
    }

    return {
      processingComplete: file.processingComplete,
      progress: (file.processedPages / file.totalPages) * 100,
    };
  }
}
