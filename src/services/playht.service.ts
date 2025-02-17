import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class PlayHTService {
  private readonly logger = new Logger(PlayHTService.name);
  private readonly API_URL = 'https://api.play.ai/api/v1/tts';

  async initiateAudioGeneration(
    text: string,
    voiceId: string,
    temperature: Number,
    speed: Number,
  ): Promise<string> {
    try {
      const response = await axios.post(
        this.API_URL,
        {
          model: 'PlayDialog',
          text,
          voice: voiceId,
          speed,
          temperature,
        },
        {
          headers: {
            AUTHORIZATION: process.env.PLAYHT_API_KEY,
            'X-USER-ID': process.env.PLAYHT_USER_ID,
            'Content-Type': 'application/json',
          },
        },
      );
      return response.data.id;
    } catch (error) {
      this.logger.error(
        `Failed to initiate audio generation: ${error.message}`,
      );
      throw error;
    }
  }

  async checkJobStatus(jobId: string): Promise<{
    status: string;
    url?: string;
  }> {
    try {
      const response = await axios.get(`${this.API_URL}/${jobId}`, {
        headers: {
          AUTHORIZATION: process.env.PLAYHT_API_KEY,
          'X-USER-ID': process.env.PLAYHT_USER_ID,
        },
      });

      if (response.data.output.status === 'COMPLETED') {
        return {
          status: 'completed',
          url: response.data.output.url,
        };
      }

      return { status: 'processing' };
    } catch (error) {
      this.logger.error(`Failed to check job status: ${error.message}`);
      throw error;
    }
  }
}
