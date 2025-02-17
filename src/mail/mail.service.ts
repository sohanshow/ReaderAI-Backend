import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter;
  private readonly logger = new Logger(MailService.name);

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.ZOHO_MAIL,
        pass: process.env.ZOHO_PASSWORD,
      },
    });
  }

  async sendOTP(email: string, otp: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: process.env.ZOHO_MAIL,
        to: email,
        subject: `[${otp}] - ReadrAI Login OTP`,
        html: `
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: 'Helvetica Neue', Arial, sans-serif;">
          <div style="text-align: center; padding: 20px 0;">
            <!-- You can add your logo here -->
            <h1 style="color: #2C3E50; margin: 0;">ReadrAI</h1>
          </div>
          
          <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="color: #2C3E50; margin-bottom: 20px; text-align: center;">Verify Your Login</h2>
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin: 20px 0; text-align: center;">
              <p style="margin: 0; color: #666; font-size: 16px;">Your verification code is:</p>
              <div style="font-size: 32px; font-weight: bold; color: #3498db; letter-spacing: 4px; margin: 15px 0;">
                ${otp}
              </div>
              <p style="color: #999; font-size: 14px; margin: 0;">This code will expire in 10 minutes</p>
            </div>

            <p style="color: #666; font-size: 14px; line-height: 1.5;">
              If you didn't request this code, please ignore this email. For your security, 
              please don't share this code with anyone.
            </p>
          </div>

          <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
            <p>© ${new Date().getFullYear()} ReadrAI. All rights reserved.</p>
            <p style="margin: 5px 0;">
              This is an automated message, please do not reply to this email.
            </p>
          </div>
        </div>
      `,
      });
      this.logger.log(`OTP sent successfully to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send OTP to ${email}:`, error);
      throw new Error('Failed to send OTP email');
    }
  }
}
