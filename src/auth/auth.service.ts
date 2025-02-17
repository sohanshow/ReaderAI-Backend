import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../user/schemas/user.schema';
import { MailService } from '../mail/mail.service';
import { UserService } from '../user/user.service';
import { RequestOtpDto, VerifyOtpDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private jwtService: JwtService,
    private mailService: MailService,
    private userService: UserService,
  ) {}

  private generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async requestOTP(requestOtpDto: RequestOtpDto) {
    const { email } = requestOtpDto;

    try {
      const otp = this.generateOTP();
      const otpExpiry = new Date();
      otpExpiry.setMinutes(otpExpiry.getMinutes() + 10);

      let user = await this.userService.findByEmail(email);

      if (!user) {
        user = await this.userModel.create({
          email,
          otp,
          otpExpiry,
        });
        this.logger.log(`New user created: ${email}`);
      } else {
        user.otp = otp;
        user.otpExpiry = otpExpiry;
        await user.save();
        this.logger.log(`OTP updated for existing user: ${email}`);
      }

      await this.mailService.sendOTP(email, otp);
      return { message: 'OTP sent successfully' };
    } catch (error) {
      this.logger.error(`Failed to process OTP request for ${email}:`, error);
      throw new BadRequestException('Failed to process OTP request');
    }
  }

  async verifyOTP(verifyOtpDto: VerifyOtpDto) {
    const { email, otp } = verifyOtpDto;

    try {
      const user = await this.userModel.findOne({ email });

      if (!user) {
        throw new BadRequestException('User not found');
      }

      if (user.otp !== otp) {
        throw new BadRequestException('Invalid OTP');
      }

      if (new Date() > user.otpExpiry) {
        throw new BadRequestException('OTP expired');
      }

      // Clear OTP and mark as verified
      user.otp = undefined;
      user.otpExpiry = undefined;
      user.isVerified = true;
      await user.save();

      const payload = { email: user.email, sub: user._id };
      const access_token = this.jwtService.sign(payload);

      this.logger.log(`User verified successfully: ${email}`);

      return {
        access_token,
        user: {
          email: user.email,
          isVerified: user.isVerified,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to verify OTP for ${email}:`, error);
      throw error;
    }
  }
}
