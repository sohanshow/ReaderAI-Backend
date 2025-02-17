import {
  Controller,
  Post,
  Get,
  Delete,
  UseInterceptors,
  UploadedFile,
  Param,
  UseGuards,
  Request,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FilesService } from './files.service';
import { JwtAuthGuard } from '../auth/jwt/jwt-auth.guard';
import { AVAILABLE_VOICES } from 'src/constants/voices';

@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('voiceId') voiceId: string,
    @Body('temperature') temperature: string,
    @Body('speed') speed: string,
    @Request() req,
  ) {
    const parsedTemp = temperature ? parseFloat(temperature) : null;
    const parsedSpeed = speed ? parseFloat(speed) : 1;

    // Validate temperature and speed
    if (parsedTemp !== null && (parsedTemp < 0 || parsedTemp > 2)) {
      throw new BadRequestException('Temperature must be between 0 and 2');
    }
    if (parsedSpeed < 0.1 || parsedSpeed > 5) {
      throw new BadRequestException('Speed must be between 0.1 and 5');
    }

    return this.filesService.uploadFile(
      file,
      req.user.email,
      voiceId,
      parsedTemp,
      parsedSpeed,
    );
  }

  @Get()
  async getUserFiles(@Request() req) {
    return this.filesService.getUserFiles(req.user.email);
  }

  @Get('voices')
  async getAvailableVoices() {
    return AVAILABLE_VOICES;
  }

  @Get(':id')
  async getFileData(@Param('id') id: string, @Request() req) {
    return this.filesService.getFileData(id, req.user.email);
  }

  // -- Detes all data related to a file --//
  @Delete(':id')
  async deleteFile(@Param('id') id: string, @Request() req) {
    return this.filesService.deleteFile(id, req.user.email);
  }

  @Get(':id/view-url')
  async getViewUrl(@Param('id') id: string, @Request() req) {
    const result = await this.filesService.generateViewUrl(id, req.user.email);
    return {
      url: result.url,
      httpHeaders: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline',
        'Cache-Control': 'no-cache',
      },
    };
  }
}
