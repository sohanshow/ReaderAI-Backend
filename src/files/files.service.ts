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
  private readonly jobPollingInterval = 2000; // 2 seconds
  private readonly blobServiceClient: BlobServiceClient;
  private readonly containerName = 'pdf-files';

  constructor(
    @InjectModel(FileData.name) private fileDataModel: Model<FileData>,
    private playHTService: PlayHTService,
    private pdfGateway: PdfGateway,
  ) {
    this.blobServiceClient = BlobServiceClient.fromConnectionString(
      process.env.AZURE_CONTAINER_CONNECTION_STRING,
    );
    // Call the setup function when service initializes
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
    temperature: Number,
    speed: Number,
  ) {
    try {
      const filePath = await this.uploadToAzureStorage(file, fileId);
      const pdfData = await pdfParse(file.buffer);
      const pages = pdfData.text.split('\n\n').filter((page) => page.trim());
      const totalPages = pages.length;

      // Initialize file with pages
      await this.fileDataModel.findByIdAndUpdate(fileId, {
        totalPages,
        processedPages: 0,
        pages: Array.from({ length: totalPages }, (_, i) => ({
          pageNumber: i + 1,
          textExtractionStatus: 'pending',
          audioGenerationStatus: 'pending',
          jobId: null,
        })),
      });

      // Process each page
      for (let i = 0; i < totalPages; i++) {
        const pageNumber = i + 1;
        const text = pages[i].trim();

        try {
          // Emit start of extraction
          this.pdfGateway.emitProgress(userEmail, fileId, {
            phase: 'extraction',
            current: pageNumber - 1,
            total: totalPages,
            pageNumber,
          });

          // Update text extraction status
          await this.fileDataModel.updateOne(
            { _id: fileId, 'pages.pageNumber': pageNumber },
            {
              $set: {
                'pages.$.text': text,
                'pages.$.textExtractionStatus': 'completed',
                'pages.$.audioGenerationStatus': 'processing',
              },
            },
          );

          // Emit completion of extraction for this page
          this.pdfGateway.emitProgress(userEmail, fileId, {
            phase: 'extraction',
            current: pageNumber,
            total: totalPages,
            pageNumber,
          });

          // Initiate audio generation
          const jobId = await this.playHTService.initiateAudioGeneration(
            text,
            voiceId,
            temperature,
            speed,
          );

          // Update job ID
          await this.fileDataModel.updateOne(
            { _id: fileId, 'pages.pageNumber': pageNumber },
            {
              $set: {
                'pages.$.jobId': jobId,
              },
            },
          );

          // Start polling for job status
          await this.pollJobStatus(
            jobId,
            fileId,
            userEmail,
            pageNumber,
            totalPages,
          );
        } catch (error) {
          this.logger.error(
            `Error processing page ${pageNumber} of file ${fileId}:`,
            error.stack,
          );

          await this.fileDataModel.updateOne(
            { _id: fileId, 'pages.pageNumber': pageNumber },
            {
              $set: {
                'pages.$.textExtractionStatus': 'failed',
                'pages.$.audioGenerationStatus': 'failed',
                'pages.$.error': error.message,
              },
            },
          );

          // Emit error progress
          this.pdfGateway.emitProgress(userEmail, fileId, {
            phase: 'extraction',
            current: pageNumber,
            total: totalPages,
            pageNumber,
          });
        }
      }

      this.logger.log(`Successfully initiated processing for file ${fileId}`);
    } catch (error) {
      this.logger.error(`Failed to process file ${fileId}:`, error.stack);
      throw error;
    }
  }

  private async pollJobStatus(
    jobId: string,
    fileId: string,
    userEmail: string,
    pageNumber: number,
    totalPages: number,
  ) {
    try {
      while (true) {
        const { status, url } = await this.playHTService.checkJobStatus(jobId);

        // Emit audio generation progress
        this.pdfGateway.emitProgress(userEmail, fileId, {
          phase: 'audio',
          current: pageNumber - 1,
          total: totalPages,
          pageNumber,
        });

        if (status === 'completed' && url) {
          await this.fileDataModel.updateOne(
            { _id: fileId, 'pages.pageNumber': pageNumber },
            {
              $set: {
                'pages.$.audioUrl': url,
                'pages.$.audioGenerationStatus': 'completed',
              },
              $inc: { processedPages: 1 },
            },
          );

          // Emit completion of audio generation for this page
          this.pdfGateway.emitProgress(userEmail, fileId, {
            phase: 'audio',
            current: pageNumber,
            total: totalPages,
            pageNumber,
          });

          // Check if all pages are processed
          const file = await this.fileDataModel.findById(fileId);
          if (file.processedPages === file.totalPages) {
            await this.fileDataModel.findByIdAndUpdate(fileId, {
              processingComplete: true,
            });
          }

          break;
        }

        await new Promise((resolve) =>
          setTimeout(resolve, this.jobPollingInterval),
        );
      }
    } catch (error) {
      this.logger.error(
        `Error polling job status for page ${pageNumber} of file ${fileId}:`,
        error.stack,
      );

      await this.fileDataModel.updateOne(
        { _id: fileId, 'pages.pageNumber': pageNumber },
        {
          $set: {
            'pages.$.audioGenerationStatus': 'failed',
            'pages.$.error': error.message,
          },
        },
      );

      // Emit error progress
      this.pdfGateway.emitProgress(userEmail, fileId, {
        phase: 'audio',
        current: pageNumber,
        total: totalPages,
        pageNumber,
      });
    }
  }

  private async getTotalPages(fileId: string): Promise<number> {
    const file = await this.fileDataModel.findById(fileId);
    return file.totalPages;
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
      // Generate a unique file ID
      const fileId = new mongoose.Types.ObjectId().toString();

      // Upload the file to Azure Blob Storage
      const filePath = await this.uploadToAzureStorage(file, fileId);

      // Create the FileData document with the filePath
      const fileData = new this.fileDataModel({
        _id: fileId,
        userEmail,
        fileName: file.originalname,
        fileSize: file.size,
        uploadDate: new Date(),
        selectedVoice: voiceId,
        temperature,
        speed,
        filePath,
        pages: [],
        processingComplete: false,
      });

      // Save the FileData document
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

    return { message: 'File deleted successfully' };
  }

  async retryFailedPage(fileId: string, pageNumber: number, userEmail: string) {
    const file = await this.fileDataModel.findOne({
      _id: fileId,
      userEmail,
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    const page = file.pages.find((p) => p.pageNumber === pageNumber);
    if (!page) {
      throw new NotFoundException('Page not found');
    }

    if (page.audioGenerationStatus !== 'failed') {
      throw new BadRequestException('Page is not in failed state');
    }

    // Reset page status
    await this.fileDataModel.updateOne(
      { _id: fileId, 'pages.pageNumber': pageNumber },
      {
        $set: {
          'pages.$.audioGenerationStatus': 'processing',
          'pages.$.error': null,
        },
      },
    );

    // Emit progress update for retry initiation
    this.pdfGateway.emitProgress(userEmail, fileId, {
      phase: 'audio',
      current: pageNumber - 1,
      total: file.totalPages,
      pageNumber,
    });

    try {
      // Retry audio generation
      const jobId = await this.playHTService.initiateAudioGeneration(
        page.text,
        file.selectedVoice,
        file.temperature,
        file.speed,
      );

      await this.fileDataModel.updateOne(
        { _id: fileId, 'pages.pageNumber': pageNumber },
        {
          $set: {
            'pages.$.jobId': jobId,
          },
        },
      );

      // Start polling for job status with total pages
      this.pollJobStatus(jobId, fileId, userEmail, pageNumber, file.totalPages);

      this.logger.log(`Retry initiated for file ${fileId}, page ${pageNumber}`);

      return { message: 'Retry initiated successfully' };
    } catch (error) {
      this.logger.error(
        `Retry failed for file ${fileId}, page ${pageNumber}:`,
        error.stack,
      );

      await this.fileDataModel.updateOne(
        { _id: fileId, 'pages.pageNumber': pageNumber },
        {
          $set: {
            'pages.$.audioGenerationStatus': 'failed',
            'pages.$.error': error.message,
          },
        },
      );

      // Emit error progress
      this.pdfGateway.emitProgress(userEmail, fileId, {
        phase: 'audio',
        current: pageNumber - 1,
        total: file.totalPages,
        pageNumber,
      });

      throw error;
    }
  }

  async getFileProgress(fileId: string, userEmail: string) {
    const file = await this.fileDataModel
      .findOne({ _id: fileId, userEmail })
      .select('totalPages processedPages processingComplete pages')
      .exec();

    if (!file) {
      throw new NotFoundException('File not found');
    }

    const pagesStatus = file.pages.map((page) => ({
      pageNumber: page.pageNumber,
      textExtractionStatus: page.textExtractionStatus,
      audioGenerationStatus: page.audioGenerationStatus,
      error: page.error,
    }));

    return {
      totalPages: file.totalPages,
      processedPages: file.processedPages,
      processingComplete: file.processingComplete,
      pagesStatus,
    };
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
}
